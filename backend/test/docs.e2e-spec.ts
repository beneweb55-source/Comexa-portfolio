// DOIT rester la premiere ligne : les decorateurs de Nest sont evalues au
// chargement des modules, et ils ont besoin de `Reflect.metadata` deja installe.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject, OperationObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

/**
 * LA DOCUMENTATION OPENAPI CONTRE L'API REELLE.
 *
 * -----------------------------------------------------------------------------
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI `public.decorator.spec.ts` NE SUFFIT
 * PAS
 * -----------------------------------------------------------------------------
 * `src/common/decorators/public.decorator.spec.ts` verifie la MECANIQUE du
 * decorateur : ordre d'application, fusion des metadonnees, sens du
 * `security: []` pour Swagger. Il construit pour cela son PROPRE `DocumentBuilder`,
 * avec un controleur de trois routes.
 *
 * Ce test-la ne peut pas voir une propriete qui n'existe qu'ici : que
 * `configureApp` applique REELLEMENT l'exigence globale. Retirer la ligne
 *
 *     .addSecurityRequirements('access-token')
 *
 * de `app.setup.ts` laisse `public.decorator.spec.ts` integralement au vert — il
 * a sa propre copie de la ligne — pendant que les routes protegees de l'API
 * reelle redeviennent des operations « sans securite declaree », que Swagger UI
 * presente sans cadenas et que le bouton « Authorize » n'arme plus.
 *
 * C'est la meme lecon que partout ailleurs dans ce depot : un test qui
 * reconstruit la configuration teste sa propre reconstruction. Ce fichier
 * interroge donc l'objet que `configureApp` renvoie, c'est-a-dire celui-la meme
 * que `main.ts` sert sur `/api/docs`.
 *
 * -----------------------------------------------------------------------------
 * LES QUATRE INVARIANTS, ET CE QU'ILS EMPECHENT
 * -----------------------------------------------------------------------------
 *  1. LE NOMBRE DE ROUTES PUBLIQUES DOCUMENTEES EGALE LE NOMBRE DE `@Public()`
 *     ECRITS DANS LE CODE. C'est le seul controle de ce fichier qui croise deux
 *     sources independantes — le balayage des sources et le document genere.
 *     Il attrape dans les deux sens :
 *       - le decorateur cesse de poser `security: []` : le document tombe a 0,
 *         le code reste a 17 ;
 *       - une route est rendue publique par un autre chemin que le decorateur
 *         (un `SetMetadata` ecrit a la main, un decorateur d'un autre paquet) :
 *         elle apparaitra dans le document sans apparaitre dans le balayage.
 *
 *  2. AUCUNE OPERATION SANS RESUME. Un resume vide n'est pas une erreur de
 *     compilation : c'est une case vide dans Swagger UI, et personne ne s'en
 *     apercoit avant d'avoir besoin de la documentation. Le defaut a une cause
 *     connue et discrete — `ApiOperation` injecte un `summary: ''` par defaut —
 *     et ce test est la garantie qu'il ne revient pas par une autre porte.
 *
 *  3. L'EXIGENCE GLOBALE EST POSEE, ET SEULEMENT ELLE. Une operation qui
 *     declarerait son propre `security` pourrait diverger du garde reel :
 *     `JwtAuthGuard` ne lit pas la documentation. Seules deux valeurs sont donc
 *     tolerees — heriter du global, ou `[]` pour les routes publiques.
 *
 *  4. LE BALAYAGE TROUVE REELLEMENT QUELQUE CHOSE. Les invariants precedents se
 *     comparent a un compteur ; si ce compteur valait zero par accident, le test
 *     « autant de routes publiques » comparerait 0 a 0 et passerait au vert sans
 *     rien verifier. Les deux tests de la derniere section l'excluent.
 *
 * -----------------------------------------------------------------------------
 * DEPENDANCE ASSUMEE : UNE BASE JOIGNABLE
 * -----------------------------------------------------------------------------
 * Comme les huit autres fichiers de `test/`, ce test demarre le vrai `AppModule`,
 * et `PrismaService.onModuleInit` ouvre une connexion. Aucune ecriture n'est
 * faite et aucune donnee n'est lue : la connexion est le prix de l'assemblage
 * reel, et il est paye une fois.
 */

/** Doit rester la valeur de `app.setup.ts` : c'est le nom du schema declare. */
const SCHEMA_DE_SECURITE = 'access-token';

const RACINE_SRC = resolve(process.cwd(), 'src');
const RACINE_TEST = resolve(process.cwd(), 'test');

/**
 * Compte les `@Public()` REELLEMENT APPLIQUES dans `src/`.
 *
 * Le motif ancre le `@` en debut de ligne (`^`) et exige `()` : il ne compte donc
 * ni les mentions en commentaire — et il y en a, jusque dans ce depot, pour
 * expliquer une route qui aurait pu l'etre — ni un `Public` employe comme nom. Un
 * compteur de commentaires ferait echouer ce test pour une raison qui n'a rien a
 * voir avec la securite, et un test qui echoue pour de mauvaises raisons finit
 * par etre desactive.
 */
