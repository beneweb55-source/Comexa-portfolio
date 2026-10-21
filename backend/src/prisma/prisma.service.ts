import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Point d'acces unique a la base de donnees.
 *
 * Prisma 7 a retire le moteur Rust : le client ne se connecte plus tout seul,
 * il lui faut un DRIVER ADAPTER. On lui passe donc `PrismaPg`, qui s'appuie sur
 * `pg` et son pool de connexions. C'est aussi ce qui rend le pooler de Neon
 * utilisable tel quel.
 *
 * On etend `PrismaClient` pour que les services ecrivent `this.prisma.user`
 * plutot que `this.prisma.client.user` : un maillon de moins a oublier.
 *
 * Le cycle de vie est branche : `onModuleInit` ouvre la connexion, et
 * `onModuleDestroy` la ferme. Ce second point compte — `main.ts` active
 * `enableShutdownHooks()`, sans quoi le pool survivrait au processus et les
 * tests de bout en bout laisseraient des connexions ouvertes derriere eux.
 *
 * UNE SEULE BASE : l'application parle du travail REEL du membre et
 * n'a besoin d'aucune redirection.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Volontairement lu dans `process.env` et non via `ConfigService` :
    // `super()` doit recevoir l'adaptateur AVANT que l'injection ne soit
    // disponible. `ConfigModule.forRoot()` a deja charge le fichier .env quand
    // ce constructeur s'execute, donc la valeur est presente.
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        'DATABASE_URL est absente. Copier backend/.env.example en backend/.env ' +
          'et y renseigner la chaine de connexion PostgreSQL.',
      );
    }

    super({ adapter: new PrismaPg({ connectionString }) });
  }

  /**
   * Alias historique des lectures « hors scope ».
   *
   * Il ne designe plus qu'une seule base — la production.
   */
  get prodClient(): PrismaClient {
    return this;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connexion a PostgreSQL etablie');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Vrai si la base repond. Utilise par la sonde de sante : on interroge
   * reellement la base au lieu de supposer que la connexion tient.
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error(
        `Sonde de sante : la base ne repond pas — ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
