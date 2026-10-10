/**
 * LE CONTRAT DE LA REPONSE HTTP — miroir du backend, a l'usage du frontend.
 *
 * Ce fichier ne depend de RIEN (aucun import) : il s'importe aussi bien depuis
 * le Next.js de la racine que depuis un script de test, sans trainer Nest ni
 * Prisma. C'est la raison de son existence — les declarations vivent deja dans
 * le backend, mais `transform.interceptor.ts` importe `@nestjs/common` et
 * `app-error.ts` aussi : les importer depuis le frontend entrainerait le
 * framework serveur dans le bundle du navigateur.
 *
 * PROVENANCE, ET A RELIRE AVANT TOUTE MODIFICATION :
 *
 *   | Type                | Fichier source                                              |
 *   |---------------------|-------------------------------------------------------------|
 *   | `ApiSuccessBody`    | backend/src/common/interceptors/transform.interceptor.ts     |
 *   | `PaginatedMeta`     | backend/src/common/interceptors/transform.interceptor.ts     |
 *   | `ApiErrorBody`      | backend/src/common/errors/app-error.ts                       |
 *   | `DEFAULT_PER_PAGE`  | backend/src/common/dto/pagination.dto.ts                     |
 *   | `MAX_PER_PAGE`      | backend/src/common/dto/pagination.dto.ts                     |
 *
 * CE FICHIER EST UN MIROIR, PAS UNE SOURCE. Il ne peut pas importer le backend
 * (dossiers de compilation differents : le backend compile `src/` vers `dist/`,
 * une importation hors de ce dossier casserait la disposition de sortie). Il
 * faut donc le faire evoluer a la main, et c'est le prix assume de l'isolation.
 * En cas de desaccord entre ce fichier et le backend, LE BACKEND A RAISON.
 */

/**
 * Metadonnees de pagination, telles que le frontend les recoit.
 *
 * ATTENTION AU NOM : `perPage`, et non `pageSize`. Le champ s'appelle
 * `perPage` des la definition du DTO de requete, et le miroir respecte ce nom
 * plutot que d'en inventer un plus familier.
 *
 * `totalPages` vaut `0` quand la liste est vide — et non `1`. Le backend le
 * calcule ainsi deliberement : afficher « page 1 sur 1 » sur une liste qui
 * n'existe pas fait croire a un contenu absent plutot qu'a une page inexistante.
 */
export interface PaginatedMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

/**
 * Reponse de succes.
 *
 * La forme est IDENTIQUE pour une ressource et pour une liste paginee : dans
 * les deux cas `data` porte la charge utile, et pour une liste, `data` **est**
 * le tableau. Les metadonnees ne sont pas dans `data`, elles sont a cote, dans
 * `meta`.
 *
 * Autrement dit, une route paginee rend `ApiSuccessBody<Item[]>` avec `meta`
 * present. `T` vaut donc le tableau lui-meme, et non un objet `{ items, meta }`
 * — cette derniere forme est celle que le SERVICE backend renvoie en interne
 * avant que l'intercepteur ne l'aplatisse, et elle n'est jamais visible sur le
 * reseau. Il n'y a donc pas de type `Paginated<T>` a importer ici : l'ecrire
 * inviterait le frontend a lire `data.items`, qui n'existe pas.
 */
export interface ApiSuccessBody<T> {
  success: true;
  data: T;
  meta?: PaginatedMeta;
}

/**
 * Reponse en erreur.
 *
 * `code` est STABLE et c'est lui que le frontend teste
 * (`if (error.code === 'QUOTE_EXPIRED')`). `message` est destine a l'humain :
 * il peut etre reformule ou traduit sans que rien ne casse, donc jamais de
 * comparaison dessus. `details` porte les precisions machine : pour une erreur
 * de validation, le tableau des messages class-validator (chacun nomme la
 * PROPRIETE fautive, jamais la valeur fournie).
 *
 * Aucune trace de pile n'apparait ici : le filtre d'exceptions la journalise,
 * et la reponse de production ne la contient jamais.
 */
export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details: unknown;
  };
}

/**
 * L'union des deux, quand un appelant veut le type d'une reponse avant de
 * savoir si l'appel a reussi — le cas d'un `fetch` qu'on ne teste pas encore.
 *
 * `if (body.success)` reduit l'union vers l'une ou l'autre branche : c'est
 * exactement la raison d'etre de l'enveloppe, et ce test fonctionne pour un
 * objet, un tableau ou `null` (une suppression qui ne renvoie rien produit
 * `data: null`).
 */
export type ApiResponse<T> = ApiSuccessBody<T> | ApiErrorBody;

/** Elements par page quand `?perPage=` est omis. */
export const DEFAULT_PER_PAGE = 20;

/**
 * Plafond de `?perPage=`, cote serveur.
 *
 * Il est bas volontairement : `?perPage=1000000` transformerait une liste en
 * export complet de la table. Le frontend n'a donc pas a proposer davantage,
 * et une demande superieure est refusee par le validateur.
 */
export const MAX_PER_PAGE = 100;
