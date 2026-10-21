/**
 * GUIDE DE DÉMARRAGE — le catalogue des « premiers pas ».
 *
 * Ce n'est PAS une formation : pas de niveau, pas de scénario, pas de bilan,
 * pas d'environnement fictif. Chaque entrée est un geste utile dans l'outil
 * RÉEL, vérifiable par le serveur quand c'est possible :
 *
 *  - `action` : le serveur constate l'effet dans les vraies données (une tâche
 *    personnelle existe, un temps a été saisi, un prospect a été créé…).
 *    La coche n'est jamais décorative : elle vient d'un `count` en base.
 *  - `visit`  : un écran à avoir ouvert. Le serveur ne peut pas prouver une
 *    lecture ; l'étape se valide donc par une micro-question (`recall`) dont la
 *    réponse est vérifiée côté serveur — de quoi s'assurer que le membre a
 *    retenu le geste, pas seulement cliqué.
 *
 * Règles de rédaction, non négociables :
 *  1. un titre à l'impératif, une consigne d'UNE phrase, une raison d'UNE phrase ;
 *  2. aucune procédure inventée : on ne décrit que ce que l'application fait ;
 *  3. chaque étape reste atteignable avec les droits du porteur
 *     (`anyPermissions`), sinon elle n'est pas affichée ;
 *  4. les preuves sont bornées à la personne (`{{userId}}`) : un membre ne
 *     valide jamais une étape avec le travail d'un collègue.
 */

export type GuideSpace = 'personal' | 'team' | 'comexa' | 'client';

/** Preuve lue sur les données de PRODUCTION. */
export interface GuideProof {
  /** Modèle Prisma existant, en minuscule (voir `PROOF_MODELS`). */
  readonly model: string;
  /** Filtre littéral ; `{{userId}}` est remplacé par le porteur. */
  readonly where: Readonly<Record<string, unknown>>;
  /** Nombre minimal de lignes attendues (défaut : 1). */
  readonly minCount?: number;
}

export interface GuideRecallOption {
  readonly id: string;
  readonly label: string;
}

/**
 * Micro-question de mémorisation.
 *
 * `answerId` NE QUITTE JAMAIS LE SERVEUR : le navigateur ne reçoit que la
 * question et les options, la correction est faite ici.
 */
export interface GuideRecall {
  readonly question: string;
  readonly options: readonly GuideRecallOption[];
  readonly answerId: string;
  readonly explanation: string;
}

export interface GuideStepDefinition {
  /** `<espace>:<slug>` — préfixe exigé par `OnboardingProgress.completedChapterIds`. */
  readonly id: string;
  readonly space: GuideSpace;
  readonly kind: 'action' | 'visit';
  readonly title: string;
  readonly prompt: string;
  readonly why: string;
  readonly href: string;
  /** `data-coach-id` du contrôle réel à montrer, quand il existe. */
  readonly target?: string;
  /** Au moins une de ces permissions ouvre l'étape (vide : l'espace suffit). */
  readonly anyPermissions?: readonly string[];
  readonly proof?: GuideProof;
  readonly recall?: GuideRecall;
}

/**
 * Modèles autorisés pour une preuve.
 *
 * Liste FERMÉE et volontaire : une faute de frappe dans le catalogue doit
 * rendre une étape non validable (fail-closed), jamais interroger un modèle
 * arbitraire.
 */
export const PROOF_MODELS: ReadonlySet<string> = new Set([
  'task',
  'timeEntry',
  'prospect',
  'quote',
  'project',
  'modificationRequest',
]);

