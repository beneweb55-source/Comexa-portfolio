/**
 * POIGNEE DE MAIN WEBSOCKET — les morceaux verifiables sans serveur.
 *
 * `src/common/guards/access.guards.ts` contient le commentaire qui commande tout
 * ce fichier :
 *
 *     « Les passerelles WebSocket ont leur propre poignee de main : le jeton
 *       arrive dans `handshake.auth`, pas dans une requete HTTP. »
 *
 * Ce commentaire est un AVEU autant qu'une explication : `JwtAuthGuard` renvoie
 * `true` pour tout contexte non-HTTP. Aucun garde global ne protege donc la
 * passerelle. Si elle ne verifie rien, un socket anonyme se connecte, rejoint la
 * room d'une conversation et lit la messagerie de l'agence.
 *
 * D'ou ce fichier : ce qui peut etre teste sans ouvrir de port vit ici, sous
 * forme de fonctions pures. La passerelle (`realtime.gateway.ts`) ne fait plus
 * qu'assembler ces morceaux avec socket.io.
 */

/** Namespace temps reel. Le frontend s'y connecte : `io(url + '/rt', ...)`. */
export const REALTIME_NAMESPACE = '/rt';

export const USER_ROOM_PREFIX = 'user:';
export const CONVERSATION_ROOM_PREFIX = 'conversation:';

/**
 * Plafond du nombre de rooms de conversation rejointes a la connexion.
 *
 * Un compte ancien peut avoir des milliers de conversations. Les rejoindre
 * toutes ferait une poignee de main a plusieurs milliers d'entrees, pour un
 * benefice nul : personne ne lit un fil vieux de trois ans. Au-dela du plafond,
 * le client demande explicitement la conversation qu'il ouvre
 * (`conversation:join`), et la participation y est verifiee en base.
 */
export const MAX_CONVERSATION_ROOMS = 200;

/** Longueur maximale d'un identifiant accepte depuis un evenement socket. */
export const MAX_SOCKET_ID_LENGTH = 64;

export interface HandshakeLike {
  readonly auth?: unknown;
  readonly headers?: Record<string, string | string[] | undefined>;
}

/** La room personnelle d'un utilisateur. Tout ce qui lui est destine y passe. */
export function roomForUser(userId: string): string {
  return `${USER_ROOM_PREFIX}${userId}`;
}

/** La room d'une conversation. N'y entrent que des participants verifies. */
export function roomForConversation(conversationId: string): string {
  return `${CONVERSATION_ROOM_PREFIX}${conversationId}`;
}

/**
 * Le jeton d'acces presente a la poignee de main.
 *
 * `handshake.auth.token` D'ABORD : c'est ce que le client socket.io envoie
 * nativement (`io(url, { auth: { token } })`), et c'est la voie normale pour un
 * WebSocket — un en-tete `Authorization` n'est pas posable depuis un navigateur
 * sur une connexion WebSocket.
 *
 * L'en-tete est accepte EN SECOURS, pour les clients hors navigateur (tests
 * d'integration, scripts) qui savent poser un en-tete mais pas un objet `auth`.
 * Les deux sont traites a l'identique et verifies de la meme facon ; il n'y a
 * donc pas de chemin plus faible.
 *
 * Renvoie `null` — jamais une chaine vide — pour que l'appelant n'ait qu'un seul
 * cas a traiter : « pas de jeton ».
 */
export function extractHandshakeToken(handshake: HandshakeLike): string | null {
  return tokenFromAuth(handshake.auth) ?? tokenFromHeaders(handshake.headers);
}

function tokenFromAuth(auth: unknown): string | null {
  if (typeof auth === 'string') {
    return normalizeToken(auth);
  }

  if (typeof auth !== 'object' || auth === null) {
    return null;
  }

  return normalizeToken((auth as { token?: unknown }).token);
}

function tokenFromHeaders(headers: HandshakeLike['headers']): string | null {
  const raw = headers?.['authorization'];
  const header = Array.isArray(raw) ? raw[0] : raw;

  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return null;
  }

  return normalizeToken(header.slice('Bearer '.length));
}

/**
 * Un jeton utilisable, ou rien.
 *
 * L'espace est retire et la chaine vide vaut « absent » : `auth: { token: '' }`
 * est ce qu'envoie un client dont la session a expire, et le traiter comme un
 * jeton present ferait echouer la verification avec un message different de
 * celui du jeton manquant — deux chemins pour la meme cause.
 */
function normalizeToken(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const token = value.trim();
  return token.length > 0 ? token : null;
}

/**
 * Les origines autorisees pour la poignee de main socket.io.
 *
 * Meme regle que `app.setup.ts` pour HTTP : une liste vide vaut `false`, donc
 * aucun acces cross-origin. La coherence compte — un navigateur autorise a
 * appeler l'API mais pas a ouvrir le WebSocket produirait un temps reel qui
 * « ne marche pas » sans aucun message d'erreur cote serveur.
 *
 * ATTENTION, PIEGE CONNU : cette fonction est appelee au CHARGEMENT DU MODULE,
 * parce que les options d'un `@WebSocketGateway` sont figees a la decoration.
 * `ConfigModule.forRoot()` n'a pas encore lu le fichier `.env` a cet instant —
 * il s'execute dans le corps de `AppModule`, donc apres l'evaluation de ses
 * imports. En production l'operateur fournit les variables dans l'environnement
 * du processus et tout va bien ; en developpement local avec un `.env`, il faut
 * soit exporter `CORS_ORIGIN` dans le shell, soit accepter que le temps reel
 * reste same-origin. Le septieme point du rapport le signale au coordinateur.
 */
export function socketCorsOrigins(raw: string | undefined): string[] | false {
  const origins = (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : false;
}

/**
 * L'identifiant de conversation porte par un evenement recu du client.
 *
 * Le client ne fournit JAMAIS de donnee d'autorisation — seulement des
 * identifiants, que la passerelle revalide en base avant d'en faire quoi que ce
 * soit. La borne de longueur, elle, n'est pas de la securite : elle empeche un
 * socket de faire porter a une room un nom arbitrairement long, ce que socket.io
 * garderait en memoire pour chaque connexion.
 */
export function readConversationIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const value = (payload as { conversationId?: unknown }).conversationId;
  if (typeof value !== 'string') {
    return null;
  }

  const id = value.trim();
  return id.length > 0 && id.length <= MAX_SOCKET_ID_LENGTH ? id : null;
}

/**
 * L'etat de frappe annonce par un client.
 *
 * Seul `true` compte : tout le reste vaut « a arrete d'ecrire ». Un client qui
 * enverrait `isTyping: 'oui'` ne doit pas garder l'indicateur allume
 * indefiniment chez les autres.
 */
export function readTypingFlag(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }

  return (payload as { isTyping?: unknown }).isTyping === true;
}
