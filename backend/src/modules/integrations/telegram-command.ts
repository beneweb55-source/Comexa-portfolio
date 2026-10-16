/**
 * INTERPRETATION DES MESSAGES ADRESSES AU BOT @ComexaWork_bot — fonctions PURES.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * Le bot vit dans un workflow n8n, hors de ce depot. Jusqu'ici, rien cote
 * Comexa ne savait lire `/lier 944330` : le workflow devait reconnaitre la
 * commande lui-meme, extraire le code, appeler `verify-code`, puis traduire
 * chaque erreur HTTP en phrase. Un seul maillon manquant (commande non
 * aiguillee, `/lier@ComexaWork_bot` non reconnu, code envoye avec une espace,
 * reponse 404 qui fait echouer le noeud HTTP) et le message retombait dans
 * l'agent conversationnel, qui repondait qu'il ne comprenait pas.
 *
 * Ces regles vivent maintenant ICI, testees, et `POST /integrations/telegram/
 * command` les applique en s'appuyant sur le MEME mecanisme de liaison
 * (`TelegramLinkService.verifyCode`). Aucun second circuit : la commande ne
 * fait qu'aiguiller vers l'existant.
 *
 * Aucune dependance a Nest, a Prisma ou au reseau : tout se teste a l'unite.
 */

export const TELEGRAM_BOT_USERNAME = 'ComexaWork_bot';

/** Duree de validite d'un code, rappelee dans les messages (voir le service). */
export const PAIRING_CODE_TTL_MINUTES = 10;

/** Ou l'utilisateur genere son code dans l'interface Comexa. */
const WHERE_TO_GENERATE = 'Comexa > Mon compte > Bot Telegram';

export type ParsedTelegramMessage =
  /** `/lier 123456` (ou variante tolérée) avec un code bien forme. */
  | { readonly kind: 'link'; readonly code: string }
  /** `/lier` seul : on explique la marche a suivre, sans rien tenter. */
  | { readonly kind: 'link-usage' }
  /** `/lier abc` : un argument est present mais ce n'est pas un code a 6 chiffres. */
  | { readonly kind: 'link-invalid'; readonly argument: string }
  /** Une autre commande (`/start`, `/aide`…) : non geree par Comexa. */
  | { readonly kind: 'other-command'; readonly command: string }
  /** Une commande adressee a UN AUTRE bot (`/lier@AutreBot`) dans un groupe. */
  | { readonly kind: 'foreign-bot' }
  /** Message libre : il revient a l'agent conversationnel. */
  | { readonly kind: 'text' };

/**
 * Chiffres arabes orientaux (٠-٩) et persans (۰-۹) -> chiffres ASCII.
 *
 * Un clavier arabe sur telephone saisit « ٩٤٤٣٣٠ » pour 944330. Refuser ce code
 * parce qu'il n'est pas en chiffres latins serait une impasse incomprehensible
 * pour l'utilisateur : le code est le bon.
 */
function toAsciiDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (char) => {
    const code = char.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/**
 * Normalise un code d'appairage saisi par un humain ou transmis par n8n.
 *
 *  - accepte une chaine (« 944330 », « 944 330 », « 944-330 », « ٩٤٤٣٣٠ ») ;
 *  - accepte un NOMBRE : un workflow qui convertit le champ en entier perd les
 *    zeros de tete (012345 devient 12345). Un code fait toujours 6 chiffres,
 *    on les restitue donc par la gauche ;
 *  - renvoie `null` si le resultat n'est pas exactement 6 chiffres.
 */
export function normalizePairingCode(raw: unknown): string | null {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 0 || raw > 999_999) return null;
    return String(raw).padStart(6, '0');
  }
  if (typeof raw !== 'string') return null;
  const compact = toAsciiDigits(raw).replace(/[\s\u00A0\u202F._-]/g, '');
  return /^\d{6}$/.test(compact) ? compact : null;
}

/** Identifiant Telegram (utilisateur ou chat) : entier transmis en texte ou en nombre. */
export function normalizeTelegramId(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isSafeInteger(raw)) return String(raw);
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return /^-?\d{1,20}$/.test(value) ? value : null;
}

/**
 * Lit un message Telegram et dit ce qu'il demande.
 *
 * Formes reconnues pour la liaison :
 *   /lier 944330            forme documentee dans l'interface
 *   /lier@ComexaWork_bot 944330   forme envoyee par Telegram depuis le menu
 *                                 des commandes ou dans un groupe
 *   /Lier 944 330           casse et separateurs indifferents
 *   lier 944330             la barre oblique oubliee (6 chiffres exiges)
 *   /start lier_944330      lien profond t.me/ComexaWork_bot?start=lier_944330
 */
export function parseTelegramMessage(
  text: unknown,
  botUsername: string = TELEGRAM_BOT_USERNAME,
): ParsedTelegramMessage {
  if (typeof text !== 'string') return { kind: 'text' };
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'text' };

  // La barre oblique oubliee : « lier 944330 ». Exige un code complet pour ne
  // jamais confondre une phrase (« lier mon compte ») avec une commande.
  const bare =
    /^lier\s+([\d\u0660-\u0669\u06F0-\u06F9][\d\u0660-\u0669\u06F0-\u06F9\s._-]*)$/i.exec(trimmed);
  if (bare) {
    const code = normalizePairingCode(bare[1]);
    if (code) return { kind: 'link', code };
  }

  if (!trimmed.startsWith('/')) return { kind: 'text' };

  const [token = '', ...rest] = trimmed.split(/\s+/);
  const argument = rest.join(' ').trim();
  const match = /^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?$/i.exec(token);
  if (!match) return { kind: 'text' };

  const command = match[1]!.toLowerCase();
  const addressedTo = match[2];
  if (addressedTo && addressedTo.toLowerCase() !== botUsername.toLowerCase()) {
    return { kind: 'foreign-bot' };
  }

  if (command === 'lier') {
    if (!argument) return { kind: 'link-usage' };
    const code = normalizePairingCode(argument);
    return code ? { kind: 'link', code } : { kind: 'link-invalid', argument };
  }

  if (command === 'start') {
    const payload = /^lier[_-]?(\d{6})$/i.exec(argument);
    if (payload) return { kind: 'link', code: payload[1]! };
  }

  return { kind: 'other-command', command };
}

