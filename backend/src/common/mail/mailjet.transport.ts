import type { Logger } from '@nestjs/common';
import type { MailjetApiOptions, MailTransport, OutgoingMail } from './mail.types.js';

/**
 * Transport HTTP de Mailjet (`POST /v3.1/send`, port 443).
 *
 * POURQUOI CE FICHIER EXISTE. Le SMTP ne suffit plus : plusieurs hebergeurs
 * gratuits bloquent en sortie les ports 25, 465 et 587 pour empecher le spam.
 * Sur ces plateformes, la connexion vers un relais SMTP n'aboutit jamais au lieu
 * d'echouer franchement : le service demarre, chaque envoi echoue en silence, et
 * rien dans les journaux ne le dit. Le port 443 n'est jamais bloque, parce que
 * c'est celui par lequel l'API repond : le courriel sort donc par le meme chemin
 * que les requetes.
 *
 * LE PIEGE DE CETTE API, ET LA RAISON DE LA MOITIE DE CE FICHIER. Mailjet
 * repond **HTTP 200 alors qu'il a rejete le message**. Le refus n'est pas dans le
 * code de statut mais dans le CORPS : `Messages[].Status` vaut `"error"`, et le
 * vrai code se trouve dans `Errors[].StatusCode`. Un transport qui se contente
 * de tester `response.ok` annonce donc un succes sur un courriel refuse — le
 * pire des deux mensonges possibles, puisque personne ne cherchera la panne du
 * cote de l'envoi. C'est pourquoi `verdictFrom()` est appele APRES le controle
 * de `response.ok`, et pourquoi une reponse dont le statut est illisible est
 * traitee comme un echec et non comme un succes (voir `Verdict`).
 *
 * CE QUE CE TRANSPORT NE PEUT PAS DETECTER, ET QU'IL FAUT SAVOIR. L'offre
 * gratuite de Mailjet plafonne a 200 messages par jour ; au-dela, les appels
 * continuent de repondre un succes et le courriel est abandonne SANS AUCUN objet
 * d'erreur. Aucun code de ce fichier ne peut voir cette perte : elle n'existe
 * nulle part dans la reponse. Le meme silence vaut pour un expediteur dont
 * l'adresse n'a pas ete activee. Ces deux cas se diagnostiquent dans le tableau
 * de bord Mailjet, pas ici, et c'est la seule raison pour laquelle le journal de
 * succes porte l'identifiant du message : il permet de verifier l'envoi a la
 * source quand un destinataire affirme n'avoir rien recu.
 *
 * AUCUNE DEPENDANCE AJOUTEE. `fetch`, `AbortSignal.timeout` et `Buffer` sont
 * fournis par Node et types par `@types/node`. Une bibliotheque cliente Mailjet
 * aurait apporte un arbre de dependances pour un seul appel POST.
 *
 * CE QUE CE TRANSPORT NE FAIT PAS : il ne gere ni piece jointe, ni envoi
 * multiple. Le backend n'envoie que des courriels transactionnels a un seul
 * destinataire, et un transport qui saurait faire plus serait du code que
 * personne n'aurait jamais execute.
 */

export const MAILJET_ENDPOINT = 'https://api.mailjet.com/v3.1/send';

/**
 * Delai avant abandon de l'appel.
 *
 * Plus long que le delai d'un appel interne : Mailjet est un tiers, et l'envoi
 * d'une facture peut attendre quinze secondes sans que l'utilisateur le
 * remarque, alors qu'une attente infinie bloquerait la requete HTTP qui l'a
 * declenche. Ce delai est ce qui transforme une panne de reseau en erreur
 * exploitable plutot qu'en requete qui ne repond jamais.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Taille maximale du corps d'erreur conserve dans le message. */
const MAX_ERROR_BODY = 400;

/**
 * Resultat de la lecture du corps, quand le code HTTP n'a pas deja tranche.
 *
 * `unconfirmed` existe parce que le silence n'est pas un accord. Une reponse
 * dont on ne sait pas lire le statut ne prouve pas que le courriel est parti, et
 * la declarer acceptee reproduirait exactement le mensonge que ce fichier est
 * ecrit pour empecher.
 */
