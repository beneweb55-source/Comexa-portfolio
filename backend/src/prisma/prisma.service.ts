import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { isTrainingScope } from '../common/training/training-scope.js';

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
 * ---------------------------------------------------------------------------
 * ROUTAGE « FORMATION / PRODUCTION »
 * ---------------------------------------------------------------------------
 * La MÊME instance est le point d'acces des deux environnements. En requete de
 * formation (scope marque par le garde d'authentification, voir
 * `common/training/training-scope.ts`), chaque delegate de modele rend le
 * client de la base d'entrainement ; sinon, le client de production, qui est
 * l'instance elle-meme (`super()` ci-dessous).
 *
 * C'est la garantie « les ecritures de formation n'atteignent jamais la
 * production » : elle ne repose sur aucune discipline d'appelant. Un service
 * oublie, un developpeur distrait, un script qui reutilise un service metier —
 * tous ecrivent dans la base que le SCOPE choisit, jamais ailleurs. Les deux
 * bases sont deux bases PostgreSQL DISTINCTES (`DATABASE_URL` et
 * `TRAINING_DATABASE_URL`) : meme une requete SQL brute mal concue reste dans
 * son environnement.
 *
 * Les exceptions sont nommees et justifiees (MODELS_TOUJOURS_PRODUCTION) :
 * l'identite (jetons de session, jetons d'integration) et l'etat pedagogique
 * (sessions de formation, progression) sont des donnees REELLES, pas des donnees
 * d'exercice — ils restent en production meme pendant une session de formation.
 */

/** Chiffres de connexion : la base de production est l'instance elle-meme. */
function trainingConnectionString(): string | null {
  const url = process.env.TRAINING_DATABASE_URL;
  return url && url.trim().length > 0 ? url : null;
}

/**
 * Delegates de modeles TOUJOURS servis par la base de production.
 *
 *  - `refreshToken`, `emailVerificationToken`, `passwordResetToken`,
 *    `integrationToken` : l'identite et les sessions reelles. Un jeton de
 *    formation ne doit pas trouver ses secrets dans une base fictive, et un
 *    compte reel ne doit pas etre modifie par un exercice.
 *  - `trainingSession`, `trainingMissionProgress`, `trainingAttempt` : l'etat
 *    pedagogique est une donnee reelle de l'utilisateur (sa progression), il
 *    vit en production comme le reste de son compte. Un reset de l'environnement
 *    de formation ne reinitialise JAMAIS la progression enregistree.
 */
const MODELS_TOUJOURS_PRODUCTION: ReadonlySet<string> = new Set([
  'refreshToken',
  'emailVerificationToken',
  'passwordResetToken',
  'integrationToken',
  'trainingSession',
  'trainingMissionProgress',
  'trainingAttempt',
]);

/** Noms de delegates de modeles (camelCase) derives du client genere. */
export const MODEL_DELEGATE_NAMES: readonly string[] = Object.values(Prisma.ModelName).map(
  (name) => name.charAt(0).toLowerCase() + name.slice(1),
);

/** Methodes « $ » du client qui doivent suivre le scope. */
const ROUTED_DOLLAR_METHODS = [
  '$transaction',
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
] as const;

/**
 * Ce delegate doit-il etre servi par le client d'entrainement ? PURE, testee
 * a l'unite — et le BRANCHEMENT qui l'utilise est teste lui aussi (voir
 * tests/prisma-routing.spec.ts : les getters installes sur l'instance).
 *
 * RETOURNE UN BOOLEEN, volontairement. Une version precedente renvoyait les
 * chaines 'production' | 'training', et le getter ecrivait
 * `clientForModel(...) ? clientFormation : original` : la chaine 'production'
 * etant truthy, TOUT partait en formation, production comprise — jusqu'a la
 * connexion elle-meme (2026-10-21). Un booleen dans un ternaire ne peut pas
 * mentir ; une chaine, si.
 *
 * `isTraining` vient UNIQUEMENT du scope serveur (jeton de formation signé).
 * La disponibilite du client d'entrainement n'est PAS consultee ici : quand le
 * scope dit « formation », l'appelant doit obtenir le client d'entrainement —
 * et s'il n'existe pas (TRAINING_DATABASE_URL absente), c'est une ERREUR
 * explicite, jamais un repli silencieux vers la production. Un repli serait
 * exactement la fuite que ce mecanisme existe pour empecher.
 */
