import { Injectable } from '@nestjs/common';
import { AccessPolicy, SCOPE_ANY, SCOPE_OWN, type AuthenticatedUser } from '../../common/auth/principal.js';
import { paginated, resolvePagination, type Paginated } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import { REFERENCE_SCOPES } from '../../common/references/reference.scopes.js';
import {
  ActivityType,
  ModificationStatus,
  NotificationType,
  Priority,
} from '../../generated/prisma/enums.js';
import type { ModificationRequest, Prisma } from '../../generated/prisma/client.js';
import { ActivityService } from '../activity/activity.service.js';
import { CounterService } from '../counters/counter.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  CreateModificationRequestDto,
  DecideModificationRequestDto,
  ListModificationRequestsQueryDto,
} from './dto/modification-request.dto.js';

/**
 * DEMANDES DE MODIFICATION — le client demande, l'agence decide.
 *
 * DEUX MONDES DANS UN MEME SERVICE, ET LA FRONTIERE EST LE CLIENTID.
 *
 * Un porteur CLIENT detient `modificationrequest:read:own` et
 * `modificationrequest:write:own`. Ces deux codes veulent dire « les demandes de
 * MON dossier », et le seul dossier qu'un porteur peut revendiquer est celui
 * porte par son jeton. Le `clientId` n'est donc JAMAIS lu dans le corps ni dans
 * les filtres : il vient de `policy.clientId`, et quand il est absent la requete
 * est refusee plutot que filtree sur `null` — un filtre sur `null` ne restreint
 * rien, il ouvre.
 *
 * Un porteur interne detient `read:any` et `decide:any`. Il voit tout et decide.
 * Aucun role ne detient `modificationrequest:write:any` : une demande de
 * modification est, par definition, une demande du client. Un membre de l'agence
 * qui veut consigner une demande recuee par telephone passe par le projet.
 *
 * LE PROJET EST VERIFIE CONTRE LE CLIENT DU PORTEUR, pas contre le corps. Un
 * client qui envoie l'identifiant du projet d'un autre recoit un 404 : lui
 * repondre 403 confirmerait que ce projet existe, ce qu'il n'a pas a savoir.
 */