type Verdict =
  | { accepted: true; messageId?: string }
  | {
      accepted: false;
      reason: 'rejected' | 'unconfirmed';
      status: number;
      detail: string;
    };

/**
 * Construit le transport HTTP.
 *
 * `logger` est reduit a ce qui est reellement utilise (`Pick`), pour que le spec
 * puisse fournir un espion sans construire un `Logger` complet.
 */
export function createMailjetApiTransport(
  options: MailjetApiOptions,
  logger: Pick<Logger, 'debug'>,
): MailTransport {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Mailjet authentifie en HTTP Basic, avec la cle publique et la cle secrete
  // jointes par deux points. Les DEUX clefs sont necessaires : contrairement a
  // d'autres fournisseurs ou une seule cle suffit, une cle publique seule est
  // refusee, et l'erreur renvoyee (401) ne dit pas laquelle manque.
  const credentials = `${options.apiKey}:${options.secretKey}`;
  const authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;

  // Les valeurs a masquer avant toute ecriture dans les journaux. L'en-tete
  // complet y figure : une passerelle qui recopie la requete entrante recopie
  // l'en-tete `authorization`, donc les deux clefs en base64 — masquer les clefs
  // seules ne suffirait pas.
  const secrets = [options.apiKey, options.secretKey, credentials, authorization.slice(6)];

  return {
    kind: 'mailjet-api',

    async send(mail: OutgoingMail): Promise<void> {
      const payload = {
        Messages: [
          {
            From: options.from.name
              ? { Email: options.from.email, Name: options.from.name }
              : { Email: options.from.email },
            // Un seul destinataire, et un objet `To` par entree. Mailjet avertit
            // que tous les destinataires d'une meme entree se voient entre eux :
            // une liste ici exposerait les clients les uns aux autres.
            To: [{ Email: mail.to }],
            Subject: mail.subject,
            TextPart: mail.text,
            HTMLPart: mail.html,
            // Mailjet veut du base64 dans `Base64Content`, et n'accepte pas un
            // tableau vide : il le refuse comme piece jointe invalide. Le champ
            // n'est donc ajoute que s'il y a vraiment quelque chose a joindre,
            // ce qui laisse la charge utile identique pour les autres envois.
            ...(mail.attachments?.length
              ? {
                  Attachments: mail.attachments.map((a) => ({
                    ContentType: a.contentType,
                    Filename: a.filename,
                    Base64Content: a.content.toString('base64'),
                  })),
                }
              : {}),
          },
        ],
      };

      let response: Response;
      try {
        response = await fetch(MAILJET_ENDPOINT, {
          method: 'POST',
          headers: {
            authorization,
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
          `API Mailjet injoignable (${MAILJET_ENDPOINT}, port 443) apres ${timeoutMs} ms : ` +
            `${redact(describeError(error), secrets)}.`,
        );
      }

      // Le corps est masque AVANT d'etre lu par qui que ce soit : il vient d'un
      // tiers, et rien ne garantit qu'il ne recopie pas la requete entrante,
      // en-tete `authorization` compris.
      const body = redact(await readBody(response), secrets);

      if (!response.ok) {
        // La cle n'apparait nulle part ici : ni dans le message, ni dans le
        // corps conserve. Un message d'erreur se retrouve dans les journaux d'un
        // hebergeur, et un secret dans un journal est un secret perdu.
        throw new Error(
          `API Mailjet a refuse l'envoi a ${mail.to} : HTTP ${response.status}` +
            `${reasonFrom(body)}.${hintFor(response.status, body)}`,
        );
      }

      // LE CONTROLE QUI COMPTE. HTTP 200 ne veut pas dire « accepte » : le refus
      // est dans le corps. Cette lecture a lieu apres le controle ci-dessus, et
      // jamais a sa place.
      const verdict = verdictFrom(body, response.status);

      if (verdict.accepted) {
        // `MessageUUID` est l'identifiant de l'envoi chez Mailjet. Trace en
        // `debug` : la trace de demarrage dit QUEL transport est actif, celle-ci
        // dit ce qu'il est advenu d'un courriel precis. Le destinataire n'y
        // figure pas — un journal n'a pas a contenir d'adresse.
        logger.debug(`Courriel accepte par Mailjet (${verdict.messageId ?? 'sans identifiant'}).`);
        return;
      }

      // Deux echecs distincts, et le message doit dire lequel : « rejete »
      // affirme que Mailjet a vu le courriel et l'a refuse, « non confirme »
      // avoue qu'on ne sait pas. Les confondre enverrait chercher une cause
      // connue la ou il n'y en a peut-etre pas.
      throw new Error(
        (verdict.reason === 'rejected'
          ? `API Mailjet a rejete l'envoi a ${mail.to} : ${verdict.detail}`
          : `API Mailjet n'a pas confirme l'envoi a ${mail.to} : ${verdict.detail}`) +
          `.${hintFor(verdict.status, verdict.detail)}`,
      );
    },

    close(): void {
      // Rien a fermer : `fetch` ouvre et referme sa connexion a chaque appel.
    },
  };
}

/**
 * Lit le corps et en tire un verdict ferme.
 *
 * LA REGLE EST « un succes doit etre ECRIT ». Tout le reste — un statut absent,
 * une reponse non-JSON, un tableau `Messages` vide — est declare non confirme.
 * La regle inverse (« chercher une erreur, et se declarer satisfait si on n'en
 * trouve pas ») echouerait ouvertement sur le seul cas qui compte : une reponse
 * que Mailjet aurait changee ou tronquee, et sur laquelle on annoncerait un
 * succes sans rien avoir lu qui le dise.
 *
 * `httpStatus` sert de repli quand `Errors[].StatusCode` est absent : c'est le
 * code que Mailjet met dans son propre corps, et il vaut mieux que rien.
 */
function verdictFrom(body: string, httpStatus: number): Verdict {
  const parsed = parseJson(body);

  if (!parsed || typeof parsed !== 'object') {
    return {
      accepted: false,
      reason: 'unconfirmed',
      status: httpStatus,
      detail: 'reponse illisible (corps non-JSON)',
    };
  }

  const messages = (parsed as Record<string, unknown>)['Messages'];

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      accepted: false,
      reason: 'unconfirmed',
      status: httpStatus,
      detail: 'reponse sans tableau « Messages »',
    };
  }

  const first = messages[0];

  if (!first || typeof first !== 'object') {
    return {
      accepted: false,
      reason: 'unconfirmed',
      status: httpStatus,
      detail: 'entree « Messages[0] » illisible',
    };
  }

  const record = first as Record<string, unknown>;
  const status = record['Status'];

  if (typeof status !== 'string') {
    return {
      accepted: false,
      reason: 'unconfirmed',
      status: httpStatus,
      detail: 'aucun champ « Status » dans la reponse',
    };
  }

  if (status.toLowerCase() === 'success') {
    return { accepted: true, messageId: messageIdOf(record) };
  }

  // `Status` peut valoir autre chose que « error » (Mailjet documente aussi des
  // etats d'attente). Le message doit alors reprendre la valeur REELLE plutot
  // que d'affirmer « error » : c'est elle qui orientera la recherche.
  return {
    accepted: false,
    reason: 'rejected',
    status: errorStatusOf(record) ?? httpStatus,
    detail: errorDetailOf(record, status),
  };
}

