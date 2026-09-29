import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import type { Paginated } from '../../common/interceptors/transform.interceptor.js';
import { AuditLogService, type AuditLogView } from './audit-log.service.js';
import { ListAuditLogsQueryDto } from './dto/audit-log.dto.js';

/**
 * CONSULTATION DU JOURNAL D'AUDIT.
 *
 * UNE SEULE ROUTE, EN LECTURE SEULE. Le journal ne se modifie pas et ne se
 * supprime pas par l'API : une trace qu'on peut effacer n'est pas une trace.
 * La purge, quand elle deviendra necessaire pour la taille de la table, sera une
 * tache d'exploitation avec sa propre procedure — pas un `DELETE` accessible
 * avec un jeton d'administrateur, qui effacerait justement la preuve de ce que
 * l'administrateur a fait.
 *
 * Le nom du module et du fichier porte `audit-log` et non `audit` : `AuditModule`
 * et `AuditService` existent deja dans `common/audit/`, et deux classes du meme
 * nom dans deux fichiers differents se confondent a la premiere relecture — au
 * point qu'un import errone compilerait, pour appeler l'ecriture la ou on croit
 * lire.
 */
@ApiTags('Journal d\'audit')
@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly logs: AuditLogService) {}

  @Get()
  @RequirePermissions('audit:read:any')
  @ApiOperation({
    summary:
      "Consulter le journal (filtres : porteur, action, type et identifiant d'objet, periode).",
  })
  async list(
    @Query() query: ListAuditLogsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Paginated<AuditLogView>> {
    return this.logs.list(query, actor);
  }
}
