/**
 * VUE D'UN JETON D'INTEGRATION.
 *
 * CE FICHIER EXISTE POUR UNE SEULE RAISON : rendre impossible, par construction,
 * la fuite du secret dans une reponse de liste.
 *
 * Le secret n'est pas « oublie » dans les autres methodes : il n'est pas
 * STOCKE. La seule valeur persistee est son empreinte, et elle est exclue de la
 * projection `TOKEN_SELECT`. Un presenter separe ajoute une seconde barriere —
 * celle qui compte quand quelqu'un ajoute un champ au `select` un vendredi soir :
 * la sérialisation ne suit pas, le champ sensible reste dans le service.
 *
 * Ce qui sort : le nom, le PREFIXE (reconnaitre un jeton sans le reconstituer),
 * les droits, et les dates utiles a une revocation.
 */

export interface IntegrationTokenView {
  readonly id: string;
  readonly name: string;
  /** Fragment affichable du jeton (`cxi_…`). Jamais le jeton. */
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly createdBy: { id: string; firstName: string; lastName: string } | null;
  /** Vrai quand le jeton ne peut plus authentifier, quelle qu'en soit la raison. */
  readonly active: boolean;
}

interface TokenRow {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly lastUsedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly createdBy: { id: string; firstName: string; lastName: string } | null;
}

export function toIntegrationTokenView(row: TokenRow): IntegrationTokenView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: [...row.scopes],
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    // Calcule ici, et non laisse a l'appelant : c'est une regle metier (« un
    // jeton revoque ou perime n'authentifie plus »), pas un detail d'affichage.
    active: row.revokedAt === null && (row.expiresAt === null || row.expiresAt > new Date()),
  };
}
