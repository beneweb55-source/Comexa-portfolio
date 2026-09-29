import { Module } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller.js';
import { AuditLogService } from './audit-log.service.js';

/**
 * JOURNAL D'AUDIT — LECTURE.
 *
 * CE MODULE NE CONTIENT PAS L'ECRITURE, et il ne faut pas la chercher ici.
 * L'ecriture vit dans `common/audit/audit.module.ts`, monte en GLOBAL dans
 * `app.module.ts`, pour que n'importe quel module metier puisse journaliser sans
 * importer quoi que ce soit. Ce module-ci ne sert qu'a exposer la consultation,
 * qui est une route comme une autre et n'a aucune raison d'etre globale.
 *
 * Le nom porte `audit-log` : deux classes `AuditModule` — celle de
 * `common/audit/` et celle-ci — se confondraient a l'import, et l'erreur ne se
 * verrait qu'a l'execution, sous la forme d'un service d'un autre module injecte
 * au mauvais endroit. `PrismaService` vient du module global `PrismaModule` : il
 * n'y a rien a importer.
 */
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