const PERSONAL: readonly GuideStepDefinition[] = [
  {
    id: 'personal:premiere-tache',
    space: 'personal',
    kind: 'action',
    title: 'Créer une tâche personnelle',
    prompt: 'Dans « Mes tâches », tapez un intitulé dans « Nouvelle tâche personnelle… », puis « Ajouter ».',
    why: 'Une tâche notée est une tâche faite : c’est votre mémoire de la journée.',
    href: '/espace-personnel/taches',
    target: 'taches-create-form',
    anyPermissions: ['task:write:personal', 'task:write:own'],
    proof: {
      model: 'task',
      where: { assigneeId: '{{userId}}', isPersonal: true },
      minCount: 1,
    },
  },
  {
    id: 'personal:faire-avancer',
    space: 'personal',
    kind: 'action',
    title: 'Faire avancer une tâche',
    prompt: 'Changez le statut d’une de vos tâches en « En cours ».',
    why: 'Le statut prévient tout le monde sans réunion : l’équipe voit que c’est commencé.',
    href: '/espace-personnel/taches',
    anyPermissions: ['task:read:assigned', 'task:read:own', 'task:read:personal', 'task:read:any'],
    proof: {
      model: 'task',
      where: { assigneeId: '{{userId}}', status: 'IN_PROGRESS' },
      minCount: 1,
    },
  },
  {
    id: 'personal:chronometrer',
    space: 'personal',
    kind: 'action',
    title: 'Chronométrer votre travail',
    prompt: 'Lancez le minuteur ▶ sur une tâche, laissez-le tourner un instant, puis arrêtez-le (■).',
    why: 'Le temps capté au fil de l’eau remplace la reconstitution du vendredi.',
    href: '/espace-personnel/taches',
    target: 'timer-start-button',
    anyPermissions: ['time:write:own'],
    proof: {
      model: 'timeEntry',
      where: { userId: '{{userId}}' },
      minCount: 1,
    },
  },
  {
    id: 'personal:lire-temps',
    space: 'personal',
    kind: 'visit',
    title: 'Relire votre temps',
    prompt: 'Ouvrez « Mon temps » : la saisie que vous venez d’enregistrer doit apparaître dans la semaine.',
    why: 'Relire sa saisie évite les corrections de fin de mois.',
    href: '/espace-personnel/temps',
    anyPermissions: ['time:read:own', 'time:write:own'],
    recall: {
      question: 'Où retrouvez-vous le temps que vous venez d’enregistrer ?',
      options: [
        { id: 'temps', label: 'Dans « Mon temps »' },
        { id: 'taches', label: 'Dans « Mes tâches »' },
        { id: 'notifications', label: 'Dans les notifications' },
      ],
      answerId: 'temps',
      explanation:
        '« Mon temps » liste vos saisies, y compris celles créées par le minuteur d’une tâche.',
    },
  },
];

const TEAM: readonly GuideStepDefinition[] = [
  {
    id: 'team:prospect',
    space: 'team',
    kind: 'action',
    title: 'Enregistrer un prospect',
    prompt: 'Dans « Prospects », cliquez « Nouveau prospect » et remplissez la fiche.',
    why: 'Un contact saisi au bon endroit ne se perd pas dans une boîte mail.',
    href: '/espace-equipe/prospects',
    target: 'prospects-create-button',
    anyPermissions: ['prospect:write:any', 'prospect:write:own'],
    proof: {
      model: 'prospect',
      where: { ownerId: '{{userId}}' },
      minCount: 1,
    },
  },
  {
    id: 'team:devis',
    space: 'team',
    kind: 'visit',
    title: 'Lire un devis',
    prompt: 'Ouvrez « Devis », puis un devis : vérifiez le destinataire, les lignes et le statut.',
    why: 'Un devis se relit avant de partir : destinataire, prix, TVA.',
    href: '/espace-equipe/devis',
    anyPermissions: ['quote:read:any', 'quote:read:own'],
    recall: {
      question: 'Un devis est encore « Brouillon ». Que faut-il faire pour que le client le reçoive ?',
      options: [
        { id: 'envoyer', label: 'L’envoyer depuis sa fiche' },
        { id: 'attendre', label: 'Attendre qu’il change tout seul' },
        { id: 'facture', label: 'Le convertir en facture' },
      ],
      answerId: 'envoyer',
      explanation:
        'Le devis passe à « Envoyé » seulement après l’envoi depuis sa fiche ; un brouillon n’est jamais transmis.',
    },
  },
  {
    id: 'team:projet',
    space: 'team',
    kind: 'visit',
    title: 'Suivre un projet',
    prompt: 'Ouvrez « Projets » : repérez les jalons et les tâches du projet en cours.',
    why: 'Les jalons disent où en est le client, les tâches ce qu’il reste à faire.',
    href: '/espace-equipe/projets',
    anyPermissions: ['project:read:any', 'project:read:own', 'project:read:assigned'],
  },
];

