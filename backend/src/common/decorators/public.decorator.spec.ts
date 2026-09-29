// DOIT rester la premiere ligne : les decorateurs de Nest sont evalues au
// chargement des modules, et ils ont besoin de `Reflect.metadata` deja installe.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Controller, Get, Module, SetMetadata, applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
  type OperationObject,
} from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY, Public } from './public.decorator.js';

/**
 * `@Public()` CONTRE LE DOCUMENT OPENAPI QU'IL PRODUIT.
 *
 * -----------------------------------------------------------------------------
 * CE QUE CE FICHIER EMPECHE
 * -----------------------------------------------------------------------------
 * `app.setup.ts` declare une exigence de securite GLOBALE :
 * `addSecurityRequirements('access-token')`. C'est la description exacte du
 * montage — `JwtAuthGuard` est enregistre en `APP_GUARD`, donc toute route exige
 * un jeton sauf `@Public()`. Mais une exigence globale se paie d'un contresens :
 * les 17 routes publiques du depot seraient decrites comme protegees, et
 * Swagger UI afficherait un cadenas sur `GET /api/health`.
 *
 * La correction — `security: []` pose par `@Public()` lui-meme — a un cout : elle
 * ajoute au decorateur une seconde responsabilite, qui peut le casser de deux
 * facons opposees et MUETTES :
 *
 *   1. le `security: []` disparait (quelqu'un « simplifie » le decorateur en le
 *      remettant sur `SetMetadata` seul) : plus rien n'annule l'exigence globale,
 *      et la documentation redevient fausse pour les 17 routes. Aucun test
 *      d'execution ne le voit — le comportement HTTP est inchange ;
 *
 *   2. le `summary: undefined` disparait (il ressemble a un oubli). `ApiOperation`
 *      injecte alors son `summary: ''` par defaut, et comme les decorateurs de
 *      methode s'appliquent de BAS EN HAUT — `@Public()` est ecrit en premier,
 *      `@ApiOperation({ summary })` en dernier, donc le premier s'applique en
 *      DERNIER — ce `''` ecrase le resume de CHACUNE des 17 routes. Swagger UI
 *      affiche des titres vides, et la compilation comme les tests passent au
 *      vert.
 *
 * Le second cas est le plus dangereux, parce que la ligne fautive est justement
 * celle qui a l'air superflue. Le test `laisse le resume de la route intact`
 * echoue si on la retire, et le test suivant reproduit le defaut avec la variante
 * naive du decorateur : il demontre que le premier n'est pas complaisant.
 *
 * -----------------------------------------------------------------------------
 * POURQUOI UN MODULE MINIMAL, ET NON LE `AppModule`
 * -----------------------------------------------------------------------------
 * Ce fichier verifie la MECANIQUE du decorateur : ordre d'application des
 * decorateurs, fusion des metadonnees, et interpretation du `security: []` par
 * Swagger. Ces trois proprietes ne dependent d'aucun controleur reel.
 *
 * Les verifier sur le vrai `AppModule` aurait deux consequences : il faudrait une
 * base joignable pour un test qui n'en a aucun usage, et le fichier deviendrait un
 * test e2e de plus, exclu de `npm test` — donc jamais joue en pratique. Ce qui
 * releve de la surface REELLE de l'API se verifie contre le document effectivement
 * genere par `configureApp`.
 */

/**
 * Doit rester la valeur de `app.setup.ts`. Un renommage d'un cote seulement
 * rendrait le `security: []` inoperant — l'operation n'annulerait plus rien, et
 * le document resterait silencieusement faux.
 */
const SCHEMA_DE_SECURITE = 'access-token';

/**
 * La variante NAIVE du decorateur, ecrite ici pour prouver que le defaut est
 * reel. Elle n'est utilisee par aucun controleur de production : elle sert de
 * temoin negatif.
 *
 * C'est le refactor que ferait quelqu'un qui trouve `summary: undefined`
 * bizarre : `ApiOperation({ security: [] })`.
 */
const PublicSansSummaryUndefined = () =>
  applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), ApiOperation({ security: [] }));

@Controller('sonde')
class SondeController {
  /** Route ouverte, dans l'ordre d'ecriture du depot : `@Public()` en premier. */
  @Public()
  @Get('ouverte')
  @ApiOperation({ summary: 'Route ouverte' })
  ouverte(): string {
    return 'ok';
  }

  /** Temoin negatif : meme intention, decorateur naif (voir ci-dessus). */
  @PublicSansSummaryUndefined()
  @Get('naive')
  @ApiOperation({ summary: 'Route ouverte, decorateur naif' })
  naive(): string {
    return 'ok';
  }