export function useTrainingClient(model: string, isTraining: boolean): boolean {
  return isTraining && !MODELS_TOUJOURS_PRODUCTION.has(model);
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** Client de la base d'entrainement, cree a la premiere demande. */
  private trainingClientInstance: PrismaClient | null = null;
  private trainingConnectAttempted = false;

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

    this.installTrainingRouting();
  }

  /**
   * Installe les getters de routage sur CETTE instance.
   *
   * Chaque delegate de modele est capture une fois (il est stable : Prisma le
   * construit a la demande, puis le memorise), puis remplace par un accesseur
   * qui choisit le client selon le scope. Les methodes `$transaction` et
   * consors suivent la meme regle ; pour `$transaction`, le callback recoit un
   * `tx` PROXYE qui applique les memes regles aux modeles qu'il manipule —
   * sans quoi une transaction lancee en formation ecrirait ses modeles
   * « toujours production » dans la base fictive, par le tx nu.
   */
  private installTrainingRouting(): void {
    const originals = new Map<string, unknown>();
    for (const name of [...MODEL_DELEGATE_NAMES, ...ROUTED_DOLLAR_METHODS]) {
      originals.set(name, (this as unknown as Record<string, unknown>)[name]);
    }

    for (const name of MODEL_DELEGATE_NAMES) {
      const original = originals.get(name);
      Object.defineProperty(this, name, {
        configurable: true,
        get: () => {
          // `this.trainingClient` n'est evalue QUE si le scope est formation
          // (le ternaire evalue sa condition en premier) : en production,
          // l'absence de TRAINING_DATABASE_URL ne gene personne. En scope de
          // formation, `this.trainingClient` LEVE une erreur nette : mieux
          // vaut cela qu'une ecriture silencieusement envoyee en production.
          return useTrainingClient(name, isTrainingScope())
            ? (this.trainingClient as unknown as Record<string, unknown>)[name]
            : original;
        },
      });
    }

    const prodTransaction = originals.get('$transaction') as (...args: unknown[]) => unknown;
    Object.defineProperty(this, '$transaction', {
      configurable: true,
      value: (...args: unknown[]) => {
        const useTraining = isTrainingScope();
        const target = useTraining ? (this.trainingClient as unknown as Record<string, unknown>) : this;
        const fn = args[0];
        if (useTraining && typeof fn === 'function') {
          const wrapped = (tx: unknown) =>
            (fn as (t: unknown) => unknown)(this.wrapTransactionClient(tx));
          return prodTransaction.apply(target, [wrapped, ...args.slice(1)]);
        }
        return prodTransaction.apply(target, args);
      },
    });

    for (const method of ROUTED_DOLLAR_METHODS) {
      if (method === '$transaction') continue;
      const original = originals.get(method) as (...args: unknown[]) => unknown;
      Object.defineProperty(this, method, {
        configurable: true,
        value: (...args: unknown[]) => {
          const useTraining = isTrainingScope();
          const target = useTraining ? (this.trainingClient as unknown as Record<string, unknown>) : this;
          return original.apply(target, args);
        },
      });
    }
  }

  /**
   * Proxy d'un client de transaction : les modeles « toujours production »
   * sortent du tx et interrogent le client de production (requete separee, hors
   * transaction — l'etat pedagogique n'a pas besoin d'atomicite croisee, et
   * deux bases ne partagent de toute facon aucune transaction).
   */
  private wrapTransactionClient(tx: unknown): unknown {
    return new Proxy(tx as object, {
      get: (target, prop: string) => {
        if (MODEL_DELEGATE_NAMES.includes(prop) && MODELS_TOUJOURS_PRODUCTION.has(prop)) {
          return (this as unknown as Record<string, unknown>)[prop];
        }
        return Reflect.get(target, prop);
      },
    });
  }

  /** `TRAINING_DATABASE_URL` est-elle renseignee ? */
  isTrainingConfigured(): boolean {
    return trainingConnectionString() !== null;
  }

  /**
   * Client de la base d'entrainement (creation paresseuse).
   *
   * Leve une erreur explicite si `TRAINING_DATABASE_URL` est absente : la
   * formation est une fonctionnalite optionnelle, mais quand on l'utilise, la
   * cible doit etre nommee — un repli silencieux vers la base de production
   * est exactement la panne que ce systeme existe pour empecher.
   */
  get trainingClient(): PrismaClient {
    if (!this.trainingClientInstance) {
      const url = trainingConnectionString();
      if (!url) {
        throw new Error(
          'TRAINING_DATABASE_URL est absente : impossible d\'ouvrir la base d\'entrainement. ' +
            'Renseigner la chaine de connexion de la base de formation dans backend/.env ' +
            '(voir docs/FORMATION.md). La production reste accessible normalement.',
        );
      }
      this.trainingClientInstance = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    }
    return this.trainingClientInstance;
  }

  /** Alias nomme pour les lectures volontairement hors scope (identite, progression). */
  get prodClient(): PrismaClient {
    return this;
  }

  /** Le client d'entrainement s'il est deja cree (tests, diagnostics). */
  get trainingClientOrNull(): PrismaClient | null {
    return this.trainingClientInstance;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connexion a PostgreSQL etablie');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    if (this.trainingClientInstance) {
      await this.trainingClientInstance.$disconnect();
      this.trainingClientInstance = null;
    }
  }

  /** Ouvre la connexion d'entrainement (amorcage, reset, verifications). */
  async connectTraining(): Promise<PrismaClient> {
    const client = this.trainingClient;
    if (!this.trainingConnectAttempted) {
      this.trainingConnectAttempted = true;
      await client.$connect();
      this.logger.log('Connexion a la base d\'entrainement etablie');
    }
    return client;
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
