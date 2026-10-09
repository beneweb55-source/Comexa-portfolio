import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
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
 *
 * -----------------------------------------------------------------------------
 * POURQUOI UNE PAGE DE CONNEXION, EN PLUS DE L'AUTHENTIFICATION HTTP BASIC
 * -----------------------------------------------------------------------------
 * L'invite du navigateur — celle que declenche `WWW-Authenticate` — N'EST PAS
 * FIABLE, et ce n'est pas une opinion : c'est ce qui a ete constate sur le
 * service deploye. Chrome memorise un refus pour un royaume donne et cesse
 * ensuite de proposer l'invite ; l'utilisateur voit alors une page blanche
 * portant « Authentification requise. » et conclut que la documentation est
 * cassee. Le serveur n'a aucun moyen de forcer l'invite a revenir : c'est le
 * navigateur qui decide, et lui seul.
 *
 * La page de connexion retire cette dependance. C'est le SERVEUR qui rend le
 * formulaire, donc le comportement est identique dans tous les navigateurs, y
 * compris sur telephone, et il ne demande aucun geste particulier — ni fenetre
 * privee, ni vidage de cache, ni redemarrage du navigateur.
 *
 * L'AUTHENTIFICATION BASIC EST CONSERVEE, et les deux cohabitent :
 *   - un NAVIGATEUR qui accepte du HTML recoit la page (200), jamais un 401 —
 *     donc l'invite native ne s'affiche plus jamais dans ce cas ;
 *   - un CLIENT D'API (`curl -u`, Postman, un script) n'a pas de formulaire :
 *     il continue de recevoir le 401 et son `WWW-Authenticate`, exactement
 *     comme avant, et tout ce qui marchait continue de marcher.
 *
 * UNE CONNEXION RATEE REPOND 200, ET NON 401. Ce n'est pas une negligence : un
 * 401 accompagné de `WWW-Authenticate` sur la reponse au formulaire ferait
 * apparaitre l'invite native PAR-DESSUS le message d'erreur de la page, et l'on
 * retomberait exactement sur le defaut que cette page existe pour corriger.
 *
 * La session ouverte est portee par un cookie SIGNE, dont le secret est derive
 * de `DOCS_PASSWORD` : aucune variable d'environnement supplementaire, et
 * changer le mot de passe invalide toutes les sessions sur-le-champ.
 */

/** Identifiants attendus, lus depuis la configuration. Jamais journalises. */
export interface DocsCredentials {
  readonly user: string;
  readonly password: string;
}

/**
 * Nom du cookie qui porte la session ouverte.
 *
 * Le prefixe `comexa_` n'est pas decoratif : les cookies sont partages par tout
 * le domaine, et un nom generique comme `session` entrerait en collision avec
 * celui du back-office si celui-ci en posait un jour un.
 */
export const DOCS_COOKIE_NAME = 'comexa_docs';

/**
 * Duree de vie d'une session ouverte : sept jours.
 *
 * Assez long pour que l'associe n'ait pas a se reconnecter en pleine integration
 * — c'est tout l'objet de cette page — et assez court pour qu'un cookie oublie
 * sur un poste partage cesse d'etre valable. Le jeton porte sa propre date
 * d'expiration, signee : reduire cette constante invalide donc les sessions deja
 * ouvertes au lieu de les laisser courir.
 */
export const DOCS_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Taille maximale du corps du formulaire de connexion, en octets.
 *
 * Le formulaire ne porte que deux champs ; quelques kilo-octets suffisent
 * largement. Refuser au-dela borne la memoire qu'une requete peut consommer,
 * sans quoi un envoi massif vers cette route — qui ne passe PAS par le limiteur
 * de debit, faute d'etre une route de Nest — serait entierement bufferise.
 */
const CORPS_MAX_OCTETS = 4096;

/** Le refus en texte, pour les clients qui ne savent pas lire du HTML. */
const MESSAGE_REFUS = 'Authentification requise.';

/** Le nom du royaume, affiche par l'invite native des clients d'API. */
const ROYAUME = 'Comexa API docs';

/** Message affiche sur la page quand le couple soumis ne correspond pas. */
const MESSAGE_IDENTIFIANTS_INCORRECTS = 'Identifiant ou mot de passe incorrect.';

/** Message affiche quand un cookie de session a ete presente mais a echoue. */
const MESSAGE_SESSION_EXPIREE = 'Votre session a expiré. Merci de vous reconnecter.';