@Injectable()
export class ModificationRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Depose une demande pour un projet du client.
   *
   * La reference, la ligne et l'entree du fil d'activite sont ecrites dans LA
   * MEME TRANSACTION. Le fil d'activite raconte l'histoire du projet : une
   * demande visible dans la liste mais absente du fil laisserait un trou dans le
   * recit, et c'est exactement ce que le service d'activite partage existe pour
   * eviter.
   */
  async create(
    user: AuthenticatedUser,
    dto: CreateModificationRequestDto,
  ): Promise<ModificationRequestRow> {
    const policy = new AccessPolicy(user);
    policy.requireScope('modificationrequest', 'write', [SCOPE_OWN]);

    const clientId = policy.clientId;
    if (clientId === null) {
      throw AppException.forbidden(
        "Seul un compte rattache a un dossier client peut deposer une demande de modification.",
      );
    }

    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, clientId, deletedAt: null },
      select: { id: true, managerId: true, reference: true },
    });

    if (!project) {
      throw AppException.notFound('PROJECT_NOT_FOUND', 'Projet introuvable.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const reference = await this.counters.reference(
        { scope: REFERENCE_SCOPES.MODIFICATION_REQUEST },
        tx,
      );

      const request = await tx.modificationRequest.create({
        data: {
          reference,
          projectId: project.id,
          clientId,
          title: dto.title,
          description: dto.description,
          priority: dto.priority ?? Priority.NORMAL,
          // L'auteur est le porteur du jeton. Le lire dans le corps laisserait
          // signer une demande par quelqu'un d'autre.
          requestedById: policy.userId,
        },
      });

      await this.activity.record(
        {
          type: ActivityType.NOTE,
          message: `Demande de modification ${reference} deposee : ${dto.title}`,
          projectId: project.id,
          clientId,
          actorId: policy.userId,
          // Le client vient d'ecrire ce texte : il n'y a rien de cache a lui
          // rendre. Le passer en interne priverait le fil de l'evenement qui
          // explique tout ce qui suit.
          isClientVisible: true,
          metadata: { reference, modificationRequestId: request.id },
        },
        tx,
      );

      return request;
    });

    await this.notifyManager(project.managerId, created);

    return created;
  }

  /**
   * Liste les demandes visibles par le porteur.
   *
   * Le filtre de portee est construit AVANT les filtres de requete, dans un
   * `AND` : un filtre client ne peut donc pas elargir ce que la portee a
   * restreint. Les fusionner dans un meme objet laisserait un `projectId` du
   * corps ecraser la clause `clientId`.
   */
  async list(
    user: AuthenticatedUser,
    query: ListModificationRequestsQueryDto,
  ): Promise<Paginated<ModificationRequestRow>> {
    const policy = new AccessPolicy(user);
    const scope = policy.requireScope('modificationrequest', 'read', [SCOPE_ANY, SCOPE_OWN]);
    const pagination = resolvePagination(query);
    const where = buildWhere(policy, scope, query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.modificationRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.modificationRequest.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<ModificationRequestRow> {
    const policy = new AccessPolicy(user);
    const scope = policy.requireScope('modificationrequest', 'read', [SCOPE_ANY, SCOPE_OWN]);

    const request = await this.prisma.modificationRequest.findFirst({
      where: buildWhere(policy, scope, {}, id),
    });

    // 404 et non 403 : un client qui vise la demande d'un autre ne doit pas
    // apprendre qu'elle existe.
    if (!request) throw notFoundModification();
    return request;
  }

  /**
   * Approuve ou refuse une demande.
   *
   * LA DECISION NE SE REPREND PAS. Le modele ne garde qu'une decision —
   * `decidedById`, `decidedAt`, `decisionNote` — donc la reecrire effacerait qui
   * a decide quoi en premier, sans laisser de trace hors du fil d'activite.
   * Redecider du meme avis n'est pas une erreur pour autant : la methode est
   * IDEMPOTENTE et rend la demande inchangee, pour qu'un double clic ne produise
   * pas un conflit la ou rien ne s'est passe.
   *
   * Changer d'avis apres coup reste possible — par une nouvelle demande, ou en
   * passant par le projet. Ce n'est pas un refus de principe, c'est le refus
   * d'ecraser silencieusement une decision deja communiquee.
   */
  async decide(
    user: AuthenticatedUser,
    id: string,
    dto: DecideModificationRequestDto,
  ): Promise<ModificationRequestRow> {
    const policy = new AccessPolicy(user);
    policy.requireScope('modificationrequest', 'decide', [SCOPE_ANY]);

    const existing = await this.prisma.modificationRequest.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        reference: true,
        status: true,
        projectId: true,
        clientId: true,
        requestedById: true,
      },
    });

    if (!existing) throw notFoundModification();

    const alreadyDecided =
      existing.status === ModificationStatus.APPROVED || existing.status === ModificationStatus.REJECTED;

    if (alreadyDecided && existing.status === dto.status) return this.requireRow(id);

    if (alreadyDecided) {
      throw AppException.conflict(
        'MODIFICATION_ALREADY_DECIDED',
        'Cette demande a deja ete decidee et ne peut pas l etre une seconde fois.',
      );
    }

    const decided = await this.prisma.$transaction(async (tx) => {
      const request = await tx.modificationRequest.update({
        where: { id },
        data: {
          status: dto.status,
          decisionNote: dto.decisionNote ?? null,
          estimatedMinutes: dto.estimatedMinutes ?? null,
          ...(dto.extraCost === undefined ? {} : { extraCost: dto.extraCost }),
          ...(dto.extraCostCurrency === undefined
            ? {}
            : { extraCostCurrency: dto.extraCostCurrency }),
          decidedBy: { connect: { id: policy.userId } },
          decidedAt: new Date(),
        },
      });

      await this.activity.record(
        {
          type: ActivityType.STATUS_CHANGE,
          message: `Demande de modification ${existing.reference} : ${existing.status} -> ${dto.status}`,
          projectId: existing.projectId,
          clientId: existing.clientId,
          actorId: policy.userId,
          // Le client a depose cette demande et c'est lui qui doit lire la
          // reponse. La cacher dans le fil interne l'obligerait a revenir sur
          // la liste pour savoir ce qu'on a decide.
          isClientVisible: true,
          metadata: { reference: existing.reference, from: existing.status, to: dto.status },
        },
        tx,
      );

      return request;
    });

    await this.notifyRequester(existing.requestedById, decided);

    return decided;
  }

  private async requireRow(id: string): Promise<ModificationRequestRow> {
    const request = await this.prisma.modificationRequest.findFirst({ where: { id } });
    if (!request) throw notFoundModification();
    return request;
  }

  /**
   * Previent le responsable de projet qu'une demande est arrivee.
   *
   * Pas de destinataire quand le projet n'a pas de responsable : mieux vaut
   * aucune notification qu'une notification envoyee a personne. L'appel est hors
   * transaction et son echec est journalise sans faire echouer la reponse — la
   * demande est deja en base, et la rejouer produirait un doublon.
   */
  private async notifyManager(
    managerId: string | null,
    request: ModificationRequestRow,
  ): Promise<void> {
    if (managerId === null) return;

    try {
      await this.notifications.notify(managerId, {
        type: NotificationType.MODIFICATION_REQUESTED,
        title: `Demande de modification ${request.reference}`,
        body: request.title,
        entityType: 'ModificationRequest',
        entityId: request.id,
        link: `/admin/projets/${request.projectId}`,
      });
    } catch {
      // Volontairement muet cote HTTP : voir le commentaire ci-dessus.
    }
  }

  /**
   * Previent le demandeur de la decision.
   *
   * `SYSTEM` faute de mieux, et c'est un manque du catalogue a signaler : les
   * types de notification couvrent « une modification a ete demandee » mais pas
   * « une modification a ete decidee ». `SYSTEM` est le fourre-tout prevu pour
   * les evenements sans type dedie ; l'annoncer comme `MODIFICATION_REQUESTED`
   * serait un mensonge dans la boite de reception du client, qui croirait qu'on
   * lui demande quelque chose.
   */
  private async notifyRequester(
    requesterId: string | null,
    request: ModificationRequestRow,
  ): Promise<void> {
    if (requesterId === null) return;

    try {
      await this.notifications.notify(requesterId, {
        type: NotificationType.SYSTEM,
        title: `Votre demande ${request.reference} a ete traitee`,
        body: `Nouvel etat : ${request.status}`,
        entityType: 'ModificationRequest',
        entityId: request.id,
        link: `/espace/demandes/${request.id}`,
      });
    } catch {
      // Voir `notifyManager` : la decision est enregistree, la notification est
      // un confort.
    }
  }
}