// -----------------------------------------------------------------------------
// Reponses du bot
// -----------------------------------------------------------------------------

/**
 * Issue d'une commande de liaison, telle que la lit le workflow n8n.
 *
 * `ok` n'est VRAI que si la liaison est effectivement enregistree en base
 * (ou deja en place pour ce meme compte Telegram) : le bot ne doit jamais
 * confirmer une liaison qui n'a pas eu lieu.
 */
export type TelegramLinkOutcome =
  | 'linked'
  | 'relinked'
  | 'refreshed'
  | 'already_linked'
  | 'usage'
  | 'invalid_format'
  | 'invalid_code'
  | 'expired_code'
  | 'conflict'
  | 'account_inactive'
  | 'group_chat'
  | 'server_error';

export interface TelegramReplyContext {
  readonly firstName?: string | null;
  readonly email?: string | null;
  readonly previousTelegramUsername?: string | null;
}

/** Statuts qui confirment une liaison REELLEMENT en place. */
export const SUCCESS_OUTCOMES: ReadonlySet<TelegramLinkOutcome> = new Set([
  'linked',
  'relinked',
  'refreshed',
  'already_linked',
]);

/** Texte a renvoyer tel quel dans la conversation Telegram (francais, sans balisage). */
export function telegramReply(
  outcome: TelegramLinkOutcome,
  context: TelegramReplyContext = {},
): string {
  const first = context.firstName?.trim() ?? '';
  /** Apostrophe d'appel : « C'est fait, Thomas : … ». */
  const name = first ? `, ${first}` : '';
  const account = context.email ? ` (${context.email})` : '';
  switch (outcome) {
    case 'linked':
      return `C'est fait${name} : votre compte Telegram est maintenant lié à votre compte Comexa${account}. Vous pouvez écrire au bot, il agira avec vos droits.`;
    case 'relinked':
      return context.previousTelegramUsername
        ? `Liaison mise à jour${name} : ce compte Telegram remplace @${context.previousTelegramUsername} pour votre compte Comexa${account}.`
        : `Liaison mise à jour${name} : ce compte Telegram remplace l'ancien pour votre compte Comexa${account}.`;
    case 'refreshed':
      return `Liaison confirmée${name} : ce compte Telegram était déjà lié à votre compte Comexa${account}. Rien d'autre à faire.`;
    case 'already_linked':
      return `Ce compte Telegram est déjà lié au compte Comexa${first ? ` de ${first}` : ''}${account}. Aucune action n'est nécessaire.`;
    case 'usage':
      return `Pour lier votre compte, générez un code dans ${WHERE_TO_GENERATE}, puis envoyez ici : /lier 123456 (en remplaçant par votre code).`;
    case 'invalid_format':
      return `Le code doit comporter exactement 6 chiffres. Exemple : /lier 123456. Le code se génère dans ${WHERE_TO_GENERATE}.`;
    case 'invalid_code':
      return `Ce code est invalide ou a déjà été utilisé. Générez un nouveau code dans ${WHERE_TO_GENERATE} : il reste valable ${PAIRING_CODE_TTL_MINUTES} minutes.`;
    case 'expired_code':
      return `Ce code a expiré (validité : ${PAIRING_CODE_TTL_MINUTES} minutes). Générez-en un nouveau dans ${WHERE_TO_GENERATE}, puis renvoyez /lier suivi du nouveau code.`;
    case 'conflict':
      return `Ce compte Telegram est déjà lié à un autre compte Comexa. Déliez-le d'abord depuis ce compte (${WHERE_TO_GENERATE} > Déconnecter), puis réessayez.`;
    case 'account_inactive':
      return "Ce compte Comexa n'est pas actif : la liaison est impossible. Contactez un administrateur Comexa.";
    case 'group_chat':
      return `Pour votre sécurité, envoyez la commande /lier en message privé à @${TELEGRAM_BOT_USERNAME}, jamais dans un groupe. Aucun code n'a été utilisé.`;
    case 'server_error':
    default:
      return `La liaison n'a pas pu être confirmée à cause d'une erreur du serveur Comexa. Vérifiez l'état dans ${WHERE_TO_GENERATE} avant de réessayer dans un instant.`;
  }
}

/**
 * Code d'erreur metier (renvoye par `verifyCode`) -> issue de la commande.
 * Tout code inconnu est une erreur serveur : on ne confirme rien.
 */
export function outcomeForErrorCode(code: string | null | undefined): TelegramLinkOutcome {
  switch (code) {
    case 'TELEGRAM_CODE_INVALID':
      return 'invalid_code';
    case 'TELEGRAM_CODE_EXPIRED':
      return 'expired_code';
    case 'TELEGRAM_ALREADY_LINKED':
      return 'conflict';
    case 'TELEGRAM_LINK_UNUSABLE':
      return 'account_inactive';
    default:
      return 'server_error';
  }
}

/** Les types de conversation Telegram ou une liaison est refusee. */
export function isGroupChat(chatType: unknown): boolean {
  return chatType === 'group' || chatType === 'supergroup' || chatType === 'channel';
}