/**
 * Ce dont le middleware a besoin pour repondre, fige une fois a la construction.
 *
 * Les valeurs sont calculees dans `protectDocs` et non a chaque requete : le
 * prefixe et les chemins viennent de la configuration et ne changent pas en
 * cours de vie du processus.
 */
interface DocsProtectionContext {
  readonly identifiants: DocsCredentials;
  readonly cheminDeConnexion: string;
  readonly cheminInterface: string;
  readonly cheminsDeSession: readonly string[];
  readonly secretDeSession: string;
  readonly maxAgeSecondes: number;
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
 * Le chemin du formulaire de connexion, qui est aussi la cible de son `POST`.
 *
 * IL EST UN FRERE DE `/api/docs`, COMME `-json` ET `-yaml`, et non un enfant.
 * Un chemin enfant — `/api/docs/login` — serait plus lisible, mais il tomberait
 * dans le montage de `SwaggerModule`, qui sert son interface par un
 * `useStaticAssets` monte sur `/api/docs`. Un frere ne peut pas entrer en
 * collision avec ces fichiers.
 *
 * Le nom n'est pas arbitraire non plus : parce qu'il commence par un tiret, il
 * est deja couvert par la regle de `isProtectedDocsPath`, sans qu'aucune ligne
 * n'ait eu a etre ajoutee. Le formulaire ne peut donc jamais devenir une porte
 * ouverte dans le dos de cette protection.
 */
export function docsLoginPath(apiPrefix: string): string {
  return `${docsBasePath(apiPrefix)}-login`;
}

/**
 * Les chemins sur lesquels le cookie de session doit etre pose.
 *
 * IL EN FAUT TROIS, ET C'EST UN PIEGE DE LA RFC 6265. Un cookie porte
 * `Path=/api/docs` N'EST PAS envoye sur `/api/docs-json` : pour qu'un chemin de
 * cookie couvre une requete, il doit soit etre identique, soit se terminer par
 * une barre oblique, soit que le caractere suivant dans la requete soit une
 * barre oblique. `-json` ne remplit aucune des trois conditions. Poser le cookie
 * sur le seul chemin de l'interface laisserait donc Swagger UI, qui lit son
 * document sur `/api/docs-json`, se faire refuser juste apres la connexion.
 *
 * UN FRERE FUTUR N'EST PAS OUBLIE, SEULEMENT NON COUVERT. S'il apparaissait un
 * `/api/docs-xml`, la regle de `isProtectedDocsPath` le protegerait aussitot,
 * mais sans cookie : il redemanderait le mot de passe. C'est le sens sur qu'on
 * veut — l'oubli coute une reconnexion, jamais une fuite.
 */
export function docsSessionPaths(apiPrefix: string): readonly string[] {
  const base = docsBasePath(apiPrefix);
  return [base, `${base}-json`, `${base}-yaml`];
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
 * Derive le secret qui signe les jetons de session, a partir du mot de passe.
 *
 * POURQUOI LE MOT DE PASSE PLUTOT QU'UNE VARIABLE DE PLUS. Cette fonctionnalite
 * demande deja trois variables d'environnement ; en ajouter une quatrieme pour
 * la signature ajouterait un endroit ou se tromper et une valeur a proteger. Le
 * mot de passe est deja un secret, deja obligatoire, et deja long d'au moins
 * seize caracteres (`env.validation`). Le passer par SHA-256 donne une cle de
 * longueur fixe, distincte du mot de passe lui-meme.
 *
 * L'EFFET DE BORD EST UTILE : changer `DOCS_PASSWORD` change le secret, donc
 * invalide sur-le-champ toutes les sessions ouvertes. C'est ce qu'on attend d'une
 * rotation de mot de passe, et c'est gratuit.
 *
 * Le prefixe versionne isole cette cle de tout autre usage du meme mot de passe :
 * si `DOCS_PASSWORD` servait ailleurs, les deux cles derivees seraient differentes.
 */
export function docsSessionSecret(password: string): string {
  return createHash('sha256').update(`comexa-docs-session-v1:${password}`, 'utf8').digest('hex');
}

function signatureDeSession(secret: string, expiration: number): string {
  return createHmac('sha256', secret).update(String(expiration), 'utf8').digest('base64url');
}

/**
 * Fabrique un jeton de session : l'expiration, puis sa signature.
 *
 * L'EXPIRATION EST EN CLAIR, ET C'EST VOULU. Elle n'a pas besoin d'etre secrete,
 * seulement de ne pas etre modifiable — c'est le role de la signature. La lire
 * directement evite de tenir la moindre session en memoire, ce qui compte sur un
 * hebergeur qui redemarre a volonte : un redemarrage ne deconnecte personne.
 */
export function signDocsSession(secret: string, expiration: number): string {
  return `${expiration}.${signatureDeSession(secret, expiration)}`;
}

/**
 * Verifie un jeton de session : forme, expiration, puis signature.
 *
 * LES CONTROLES SONT SEPARES POUR ETRE LISIBLES, et leur ordre compte : on
 * refuse la forme avant de convertir, et l'expiration avant de calculer une
 * signature, pour ne pas faire travailler le serveur sur un jeton manifestement
 * eteint.
 *
 * LA SIGNATURE EST COMPAREE EN TEMPS CONSTANT, avec la meme fonction que les
 * identifiants. Un `===` revelerait par le temps de reponse combien de
 * caracteres de signature sont justes — exactement ce qu'il faut pour
 * reconstituer une signature octet par octet.
 *
 * La comparaison passe par `constantTimeEquals`, donc par des empreintes : deux
 * signatures de longueurs differentes ne font pas lever `timingSafeEqual`. Un
 * jeton tronque doit etre refuse, jamais faire planter le serveur.
 */
export function verifyDocsSession(
  secret: string,
  token: string | undefined,
  maintenant: number,
): boolean {
  if (typeof token !== 'string' || token.length === 0) {
    return false;
  }

  const separateur = token.indexOf('.');
  if (separateur <= 0 || separateur === token.length - 1) {
    return false;
  }

  const partieExpiration = token.slice(0, separateur);

  // BORNE SUR LE NOMBRE DE CHIFFRES AVANT TOUTE CONVERSION. `Number` accepte
  // `0x10`, `1e5`, les espaces et `Infinity` ; une expiration ecrite `Infinity`
  // passerait ensuite tous les tests et ne s'eteindrait jamais.
  if (!/^\d{1,15}$/.test(partieExpiration)) {
    return false;
  }

  const expiration = Number(partieExpiration);
  if (expiration <= maintenant) {
    return false;
  }

  return constantTimeEquals(token.slice(separateur + 1), signatureDeSession(secret, expiration));
}

/**
 * Lit l'en-tete `Cookie` et rend les couples nom/valeur.
 *
 * UN `Map` PLUTOT QU'UN OBJET : les noms viennent de l'exterieur, et un cookie
 * nomme `__proto__` ou `constructor` se comporte de facon surprenante sur un
 * objet litteral. Un `Map` n'a pas de prototype a atteindre.
 *
 * Le `cookie-parser` d'Express est bien enregistre avant ce middleware, mais on
 * ne s'en sert pas : `request.cookies` est une surface non typee, et faire
 * dependre une verification de securite d'un ordre d'enregistrement serait
 * fragile. Cet analyseur tient en dix lignes et se teste seul.
 *
 * La separation se fait au PREMIER `=`, parce qu'une valeur a le droit d'en
 * contenir. Le PREMIER cookie gagne en cas de doublon : la RFC 6265 ne fixe pas
 * d'ordre, et choisir une fois pour toutes vaut mieux qu'un resultat qui depend
 * de l'analyseur du client.
 */
export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();

  if (typeof header !== 'string' || header.length === 0) {
    return cookies;
  }

  for (const morceau of header.split(';')) {
    const egal = morceau.indexOf('=');
    if (egal <= 0) {
      continue;
    }

    const nom = morceau.slice(0, egal).trim();
    if (nom.length === 0 || cookies.has(nom)) {
      continue;
    }

    cookies.set(nom, morceau.slice(egal + 1).trim());
  }

  return cookies;
}

/**
 * Fabrique un en-tete `Set-Cookie` pour la session.
 *
 * `HttpOnly` : le jeton n'a aucune raison d'etre lu par un script, et l'y
 * soustraire ferme la porte a sa lecture en cas de faille XSS sur une page
 * servie depuis la meme origine.
 *
 * `Secure` : le service est en HTTPS derriere Cloudflare. Sans cet attribut, un
 * seul appel en clair suffirait a livrer la session. Les navigateurs traitent
 * `localhost` comme une origine sure, donc le developpement local continue de
 * fonctionner.
 *
 * `SameSite=Lax` : le cookie suit la navigation normale — c'est ce qui permet a
 * la redirection d'apres connexion de fonctionner — mais pas les requetes
 * croisees.
 *
 * AUCUN `Domain` : l'attribut est omis volontairement, pour que le cookie reste
 * sur l'hote exact qui l'a pose et ne descende pas vers des sous-domaines.
 */
export function docsSessionCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  path: string,
): string {
  return [
    `${name}=${value}`,
    `Path=${path}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

/**
 * `true` si le client annonce accepter du HTML — donc s'il sait afficher une page.
 *
 * LE TEST EST UN `includes`, ET C'EST LE POINT DELICAT DE TOUT LE MONTAGE.
 * LA VALEUR FOURRE-TOUT NE COMPTE PAS COMME DU HTML. Elle s'ecrit `*`/`*` — sous
 * cette forme et non telle quelle, parce que l'etoile suivie d'une barre oblique
 * fermerait ce commentaire. Un navigateur qui navigue envoie `text/html,...` ;
 * `curl`, Postman et les `fetch` de Swagger UI envoient tous la valeur
 * fourre-tout. La traiter comme du HTML aurait deux consequences, toutes deux
 * mauvaises : un `curl` sans identifiants recevrait une page de connexion au lieu
 * du 401 qui lui dit quoi faire, et Swagger UI recevrait du HTML la ou il attend
 * son document JSON.
 *
 * Un `Accept` absent vaut « pas de HTML » : c'est le cas de la plupart des
 * clients d'API, et le 401 avec `WWW-Authenticate` reste alors la bonne reponse.
 */
export function acceptsHtml(header: string | undefined): boolean {
  return typeof header === 'string' && header.toLowerCase().includes('text/html');
}

/**
 * Echappe le texte insere dans la page.
 *
 * Aucune valeur n'y vient d'un client aujourd'hui : le chemin vient de la
 * configuration et le message d'erreur est une constante du fichier. L'echappement
 * est la pour que cela reste vrai le jour ou l'un des deux changera — un
 * `API_PREFIX` lu dans l'environnement finit dans l'attribut `action`.
 */
function echapperHtml(valeur: string): string {
  return valeur
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Rend la page de connexion.
 *
 * ELLE N'EMBARQUE AUCUN SCRIPT, et ce n'est pas un choix esthetique : la
 * politique de securite de contenu posee par `helmet()` autorise les styles en
 * ligne (`style-src ... 'unsafe-inline'`) mais interdit les scripts en ligne
 * (`script-src 'self'`, `script-src-attr 'none'`). Un formulaire HTML sans
 * JavaScript est donc ce qui fonctionne ici sans toucher a helmet — et c'est
 * aussi ce qui fonctionne avec le JavaScript desactive, sur un navigateur ancien
 * ou sur un telephone.
 *
 * `form-action 'self'` autorise le `POST` vers notre propre origine, ce qui est
 * exactement ce que fait ce formulaire. Aucune ressource distante n'est chargee :
 * ni police, ni image, ni feuille de style externe. La page s'affiche donc meme
 * si le reste du reseau est filtre, ce qui est le cas sur beaucoup de reseaux
 * d'entreprise.
 *
 * `autocomplete="username"` et `autocomplete="current-password"` sont la pour que
 * les gestionnaires de mots de passe proposent le couple : c'est une demande de
 * moins, pas un detail.
 */
function rendrePageDeConnexion(action: string, erreur: string | undefined): string {
  const blocErreur =
    erreur === undefined
      ? ''
      : `      <p class="erreur" role="alert">${echapperHtml(erreur)}</p>\n`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Documentation de l'API Comexa</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 24px; background: #0d141b; color: #e7eef5;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .carte {
    width: 100%; max-width: 380px; padding: 32px; border-radius: 12px;
    background: #151f29; border: 1px solid #24323f;
  }
  h1 { margin: 0 0 8px; font-size: 20px; line-height: 1.3; }
  .aide { margin: 0 0 24px; font-size: 14px; color: #9bafc1; }
  label { display: block; margin-bottom: 6px; font-size: 14px; font-weight: 600; }
  input {
    width: 100%; margin-bottom: 18px; padding: 10px 12px; border-radius: 8px;
    border: 1px solid #33475a; background: #0d141b; color: inherit; font: inherit;
  }
  input:focus-visible { outline: 2px solid #4c9be8; outline-offset: 1px; }
  button {
    width: 100%; padding: 11px 12px; border: 0; border-radius: 8px;
    background: #4c9be8; color: #0b1016; font: inherit; font-weight: 700;
    cursor: pointer;
  }
  button:hover { background: #6fb2ef; }
  .erreur {
    margin: 0 0 20px; padding: 10px 12px; border-radius: 8px;
    border: 1px solid #7d3236; background: #2a1618; color: #f0b4b4;
    font-size: 14px;
  }
</style>
</head>
<body>
<main class="carte">
<h1>Documentation de l'API Comexa</h1>
<p class="aide">Cet espace est réservé. Entrez les identifiants qui vous ont été transmis.</p>
${blocErreur}<form method="post" action="${echapperHtml(action)}">
<label for="identifiant">Identifiant</label>
<input id="identifiant" name="user" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required autofocus>
<label for="motdepasse">Mot de passe</label>
<input id="motdepasse" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Se connecter</button>
</form>
</main>
</body>
</html>
`;
}

/**
 * Lit le corps d'une requete, en s'arretant au-dela de `limite` octets.
 *
 * POURQUOI PAS L'ANALYSEUR D'EXPRESS. `express` et `body-parser` ne sont PAS des
 * dependances declarees de ce paquet : express n'arrive que par transitivite, via
 * `@nestjs/platform-express`. Faire dependre la securite de la documentation d'un
 * paquet que `package.json` ne nomme pas expose a le perdre a la prochaine montee
 * de version de Nest, sans que rien ne le signale.
 *
 * ET DE TOUTE FACON LE CORPS NE SERAIT PAS LA. Nest enregistre son analyseur de
 * corps dans `init()`, donc APRES `configureApp` qui enregistre ce middleware :
 * `request.body` est vide a cet instant. Lire le flux soi-meme est la seule
 * option, et c'est aussi la plus sure, puisque rien d'autre n'y touche.
 *
 * Retourne `null` si le corps depasse la limite : le formulaire ne porte que deux
 * champs, donc quelques kilo-octets suffisent largement, et refuser au-dela borne
 * la memoire qu'une requete peut immobiliser.
 */
function lireCorpsDeRequete(request: Request, limite: number): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let total = 0;
    let contenu = '';
    let conclu = false;

    const conclure = (valeur: string | null): void => {
      if (conclu) {
        return;
      }
      conclu = true;
      resolve(valeur);
    };

    request.setEncoding('utf8');

    request.on('data', (morceau: string) => {
      if (conclu) {
        return;
      }

      total += Buffer.byteLength(morceau, 'utf8');
      if (total > limite) {
        conclure(null);
        return;
      }

      contenu += morceau;
    });

    // `end` pour le cas normal, `error` et `close` pour une connexion coupee.
    // Une fermeture prematuree rend un corps partiel, qui ne correspondra a aucun
    // identifiant : l'echec est ferme, jamais ouvert.
    request.on('end', () => conclure(contenu));
    request.on('error', () => conclure(null));
    request.on('close', () => conclure(null));
  });
}

