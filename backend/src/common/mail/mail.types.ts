/**
 * Contrats du module de courriel.
 *
 * DEUX TRANSPORTS, UNE SEULE INTERFACE. Le SMTP et l'API HTTP de Mailjet font le
 * meme travail par des chemins differents, et `MailTransport` est ce qui permet
 * a `MailService` de ne pas le savoir. Sans cette abstraction, chaque gabarit
 * aurait eu a choisir son transport, et les trois gabarits se seraient
 * desaccordes au premier changement.
 *
 * L'ABSTRACTION A DEJA PAYE, ET PAS D'UNE FACON THEORIQUE. Un premier
 * fournisseur a ete remplace parce que son compte etait inutilisable :
 * verification par SMS impossible depuis le pays de l'exploitant. Le changement a
 * touche un fichier de transport, une ligne dans `resolveTransport()`, deux
 * variables d'environnement et ce contrat-ci. Aucun des trois gabarits, aucune
 * des routes qui declenchent un envoi, aucun test d'integration n'a ete modifie.
 * C'est la raison d'etre de `MailTransport`, verifiee sur un cas reel plutot que
 * supposee.
 *
 * POURQUOI DEUX TRANSPORTS PLUTOT QU'UN. Parce que le SMTP n'est pas toujours
 * joignable : plusieurs hebergeurs gratuits bloquent en sortie les ports 25, 465
 * et 587 pour empecher le spam. Sur ces plateformes, un service qui ne parle que
 * SMTP demarre normalement et echoue a chaque envoi, en silence — l'erreur n'est
 * pas une authentification refusee mais une connexion qui n'aboutit jamais. L'API
 * HTTP passe par le port 443, qui n'est jamais bloque : c'est le meme port que
 * celui par lequel l'application repond.
 */

/** Courriel pret a partir : le contenu est deja rendu par un gabarit. */
export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Identifiant du transport, utilise pour la trace de demarrage.
 *
 * Il est expose parce que « pourquoi ce courriel n'est-il pas parti » se repond
 * d'abord en lisant quel transport est actif — la meme raison qui fait que le
 * module de stockage annonce son pilote au demarrage.
 */
export type MailTransportKind = 'mailjet-api' | 'smtp';

/**
 * Adresse d'expedition decomposee.
 *
 * Le fournisseur refuse un envoi dont l'expediteur n'est pas verifie, et l'API
 * HTTP attend l'adresse et le nom SEPARES, la ou le SMTP attend une seule chaine
 * (« Comexa <no-reply@comexa.com> »). Les deux transportent donc les memes deux
 * champs, et la decomposition se fait une fois, a la construction.
 */
export interface MailAddress {
  email: string;
  name?: string;
}

/** Interface commune aux deux transports. */
export interface MailTransport {
  readonly kind: MailTransportKind;
  /**
   * Envoie le courriel, et ne resout QUE si le fournisseur l'a REELLEMENT
   * accepte.
   *
   * CETTE PHRASE EST UNE EXIGENCE, PAS UNE DESCRIPTION. Un transport peut
   * recevoir un HTTP 200 en accompagnement d'un refus : c'est le cas de Mailjet,
   * ou le rejet vit dans le corps de la reponse sous `Messages[].Status`. Un
   * transport qui se fierait au seul code HTTP resoudrait donc en annoncant un
   * succes sur un courriel rejete, et l'appelant — qui considere une promesse
   * tenue comme une promesse d'envoi — n'aurait plus aucun moyen de le savoir.
   * Chaque implementation lit donc le CORPS, et leve aussi bien sur un refus que
   * sur un statut illisible : le doute n'est pas un succes.
   */
  send(mail: OutgoingMail): Promise<void>;
  /**
   * Libere les ressources du transport.
   *
   * Synchrone et sans parametre parce que c'est ce que `onModuleDestroy` peut
   * appeler sans attendre. Le transport HTTP n'a rien a fermer et fournit une
   * implementation vide : mieux vaut une methode qui ne fait rien qu'un cas
   * particulier dans l'appelant.
   */
  close(): void;
}

/**
 * Reglages du transport SMTP.
 *
 * `from` est un `MailAddress` et non la chaine d'origine, pour que les DEUX
 * transports partagent une seule representation de l'expediteur et passent par
 * le meme `parseSender`. Le SMTP recompose l'en-tete (`formatFromHeader`) ; sans
 * cela, la validation de l'expediteur n'aurait lieu que sur le chemin HTTP, et
 * une adresse malformee ne se verrait qu'apres avoir bascule de transport.
 */
export interface SmtpOptions {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: MailAddress;
}

/**
 * Reglages du transport HTTP.
 *
 * DEUX CLES, ET CE N'EST PAS UNE NEGLIGENCE : Mailjet authentifie en HTTP Basic,
 * avec une cle publique en guise d'identifiant et une cle secrete en guise de
 * mot de passe. Fournir la seule cle publique donne un 401 qui ne dit pas
 * laquelle des deux manque.
 */
export interface MailjetApiOptions {
  apiKey: string;
  secretKey: string;
  from: MailAddress;
  /** Delai au-dela duquel l'appel est abandonne. Voir la valeur par defaut. */
  timeoutMs?: number;
}
