import type { RoleCode } from '../../generated/prisma/enums.js';
import { AppException } from '../errors/app-error.js';

/**
 * LE PORTEUR DE LA REQUETE, tel qu'il est attache a `request.authenticatedUser`.
 *
 * `permissions` est un `Set` de codes resolus EN BASE a chaque requete, et non
 * un tableau recopie dans le JWT. C'est un choix, et il a un cout : une requete
 * SQL supplementaire par appel authentifie. Il achete une propriete qui compte :
 *
 *   - retirer une permission a un role prend effet a la requete suivante, pas
 *     dans quinze minutes quand l'access token expire ;
 *   - suspendre un compte le coupe immediatement, alors qu'un jeton deja emis
 *     resterait valable jusqu'a son expiration ;
 *   - un compte supprime cesse d'agir tout de suite.
 *
 * Tant que ce cout devient genant, la reponse est un cache court (quelques
 * secondes) par identifiant utilisateur — pas de figer les droits dans le jeton.
 */
export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly roles: readonly RoleCode[];
  readonly permissions: ReadonlySet<string>;
  /** Renseigne uniquement pour un compte de l'espace client. */
  readonly clientId: string | null;
  readonly mustChangePassword: boolean;
}

export const SCOPE_ANY = 'any';
export const SCOPE_OWN = 'own';
export const SCOPE_ASSIGNED = 'assigned';
export const SCOPE_CLIENT = 'client';
/**
 * La portee PERSONNELLE : l'espace prive d'un membre, hors de tout projet.
 *
 * C'est une portee qui FILTRE DES LIGNES (les taches personnelles du porteur),
 * comme `own` et `assigned` — d'ou sa place ici. Mais elle ne prend place dans
 * AUCUN ordre de precedence (`widestScope`) : elle designe un AUTRE ensemble de
 * lignes que `any`/`assigned`/`own`, pas un sous-ensemble. Les perimetres composes
 * qui la melangent s'ecrivent une seule fois, dans `task-rules.ts`.
 */
export const SCOPE_PERSONAL = 'personal';

export type ScopeName = string;

/** Construit un code de permission. Evite les concatenations dispersees. */
export function permissionCode(resource: string, action: string, scope: ScopeName): string {
  return `${resource}:${action}:${scope}`;
}

/**
 * Interprete les droits d'un porteur.
 *
 * Cette classe est le seul endroit qui repond a « cet utilisateur peut-il ? ».
 * Les services ne doivent pas inspecter `permissions` directement : ils
 * passeraient a cote du raisonnement sur les scopes, et c'est exactement la que
 * se logent les failles d'acces horizontal.
 */
export class AccessPolicy {
  constructor(private readonly user: AuthenticatedUser) {}

  get userId(): string {
    return this.user.id;
  }

  get clientId(): string | null {
    return this.user.clientId;
  }

  get roles(): readonly RoleCode[] {
    return this.user.roles;
  }

  get mustChangePassword(): boolean {
    return this.user.mustChangePassword;
  }

  /** Detient exactement ce code. */
  has(code: string): boolean {
    return this.user.permissions.has(code);
  }

  /** Detient TOUS ces codes. */
  hasAll(codes: readonly string[]): boolean {
    return codes.every((code) => this.has(code));
  }

  /** Detient AU MOINS UN de ces codes. */
  hasAny(codes: readonly string[]): boolean {
    return codes.some((code) => this.has(code));
  }

  hasRole(role: RoleCode): boolean {
    return this.user.roles.includes(role);
  }

  /**
   * Vrai si le porteur appartient a l'espace client.
   *
   * Sert notamment a refuser l'acces aux ressources internes : un compte CLIENT
   * ne doit jamais recevoir une tache, un temps saisi ou un document INTERNAL,
   * quelles que soient les permissions qu'on lui ajouterait par erreur plus tard.
   */
  isClient(): boolean {
    return this.hasRole('CLIENT' as RoleCode);
  }

  /**
   * Le scope le plus large detenu pour (resource, action).
   *
   * `order` est FOURNI PAR L'APPELANT, du plus large au plus etroit. Il n'y a
   * volontairement aucune table de precedence globale : elle serait fausse
   * quelque part. Pour `project:read`, l'ordre est `any`, puis `assigned` ;
   * pour `task:write`, c'est `any`, puis `own`. Un ordre impose de l'exterieur
   * obligerait a se souvenir de ces differences, et un service finirait par
   * accorder le mauvais scope.
   *
   * Renvoie `null` si aucun des scopes n'est detenu.
   */
  widestScope(resource: string, action: string, order: readonly ScopeName[]): ScopeName | null {
    for (const scope of order) {
      if (this.has(permissionCode(resource, action, scope))) {
        return scope;
      }
    }
    return null;
  }

  /**
   * Comme `widestScope`, mais refuse l'acces si aucun scope n'est detenu.
   *
   * A utiliser dans les services, apres le garde : le garde verifie que la route
   * est accessible, `requireScope` verifie QUELLE PART des donnees est
   * accessible. Les deux sont necessaires — une route `project:read` ouverte a
   * `any`, `assigned` et `own` ne dit pas encore quels projets renvoyer.
   */
  requireScope(resource: string, action: string, order: readonly ScopeName[]): ScopeName {
    const scope = this.widestScope(resource, action, order);
    if (!scope) {
      throw AppException.forbidden(`Droit insuffisant : ${resource}:${action}`);
    }
    return scope;
  }

  /**
   * Verifie l'appartenance d'une ressource.
   *
   * C'est le point de passage unique de la lutte contre l'acces horizontal : un
   * client ne doit pas pouvoir lire la facture d'un autre en changeant un
   * identifiant dans l'URL. Toute lecture par identifiant doit passer ici
   * lorsque le scope est `own`.
   */
  assertOwnership(isOwner: boolean, message = 'Cette ressource ne vous appartient pas'): void {
    if (!isOwner) {
      // On renvoie 403 et non 404 : le porteur est authentifie et detient la
      // permission, il n'a simplement pas le droit sur CETTE ligne. Un 404
      // laisserait croire a une erreur de saisie et masquerait le refus.
      throw AppException.forbidden(message);
    }
  }
}