/**
 * Traite le `POST` du formulaire : verifie le couple, pose le cookie, redirige.
 *
 * CETTE FONCTION ECRIT LA REPONSE ELLE-MEME ET N'APPELLE JAMAIS `next()`. C'est
 * essentiel : le corps de la requete a ete lu, donc la chaine doit s'arreter la.
 * L'analyseur de corps de Nest, enregistre plus loin, n'a pas a voir passer une
 * requete dont le flux est deja consomme.
 *
 * ELLE EST ASYNCHRONE, ET LE MIDDLEWARE L'ATTEND. Lire un flux est asynchrone ;
 * sans `await`, la reponse serait ecrite apres le retour de l'intergiciel, et
 * rien ne pourrait observer le resultat — ni un test, ni une trace. La rattache
 * est interne, donc la promesse rendue ne se rejette jamais, quelle que soit la
 * facon dont Express traite les intergiciels asynchrones.
 *
 * LA REDIRECTION EST EN 303, et non en 302 : 303 dit explicitement au navigateur
 * de suivre avec un `GET`, ce qui evite de rejouer le `POST` — et donc le mot de
 * passe — sur la page de documentation.
 *
 * LA CIBLE EST LE CHEMIN DE L'INTERFACE, pris dans la configuration. Elle n'est
 * PAS lue dans la requete : accepter une destination venue du client ferait de
 * cette page une redirection ouverte, utilisable pour envoyer ailleurs quelqu'un
 * qui vient de s'authentifier.
 */
