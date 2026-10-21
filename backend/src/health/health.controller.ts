import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { API_CONTRACT, type ApiContract } from './contract.js';
import { databaseTargetOf, type DatabaseTarget } from './database-target.js';

/**
 * Sonde de sante.
 *
 * Elle interroge REELLEMENT la base (`SELECT 1`). Une sonde qui se contente de
 * repondre « 200 » parce que le processus tourne ne dit rien d'utile : elle
 * annonce un service en bonne sante alors que la base est injoignable, ce qui
 * est exactement le cas ou l'on a besoin de le savoir.
 *
 * `@SkipThrottle()` : un controle de sante interroge frequemment ne doit pas
 * consommer le quota de requetes du client.
 */
@ApiTags('Sante')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  @ApiOperation({ summary: 'Etat du service et de sa base de donnees' })
  async check(): Promise<{
    status: string;
    database: string;
    /**
     * Famille d'hébergement de `DATABASE_URL` (`supabase` | `neon` | `autre`).
     * Diagnostic d'exploitation : « ce serveur interroge-t-il la base où je
     * vérifie mes comptes ? » — question qui n'avait aucune réponse le
     * 2026-10-21 et a coûté une matinée de faux diagnostics. La famille
     * suffit ; jamais le nom d'hôte ni l'URL sur un endpoint public.
     */
    databaseTarget: DatabaseTarget;
    /** `TRAINING_DATABASE_URL` est-elle renseignée sur CE serveur ? */
    trainingDatabaseConfigured: boolean;
    uptimeSeconds: number;
    timestamp: string;
    contract: ApiContract;
  }> {
    const databaseUp = await this.prisma.isHealthy();

    if (!databaseUp) {
      throw new ServiceUnavailableException(
        'La base de donnees est injoignable : le service ne peut pas traiter les requetes',
      );
    }

    return {
      status: 'ok',
      database: 'up',
      databaseTarget: databaseTargetOf(process.env.DATABASE_URL),
      trainingDatabaseConfigured: this.prisma.isTrainingConfigured(),
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      // Le bloc `contract` permet au frontend de detecter un backend PERIME
      // (build plus ancien que l'interface) et de le dire clairement, au lieu
      // de laisser des 404/400 silencieux seuls dans la console navigateur.
      contract: API_CONTRACT,
    };
  }
}