/**
 * Met les erreurs de Mailjet bout a bout.
 *
 * `ErrorMessage` d'abord, `ErrorCode` en repli : le premier se lit, le second se
 * cherche dans leur documentation. `ErrorRelatedTo` est ajoute quand il est
 * present, parce qu'il designe le champ fautif (`Messages.0.To`, par exemple) et
 * fait gagner le seul temps qui compte — celui passe a deviner.
 */
function errorDetailOf(record: Record<string, unknown>, fallbackStatus: string): string {
  const errors = record['Errors'];

  if (!Array.isArray(errors)) {
    return `statut « ${fallbackStatus} » sans detail`;
  }

  const parts: string[] = [];

  for (const entry of errors) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const error = entry as Record<string, unknown>;
    const label = firstString(error['ErrorMessage'], error['ErrorCode']);

    if (!label) {
      continue;
    }

    const related = error['ErrorRelatedTo'];
    const where = Array.isArray(related)
      ? related.filter((item): item is string => typeof item === 'string').join(', ')
      : '';

    parts.push(where ? `${label} (${where})` : label);
  }

  return parts.length > 0 ? parts.join(' ; ') : `statut « ${fallbackStatus} » sans detail`;
}

/** Premier `StatusCode` numerique trouve dans `Errors[]`. */
function errorStatusOf(record: Record<string, unknown>): number | undefined {
  const errors = record['Errors'];

  if (!Array.isArray(errors)) {
    return undefined;
  }

  for (const entry of errors) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const value = (entry as Record<string, unknown>)['StatusCode'];

    if (typeof value === 'number') {
      return value;
    }
  }

  return undefined;
}

