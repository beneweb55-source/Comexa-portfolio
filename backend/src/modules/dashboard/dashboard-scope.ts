import { AppException } from '../../common/errors/app-error.js';

/**
 * PERIMETRE DU TABLEAU DE BORD.
 *
 * Deux questions differentes, souvent confondues :
 *
 *  - QUELLE VUE ce porteur a-t-il le droit d'ouvrir ? C'est `resolvePerimeter`.
 *  - QUELLES SECTIONS cette vue peut-elle remplir ? Ce sont `personalSectionsFor`
 *    et `clientSectionsFor`.
 *
 * Ce fichier ne touche ni la base ni Nest : ce sont des decisions pures, donc
 * testables exhaustivement, et c'est exactement ce qu'on veut d'une regle
 * d'acces. La regle qui compte est la PREMIERE : un porteur de l'espace client
 * ne peut jamais obtenir la vue d'agence, quelles que soient les permissions
 * qu'on lui ajouterait par erreur un jour. Elle est donc evaluee avant tout
 * examen de permission, et pas apres.
 */

export const DASHBOARD_READ_ANY = 'dashboard:read:any';
export const DASHBOARD_READ_OWN = 'dashboard:read:own';

/** Scopes qui autorisent a voir des taches, du plus large au plus etroit. */
export const TASK_READ_SCOPES = ['task:read:any', 'task:read:assigned', 'task:read:own'] as const;

/** Scopes qui autorisent a voir du temps saisi. */
export const TIME_READ_SCOPES = ['time:read:any', 'time:read:own'] as const;

export const PROJECT_READ_SCOPES = [
  'project:read:any',
  'project:read:assigned',
  'project:read:own',
] as const;

export const INVOICE_READ_SCOPES = ['invoice:read:any', 'invoice:read:own'] as const;

export const QUOTE_READ_SCOPES = ['quote:read:any', 'quote:read:own'] as const;

export const DOCUMENT_READ_SCOPES = [
  'document:read:any',
  'document:read:own',
  'document:read:client',
] as const;

export const NOTIFICATION_READ_OWN = 'notification:read:own';

/** Les trois vues possibles. Il n'y en a pas d'autre. */
export type DashboardPerimeter = 'agency' | 'personal' | 'client';

export interface PerimeterInput {
  readonly isClient: boolean;
  readonly clientId: string | null;
  readonly hasAgencyScope: boolean;
  readonly hasOwnScope: boolean;
}

/**
 * Choisit la vue, ou refuse.
 *
 * L'ordre des regles EST la garantie de securite, ne pas le rearranger :
 *
 *  1. Espace client : la vue est celle du client, et rien d'autre. Un compte
 *     client dont la fiche est introuvable est REFUSE plutot que renvoye vers
 *     un perimetre plus large — c'est le sens de la regle « un client ne doit
 *     jamais recevoir un agregat d'agence ».
 *  2. Scope d'agence : vue complete, reservee aux comptes internes.
 *  3. Scope personnel : vue personnelle.
 *  4. Sinon : refus.
 */
export function resolvePerimeter(input: PerimeterInput): DashboardPerimeter {
  if (input.isClient) {
    if (input.clientId === null || input.clientId === '') {
      // Refus explicite. Surtout PAS de repli sur la vue personnelle ou sur un
      // agregat : une incoherence de donnees ne doit jamais elargir un droit.
      throw AppException.forbidden("Ce compte client n'est rattache a aucune fiche client.");
    }
    return 'client';
  }

  if (input.hasAgencyScope) {
    return 'agency';
  }

  if (input.hasOwnScope) {
    return 'personal';
  }

  throw AppException.forbidden('Droit insuffisant : dashboard:read');
}

/** Sections d'une vue personnelle, selon les droits reels du porteur. */
export interface PersonalSections {
  readonly tasks: boolean;
  readonly timeEntries: boolean;
  readonly notifications: boolean;
}

/**
 * Sections disponibles sur `/dashboard/me`.
 *
 * Un porteur de l'espace client a `dashboard:read:own` — la route lui est donc
 * ouverte — mais aucune permission `task:*` ni `time:*`. Les sections se
 * deduisent donc des DROITS, pas du role : la vue personnelle d'un client se
 * reduit a ses notifications, et aucun ecran ne peut lui faire afficher une
 * tache interne, meme par erreur.
 */
export function personalSectionsFor(has: (code: string) => boolean): PersonalSections {
  return {
    tasks: TASK_READ_SCOPES.some((code) => has(code)),
    timeEntries: TIME_READ_SCOPES.some((code) => has(code)),
    notifications: has(NOTIFICATION_READ_OWN),
  };
}

/** Sections de l'espace client. */
export interface ClientSections {
  readonly projects: boolean;
  readonly invoices: boolean;
  readonly quotes: boolean;
  readonly documents: boolean;
  readonly notifications: boolean;
}

/**
 * Sections disponibles sur `/dashboard/client`.
 *
 * Meme principe : `document:read:client` n'est pas `document:read:any`, et la
 * seconde barriere est en base — la visibilite `INTERNAL` est exclue dans la
 * requete, pas seulement ici.
 */
export function clientSectionsFor(has: (code: string) => boolean): ClientSections {
  return {
    projects: PROJECT_READ_SCOPES.some((code) => has(code)),
    invoices: INVOICE_READ_SCOPES.some((code) => has(code)),
    quotes: QUOTE_READ_SCOPES.some((code) => has(code)),
    documents: DOCUMENT_READ_SCOPES.some((code) => has(code)),
    notifications: has(NOTIFICATION_READ_OWN),
  };
}
