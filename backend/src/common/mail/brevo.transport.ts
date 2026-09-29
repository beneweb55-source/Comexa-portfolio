import type { Logger } from '@nestjs/common';
import type { BrevoApiOptions, MailAddress, MailTransport, OutgoingMail } from './mail.types.js';

/**
 * Transport HTTP de Brevo (`POST /v3/smtp/email`, port 443).
 *
 * POURQUOI CE FICHIER EXISTE. Le SMTP ne suffit plus : plusieurs hebergeurs
 * gratuits bloquent en sortie les ports 25, 465 et 587 pour empecher le spam.
 * Sur ces plateformes, `smtp-relay.brevo.com:587` ne renvoie pas une erreur
 * d'authentification — la connexion n'aboutit simplement jamais. Le service
 * demarre, chaque envoi echoue en silence, et rien dans les journaux ne le dit.
 * Le port 443 n'est jamais bloque, parce que c'est celui par lequel l'API
 * repond : le courriel sort donc par le meme chemin que les requetes.
 *
 * AUCUNE DEPENDANCE AJOUTEE. `fetch` et `AbortSignal.timeout` sont fournis par
 * Node (18 et suivants) et types par `@types/node`. Une bibliotheque cliente
 * Brevo aurait apporte un arbre de dependances pour un seul appel POST.
 *
 * CE QUE CE TRANSPORT NE FAIT PAS : il ne gere ni piece jointe, ni envoi
 * multiple. Le backend n'envoie que des courriels transactionnels a un seul
 * destinataire, et un transport qui saurait faire plus serait du code que
 * personne n'aurait jamais execute.
 */

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/**
 * Delai avant abandon de l'appel.
 *
 * Plus long que le delai d'un appel interne : Brevo est un tiers, et l'envoi
 * d'une facture peut attendre quinze secondes sans que l'utilisateur le
 * remarque, alors qu'une attente infinie bloquerait la requete HTTP qui l'a
 * declenche. Ce delai est ce qui transforme une panne de reseau en erreur
 * exploitable plutot qu'en requete qui ne repond jamais.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Taille maximale du corps d'erreur conserve dans le message. */
const MAX_ERROR_BODY = 400;

/**
 * Decompose `SMTP_FROM` en adresse et nom.
 *
 * L'API HTTP attend `{ email, name }` la ou le SMTP attend une chaine unique
 * (« Comexa <no-reply@comexa.com> »). La variable reste donc au format SMTP, et
 * la decomposition se fait ici : deux variables pour la meme information
 * finiraient par se desaccorder, et c'est l'expediteur qui est verifie chez
 * Brevo, donc celui dont un desaccord se voit.
 *
 * Une adresse syntaxiquement impossible LEVE, au demarrage. Un expediteur
 * malforme ne produirait sinon que des 400 a chaque envoi, c'est-a-dire une
 * panne decouverte par un client qui ne recoit pas son lien de reinitialisation.
 */
export function parseSender(raw: string): MailAddress {
  const value = raw.trim();
  const angled = /^(.*?)\s*<\s*([^<>]+?)\s*>$/.exec(value);

  // Les groupes sont lus avec un repli explicite, et non par confiance :
  // `noUncheckedIndexedAccess` les type `string | undefined`. Le groupe 1 est
  // `.*?`, donc legitimement vide (« <a@b.c> », sans nom d'affichage) ; le
  // groupe 2 est exige par le motif, mais s'il etait vide la verification
  // d'adresse plus bas leve avec un message qui dit quoi corriger, ce qu'un
  // `!` n'aurait pas fait.
  const name = angled ? unquote((angled[1] ?? '').trim()) : '';
  const email = unquote((angled ? (angled[2] ?? '') : value).trim());

  if (!email.includes('@')) {
    throw new Error(
      `SMTP_FROM ne contient pas d'adresse d'expedition valide : « ${raw} ». ` +
        'Format attendu : « Comexa <no-reply@comexa.com> » ou « no-reply@comexa.com ». ' +
        "L'adresse doit etre un expediteur valide chez Brevo (Senders, Domains & Dedicated IPs).",
    );
  }

  return name ? { email, name } : { email };
}

/**
 * Construit le transport HTTP.
 *
 * `logger` est reduit a ce qui est reellement utilise (`Pick`), pour que le
 * spec puisse fournir un espion sans construire un `Logger` complet.
 */