const COMEXA: readonly GuideStepDefinition[] = [
  {
    id: 'comexa:contenu',
    space: 'comexa',
    kind: 'visit',
    title: 'Relire une offre publiée',
    prompt: 'Ouvrez « Contenus » puis l’onglet « Services » : le texte affiché sur le site vient d’ici.',
    why: 'Ce que vous corrigez ici est publié immédiatement sur le site.',
    href: '/espace-comexa/contenu',
    anyPermissions: ['service:read:any', 'service:write:any'],
    recall: {
      question: 'Vous corrigez le texte d’une offre. Où la modification apparaît-elle ?',
      options: [
        { id: 'site', label: 'Sur le site public, après enregistrement' },
        { id: 'nulle-part', label: 'Nulle part : il faut redéployer le site' },
        { id: 'mail', label: 'Dans un e-mail envoyé aux visiteurs' },
      ],
      answerId: 'site',
      explanation:
        'Les contenus servis par l’API alimentent le site public : enregistrer suffit à publier.',
    },
  },
  {
    id: 'comexa:membres',
    space: 'comexa',
    kind: 'visit',
    title: 'Comprendre les rôles',
    prompt: 'Ouvrez « Membres » : à chaque rôle correspondent des droits précis dans les espaces.',
    why: 'Un rôle mal choisi ouvre trop, ou bloque un collègue.',
    href: '/espace-comexa/membres',
    anyPermissions: ['user:read:any', 'user:manage:any', 'role:read:any'],
  },
];

const CLIENT: readonly GuideStepDefinition[] = [
  {
    id: 'client:devis',
    space: 'client',
    kind: 'visit',
    title: 'Consulter vos devis',
    prompt: 'Ouvrez « Mes devis » : chaque proposition en attente attend votre décision.',
    why: 'Accepter depuis la fiche fait démarrer le projet ; répondre par e-mail ne suffit pas.',
    href: '/espace-client/devis',
    anyPermissions: ['quote:read:own', 'quote:accept:own'],
    recall: {
      question: 'Comment acceptez-vous un devis ?',
      options: [
        { id: 'fiche', label: 'Depuis sa fiche, avec le bouton « Accepter le devis »' },
        { id: 'mail', label: 'En répondant à l’e-mail' },
        { id: 'appel', label: 'Par téléphone uniquement' },
      ],
      answerId: 'fiche',
      explanation:
        'L’acceptation se fait dans l’outil : elle est horodatée et déclenche la suite du projet.',
    },
  },
  {
    id: 'client:demandes',
    space: 'client',
    kind: 'visit',
    title: 'Suivre vos demandes',
    prompt: 'Ouvrez « Mes demandes » : chaque évolution demandée y est suivie jusqu’à sa décision.',
    why: 'Une demande déposée ici est tracée ; une demande orale se perd.',
    href: '/espace-client/modifications',
    anyPermissions: ['modificationrequest:read:own', 'modificationrequest:write:own'],
  },
];

export const GUIDE_STEPS: readonly GuideStepDefinition[] = [
  ...PERSONAL,
  ...TEAM,
  ...COMEXA,
  ...CLIENT,
];

export const GUIDE_SPACE_LABELS: Readonly<Record<GuideSpace, string>> = {
  personal: 'Espace personnel',
  team: 'Espace équipe',
  comexa: 'Comexa Space',
  client: 'Espace client',
};

/** Ordre d'affichage des espaces dans le guide. */
export const GUIDE_SPACE_ORDER: readonly GuideSpace[] = ['personal', 'team', 'comexa', 'client'];

export function findGuideStep(stepId: string): GuideStepDefinition | null {
  return GUIDE_STEPS.find((step) => step.id === stepId) ?? null;
}
