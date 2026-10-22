import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../common/audit/audit.service.js';
import { AccessPolicy } from '../../common/auth/principal.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { paginated, resolvePagination } from '../../common/dto/pagination.dto.js';
import { AppException, ErrorCode } from '../../common/errors/app-error.js';
import { REFERENCE_SCOPES } from '../../common/references/reference.scopes.js';
import {
  ActivityType,
  ClientStatus,
  OrderPaymentStatus,
  OrderStatus,
  PaymentMethod,
  ProjectStatus,
  RoleCode,
  UserStatus,
} from '../../generated/prisma/enums.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { CounterService } from '../counters/counter.service.js';
import type {
  CreateOrderDto,
  ListOrdersQueryDto,
  RecordPaymentDto,
  UpdateOrderStatusDto,
} from './dto/order.dto.js';
import {
  ORDER_INCLUDE,
  presentClientOrder,
  presentTeamOrder,
  type ClientOrderView,
  type OrderRecord,
  type TeamOrderView,
} from './order.presenter.js';
import {
  parsePaymentMethodList,
  resolveOrderOffer,
  type OrderOffer,
  type PaymentMethodsByCurrency,
} from './order-pricing.js';

/** Statuts pendant lesquels une commande est encore ouverte. */
const OPEN_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.ORDERED,
  OrderStatus.IN_REVIEW,
  OrderStatus.IN_PREPARATION,
  OrderStatus.IN_PROGRESS,
];

/**
 * TRANSITIONS D'ETAT D'UNE COMMANDE.
 *
 * `IN_PREPARATION` n'apparait qu'en cible de `validate` : la validation cree le
 * projet dans la meme transaction, et une simple correction d'etat ne doit pas
 * pouvoir fabriquer un projet « a moitie ». De meme, le demarrage passe par
 * `start`, qui synchronise le projet.
 */
const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.ORDERED]: [OrderStatus.IN_REVIEW, OrderStatus.CANCELLED],
  [OrderStatus.IN_REVIEW]: [OrderStatus.ORDERED, OrderStatus.CANCELLED],
  [OrderStatus.IN_PREPARATION]: [OrderStatus.CANCELLED],
  [OrderStatus.IN_PROGRESS]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
};

/** Aperçu d'une offre pour un pack, sans rien creer. */
export type OrderOfferView =
  | {
      kind: 'ORDER';
      currency: string;
      amount: string;
      paymentMethod: PaymentMethod;
      packageId: string;
    }
  | { kind: 'PROJECT_REQUEST'; currency: string | null; reason: string; packageId: string };

