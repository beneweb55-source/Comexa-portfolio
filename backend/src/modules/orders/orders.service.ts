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
  ProjectStatus,
  RoleCode,
  UserStatus,
} from '../../generated/prisma/enums.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { CounterService } from '../counters/counter.service.js';
import type { CreateOrderDto, ListOrdersQueryDto, RecordPaymentDto } from './dto/order.dto.js';
import { parsePaymentMethodList, resolveOrderOffer, type OrderOffer } from './order-pricing.js';

/** Statuts pendant lesquels une commande est encore ouverte. */
const OPEN_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.ORDERED,
  OrderStatus.IN_REVIEW,
  OrderStatus.IN_PREPARATION,
  OrderStatus.IN_PROGRESS,
];

const ORDER_INCLUDE = {
  project: { select: { id: true, reference: true, status: true, progressPercent: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithProject = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/**
 * COMMANDES DE PACKS.
 *
 * Trois etats separes, qu'il ne faut jamais confondre :
 *  - le compte (`User.status`) : INVITED tant que le courriel n'est pas verifie ;
 *  - la commande (`Order.status`) : ORDERED -> IN_PREPARATION -> IN_PROGRESS ;
 *  - le paiement (`Order.paymentStatus`) : UNPAID tant que l'equipe n'a pas
 *    enregistre un encaissement. Une commande peut etre active alors que son
 *    paiement est encore en attente.
 *
 * Commander ACTIVE l'espace client tout de suite : pas de validation de l'equipe,
 * pas de paiement complet avant. L'equipe valide ensuite la commande, et c'est
 * alors seulement que le projet est cree.
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

  /**
   * Passe une commande pour un pack.
   *
   * Devise, montant et moyen de paiement viennent EXCLUSIVEMENT du serveur (voir
   * `resolveOrderOffer`). Si le pays ou le tarif ne permettent pas de commander,
   * la reponse est une 422 `ORDER_UNAVAILABLE` qui propose une demande de projet :
   * on ne choisit jamais une devise au hasard, et on ne promet pas un paiement
   * sans solution configuree.
   */
  async createOrder(
    actor: AuthenticatedUser,
    dto: CreateOrderDto,
    meta: { ipAddress: string | null; userAgent: string | null },
  ): Promise<OrderWithProject> {
    const policy = new AccessPolicy(actor);

    // Un collaborateur de l'agence ne commande pas : son compte n'est pas un
    // compte client. Un visiteur sans role, ou un client, peut commander.
    if (policy.roles.length > 0 && !policy.roles.includes(RoleCode.CLIENT)) {
      throw AppException.forbidden('Seuls les comptes client peuvent passer une commande.');
    }

    const paymentMethods = {
      DZD: parsePaymentMethodList(
        this.config.get<string>('PAYMENT_METHODS_DZD'),
        'PAYMENT_METHODS_DZD',
      ),
      EUR: parsePaymentMethodList(
        this.config.get<string>('PAYMENT_METHODS_EUR'),
        'PAYMENT_METHODS_EUR',
      ),
    };

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
      if (!user || user.status === UserStatus.INVITED) {
        throw new AppException(
          ErrorCode.ACCOUNT_INVITED,
          'Verifiez votre adresse e-mail avant de passer commande.',
          HttpStatus.FORBIDDEN,
        );
      }
      if (user.status !== UserStatus.ACTIVE) {
        throw new AppException(
          ErrorCode.ACCOUNT_SUSPENDED,
          'Ce compte ne peut pas passer commande. Contactez un administrateur.',
          HttpStatus.FORBIDDEN,
        );
      }

      const pack = await tx.package.findFirst({
        where: { id: dto.packageId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!pack) {
        throw AppException.notFound('PACKAGE_NOT_FOUND', "Ce pack n'existe pas.");
      }

      const open = await tx.order.findFirst({
        where: { userId: user.id, packageId: pack.id, status: { in: OPEN_ORDER_STATUSES } },
        select: { id: true, reference: true },
      });
      if (open) {
        throw AppException.conflict(
          'ORDER_ALREADY_OPEN',
          `Une commande est deja en cours pour ce pack (${open.reference}).`,
        );
      }

      const rates = await tx.packageRate.findMany({
        where: { packageId: pack.id, isActive: true },
        orderBy: { effectiveFrom: 'desc' },
      });

      const offer: OrderOffer<(typeof rates)[number]> = resolveOrderOffer({
        country: user.country,
        rates,
        paymentMethods,
        now: new Date(),
      });

      if (offer.kind === 'PROJECT_REQUEST') {
        throw AppException.unprocessable(
          'ORDER_UNAVAILABLE',
          'Cette commande ne peut pas etre passee en ligne. Vous pouvez demander un projet, notre equipe revient vers vous.',
          { alternative: 'PROJECT_REQUEST', reason: offer.reason, currency: offer.currency },
        );
      }

      const clientId = await this.ensureClientAccount(tx, user, actor.id);

      const reference = await this.counters.reference({ scope: REFERENCE_SCOPES.ORDER }, tx);

      // Le nom et le montant sont FIGES sur la commande : une modification
      // ulterieure du pack ou du tarif ne doit pas reecrire ce que le client a
      // accepte.
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

    return created;
  }

  /**
   * Cree le dossier client au premier achat, puis lie le compte a ce dossier et
   * lui donne le role CLIENT. Appele DANS la transaction de commande : un echec
   * plus loin ne laisse ni dossier orphelin ni role sans commande.
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

  /** Liste : l'equipe voit tout, un client voit ses commandes seulement. */
  async list(query: ListOrdersQueryDto, policy: AccessPolicy) {
    const pagination = resolvePagination(query);
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...this.perimeter(policy),
    };

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

    return paginated(items, total, pagination);
  }

  /** Une commande, ou 404 : une ligne hors perimetre n'existe pas pour le demandeur. */
  async getOne(orderId: string, policy: AccessPolicy): Promise<OrderWithProject> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...this.perimeter(policy) },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw AppException.notFound('ORDER_NOT_FOUND', "Cette commande n'existe pas.");
    }
    return order;
  }

  /**
   * Validation par l'equipe : la commande passe en preparation et le projet est
   * cree. C'EST ICI, ET NULLE PART AILLEURS, QUE LE PROJET NAIT.
   */
  async validate(orderId: string, actor: AuthenticatedUser): Promise<OrderWithProject> {
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

      return { orderId: order.id, reference: order.reference, projectId: project.id };
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'ORDER_VALIDATED',
      entityType: 'Order',
      entityId: result.orderId,
      after: { status: OrderStatus.IN_PREPARATION, projectId: result.projectId },
    });

    return this.getOneUnscoped(result.orderId);
  }

  /** Demarrage : le projet passe en cours. Possible seulement apres validation. */
  async start(orderId: string, actor: AuthenticatedUser): Promise<OrderWithProject> {
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
          'Une commande ne demarre qu une fois validee par l equipe.',
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

    return this.getOneUnscoped(orderId);
  }

  /**
   * Enregistre l'etat d'un paiement. Le client ne le declare pas : une commande
   * reste « paiement en attente » tant que l'equipe n'a pas enregistre
   * l'encaissement.
   */
  async recordPayment(
    orderId: string,
    dto: RecordPaymentDto,
    actor: AuthenticatedUser,
  ): Promise<OrderWithProject> {
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

    return this.getOneUnscoped(orderId);
  }

  /** Perimetre : l'equipe (`order:read:any`) voit tout ; un client, sa seule entite. */
  private perimeter(policy: AccessPolicy): Prisma.OrderWhereInput {
    if (policy.has('order:read:any')) {
      return {};
    }
    if (policy.has('order:read:own') && policy.clientId) {
      return { clientId: policy.clientId };
    }
    // Aucune cle de perimetre : aucune ligne ne correspond.
    return { id: { in: [] } };
  }

  private async getOneUnscoped(orderId: string): Promise<OrderWithProject> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw AppException.notFound('ORDER_NOT_FOUND', "Cette commande n'existe pas.");
    }
    return order;
  }
}
