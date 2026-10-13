import { RoleCode } from '../../generated/prisma/enums.js';

/**
 * CATALOGUE DES PERMISSIONS — source de verite unique.
 *
 * Ce fichier vit dans `src/` et non dans `prisma/` : ce n'est pas de la donnee
 * initiale, c'est du DOMAINE. Les gardes, les services et les tests lisent ces
 * codes pour decider d'un acces ; le seed ne fait que les recopier en base.
 * L'avoir place sous `prisma/` aurait oblige le code de production a importer
 * depuis le dossier du seed, ce qui est le sens inverse.
 *
 * Chaque code suit le format `resource:action:scope`. Le catalogue ne stocke
 * QUE le code et sa description ; `resource`, `action` et `scope` en sont
 * derives par `parsePermissionCode`. C'est delibere : ecrire les quatre valeurs
 * a la main laisse la porte ouverte a un code `task:write:own` range dans la
 * colonne `resource = "tasks"`, et cette incoherence ne se voit qu'au moment ou
 * un garde refuse un acces legitime.
 *
 * LE SCOPE EST LE POINT CENTRAL.
 *
 * C'est lui qui repond a « ne te limite pas a cacher des boutons cote
 * frontend ». Un developpeur a `task:write:own` : il modifie les taches qui lui
 * sont assignees. Un chef de projet a `task:write:any` : les siennes et celles
 * des autres. La difference est en BASE, verifiee a chaque requete — masquer un
 * bouton n'a jamais protege une donnee.
 *
 * `own` n'a pas le meme sens partout, et c'est volontaire :
 *   - `project:read:own`        -> le projet dont l'utilisateur est responsable
 *   - `task:write:own`          -> la tache qui lui est ASSIGNEE
 *   - `quote:read:own`          -> le devis de SON client (role CLIENT)
 *   - `time:read:own`           -> ses propres saisies de temps
 *   - `notification:read:own`   -> ses propres notifications
 *   - `document:read:client`    -> document partageable (visibilite != INTERNAL)
 * Chaque service qui lit un scope `own` doit donc dire explicitement ce que
 * « own » designe pour SA ressource. Le nom du scope ne suffit pas : voir
 * `AccessPolicy.widestScope`, qui oblige l'appelant a fournir l'ordre des
 * scopes du plus large au plus etroit.
 */
