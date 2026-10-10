import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AccessPolicy, AuthenticatedUser } from '../../common/auth/principal.js';
import { paginated, resolvePagination } from '../../common/dto/pagination.dto.js';
import { AppException, ErrorCode } from '../../common/errors/app-error.js';
import { REFERENCE_SCOPES } from '../../common/references/reference.scopes.js';
import { ProjectRequestStatus, UserStatus } from '../../generated/prisma/enums.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CounterService } from '../counters/counter.service.js';
import type {
  CreateProjectRequestDto,
  ListProjectRequestsQueryDto,
  UpdateProjectRequestDto,
} from './dto/project-request.dto.js';
import { OrdersService } from './orders.service.js';

const OPEN_STATUSES: ProjectRequestStatus[] = [
  ProjectRequestStatus.NEW,
  ProjectRequestStatus.IN_REVIEW,
];
const FINAL_STATUSES: ProjectRequestStatus[] = [
  ProjectRequestStatus.CONVERTED,
  ProjectRequestStatus.CLOSED,
];

const REQUEST_INCLUDE = {
  package: { select: { name: true } },
  user: { select: { firstName: true, lastName: true, email: true } },
} satisfies Prisma.ProjectRequestInclude;

type RequestRecord = Prisma.ProjectRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

export interface ClientProjectRequestView {
  id: string;
  reference: string;
  packageName: string | null;
  reason: string;
  message: string | null;
  status: ProjectRequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamProjectRequestView extends ClientProjectRequestView {
  country: string | null;
  teamNote: string | null;
  customer: { firstName: string; lastName: string; email: string };
}

function presentClient(r: RequestRecord): ClientProjectRequestView {
  return {
    id: r.id,
    reference: r.reference,
    packageName: r.package?.name ?? null,
    reason: r.reason,
    message: r.message,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function presentTeam(r: RequestRecord): TeamProjectRequestView {
  return {
    ...presentClient(r),
    country: r.country,
    teamNote: r.teamNote,
    customer: { firstName: r.user.firstName, lastName: r.user.lastName, email: r.user.email },
  };
}

/**
 * DEMANDES DE PROJET.
 *
 * Quand une commande en ligne n'est pas possible, le client peut enregistrer une
 * demande. Elle est stockee, numerotee (DEM-...), et apparait dans l'espace
 * equipe. Rien n'est cree cote projet : l'equipe decide ensuite.
 */
@Injectable()
export class ProjectRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly orders: OrdersService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateProjectRequestDto,
    meta: { ipAddress: string | null; userAgent: string | null },
  ): Promise<ClientProjectRequestView> {
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.id}))`;

      const user = await tx.user.findUnique({
        where: { id: actor.id },
        select: { status: true, country: true },
      });
      if (!user) throw AppException.unauthenticated();
      if (user.status === UserStatus.INVITED) {
        throw new AppException(
          ErrorCode.ACCOUNT_INVITED,
          'Verifiez votre adresse e-mail avant de faire une demande.',
          HttpStatus.FORBIDDEN,
        );
      }
      if (user.status !== UserStatus.ACTIVE) {
        throw AppException.forbidden('Ce compte ne peut pas faire de demande.');
      }

      // Motif releve par le serveur quand un pack est precise.
      let reason = 'CLIENT_CHOICE';
      let packageId: string | null = null;
      if (dto.packageId) {
        const { pack, offer } = await this.orders.offerFor(tx, actor.id, dto.packageId);
        packageId = pack.id;
        if (offer.kind === 'PROJECT_REQUEST') reason = offer.reason;

        const open = await tx.projectRequest.findFirst({
          where: { userId: actor.id, packageId, status: { in: OPEN_STATUSES } },
          select: { reference: true },
        });
        if (open) {
          throw AppException.conflict(
            'PROJECT_REQUEST_ALREADY_OPEN',
            `Une demande est deja en cours pour ce pack (${open.reference}).`,
          );
        }
      }

      const reference = await this.counters.reference(
        { scope: REFERENCE_SCOPES.PROJECT_REQUEST },
        tx,
      );
      return tx.projectRequest.create({
        data: {
          reference,
          userId: actor.id,
          packageId,
          country: user.country,
          reason,
          message: dto.message?.trim() || null,
        },
        include: REQUEST_INCLUDE,
      });
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'PROJECT_REQUEST_CREATED',
      entityType: 'ProjectRequest',
      entityId: created.id,
      after: { reference: created.reference, reason: created.reason, packageId: created.packageId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return presentClient(created);
  }

  /** Les demandes du demandeur uniquement, toutes dates confondues. */
  async listMine(actor: AuthenticatedUser): Promise<ClientProjectRequestView[]> {
    const rows = await this.prisma.projectRequest.findMany({
      where: { userId: actor.id },
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(presentClient);
  }

  /** Vue equipe : toutes les demandes, filtrables par statut. */
  async list(query: ListProjectRequestsQueryDto, _policy: AccessPolicy): Promise<unknown> {
    const pagination = resolvePagination(query);
    const where: Prisma.ProjectRequestWhereInput = query.status ? { status: query.status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.projectRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: [{ createdAt: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.projectRequest.count({ where }),
    ]);
    return paginated(items.map(presentTeam), total, pagination);
  }

  /** Traitement : statut et note interne. Un statut final ne rouvre pas la demande. */
  async update(
    id: string,
    dto: UpdateProjectRequestDto,
    actor: AuthenticatedUser,
  ): Promise<TeamProjectRequestView> {
    const current = await this.prisma.projectRequest.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!current) {
      throw AppException.notFound(
        'PROJECT_REQUEST_NOT_FOUND',
        'Cette demande de projet n existe pas.',
      );
    }
    if (FINAL_STATUSES.includes(current.status)) {
      throw AppException.conflict(
        'PROJECT_REQUEST_CLOSED',
        `Cette demande est deja ${current.status === ProjectRequestStatus.CONVERTED ? 'convertie' : 'close'}.`,
      );
    }

    const updated = await this.prisma.projectRequest.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.teamNote !== undefined ? { teamNote: dto.teamNote.trim() || null } : {}),
        handledById: actor.id,
      },
      include: REQUEST_INCLUDE,
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'PROJECT_REQUEST_UPDATED',
      entityType: 'ProjectRequest',
      entityId: id,
      before: { status: current.status },
      after: { status: dto.status },
    });

    return presentTeam(updated);
  }
}
