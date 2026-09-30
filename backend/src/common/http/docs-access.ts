import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * PROTECTION DE LA DOCUMENTATION OPENAPI.
 *
 * Le document OpenAPI decrit les 165 operations de l'API, ses modeles et ses
 * codes de permission. En production il n'est pas servi — c'est la decision par
 * defaut du depot, et elle ne change pas ici. Mais l'associe qui integre le
 * frontend a besoin de lire le contrat EN LIGNE, et `DOCS_ENABLED=true` permet de
 * l'ouvrir. Ce fichier est ce qui rend cette ouverture acceptable.
 *
 * -----------------------------------------------------------------------------
 * POURQUOI UN MIDDLEWARE EXPRESS, ET PAS UN GARDE NEST
 * -----------------------------------------------------------------------------
 * `SwaggerModule` n'enregistre pas de controleurs : il monte ses routes
 * directement sur l'adaptateur HTTP (`httpAdapter.get(...)`) et sert ses fichiers
 * par `useStaticAssets`. Les gardes, pipes et intercepteurs de Nest ne
 * s'appliquent donc PAS a ces routes — `JwtAuthGuard` en `APP_GUARD` compris.
 * C'est verifie dans la source installee de `@nestjs/swagger`.
 *
 * Un middleware Express est en consequence le seul endroit ou la verification
 * peut avoir lieu. Il est enregistre par `configureApp`, AVANT l'appel a
 * `SwaggerModule.setup`, pour s'executer en premier.
 *
 * -----------------------------------------------------------------------------
 * CE QUI EST PROTEGE, ET POURQUOI LA LISTE EST ECRITE AINSI
 * -----------------------------------------------------------------------------
 * Swagger monte plusieurs chemins, et ils ne sont pas tous des ENFANTS les uns
 * des autres :
 *
 *   /api/docs                       l'interface
 *   /api/docs/                      la meme, barre oblique finale
 *   /api/docs/swagger-ui-init.js    les scripts de l'interface
 *   /api/docs-json                  le document brut          <- FRERE, pas enfant
 *   /api/docs-yaml                  le document brut en YAML  <- FRERE, pas enfant
 *
 * Un `app.use('/api/docs', ...)` monterait sur un segment et raterait les deux
 * derniers : le document brut serait alors PUBLIC pendant que l'interface
 * demande un mot de passe. C'est la fuite la plus probable de ce montage, et
 * c'est pour cela que le test se fait sur le chemin complet plutot que sur un
 * montage Express.
 *
 * LA REGLE RETENUE : un chemin est protege si, apres le prefixe `/api/docs`, il
 * ne reste rien, ou il reste une barre oblique, ou il reste un tiret. Cette
 * formulation couvre `/api/docs-json` et `/api/docs-yaml` sans les nommer — une
 * future route `-json5` serait donc protegee par defaut — et elle EXCLUT
 * `/api/documents`, qui est une vraie route de l'API et dont le prefixe ressemble
 * dangereusement au notre. C'est verifie par un test dedie.
 *
 * LA COMPARAISON IGNORE LA CASSE, ET C'EST NECESSAIRE. Express est configure avec
 * `case sensitive routing` desactive (le defaut) : `/API/DOCS` atteint le meme
 * gestionnaire que `/api/docs`. Un controle sensible a la casse laisserait donc
 * passer une requete vers la page reelle, sans authentification. Le chemin est
 * donc compare en minuscules.
 */

/** Identifiants attendus, lus depuis la configuration. Jamais journalises. */
export interface DocsCredentials {
  readonly user: string;
  readonly password: string;
}

/**
 * Le prefixe des chemins de documentation, tel qu'il doit etre compare.
 *
 * `apiPrefix` vient de `configureApp` — il vaut `api` par defaut, mais
 * `API_PREFIX` peut le changer, et un prefixe en dur ici deviendrait faux le jour
 * ou il change, sans que rien ne le signale.
 */
export function docsBasePath(apiPrefix: string): string {
  return `/${apiPrefix}/docs`;
}

/**
 * `true` si ce chemin doit exiger une authentification.
 *
 * Voir l'en-tete du fichier pour la regle et ses deux pieges — les chemins
 * freres `-json`/`-yaml`, et la casse.
 */
export function isProtectedDocsPath(path: string, apiPrefix: string): boolean {
  const base = docsBasePath(apiPrefix).toLowerCase();
  const candidate = path.toLowerCase();

  if (!candidate.startsWith(base)) {
    return false;
  }

  const rest = candidate.slice(base.length);
  return rest === '' || rest.startsWith('/') || rest.startsWith('-');
}

/**
 * Lit un en-tete `Authorization: Basic ...`.
 *
 * Retourne `null` pour toute forme qui n'est pas exploitable — en-tete absent,
 * schema different (`Bearer`, qui est celui de l'API elle-meme), base64 invalide,
 * ou separateur deux-points absent. Aucun de ces cas n'est une erreur : ils
 * signifient tous « pas d'identifiants fournis », et le middleware repond 401
 * dans tous les cas. Distinguer les messages revelerait la forme attendue.
 *
 * La separation se fait au PREMIER deux-points, conformement a la RFC 7617 : le
 * mot de passe peut en contenir, l'identifiant non. Un `split(':')` naif
 * tronquerait un mot de passe contenant `:`, et l'authentification echouerait
 * pour une raison invisible dans le tableau de bord de l'hebergeur.
 */
