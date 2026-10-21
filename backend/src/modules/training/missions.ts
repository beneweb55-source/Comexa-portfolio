/**
 * CATALOGUE DE FORMATION COMEXA — missions par espace, par rôle, par niveau.
 *
 * Principes (règles projet, non négociables) :
 *  1. Les missions s'appuient sur des PERMISSIONS RÉELLES du catalogue. Un rôle
 *     sans la permission concernée ne voit pas la mission. La même mission n'est
 *     jamais présentée à deux rôles avec des droits différents sans adaptation.
 *  2. Les cibles du coach (`steps.target`) pointent vers des `data-coach-id`
 *     POSÉS SUR DE VRAIS COMPOSANTS de l'interface (voir pages concernées) —
 *     jamais une position approximative, jamais un sélecteur fragile.
 *  3. Les noms des objets créés par l'apprenant sont EXCLUSIFS aux missions
 *     (voir `training-fixtures.ts` pour les noms déjà présents dans l'exercice).
 *  4. La réussite se vérifie sur l'ÉTAT RÉEL des données d'entraînement
 *     (`criteria`, `evaluation.criteria`) — jamais sur un clic « Terminer ».
 *  5. Aucune procédure métier n'est inventée : les points non déductibles du
 *     code sont listés dans `toConfirm`, jamais imposés comme règles.
 *
 * Les 5 niveaux demandés se lisent ainsi :
 *   1 · Découvrir l'espace        (missions L1, guidées)
 *   2 · Opérations courantes      (missions L2, guidées)
 *   3 · Scénario complet          (missions L3, enchaînement)
 *   4 · Détecter et corriger      (missions L4, erreurs fréquentes)
 *   5 · Mission finale            (le mode « Évaluation » de chaque mission :
 *                                  même scénario, AUCUNE assistance, critères
 *                                  d'évaluation vérifiés côté serveur).
 */

export type TrainingSpace = "personal" | "team" | "comexa" | "client";
export type TrainingLevel = 1 | 2 | 3 | 4;
export type TrainingStepKind = "action" | "verify" | "navigate" | "manual";
/** Niveau d'assistance du coach pour une tentative. */
export type AssistanceLevel = "full" | "reduced" | "none";

export interface TrainingStep {
  id: string;
  order: number;
  title: string;
  body: string;
  why: string;
  expect: string;
  advanceOn: TrainingStepKind;
  /** Pour `advanceOn = "navigate"` : chemin où aller (page réelle). */
  navigateTo?: string;
  /** Pour `advanceOn = "action"` : `data-coach-id` d'un composant réel. */
  target?: string;
  /** Pour `advanceOn = "verify"` : identifiant du critère à satisfaire. */
  criterionId?: string;
  hint: { text: string; docPath?: string };
}

export interface TrainingCriterion {
  id: string;
  label: string;
  resultLabel: string;
  /** Modèle Prisma EXISTANT. */
  model: string;
  /** Filtre Prisma littéral. `{{userId}}` et `{{now}}` sont substitués. */
  where: Record<string, unknown>;
  /** Au moins N résultats (vérifie que l'action a réellement eu lieu). */
  minCount?: number;
  /** Nombre exact attendu. */
  expectCount?: number;
}

/** Alias attendu par la vérification. */
export type MissionCriterion = TrainingCriterion;

export interface TrainingMission {
  id: string;
  space: TrainingSpace;
  level: TrainingLevel;
  kind: "discovery" | "operations" | "scenario" | "evaluation";
  /** Module COMEXA réel concerné (libellé du bilan et des raccourcis). */
  module: string;
  title: string;
  goal: string;
  situation: string;
  roles: string[];
  permissions: string[];
  actions: string[];
  checksBefore: string[];
  pitfalls: { mistake: string; consequence: string }[];
  doneWhen: string[];
  escalation: string;
  steps: TrainingStep[];
  checklist: string[];
  toConfirm: string[];
  realModuleHref: string;
  criteria: TrainingCriterion[];
  evaluation: {
    title: string;
    instructions: string;
    criteria: TrainingCriterion[];
  };
}

/* ==========================================================================
   ESPACE ÉQUIPE — clients, devis, projets, tâches.
   ========================================================================== */

