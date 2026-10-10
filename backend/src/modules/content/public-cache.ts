/**
 * PURGE DU CACHE DU SITE PUBLIC.
 *
 * Le site public (Next.js) garde ses lectures de contenu une heure. Sans purge,
 * une correction faite dans l'espace équipe (une coquille dans un service, un
 * partenaire retiré) reste visible jusqu'à une heure. Cette purge est déclenchée
 * par l'API après chaque écriture du contenu.
 *
 * Le mécanisme est volontairement simple :
 *  - l'API appelle `POST <FRONTEND_URL>/api/revalidate` avec un secret partagé
 *    (`REVALIDATE_SECRET`) ;
 *  - le frontend invalide le tag `public-content` (toutes les lectures publiques
 *    en portent un) et les chemins des pages vitrines.
 *
 * ÉCHEC SANS CONSÉQUENCE POUR L'ÉCRITURE. La donnée est déjà enregistrée quand la
 * purge part. Si le frontend est arrêté ou si le secret manque, l'écriture reste
 * réussie et le cache expire seul : on journalise, on ne fait pas échouer l'écran
 * de l'agence.
 */
export const PUBLIC_CONTENT_TAG = 'public-content';

/** Pages vitrines qui lisent le contenu public. Garder synchronisé avec le frontend. */
export const PUBLIC_CONTENT_PATHS = ['/', '/services', '/realisations', '/partenaires'] as const;
