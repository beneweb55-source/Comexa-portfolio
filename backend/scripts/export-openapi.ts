/**
 * EXPORT DU DOCUMENT OpenAPI VERS `shared/api/openapi.json`.
 *
 * -----------------------------------------------------------------------------
 * POURQUOI CE SCRIPT EXISTE
 * -----------------------------------------------------------------------------
 * `configureApp` ne construit le document que HORS PRODUCTION (voir
 * `src/app.setup.ts`) : `/api/docs` repond donc 404 sur le service deploye.
 * C'est une decision de securite assumee, et elle ne bouge pas — un plan
 * detaille de l'API, publie, aide surtout a la cartographier.
 *
 * Mais le frontend a besoin du contrat pour integrer l'API, et `shared/README.md`
 * promettait ce document « genere depuis le code et servi sur `/api/docs` ». Cette
 * phrase n'est vraie que sur la machine du developpeur : sur le service deploye,
 * elle envoie l'associe vers un 404. C'est la meme famille de defaut que les deux
 * ecarts trouves par `npm run smoke:prod` — une affirmation ecrite qui n'est
 * vraie que dans un environnement.
 *
 * La contradiction se resout par le bas, sans rouvrir l'endpoint : le document est
 * produit UNE fois, committe, et versionne avec le reste du depot. Rien n'est
 * expose, et le contrat devient consultable par quiconque clone le depot.
 *
 * -----------------------------------------------------------------------------
 * POURQUOI IL EST COMPILE AVANT D'ETRE EXECUTE
 * -----------------------------------------------------------------------------
 * `tsx` s'appuie sur esbuild, qui n'emet PAS la metadonnee `design:paramtypes`
 * malgre `emitDecoratorMetadata: true` (la mesure est ecrite en tete de
 * `tsconfig.e2e.json`). Or ce script demarre le VRAI `AppModule` : sous `tsx`,
 * Nest croirait chaque constructeur vide et l'application echouerait au
 * demarrage. D'ou `nest build -p tsconfig.export.json`, puis l'execution du
 * JavaScript compile — exactement la recette de `test:e2e`.
 *
 * `nest build` ET NON `tsc` : c'est le seul qui applique le plugin Swagger de
 * `nest-cli.json`, donc le seul dont la sortie donne le document que
 * `npm run start:dev` sert sur `/api/docs`. Ce plugin lit les decorateurs
 * class-validator et recopie leurs bornes dans le schema (`@MaxLength` ->
 * `maxLength`, `@Min` -> `minimum`, `@IsEmail` -> `format: email`), en plus de
 * resoudre le type reel des champs optionnels, la ou `tsc` ecrit `object`.
 *
 * Compile par `tsc`, ce script ecrirait donc un contrat PLUS PAUVRE que celui
 * que le serveur de developpement affiche : mesure, 463 feuilles en moins, 46
 * valeurs fausses — dont 45 types ecrits `object` — et 67 operations sur 165
 * concernees. Le detail est dans `docs/TESTING.md`.
 *
 * -----------------------------------------------------------------------------
 * CE QU'IL FAUT POUR LE LANCER, ET CE QU'IL FAUT SAVOIR
 * -----------------------------------------------------------------------------
 * `backend/.env` avec `DATABASE_URL` : le script demarre `AppModule`, donc
 * `PrismaService.onModuleInit` ouvre une connexion. AUCUNE ECRITURE et aucune
 * lecture de donnee metier — la connexion est le prix de l'assemblage reel,
 * comme pour les specs e2e.
 *
 * `NODE_ENV` NE DOIT PAS VALOIR `production`. C'est la condition meme qui fait
 * retourner `undefined` a `configureApp` : le script le detecte et refuse,
 * plutot que d'ecrire un fichier vide ou un `null`.
 *
 * LE DOCUMENT DEPEND DE `API_PREFIX`. Les chemins qu'il contient portent le
 * prefixe (`/api/...`), pris dans `.env` — par defaut `api`. Un prefixe
 * different produirait un contrat different, et `test/docs.e2e-spec.ts`
 * comparerait alors deux documents issus de deux configurations : c'est la
 * raison pour laquelle ce test se contente de lire `.env`, sans override.
 *
 * -----------------------------------------------------------------------------
 * USAGE
 * -----------------------------------------------------------------------------
 *     npm run openapi:export
 *     npm run openapi:export -- ../shared/api/openapi.json
 *
 * Le second argument est le chemin de sortie, resolu depuis `backend/`. Changer
 * de destination ne change RIEN pour `test/docs.e2e-spec.ts`, qui lit toujours
 * `shared/api/openapi.json` : ecrire ailleurs produit un document que personne
 * ne verifie.
 */
