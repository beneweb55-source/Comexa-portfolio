import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TRAINING_TOKEN_RESOLVER } from '../../common/auth/training-token.js';
import { TrainingController } from './training.controller.js';
import { TrainingService } from './training.service.js';
import { TrainingTokenService } from './training-token.service.js';

/**
 * MODULE DE FORMATION.
 *
 * `TrainingTokenService` réalise le contrat `TrainingTokenResolver` attendu par
 * `JwtAuthGuard` (injection optionnelle, comme les jetons d'intégration). Le
 * garde reconnaît alors les jetons `typ: training`, marque le scope de
 * formation de la requête, et le routeur Prisma bascule les écritures métier
 * vers la base d'entraînement.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [TrainingController],
  providers: [
    TrainingService,
    TrainingTokenService,
    { provide: TRAINING_TOKEN_RESOLVER, useExisting: TrainingTokenService },
  ],
  exports: [TrainingTokenService],
})
export class TrainingModule {}
