import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/**
 * MODULE DES RAPPORTS.
 *
 * Aucun import de module applicatif : `PrismaModule` et `AuditModule` sont
 * declares `@Global()`, et ce module ne depend d'aucun autre domaine metier —
 * il lit leurs TABLES via `PrismaService`, jamais leurs services. C'est ce qui
 * lui permet de compiler et de fonctionner alors que les modules prospects,
 * projets, devis, factures et documents sont ecrits en parallele.
 *
 * A monter dans `app.module.ts`, qui n'appartient pas a ce module.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