const TEAM_MSSIONS: TrainingMission[] = [
  {
    id: "team-prospects-convertir",
    module: "Prospects",
    space: "team",
    level: 1,
    kind: "discovery",
    title: "Qualifier un prospect et le transformer en client",
    goal: "Enregistrer un contact commercial puis ouvrir son dossier client avec la conversion prévue par l'outil.",
    situation:
      "Un contact s'est présenté : « Atelier Ziryab » (Sofiane Amrani, contact@atelier-ziryab.example, 0770 11 22 33, secteur Artisanat). Le pipeline contient déjà d'autres prospects d'exercice (« Maison Yacine », « Studio Falco ») : observez-les pour comprendre le suivi, puis enregistrez celui-ci et convertissez-le en client.",
    roles: ["Chef de projet", "Commercial"],
    permissions: ["prospect:read:any", "prospect:write:any", "prospect:convert:any"],
    actions: [
      "Enregistrer le prospect « Atelier Ziryab » avec son contact",
      "Ouvrir sa fiche et lancer la conversion en client",
      "Vérifier que le dossier client existe",
    ],
    checksBefore: [
      "Le prospect n'existe pas déjà (recherchez « Atelier Ziryab » avant de créer)",
      "L'e-mail est unique et bien orthographié : c'est la clé de contact",
    ],
    pitfalls: [
      {
        mistake: "Créer une fiche client à la main plutôt que de convertir le prospect",
        consequence: "La provenance commerciale est perdue : le pipeline et l'historique du prospect ne sont plus suivis.",
      },
      {
        mistake: "Remplir l'entreprise mais oublier le contact (prénom/nom)",
        consequence: "Le formulaire est incomplet : l'enregistrement est refusé ou la fiche reste inexploitable.",
      },
    ],
    doneWhen: [
      "Le prospect « Atelier Ziryab » existe avec les coordonnées demandées",
      "Il apparaît converti : un dossier client « Atelier Ziryab » existe",
    ],
    escalation:
      "Si le bouton « Convertir en client » n'est pas proposé, un collègue a peut-être déjà converti ce prospect : vérifiez la liste des clients et demandez à votre responsable avant de dupliquer.",
    steps: [
      {
        id: "team-prospects-convertir/open",
        order: 1,
        title: "Ouvrir le pipeline",
        body: "Rendez-vous dans « Prospects » de l'espace équipe pour voir le pipeline commercial.",
        why: "Le pipeline centralise les contacts à qualifier ; c'est le point de départ de tout nouveau dossier client.",
        expect: "La liste des prospects d'exercice (« Maison Yacine », « Studio Falco ») s'affiche.",
        advanceOn: "navigate",
        navigateTo: "/espace-equipe/prospects",
        hint: {
          text: "Menu de gauche : « Prospects ». Si la page s'affiche en grille, c'est normal : c'est le tableau du pipeline.",
          docPath: "docs/FORMATION.md#missions-espace-equipe",
        },
      },
      {
        id: "team-prospects-convertir/create",
        order: 2,
        title: "Enregistrer le prospect",
        body: "Cliquez sur « Nouveau prospect » et remplissez : Entreprise « Atelier Ziryab », Prénom « Sofiane », Nom « Amrani », E-mail « contact@atelier-ziryab.example », Téléphone « 0770 11 22 33 », Secteur « Artisanat ».",
        why: "Une fiche complète permet au commercial de reprendre le contact sans relancer l'information auprès du client.",
        expect: "Le formulaire « Nouveau prospect » est rempli et le prospect est créé.",
        advanceOn: "action",
        target: "prospects-create-button",
        hint: {
          text: "Les champs obligatoires sont marqués d'un astérisque. Le bouton « Créer le prospect » est en bas du formulaire.",
        },
      },
      {
        id: "team-prospects-convertir/verify-prospect",
        order: 3,
        title: "Contrôler l'enregistrement",
        body: "Le coach vérifie que le prospect existe réellement dans les données d'exercice avant de poursuivre.",
        why: "Toujours confirmer qu'une création a bien eu lieu avant d'enchaîner : un clic ne vaut pas enregistrement.",
        expect: "Le prospect « Atelier Ziryab » est détecté dans le pipeline.",
        advanceOn: "verify",
        criterionId: "prospect-cree",
        hint: {
          text: "Rouvrez la liste des prospects si vous voulez voir la nouvelle fiche apparaître.",
        },
      },
      {
        id: "team-prospects-convertir/convert",
        order: 4,
        title: "Convertir en client",
        body: "Ouvrez la fiche « Atelier Ziryab » et cliquez sur « Convertir en client ».",
        why: "La conversion est le passage officiel d'un prospect à un client : elle garde l'historique commercial plutôt que de repartir de zéro.",
        expect: "Un dossier client est créé à partir du prospect.",
        advanceOn: "action",
        target: "prospect-convert-button",
        hint: {
          text: "Sur la fiche du prospect, le bouton « Convertir en client » est visible tant que la conversion n'est pas faite.",
        },
      },
      {
        id: "team-prospects-convertir/verify-client",
        order: 5,
        title: "Contrôler le dossier client",
        body: "Le coach vérifie que le dossier client « Atelier Ziryab » existe. Retrouvez-le ensuite dans « Clients ».",
        why: "Le dossier client est la base de toute facturation : sa présence est la preuve que la chaîne commerciale est complète.",
        expect: "Le client « Atelier Ziryab » est détecté.",
        advanceOn: "verify",
        criterionId: "client-cree",
        hint: {
          text: "Menu « Clients » : le nouveau dossier s'y trouve, avec la référence attribuée automatiquement.",
        },
      },
    ],
    checklist: [
      "Vérifier l'absence de doublon avant toute création (recherche d'abord)",
      "Renseigner entreprise ET contact : les deux sont nécessaires",
      "Contrôler la fiche créée avant de passer à l'étape suivante",
    ],
    toConfirm: [
      "Délai de rappel d'un prospect : aucune règle de relance n'est codée — à faire confirmer par votre responsable commercial.",
    ],
    realModuleHref: "/espace-equipe/prospects",
    criteria: [
      {
        id: "prospect-cree",
        label: "Le prospect « Atelier Ziryab » est enregistré avec ses coordonnées",
        resultLabel: "Prospect « Atelier Ziryab » enregistré",
        model: "prospect",
        where: { companyName: "Atelier Ziryab", email: "contact@atelier-ziryab.example" },
        minCount: 1,
      },
      {
        id: "client-cree",
        label: "Un dossier client « Atelier Ziryab » existe (conversion faite)",
        resultLabel: "Client « Atelier Ziryab » créé",
        model: "client",
        where: { companyName: "Atelier Ziryab" },
        minCount: 1,
      },
    ],
    evaluation: {
      title: "Évaluation finale — qualifier et convertir sans assistance",
      instructions:
        "Répétez le processus pour un nouveau contact, SANS le coach : enregistrez le prospect « Clinique El Wafa » (contact « Nadia Belkacem », e-mail « contact@clinique-elwafa.example », téléphone « 0770 44 55 66 », secteur « Santé »), puis convertissez-le en client.",
      criteria: [
        {
          id: "eval-prospect-cree",
          label: "Le prospect « Clinique El Wafa » est enregistré avec ses coordonnées",
          resultLabel: "Prospect « Clinique El Wafa » enregistré",
          model: "prospect",
          where: { companyName: "Clinique El Wafa", email: "contact@clinique-elwafa.example" },
          minCount: 1,
        },
        {
          id: "eval-client-cree",
          label: "Un dossier client « Clinique El Wafa » existe (conversion faite)",
          resultLabel: "Client « Clinique El Wafa » créé",
          model: "client",
          where: { companyName: "Clinique El Wafa" },
          minCount: 1,
        },
      ],
    },
  },
  {
    id: "team-devis-emettre",
    module: "Devis",
    space: "team",
    level: 2,
    kind: "operations",
    title: "Émettre un devis et l'envoyer au client",
    goal: "Produire un devis lisible (prestation, prix, TVA, validité) et l'envoyer avec l'envoi prévu par l'outil.",
    situation:
      "Le client d'exercice « Coopérative Numérique » demande une offre pour sa « Refonte catalogue ». Vous devez émettre un devis avec la prestation « Création de site web » (tarif conseillé pour l'exercice : 4 500 DZD HT, TVA 19 %).",
    roles: ["Chef de projet", "Commercial"],
    permissions: ["quote:read:any", "quote:write:any", "quote:send:any", "contact:read:any"],
    actions: [
      "Créer le devis pour « Coopérative Numérique » avec la prestation « Création de site web »",
      "Relire montants, TVA et date de validité",
      "Envoyer le devis au client depuis sa fiche",
    ],
    checksBefore: [
      "Le bon client est sélectionné dans le destinataire",
      "L'intitulé de ligne correspond à la prestation vendue (« Création de site web »)",
      "Le total TTC est cohérent (HT + TVA)",
    ],
    pitfalls: [
      {
        mistake: "Oublier de vérifier le destinataire avant d'envoyer",
        consequence: "Le devis part chez le mauvais client : il faut le signaler et en émettre un nouveau.",
      },
      {
        mistake: "Envoyer un devis resté en brouillon sans relecture",
        consequence: "Un montant ou une prestation erronée engage l'agence lorsqu'il est accepté.",
      },
    ],
    doneWhen: [
      "Le devis « Refonte catalogue » existe pour « Coopérative Numérique »",
      "Il porte la ligne « Création de site web »",
      "Il n'est plus en brouillon : il a été envoyé au client",
    ],
    escalation:
      "Un tarif en dehors de la fourchette habituelle ou une remise importante doit être validé par votre responsable avant l'envoi : aucun montant de validation n'est codé dans l'outil (point à faire confirmer).",
    steps: [
      {
        id: "team-devis-emettre/open",
        order: 1,
        title: "Ouvrir les devis",
        body: "Rendez-vous dans « Devis » de l'espace équipe.",
        why: "La liste des devis montre l'état de chaque proposition (brouillon, envoyée, acceptée…) : c'est le tableau de bord commercial.",
        expect: "La liste des devis d'exercice s'affiche.",
        advanceOn: "navigate",
        navigateTo: "/espace-equipe/devis",
        hint: { text: "Menu de gauche : « Devis ».", docPath: "docs/FORMATION.md#missions-espace-equipe" },
      },
      {
        id: "team-devis-emettre/create",
        order: 2,
        title: "Remplir le devis",
        body: "Cliquez sur « Nouveau devis ». Destinataire : « Coopérative Numérique ». Objet : « Refonte catalogue ». Ajoutez une ligne « Création de site web », quantité 1, prix HT 4 500. Vérifiez la TVA (19 %) et une date de validité.",
        why: "Un devis est un engagement : l'objet et les lignes doivent décrire exactement ce qui est vendu.",
        expect: "Le formulaire de création de devis est rempli et enregistré.",
        advanceOn: "action",
        target: "devis-create-button",
        hint: {
          text: "Le bouton « Ajouter une ligne » permet de préciser plusieurs prestations. Le bouton d'enregistrement est en bas de page.",
        },
      },
      {
        id: "team-devis-emettre/verify-quote",
        order: 3,
        title: "Contrôler le devis créé",
        body: "Le coach vérifie que le devis existe avec la bonne prestation avant l'envoi.",
        why: "Vérifier l'enregistrement avant l'envoi : un devis inexistant ne peut pas être envoyé, et un devis erroné ne doit jamais l'être.",
        expect: "Le devis « Refonte catalogue » avec la ligne « Création de site web » est détecté.",
        advanceOn: "verify",
        criterionId: "devis-cree",
        hint: { text: "Rouvrez la liste « Devis » : le nouveau brouillon y figure." },
      },
      {
        id: "team-devis-emettre/send",
        order: 4,
        title: "Envoyer au client",
        body: "Ouvrez le devis « Refonte catalogue » et cliquez sur « Envoyer au client ».",
        why: "L'envoi officiel déclenche la notification client et le statut du devis : c'est l'acte commercial, pas une simple sauvegarde.",
        expect: "Le devis quitte le statut brouillon.",
        advanceOn: "action",
        target: "devis-send-button",
        hint: { text: "Sur la fiche du devis, le bouton « Envoyer au client » est proposé tant que le devis est en brouillon." },
      },
      {
        id: "team-devis-emettre/verify-sent",
        order: 5,
        title: "Contrôler l'envoi",
        body: "Le coach vérifie que le devis n'est plus un brouillon.",
        why: "L'état « envoyé » dans les données est la seule preuve d'un envoi effectif.",
        expect: "Le devis « Refonte catalogue » est détecté comme envoyé.",
        advanceOn: "verify",
        criterionId: "devis-envoye",
        hint: { text: "Le badge de statut du devis affiche désormais « Envoyé »." },
      },
    ],
    checklist: [
      "Destinataire, objet et lignes relus AVANT l'envoi",
      "TVA et validité vérifiées : le total TTC doit être cohérent",
      "Envoi effectué depuis la fiche du devis (pas seulement enregistré)",
    ],
    toConfirm: [
      "Barème de remise et seuils d'approbation : rien n'est codé dans l'outil — à faire confirmer par votre responsable.",
    ],
    realModuleHref: "/espace-equipe/devis",
    criteria: [
      {
        id: "devis-cree",
        label: "Le devis « Refonte catalogue » existe pour « Coopérative Numérique » avec la prestation « Création de site web »",
        resultLabel: "Devis « Refonte catalogue » créé",
        model: "quote",
        where: {
          client: { companyName: "Coopérative Numérique" },
          subject: "Refonte catalogue",
          items: { some: { title: "Création de site web" } },
        },
        minCount: 1,
      },
      {
        id: "devis-envoye",
        label: "Ce devis a été envoyé (il n'est plus en brouillon)",
        resultLabel: "Devis envoyé au client",
        model: "quote",
        where: {
          client: { companyName: "Coopérative Numérique" },
          subject: "Refonte catalogue",
          status: { not: "DRAFT" },
        },
        minCount: 1,
      },
    ],
    evaluation: {
      title: "Évaluation finale — émettre et envoyer un devis sans assistance",
      instructions:
        "Pour le client « Dar El Mahatta », émettez un devis « Contrat de maintenance » avec la prestation « Maintenance et évolution » (1 × 3 200 DZD HT, TVA 19 %) et envoyez-le au client.",
      criteria: [
        {
          id: "eval-devis-cree",
          label: "Le devis « Contrat de maintenance » existe pour « Dar El Mahatta » avec la prestation « Maintenance et évolution »",
          resultLabel: "Devis « Contrat de maintenance » créé",
          model: "quote",
          where: {
            client: { companyName: "Dar El Mahatta" },
            subject: "Contrat de maintenance",
            items: { some: { title: "Maintenance et évolution" } },
          },
          minCount: 1,
        },
        {
          id: "eval-devis-envoye",
          label: "Ce devis a été envoyé (il n'est plus en brouillon)",
          resultLabel: "Devis envoyé au client",
          model: "quote",
          where: {
            client: { companyName: "Dar El Mahatta" },
            subject: "Contrat de maintenance",
            status: { not: "DRAFT" },
          },
          minCount: 1,
        },
      ],
    },
  },
  {
    id: "team-projet-piloter",
    module: "Projets",
    space: "team",
    level: 3,
    kind: "scenario",
    title: "Piloter un projet ouvert : jalon et tâche d'équipe",
    goal: "Prendre en main un projet existant : poser une étape contractuelle (jalon) et lancer une tâche assignée à un collègue.",
    situation:
      "Le projet d'exercice « Refonte site vitrine » (client « Coopérative Numérique ») est ouvert. Le chef de projet doit cadrer la recette avec le client et faire avancer la production : jalon « Recette client » à créer, tâche « Intégrer la maquette » à confier.",
    roles: ["Chef de projet"],
    permissions: ["project:read:any", "milestone:read:any", "milestone:write:any", "task:read:any", "task:write:any", "task:assign:any"],
    actions: [
      "Ouvrir le projet « Refonte site vitrine »",
      "Créer le jalon « Recette client »",
      "Créer la tâche « Intégrer la maquette » et la confier à un collègue",
    ],
    checksBefore: [
      "Vous êtes bien sur le bon projet (vérifiez le nom et le client affichés)",
      "Le jalon décrit une étape vérifiable avec le client, pas une tâche interne",
    ],
    pitfalls: [
      {
        mistake: "Mettre des tâches internes dans les jalons",
        consequence: "Les jalons servent au suivi contractuel avec le client : les mélanger rend le planning inexploitable.",
      },
      {
        mistake: "Créer une tâche sans l'assigner",
        consequence: "La tâche reste non assignée : personne ne la retrouve dans son travail du jour.",
      },
    ],
    doneWhen: [
      "Le projet « Refonte site vitrine » comporte le jalon « Recette client »",
      "La tâche « Intégrer la maquette » existe et est confiée",
    ],
    escalation:
      "Si le jalon demandé touche une date contractuelle engageante, faites-la valider par votre responsable : aucune règle d'échéance automatique n'est codée dans l'outil.",
    steps: [
      {
        id: "team-projet-piloter/open",
        order: 1,
        title: "Ouvrir les projets",
        body: "Rendez-vous dans « Projets » et repérez « Refonte site vitrine ».",
        why: "La liste des projets est l'entrée du pilotage : elle montre santé, avancement et échéances.",
        expect: "La liste des projets d'exercice s'affiche, dont « Refonte site vitrine ».",
        advanceOn: "navigate",
        navigateTo: "/espace-equipe/projets",
        hint: { text: "Menu de gauche : « Projets ».", docPath: "docs/FORMATION.md#missions-espace-equipe" },
      },
      {
        id: "team-projet-piloter/milestone",
        order: 2,
        title: "Créer le jalon « Recette client »",
        body: "Ouvrez « Refonte site vitrine ». Dans la carte « Jalons », ajoutez « Recette client ».",
        why: "Un jalon matérialise une étape à valider avec le client : c'est lui qui structure le suivi contractuel.",
        expect: "Le formulaire d'ajout de jalon est utilisé et le jalon apparaît dans la liste.",
        advanceOn: "action",
        target: "projet-milestone-submit",
        hint: { text: "Formulaire « Nouveau jalon » en bas de la carte « Jalons », puis « Ajouter le jalon »." },
      },
      {
        id: "team-projet-piloter/verify-milestone",
        order: 3,
        title: "Contrôler le jalon",
        body: "Le coach vérifie que le jalon « Recette client » existe sur le projet.",
        why: "Un jalon non enregistré ne sera pas suivi : la vérification par l'outil évite les oublis.",
        expect: "Le jalon est détecté sur « Refonte site vitrine ».",
        advanceOn: "verify",
        criterionId: "jalon-cree",
        hint: { text: "La liste des jalons du projet se met à jour immédiatement." },
      },
      {
        id: "team-projet-piloter/task",
        order: 4,
        title: "Lancer la tâche d'équipe",
        body: "Dans la carte « Tâches » du projet, ajoutez la tâche « Intégrer la maquette » et confiez-la à un collègue de l'équipe.",
        why: "Assigner, c'est rendre la tâche visible dans le travail de la personne désignée : une tâche non assignée n'avance pas.",
        expect: "La tâche « Intégrer la maquette » est créée et assignée.",
        advanceOn: "action",
        target: "projet-task-submit",
        hint: { text: "Formulaire « Nouvelle tâche » en bas de la carte « Tâches » : choisissez la personne dans « Confier à »." },
      },
      {
        id: "team-projet-piloter/verify-task",
        order: 5,
        title: "Contrôler la tâche",
        body: "Le coach vérifie que la tâche « Intégrer la maquette » existe dans les données d'exercice.",
        why: "La tâche enregistrée est le point de départ du suivi de production : c'est l'état réel qui compte.",
        expect: "La tâche est détectée.",
        advanceOn: "verify",
        criterionId: "tache-cree",
        hint: { text: "Retrouvez-la dans « Tâches », filtre « Toutes »." },
      },
    ],
    checklist: [
      "Vérifier projet et client affichés avant toute modification",
      "Jalon = étape client ; tâche = travail interne : ne pas les mélanger",
      "Toujours assigner la tâche créée (ou l'assumer soi-même explicitement)",
    ],
    toConfirm: [
      "Qui valide une date de jalon engageante : la règle n'est pas codée — à faire confirmer par votre responsable.",
    ],
    realModuleHref: "/espace-equipe/projets",
    criteria: [
      {
        id: "jalon-cree",
        label: "Le jalon « Recette client » existe sur le projet « Refonte site vitrine »",
        resultLabel: "Jalon « Recette client » créé",
        model: "milestone",
        where: { project: { name: "Refonte site vitrine" }, title: "Recette client" },
        minCount: 1,
      },
      {
        id: "tache-cree",
        label: "La tâche « Intégrer la maquette » existe",
        resultLabel: "Tâche « Intégrer la maquette » créée",
        model: "task",
        where: { title: "Intégrer la maquette" },
        minCount: 1,
      },
    ],
    evaluation: {
      title: "Évaluation finale — piloter un projet sans assistance",
      instructions:
        "Toujours sur « Refonte site vitrine » : créez le jalon « Livraison » et la tâche « Préparer la recette client » assignée à un collègue.",
      criteria: [
        {
          id: "eval-jalon-cree",
          label: "Le jalon « Livraison » existe sur « Refonte site vitrine »",
          resultLabel: "Jalon « Livraison » créé",
          model: "milestone",
          where: { project: { name: "Refonte site vitrine" }, title: "Livraison" },
          minCount: 1,
        },
        {
          id: "eval-tache-cree",
          label: "La tâche « Préparer la recette client » existe",
          resultLabel: "Tâche « Préparer la recette client » créée",
          model: "task",
          where: { title: "Préparer la recette client" },
          minCount: 1,
        },
      ],
    },
  },
  {
    id: "team-erreurs-corriger",
    module: "Devis",
    space: "team",
    level: 4,
    kind: "evaluation",
    title: "Détecter et corriger une erreur de devis",
    goal: "Repérer une incohérence avant qu'elle ne parte au client, et produire la bonne version sans envoyer la mauvaise.",
    situation:
      "Un brouillon de devis pour « Cabinet Falconi » liste la prestation « Maintenance et évolution » alors que la demande porte sur une « Création de site web ». Le brouillon fautif est déjà dans les devis (objet « Création de site web ») : NE L'ENVOYEZ PAS. Émettez le devis correct : même client, objet « Création de site web », ligne « Création de site web » (4 500 DZD HT, TVA 19 %).",
    roles: ["Chef de projet", "Commercial"],
    permissions: ["quote:read:any", "quote:write:any", "quote:send:any"],
    actions: [
      "Ouvrir les devis de « Cabinet Falconi » et constater l'erreur de ligne",
      "Émettre un nouveau devis correct (ligne « Création de site web »)",
      "Laisser le brouillon erroné non envoyé",
    ],
    checksBefore: [
      "Avant tout envoi : la ligne du devis correspond-elle à la demande du client ?",
      "Le client et l'objet du devis sont-ils cohérents entre eux ?",
    ],
    pitfalls: [
      {
        mistake: "Envoyer le brouillon tel quel pour « gagner du temps »",
        consequence: "Le client reçoit une prestation qu'il n'a pas demandée : la confiance et la facturation en pâtissent.",
      },
      {
        mistake: "Corriger « dans sa tête » sans émettre la version correcte",
        consequence: "Rien n'est traçable : l'erreur reviendra au moment de facturer.",
      },
    ],
    doneWhen: [
      "Un devis « Création de site web » avec la ligne « Création de site web » existe pour « Cabinet Falconi »",
      "Le brouillon erroné n'a pas été envoyé (il reste en brouillon)",
    ],
    escalation:
      "Si un devis erroné a DÉJÀ été envoyé, prévenez votre responsable : la procédure de rétractation/avenant n'est pas codée dans l'outil (point à faire confirmer).",
    steps: [
      {
        id: "team-erreurs-corriger/open",
        order: 1,
        title: "Ouvrir les devis de l'exercice",
        body: "Rendez-vous dans « Devis » et ouvrez le brouillon de « Cabinet Falconi » (objet « Création de site web »).",
        why: "Toute correction commence par constater l'erreur sur le document réel, pas sur une description orale.",
        expect: "Le brouillon affiche la ligne « Maintenance et évolution » — incohérente avec la demande.",
        advanceOn: "navigate",
        navigateTo: "/espace-equipe/devis",
        hint: {
          text: "Repérez le devis en statut « Brouillon » pour « Cabinet Falconi ».",
          docPath: "docs/FORMATION.md#missions-espace-equipe",
        },
      },
      {
        id: "team-erreurs-corriger/create-correct",
        order: 2,
        title: "Émettre le devis correct",
        body: "Créez un nouveau devis : destinataire « Cabinet Falconi », objet « Création de site web », ligne « Création de site web » (1 × 4 500 DZD HT, TVA 19 %). N'envoyez PAS le brouillon erroné.",
        why: "On ne détruit pas un document existant : on émet la version correcte, l'historique reste intact pour l'audit.",
        expect: "Le nouveau devis correct est enregistré.",
        advanceOn: "action",
        target: "devis-create-button",
        hint: { text: "« Nouveau devis » dans la liste des devis. Vérifiez chaque ligne avant d'enregistrer." },
      },
      {
        id: "team-erreurs-corriger/verify-fixed",
        order: 3,
        title: "Contrôler la correction",
        body: "Le coach vérifie : le devis correct existe, et le brouillon erroné n'a pas été envoyé.",
        why: "La preuve de la correction est dans les données : la bonne version existe ET la mauvaise n'est pas partie.",
        expect: "Le devis correct est détecté ; le brouillon fautif reste en brouillon.",
        advanceOn: "verify",
        criterionId: "devis-corrige",
        hint: { text: "Deux vérifications sont faites : la ligne correcte, et le statut du brouillon fautif." },
      },
    ],
    checklist: [
      "Toujours relire les LIGNES d'un devis, pas seulement son objet",
      "Ne jamais envoyer un document dont on a détecté l'erreur",
      "Émettre une version correcte plutôt que de modifier silencieusement l'historique",
    ],
    toConfirm: [
      "Procédure lorsqu'un devis erroné est déjà parti au client : non codée — à faire confirmer par votre responsable.",
    ],
    realModuleHref: "/espace-equipe/devis",
    criteria: [
      {
        id: "devis-corrige",
        label: "Un devis correct (ligne « Création de site web ») existe pour « Cabinet Falconi »",
        resultLabel: "Devis correct émis pour « Cabinet Falconi »",
        model: "quote",
        where: {
          client: { companyName: "Cabinet Falconi" },
          items: { some: { title: "Création de site web" } },
        },
        minCount: 1,
      },
      {
        id: "brouillon-preserve",
        label: "Le brouillon erroné n'a pas été envoyé (il reste en brouillon)",
        resultLabel: "Brouillon erroné non envoyé",
        model: "quote",
        where: {
          client: { companyName: "Cabinet Falconi" },
          items: { some: { title: "Maintenance et évolution" } },
          status: "DRAFT",
        },
        minCount: 1,
      },
    ],
    evaluation: {
      title: "Évaluation finale — contrôler avant d'agir, sans assistance",
      instructions:
        "On vous demande un devis de maintenance pour « Dar El Mahatta » : méfiez-vous, la demande précise « Maintenance et évolution ». Émettez le devis « Maintenance et évolution » (objet « Maintenance et évolution », ligne « Maintenance et évolution », 1 × 3 200 DZD HT, TVA 19 %) — avec la bonne ligne, pas « Création de site web ».",
      criteria: [
        {
          id: "eval-devis-corrige",
          label: "Le devis « Maintenance et évolution » (bonne ligne) existe pour « Dar El Mahatta »",
          resultLabel: "Devis correct émis pour « Dar El Mahatta »",
          model: "quote",
          where: {
            client: { companyName: "Dar El Mahatta" },
            subject: "Maintenance et évolution",
            items: { some: { title: "Maintenance et évolution" } },
          },
          minCount: 1,
        },
      ],
    },
  },
];

