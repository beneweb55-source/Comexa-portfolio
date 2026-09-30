// DOIT rester la premiere ligne : les decorateurs de Nest sont evalues au
// chargement des modules, et ils ont besoin de `Reflect.metadata` deja installe.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject, OperationObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { serializeOpenApi } from '../src/common/openapi/serialize-openapi.js';

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
 * LES CINQ INVARIANTS, ET CE QU'ILS EMPECHENT
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
 *  5. LE DOCUMENT COMMITTE EST CELUI QUE LE CODE PRODUIT. Le contrat du frontend
 *     vit dans `shared/api/openapi.json`, parce que `/api/docs` est ferme en
 *     production. Ce fichier est donc la seule description des DTO accessible a
 *     l'associe : s'il prend du retard, il ne devient pas seulement imprecis, il
 *     decrit une API qui n'existe plus — et rien dans le depot ne le signalerait.
 *     Le test compare le fichier a la sortie fraiche de `configureApp`,
 *     serialisee par la MEME fonction que le script d'export : les deux cotes ne
 *     peuvent donc pas diverger par une difference de mise en forme.
 *
 *     C'EST LE SEUL TEST DE CE FICHIER QUI REGARDE AILLEURS QUE DANS `src/`. Les
 *     quatre autres verifient une propriete interne du document ; celui-ci verifie
 *     qu'un ARTEFACT LIVRE lui correspond. Il echoue donc aussi lorsqu'un DTO
 *     change sans que `npm run openapi:export` ait ete relance — ce qui est
 *     exactement le moment ou l'associe integrerait un contrat perime.
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
 * Le document OpenAPI committe, a la racine du DEPOT — pas dans `backend/`.
 *
 * `process.cwd()` vaut `backend/` (meme convention que les deux constantes
 * ci-dessus) : le depot est donc son parent. Ce fichier est le contrat que lit le
 * frontend, puisque `configureApp` ne sert le document que hors production et que
 * `/api/docs` repond 404 sur le service deploye.
 */
const CHEMIN_DOCUMENT_COMMITTE = resolve(process.cwd(), '..', 'shared', 'api', 'openapi.json');

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

/** Les operations d'un document, indexees par « METHODE /chemin », en JSON. */
function signatures(document: OpenAPIObject): Map<string, string> {
  const index = new Map<string, string>();

  for (const [chemin, item] of Object.entries(document.paths ?? {})) {
    for (const [methode, operation] of Object.entries(item)) {
      if (!(METHODES_HTTP as readonly string[]).includes(methode)) continue;
      index.set(`${methode.toUpperCase()} ${chemin}`, JSON.stringify(operation));
    }
  }

  return index;
}

/** Les schemas de `components`, indexes par nom, en JSON. */
function schemasIndexes(document: OpenAPIObject): Map<string, string> {
  const schemas = document.components?.schemas ?? {};

  return new Map(Object.entries(schemas).map(([nom, schema]) => [nom, JSON.stringify(schema)]));
}

/** Une liste plafonnee a dix lignes, precedee de son compte. */
function listerAvecPlafond(titre: string, valeurs: string[]): string[] {
  return valeurs.length === 0
    ? []
    : [
        `  ${titre} : ${valeurs.length}`,
        ...valeurs.slice(0, 10).map((valeur) => `    ${valeur}`),
        ...(valeurs.length > 10 ? [`    ... et ${valeurs.length - 10} autre(s)`] : []),
      ];
}

/** Ajoutees, retirees et modifiees, entre deux index « nom -> JSON ». */
function comparerIndex(
  dansLeFichier: Map<string, string>,
  dansLeCode: Map<string, string>,
): { ajoutees: string[]; retirees: string[]; modifiees: string[] } {
  return {
    ajoutees: [...dansLeCode.keys()].filter((cle) => !dansLeFichier.has(cle)),
    retirees: [...dansLeFichier.keys()].filter((cle) => !dansLeCode.has(cle)),
    modifiees: [...dansLeCode.keys()].filter(
      (cle) => dansLeFichier.has(cle) && dansLeFichier.get(cle) !== dansLeCode.get(cle),
    ),
  };
}

