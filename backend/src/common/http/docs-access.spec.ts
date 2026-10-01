import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import {
  acceptsHtml,
  credentialsMatch,
  DOCS_COOKIE_NAME,
  DOCS_SESSION_TTL_MS,
  docsBasePath,
  docsLoginPath,
  docsSessionCookie,
  docsSessionPaths,
  docsSessionSecret,
  isProtectedDocsPath,
  parseBasicAuthorization,
  parseCookieHeader,
  protectDocs,
  signDocsSession,
  verifyDocsSession,
  type DocsCredentials,
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
 * Aucune base de donnees, aucun serveur : ces fonctions ne lisent qu'un chemin,
 * un en-tete et, pour le formulaire de connexion, un corps de requete.
 *
 * LE FORMULAIRE DE CONNEXION A SES PROPRES PIEGES, et chacun a son test :
 *
 *  3. LA REPONSE AU FORMULAIRE NE DOIT PAS ETRE UN 401. Un 401 porteur de
 *     `WWW-Authenticate` ferait revenir l'invite native par-dessus le message
 *     d'erreur de la page — exactement le defaut que la page corrige.
 *  4. LA VALEUR FOURRE-TOUT (`*`/`*`) N'EST PAS DU HTML. La confondre enverrait la
 *     page de connexion a `curl` au lieu du 401 qui lui dit quoi faire, et du HTML
 *     a Swagger UI la ou il attend son document JSON.
 *  5. LE COOKIE PORTE SUR TROIS CHEMINS. Un cookie pose sur `/api/docs` seul
 *     n'est pas envoye sur `/api/docs-json` : Swagger se ferait refuser juste
 *     apres la connexion, et la panne serait incomprehensible.
 *  6. UNE SIGNATURE NON VERIFIEE VAUDRAIT UNE SESSION. Un jeton dont on ne
 *     controle que la date ouvre la documentation a quiconque en invente un.
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

describe('docsLoginPath', () => {
  it('suit le prefixe global', () => {
    assert.equal(docsLoginPath('api'), '/api/docs-login');
    assert.equal(docsLoginPath('v1'), '/v1/docs-login');
  });

  it('est un chemin protege SANS regle ajoutee', () => {
    // C'est tout l'interet du nom : il commence par un tiret, donc la regle
    // ecrite pour `-json` et `-yaml` le couvre deja. Le formulaire ne peut pas
    // devenir une porte ouverte dans le dos de la protection.
    for (const prefixe of ['api', 'v1']) {
      assert.equal(
        isProtectedDocsPath(docsLoginPath(prefixe), prefixe),
        true,
        `le formulaire de « ${prefixe} » devrait etre protege`,
      );
    }
  });
});

describe('docsSessionPaths', () => {
  it('couvre les trois chemins que Swagger sert', () => {
    assert.deepEqual(docsSessionPaths('api'), ['/api/docs', '/api/docs-json', '/api/docs-yaml']);
  });

  it('ne couvre QUE des chemins proteges', () => {
    for (const chemin of docsSessionPaths(PREFIX)) {
      assert.equal(isProtectedDocsPath(chemin, PREFIX), true, `${chemin} devrait etre protege`);
    }

    // Le cookie ne doit pas partir sur une vraie route de l'API : `/api/documents`
    // partage le prefixe textuel sans etre de la documentation.
    assert.ok(!docsSessionPaths(PREFIX).includes('/api/documents'));
  });

  it('suit le prefixe global plutot que de le supposer', () => {
    assert.deepEqual(docsSessionPaths('v1'), ['/v1/docs', '/v1/docs-json', '/v1/docs-yaml']);
  });
});

describe('docsSessionSecret', () => {
  it('derive une cle de longueur fixe, distincte du mot de passe', () => {
    const cle = docsSessionSecret('un-mot-de-passe-long');

    assert.equal(cle.length, 64, 'une empreinte SHA-256 fait 32 octets, donc 64 en hexa');
    assert.ok(!cle.includes('un-mot-de-passe-long'));
  });

  it('change avec le mot de passe, et pour lui seul', () => {
    // C'est ce qui rend une rotation efficace : changer `DOCS_PASSWORD` invalide
    // toutes les sessions ouvertes au meme instant, sans code supplementaire.
    assert.notEqual(
      docsSessionSecret('un-mot-de-passe-long'),
      docsSessionSecret('un-mot-de-passe-long2'),
    );
    assert.equal(docsSessionSecret('a'), docsSessionSecret('a'));
  });
});

describe('signDocsSession / verifyDocsSession', () => {
  const SECRET_DE_TEST = docsSessionSecret('un-mot-de-passe-long');
  const MAINTENANT = 1_700_000_000_000;

  it('accepte un jeton signe, pas encore eteint', () => {
    const jeton = signDocsSession(SECRET_DE_TEST, MAINTENANT + 60_000);
    assert.equal(verifyDocsSession(SECRET_DE_TEST, jeton, MAINTENANT), true);
  });

  it('refuse un jeton eteint, a la seconde pres', () => {
    // La borne est `<=` : un jeton qui expire maintenant est eteint. Autoriser
    // l'egalite laisserait une seconde de validite supplementaire a chaque
    // expiration, sans que rien ne le dise.
    assert.equal(
      verifyDocsSession(SECRET_DE_TEST, signDocsSession(SECRET_DE_TEST, MAINTENANT), MAINTENANT),
      false,
    );
    assert.equal(
      verifyDocsSession(
        SECRET_DE_TEST,
        signDocsSession(SECRET_DE_TEST, MAINTENANT + 1),
        MAINTENANT,
      ),
      true,
    );
  });

  it('refuse un jeton signe avec un autre secret', () => {
    const jeton = signDocsSession(docsSessionSecret('un-autre-mot-de-passe'), MAINTENANT + 60_000);
    assert.equal(verifyDocsSession(SECRET_DE_TEST, jeton, MAINTENANT), false);
  });

  it("refuse une date avancee qui n'est pas signee", () => {
    // LE TEST QUI COMPTE VRAIMENT. La date est en clair dans le jeton, parce
    // qu'elle n'a pas besoin d'etre secrete — seulement d'etre infalsifiable.
    // La signature est donc la SEULE chose qui ouvre la documentation : sans
    // elle, `9999999999999.` suffirait a se donner une session eternelle.
    const lointain = MAINTENANT + 60_000;

    for (const jeton of [
      `${lointain}.`,
      `${lointain}.faux`,
      `${lointain}`,
      `${lointain}.${signDocsSession(SECRET_DE_TEST, lointain + 1).split('.')[1]}`,
    ]) {
      assert.equal(
        verifyDocsSession(SECRET_DE_TEST, jeton, MAINTENANT),
        false,
        `« ${jeton} » devrait etre refuse`,
      );
    }
  });

  it("refuse tout ce qui n'est pas un jeton, sans lever", () => {
    // Les quatre dernieres formes sont celles que `Number` accepterait si le
    // nombre de chiffres n'etait pas borne : `Infinity` ne s'eteindrait jamais,
    // `0x10` et `1e9` sont des entiers parfaitement valides pour lui, et un
    // espace en tete serait ignore.
    for (const jeton of [
      undefined,
      '',
      '.',
      '.signature',
      'signature.',
      'Infinity.signature',
      '1e9.signature',
      '0x10.signature',
      ' 1700000000000.signature',
      `${'9'.repeat(16)}.signature`,
    ]) {
      assert.equal(
        verifyDocsSession(SECRET_DE_TEST, jeton, MAINTENANT),
        false,
        `« ${String(jeton)} » devrait etre refuse`,
      );
    }

    assert.doesNotThrow(() => verifyDocsSession(SECRET_DE_TEST, 'a'.repeat(4096), MAINTENANT));
  });

  it('refuse une signature tronquee sans faire lever timingSafeEqual', () => {
    // `timingSafeEqual` LEVE sur deux tampons de tailles differentes. C'est la
    // raison des empreintes SHA-256 : un jeton tronque doit etre refuse, jamais
    // arreter le processus.
    const jeton = signDocsSession(SECRET_DE_TEST, MAINTENANT + 60_000);
    const tronque = jeton.slice(0, jeton.length - 1);

    assert.doesNotThrow(() => verifyDocsSession(SECRET_DE_TEST, tronque, MAINTENANT));
    assert.equal(verifyDocsSession(SECRET_DE_TEST, tronque, MAINTENANT), false);
  });
});

describe('parseCookieHeader', () => {
  it('separe au PREMIER egal, pour laisser la valeur en contenir', () => {
    // Une signature base64url peut contenir `=` en remplissage. Couper au dernier
    // egal tronquerait le jeton, et la session serait refusee sans que rien ne
    // dise pourquoi.
    const cookies = parseCookieHeader('a=1; comexa_docs=abc.def=ghi; b=2');

    assert.equal(cookies.get('a'), '1');
    assert.equal(cookies.get(DOCS_COOKIE_NAME), 'abc.def=ghi');
    assert.equal(cookies.get('b'), '2');
  });

  it("ignore tout ce qui n'est pas un couple", () => {
    const cookies = parseCookieHeader('a; =1; ; b=2');

    assert.equal(cookies.size, 1);
    assert.equal(cookies.get('b'), '2');
  });

  it('garde le premier en cas de doublon', () => {
    // La RFC 6265 ne fixe pas d'ordre. Choisir une fois pour toutes vaut mieux
    // qu'un resultat qui depend de l'analyseur du client.
    const cookies = parseCookieHeader(`${DOCS_COOKIE_NAME}=premier; ${DOCS_COOKIE_NAME}=second`);

    assert.equal(cookies.get(DOCS_COOKIE_NAME), 'premier');
  });

  it("ne confond pas un nom de cookie avec une propriete d'objet", () => {
    // Un `Map` et non un objet litteral : `__proto__` et `constructor` sont des
    // noms de cookies parfaitement valides, et sur un objet litteral ils ne se
    // comportent pas comme des cles ordinaires.
    const cookies = parseCookieHeader('__proto__=pollue; constructor=pollue');

    assert.equal(cookies.size, 2);
    assert.equal(cookies.get('__proto__'), 'pollue');
    assert.equal(({} as Record<string, unknown>).pollue, undefined);
  });

  it('rend une table vide sans en-tete', () => {
    assert.equal(parseCookieHeader(undefined).size, 0);
    assert.equal(parseCookieHeader('').size, 0);
  });
});

describe('docsSessionCookie', () => {
  it('rend le cookie inexploitable par un script, et limite a un chemin', () => {
    const cookie = docsSessionCookie(DOCS_COOKIE_NAME, 'jeton', 604800, '/api/docs-json');

    assert.match(cookie, /^comexa_docs=jeton;/);
    assert.match(cookie, /Path=\/api\/docs-json/);
    assert.match(cookie, /Max-Age=604800/);
    // `HttpOnly` : un script ne peut pas lire le jeton.
    assert.match(cookie, /HttpOnly/);
    // `Secure` : le cookie ne part pas en clair.
    assert.match(cookie, /Secure/);
    // `SameSite=Lax` : il suit la navigation, pas les requetes croisees.
    assert.match(cookie, /SameSite=Lax/);
    // Aucun `Domain` : le cookie reste sur l'hote exact qui l'a pose.
    assert.ok(!/Domain=/i.test(cookie));
  });
});

describe('acceptsHtml', () => {
  it('reconnait un navigateur qui navigue', () => {
    assert.equal(
      acceptsHtml('text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8'),
      true,
    );
  });

  it('NE prend PAS `*/*` pour du HTML', () => {
    // LE PIEGE DE TOUT LE MONTAGE. `curl`, Postman et les `fetch` de Swagger UI
    // envoient `*/*`. Les confondre avec un navigateur servirait la page de
    // connexion a un client qui attend un 401 — et du HTML a Swagger UI la ou il
    // attend son document JSON.
    for (const accept of ['*/*', undefined, '', 'application/json', 'application/yaml, */*']) {
      assert.equal(
        acceptsHtml(accept),
        false,
        `« ${String(accept)} » ne devrait pas valoir du HTML`,
      );
    }
  });
});

/**
 * Un couple `Request`/`Response` reduit a ce que le middleware utilise.
 *
 * LE CORPS EST UN VRAI FLUX, et il le faut. `lireCorpsDeRequete` lit le flux de
 * la requete — Nest branche son propre analyseur de corps APRES `configureApp`,
 * donc `request.body` n'existe pas a cet instant. Un objet litteral ne couvrirait
 * donc pas le chemin du `POST` : il faut un `Readable`, comme celui qu'un vrai
 * serveur donne au middleware.
 *
 * Le transtypage est volontaire et documente, comme dans `client-ip.spec.ts` : si
 * le middleware se met a utiliser autre chose, ces tests cesseront de le couvrir.
 */
interface ReponseEnregistree {
  readonly statusCode: number | undefined;
  readonly headers: Record<string, string | string[]>;
  readonly body: string | undefined;
  readonly headersEnvoyes: boolean;
}

interface OptionsRequete {
  readonly path: string;
  readonly apiPrefix?: string;
  readonly method?: string;
  readonly authorization?: string;
  readonly accept?: string;
  readonly cookie?: string;
  /** Le corps brut, deja encode comme le ferait un formulaire HTML. */
  readonly corps?: string;
}

/** Le couple attendu, commun a tous les cas. Jamais un vrai mot de passe. */
const ATTENDU: DocsCredentials = { user: 'comexa', password: 'un-mot-de-passe-long' };

/** Le secret derive du couple ci-dessus, comme `app.setup.ts` le derive. */
const SECRET = docsSessionSecret(ATTENDU.password);

/** Un flux qui porte `corps`, comme le flux d'une vraie requete. */
function fluxDe(corps: string): Readable {
  const flux = new Readable({ read() {} });
  flux.push(Buffer.from(corps, 'utf8'));
  flux.push(null);
  return flux;
}

/** Un en-tete `Set-Cookie` unique, ramene a son couple `nom=valeur`. */
function jetonDuCookie(cookie: string): string {
  return cookie.slice(0, cookie.indexOf(';')).slice(`${DOCS_COOKIE_NAME}=`.length);
}

/** Le `Path=` d'un en-tete `Set-Cookie`. */
function cheminDuCookie(cookie: string): string | undefined {
  return /Path=([^;]+)/.exec(cookie)?.[1];
}

/**
 * Monte le middleware et rend ce qu'il a repondu.
 *
 * ASYNCHRONE COMME LE MIDDLEWARE, sur le chemin du formulaire : la reponse
 * n'existe qu'apres la lecture du corps. Attendre la fin de l'intergiciel est ce
 * qui rend l'assertion fiable, sans temporisation ni `setTimeout`.
 */
async function exercer(
  options: OptionsRequete,
  attendu: DocsCredentials = ATTENDU,
): Promise<{ readonly reponse: ReponseEnregistree; readonly suivant: boolean }> {
  const apiPrefix = options.apiPrefix ?? PREFIX;

  const enregistrement = {
    statusCode: undefined as number | undefined,
    headers: {} as Record<string, string | string[]>,
    body: undefined as string | undefined,
    headersEnvoyes: false,
  };

  const request = Object.assign(fluxDe(options.corps ?? ''), {
    path: options.path,
    method: options.method ?? 'GET',
    headers: {
      authorization: options.authorization,
      accept: options.accept,
      cookie: options.cookie,
    },
  }) as unknown as Request;

  const response = {
    get headersSent() {
      return enregistrement.headersEnvoyes;
    },
    setHeader(name: string, value: string | string[]) {
      enregistrement.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code: number) {
      enregistrement.statusCode = code;
      return this;
    },
    // `res.type` traduit un alias comme « html » en type MIME complet. Cette
    // copie reproduit ce seul cas — celui que le middleware utilise — sans quoi
    // `content-type` resterait vide et l'assertion ne prouverait rien.
    type(valeur: string) {
      enregistrement.headers['content-type'] = valeur.includes('/')
        ? valeur
        : 'text/html; charset=utf-8';
      return this;
    },
    send(body: string) {
      enregistrement.body = body;
      enregistrement.headersEnvoyes = true;
      return this;
    },
    end() {
      enregistrement.headersEnvoyes = true;
      return this;
    },
  } as unknown as Response;

  let suivant = false;
  const next: NextFunction = () => {
    suivant = true;
  };

  await protectDocs({
    credentials: attendu,
    apiPrefix,
    sessionSecret: docsSessionSecret(attendu.password),
  })(request, response, next);

  return { reponse: enregistrement, suivant };
}

describe('protectDocs', () => {
  it('laisse passer une requete hors documentation, sans y toucher', async () => {
    // C'est ce qui autorise un enregistrement GLOBAL du middleware : sur
    // `/api/health`, il ne doit rien faire du tout.
    for (const path of ['/api/health', '/api/documents', '/', '/api/documents/42']) {
      const { reponse, suivant } = await exercer({ path });

      assert.equal(suivant, true, `${path} devrait passer`);
      assert.equal(reponse.statusCode, undefined, `${path} ne devrait pas etre intercepte`);
      assert.equal(reponse.headersEnvoyes, false);
    }
  });

  it('ne consomme pas le corps ailleurs que sur le formulaire', async () => {
    // Le flux doit rester intact pour la suite de la chaine : Nest y branche son
    // propre analyseur de corps.
    const { suivant } = await exercer({
      path: '/api/health',
      method: 'POST',
      corps: `user=${ATTENDU.user}&password=${ATTENDU.password}`,
    });

    assert.equal(suivant, true);
  });

  it("repond 401 en TEXTE a un client qui n'accepte pas de HTML", async () => {
    for (const options of [
      { path: '/api/docs', accept: '*/*' },
      { path: '/api/docs-json', accept: 'application/json' },
      { path: '/api/docs-yaml' },
    ]) {
      const { reponse, suivant } = await exercer(options);

      assert.equal(suivant, false, `${options.path} devrait etre intercepte`);
      assert.equal(reponse.statusCode, 401);
      assert.match(String(reponse.headers['www-authenticate']), /^Basic realm="Comexa API docs"/);
      // Le corps ne doit rien reveler du couple attendu.
      assert.ok(!(reponse.body ?? '').includes(ATTENDU.password));
      assert.ok(!(reponse.body ?? '').toLowerCase().includes('comexa'));
    }
  });

  it('SERT LA PAGE au navigateur, en 200 et sans WWW-Authenticate', async () => {
    const { reponse, suivant } = await exercer({
      path: '/api/docs',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });

    assert.equal(suivant, false);
    assert.equal(reponse.statusCode, 200);

    // LA LIGNE QUI FAIT TOUT : sans `WWW-Authenticate`, le navigateur n'a aucune
    // invite a afficher. C'est ce qui dispense de fenetre privee, de vidage de
    // cache et de redemarrage du navigateur.
    assert.equal(reponse.headers['www-authenticate'], undefined);
    assert.match(String(reponse.headers['content-type']), /text\/html/);
    assert.equal(reponse.headers['cache-control'], 'no-store');

    assert.match(reponse.body ?? '', /<form method="post" action="\/api\/docs-login">/);
    assert.match(reponse.body ?? '', /name="user"/);
    assert.match(reponse.body ?? '', /name="password"/);
    // Aucun script : la politique de securite de contenu de helmet interdit les
    // scripts en ligne, donc une page qui en dependrait ne fonctionnerait pas.
    assert.ok(!/<script/i.test(reponse.body ?? ''));
  });

  it('ne met jamais le mot de passe attendu ni le secret dans la page', async () => {
    const { reponse } = await exercer({ path: '/api/docs', accept: 'text/html' });

    assert.ok(!(reponse.body ?? '').includes(ATTENDU.password));
    assert.ok(!(reponse.body ?? '').includes(SECRET));
  });

  it('laisse passer le couple Basic correct', async () => {
    const { reponse, suivant } = await exercer({
      path: '/api/docs',
      accept: 'text/html',
      authorization: `Basic ${base64(`${ATTENDU.user}:${ATTENDU.password}`)}`,
    });

    assert.equal(suivant, true);
    assert.equal(reponse.statusCode, undefined);
    assert.equal(reponse.headersEnvoyes, false);
  });

  it('refuse un mot de passe faux, meme avec le bon identifiant', async () => {
    const { reponse, suivant } = await exercer({
      path: '/api/docs',
      accept: '*/*',
      authorization: `Basic ${base64(`${ATTENDU.user}:mauvais`)}`,
    });

    assert.equal(suivant, false);
    assert.equal(reponse.statusCode, 401);
  });

  it('protege aussi les documents bruts, les fichiers de l interface et la casse haute', async () => {
    // Le test qui compte vraiment : le middleware, et pas seulement le predicat,
    // doit couvrir les trois chemins de Swagger et la casse.
    for (const path of [
      '/api/docs-json',
      '/api/docs-yaml',
      '/API/DOCS',
      '/api/docs/swagger-ui-init.js',
    ]) {
      const { reponse, suivant } = await exercer({ path, accept: '*/*' });

      assert.equal(suivant, false, `${path} devrait etre intercepte`);
      assert.equal(reponse.statusCode, 401, `${path} devrait repondre 401`);
    }
  });

  it('suit le prefixe global configure', async () => {
    const { suivant } = await exercer({
      path: '/v1/docs',
      apiPrefix: 'v1',
      authorization: `Basic ${base64(`${ATTENDU.user}:${ATTENDU.password}`)}`,
    });
    assert.equal(suivant, true);

    // Et le prefixe par defaut ne doit plus rien intercepter quand il a change.
    const faux = await exercer({ path: '/api/docs', apiPrefix: 'v1' });
    assert.equal(faux.suivant, true);
  });

  // --- LA SESSION ------------------------------------------------------------

  it('laisse passer un cookie de session valide, sur les trois chemins', async () => {
    const jeton = signDocsSession(SECRET, Date.now() + DOCS_SESSION_TTL_MS);

    for (const path of ['/api/docs', '/api/docs-json', '/api/docs/swagger-ui-bundle.js']) {
      const { reponse, suivant } = await exercer({
        path,
        accept: '*/*',
        cookie: `${DOCS_COOKIE_NAME}=${jeton}`,
      });

      assert.equal(suivant, true, `${path} devrait passer avec le cookie`);
      assert.equal(reponse.statusCode, undefined);
    }
  });

  it('refuse un cookie signe avec un autre secret', async () => {
    const jeton = signDocsSession(docsSessionSecret('un-autre-mot-de-passe'), Date.now() + 60_000);
    const { reponse, suivant } = await exercer({
      path: '/api/docs',
      accept: '*/*',
      cookie: `${DOCS_COOKIE_NAME}=${jeton}`,
    });

    assert.equal(suivant, false);
    assert.equal(reponse.statusCode, 401);
  });

  it('dit « session expiree » quand un cookie est present mais invalide', async () => {
    // Sans ce message, l'associe croirait s'etre trompe en recopiant le mot de
    // passe, et chercherait une erreur qui n'existe pas.
    const { reponse } = await exercer({
      path: '/api/docs',
      accept: 'text/html',
      cookie: `${DOCS_COOKIE_NAME}=1700000000000.signature`,
    });

    assert.equal(reponse.statusCode, 200);
    assert.match(reponse.body ?? '', /session a expiré/);
  });

  it("ne dit rien de tel sans cookie : c'est une premiere visite", async () => {
    const { reponse } = await exercer({ path: '/api/docs', accept: 'text/html' });

    assert.equal(reponse.statusCode, 200);
    assert.ok(!/expiré/.test(reponse.body ?? ''));
  });

  // --- LE FORMULAIRE ---------------------------------------------------------

  it("ouvre la session sur les TROIS chemins, en 303 vers l'interface", async () => {
    const { reponse, suivant } = await exercer({
      path: '/api/docs-login',
      method: 'POST',
      corps: `user=${ATTENDU.user}&password=${ATTENDU.password}`,
    });

    assert.equal(suivant, false);
    assert.equal(reponse.statusCode, 303);
    assert.equal(reponse.headers['location'], '/api/docs');

    const cookies = reponse.headers['set-cookie'];
    const liste = Array.isArray(cookies) ? cookies : [];
    assert.equal(liste.length, 3, 'les trois cookies doivent partir en une seule reponse');

    // LE MEME JETON SUR LES TROIS CHEMINS, et c'est le point : Swagger UI lit son
    // document sur `/api/docs-json` juste apres la connexion, et un cookie pose
    // sur le seul `/api/docs` n'y serait pas envoye.
    assert.equal(new Set(liste.map(jetonDuCookie)).size, 1);
    assert.deepEqual(liste.map(cheminDuCookie), [...docsSessionPaths(PREFIX)]);

    const jeton = jetonDuCookie(liste[0] ?? '');
    assert.equal(verifyDocsSession(SECRET, jeton, Date.now()), true);
    assert.equal(liste[0]?.includes('HttpOnly'), true);
  });

  it('REFUSE un couple faux en 200, jamais en 401', async () => {
    const { reponse } = await exercer({
      path: '/api/docs-login',
      method: 'POST',
      corps: `user=${ATTENDU.user}&password=mauvais`,
    });

    // 200 ET NON 401 : un 401 avec `WWW-Authenticate` ferait revenir l'invite
    // native par-dessus ce message, soit exactement le defaut qu'on corrige.
    assert.equal(reponse.statusCode, 200);
    assert.equal(reponse.headers['www-authenticate'], undefined);
    assert.equal(reponse.headers['set-cookie'], undefined);
    assert.match(reponse.body ?? '', /Identifiant ou mot de passe incorrect/);
  });

  it('ne pose aucun cookie quand le mot de passe manque', async () => {
    const { reponse } = await exercer({
      path: '/api/docs-login',
      method: 'POST',
      corps: `user=${ATTENDU.user}`,
    });

    assert.equal(reponse.statusCode, 200);
    assert.equal(reponse.headers['set-cookie'], undefined);
  });

  it('accepte un mot de passe contenant des caracteres encodes', async () => {
    // Un mot de passe genere peut contenir `+`, `=`, `%` ou une espace. Le
    // formulaire les encode, et le middleware doit les rendre tels quels : une
    // valeur tronquee ferait echouer le couple correct pour une raison invisible.
    const attendu: DocsCredentials = { user: 'comexa', password: 'a+b=c d%f' };
    const corps =
      `user=${encodeURIComponent(attendu.user)}` +
      `&password=${encodeURIComponent(attendu.password)}`;

    const { reponse } = await exercer({ path: '/api/docs-login', method: 'POST', corps }, attendu);

    assert.equal(reponse.statusCode, 303);
    assert.ok(reponse.headers['set-cookie'] !== undefined);
  });

  it('traite le formulaire quelle que soit la casse du chemin', async () => {
    const { reponse } = await exercer({
      path: '/API/DOCS-LOGIN',
      method: 'POST',
      corps: `user=${ATTENDU.user}&password=${ATTENDU.password}`,
    });

    assert.equal(reponse.statusCode, 303);
  });

  it('refuse de se construire avec des identifiants vides', () => {
    // Sans ce controle, `Authorization: Basic Og==` — un en-tete que n'importe
    // qui fabrique — ouvrirait la documentation, et le secret de session serait
    // une constante publique, donc des jetons forgeables.
    for (const credentials of [
      { user: '', password: 'un-mot-de-passe-long' },
      { user: 'comexa', password: '' },
      { user: '', password: '' },
    ]) {
      assert.throws(
        () => protectDocs({ credentials, apiPrefix: PREFIX, sessionSecret: SECRET }),
        /identifiants vides/,
        'un couple vide doit etre refuse a la construction',
      );
    }
  });
});
