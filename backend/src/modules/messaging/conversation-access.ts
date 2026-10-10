import type { Prisma } from '../../generated/prisma/client.js';

/**
 * REGLES D'ACCES AUX CONVERSATIONS, ECRITES UNE SEULE FOIS.
 *
 * Tout ce qui decide « qui a le droit de voir quoi » est ici, sous forme de
 * fonctions PURES : elles construisent des fragments de `where` Prisma ou
 * calculent des listes, sans toucher a la base, a Nest, ni a une requete HTTP.
 * Deux consequences, et ce sont elles qui justifient le fichier :
 *
 *  - les tests unitaires verifient la REGLE sans monter d'application, sans base
 *    et sans socket ;
 *  - il n'existe qu'un seul endroit ou l'on puisse se tromper.
 *
 * LE POINT CENTRAL : LA PARTICIPATION EST UN FILTRE DE REQUETE, PAS UN TEST
 * APRES COUP.
 *
 * `participationWhere` place la contrainte dans le `where` Prisma. Un service
 * qui chargerait la conversation puis ferait `if (!estParticipant)` laisse
 * toujours la porte ouverte a un chemin — un nouveau, un refactor — qui oublie
 * le second test. Ici la ligne ne SORT PAS de la base si le porteur n'est pas
 * participant : il n'existe aucun instant ou le contenu est en memoire sans
 * avoir ete autorise.
 *
 * C'est la reponse directe a l'exigence du client : « Un client ne doit jamais
 * pouvoir modifier l'ID d'un autre client dans une requete pour acceder a ses
 * donnees. »
 */

/** Ligne de `ConversationParticipant` reduite a ce qui decide l'acces. */
export interface ParticipantRow {
  readonly userId: string;
  readonly leftAt: Date | null;
}

/**
 * Filtre d'une conversation accessible par `userId`.
 *
 * `leftAt: null` compte autant que `userId` : quelqu'un qui a quitte la
 * conversation n'y a plus acces, tout en gardant son historique de messages (on
 * ne supprime pas la ligne, on la marque sortie — voir `leave`).
 */
export function participationWhere(userId: string): Prisma.ConversationWhereInput {
  return {
    deletedAt: null,
    participants: { some: { userId, leftAt: null } },
  };
}

/**
 * Les destinataires d'une notification de nouveau message.
 *
 * L'auteur en est exclu — se notifier soi-meme de son propre message est un
 * bogue d'affichage, pas une politesse — et les sortis aussi. Le `Set` retire
 * les doublons : la table interdit deja deux lignes identiques, mais la
 * fonction ne doit pas dependre de cette contrainte pour etre correcte.
 */
export function notificationRecipients(
  participants: readonly ParticipantRow[],
  senderId: string,
): string[] {
  const recipients = new Set<string>();

  for (const participant of participants) {
    if (participant.leftAt === null && participant.userId !== senderId) {
      recipients.add(participant.userId);
    }
  }

  return [...recipients];
}

// ---------------------------------------------------------------------------
// Pagination des messages : curseur, pas `skip`
// ---------------------------------------------------------------------------

const CURSOR_SEPARATOR = '|';

/** Longueur maximale d'un identifiant accepte dans un curseur (cuid : ~25). */
const MAX_ID_LENGTH = 64;

/**
 * Encode la position « dernier message lu » en un jeton opaque.
 *
 * L'encodage n'est PAS une protection : un client peut forger un curseur, et
 * c'est sans danger. Un curseur ne fait que deplacer la FENETRE de lecture ; il
 * n'accorde rien. Le filtre de participation est applique de toute facon, dans
 * la meme requete, et reste la seule barriere qui compte. Le rendre opaque
 * evite simplement au frontend de dependre du format interne.
 */