export function parseBasicAuthorization(header: string | undefined): DocsCredentials | null {
  if (typeof header !== 'string' || header.length === 0) {
    return null;
  }

  const separator = header.indexOf(' ');
  if (separator === -1) {
    return null;
  }

  const scheme = header.slice(0, separator);
  if (scheme.toLowerCase() !== 'basic') {
    return null;
  }

  const encoded = header.slice(separator + 1).trim();
  if (encoded.length === 0) {
    return null;
  }

  // `Buffer.from(..., 'base64')` n'echoue JAMAIS sur une entree invalide : il
  // ignore silencieusement les caracteres hors alphabet. Le controle qui suit
  // (separateur deux-points absent) est donc ce qui distingue un en-tete valide
  // d'un en-tete quelconque.
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');

  const colon = decoded.indexOf(':');
  if (colon === -1) {
    return null;
  }

  return { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

/**
 * Compare deux identifiants en temps CONSTANT.
 *
 * POURQUOI PAS `===`. Une comparaison de chaines s'arrete au premier caractere
 * different : sa duree revele donc le nombre de caracteres corrects en prefixe.
 * Sur un secret qu'on peut essayer sans limite — et c'est le cas ici, les routes
 * de Swagger ne passant pas par le limiteur de debit — cette fuite permet de
 * reconstituer le mot de passe caractere par caractere.
 *
 * LES EMPREINTES SERVENT A EGALISER LES LONGUEURS. `timingSafeEqual` LEVE quand
 * les deux tampons n'ont pas la meme taille : l'utiliser directement ferait
 * planter le serveur sur un mot de passe de mauvaise longueur, ce qui est un
 * deni de service offert a l'attaquant. Deux empreintes SHA-256 font toujours 32
 * octets.
 *
 * LES DEUX CHAMPS SONT TOUJOURS COMPARES, sans court-circuit : un `&&` qui
 * s'arreterait au premier refus rendrait le temps de reponse different selon que
 * l'identifiant est juste ou non, ce qui revelerait lequel des deux est fautif.
 */
export function credentialsMatch(provided: DocsCredentials, expected: DocsCredentials): boolean {
  const userOk = constantTimeEquals(provided.user, expected.user);
  const passwordOk = constantTimeEquals(provided.password, expected.password);
  return userOk && passwordOk;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/**
 * Le middleware a enregistrer quand `DOCS_ENABLED=true` en production.
 *
 * IL PORTE LUI-MEME LE CONTROLE DE CHEMIN, et c'est une decision de conception,
 * pas un detail. L'appelant l'enregistre donc GLOBALEMENT (`app.use(mw)`), sans
 * chemin de montage. Deux montages naifs sont ainsi rendus impossibles :
 *
 *   `app.use('/api/docs', mw)`  rate `/api/docs-json` et `/api/docs-yaml`,
 *                               qui sont des freres et non des enfants ;
 *   `app.use('/api', mw)`       protegerait TOUTES les routes de l'API, y
 *                               compris celles que le frontend interroge.
 *
 * Une propriete de securite qui depend de la facon dont l'appelant monte le
 * middleware est une propriete qui se perdra au premier remaniement. Ici, la
 * regle est dans le code et non dans l'appel : monter ceci trop largement ne
 * casse rien, monter ceci trop etroitement est impossible.
 *
 * Le cout est un `startsWith` sur une chaine minuscule, par requete.
 *
 * LA REPONSE EST EN TEXTE, PAS EN JSON, malgre le contrat d'enveloppe du reste de
 * l'API. Ces chemins ne sont pas des routes de Nest : l'enveloppe ne s'y applique
 * pas, et le corps de la reponse n'est de toute facon jamais lu par le navigateur
 * — il n'affiche que l'invite d'authentification, declenchee par l'en-tete
 * `WWW-Authenticate`.
 */
export function docsBasicAuth(expected: DocsCredentials, apiPrefix: string) {
  return function docsBasicAuthMiddleware(
    request: Request,
    response: Response,
    next: NextFunction,
  ): void {
    // `request.path` est le chemin sans la chaine de requete, y compris dans un
    // `app.use` sans chemin de montage : c'est la valeur que `isProtectedDocsPath`
    // attend. `request.url` contiendrait le `?...`.
    if (!isProtectedDocsPath(request.path, apiPrefix)) {
      next();
      return;
    }

    const provided = parseBasicAuthorization(request.headers.authorization);

    if (provided !== null && credentialsMatch(provided, expected)) {
      next();
      return;
    }

    // `charset="UTF-8"` accompagne les navigateurs recents ; sans lui, certains
    // refusent l'invite sur un mot de passe non ASCII. Le nom du royaume est
    // volontairement explicite : il s'affiche dans l'invite du navigateur, et
    // l'utilisateur doit comprendre quelle documentation on lui demande.
    response.setHeader('WWW-Authenticate', 'Basic realm="Comexa API docs", charset="UTF-8"');
    response.status(401).type('text/plain; charset=utf-8').send('Authentification requise.');
  };
}
