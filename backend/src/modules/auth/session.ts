/**
 * Contexte d'une session, tel que `RefreshToken` le conserve.
 *
 * On garde l'agent et l'adresse IP d'ou chaque session a ete ouverte, pour deux
 * raisons concretes :
 *
 *  - l'utilisateur peut voir ses sessions actives et en fermer une (« ce n'est
 *    pas moi, deconnecte cet appareil »). Sans ces deux champs, la liste serait
 *    une suite d'identifiants opaques, inutilisable pour ce jugement ;
 *  - lors d'une detection de reutilisation de jeton, un agent et une IP
 *    differents de ceux de la session d'origine sont un signal supplementaire.
 *
 * Ce ne sont PAS des facteurs d'authentification : ni l'un ni l'autre n'est
 * verifie pour autoriser quoi que ce soit. Une IP change en permanence (reseau
 * mobile, VPN), et un agent se falsifie en une ligne.
 */
export interface SessionMeta {
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
}

export const UNKNOWN_SESSION: SessionMeta = { userAgent: null, ipAddress: null };