import 'dotenv/config';
import 'reflect-metadata';
import { existsSync, mkdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { serializeOpenApi } from '../src/common/openapi/serialize-openapi.js';

/** Destination par defaut : le contrat du frontend, a la racine du depot. */
const DESTINATION_PAR_DEFAUT = '../shared/api/openapi.json';

/** Les seules methodes comptees comme operations, comme dans `docs.e2e-spec.ts`. */
const METHODES_HTTP = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Nom attendu du paquet : sert a verifier que l'on tourne bien depuis `backend/`. */
const NOM_DU_PAQUET = '@comexa/backend';

/**
 * Ecrit le message d'echec et termine — EN ECRITURE SYNCHRONE.
 *
 * `writeSync(2, ...)` plutot que `process.stderr.write` : sur un tuyau, cette
 * derniere est asynchrone, et `process.exit(1)` juste apres peut la perdre. Le
 * diagnostic serait alors remplace par un silence, precisement dans le cas ou il
 * compte — une execution sous `node ... 2>&1 | tee`. Sur Windows l'ecriture de
 * tuyau est synchrone, donc le defaut ne s'y voit pas ; il apparait sur un
 * runner d'integration continue.
 */
function fail(message: string): never {
  writeSync(2, `ECHEC — ${message}\n`);
  process.exit(1);
}

/**
 * Verifie que le script tourne depuis `backend/`.
 *
 * Les chemins de sortie sont resolus depuis le repertoire courant, et le nom du
 * paquet est le seul controle qui distingue « lance depuis `backend/` » de
 * « lance depuis la racine du depot » — ou `../shared` designerait un dossier qui
 * n'existe pas. Un echec explicite vaut mieux qu'un fichier ecrit au hasard.
 */
function verifierRepertoireCourant(): void {
  const chemin = resolve(process.cwd(), 'package.json');

  if (!existsSync(chemin)) {
    fail(
      `aucun package.json dans ${process.cwd()}. Ce script se lance depuis backend/ ` +
        '(npm run openapi:export s en charge).',
    );
  }

  const { name } = JSON.parse(readFileSync(chemin, 'utf8')) as { name?: string };

  if (name !== NOM_DU_PAQUET) {
    fail(
      `le package.json de ${process.cwd()} declare « ${name ?? '(sans nom)'} » et non ` +
        `« ${NOM_DU_PAQUET} ». Lancez le script depuis backend/.`,
    );
  }
}

function compterOperations(document: { paths?: Record<string, unknown> }): number {
  let total = 0;

  for (const item of Object.values(document.paths ?? {})) {
    for (const methode of Object.keys(item as Record<string, unknown>)) {
      if ((METHODES_HTTP as readonly string[]).includes(methode)) total += 1;
    }
  }

  return total;
}

function ko(octets: number): string {
  return `${(octets / 1024).toFixed(1)} Ko`;
}

async function main(): Promise<void> {
  verifierRepertoireCourant();

  const destination = resolve(process.cwd(), process.argv[2] ?? DESTINATION_PAR_DEFAUT);

  // `logger: false` : ce script n'a rien a raconter en dehors de sa conclusion,
  // et les journaux de demarrage de Nest (une trentaine de lignes de montage de
  // modules) noieraient justement le compte rendu utile.
  const app = await NestFactory.create(AppModule, { logger: false });

  let document: ReturnType<typeof configureApp>['document'];
  let prefixe: string;

  try {
    const setup = configureApp(app);

    if (setup.isProduction) {
      fail(
        "NODE_ENV vaut 'production' dans l'environnement de ce script, et `configureApp` " +
          'ne construit alors AUCUN document : /api/docs est ferme en production, par ' +
          'decision. Retirez NODE_ENV=production de backend/.env, ou lancez : ' +
          'NODE_ENV=development npm run openapi:export',
      );
    }

    document = setup.document;
    prefixe = setup.apiPrefix;
  } finally {
    // Ferme la connexion PostgreSQL ouverte par `PrismaService.onModuleInit`.
    // Sans cela, le processus reste en vie apres l'ecriture du fichier.
    await app.close();
  }

  if (!document) {
    fail(
      'configureApp a retourne une application hors production SANS document. ' +
        "C'est une incoherence de `app.setup.ts` : le document doit etre construit dans " +
        'exactement ce cas la.',
    );
  }

  const contenu = serializeOpenApi(document);

  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contenu, 'utf8');

  const chemins = Object.keys(document.paths ?? {}).length;
  const operations = compterOperations(document);
  const octets = Buffer.byteLength(contenu, 'utf8');

  process.stdout.write(
    [
      'Document OpenAPI ecrit.',
      `  chemin   : ${relative(process.cwd(), destination).split('\\').join('/')}`,
      `  prefixe  : /${prefixe}`,
      `  chemins  : ${chemins}`,
      `  routes   : ${operations}`,
      `  taille   : ${ko(octets)} (${octets} octets)`,
      '',
      'Ce fichier est committe : `test/docs.e2e-spec.ts` le compare au document',
      "reellement genere par `configureApp`, et echoue s'il a pris du retard sur le code.",
      '',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
