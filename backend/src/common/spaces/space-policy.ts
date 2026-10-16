/**
 * ESPACES DE TRAVAIL — Espace personnel, Espace équipe, Comexa Space.
 *
 * Un espace n'est PAS un nouveau jeu de droits : c'est une RESTRICTION
 * contextuelle des droits que le porteur détient déjà par ses rôles. Le
 * frontend annonce l'espace actif dans l'en-tête `X-Comexa-Space` ; le garde
 * d'authentification calcule alors les permissions EFFECTIVES de la requête
 * (toujours un sous-ensemble des permissions du rôle), et tous les services —
 * qui raisonnent déjà par portée via `AccessPolicy` — filtrent leurs lignes en
 * conséquence. Aucune table nouvelle, aucune donnée dupliquée, aucune
 * migration : les données existantes sont simplement lues dans le bon
 * périmètre.
 *
 * Ce que garantit ce module (fonctions PURES, testées à l'unité) :
 *
 *  1. un espace ne donne JAMAIS un droit que le rôle n'a pas. Les seules
 *     transformations sont des retraits, ou des RÉTROGRADATIONS vers une portée
 *     strictement incluse (`task:read:any` -> `task:read:assigned` : les tâches
 *     qui me sont assignées font partie de toutes les tâches) ;
 *  2. les données ne se mélangent pas : les tâches et le calendrier PRIVÉS ne
 *     sortent que dans l'espace personnel, l'administration de l'organisation
 *     ne s'ouvre que dans Comexa Space, et l'espace personnel ne voit que ce qui
 *     appartient au porteur — y compris pour un administrateur ;
 *  3. l'accès à un espace se décide sur les droits réels : un développeur n'a
 *     pas de Comexa Space, un client n'a aucun de ces espaces.
 *
 * Sans en-tête, rien ne change (intégrations n8n, espace client, anciens
 * clients) : le porteur garde exactement les droits de son rôle.
 */

export const SPACE_HEADER = 'x-comexa-space';

export const SPACE_IDS = ['personal', 'team', 'comexa'] as const;
export type SpaceId = (typeof SPACE_IDS)[number];

export function isSpaceId(value: unknown): value is SpaceId {
  return typeof value === 'string' && (SPACE_IDS as readonly string[]).includes(value);
}

export interface SpaceDescriptor {
  readonly id: SpaceId;
  readonly label: string;
  readonly description: string;
}

export const SPACES: Readonly<Record<SpaceId, SpaceDescriptor>> = {
  personal: {
    id: 'personal',
    label: 'Espace personnel',
    description:
      'Vos tâches, votre agenda, votre temps et vos rapports : ce qui n’appartient qu’à vous.',
  },
  team: {
    id: 'team',
    label: 'Espace équipe',
    description:
      'Le travail partagé de l’agence : commercial, facturation, projets, tâches et calendrier d’équipe.',
  },
  comexa: {
    id: 'comexa',
    label: 'Comexa Space',
    description:
      'L’organisation Comexa : site public, membres et rôles, intégrations, journal d’audit et paramètres.',
  },
};

// -----------------------------------------------------------------------------
// Espace personnel
// -----------------------------------------------------------------------------

/** Ce que l'espace personnel conserve tel quel : uniquement des portées « à moi ». */
const PERSONAL_KEEP: ReadonlySet<string> = new Set([
  'user:read:own',
  'task:read:personal',
  'task:write:personal',
  'task:read:assigned',
  'task:read:own',
  'task:write:own',
  'time:read:own',
  'time:write:own',
  'calendar:read:own',
  'calendar:write:own',
  'notification:read:own',
  'notification:manage:own',
  'dashboard:read:own',
  // Libellés des projets de mes tâches et de mes saisies de temps.
  'project:read:assigned',
  'project:read:own',
]);

/**
 * Rétrogradations : un droit large devient sa version personnelle, toujours
 * incluse dans l'original. Un chef de projet voit, dans SON espace, les tâches
 * qui lui sont assignées — pas celles de toute l'agence.
 */