/* ==========================================================================
   ESPACE PERSONNEL — organisation, tâches, temps.
   ========================================================================== */

const PERSONAL_MISSIONS: TrainingMission[] = [
  {
    id: "personal-tache-assignee",
    module: "Mes tâches",
    space: "personal",
    level: 1,
    kind: "discovery",
    title: "Prendre en main mes tâches",
    goal: "Retrouver ses tâches assignées, en créer une personnelle, et faire avancer une tâche en cours.",
    situation:
      "La tâche « Préparer la maquette » vous est assignée dans l'équipe. Vous devez aussi préparer votre propre suivi : une tâche personnelle « Relire les échanges du client » à créer.",
    roles: ["Membre d'équipe", "Développeur", "Rédactrice social media", "Commercial", "Chef de projet"],
    permissions: ["task:read:assigned", "task:write:own", "task:write:personal"],
    actions: [
      "Consulter ses tâches assignées",
      "Créer la tâche personnelle « Relire les échanges du client »",
      "Passer « Préparer la maquette » en cours de réalisation",
    ],
    checksBefore: [
      "Vous travaillez bien dans votre espace personnel (la bannière de mode formation est affichée)",
      "La tâche créée est bien la vôtre (elle vous sera assignée automatiquement)",
    ],
    pitfalls: [
      {
        mistake: "Créer une tâche dans l'espace équipe alors qu'elle est personnelle",
        consequence: "Elle encombre le tableau de l'équipe : l'espace personnel existe pour ça.",
      },
      {
        mistake: "Laisser une tâche en « À faire » alors qu'elle est commencée",
        consequence: "Le suivi (le vôtre et celui de l'équipe) ne reflète plus la réalité.",
      },
    ],
    doneWhen: [
      "La tâche personnelle « Relire les échanges du client » existe",
      "La tâche « Préparer la maquette » n'est plus au statut « À faire »",
    ],
    escalation:
      "Si « Préparer la maquette » ne vous est pas assignée, ne modifiez pas la tâche d'un collègue : demandez à votre chef de projet.",
    steps: [
      {
        id: "personal-tache-assignee/open",
        order: 1,
        title: "Ouvrir mes tâches",
        body: "Rendez-vous dans « Mes tâches » de l'espace personnel.",
        why: "L'espace personnel agrège votre travail du jour : c'est là que vous pilotez vos priorités.",
        expect: "Vos tâches s'affichent, dont « Préparer la maquette ».",
        advanceOn: "navigate",
        navigateTo: "/espace-personnel/taches",
        hint: { text: "Menu de gauche : « Mes tâches ».", docPath: "docs/FORMATION.md#missions-espace-personnel" },
      },
      {
        id: "personal-tache-assignee/create",
        order: 2,
        title: "Créer ma tâche personnelle",
        body: "Utilisez le formulaire « Nouvelle tâche » pour créer « Relire les échanges du client ».",
        why: "Noter ses engagements personnels évite qu'ils se perdent dans les demandes des autres.",
        expect: "La tâche est créée et vous est assignée.",
        advanceOn: "action",
        target: "taches-create-submit",
        hint: { text: "En haut du tableau : champ « Nouvelle tâche », puis « Ajouter »." },
      },
      {
        id: "personal-tache-assignee/verify-create",
        order: 3,
        title: "Contrôler la création",
        body: "Le coach vérifie que la tâche existe et vous est assignée.",
        why: "La preuve par les données : votre tâche est enregistrée, pas seulement saisie dans un formulaire.",
        expect: "La tâche « Relire les échanges du client » est détectée.",
        advanceOn: "verify",
        criterionId: "tache-perso-cree",
        hint: { text: "Elle apparaît dans la colonne « À faire »." },
      },
      {
        id: "personal-tache-assignee/advance",
        order: 4,
        title: "Faire avancer « Préparer la maquette »",
        body: "Passez la tâche « Préparer la maquette » en cours (glissez-la vers « En cours », ou utilisez le contrôle de statut de la carte).",
        why: "Le statut est l'information de travail partagée : le mettre à jour, c'est permettre à l'équipe de s'organiser.",
        expect: "Le statut de la tâche change dans le tableau.",
        advanceOn: "action",
        target: "taches-board",
        hint: { text: "Sur le tableau : glissez la carte vers la colonne « En cours »." },
      },
      {
        id: "personal-tache-assignee/verify-status",
        order: 5,
        title: "Contrôler le statut",
        body: "Le coach vérifie que « Préparer la maquette » n'est plus « À faire ».",
        why: "Un statut juste dans les données = un tableau de bord honnête.",
        expect: "Le changement de statut est détecté.",
        advanceOn: "verify",
        criterionId: "tache-en-cours",
        hint: { text: "La carte a changé de colonne." },
      },
    ],
    checklist: [
      "Consulter ses tâches assignées en début de journée",
      "Séparer travail personnel et travail d'équipe (le bon espace)",
      "Mettre à jour le statut dès qu'une tâche démarre",
    ],
    toConfirm: [
      "Règles de priorisation entre tâches personnelles et demandes d'équipe : non codées — à faire confirmer par votre responsable.",
    ],
    realModuleHref: "/espace-personnel/taches",
    criteria: [
      {
        id: "tache-perso-cree",
        label: "La tâche personnelle « Relire les échanges du client » existe et vous est assignée",
        resultLabel: "Tâche personnelle créée",
        model: "task",
        where: { title: "Relire les échanges du client", assigneeId: "{{userId}}" },
        minCount: 1,
      },
      {
        id: "tache-en-cours",
        label: "La tâche « Préparer la maquette » a quitté le statut « À faire »",
        resultLabel: "« Préparer la maquette » en cours",
        model: "task",
        where: { title: "Préparer la maquette", status: { not: "TODO" } },
        minCount: 1,
      },
    ],
    evaluation: {
      title: "Évaluation finale — gérer mes tâches sans assistance",
      instructions:
        "Créez la tâche personnelle « Envoyer le compte-rendu au client » et amenez « Préparer la maquette » au statut « Terminée ».",
      criteria: [
        {
          id: "eval-tache-perso-cree",
          label: "La tâche « Envoyer le compte-rendu au client » existe et vous est assignée",
          resultLabel: "Tâche personnelle créée",
          model: "task",
          where: { title: "Envoyer le compte-rendu au client", assigneeId: "{{userId}}" },
          minCount: 1,
        },
        {
          id: "eval-tache-terminee",
          label: "La tâche « Préparer la maquette » est terminée",
          resultLabel: "« Préparer la maquette » terminée",
          model: "task",
          where: { title: "Préparer la maquette", status: "DONE" },
          minCount: 1,
        },
      ],
    },
  },
  {
    id: "personal-journee",
    module: "Mon temps",
    space: "personal",
    level: 2,
    kind: "operations",
    title: "Suivre mon temps de travail",
    goal: "Enregistrer du temps sur une tâche avec le minuteur — la base du suivi d'activité.",
    situation:
      "Vous travaillez sur la tâche « Préparer la maquette » : enregistrez votre temps avec le minuteur de la tâche.",
    roles: ["Membre d'équipe", "Développeur", "Rédactrice social media", "Commercial", "Chef de projet"],
    permissions: ["time:read:own", "time:write:own", "task:read:assigned"],
    actions: [
      "Démarrer le minuteur sur « Préparer la maquette »",
      "L'arrêter pour clôturer la saisie de temps",
    ],
    checksBefore: [
      "Le minuteur est lancé sur la bonne tâche (le titre s'affiche)",
      "Vous arrêtez le minuteur en fin de session : une saisie ouverte ne se clôture pas toute seule",
    ],
    pitfalls: [
      {
        mistake: "Oublier d'arrêter le minuteur",
        consequence: "La saisie de temps gonfle artificiellement et fausse le suivi d'activité.",
      },
      {
        mistake: "Lancer le minuteur sur la mauvaise tâche",
        consequence: "Le temps est imputé au mauvais travail : il faudra le corriger manuellement.",
      },
    ],
    doneWhen: [
      "Une saisie de temps existe pour « Préparer la maquette » après le début de la mission",
    ],
    escalation:
      "En cas de temps saisi par erreur, votre responsable de projet peut le corriger : la règle de correction exacte n'est pas codée (point à faire confirmer).",
    steps: [
      {
        id: "personal-journee/open",
        order: 1,
        title: "Retrouver ma tâche",
        body: "Rendez-vous dans « Mes tâches » (ou votre tableau de bord personnel) et repérez « Préparer la maquette ».",
        why: "Le minuteur est accroché à la tâche : c'est elle qui porte le temps de travail.",
        expect: "La tâche et son bouton minuteur sont visibles.",
        advanceOn: "navigate",
        navigateTo: "/espace-personnel/taches",
        hint: {
          text: "Le bouton minuteur (▶ « Chronométrer ») est sur chaque tâche.",
          docPath: "docs/FORMATION.md#missions-espace-personnel",
        },
      },
      {
        id: "personal-journee/start",
        order: 2,
        title: "Démarrer le minuteur",
        body: "Lancez le minuteur de « Préparer la maquette ».",
        why: "Le minuteur évite les saisies reconstituées : le temps est capturé au fil de l'eau.",
        expect: "Le minuteur défile sur la tâche (affichage du temps écoulé).",
        advanceOn: "action",
        target: "timer-start-button",
        hint: { text: "Le bouton « Chronométrer » (▶) de la tâche. Le minuteur s'affiche ensuite avec les commandes pause/arrêt." },
      },
      {
        id: "personal-journee/stop",
        order: 3,
        title: "Arrêter et clôturer",
        body: "Arrêtez le minuteur (bouton ■ « Terminer et enregistrer ») : la saisie de temps est alors enregistrée.",
        why: "L'arrêt clôture la session et crée la saisie réelle : c'est cette saisie que le coach vérifie.",
        expect: "Une saisie de temps apparaît pour la tâche.",
        advanceOn: "manual",
        hint: { text: "Le bouton d'arrêt (■) est à côté de l'affichage du minuteur." },
      },
      {
        id: "personal-journee/verify",
        order: 4,
        title: "Contrôler la saisie",
        body: "Le coach vérifie qu'une saisie de temps existe pour « Préparer la maquette ».",
        why: "Le temps enregistré dans les données est la seule valeur qui compte pour le suivi d'activité.",
        expect: "La saisie de temps est détectée.",
        advanceOn: "verify",
        criterionId: "temps-saisi",
        hint: { text: "Consultez « Mon temps » pour voir la ligne apparaître." },
      },
    ],
    checklist: [
      "Démarrer le minuteur sur la bonne tâche",
      "L'arrêter dès que le travail s'interrompt",
      "Contrôler sa saisie dans « Mon temps »",
    ],
    toConfirm: [
      "Politique de correction des saisies de temps : non codée — à faire confirmer par votre responsable.",
    ],
    realModuleHref: "/espace-personnel/temps",
    criteria: [
      {
        id: "temps-saisi",
        label: "Une saisie de temps a été enregistrée sur la tâche « Préparer la maquette »",
        resultLabel: "Temps enregistré sur « Préparer la maquette »",
        model: "timeEntry",
        where: {
          userId: "{{userId}}",
          task: { title: "Préparer la maquette" },
          createdAt: { gte: "{{now}}" },
        },
        minCount: 1,
      },
    ],
    evaluation: {
      title: "Évaluation finale — suivre mon temps sans assistance",
      instructions:
        "Reproduisez le geste : démarrez le minuteur sur « Préparer la maquette », laissez-le tourner un instant, puis arrêtez-le pour enregistrer la saisie.",
      criteria: [
        {
          id: "eval-temps-saisi",
          label: "Une nouvelle saisie de temps existe sur « Préparer la maquette »",
          resultLabel: "Temps enregistré",
          model: "timeEntry",
          where: {
            userId: "{{userId}}",
            task: { title: "Préparer la maquette" },
            createdAt: { gte: "{{now}}" },
          },
          minCount: 1,
        },
      ],
    },
  },
];

