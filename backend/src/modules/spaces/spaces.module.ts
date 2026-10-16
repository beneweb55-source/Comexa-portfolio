import { Module } from '@nestjs/common';
import { SpacesController } from './spaces.controller.js';

/**
 * Espaces de travail (personnel, équipe, Comexa Space).
 *
 * La restriction elle-même est appliquée par `JwtAuthGuard` (voir
 * `common/spaces/space-policy.ts`) ; ce module n'expose que la lecture des
 * espaces accessibles, sans état ni table.
 */
@Module({
  controllers: [SpacesController],
})
export class SpacesModule {}