const PERSONAL_DOWNGRADE: Readonly<Record<string, string>> = {
  'task:read:any': 'task:read:assigned',
  'task:write:any': 'task:write:own',
  'time:read:any': 'time:read:own',
  'time:write:any': 'time:write:own',
  'dashboard:read:any': 'dashboard:read:own',
  'project:read:any': 'project:read:assigned',
};

// -----------------------------------------------------------------------------
// Comexa Space (administration de l'organisation)
// -----------------------------------------------------------------------------

/**
 * Droits qui n'ont de sens qu'au niveau de l'organisation : gestion des comptes
 * et des rôles, intégrations, audit, paramètres, publication du site public.
 * Ils sont RETIRÉS de l'espace équipe et de l'espace personnel.
 */
export const COMEXA_ONLY: ReadonlySet<string> = new Set([
  'user:write:any',
  'user:manage:any',
  'role:manage:any',
  'permission:read:any',
  'audit:read:any',
  'integration:read:any',
  'integration:manage:any',
  'telegram:link:any',
  'setting:write:any',
  'service:write:any',
  'package:write:any',
  'casestudy:write:any',
  'testimonial:write:any',
  'testimonial:moderate:any',
  'partner:write:any',
  'faq:write:any',
]);

/** Lectures utiles aux pages de Comexa Space (annuaire, catalogue, paramètres). */
const COMEXA_READS: ReadonlySet<string> = new Set([
  'user:read:any',
  'user:read:own',
  'role:read:any',
  'setting:read:any',
  'service:read:any',
  'package:read:any',
  'casestudy:read:any',
  'testimonial:read:any',
  'partner:read:any',
  'faq:read:any',
  'notification:read:own',
  'notification:manage:own',
]);

/**
 * Droits qui OUVRENT Comexa Space : il faut au moins une page d'administration
 * à consulter. `user:read:own`, les notifications et `telegram:link:any`
 * (réservé aux machines) n'en font pas partie.
 */
const COMEXA_ENTRY: ReadonlySet<string> = new Set([
  'user:read:any',
  'role:read:any',
  'audit:read:any',
  'integration:read:any',
  'integration:manage:any',
  'setting:read:any',
  'service:read:any',
  'package:read:any',
  'casestudy:read:any',
  'testimonial:read:any',
  'partner:read:any',
  'faq:read:any',
]);

// -----------------------------------------------------------------------------
// Espace équipe
// -----------------------------------------------------------------------------

/** Droits PRIVÉS, retirés de l'espace équipe : ils ne sortent que chez soi. */
const PERSONAL_ONLY: ReadonlySet<string> = new Set([
  'task:read:personal',
  'task:write:personal',
  'calendar:read:own',
]);

/**
 * Droits qui ouvrent l'espace équipe : au moins un accès au travail partagé.
 * Un compte qui n'a que des droits personnels (aucun cas aujourd'hui) n'y
 * entrerait pas.
 */
const TEAM_ENTRY_PREFIXES = [
  'project:',
  'task:read:any',
  'task:read:assigned',
  'task:write:any',
  'prospect:',
  'client:read:any',
  'quote:read:any',
  'invoice:read:any',
  'order:read:any',
  'project_request:',
  'contactrequest:',
  'calendar:read:team',
  'conversation:',
  'dashboard:read:any',
  'report:',
  'modificationrequest:decide:any',
];

// -----------------------------------------------------------------------------
// Calcul
// -----------------------------------------------------------------------------

export interface SpacePrincipal {
  readonly roles: readonly string[];
  readonly permissions: ReadonlySet<string>;
  readonly clientId?: string | null;
  readonly isIntegration?: boolean;
}

/** Un compte de l'espace client (ou une machine) n'entre dans aucun de ces espaces. */
function isTeamMember(principal: SpacePrincipal): boolean {
  if (principal.isIntegration) return false;
  return principal.roles.some((role) => role !== 'CLIENT');
}

