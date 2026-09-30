import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import {
  credentialsMatch,
  docsBasicAuth,
  docsBasePath,
  isProtectedDocsPath,
  parseBasicAuthorization,
} from './docs-access.js';

/**
 * SPECS DE `docs-access.ts`.
 *
 * Ce fichier protege la documentation OpenAPI quand `DOCS_ENABLED=true` en
 * production. Deux defauts y seraient graves, et chacun a ses tests dedies :
 *
 *  1. LAISSER PASSER UNE ROUTE NON PROTEGEE. Deux pieges de routage, tous deux
 *     verifies ici : les chemins `-json` et `-yaml` sont des FRERES de
 *     `/api/docs` et non des enfants, et Express compare les chemins SANS tenir
 *     compte de la casse. Le premier oublie publierait le document brut ;
 *     le second laisserait une requete `/API/DOCS` atteindre la page reelle.
 *  2. PROTEGER UNE ROUTE QUI N'EST PAS A NOUS. `/api/documents` commence par le
 *     meme texte que `/api/docs` sans etre de la documentation. Le proteger
 *     casserait une vraie fonctionnalite de l'API.
 *
 * Aucune base de donnees, aucun serveur : ces fonctions ne lisent qu'un chemin et
 * un en-tete.
 */

/** Le prefixe par defaut, pour ne pas le repeter dans chaque cas. */
const PREFIX = 'api';

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

describe('docsBasePath', () => {
  it('suit le prefixe global plutot que de le supposer', () => {
    assert.equal(docsBasePath('api'), '/api/docs');
    assert.equal(docsBasePath('v1'), '/v1/docs');
  });
});

describe('isProtectedDocsPath', () => {
  it("protege l'interface et ses sous-chemins", () => {
    for (const path of [
      '/api/docs',
      '/api/docs/',
      '/api/docs/index.html',
      '/api/docs/swagger-ui-init.js',
      '/api/docs/swagger-ui-bundle.js',
    ]) {
      assert.equal(isProtectedDocsPath(path, PREFIX), true, `${path} devrait etre protege`);
    }
  });

  it('protege les documents bruts, qui sont des FRERES et non des enfants', () => {
    // LE PIEGE PRINCIPAL DE CE FICHIER. `/api/docs-json` ne commence pas par
    // `/api/docs/` : un controle ecrit autour d'une barre oblique le laisserait
    // passer, et le plan complet de l'API serait lisible sans mot de passe
    // pendant que l'interface, elle, en demanderait un.
    for (const path of ['/api/docs-json', '/api/docs-yaml', '/api/docs-json5']) {
      assert.equal(isProtectedDocsPath(path, PREFIX), true, `${path} devrait etre protege`);
    }
  });

  it("ignore la casse, parce qu'Express aussi l'ignore", () => {
    // Express est configure avec `case sensitive routing` desactive : `/API/DOCS`
    // atteint reellement le gestionnaire de `/api/docs`. Un controle sensible a
    // la casse serait donc contourne par une simple majuscule, et c'est ce
    // contournement que ce test interdit.
    for (const path of ['/API/DOCS', '/Api/Docs', '/api/DOCS-JSON', '/api/Docs-Yaml']) {
      assert.equal(isProtectedDocsPath(path, PREFIX), true, `${path} devrait etre protege`);
    }
  });

  it("NE protege PAS `/api/documents`, qui n'est pas de la documentation", () => {
    // `documents` partage le prefixe textuel `docs` mais n'est pas la
    // documentation. Le proteger casserait une vraie route de l'API — c'est le
    // faux positif que la regle du tiret / barre oblique evite.
    for (const path of [
      '/api/documents',
      '/api/documents/42',
      '/api/documentation',
      '/api/docsomething',
    ]) {
      assert.equal(isProtectedDocsPath(path, PREFIX), false, `${path} ne devrait pas etre protege`);
    }
  });

  it("laisse passer le reste de l'API et le site", () => {
    for (const path of ['/', '/api', '/api/health', '/api/auth/login', '/apidocs', '/api/do']) {
      assert.equal(isProtectedDocsPath(path, PREFIX), false, `${path} ne devrait pas etre protege`);
    }
  });

  it('suit le prefixe global dans ses deux positions', () => {
    assert.equal(isProtectedDocsPath('/v1/docs-json', 'v1'), true);
    // Le prefixe par defaut ne doit plus rien proteger quand la configuration a
    // change : sinon une route `/api/docs` inexistante serait surveillee, et la
    // vraie `/v1/docs` ne le serait pas.
    assert.equal(isProtectedDocsPath('/api/docs', 'v1'), false);
  });
});