function compterPublicDansLesSources(): number {
  const motif = /^\s*@Public\(\)/gm;
  let total = 0;

  const parcourir = (dossier: string): void => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, entree.name);

      if (entree.isDirectory()) {
        parcourir(chemin);
        continue;
      }

      // Les fichiers de test contiennent leur PROPRE route publique — celle de
      // `public.decorator.spec.ts` (`SondeController`) en pose meme deux, dont une
      // avec un decorateur naif. Les compter ici ajouterait des routes qui ne sont
      // pas dans l'API servie.
      if (!entree.name.endsWith('.ts') || entree.name.endsWith('.spec.ts')) continue;

      const source = readFileSync(chemin, 'utf8');
      total += source.match(motif)?.length ?? 0;
    }
  };

  parcourir(RACINE_SRC);
  return total;
}

const METHODES_HTTP = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface Operation {
  readonly chemin: string;
  readonly methode: string;
  readonly operation: OperationObject;
}

function listerOperations(document: OpenAPIObject): Operation[] {
  const operations: Operation[] = [];

  for (const [chemin, item] of Object.entries(document.paths ?? {})) {
    for (const [methode, operation] of Object.entries(item)) {
      if (!(METHODES_HTTP as readonly string[]).includes(methode)) continue;
      operations.push({ chemin, methode, operation: operation as OperationObject });
    }
  }

  return operations;
}

/** Vrai si l'operation se declare publiquement (`security: []`), au sens OpenAPI. */
function estPublique(operation: OperationObject): boolean {
  return Array.isArray(operation.security) && operation.security.length === 0;
}

describe('Documentation OpenAPI servie', () => {
  let app: INestApplication;
  let document: OpenAPIObject | undefined;

  before(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    const setup = configureApp(app);
    await app.init();

    document = setup.document;
  });

  after(async () => {
    await app?.close();
  });

  it('est generee hors production, et absente en production', () => {
    // Ce test echouerait si la suite tournait avec NODE_ENV=production : c'est
    // voulu. Un document expose en production est un plan detaille de l'API, et
    // ce depot a choisi de ne pas le publier (voir app.setup.ts).
    assert.ok(
      document,
      "`configureApp` n'a pas retourne de document. Si NODE_ENV vaut 'production', " +
        "c'est le comportement attendu et cette suite ne doit pas tourner ainsi.",
    );
  });

  it("declare l'exigence de securite globale", () => {
    assert.ok(document);
    assert.deepEqual(
      document.security,
      [{ [SCHEMA_DE_SECURITE]: [] }],
      'Sans exigence globale, les routes protegees seraient decrites comme ouvertes : ' +
        "le bouton « Authorize » de Swagger UI n'armerait plus rien, et chaque appel " +
        'partirait en 401.',
    );
  });

  it('documente exactement autant de routes publiques que le code en declare', () => {
    assert.ok(document);

    const documentees = listerOperations(document).filter((o) => estPublique(o.operation));
    const declarees = compterPublicDansLesSources();

    assert.equal(
      documentees.length,
      declarees,
      `Le code applique ${declarees} fois \`@Public()\`, mais le document n'en declare ` +
        `${documentees.length}. Les deux listes doivent coincider : sinon la documentation ` +
        "decrit une API qui n'est pas celle qui tourne.\n" +
        'Documentees : ' +
        documentees.map((o) => `${o.methode.toUpperCase()} ${o.chemin}`).join(', '),
    );
  });

  it("n'exige la securite que de deux facons : heriter du global, ou aucune", () => {
    assert.ok(document);

    const inattendues = listerOperations(document).filter(
      (o) => o.operation.security !== undefined && !estPublique(o.operation),
    );

    assert.deepEqual(
      inattendues.map((o) => `${o.methode.toUpperCase()} ${o.chemin}`),
      [],
      'Une operation qui declare son propre `security` peut diverger du garde reel : ' +
        '`JwtAuthGuard` ne lit pas la documentation. Seules deux valeurs sont admises — ' +
        'heriter du global (ne rien declarer), ou `[]` pour une route `@Public()`.',
    );
  });

  it('donne un resume a chaque operation', () => {
    assert.ok(document);

    const sansResume = listerOperations(document)
      .filter((o) => !o.operation.summary)
      .map((o) => `${o.methode.toUpperCase()} ${o.chemin}`);

    assert.deepEqual(
      sansResume,
      [],
      "Une case vide dans Swagger UI. La cause la plus frequente est un `summary: ''` " +
        'injecte par `ApiOperation` depuis un decorateur applique en dernier — ' +
        'typiquement un decorateur compose qui oublie de passer `summary: undefined`.',
    );
  });
});

/**
 * Garde-fou du garde-fou.
 *
 * Les assertions ci-dessus ne valent que si le balayage des sources voit
 * reellement quelque chose. Un motif qui ne matche plus — `@Public ()`, un
 * import renomme, un chemin de recherche faux apres un deplacement de `src/` —
 * rendrait le test « autant de routes publiques » VRAI en comparant 0 a 0, et le
 * fichier passerait au vert en ne verifiant plus rien.
 */
describe('Balayage des sources', () => {
  it('trouve les routes publiques du depot', () => {
    assert.ok(
      compterPublicDansLesSources() > 0,
      'Aucun `@Public()` trouve sous ' +
        RACINE_SRC +
        '. Soit le motif ne correspond plus, soit le chemin est faux : dans les deux ' +
        'cas le test de comptage ne compare que des zeros et ne verifie rien.',
    );
  });

  it('lit bien les sources du projet', () => {
    assert.ok(
      readdirSync(RACINE_TEST).length > 0,
      `Le dossier ${RACINE_TEST} est vide : le test tourne depuis un repertoire inattendu.`,
    );
  });
});
