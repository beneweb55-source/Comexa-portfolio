import { Injectable } from '@nestjs/common';
import { AccessPolicy, SCOPE_ANY, type AuthenticatedUser } from '../../common/auth/principal.js';
import { paginated, resolvePagination } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Paginated } from '../../common/interceptors/transform.interceptor.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ListAuditLogsQueryDto } from './dto/audit-log.dto.js';
import { redactPayload, type RedactedValue } from './redact.js';

/**
 * LECTURE DU JOURNAL D'AUDIT.
 *
 * CE SERVICE NE FAIT QUE LIRE. Aucune methode n'ecrit ici, et ce n'est pas un
 * oubli : l'ecriture passe par `AuditService`, monte en global, qui est le seul
 * point d'entree et qui ne fait jamais echouer l'operation qu'il journalise. Un
 * second chemin d'ecriture — ne serait-ce qu'un `create` de depannage — rendrait
 * le journal dependant de deux implementations, et l'une des deux finirait par
 * ne plus etre appelee.
 *
 * LA PROTECTION QUI COMPTE EST ICI : `redactPayload`.
 *
 * Les `before` et `after` sortent de la base tels qu'ils y ont ete ecrits, et
 * ils sont filtres AU MOMENT DE LA REPONSE, pas a l'ecriture. C'est le bon
 * endroit : un journal doit conserver ce qui s'est reellement passe — c'est sa
 * raison d'etre, et un journal qui ne conserve pas la donnee ne permet pas de
 * reconstituer les faits. C'est la DIFFUSION qui est restreinte, pas la
 * conservation. Voir `redact.ts`.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Une page de journal, du plus recent au plus ancien.
   *
   * `audit:read:any` est exige ici EN PLUS du decorateur de la route. Le journal
   * contient qui a fait quoi sur qui : c'est la vue la plus large de toute
   * l'agence, et elle ne se donne pas par accident a un porteur d'un autre droit
   * de lecture. Le garde autorise l'adresse ; le service verifie que le porteur a
   * bien la permission qui ouvre les donnees.
   */
  async list(
    query: ListAuditLogsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<Paginated<AuditLogView>> {
    new AccessPolicy(actor).requireScope('audit', 'read', [SCOPE_ANY]);

    const pagination = resolvePagination(query);
    const period = resolvePeriod(query.from, query.to);

    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(period ? { createdAt: period } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        select: AUDIT_LOG_SELECT,
        // `id` en second critere, et ce n'est pas cosmetique : deux lignes
        // ecrites dans la meme milliseconde — ce qui arrive des qu'une operation
        // en journalise deux — ont le meme `createdAt`. Sans departage, l'ordre
        // n'est pas garanti d'une page a l'autre en PostgreSQL, et une ligne
        // peut apparaitre deux fois sur la page 2 apres avoir figure sur la
        // page 1. `id` est unique, donc l'ordre est total.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginated(rows.map(presentAuditLog), total, pagination);
  }
}

/**
 * Un evenement du journal, tel qu'il part dans la reponse.
 *
 * `actorEmail` evite de renvoyer un cuid nu : un journal ou l'on lit
 * `clx8f2p0k...` ne repond a aucune question. L'adresse est jointe a la lecture,
 * pas recopiee a l'ecriture — ainsi, changer l'adresse d'un compte met a jour
 * tout l'historique au lieu de laisser deux adresses pour une meme personne.
 */
export interface AuditLogView {
  readonly id: string;
  readonly actorId: string | null;
  readonly actorEmail: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  /** Filtre avant diffusion. Voir `redact.ts`. */
  readonly before: RedactedValue;
  readonly after: RedactedValue;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly createdAt: Date;
}

const AUDIT_LOG_SELECT = {
  id: true,
  actorId: true,
  action: true,
  entityType: true,
  entityId: true,
  before: true,
  after: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
  // Seule l'adresse est jointe : le nom du porteur ne sert pas a comprendre un
  // evenement, et le charger ferait circuler une donnee personnelle de plus dans
  // une reponse consultable par tout administrateur.
  actor: { select: { email: true } },
} as const satisfies Prisma.AuditLogSelect;

type AuditLogRow = Prisma.AuditLogGetPayload<{ select: typeof AUDIT_LOG_SELECT }>;

function presentAuditLog(row: AuditLogRow): AuditLogView {
  return {
    id: row.id,
    actorId: row.actorId,
    actorEmail: row.actor?.email ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    // `before` et `after` sont nullable en base : une creation n'a pas de
    // « avant », une suppression n'a pas toujours d'« apres ». Le masquage
    // laisse `null` tel quel plutot que de le transformer en objet vide, ce qui
    // distinguerait mal « rien » de « vide ».
    before: redactPayload(row.before),
    after: redactPayload(row.after),
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
  };
}

/**
 * Traduit la periode demandee en bornes Prisma.
 *
 * LES DEUX BORNES SONT INCLUSES, et c'est un choix d'usage : un operateur qui
 * cherche « ce qui s'est passe le 30 septembre » saisit la date de debut ET la
 * date de fin au 30, pas au 1er octobre. Une borne haute exclusive ferait
 * disparaitre de sa recherche les evenements de la soiree du 30 — exactement
 * ceux qu'il cherchait.
 *
 * Une periode inversee est REFUSEE. Sans ce controle, `from > to` rend une liste
 * vide, et une liste vide se lit « il ne s'est rien passe ». Un enqueteur
 * conclurait a l'absence d'activite alors que sa requete etait mal construite :
 * c'est la seule erreur de saisie qui puisse faire dire au journal le contraire
 * de la verite.
 */
function resolvePeriod(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  const start = from ? new Date(from) : undefined;
  const end = to ? new Date(to) : undefined;

  if (start && end && start.getTime() > end.getTime()) {
    throw AppException.unprocessable(
      'INVALID_PERIOD',
      'La date de debut doit preceder la date de fin.',
    );
  }

  if (!start && !end) {
    return undefined;
  }

  return {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {}),
  };
}