describe('parseBasicAuthorization', () => {
  it('lit un en-tete conforme', () => {
    assert.deepEqual(parseBasicAuthorization(`Basic ${base64('samy:secret')}`), {
      user: 'samy',
      password: 'secret',
    });
  });

  it('accepte le schema en minuscules ou en majuscules', () => {
    // Le nom du schema est sensible a la casse dans la RFC, mais les clients
    // varient. Refuser `basic` ferait echouer un navigateur qui l'ecrit ainsi.
    for (const scheme of ['Basic', 'basic', 'BASIC']) {
      assert.deepEqual(
        parseBasicAuthorization(`${scheme} ${base64('a:b')}`),
        { user: 'a', password: 'b' },
        `le schema « ${scheme} » devrait etre accepte`,
      );
    }
  });

  it('coupe au PREMIER deux-points, pour laisser le mot de passe en contenir', () => {
    // Un mot de passe genere peut contenir `:` ; un identifiant ne peut pas en
    // contenir par la RFC 7617. Un `split(':')` naif tronquerait le mot de passe,
    // et l'echec serait invisible dans la configuration de l'hebergeur.
    assert.deepEqual(parseBasicAuthorization(`Basic ${base64('samy:se:cret:')}`), {
      user: 'samy',
      password: 'se:cret:',
    });
  });

  it('accepte un mot de passe vide mais pas un identifiant vide sans separateur', () => {
    assert.deepEqual(parseBasicAuthorization(`Basic ${base64('samy:')}`), {
      user: 'samy',
      password: '',
    });
    // Sans deux-points, ce n'est pas un couple : refuse.
    assert.equal(parseBasicAuthorization(`Basic ${base64('samy')}`), null);
  });

  it("refuse tout ce qui n'est pas un Basic exploitable, sans le dire", () => {
    for (const header of [
      undefined,
      '',
      'Bearer abc.def.ghi',
      'Basic',
      'Basic ',
      'Basic    ',
      base64('samy:secret'),
      `Basic ${base64('sans-deux-points')}`,
    ]) {
      assert.equal(
        parseBasicAuthorization(header),
        null,
        `« ${String(header)} » devrait etre refuse`,
      );
    }
  });

  it('ne leve pas sur un base64 invalide', () => {
    // `Buffer.from(..., 'base64')` ignore les caracteres hors alphabet au lieu de
    // lever. Ce test verrouille le fait que rien ne remonte en exception, ce qui
    // serait un deni de service sur une route publique.
    assert.doesNotThrow(() => parseBasicAuthorization('Basic !!!pas-du-base64!!!'));
  });
});

describe('credentialsMatch', () => {
  const attendu = { user: 'comexa', password: 'un-mot-de-passe-long' };

  it('accepte le couple exact', () => {
    assert.equal(credentialsMatch({ ...attendu }, attendu), true);
  });

  it('refuse un identifiant ou un mot de passe different', () => {
    assert.equal(credentialsMatch({ user: 'comexa', password: 'autre' }, attendu), false);
    assert.equal(credentialsMatch({ user: 'autre', password: attendu.password }, attendu), false);
  });

  it('ne leve pas quand les longueurs different', () => {
    // C'est la raison des empreintes SHA-256 : `timingSafeEqual` LEVE sur deux
    // tampons de tailles differentes. L'appeler directement ferait planter le
    // serveur sur un mot de passe trop court, ce qui est un deni de service
    // offert a quiconque connait l'URL.
    assert.doesNotThrow(() => credentialsMatch({ user: '', password: 'x' }, attendu));
    assert.equal(credentialsMatch({ user: '', password: 'x' }, attendu), false);
    assert.doesNotThrow(() => credentialsMatch({ user: 'a'.repeat(4096), password: '' }, attendu));
  });
});

/**
 * Un couple `Request`/`Response` reduit a ce que le middleware utilise.
 *
 * Un vrai `Response` d'Express demanderait une socket et un serveur pour quatre
 * methodes. Le transtypage est volontaire et documente, comme dans
 * `client-ip.spec.ts` : si le middleware se met a utiliser autre chose, ces tests
 * cesseront de le couvrir.
 */