/**
 * Les FEUILLES du document, indexees par pointeur JSON.
 *
 * Une feuille est une valeur scalaire (ou une longueur de tableau) : c'est le
 * seul niveau ou deux documents se comparent vraiment. Les objets intermediaires
 * ne sont que des chemins.
 */
function aplatir(valeur: unknown, chemin: string, index: Map<string, string>): void {
  if (valeur === null || typeof valeur !== 'object') {
    index.set(chemin, JSON.stringify(valeur));
    return;
  }

  if (Array.isArray(valeur)) {
    index.set(`${chemin}/longueur`, String(valeur.length));
    valeur.forEach((element, position) => aplatir(element, `${chemin}/${position}`, index));
    return;
  }

  for (const [cle, sousValeur] of Object.entries(valeur as Record<string, unknown>)) {
    aplatir(sousValeur, `${chemin}/${cle}`, index);
  }
}

/** Tout le document, aplati en « pointeur JSON -> valeur ». */
function feuilles(document: OpenAPIObject): Map<string, string> {
  const index = new Map<string, string>();
  aplatir(document, '', index);
  return index;
}

/** Vrai si aucun des deux index ne nomme quoi que ce soit. */
function rienDansLesIndex(
  operations: { ajoutees: string[]; retirees: string[]; modifiees: string[] },
  schemas: { ajoutees: string[]; retirees: string[]; modifiees: string[] },
): boolean {
  return [...Object.values(operations), ...Object.values(schemas)].every(
    (valeurs) => valeurs.length === 0,
  );
}

/**
 * Le premier pointeur JSON divergent, ou `null` si les documents sont identiques.
 *
 * C'est le filet des deux index ci-dessus : quand ils ne nomment rien, l'ecart
 * est ailleurs dans le document (`info.version`, `components.securitySchemes`,
 * un `format`...), et il faut tout de meme le nommer.
 */
function premierPointeurDifferent(committe: OpenAPIObject, frais: OpenAPIObject): string | null {
  const dansLeFichier = feuilles(committe);
  const dansLeCode = feuilles(frais);

  for (const [pointeur, valeur] of dansLeCode) {
    if (!dansLeFichier.has(pointeur)) return `${pointeur} (absent du fichier)`;
    if (dansLeFichier.get(pointeur) !== valeur) {
      return `${pointeur} — fichier : ${dansLeFichier.get(pointeur)}, code : ${valeur}`;
    }
  }

  for (const pointeur of dansLeFichier.keys()) {
    if (!dansLeCode.has(pointeur)) return `${pointeur} (present seulement dans le fichier)`;
  }

  return null;
}

/**
 * Compare deux documents et nomme ce qui a bouge — OPERATIONS ET SCHEMAS.
 *
 * Un `deepEqual` sur cet arbre ne dirait rien d'exploitable : le rapport
 * nommerait un objet, pas la route concernee, et il faudrait ouvrir un fichier de
 * 220 Ko pour apprendre qu'un DTO a change. Ici le message nomme les operations,
 * ce qui suffit a savoir quel controleur vient d'etre touche.
 *
 * LES SCHEMAS SONT COMPTES A PART, ET CE N'EST PAS UN DOUBLON. `signatures` ne
 * regarde que les operations ; or un corps de requete y est un simple `$ref`
 * vers un nom de schema — le contenu du DTO n'y apparait donc pas. Sans la
 * seconde lecture, la modification la plus banale du depot (« un champ ajoute a
 * un DTO ») produirait un message qui affiche « 165 operations » des deux cotes
 * et ne nomme RIEN : exactement le cas que cette fonction existe pour eclairer.
 *
 * ET UN FILET POUR TOUT LE RESTE. Ces deux index ne couvrent que `paths` et
 * `components.schemas` ; une derive ailleurs — `info.version`,
 * `components.securitySchemes` — fait bien echouer le test (qui compare le
 * fichier entier), mais un rapport qui ne nomme rien est un rapport qu'on
 * n'utilise pas. Quand aucun des deux index ne trouve d'ecart, le message cherche
 * donc la premiere FEUILLE divergente et l'affiche par son pointeur JSON.
 */
