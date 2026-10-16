/**
 * `dotenv/config` EN PREMIER, ET CE N'EST PAS UN DOUBLON DE `ConfigModule`.
 *
 * `ConfigModule.forRoot({ envFilePath: ['.env'] })` charge le `.env` quand le
 * module est INSTANCIE, c'est-a-dire a l'interieur de `NestFactory.create()`.
 * Or tout ce qui est ecrit dans un decorateur est evalue plus tot : au chargement
 * du fichier. Le cas concret est la passerelle temps reel —
 *
 *     @WebSocketGateway({ cors: { origin: socketCorsOrigins(process.env.CORS_ORIGIN) } })
 *
 * — dont les options sont FIGEES a cet instant. Avec un `.env` seul, elle lisait
 * `undefined`, soit aucune origine autorisee : le frontend n'aurait jamais pu
 * ouvrir de socket en developpement, et le symptome (une connexion refusee cote
 * navigateur) n'oriente pas vers une histoire d'ordre de chargement.
 *
 * `dotenv/config` s'execute donc avant `app.module.js`, dont l'evaluation
 * declenche les decorateurs. Les imports d'ESM sont evalues dans l'ordre ou ils
 * sont declares : cette ligne doit rester la premiere.
 *
 * Sans effet en production : l'image ne contient pas de `.env` (voir Dockerfile),
 * et `dotenv` ne remplace jamais une variable deja presente dans l'environnement.
 */
import 'dotenv/config';
import 'reflect-metadata';
import type { Server } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

/** Au-dela des 60 s d'inactivite usuelles des repartiteurs de charge. */
const KEEP_ALIVE_TIMEOUT_MS = 65_000;

/**
 * Demarrage du processus.
 *
 * Ce fichier ne contient QUE des decisions liees au processus : ouvrir un port,
 * arreter proprement, brancher le journal. Tout le reste — securite des en-tetes,
 * CORS, validation, filtre d'exceptions, enveloppe de reponse, documentation —
 * vit dans `app.setup.ts`, partage avec les tests e2e.
 *
 * La raison de ce decoupage : ce qui n'est pas dans `configureApp` n'est pas
 * teste. Tant que ces reglages etaient ici, un test demarrant `AppModule`
 * validait une application sans `ValidationPipe` ni `TransformInterceptor` —
 * c'est-a-dire pas celle qui tourne.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Les journaux de Nest passent tous par pino : un seul flux, structure.
  app.useLogger(app.get(Logger));

  // Ferme proprement la connexion PostgreSQL a l'arret (voir PrismaService).
  app.enableShutdownHooks();

  const { apiPrefix } = configureApp(app);

  // Connexions inactives : le serveur doit les garder PLUS longtemps que les
  // relais places devant lui (relais `/api` de Next, proxy de Render, ...).
  // Par defaut Node les ferme apres 5 s ; un relais qui reutilise la connexion
  // a cet instant recoit `ECONNRESET` et renvoie une 500 au navigateur
  // (constate sur `/api/me/spaces` et `/api/notifications/summary`). Render
  // recommande d'augmenter ces deux valeurs pour ce symptome precis.
  // `headersTimeout` doit rester superieur a `keepAliveTimeout`.
  const server = app.getHttpServer() as Server;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = KEEP_ALIVE_TIMEOUT_MS + 1_000;

  const port = app.get(ConfigService).get<number>('PORT') ?? 3001;
  await app.listen(port);

  app.get(Logger).log(`API Comexa a l'ecoute sur http://localhost:${port}/${apiPrefix}`);
}

void bootstrap();