async function traiterConnexion(
  request: Request,
  response: Response,
  contexte: DocsProtectionContext,
): Promise<void> {
  try {
    const corps = await lireCorpsDeRequete(request, CORPS_MAX_OCTETS);
    const champs = new URLSearchParams(corps ?? '');
    const fourni: DocsCredentials = {
      user: champs.get('user') ?? '',
      password: champs.get('password') ?? '',
    };

    if (!credentialsMatch(fourni, contexte.identifiants)) {
      // 200 ET NON 401, volontairement. Un 401 porteur de `WWW-Authenticate`
      // ferait apparaitre l'invite native PAR-DESSUS ce message, soit exactement
      // le defaut que cette page existe pour corriger.
      repondrePageDeConnexion(response, contexte, MESSAGE_IDENTIFIANTS_INCORRECTS);
      return;
    }

    const expiration = Date.now() + DOCS_SESSION_TTL_MS;

    // UN SEUL `setHeader` AVEC UN TABLEAU, et non trois appels : pour
    // `Set-Cookie`, Node emet une ligne par element. C'est ce qui pose le meme
    // jeton sur les trois chemins en une seule reponse.
    response.setHeader(
      'Set-Cookie',
      contexte.cheminsDeSession.map((chemin) =>
        docsSessionCookie(
          DOCS_COOKIE_NAME,
          signDocsSession(contexte.secretDeSession, expiration),
          contexte.maxAgeSecondes,
          chemin,
        ),
      ),
    );
    response.setHeader('Cache-Control', 'no-store');
    response
      .status(303)
      .setHeader('Location', contexte.cheminInterface)
      .type('text/plain; charset=utf-8')
      .send('Connecté. Redirection vers la documentation.');
  } catch {
    // Rien dans ce corps ne doit lever. La rattache est la pour qu'aucune
    // promesse ne remonte : sous Express 4 une promesse rejetee ne part pas vers
    // `next()` et ferait tomber le processus, alors que la version de Nest
    // utilisee peut tres bien changer. Une reponse explicite vaut mieux qu'un
    // arret du service de documentation.
    if (!response.headersSent) {
      response
        .status(500)
        .type('text/plain; charset=utf-8')
        .send('Connexion impossible. Reessayez.');
    }
  }
}

