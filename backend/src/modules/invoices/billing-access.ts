import { AccessPolicy, SCOPE_ANY, SCOPE_OWN } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';

/**
 * PERIMETRE DE DONNEES DES PIECES COMPTABLES.
 *
 * Le garde (`PermissionsGuard`) autorise la ROUTE ; il ne dit rien des LIGNES.
 * Une route `GET /quotes` ouverte a `quote:read:any` et `quote:read:own` laisse
 * passer les deux porteurs, et c'est ici que l'on decide ce que chacun voit.
 *
 * LE POINT DE SECURITE, ET C'EST UNE EXIGENCE EXPLICITE DU CLIENT : l'identifiant
 * du client ne vient JAMAIS de la requete. Il vient de `policy.clientId`, c'est
 * a dire du rattachement du COMPTE authentifie. Un porteur CLIENT qui poste
 * `{ clientId: "autre-client" }` ou qui remplace l'identifiant dans l'URL ne
 * change donc rien : sa valeur est ecrasee par la seule qui soit fiable.
 *
 * Le filtre qui en decoule est pose DANS le `where` Prisma
 * (`{ clientId: policy.clientId }`), jamais dans un `if` apres lecture. La
 * difference n'est pas stylistique : un `if (!quote.clientId === policy.clientId)
 * throw` suppose que la ligne a ete lue, donc chargee en memoire, donc presente
 * dans le journal de requetes, dans un cache eventuel et dans la reponse si le
 * controle est oublie sur un seul chemin. Un `where` qui ne correspond pas ne
 * renvoie rien.
 */
export function clientPerimeter(
  policy: AccessPolicy,
  resource: string,
  action: string,
): string | null {
  // L'ORDRE EST FOURNI ICI, du plus large au plus etroit. Il n'y a pas de table
  // de precedence globale dans `AccessPolicy`, et c'est volontaire : `own` ne
  // designe pas la meme chose pour un devis (le client du devis) et pour une
  // tache (son assigne). Un ordre impose de l'exterieur finirait par accorder le
  // mauvais scope.
  const scope = policy.requireScope(resource, action, [SCOPE_ANY, SCOPE_OWN]);

  if (scope === SCOPE_ANY) {
    return null;
  }

  const clientId = policy.clientId;

  if (!clientId) {
    // Detenir `quote:read:own` sans etre rattache a un dossier client ne donne
    // acces a RIEN. Renvoyer `null` ici — « pas de filtre » — ouvrirait au
    // contraire l'acces a toutes les pieces : c'est exactement le genre de
    // valeur par defaut qui transforme une restriction en faille.
    throw AppException.forbidden('Aucun dossier client est rattache a ce compte.');
  }

  return clientId;
}

/**
 * Verifie qu'un corps de requete ne vise pas un autre dossier client.
 *
 * Utilise a la CREATION : un commercial peut choisir le client de son devis, un
 * porteur de l'espace client ne le peut pas. Aujourd'hui les routes de creation
 * exigent `:any` (qu'aucun role client ne detient), donc ce controle ne se
 * declenche pas — et c'est bien pour cela qu'il est ecrit : le jour ou une route
 * de creation sera ouverte a un porteur `own`, l'oubli serait invisible.
 *
 * Un porteur interne n'a pas de `clientId` : la fonction ne le contraint donc
 * pas, et c'est correct — c'est precisement lui qui choisit le client.
 */
export function assertRequestedClientAllowed(
  policy: AccessPolicy,
  requestedClientId: string | null | undefined,
): void {
  const ownClientId = policy.clientId;

  if (!ownClientId || requestedClientId === undefined || requestedClientId === null) {
    return;
  }

  if (requestedClientId !== ownClientId) {
    throw AppException.forbidden(
      'Vous ne pouvez agir que sur les documents de votre propre dossier client.',
    );
  }
}

