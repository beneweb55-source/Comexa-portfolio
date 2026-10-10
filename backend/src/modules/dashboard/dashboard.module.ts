import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

/**
 * MODULE DU TABLEAU DE BORD.
 *
 * Aucun import de module applicatif : `PrismaModule` et `AuditModule` sont
 * declares `@Global()`. Le tableau de bord lit les tables des autres domaines
 * directement, jamais leurs services : c'est ce qui le rend INDEPENDANT de leur
 * montage, et ce qui lui permet de renvoyer des zeros plutot qu'une erreur sur
 * une base vide. Ce n'est donc pas une etape restante, c'est la propriete qui a
 * ete recherchee.
 *
 * Il est monte dans `app.module.ts`. Ce bloc a ecrit « a monter », comme si le
 * montage restait a faire ; la phrase est corrigee.
 */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