interface ReponseEnregistree {
  readonly statusCode: number | undefined;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
  readonly headersEnvoyes: boolean;
}

function exercer(
  path: string,
  authorization: string | undefined,
  expected: { user: string; password: string },
  apiPrefix = PREFIX,
): { readonly reponse: ReponseEnregistree; readonly suivant: boolean } {
  let suivant = false;
  const reponse: {
    statusCode?: number;
    headers: Record<string, string>;
    body?: string;
    headersEnvoyes: boolean;
  } = { headers: {}, headersEnvoyes: false };

  const request = { path, headers: { authorization } } as unknown as Request;

  const response = {
    setHeader(name: string, value: string) {
      reponse.headers[name.toLowerCase()] = value;
      reponse.headersEnvoyes = true;
      return this;
    },
    status(code: number) {
      reponse.statusCode = code;
      return this;
    },
    type() {
      return this;
    },
    send(body: string) {
      reponse.body = body;
      return this;
    },
  } as unknown as Response;

  const next: NextFunction = () => {
    suivant = true;
  };

  docsBasicAuth(expected, apiPrefix)(request, response, next);

  return { reponse: reponse as ReponseEnregistree, suivant };
}

describe('docsBasicAuth', () => {
  const attendu = { user: 'comexa', password: 'un-mot-de-passe-long' };

  it('laisse passer une requete hors documentation, sans reponse', () => {
    // C'est ce qui autorise un enregistrement GLOBAL du middleware : sur
    // `/api/health`, il ne doit rien faire du tout.
    for (const path of ['/api/health', '/api/documents', '/']) {
      const { reponse, suivant } = exercer(path, undefined, attendu);
      assert.equal(suivant, true, `${path} devrait passer`);
      assert.equal(reponse.statusCode, undefined, `${path} ne devrait pas etre intercepte`);
    }
  });

  it('refuse sans identifiants, en reclame, et en texte', () => {
    const { reponse, suivant } = exercer('/api/docs', undefined, attendu);

    assert.equal(suivant, false);
    assert.equal(reponse.statusCode, 401);
    assert.match(reponse.headers['www-authenticate'] ?? '', /^Basic /);
    // Le nom du royaume s'affiche dans l'invite du navigateur : il doit dire de
    // quelle documentation il s'agit.
    assert.match(reponse.headers['www-authenticate'] ?? '', /Comexa API docs/);
    // Le corps n'est jamais lu par le navigateur (seule l'invite compte), mais il
    // ne doit surtout pas contenir d'indice sur le couple attendu.
    assert.ok(!(reponse.body ?? '').includes(attendu.password));
    assert.ok(!(reponse.body ?? '').toLowerCase().includes('comexa'));
  });

  it('laisse passer le couple correct', () => {
    const { reponse, suivant } = exercer(
      '/api/docs',
      `Basic ${base64(`${attendu.user}:${attendu.password}`)}`,
      attendu,
    );

    assert.equal(suivant, true);
    assert.equal(reponse.statusCode, undefined);
    assert.equal(reponse.headersEnvoyes, false);
  });

  it('refuse un mot de passe faux, meme avec le bon identifiant', () => {
    const { reponse, suivant } = exercer(
      '/api/docs',
      `Basic ${base64(`${attendu.user}:mauvais`)}`,
      attendu,
    );

    assert.equal(suivant, false);
    assert.equal(reponse.statusCode, 401);
  });

  it('protege aussi les documents bruts et la casse haute', () => {
    // Le test qui compte vraiment : le middleware, et pas seulement le predicat,
    // doit couvrir `-json`, `-yaml` et `/API/DOCS`.
    for (const path of ['/api/docs-json', '/api/docs-yaml', '/API/DOCS']) {
      const { reponse, suivant } = exercer(path, undefined, attendu);
      assert.equal(suivant, false, `${path} devrait etre intercepte`);
      assert.equal(reponse.statusCode, 401, `${path} devrait repondre 401`);
    }
  });

  it('suit le prefixe global configure', () => {
    const { suivant } = exercer(
      '/v1/docs',
      `Basic ${base64(`${attendu.user}:${attendu.password}`)}`,
      attendu,
      'v1',
    );
    assert.equal(suivant, true);

    // Et le prefixe par defaut ne doit plus rien intercepter quand il a change.
    const faux = exercer('/api/docs', undefined, attendu, 'v1');
    assert.equal(faux.suivant, true);
  });
});
