import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Journal d'audit.
 *
 * Deux principes, et ils comptent plus que le code lui-meme :
 *
 * 1. UN ECHEC D'ECRITURE NE CASSE PAS L'OPERATION. Si le journal tombe, la
 *    connexion de l'utilisateur doit aboutir quand meme. On journalise l'erreur
 *    dans les logs applicatifs et on continue. L'inverse — faire echouer une
 *    connexion parce que la table d'audit est verrouillee — transformerait un
 *    probleme d'observabilite en panne de service.
 *
 * 2. `before` ET `after` SONT ECRITS PAR L'APPELANT, pas devines ici. Un
 *    service qui modifie un devis sait ce qui a change ; le deviner en relisant
 *    la ligne apres coup donnerait un `before` deja ecrase. C'est la seule
 *    facon d'avoir une piste exploitable.
 */

export interface AuditEntry {
  /** `null` quand l'action est anonyme (tentative de connexion sur un compte inexistant). */
  actorId: string | null;
  /** Verbe stable, en majuscules : `LOGIN_SUCCESS`, `PASSWORD_CHANGED`, ... */
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          // Prisma distingue `undefined` (« ne rien ecrire ») de `null`
          // (« ecrire explicitement null ») sur un champ Json. On normalise pour
          // que l'absence de valeur soit toujours le meme NULL en base.
          before: entry.before === undefined ? undefined : (entry.before as never),
          after: entry.after === undefined ? undefined : (entry.after as never),
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Ecriture du journal d'audit impossible (${entry.action} sur ${entry.entityType}) — ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