/** Permissions EFFECTIVES d'un espace : toujours un sous-ensemble des droits du rôle (ou une portée incluse). */
export function effectivePermissions(
  space: SpaceId,
  permissions: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  switch (space) {
    case 'personal':
      for (const code of permissions) {
        if (PERSONAL_KEEP.has(code)) out.add(code);
        const downgraded = PERSONAL_DOWNGRADE[code];
        if (downgraded) out.add(downgraded);
      }
      return out;
    case 'team':
      for (const code of permissions) {
        if (!COMEXA_ONLY.has(code) && !PERSONAL_ONLY.has(code)) out.add(code);
      }
      return out;
    case 'comexa':
      for (const code of permissions) {
        if (COMEXA_ONLY.has(code) || COMEXA_READS.has(code)) out.add(code);
      }
      // Une machine ne distribue pas d'accès, un humain ne lie pas Telegram
      // pour autrui : ce droit reste propre aux jetons d'intégration.
      out.delete('telegram:link:any');
      return out;
    default:
      return out;
  }
}

/** L'espace est-il ouvert à ce porteur ? */
export function canEnterSpace(space: SpaceId, principal: SpacePrincipal): boolean {
  if (!isTeamMember(principal)) return false;
  const effective = effectivePermissions(space, principal.permissions);
  switch (space) {
    case 'personal':
      // Au moins un outil personnel : tâches, agenda ou temps.
      return [
        'task:read:personal',
        'task:read:assigned',
        'task:read:own',
        'calendar:read:own',
        'time:read:own',
        'time:write:own',
      ].some((code) => effective.has(code));
    case 'team':
      return [...effective].some((code) =>
        TEAM_ENTRY_PREFIXES.some((prefix) => code === prefix || code.startsWith(prefix)),
      );
    case 'comexa':
      return [...effective].some((code) => COMEXA_ENTRY.has(code));
    default:
      return false;
  }
}

/** Les espaces accessibles, dans l'ordre d'affichage du sélecteur. */
export function accessibleSpaces(principal: SpacePrincipal): SpaceId[] {
  return SPACE_IDS.filter((space) => canEnterSpace(space, principal));
}

// -----------------------------------------------------------------------------
// Notifications : chacune appartient à un espace
// -----------------------------------------------------------------------------

/**
 * Rattachement des types de notification aux espaces, pour que la cloche et
 * ses compteurs ne mélangent jamais deux espaces.
 *
 *  - personnel : ce qui concerne MON travail (une tâche m'est assignée, une
 *    échéance approche) ;
 *  - équipe    : la vie des projets, du commercial et de la facturation ;
 *  - Comexa    : les messages système de la plateforme.
 */
export const NOTIFICATION_TYPES_BY_SPACE: Readonly<Record<SpaceId, readonly string[]>> = {
  personal: ['TASK_ASSIGNED', 'TASK_DUE_SOON'],
  team: [
    'TASK_COMPLETED',
    'MILESTONE_REACHED',
    'PROJECT_STATUS_CHANGED',
    'QUOTE_SENT',
    'QUOTE_ACCEPTED',
    'QUOTE_REJECTED',
    'INVOICE_ISSUED',
    'INVOICE_OVERDUE',
    'PAYMENT_RECEIVED',
    'MESSAGE_RECEIVED',
    'DOCUMENT_SHARED',
    'MODIFICATION_REQUESTED',
    'CONTACT_REQUEST_RECEIVED',
  ],
  comexa: ['SYSTEM'],
};

/** Espace d'un type de notification (les types inconnus vont à l'espace équipe). */
export function spaceOfNotificationType(type: string): SpaceId {
  for (const space of SPACE_IDS) {
    if (NOTIFICATION_TYPES_BY_SPACE[space].includes(type)) return space;
  }
  return 'team';
}