/* ==========================================================================
   COMEXA SPACE — contenus du site, membres.
   ========================================================================== */

const COMEXA_MISSIONS: TrainingMission[] = [
  {
    id: "comexa-contenu-publier",
    module: "Contenu",
    space: "comexa",
    level: 2,
    kind: "operations",
    title: "Mettre à jour une offre publiée",
    goal: "Modifier la fiche d'un service affiché sur le site public et vérifier sa publication.",
    situation:
      "L'offre « Création de site web » doit refléter la nouvelle formulation commerciale. Sa description doit devenir « Offre mise à jour — création de sites vitrines et e-commerce ».",
    roles: ["Responsable communication"],
    permissions: ["service:read:any", "service:write:any"],
    actions: [
      "Ouvrir le service « Création de site web »",
      "Mettre à jour sa description",
      "Vérifier que la modification est enregistrée",
    ],
    checksBefore: [
      "Le service sélectionné est bien « Création de site web » (pas un autre)",
      "La nouvelle description est relue : c'est du contenu public",
    ],
    pitfalls: [
      {
        mistake: "Modifier le mauvais service dans la liste",
        consequence: "L'offre publiée ne correspond plus à la réalité : les visiteurs voient la mauvaise information.",
      },
      {
        mistake: "Croire que l'enregistrement met à jour le site instantanément sans vérifier",
        consequence: "Sans contrôle, une erreur de saisie reste en ligne : toujours revoir la fiche après enregistrement.",
      },
    ],
    doneWhen: [
      "La description de « Création de site web » contient « Offre mise à jour »",
    ],
    escalation:
      "Toute modification tarifaire engageante doit être validée par la direction : aucun montant de validation n'est codé (point à faire confirmer).",
    steps: [
      {
        id: "comexa-contenu-publier/open",
        order: 1,
        title: "Ouvrir les contenus",
        body: "Rendez-vous dans « Contenu » de Comexa Space, onglet « Services ».",
        why: "Comexa Space est le cockpit de l'organisation : c'est là que le site public est administré.",
        expect: "La liste des services publics s'affiche.",
        advanceOn: "navigate",
        navigateTo: "/espace-comexa/contenu",
        hint: {
          text: "Onglet « Services » en haut de la page Contenu.",
          docPath: "docs/FORMATION.md#missions-comexa-space",
        },
      },
      {
        id: "comexa-contenu-publier/edit",
        order: 2,
        title: "Modifier l'offre",
        body: "Cliquez sur « Modifier » pour le service « Création de site web », puis changez sa description en « Offre mise à jour — création de sites vitrines et e-commerce ».",
        why: "La fiche service est ce que voient les visiteurs du site : la formulation commerciale doit y être exacte.",
        expect: "Le formulaire d'édition du service est ouvert et modifié.",
        advanceOn: "action",
        target: "service-edit-button",
        hint: { text: "Chaque service de la liste porte un bouton « Modifier »." },
      },
      {
        id: "comexa-contenu-publier/save",
        order: 3,
        title: "Enregistrer",
        body: "Enregistrez le formulaire.",
        why: "L'enregistrement valide la nouvelle version : elle remplace l'ancienne sur le site.",
        expect: "Le formulaire est enregistré.",
        advanceOn: "action",
        target: "service-form-submit",
        hint: { text: "Le bouton « Enregistrer » est en bas du formulaire." },
      },
      {
        id: "comexa-contenu-publier/verify",
        order: 4,
        title: "Contrôler la publication",
        body: "Le coach vérifie que la description contient « Offre mise à jour ».",
        why: "Vérifier l'état réel après publication : c'est la seule façon de s'assurer que la mise à jour a bien eu lieu.",
        expect: "La nouvelle description est détectée dans les données d'exercice.",
        advanceOn: "verify",
        criterionId: "offre-maj",
        hint: { text: "La liste des services affiche la nouvelle description." },
      },
    ],
    checklist: [
      "Relire le contenu public avant enregistrement",
      "Modifier le bon élément (titre exact vérifié)",
      "Contrôler la fiche après enregistrement",
    ],
    toConfirm: [
      "Validation éditoriale avant publication : aucune règle n'est codée — à faire confirmer par votre responsable communication.",
    ],
    realModuleHref: "/espace-comexa/contenu",
    criteria: [
      {
        id: "offre-maj",
        label: "La description du service « Création de site web » contient « Offre mise à jour »",
        resultLabel: "Offre « Création de site web » mise à jour",
        model: "service",
        where: {
          slug: "creation-site-web",
          description: { contains: "Offre mise à jour" },
        },
        minCount: 1,
      },
    ],
    evaluation: {
      title: "Évaluation finale — mettre à jour un contenu sans assistance",
      instructions:
        "Mettez à jour le service « Maintenance et évolution » : sa description doit contenir « Offre relue ».",
      criteria: [
        {
          id: "eval-offre-maj",
          label: "La description du service « Maintenance et évolution » contient « Offre relue »",
          resultLabel: "Offre « Maintenance et évolution » mise à jour",
          model: "service",
          where: {
            slug: "maintenance-et-evolution",
            description: { contains: "Offre relue" },
          },
          minCount: 1,
        },
      ],
    },
  },
  {
    id: "comexa-membre-inviter",
    module: "Membres",
    space: "comexa",
    level: 3,
    kind: "scenario",
    title: "Créer un compte membre avec le bon rôle",
    goal: "Ouvrir un accès à un nouveau membre en choisissant un rôle du catalogue — le rôle détermine réellement ses droits.",
    situation:
      "Un intégrateur rejoint l'agence : créez le compte « dev.formation@formation.example » (Prénom « Dev », Nom « Formation ») avec le rôle « Développeur ».",
    roles: ["Administrateur"],
    permissions: ["user:manage:any", "role:read:any"],
    actions: [
      "Ouvrir le formulaire de création de membre",
      "Renseigner l'identité et l'e-mail professionnel",
      "Attribuer le rôle « Développeur » et créer le compte",
    ],
    checksBefore: [
      "L'e-mail est exact : c'est l'identifiant de connexion du membre",
      "Le rôle coché correspond au poste réel (ici « Développeur »)",
    ],
    pitfalls: [
      {
        mistake: "Attribuer un rôle « pour être large »",
        consequence: "Les droits sont réels et le serveur les applique : un rôle inapproprié ouvre des accès inutiles.",
      },
      {
        mistake: "Saisir un e-mail erroné",
        consequence: "Le membre ne recevra pas ses identifiants (l'e-mail est la clé du compte).",
      },
    ],
    doneWhen: [
      "Le compte « dev.formation@formation.example » existe avec le rôle « Développeur »",
    ],
    escalation:
      "L'attribution des rôles sensibles (Administrateur) doit être validée par la direction : la procédure exacte n'est pas codée (point à faire confirmer).",
    steps: [
      {
        id: "comexa-membre-inviter/open",
        order: 1,
        title: "Ouvrir les membres",
        body: "Rendez-vous dans « Membres » de Comexa Space.",
        why: "La gestion des comptes vit dans Comexa Space : c'est le seul endroit pour ouvrir des accès.",
        expect: "La liste des membres de l'organisation s'affiche.",
        advanceOn: "navigate",
        navigateTo: "/espace-comexa/membres",
        hint: { text: "Menu « Membres ».", docPath: "docs/FORMATION.md#missions-comexa-space" },
      },
      {
        id: "comexa-membre-inviter/create",
        order: 2,
        title: "Créer le compte",
        body: "Cliquez sur le bouton de création, puis renseignez Prénom « Dev », Nom « Formation », E-mail « dev.formation@formation.example ». Cochez le rôle « Développeur » et validez.",
        why: "Le rôle coché ici donne des permissions RÉELLES au compte : c'est l'acte d'ouverture d'accès.",
        expect: "Le formulaire est rempli et le compte créé.",
        advanceOn: "action",
        target: "membre-invite-button",
        hint: {
          text: "Les rôles sont des cases à cocher dans le formulaire ; « Développeur » fait partie de la liste.",
        },
      },
      {
        id: "comexa-membre-inviter/verify",
        order: 3,
        title: "Contrôler le compte et son rôle",
        body: "Le coach vérifie : le compte existe avec l'e-mail exact ET le rôle « Développeur ».",
        why: "Un compte sans le bon rôle n'a pas les droits attendus : la vérification porte sur les deux.",
        expect: "Le compte et son rôle sont détectés dans les données d'exercice.",
        advanceOn: "verify",
        criterionId: "membre-cree",
        hint: { text: "La liste des membres affiche le nouveau compte." },
      },
    ],
    checklist: [
      "Vérifier l'e-mail caractère par caractère (clé du compte)",
      "Choisir le rôle le plus restrictif qui couvre le poste",
      "Contrôler le compte créé, rôle compris",
    ],
    toConfirm: [
      "Procédure d'habilitation pour les rôles sensibles : non codée — à faire confirmer par la direction.",
    ],
    realModuleHref: "/espace-comexa/membres",
    criteria: [
      {
        id: "membre-cree",
        label: "Le compte « dev.formation@formation.example » existe avec le rôle « Développeur »",
        resultLabel: "Compte « dev.formation@formation.example » créé (rôle Développeur)",
        model: "user",
        where: {
          email: "dev.formation@formation.example",
          roles: { some: { role: { code: "DEVELOPER" } } },
        },
        minCount: 1,
      },
    ],
    evaluation: {
      title: "Évaluation finale — créer un compte membre sans assistance",
      instructions:
        "Créez le compte « analyste.formation@formation.example » (Prénom « Analyste », Nom « Formation ») avec le rôle « Analyste ».",
      criteria: [
        {
          id: "eval-membre-cree",
          label: "Le compte « analyste.formation@formation.example » existe avec le rôle « Analyste »",
          resultLabel: "Compte analyste créé (rôle Analyste)",
          model: "user",
          where: {
            email: "analyste.formation@formation.example",
            roles: { some: { role: { code: "ANALYST" } } },
          },
          minCount: 1,
        },
      ],
    },
  },
];