/**
 * Sert la page de connexion, en 200, et sans `WWW-Authenticate`.
 *
 * `no-store` : la page porte un message d'erreur contextuel (« identifiant
 * incorrect », « session expiree »). La laisser en cache ferait reapparaitre un
 * message qui ne correspond plus a la situation.
 */
function repondrePageDeConnexion(
  response: Response,
  contexte: DocsProtectionContext,
  erreur: string | undefined,
): void {
  response.setHeader('Cache-Control', 'no-store');
  response.status(200).type('html').send(rendrePageDeConnexion(contexte.cheminDeConnexion, erreur));
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
 * pas.
 *
 * -----------------------------------------------------------------------------
 * L'ORDRE DES CONTROLES, ET POURQUOI IL EST CELUI-LA
 * -----------------------------------------------------------------------------
 *   1. hors documentation          -> `next()`, sans rien lire ni repondre ;
 *   2. `POST` du formulaire        -> traite ici, et la chaine s'arrete ;
 *   3. `Authorization: Basic`      -> verifie, puis `next()` ou refus ;
 *   4. cookie de session valide    -> `next()` ;
 *   5. `GET` ou `HEAD` acceptant du HTML -> la page de connexion, en 200 ;
 *   6. tout le reste               -> 401 et `WWW-Authenticate`.
 *
 * LES ETAPES 3 ET 4 SONT AVANT L'ETAPE 5 : un client qui presente deja des
 * identifiants corrects, ou une session ouverte, ne doit jamais revoir le
 * formulaire. Et l'etape 5 est avant l'etape 6 pour qu'un navigateur ne recoive
 * jamais le 401 : c'est ce 401 qui declenchait l'invite native, celle dont ce
 * montage existe pour s'affranchir.
 *
 * L'AUTHENTIFICATION BASIC RESTE VERIFIEE, et c'est ce qui permet a `curl -u`,
 * a Postman et aux scripts de continuer a fonctionner sans rien changer : ils
 * n'envoient pas `Accept: text/html`, donc ils recoivent le 401 et son
 * `WWW-Authenticate`, exactement comme avant cette page.
 *
 * LES IDENTIFIANTS VIDES SONT REFUSES A LA CONSTRUCTION. Un couple vide rendrait
 * `Authorization: Basic Og==` suffisant — un en-tete que n'importe qui peut
 * fabriquer — et le secret de session deviendrait une constante publique, donc
 * des jetons forgeables. `env.validation` refuse deja ce cas au demarrage ; ce
 * controle existe pour que le fichier tienne tout seul, sans dependre de qui
 * l'appelle.
 */
export function protectDocs(options: {
  readonly credentials: DocsCredentials;
  readonly apiPrefix: string;
  readonly sessionSecret: string;
}) {
  const { credentials, apiPrefix, sessionSecret } = options;

  if (credentials.user.length === 0 || credentials.password.length === 0) {
    throw new Error(
      'protectDocs a recu des identifiants vides. La documentation serait alors ' +
        'ouverte avec `Authorization: Basic Og==`, et le secret de session serait ' +
        'une constante publique. Verifiez DOCS_USER et DOCS_PASSWORD.',
    );
  }

  const contexte: DocsProtectionContext = {
    identifiants: credentials,
    cheminDeConnexion: docsLoginPath(apiPrefix),
    cheminInterface: docsBasePath(apiPrefix),
    cheminsDeSession: docsSessionPaths(apiPrefix),
    secretDeSession: sessionSecret,
    // `Max-Age` se compte en secondes, la constante en millisecondes. L'arrondi
    // vers le bas est volontaire : le cookie ne doit pas survivre au jeton.
    maxAgeSecondes: Math.floor(DOCS_SESSION_TTL_MS / 1000),
  };

  return async function protectDocsMiddleware(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    // `request.path` est le chemin sans la chaine de requete, y compris dans un
    // `app.use` sans chemin de montage : c'est la valeur que `isProtectedDocsPath`
    // attend. `request.url` contiendrait le `?...`.
    if (!isProtectedDocsPath(request.path, apiPrefix)) {
      next();
      return;
    }

    // La casse est ignoree des deux cotes, comme dans `isProtectedDocsPath` :
    // Express route `/API/DOCS-LOGIN` vers ce middleware, et le formulaire doit
    // y repondre aussi.
    if (
      request.method === 'POST' &&
      request.path.toLowerCase() === contexte.cheminDeConnexion.toLowerCase()
    ) {
      await traiterConnexion(request, response, contexte);
      return;
    }

    const fourni = parseBasicAuthorization(request.headers.authorization);

    if (fourni !== null && credentialsMatch(fourni, credentials)) {
      next();
      return;
    }

    const jeton = parseCookieHeader(request.headers.cookie).get(DOCS_COOKIE_NAME);

    if (verifyDocsSession(sessionSecret, jeton, Date.now())) {
      next();
      return;
    }

    // UN COOKIE PRESENT MAIS INVALIDE EST UNE SESSION EXPIREE, et le dire evite
    // a l'utilisateur de croire qu'il s'est trompe en recopiant le mot de passe.
    // Le cookie n'est pas efface pour autant : le suivant l'ecrasera au moment de
    // la connexion, sur les trois memes chemins.
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      acceptsHtml(request.headers.accept)
    ) {
      repondrePageDeConnexion(
        response,
        contexte,
        jeton === undefined ? undefined : MESSAGE_SESSION_EXPIREE,
      );
      return;
    }

    // `charset="UTF-8"` accompagne les navigateurs recents ; sans lui, certains
    // refusent l'invite sur un mot de passe non ASCII. Le nom du royaume est
    // volontairement explicite : il s'affiche dans l'invite du navigateur, et
    // l'utilisateur doit comprendre quelle documentation on lui demande.
    response.setHeader('WWW-Authenticate', `Basic realm="${ROYAUME}", charset="UTF-8"`);
    response.status(401).type('text/plain; charset=utf-8').send(MESSAGE_REFUS);
  };
}