export const PERMISSIONS = {
  // ---------------------------------------------------------------------------
  // Identite et acces
  // ---------------------------------------------------------------------------
  'user:read:any': 'Consulter tous les comptes',
  'user:read:own': 'Consulter son propre compte',
  'user:write:any': 'Modifier tous les comptes',
  'user:manage:any': 'Creer, suspendre et supprimer des comptes, attribuer des roles',
  'role:read:any': 'Consulter les roles',
  'role:manage:any': 'Creer et modifier les roles et leurs permissions',
  'permission:read:any': 'Consulter le catalogue des permissions',
  'audit:read:any': "Consulter le journal d'audit",
  /**
   * Integrations serveur-a-serveur (n8n, agents IA).
   *
   * `manage` est VOLONTAIREMENT le seul code qu'un jeton ne peut pas recevoir
   * (voir `normalizeIntegrationScopes`) : une machine ne distribue pas des
   * acces. Sinon un jeton vole permettrait d'en creer d'autres, et la
   * revocation perdrait tout effet.
   */
  'integration:read:any': 'Consulter les jetons d’integration',
  'integration:manage:any': 'Creer, renouveler et revoquer les jetons d’integration',

  // ---------------------------------------------------------------------------
  // CRM
  // ---------------------------------------------------------------------------
  'prospect:read:any': 'Consulter tous les prospects',
  'prospect:read:own': 'Consulter les prospects dont on est responsable',
  'prospect:write:any': 'Creer et modifier tous les prospects',
  'prospect:write:own': 'Modifier les prospects dont on est responsable',
  'prospect:convert:any': 'Convertir un prospect en client',
  'prospect:delete:any': 'Supprimer un prospect',
  'client:read:any': 'Consulter tous les clients',
  'client:read:own': 'Consulter son propre dossier client',
  'client:write:any': 'Creer et modifier les clients',
  'client:delete:any': 'Supprimer un client',
  'contact:read:any': "Consulter les contacts d'un client",
  'contact:write:any': "Gerer les contacts d'un client",

  // ---------------------------------------------------------------------------
  // Projets
  // ---------------------------------------------------------------------------
  'project:read:any': 'Consulter tous les projets',
  'project:read:own': 'Consulter le projet dont on est responsable',
  'project:read:assigned': 'Consulter les projets auxquels on est affecte',
  'project:write:any': 'Creer et modifier tous les projets',
  'project:write:own': 'Modifier le projet dont on est responsable',
  'project:delete:any': 'Supprimer un projet',
  'project:manage:team': "Affecter et retirer des membres d'un projet",
  'project:manage:status': "Changer le statut et la sante d'un projet",
  'milestone:read:any': 'Consulter les jalons',
  'milestone:write:any': 'Creer et modifier les jalons',
  'task:read:any': 'Consulter toutes les taches',
  'task:read:assigned': 'Consulter les taches qui nous sont assignees',
  'task:read:own': 'Consulter ses propres taches',
  'task:read:personal': 'Consulter ses taches personnelles (sans projet)',
  'task:write:any': 'Creer et modifier toutes les taches',
  'task:write:own': 'Modifier les taches qui nous sont assignees',
  'task:write:personal': 'Creer, modifier et supprimer ses taches personnelles',
  'task:assign:any': 'Assigner une tache a un membre',
  'task:delete:any': 'Supprimer une tache',
  'time:read:any': 'Consulter le temps saisi par tous',
  'time:read:own': 'Consulter son propre temps saisi',
  'time:write:own': 'Saisir son propre temps',
  'time:write:any': 'Saisir et corriger le temps de tous',
  'activity:read:any': "Consulter le fil d'activite",
  'activity:read:own': "Consulter le fil d'activite de ses projets",
  'activity:write:any': "Publier dans le fil d'activite",

  // ---------------------------------------------------------------------------
  // Calendriers (personnel et equipe)
  //
  // Meme grammaire que les taches personnelles : `:own` designe LIGNE A LIGNE
  // son propre espace, `:team` la vue commune des evenements PARTAGES. Les
  // echeances de taches/projets ne demandent aucune permission de plus : elles
  // sont derivees des droits `task:*` / `project:*` deja poses.
  // ---------------------------------------------------------------------------
  'calendar:read:own': 'Consulter son calendrier personnel',
  'calendar:write:own': 'Creer, modifier et supprimer ses propres evenements',
  'calendar:read:team': "Consulter les evenements partages de l'equipe",
  'calendar:manage:any': 'Gerer tous les evenements de calendrier',

  // ---------------------------------------------------------------------------
  // Devis, facturation, paiements
  // ---------------------------------------------------------------------------
  'quote:read:any': 'Consulter tous les devis',
  'quote:read:own': 'Consulter les devis de son client',
  'quote:write:any': 'Creer et modifier les devis',
  'order:read:any': 'Consulter toutes les commandes',
  'order:read:own': 'Consulter ses propres commandes',
  'order:validate:any': 'Valider une commande, enregistrer un paiement, lancer le projet',
  'project_request:read:any': 'Consulter les demandes de projet',
  'project_request:manage:any': 'Traiter une demande de projet (statut, note interne)',
  'quote:write:own': 'Modifier ses propres devis',
  'quote:send:any': 'Envoyer un devis au client',
  'quote:accept:own': 'Accepter ou refuser un devis de son client',
  'quote:delete:any': 'Supprimer un devis',
  'invoice:read:any': 'Consulter toutes les factures',
  'invoice:read:own': 'Consulter les factures de son client',
  'invoice:write:any': 'Creer et modifier les factures',
  'invoice:send:any': 'Envoyer une facture au client',
  'invoice:delete:any': 'Supprimer une facture',
  'payment:read:any': 'Consulter tous les paiements',
  'payment:read:own': 'Consulter les paiements de son client',
  'payment:write:any': 'Enregistrer et corriger les paiements',

  // ---------------------------------------------------------------------------
  // Messagerie et notifications
  // ---------------------------------------------------------------------------
  'conversation:read:own': 'Lire les conversations dont on est participant',
  'conversation:create:own': 'Ouvrir une conversation',
  'conversation:manage:any': 'Gerer toutes les conversations',
  'message:read:own': 'Lire les messages des conversations dont on est participant',
  'message:write:own': 'Ecrire dans une conversation dont on est participant',
  'message:delete:any': 'Supprimer un message',
  'notification:read:own': 'Lire ses notifications',
  'notification:manage:own': 'Marquer ses notifications comme lues',

  // ---------------------------------------------------------------------------
  // Documents
  // ---------------------------------------------------------------------------
  'document:read:any': 'Consulter tous les documents, y compris internes',
  'document:read:own': 'Consulter les documents de ses projets',
  'document:read:client': 'Consulter les documents partages avec le client',
  'document:write:any': 'Deposer et modifier des documents',
  'document:write:own': 'Deposer un document sur ses projets',
  'document:delete:any': 'Supprimer un document',

  // ---------------------------------------------------------------------------
  // Rapports et tableau de bord
  // ---------------------------------------------------------------------------
  'report:read:any': 'Consulter tous les rapports',
  'report:read:own': 'Consulter ses rapports',
  'report:generate:any': 'Generer un rapport',
  'dashboard:read:any': "Voir le tableau de bord complet de l'agence",
  'dashboard:read:own': 'Voir son tableau de bord',

  // ---------------------------------------------------------------------------
  // Contenus du site public
  // ---------------------------------------------------------------------------
  'service:read:any': 'Consulter les services',
  'service:write:any': 'Gerer les services',
  'package:read:any': 'Consulter les packs',
  'package:write:any': 'Gerer les packs',
  'casestudy:read:any': 'Consulter les etudes de cas',
  'casestudy:write:any': 'Gerer les etudes de cas',
  'testimonial:read:any': 'Consulter les temoignages',
  'testimonial:write:any': 'Gerer les temoignages',
  'testimonial:moderate:any': 'Valider ou refuser un temoignage',
  'partner:read:any': 'Consulter les partenaires',
  'partner:write:any': 'Gerer les partenaires',
  'faq:read:any': 'Consulter la FAQ',
  'faq:write:any': 'Gerer la FAQ',
  'contactrequest:read:any': 'Consulter les demandes de contact',
  'contactrequest:write:any': 'Traiter les demandes de contact',
  'contactrequest:convert:any': 'Convertir une demande de contact en prospect',
  'modificationrequest:read:any': 'Consulter toutes les demandes de modification',
  'modificationrequest:read:own': 'Consulter ses demandes de modification',
  'modificationrequest:write:own': 'Soumettre une demande de modification',
  'modificationrequest:decide:any': 'Approuver ou refuser une demande de modification',

  // ---------------------------------------------------------------------------
  // Systeme
  // ---------------------------------------------------------------------------
  'setting:read:any': 'Consulter les parametres',
  'setting:write:any': 'Modifier les parametres',
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

/** Tous les codes, dans l'ordre de declaration. */
export const ALL_PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export interface ParsedPermission {
  readonly resource: string;
  readonly action: string;
  readonly scope: string;
}

/**
 * Decoupe un code en ses trois colonnes.
 *
 * On refuse tout ce qui n'a pas exactement trois segments non vides : mieux
 * vaut un echec au seed, bruyant et immediat, qu'une permission silencieusement
 * rangee sous un scope `own` alors qu'elle devait etre `any`.
 */
export function parsePermissionCode(code: string): ParsedPermission {
  const parts = code.split(':');
  if (parts.length !== 3 || parts.some((p) => p.trim().length === 0)) {
    throw new Error(
      `Code de permission invalide : "${code}". ` +
        'Format attendu : resource:action:scope (trois segments non vides).',
    );
  }
  const [resource, action, scope] = parts as [string, string, string];
  return { resource, action, scope };
}

/**
 * Attribution des permissions aux sept roles.
 *
 * `ADMIN` recoit `ALL` : enumerer chaque code a la main serait un piege, car une
 * permission ajoutee plus tard serait automatiquement absente de
 * l'administrateur. Les six autres roles sont enumeres, et le typage
 * `PermissionCode` fait qu'un code mal orthographie ne compile pas.
 *
 * Note sur DESIGNER et DEVELOPER : les deux ont le meme jeu de permissions. Ce
 * n'est pas un oubli — ce sont deux metiers differents qui ont besoin du meme
 * ACCES (taches assignees, temps, documents). Ce qui les distingue releve du
 * projet et de l'equipe, pas du role.
 */
export const ROLE_PERMISSIONS: Record<RoleCode, readonly PermissionCode[] | 'ALL'> = {
  [RoleCode.ADMIN]: 'ALL',

  [RoleCode.COMMUNICATION_MANAGER]: [
    'user:read:own',
    'user:read:any',
    'contactrequest:read:any',
    'contactrequest:write:any',
    'contactrequest:convert:any',
    'service:read:any',
    'service:write:any',
    'package:read:any',
    'package:write:any',
    'casestudy:read:any',
    'casestudy:write:any',
    'testimonial:read:any',
    'testimonial:write:any',
    'testimonial:moderate:any',
    'partner:read:any',
    'partner:write:any',
    'faq:read:any',
    'faq:write:any',
    'prospect:read:any',
    'prospect:write:any',
    'client:read:any',
    'project:read:any',
    'document:read:any',
    'document:write:any',
    'conversation:read:own',
    'conversation:create:own',
    'message:read:own',
    'message:write:own',
    'notification:read:own',
    'notification:manage:own',
    'dashboard:read:own',
    'report:read:any',
    'setting:read:any',
    // Taches personnelles et minuteur : un espace propre a chaque membre,
    // meme pour un role sans taches de projet.
    'task:read:personal',
    'task:write:personal',
    'time:read:own',
    'time:write:own',
    'calendar:read:own',
    'calendar:write:own',
    'calendar:read:team',
  ],

  [RoleCode.PROJECT_MANAGER]: [
    'user:read:own',
    'user:read:any',
    'client:read:any',
    'prospect:read:any',
    'project:read:any',
    'project:write:any',
    'project:manage:team',
    'project:manage:status',
    'project:delete:any',
    'milestone:read:any',
    'milestone:write:any',
    'task:read:any',
    'task:write:any',
    'task:assign:any',
    'task:delete:any',
    'time:read:any',
    'time:write:own',
    'time:write:any',
    'activity:read:any',
    'activity:write:any',
    'quote:read:any',
    'quote:write:any',
    'order:read:any',
    'order:validate:any',
    'project_request:read:any',
    'project_request:manage:any',
    'quote:send:any',
    'invoice:read:any',
    'document:read:any',
    'document:write:any',
    'report:read:any',
    'report:generate:any',
    'dashboard:read:any',
    'task:read:personal',
    'task:write:personal',
    'conversation:read:own',
    'conversation:create:own',
    'conversation:manage:any',
    'message:read:own',
    'message:write:own',
    'notification:read:own',
    'notification:manage:own',
    'setting:read:any',
    'calendar:read:own',
    'calendar:write:own',
    'calendar:read:team',
  ],

  [RoleCode.DEVELOPER]: [
    'user:read:own',
    'project:read:assigned',
    'milestone:read:any',
    'task:read:assigned',
    'task:write:own',
    'time:read:own',
    'time:write:own',
    'activity:read:any',
    'activity:write:any',
    'document:read:any',
    'document:read:client',
    'document:write:own',
    'conversation:read:own',
    'conversation:create:own',
    'message:read:own',
    'message:write:own',
    'notification:read:own',
    'notification:manage:own',
    'dashboard:read:own',
    'report:read:own',
    'task:read:personal',
    'task:write:personal',
    'calendar:read:own',
    'calendar:write:own',
    'calendar:read:team',
  ],

  [RoleCode.DESIGNER]: [
    'user:read:own',
    'project:read:assigned',
    'milestone:read:any',
    'task:read:assigned',
    'task:write:own',
    'time:read:own',
    'time:write:own',
    'activity:read:any',
    'activity:write:any',
    'document:read:any',
    'document:read:client',
    'document:write:own',
    'conversation:read:own',
    'conversation:create:own',
    'message:read:own',
    'message:write:own',
    'notification:read:own',
    'notification:manage:own',
    'dashboard:read:own',
    'report:read:own',
    'task:read:personal',
    'task:write:personal',
    'calendar:read:own',
    'calendar:write:own',
    'calendar:read:team',
  ],

  [RoleCode.SALES]: [
    'user:read:own',
    'prospect:read:any',
    'prospect:read:own',
    'prospect:write:any',
    'prospect:write:own',
    'prospect:convert:any',
    'client:read:any',
    'client:write:any',
    'contact:read:any',
    'contact:write:any',
    'contactrequest:read:any',
    'contactrequest:write:any',
    'contactrequest:convert:any',
    'project:read:any',
    'quote:read:any',
    'quote:write:any',
    'order:read:any',
    'order:validate:any',
    'project_request:read:any',
    'project_request:manage:any',
    'quote:send:any',
    'invoice:read:any',
    'payment:read:any',
    'payment:write:any',
    'document:read:any',
    'document:read:client',
    'document:write:any',
    'conversation:read:own',
    'conversation:create:own',
    'message:read:own',
    'message:write:own',
    'notification:read:own',
    'notification:manage:own',
    'dashboard:read:own',
    'report:read:any',
    // Espace personnel : ses propres tâches (tuile Tâches/Échéances) et son temps (minuteur).
    'task:read:own',
    'time:read:own',
    'time:write:own',
    'task:read:personal',
    'task:write:personal',
    'calendar:read:own',
    'calendar:write:own',
    'calendar:read:team',
  ],

  /**
   * Le role CLIENT est le plus contraint, et c'est ici que se joue l'isolation.
   *
   * Trois absences sont deliberees :
   *
   *  - AUCUNE permission `task:*`. Un client ne voit jamais les taches
   *    internes — c'est une exigence explicite du cahier des charges. Sans
   *    permission, aucun service ne peut en servir une, meme par erreur.
   *  - AUCUNE permission `document:read:any`. Seul `document:read:client`
   *    l'autorise, et il exige en plus que la visibilite en base ne soit pas
   *    INTERNAL. Deux barrieres au lieu d'une.
   *  - AUCUNE permission `activity:*`, `time:*`, `report:generate:*`.
   *
   * `quote:accept:own` est la seule permission d'ECRITURE metier du client :
   * c'est lui qui accepte son devis, et c'est cette acceptation qui declenche
   * la conversion en projet.
   */
  [RoleCode.CLIENT]: [
    'user:read:own',
    'client:read:own',
    'project:read:own',
    'milestone:read:any',
    'quote:read:own',
    'quote:accept:own',
    'order:read:own',
    'invoice:read:own',
    'payment:read:own',
    'document:read:client',
    'conversation:read:own',
    'message:read:own',
    'message:write:own',
    'notification:read:own',
    'notification:manage:own',
    'modificationrequest:read:own',
    'modificationrequest:write:own',
    'dashboard:read:own',
  ],
};

/** Libelles et descriptions des sept roles. */
export const ROLES: Record<RoleCode, { name: string; description: string }> = {
  [RoleCode.ADMIN]: {
    name: 'Administrateur',
    description: "Acces complet. Gere les comptes, les roles et les parametres de l'agence.",
  },
  [RoleCode.COMMUNICATION_MANAGER]: {
    name: 'Gerant communication',
    description: 'Anime le site public, les contenus et les demandes entrantes.',
  },
  [RoleCode.PROJECT_MANAGER]: {
    name: 'Chef de projet',
    description: 'Pilote les projets, les equipes, les jalons et les taches.',
  },
  [RoleCode.DEVELOPER]: {
    name: 'Developpeur',
    description: 'Travaille sur les taches qui lui sont assignees.',
  },
  [RoleCode.DESIGNER]: {
    name: 'Designer',
    description: 'Travaille sur les taches qui lui sont assignees.',
  },
  [RoleCode.SALES]: {
    name: 'Commercial',
    description: 'Qualifie les prospects, emet les devis et suit les factures.',
  },
  [RoleCode.CLIENT]: {
    name: 'Client',
    description:
      'Acces limite a son propre dossier : projets, devis, factures et documents partages.',
  },
};