  /** Route protegee : elle ne declare RIEN, et doit donc heriter de l'exigence globale. */
  @Get('protegee')
  @ApiOperation({ summary: 'Route protegee' })
  protegee(): string {
    return 'ok';
  }
}

@Module({ controllers: [SondeController] })
class SondeModule {}

async function construireDocument(): Promise<OpenAPIObject> {
  const moduleRef = await Test.createTestingModule({ imports: [SondeModule] }).compile();
  const app = moduleRef.createNestApplication();

  try {
    await app.init();

    const config = new DocumentBuilder()
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, SCHEMA_DE_SECURITE)
      .addSecurityRequirements(SCHEMA_DE_SECURITE)
      .build();

    return SwaggerModule.createDocument(app, config);
  } finally {
    await app.close();
  }
}

function operation(document: OpenAPIObject, chemin: string): OperationObject {
  const item = document.paths[chemin];
  assert.ok(item, `Le chemin ${chemin} est absent du document OpenAPI.`);

  const get = item.get;
  assert.ok(get, `Le chemin ${chemin} n'expose pas de GET.`);

  return get;
}

describe('@Public() et le document OpenAPI', () => {
  it("declare l'exigence de securite globale, sans quoi les routes protegees mentiraient", async () => {
    const document = await construireDocument();

    assert.deepEqual(
      document.security,
      [{ [SCHEMA_DE_SECURITE]: [] }],
      "L'exigence globale doit etre posee : c'est elle qui decrit le refus par defaut.",
    );
  });

  it('annule cette exigence sur une route publique, et SEULEMENT la-bas', async () => {
    const document = await construireDocument();

    assert.deepEqual(
      operation(document, '/sonde/ouverte').security,
      [],
      "Une route publique doit declarer `security: []` : c'est ce qui la distingue de " +
        "« non declaree », qui herite de l'exigence globale.",
    );

    assert.equal(
      operation(document, '/sonde/protegee').security,
      undefined,
      "Une route protegee ne doit RIEN declarer : elle herite de l'exigence globale. " +
        'Si elle declarait son propre `security`, elle pourrait diverger du garde reel.',
    );
  });

  it('laisse le resume de la route intact — le piege du `summary` par defaut', async () => {
    const document = await construireDocument();

    assert.equal(
      operation(document, '/sonde/ouverte').summary,
      'Route ouverte',
      'Le resume a ete ecrase. La cause est presque toujours la meme : ' +
        "`summary: undefined` a ete retire de `@Public()`, et le `summary: ''` que " +
        "`ApiOperation` injecte par defaut s'est applique en DERNIER (les decorateurs " +
        "de methode s'appliquent de bas en haut, et `@Public()` est ecrit en premier).",
    );

    assert.equal(
      operation(document, '/sonde/protegee').summary,
      'Route protegee',
      "Le resume d'une route protegee doit survivre aussi : le defaut ne depend pas " +
        'de `@Public()`, donc le voir disparaitre ici designe un autre probleme.',
    );
  });

  it('prouve que le piege du resume est reel, en le reproduisant avec la variante naive', async () => {
    const document = await construireDocument();

    // Temoin negatif des trois tests precedents. Sans lui, on ne saurait pas si
    // `laisse le resume de la route intact` passe parce que le decorateur est
    // correct, ou parce que l'assertion ne peut de toute facon jamais echouer.
    assert.equal(
      operation(document, '/sonde/naive').summary,
      '',
      "La variante naive devrait perdre son resume. Si elle le conserve, c'est que les " +
        'regles de fusion de `@nestjs/swagger` ont change : la protection de ' +
        "`@Public()` n'est peut-etre plus necessaire — mais il faut alors le VERIFIER, " +
        'pas le supposer, et adapter ce fichier en connaissance de cause.',
    );
  });

  it('reste un decorateur de securite : la metadonnee lue par le garde est posee', async () => {
    const document = await construireDocument();
    assert.ok(document, 'Le document doit se construire.');

    // La metadonnee est ce que lit `JwtAuthGuard` (`access.guards.ts`). Si
    // `@Public()` produisait un document juste mais cessait de la poser, le garde
    // refuserait la route publique — et la documentation decrirait une API qui
    // n'existe pas.
    assert.equal(
      Reflect.getMetadata(IS_PUBLIC_KEY, SondeController.prototype.ouverte),
      true,
      "`@Public()` doit poser la metadonnee que lit le garde d'authentification.",
    );

    assert.equal(
      Reflect.getMetadata(IS_PUBLIC_KEY, SondeController.prototype.protegee),
      undefined,
      "Une route protegee ne doit PAS porter la metadonnee : c'est ce qui declenche le refus.",
    );
  });
});