/* ==========================================================================
   ESPACE CLIENT.
   ========================================================================== */

const CLIENT_MISSIONS: TrainingMission[] = [
  {
    id: "client-devis-accepter",
    module: "Mes devis",
    space: "client",
    level: 2,
    kind: "operations",
    title: "Examiner un devis et prendre une décision",
    goal: "Lire un devis en détail (prestations, montants, validité) et l'accepter en connaissance de cause.",
    situation:
      "Le devis « Site vitrine » vous attend dans votre espace client. Lisez-le attentivement : prestations, montant TTC, date de validité — puis acceptez-le.",
    roles: ["Client"],
    permissions: ["quote:read:own", "quote:accept:own"],
    actions: [
      "Ouvrir le devis « Site vitrine »",
      "Contrôler prestations, montants et validité",
      "Accepter le devis avec la confirmation prévue par l'outil",
    ],
    checksBefore: [
      "Les prestations listées correspondent à votre demande",
      "Le montant TTC est celui discuté avec l'agence",
      "La date de validité est encore valable",
    ],
    pitfalls: [
      {
        mistake: "Accepter sans lire les lignes du devis",
        consequence: "L'acceptation engage la commande des prestations telles qu'elles sont écrites : vérifiez-les.",
      },
      {
        mistake: "Confondre « fermer la page » et « refuser »",
        consequence: "Le devis reste en attente : si vous ne le souhaitez pas, il faut refuser explicitement.",
      },
    ],
    doneWhen: [
      "Le devis « Site vitrine » est accepté",
    ],
    escalation:
      "Un point du devis vous semble erroné ? N'acceptez pas : demandez une modification ou contactez l'agence via la messagerie.",
    steps: [
      {
        id: "client-devis-accepter/open",
        order: 1,
        title: "Ouvrir mon espace",
        body: "Rendez-vous sur « Mon espace » : les devis en attente de votre décision y sont mis en avant.",
        why: "L'espace client regroupe vos décisions en attente : c'est votre point d'entrée quotidien.",
        expect: "La section « Devis en attente de votre décision » affiche « Site vitrine ».",
        advanceOn: "navigate",
        navigateTo: "/espace-client",
        hint: {
          text: "Menu de gauche : « Mon espace ».",
          docPath: "docs/FORMATION.md#missions-espace-client",
        },
      },
      {
        id: "client-devis-accepter/examine",
        order: 2,
        title: "Lire le devis",
        body: "Ouvrez le devis « Site vitrine » depuis la liste et parcourez ses lignes (prestations, prix, TVA, total).",
        why: "C'est le contenu du devis qui fait foi en cas de litige : la lecture détaillée est votre protection.",
        expect: "Le détail du devis s'affiche.",
        advanceOn: "action",
        target: "client-devis-list",
        hint: { text: "Cliquez sur la ligne du devis pour ouvrir sa fiche complète." },
      },
      {
        id: "client-devis-accepter/accept",
        order: 3,
        title: "Accepter le devis",
        body: "Cliquez sur « Accepter le devis », lisez la confirmation (elle engage la commande), puis confirmez.",
        why: "La confirmation explicite protège des acceptations accidentelles : elle rappelle ce que vous engagez.",
        expect: "Le devis passe au statut accepté.",
        advanceOn: "action",
        target: "devis-accept-button",
        hint: { text: "« Accepter le devis », puis « Confirmer l'acceptation »." },
      },
      {
        id: "client-devis-accepter/verify",
        order: 4,
        title: "Contrôler la décision",
        body: "Le coach vérifie que le devis « Site vitrine » est bien accepté dans les données.",
        why: "Votre décision est enregistrée : le contrôle final vous assure qu'elle a bien été prise en compte.",
        expect: "Le devis accepté est détecté.",
        advanceOn: "verify",
        criterionId: "devis-accepte",
        hint: { text: "La fiche du devis affiche la mention « Vous avez accepté ce devis »." },
      },
    ],
    checklist: [
      "Lire toutes les lignes avant toute décision",
      "Vérifier le montant TTC et la validité",
      "Décider explicitement : accepter OU refuser (pas de demi-mesure)",
    ],
    toConfirm: [
      "Délai de rétractation après acceptation : non codé dans l'outil — à faire confirmer auprès de l'agence.",
    ],
    realModuleHref: "/espace-client",
    criteria: [
      {
        id: "devis-accepte",
        label: "Le devis « Site vitrine » est accepté",
        resultLabel: "Devis « Site vitrine » accepté",
        model: "quote",
        where: {
          client: { users: { some: { id: "{{userId}}" } } },
          subject: "Site vitrine",
          status: "ACCEPTED",
        },
        minCount: 1,
      },
    ],
    evaluation: {
      title: "Évaluation finale — décider d'un devis sans assistance",
      instructions:
        "Le devis « Évolution catalogue » vous attend également : examinez-le et acceptez-le.",
      criteria: [
        {
          id: "eval-devis-accepte",
          label: "Le devis « Évolution catalogue » est accepté",
          resultLabel: "Devis « Évolution catalogue » accepté",
          model: "quote",
          where: {
            client: { users: { some: { id: "{{userId}}" } } },
            subject: "Évolution catalogue",
            status: "ACCEPTED",
          },
          minCount: 1,
        },
      ],
    },
  },
  {
    id: "client-modification-demander",
    module: "Demandes de modification",
    space: "client",
    level: 3,
    kind: "scenario",
    title: "Demander une modification sur mon projet",
    goal: "Formaliser une demande de modification sur votre projet avec le niveau de détail nécessaire à son étude.",
    situation:
      "Sur votre projet « Portail client », vous souhaitez ajouter une page « Tarifs ». Déposez une demande de modification explicite.",
    roles: ["Client"],
    permissions: ["modificationrequest:read:own", "modificationrequest:write:own", "project:read:own"],
    actions: [
      "Ouvrir « Demandes de modification »",
      "Déposer la demande « Ajouter une page tarifs » avec une description précise",
    ],
    checksBefore: [
      "Le projet sélectionné est bien « Portail client »",
      "La description est suffisamment précise pour être étudiée (au moins dix caractères)",
    ],
    pitfalls: [
      {
        mistake: "Décrire la demande en trois mots",
        consequence: "L'agence ne peut pas chiffrer : la demande revient vers vous pour précisions.",
      },
      {
        mistake: "Demander une modification par un autre canal que l'outil",
        consequence: "La demande n'est pas tracée : elle risque d'être perdue ou non chiffrée.",
      },
    ],
    doneWhen: [
      "La demande « Ajouter une page tarifs » existe sur le projet « Portail client »",
    ],
    escalation:
      "Toute demande chiffrée repasse par un devis : aucune approbation automatique n'est codée. Le suivi exact (délais de réponse) n'est pas codé non plus — à faire confirmer avec l'agence.",
    steps: [
      {
        id: "client-modification-demander/open",
        order: 1,
        title: "Ouvrir mes demandes",
        body: "Rendez-vous dans « Demandes de modification ».",
        why: "Ce module trace vos demandes et leur étude : c'est le canal officiel des évolutions.",
        expect: "La liste de vos demandes s'affiche (peut être vide).",
        advanceOn: "navigate",
        navigateTo: "/espace-client/modifications",
        hint: {
          text: "Menu de gauche : « Demandes de modification ».",
          docPath: "docs/FORMATION.md#missions-espace-client",
        },
      },
      {
        id: "client-modification-demander/create",
        order: 2,
        title: "Déposer la demande",
        body: "Cliquez sur « Nouvelle demande » : projet « Portail client », titre « Ajouter une page tarifs », description détaillant la page souhaitée, puis envoyez.",
        why: "Une demande tracée et détaillée peut être étudiée et chiffrée : c'est aussi votre preuve de la demande.",
        expect: "La demande est créée et apparaît dans la liste.",
        advanceOn: "action",
        target: "modification-create-button",
        hint: { text: "Le formulaire demande le projet, un titre (3 caractères min.) et une description (10 caractères min.)." },
      },
      {
        id: "client-modification-demander/verify",
        order: 3,
        title: "Contrôler la demande",
        body: "Le coach vérifie que la demande « Ajouter une page tarifs » existe sur « Portail client ».",
        why: "La demande enregistrée ouvre le traitement par l'agence : c'est l'état réel qui compte.",
        expect: "La demande est détectée dans les données d'exercice.",
        advanceOn: "verify",
        criterionId: "demande-cree",
        hint: { text: "Votre demande figure dans la liste avec son statut « Soumise »." },
      },
    ],
    checklist: [
      "Utiliser le canal officiel (Demandes de modification)",
      "Titre court + description détaillée",
      "Vérifier le projet concerné avant d'envoyer",
    ],
    toConfirm: [
      "Délais de réponse aux demandes : non codés — à faire confirmer avec l'agence.",
    ],
    realModuleHref: "/espace-client/modifications",
    criteria: [
      {
        id: "demande-cree",
        label: "La demande « Ajouter une page tarifs » existe sur le projet « Portail client »",
        resultLabel: "Demande « Ajouter une page tarifs » déposée",
        model: "modificationRequest",
        where: {
          project: { name: "Portail client" },
          title: "Ajouter une page tarifs",
          requestedById: "{{userId}}",
        },
        minCount: 1,
      },
    ],
    evaluation: {
      title: "Évaluation finale — demander une modification sans assistance",
      instructions:
        "Déposez une nouvelle demande sur « Portail client » : titre « Ajouter un formulaire de contact », avec une description explicite.",
      criteria: [
        {
          id: "eval-demande-cree",
          label: "La demande « Ajouter un formulaire de contact » existe sur « Portail client »",
          resultLabel: "Demande « Ajouter un formulaire de contact » déposée",
          model: "modificationRequest",
          where: {
            project: { name: "Portail client" },
            title: "Ajouter un formulaire de contact",
            requestedById: "{{userId}}",
          },
          minCount: 1,
        },
      ],
    },
  },
];

export const TRAINING_MISSIONS: TrainingMission[] = [
  ...TEAM_MSSIONS,
  ...PERSONAL_MISSIONS,
  ...COMEXA_MISSIONS,
  ...CLIENT_MISSIONS,
];

export function findMission(missionId: string): TrainingMission | null {
  return TRAINING_MISSIONS.find((mission) => mission.id === missionId) ?? null;
}

/** Alias conservé pour la lecture. */
export const getMission = findMission;

/**
 * Un membre ne voit que les missions compatibles avec ses permissions
 * EFFECTIVES (intersection complète : chaque permission de la mission doit lui
 * être accordée). Deux profils différents ne reçoivent donc pas les mêmes
 * missions, même sur le même espace.
 */
export function filterMissionsFor(
  missions: readonly TrainingMission[],
  space: TrainingSpace,
  permissions: ReadonlySet<string> | readonly string[],
): TrainingMission[] {
  const owned = permissions instanceof Set ? permissions : new Set(permissions);
  return missions
    .filter((mission) => mission.space === space)
    .filter((mission) => mission.permissions.every((permission) => owned.has(permission)));
}
