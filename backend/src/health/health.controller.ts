import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

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
  @ApiOperation({ summary: "Etat du service et de sa base de donnees" })
  async check(): Promise<{
    status: string;
    database: string;
    uptimeSeconds: number;
    timestamp: string;
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
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