/**
 * COMMANDES DE PACKS.
 *
 * Trois etats separes, qu'il ne faut jamais confondre :
 *  - le compte (`User.status`) : INVITED tant que le courriel n'est pas verifie ;
 *  - la commande (`Order.status`) : ORDERED -> IN_PREPARATION -> IN_PROGRESS ;
 *  - le paiement (`Order.paymentStatus`) : UNPAID tant que l'equipe n'a pas
 *    enregistre un encaissement.
 *
 * Commander ACTIVE l'espace client tout de suite. L'equipe valide ensuite la
 * commande, et c'est alors seulement que le projet est cree.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly counters: CounterService,
    private readonly config: ConfigService,
  ) {}

  /** Moyens de paiement configures (variables d'environnement, vides par defaut). */
  private paymentMethods(): PaymentMethodsByCurrency {
    return {
      DZD: parsePaymentMethodList(
        this.config.get<string>('PAYMENT_METHODS_DZD'),
        'PAYMENT_METHODS_DZD',
      ),
      EUR: parsePaymentMethodList(
        this.config.get<string>('PAYMENT_METHODS_EUR'),
        'PAYMENT_METHODS_EUR',
      ),
    };
  }

  /** Verifie qu'un compte peut commander : verifie, actif, et client (ou sans role). */
  static assertCanOrder(actor: AuthenticatedUser, status: UserStatus): void {
    if (status === UserStatus.INVITED) {
      throw new AppException(
        ErrorCode.ACCOUNT_INVITED,
        'Verifiez votre adresse e-mail avant de passer commande.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (status !== UserStatus.ACTIVE) {
      throw new AppException(
        ErrorCode.ACCOUNT_SUSPENDED,
        'Ce compte ne peut pas passer commande. Contactez un administrateur.',
        HttpStatus.FORBIDDEN,
      );
    }
    // Un collaborateur de l'agence ne commande pas : son compte n'est pas un compte client.
    const roles = actor.roles;
    if (roles.length > 0 && !roles.includes(RoleCode.CLIENT)) {
      throw AppException.forbidden('Seuls les comptes client peuvent passer une commande.');
    }
  }

  /**
   * Offre pour un pack, calculee pour l'utilisateur. Sert a l'aperçu (prix avant
   * commande) ET a la commande elle-meme : une seule regle, deux usages.
   */
  async offerFor(
    db: PrismaService | Prisma.TransactionClient,
    userId: string,
    packageId: string,
  ): Promise<{
    pack: { id: string; name: string };
    offer: OrderOffer<{
      id: string;
      currency: string;
      amount: Prisma.Decimal;
      effectiveFrom: Date;
      isActive: boolean;
    }>;
  }> {
    const user = await db.user.findUnique({ where: { id: userId }, select: { country: true } });
    const pack = await db.package.findFirst({
      where: { id: packageId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!pack) {
      throw AppException.notFound('PACKAGE_NOT_FOUND', "Ce pack n'existe pas.");
    }
    const rates = await db.packageRate.findMany({
      where: { packageId: pack.id, isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    const offer = resolveOrderOffer({
      country: user?.country ?? null,
      rates,
      paymentMethods: this.paymentMethods(),
      now: new Date(),
    });
    return { pack, offer };
  }

  /** Aperçu : prix et moyen de paiement, ou la raison pour laquelle la commande est impossible. */
  async offer(packageId: string, actor: AuthenticatedUser): Promise<OrderOfferView> {
    const { pack, offer } = await this.offerFor(this.prisma, actor.id, packageId);
    if (offer.kind === 'ORDER') {
      return {
        kind: 'ORDER',
        packageId: pack.id,
        currency: offer.currency,
        amount: offer.rate.amount.toFixed(2),
        paymentMethod: offer.paymentMethod,
      };
    }
    return {
      kind: 'PROJECT_REQUEST',
      packageId: pack.id,
      currency: offer.currency,
      reason: offer.reason,
    };
  }

  /**
   * Passe une commande pour un pack. Devise, montant et moyen de paiement viennent
   * EXCLUSIVEMENT du serveur. Si la commande n'est pas possible, la reponse est une
   * 422 `ORDER_UNAVAILABLE` avec `alternative: PROJECT_REQUEST` : le client peut
   * alors enregistrer une demande de projet (POST /project-requests).
   */
  async createOrder(
    actor: AuthenticatedUser,
    dto: CreateOrderDto,
    meta: { ipAddress: string | null; userAgent: string | null },
  ): Promise<ClientOrderView> {
    const created = await this.prisma.$transaction(async (tx) => {
      // Verrou transactionnel par utilisateur : deux clics simultanes ne creent
      // pas deux commandes pour le meme pack.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.id}))`;

      const user = await tx.user.findUnique({
        where: { id: actor.id },
        select: {
          id: true,
          status: true,
          country: true,
          firstName: true,
          lastName: true,
          clientId: true,
        },
      });
      if (!user) {
        throw AppException.unauthenticated();
      }
      OrdersService.assertCanOrder(actor, user.status);

      const open = await tx.order.findFirst({
        where: { userId: user.id, packageId: dto.packageId, status: { in: OPEN_ORDER_STATUSES } },
        select: { reference: true },
      });
      if (open) {
        throw AppException.conflict(
          'ORDER_ALREADY_OPEN',
          `Une commande est deja en cours pour ce pack (${open.reference}).`,
        );
      }

      const { pack, offer } = await this.offerFor(tx, user.id, dto.packageId);
      if (offer.kind === 'PROJECT_REQUEST') {
        throw AppException.unprocessable(
          'ORDER_UNAVAILABLE',
          'Cette commande ne peut pas etre passee en ligne. Vous pouvez demander un projet : notre equipe revient vers vous.',
          { alternative: 'PROJECT_REQUEST', reason: offer.reason, currency: offer.currency },
        );
      }

      const clientId = await this.ensureClientAccount(tx, user, actor.id);
      const reference = await this.counters.reference({ scope: REFERENCE_SCOPES.ORDER }, tx);

      // Nom, montant et devise sont FIGES sur la commande : une modification
      // ulterieure du pack ou du tarif ne reecrit pas ce que le client a accepte.
      return tx.order.create({
        data: {
          reference,
          userId: user.id,
          clientId,
          packageId: pack.id,
          rateId: offer.rate.id,
          packageName: pack.name,
          currency: offer.currency,
          amount: offer.rate.amount,
          country: user.country,
          paymentMethod: offer.paymentMethod,
          status: OrderStatus.ORDERED,
          paymentStatus: OrderPaymentStatus.UNPAID,
        },
        include: ORDER_INCLUDE,
      });
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'ORDER_CREATED',
      entityType: 'Order',
      entityId: created.id,
      after: {
        reference: created.reference,
        packageName: created.packageName,
        currency: created.currency,
        amount: created.amount.toFixed(2),
        paymentMethod: created.paymentMethod,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return presentClientOrder(created);
  }

  /**
   * Cree le dossier client au premier achat, lie le compte et lui donne le role
   * CLIENT. Appele DANS la transaction de commande.
   */
  private async ensureClientAccount(
    tx: Prisma.TransactionClient,
    user: {
      id: string;
      country: string | null;
      firstName: string;
      lastName: string;
      clientId: string | null;
    },
    actorId: string,
  ): Promise<string> {
    if (user.clientId) {
      return user.clientId;
    }

    const reference = await this.counters.reference({ scope: REFERENCE_SCOPES.CLIENT }, tx);
    const client = await tx.client.create({
      data: {
        reference,
        companyName: `${user.firstName} ${user.lastName}`.trim(),
        country: user.country,
        status: ClientStatus.ACTIVE,
      },
      select: { id: true },
    });

    await tx.user.update({ where: { id: user.id }, data: { clientId: client.id } });

    const role = await tx.role.findUnique({
      where: { code: RoleCode.CLIENT },
      select: { id: true },
    });
    if (!role) {
      throw new Error('Role CLIENT absent de la base : lancer le seed.');
    }
    await tx.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id, assignedById: actorId },
      update: {},
    });

    return client.id;
  }

  /** Liste : l'equipe voit tout (vue equipe), un client ses commandes (vue client). */
  async list(query: ListOrdersQueryDto, policy: AccessPolicy): Promise<unknown> {
    const pagination = resolvePagination(query);
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...this.perimeter(policy),
    };
    const team = policy.has('order:read:any');

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: [{ orderedAt: 'desc' }, { reference: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.order.count({ where }),
    ]);

    const views = items.map((o) => (team ? presentTeamOrder(o) : presentClientOrder(o)));
    return paginated(views, total, pagination);
  }

  /** Une commande, ou 404 : une ligne hors perimetre n'existe pas pour le demandeur. */
  async getOne(orderId: string, policy: AccessPolicy): Promise<ClientOrderView | TeamOrderView> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...this.perimeter(policy) },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw AppException.notFound('ORDER_NOT_FOUND', "Cette commande n'existe pas.");
    }
    return policy.has('order:read:any') ? presentTeamOrder(order) : presentClientOrder(order);
  }

  /**
   * Validation par l'equipe : la commande passe en preparation et le projet est
   * cree. C'EST ICI, ET NULLE PART AILLEURS, QUE LE PROJET NAIT.
   */
  async validate(orderId: string, actor: AuthenticatedUser): Promise<TeamOrderView> {
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          reference: true,
          status: true,
          projectId: true,
          clientId: true,
          packageName: true,
          amount: true,
          currency: true,
        },
      });
      if (!order) {
        throw AppException.notFound('ORDER_NOT_FOUND', "Cette commande n'existe pas.");
      }
      if (order.status !== OrderStatus.ORDERED && order.status !== OrderStatus.IN_REVIEW) {
        throw AppException.conflict(
          'ORDER_INVALID_STATE',
          `Cette commande ne peut pas etre validee depuis l'etat ${order.status}.`,
        );
      }
      if (order.projectId) {
        throw AppException.conflict(
          'ORDER_INVALID_STATE',
          'Un projet existe deja pour cette commande.',
        );
      }

      const projectReference = await this.counters.reference(
        { scope: REFERENCE_SCOPES.PROJECT },
        tx,
      );
      const project = await tx.project.create({
        data: {
          reference: projectReference,
          name: order.packageName,
          clientId: order.clientId,
          budget: order.amount,
          currency: order.currency,
          status: ProjectStatus.PLANNED,
          createdById: actor.id,
        },
        select: { id: true, reference: true },
      });

      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.IN_PREPARATION, projectId: project.id },
      });

      await this.activity.record(
        {
          type: ActivityType.STATUS_CHANGE,
          message: `Commande ${order.reference} validee. Projet ${project.reference} cree.`,
          projectId: project.id,
          clientId: order.clientId,
          actorId: actor.id,
          metadata: { orderReference: order.reference, projectReference: project.reference },
          isClientVisible: true,
        },
        tx,
      );

      return { orderId: order.id, projectId: project.id };
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'ORDER_VALIDATED',
      entityType: 'Order',
      entityId: result.orderId,
      after: { status: OrderStatus.IN_PREPARATION, projectId: result.projectId },
    });

    return this.teamView(result.orderId);
  }

  /** Demarrage : le projet passe en cours. Possible seulement apres validation. */
  async start(orderId: string, actor: AuthenticatedUser): Promise<TeamOrderView> {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, projectId: true },
      });
      if (!order) {
        throw AppException.notFound('ORDER_NOT_FOUND', "Cette commande n'existe pas.");
      }
      if (order.status !== OrderStatus.IN_PREPARATION || !order.projectId) {
        throw AppException.conflict(
          'ORDER_INVALID_STATE',
          "Une commande ne demarre qu'une fois validee par l'equipe.",
        );
      }

      await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.IN_PROGRESS } });
      await tx.project.update({
        where: { id: order.projectId },
        data: { status: ProjectStatus.IN_PROGRESS, startDate: new Date() },
      });
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'ORDER_STARTED',
      entityType: 'Order',
      entityId: orderId,
      after: { status: OrderStatus.IN_PROGRESS },
    });

    return this.teamView(orderId);
  }

  /**
   * Correction d'etat par l'equipe, transitions controlees.
   *
   * Ce n'est PAS la validation : `validate` reste le seul chemin qui cree le
   * projet. Ici on corrige une etape (remettre en revue, annuler une commande
   * jamais demarree, clore une commande dont le projet est termine).
   */
  async changeStatus(
    orderId: string,
    dto: UpdateOrderStatusDto,
    actor: AuthenticatedUser,
  ): Promise<TeamOrderView> {
    const before = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, reference: true, status: true, projectId: true, cancelledAt: true },
    });
    if (!before) {
      throw AppException.notFound('ORDER_NOT_FOUND', "Cette commande n'existe pas.");
    }

    if (before.status === dto.status) {
      return this.teamView(orderId);
    }

    if (!ORDER_STATUS_TRANSITIONS[before.status].includes(dto.status)) {
      throw AppException.conflict(
        'ORDER_INVALID_TRANSITION',
        `Cette commande ne peut pas passer de « ${before.status} » a « ${dto.status} ».`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: dto.status,
          cancelledAt: dto.status === OrderStatus.CANCELLED ? new Date() : before.cancelledAt,
        },
      });

      // Une commande close par la correction d'etat ne doit pas laisser un
      // projet ouvert a cote : on l'aligne, sans jamais toucher aux projets
      // termines ou archives (leur trace reste).
      if (before.projectId) {
        if (dto.status === OrderStatus.COMPLETED) {
          await tx.project.updateMany({
            where: {
              id: before.projectId,
              deletedAt: null,
              status: { notIn: [ProjectStatus.ARCHIVED] },
            },
            data: { status: ProjectStatus.COMPLETED, completedAt: new Date() },
          });
        }
      }
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'ORDER_STATUS_CHANGED',
      entityType: 'Order',
      entityId: orderId,
      before: { status: before.status },
      after: { status: dto.status },
    });

    return this.teamView(orderId);
  }

  /** Enregistre l'etat d'un paiement. Le client ne le declare jamais. */
  async recordPayment(
    orderId: string,
    dto: RecordPaymentDto,
    actor: AuthenticatedUser,
  ): Promise<TeamOrderView> {
    const before = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, paymentStatus: true },
    });
    if (!before) {
      throw AppException.notFound('ORDER_NOT_FOUND', "Cette commande n'existe pas.");
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { paymentStatus: dto.paymentStatus },
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'ORDER_PAYMENT_RECORDED',
      entityType: 'Order',
      entityId: orderId,
      before: { paymentStatus: before.paymentStatus },
      after: { paymentStatus: dto.paymentStatus, note: dto.note ?? null },
    });

    return this.teamView(orderId);
  }

  /** Perimetre : l'equipe (`order:read:any`) voit tout ; un client, sa seule entite. */
  private perimeter(policy: AccessPolicy): Prisma.OrderWhereInput {
    if (policy.has('order:read:any')) {
      return {};
    }
    if (policy.has('order:read:own') && policy.clientId) {
      return { clientId: policy.clientId };
    }
    return { id: { in: [] } };
  }

  private async teamView(orderId: string): Promise<TeamOrderView> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw AppException.notFound('ORDER_NOT_FOUND', "Cette commande n'existe pas.");
    }
    return presentTeamOrder(order as OrderRecord);
  }
}
