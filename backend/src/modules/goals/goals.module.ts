import { Module } from '@nestjs/common';
import { GoalsController } from './goals.controller.js';
import { GoalsService } from './goals.service.js';

/**
 * MODULE OBJECTIFS PERSONNELS.
 *
 * Il ne depend que de Prisma et de l'audit (globaux) et des REGLES PURES des
 * taches (`mineTaskWhere`) : le perimetre « mes taches » est ecrit une fois,
 * dans `task-rules.ts`, et partage tel quel.
 */
@Module({
  controllers: [GoalsController],
  providers: [GoalsService],
})
export class GoalsModule {}