export function createBrevoApiTransport(
  options: BrevoApiOptions,
  logger: Pick<Logger, 'debug'>,
): MailTransport {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    kind: 'brevo-api',

    async send(mail: OutgoingMail): Promise<void> {
      const payload = {
        sender: options.from.name
          ? { email: options.from.email, name: options.from.name }
          : { email: options.from.email },
        to: [{ email: mail.to }],
        subject: mail.subject,
        textContent: mail.text,
        htmlContent: mail.html,
      };

      let response: Response;
      try {
        response = await fetch(BREVO_ENDPOINT, {
          method: 'POST',
          headers: {
            'api-key': options.apiKey,
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // `fetch` ne rejette que sur une panne de transport : DNS, TLS, port
        // filtre, ou delai depasse. Aucune reponse HTTP n'existe a ce stade.
        // C'est exactement la signature d'un SMTP bloque — sauf qu'ici l'echec
        // est immediat et nomme, au lieu d'etre une attente sans fin.
        throw new Error(
          `API Brevo injoignable (${BREVO_ENDPOINT}, port 443) apres ${timeoutMs} ms : ` +
            `${redact(describeError(error), options.apiKey)}.`,
        );
      }

      // Le corps est masque AVANT d'etre lu par qui que ce soit : il vient d'un
      // tiers, et rien ne garantit qu'il ne recopie pas la requete entrante,
      // en-tete `api-key` compris.
      const body = redact(await readBody(response), options.apiKey);

      if (!response.ok) {
        // La cle d'API n'apparait nulle part ici : ni dans le message, ni dans
        // le corps conserve. Un message d'erreur se retrouve dans les journaux
        // d'un hebergeur, et un secret dans un journal est un secret perdu.
        throw new Error(
          `API Brevo a refuse l'envoi a ${mail.to} : HTTP ${response.status}` +
            `${reasonFrom(body)}.${hintFor(response.status, body)}`,
        );
      }

      // `messageId` est l'identifiant de l'envoi dans Brevo. Trace en `debug` :
      // la trace de demarrage dit QUEL transport est actif, celle-ci dit ce
      // qu'il est advenu d'un courriel precis. Le destinataire n'y figure pas —
      // un journal n'a pas a contenir d'adresse.
      logger.debug(`Courriel accepte par Brevo (${messageIdFrom(body) ?? 'sans identifiant'}).`);
    },

    close(): void {
      // Rien a fermer : `fetch` ouvre et referme sa connexion a chaque appel.
    },
  };
}

/**
 * Retire une valeur d'un texte destine aux journaux.
 *
 * Le corps d'une reponse d'erreur vient d'un tiers : rien ne garantit qu'il ne
 * recopie pas la requete entrante, en-tete `api-key` compris — les passerelles
 * intermediaires le font couramment. Or ces messages finissent dans les journaux
 * de l'hebergeur, ou une cle d'API d'envoi vaut un acces complet au compte.
 *
 * Le remplacement a lieu AVANT toute composition de message, jamais apres : un
 * filtre applique au message final laisserait passer les chemins qui n'y
 * pensent pas.
 *
 * `split`/`join` plutot qu'une expression reguliere : la cle est une donnee
 * externe, et une expression construite a partir d'elle aurait a echapper ses
 * propres metacaracteres. Une valeur vide est ignoree, sans quoi le remplacement
 * decouperait le texte caractere par caractere.
 */
function redact(text: string, secret: string): string {
  if (!secret) {
    return text;
  }
  return text.split(secret).join('[cle masquee]');
}

/** Enleve les guillemets qui entourent un nom ou une adresse, s'ils sont apparies. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1).trim();
    }
  }
  return value;
}

/** Nom et message d'une erreur, sans supposer qu'elle en soit une. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/** Corps de la reponse, borne, sans jamais faire echouer l'appelant. */
async function readBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, MAX_ERROR_BODY);
  } catch {
    return '';
  }
}

/** `code` et `message` de Brevo, mis bout a bout s'ils sont presents. */
function reasonFrom(body: string): string {
  const parsed = parseJson(body);
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    const parts = [record['code'], record['message']]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' : ');
    if (parts) {
      return ` — ${parts}`;
    }
  }
  return body ? ` — ${body}` : '';
}

/**
 * Piste de resolution attachee aux deux echecs qui ont une cause connue.
 *
 * Sans cela, « HTTP 401 » et « HTTP 400 » se ressemblent : ce sont les deux
 * erreurs de configuration les plus probables au premier deploiement, et
 * chacune a une seule cause. La piste est ecrite ici plutot que dans la
 * documentation parce que c'est au moment de lire le journal qu'elle sert.
 */
function hintFor(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return (
      ' Verifier BREVO_API_KEY : la cle se genere dans Brevo, menu SMTP & API,' +
      " onglet API Keys. Celle de l'onglet SMTP (xkeysib-...) ne convient pas ici."
    );
  }
  if (status === 400 && /sender|expediteur/i.test(body)) {
    return (
      ' Verifier que SMTP_FROM correspond a un expediteur valide dans Brevo' +
      ' (Senders, Domains & Dedicated IPs).'
    );
  }
  return '';
}

/** Identifiant d'envoi renvoye par Brevo, s'il est lisible. */
function messageIdFrom(body: string): string | undefined {
  const parsed = parseJson(body);
  if (parsed && typeof parsed === 'object') {
    const value = (parsed as Record<string, unknown>)['messageId'];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/** `JSON.parse` sans exception : un corps non-JSON est un cas normal, pas une erreur. */
function parseJson(body: string): unknown {
  if (!body) {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