/** Premier destinataire renseigne, pour en tirer l'identifiant du message. */
function messageIdOf(record: Record<string, unknown>): string | undefined {
  const to = record['To'];

  if (!Array.isArray(to)) {
    return undefined;
  }

  for (const entry of to) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const value = (entry as Record<string, unknown>)['MessageUUID'];

    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

/**
 * Retire des valeurs sensibles d'un texte destine aux journaux.
 *
 * Le corps d'une reponse d'erreur vient d'un tiers : rien ne garantit qu'il ne
 * recopie pas la requete entrante, en-tete `authorization` compris — les
 * passerelles intermediaires le font couramment. Or ces messages finissent dans
 * les journaux de l'hebergeur, ou une cle d'envoi vaut un acces complet au
 * compte.
 *
 * Le remplacement a lieu AVANT toute composition de message, jamais apres : un
 * filtre applique au message final laisserait passer les chemins qui n'y
 * pensent pas.
 *
 * `split`/`join` plutot qu'une expression reguliere : les clefs sont des donnees
 * externes, et une expression construite a partir d'elles aurait a echapper ses
 * propres metacaracteres. Une valeur vide est ignoree, sans quoi le remplacement
 * decouperait le texte caractere par caractere.
 */
function redact(text: string, secrets: string[]): string {
  let output = text;

  for (const secret of secrets) {
    if (secret) {
      output = output.split(secret).join('[cle masquee]');
    }
  }

  return output;
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

/** `code` et `message` d'un rejet global, mis bout a bout s'ils sont presents. */
function reasonFrom(body: string): string {
  const parsed = parseJson(body);

  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    const parts = [record['ErrorCode'], record['ErrorMessage']]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' : ');

    if (parts) {
      return ` — ${parts}`;
    }
  }

  return body ? ` — ${body}` : '';
}

/**
 * Piste de resolution attachee aux echecs qui ont une cause connue.
 *
 * Sans cela, deux erreurs de configuration tres differentes se ressemblent dans
 * le journal. La piste est ecrite ici plutot que dans la documentation parce que
 * c'est au moment de lire le journal qu'elle sert, et parce que ces trois causes
 * sont, dans l'ordre, celles du premier deploiement.
 */
function hintFor(status: number, text: string): string {
  if (status === 401 || status === 403) {
    return (
      ' Verifier MAILJET_API_KEY et MAILJET_SECRET_KEY : les deux se generent dans' +
      ' Mailjet, menu « API Key Management ». Le couple SMTP de Mailjet (SMTP_USER /' +
      ' SMTP_PASSWORD) ne convient pas ici, et une cle publique seule est refusee.'
    );
  }

  if (/sender|expediteur|from\b/i.test(text)) {
    return (
      " Verifier que SMTP_FROM correspond a une adresse d'expedition VALIDEE dans" +
      ' Mailjet (Sender domains & addresses) : Mailjet refuse tout expediteur non' +
      " verifie, et le lien d'activation part dans la boite de cette adresse-la."
    );
  }

  if (/limit|quota|too many|sandbox|test mode/i.test(text)) {
    return (
      " Un compte Mailjet neuf reste en « Test Mode » (10 courriels par heure) jusqu'a" +
      " la fin de leur verification manuelle. L'offre gratuite plafonne par ailleurs a" +
      ' 200 courriels par jour, et ce plafond-la ne produit AUCUNE erreur : les envois' +
      ' sont abandonnes en silence.'
    );
  }

  return '';
}

/** Premier texte non vide parmi les candidats. */
function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
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