function decrireEcart(committe: OpenAPIObject, frais: OpenAPIObject): string {
  const operationsDuFichier = signatures(committe);
  const operationsDuCode = signatures(frais);
  const schemasDuFichier = schemasIndexes(committe);
  const schemasDuCode = schemasIndexes(frais);

  const operations = comparerIndex(operationsDuFichier, operationsDuCode);
  const schemas = comparerIndex(schemasDuFichier, schemasDuCode);

  return [
    `  fichier  : ${operationsDuFichier.size} operations, ${schemasDuFichier.size} schemas`,
    `  code     : ${operationsDuCode.size} operations, ${schemasDuCode.size} schemas`,
    ...listerAvecPlafond(
      'operations presentes dans le code seulement (a documenter)',
      operations.ajoutees,
    ),
    ...listerAvecPlafond(
      'operations presentes dans le fichier seulement (a retirer)',
      operations.retirees,
    ),
    ...listerAvecPlafond(
      'operations presentes des deux cotes, mais differentes',
      operations.modifiees,
    ),
    ...listerAvecPlafond(
      'schemas presents dans le code seulement (a documenter)',
      schemas.ajoutees,
    ),
    ...listerAvecPlafond(
      'schemas presents dans le fichier seulement (a retirer)',
      schemas.retirees,
    ),
    ...listerAvecPlafond('schemas presents des deux cotes, mais differents', schemas.modifiees),
    ...(rienDansLesIndex(operations, schemas)
      ? [
          "  Aucune operation ni schema ne differe : l'ecart est ailleurs dans le document.",
          `  Premier pointeur different : ${premierPointeurDifferent(committe, frais) ?? '(non identifie)'}`,
        ]
      : []),
    '',
    'Regenerer le document : npm run openapi:export',
  ].join('\n');
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

  it('est committe dans shared/api/openapi.json, et a jour', () => {
    assert.ok(document);

    assert.ok(
      existsSync(CHEMIN_DOCUMENT_COMMITTE),
      `Le document OpenAPI n'est pas dans le depot : ${CHEMIN_DOCUMENT_COMMITTE} est ` +
        "absent. Le frontend lit ce fichier pour integrer l'API, puisque /api/docs est " +
        'ferme en production. Le generer : npm run openapi:export',
    );

    // `\r\n` -> `\n` AVANT DE COMPARER. La cause est traitee a la racine par le
    // `.gitattributes` de la racine du depot (`shared/api/openapi.json text
    // eol=lf`, sans quoi git pour Windows le restitue en CRLF et ce test echoue
    // sur un arbre propre). Cette normalisation est la ceinture : elle evite
    // qu'un fichier restitue autrement fasse echouer la suite pour une raison
    // qui n'a rien a voir avec l'API. Les fins de ligne ne portent aucune
    // information dans du JSON — les neutraliser ne retire rien a l'assertion.
    const contenu = readFileSync(CHEMIN_DOCUMENT_COMMITTE, 'utf8').replace(/\r\n/g, '\n');
    const attendu = serializeOpenApi(document);

    if (contenu === attendu) return;

    // Le fichier existe mais ne correspond pas. On essaie de le lire pour nommer
    // les operations en cause ; s'il est illisible, c'est en soi le diagnostic —
    // il ne peut pas venir de `npm run openapi:export`, qui ecrit du JSON.
    let committe: OpenAPIObject | null = null;

    try {
      committe = JSON.parse(contenu) as OpenAPIObject;
    } catch {
      committe = null;
    }

    assert.fail(
      `${CHEMIN_DOCUMENT_COMMITTE} a pris du retard sur le code.\n` +
        (committe === null
          ? "  Le fichier n'est pas du JSON lisible : il n'a pas ete produit par " +
            '`npm run openapi:export`, ou il a ete modifie a la main.'
          : decrireEcart(committe, document)),
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