/**
 * Perimetre de l'ACCEPTATION d'un devis : `null` pour un porteur interne, sinon
 * l'identifiant du dossier client, a poser dans le `where`.
 *
 * L'acceptation a DEUX porteurs possibles, et c'est le seul endroit du module ou
 * c'est le cas :
 *
 *  - le CLIENT, qui detient `quote:accept:own`. C'est le geste nominal : il
 *    accepte son devis depuis son espace. Son perimetre vient de son compte, donc
 *    d'un devis qui n'est pas le sien il ne peut rien faire — le filtre est dans
 *    le `where` de la lecture, pas dans un `if` apres coup ;
 *  - l'INTERNE (commercial, administrateur), qui enregistre une acceptation
 *    recue par courriel ou par telephone. Il n'a aucun dossier client : le
 *    filtrer par `policy.clientId` lui interdirait le geste, et le filtrer par un
 *    identifiant de requete ouvrirait exactement la faille que ce fichier
 *    surveille. Il n'est donc pas filtre — mais il doit detenir `quote:write:any`.
 *
 * POURQUOI `quote:write:any` ET PAS AUTRE CHOSE : le catalogue ne contient AUCUN
 * `quote:accept:any`. Le code le plus proche est `quote:write:any` (« creer et
 * modifier les devis »), detenu par SALES, PROJECT_MANAGER et ADMIN. C'est un
 * ecart signale au coordinateur : la bonne permission serait `quote:accept:any`,
 * et la branche `SCOPE_ANY` ci-dessous est deja ecrite pour elle — le jour ou
 * elle est ajoutee au catalogue et accordee a SALES, elle prend le relais sans
 * qu'une ligne de ce fichier change.
 *
 * Une absence de scope n'est pas silencieuse : ni `accept:*` ni `write:any` ne
 * donne un 403 explicite. Le garde de la route devrait deja l'avoir refuse ; ce
 * controle est la seconde barriere, celle qui reste si quelqu'un elargit la route
 * un jour de fatigue.
 */
export function acceptancePerimeter(policy: AccessPolicy): string | null {
  const scope = policy.widestScope('quote', 'accept', [SCOPE_ANY, SCOPE_OWN]);

  if (scope === SCOPE_ANY) {
    return null;
  }

  if (scope === SCOPE_OWN) {
    const clientId = policy.clientId;

    if (!clientId) {
      // UN PORTEUR INTERNE PEUT DETENIR `quote:accept:own` SANS ETRE UN COMPTE
      // CLIENT, et c'est precisement le cas d'un ADMINISTRATEUR : ses
      // permissions sont la copie du catalogue (`ROLE_PERMISSIONS.ADMIN` vaut
      // `'ALL'`), donc il detient AUSSI `quote:accept:own` — un code qui
      // n'existe pourtant que pour l'espace client.
      //
      // SANS CE REPLI, LE DROIT LE PLUS LARGE PRODUIT LE REFUS. Comme le
      // catalogue ne contient AUCUN `quote:accept:any` (ecart documente dans
      // `docs/API.md`), `widestScope` ne peut pas remonter jusqu'a `ANY` et
      // s'arrete sur `OWN`. Plus un porteur detient de permissions, plus il a
      // donc de chances d'entrer dans cette branche : un administrateur etait
      // refuse sur TOUS les devis, avec « Aucun dossier client est rattache a
      // ce compte », alors qu'il detient `quote:write:any`, qui couvre
      // exactement le geste. Mesure sur la base reelle : 403 systematique sur
      // `POST /quotes/:id/accept`, et 16 tests de bout en bout annules.
      //
      // Ce repli n'ouvre aucun acces indu : `quote:write:any` n'est accorde
      // qu'a SALES, PROJECT_MANAGER et ADMIN — jamais a CLIENT. Un porteur qui
      // le detient est un compte interne, sans dossier client, donc sans
      // perimetre a filtrer.
      if (policy.has('quote:write:any')) {
        return null;
      }

      // Detenir `quote:accept:own` sans dossier client ne donne acces a RIEN.
      // Renvoyer `null` ici — « pas de filtre » — ouvrirait au contraire tous les
      // devis : c'est le sens exact dans lequel une valeur par defaut transforme
      // une restriction en faille.
      throw AppException.forbidden('Aucun dossier client est rattache a ce compte.');
    }

    return clientId;
  }

  if (policy.has('quote:write:any')) {
    return null;
  }

  throw AppException.forbidden('Droit insuffisant : quote:accept');
}