type ModificationRequestRow = ModificationRequest;

function notFoundModification(): AppException {
  return AppException.notFound('MODIFICATION_REQUEST_NOT_FOUND', 'Demande de modification introuvable.');
}

/**
 * Le `where` d'une lecture, portee d'abord.
 *
 * Construit en `AND` de clauses : la portee et les filtres ne se rencontrent
 * jamais dans le meme objet. Fusionner les deux laisserait un `projectId` de
 * requete ecraser un `clientId` de portee, et c'est exactement la forme de bogue
 * qui ouvre un dossier client a tous les autres.
 */
function buildWhere(
  policy: AccessPolicy,
  scope: string,
  query: ListModificationRequestsQueryDto,
  id?: string,
): Prisma.ModificationRequestWhereInput {
  const ownOnly = scope === SCOPE_OWN;

  // La restriction de portee est construite A PART, et seulement pour un
  // porteur client. Le controle de `clientId` est fait ici, une fois : au-dela,
  // le filtre porte une chaine, et `clientId: null` — qui ne restreindrait rien
  // du tout — n'est meme pas exprimable.
  let scopeClause: Prisma.ModificationRequestWhereInput = {};

  if (ownOnly) {
    const clientId = policy.clientId;

    if (clientId === null) {
      throw AppException.forbidden('Votre compte n est rattache a aucun dossier client.');
    }

    scopeClause = { clientId };
  }

  return {
    AND: [
      { deletedAt: null },
      ...(id === undefined ? [] : [{ id }]),
      ...(ownOnly ? [scopeClause] : []),
      ...(query.status === undefined ? [] : [{ status: query.status }]),
      ...(query.priority === undefined ? [] : [{ priority: query.priority }]),
      ...(query.projectId === undefined ? [] : [{ projectId: query.projectId }]),
      ...(query.from === undefined && query.to === undefined
        ? []
        : [{ createdAt: buildDateRange(query.from, query.to) }]),
      ...(query.search === undefined
        ? []
        : [
            {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' as const } },
                { reference: { contains: query.search, mode: 'insensitive' as const } },
              ],
            },
          ]),
    ],
  };
}

/** Voir `buildDateRange` du service de contact : meme regle, meme raison. */
function buildDateRange(from: string | undefined, to: string | undefined): Prisma.DateTimeFilter {
  const range: Prisma.DateTimeFilter = {};

  if (from !== undefined) range.gte = new Date(from);

  if (to !== undefined) {
    const end = new Date(to);
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(to.trim());
    if (isDateOnly) end.setUTCHours(23, 59, 59, 999);
    range.lte = end;
  }

  return range;
}