export function encodeMessageCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}${CURSOR_SEPARATOR}${id}`, 'utf8').toString(
    'base64url',
  );
}

/**
 * Relit un curseur. Renvoie `null` si le jeton est illisible.
 *
 * `null` et non une exception : l'appelant decide du statut HTTP. Une fonction
 * pure qui leve obligerait le test a connaitre `AppException`, donc a importer
 * la couche HTTP — exactement ce que ce fichier cherche a eviter.
 */
export function decodeMessageCursor(raw: string): { createdAt: Date; id: string } | null {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf(CURSOR_SEPARATOR);

  // `separator <= 0` : pas de separateur, ou rien avant lui. Un curseur valide a
  // toujours une date ET un identifiant.
  if (separator <= 0) {
    return null;
  }

  const id = decoded.slice(separator + 1);
  if (id.length === 0 || id.length > MAX_ID_LENGTH) {
    return null;
  }

  const createdAt = new Date(decoded.slice(0, separator));
  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }

  return { createdAt, id };
}

/**
 * Filtre « strictement plus ancien que le curseur », dans l'ordre decroissant.
 *
 * La comparaison porte sur le COUPLE (createdAt, id), pas sur la seule date.
 * Deux messages peuvent partager la meme milliseconde — c'est courant dans un
 * import ou un envoi groupe — et un curseur sur la seule date sauterait alors
 * les messages ex-aequo (fenetre `lt`) ou les redonnerait indefiniment
 * (fenetre `lte`). L'identifiant departage, et comme il est unique l'ordre
 * total est garanti.
 */
export function beforeCursorWhere(cursor: {
  createdAt: Date;
  id: string;
}): Prisma.MessageWhereInput {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

/**
 * Les messages non lus pour `viewerId`, sur un ENSEMBLE de conversations.
 *
 * Ecrit comme un filtre unique — et pas comme un comptage par conversation —
 * parce que la page de conversations peut en contenir cent : une requete par
 * conversation ferait cent allers-retours pour afficher une liste. Le `OR`
 * interne porte une condition par conversation, chacune avec SON `lastReadAt`,
 * ce que Prisma ne sait pas faire autrement.
 *
 * `EPOCH` remplace un `lastReadAt` nul plutot que de dupliquer la branche :
 * « jamais lu » veut exactement dire « tout est non lu ».
 */
export const EPOCH = new Date(0);

export interface UnreadTarget {
  readonly conversationId: string;
  readonly lastReadAt: Date | null;
}

export function unreadMessagesWhere(
  viewerId: string,
  targets: readonly UnreadTarget[],
): Prisma.MessageWhereInput | null {
  if (targets.length === 0) {
    return null;
  }

  return {
    deletedAt: null,
    AND: [
      {
        // Un message de quelqu'un d'autre, ou un message systeme (`senderId`
        // nul). Ecrire `senderId: { not: viewerId }` seul exclurait les
        // seconds : en SQL, une comparaison avec NULL n'est jamais vraie, et le
        // `not` les ecarterait avec les siens.
        OR: [{ senderId: null }, { senderId: { not: viewerId } }],
      },
      {
        OR: targets.map((target) => ({
          conversationId: target.conversationId,
          createdAt: { gt: target.lastReadAt ?? EPOCH },
        })),
      },
    ],
  };
}

/** Groupe renvoye par `prisma.message.groupBy` avec `_count: { _all: true }`. */
export interface UnreadGroup {
  readonly conversationId: string;
  readonly _count: { readonly _all: number };
}

/** Traduit les groupes en table de correspondance, avec 0 par defaut. */
export function unreadCountsFromGroups(
  groups: readonly UnreadGroup[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();

  for (const group of groups) {
    counts.set(group.conversationId, group._count._all);
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Apercu et pagination d'une page de messages
// ---------------------------------------------------------------------------

/** Longueur de l'apercu stocke sur la conversation, pour la liste. */
export const PREVIEW_MAX_LENGTH = 140;

/**
 * Apercu d'un message, normalise pour tenir sur une ligne.
 *
 * Les sauts de ligne sont ecrases : `lastMessagePreview` s'affiche dans une
 * liste, et un message multiligne y casserait la hauteur des lignes. Le texte
 * complet reste dans `Message.body` — l'apercu ne remplace jamais la donnee.
 */
export function previewOf(body: string): string {
  const flattened = body.replace(/\s+/g, ' ').trim();

  if (flattened.length <= PREVIEW_MAX_LENGTH) {
    return flattened;
  }

  return `${flattened.slice(0, PREVIEW_MAX_LENGTH - 3)}...`;
}

/** Ce qu'une page de messages doit savoir d'une ligne pour paginer. */
export interface CursorRow {
  readonly id: string;
  readonly createdAt: Date;
}

export interface MessagePage<T> {
  readonly items: T[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

/**
 * Decoupe une page a partir de `perPage + 1` lignes lues.
 *
 * On lit UNE ligne de plus que demande : sa presence est ce qui repond a
 * « y a-t-il une suite », sans requete de comptage supplementaire. Un
 * `count()` sur une table de messages qui grossit sans fin coute cher pour une
 * information que la ligne surnumeraire donne gratuitement.
 */
export function buildMessagePage<T extends CursorRow>(
  rows: readonly T[],
  perPage: number,
): MessagePage<T> {
  const hasMore = rows.length > perPage;
  const items = hasMore ? rows.slice(0, perPage) : [...rows];
  const last = items.length > 0 ? items[items.length - 1] : undefined;

  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeMessageCursor(last.createdAt, last.id) : null,
  };
}
