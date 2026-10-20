import { visibleNavigation } from './space-navigation.js';
import { PROCEDURES, CONTENT_PROCEDURES, ADDITIONAL_PROCEDURES } from './onboarding-curriculum.mjs';

export const TRAINING_VERSION = 2;
export const LEVEL_LABELS = { notions: 'Notions à connaître', courant: 'Opérations courantes', avance: 'Opérations avancées', sensible: 'Actions sensibles' };
const PREFIX = { personal: '/espace-personnel', team: '/espace-equipe', comexa: '/espace-comexa', client: '/espace-client' };
export const SPACE_OBJECTIVES = {
  personal: { title: 'Organiser sa journée et rendre compte du travail', objective: 'Retrouver ses tâches, organiser son agenda, enregistrer son temps et préparer son bilan personnel.', workflow: ['Consulter les priorités et les échéances.', 'Effectuer les tâches de son périmètre.', 'Vérifier les durées réellement travaillées.', 'Relire et enregistrer le bilan de la journée, si cet outil est accessible.'], example: 'Une journée de production : une correction à terminer, un rendez-vous et un bilan factuel en fin de journée.' },
  team: { title: 'Coordonner le travail et le suivi commercial', objective: 'Suivre les dossiers partagés selon son périmètre : commerce, projets, production et pilotage.', workflow: ['Repérer les dossiers et tâches qui nécessitent une intervention.', 'Ouvrir le contexte client ou projet avant une action.', 'Exécuter uniquement les procédures autorisées.', 'Vérifier le résultat et laisser une trace utile à l’équipe.'], example: 'Une demande qualifiée peut conduire à un devis, puis à une facture ; chacun intervient seulement sur les étapes auxquelles il a accès.' },
  comexa: { title: 'Administrer les contenus et les accès', objective: 'Maintenir l’organisation, ses contenus publics et ses accès sans confondre lecture et administration.', workflow: ['Identifier l’élément ou le compte concerné.', 'Contrôler ses accès et les conséquences de l’opération.', 'Relire les valeurs avant toute validation.', 'Vérifier le résultat et consulter les traces si autorisé.'], example: 'Une modification de rôle doit être ciblée ; elle ne doit pas accorder des droits d’administration par commodité.' },
  client: { title: 'Préparer et suivre sa relation avec COMEXA', objective: 'Exprimer son besoin, suivre ses demandes et consulter les documents de son propre dossier.', workflow: ['Consulter Mon espace pour le suivi disponible.', 'Lire l’offre ou le document avant de décider.', 'Formuler les ajustements et questions avec leur contexte.', 'Vérifier les références et réponses reçues.'], example: 'Choisir un pack, conserver sa référence, puis suivre le travail et consulter les réponses de l’agence.' },
};

// Lecture vérifiée des pages. Aucun bouton de création n’est déduit d’un droit d’API.
const READ = {
  'tableau-de-bord': ['Lire les priorités et les indicateurs', ['Lisez les cartes affichées et leur période ; les blocs absents peuvent dépendre de vos droits.', 'Comparez les montants dans la même devise. Ouvrez un élément accessible pour retrouver son contexte.', 'Avant d’agir, vérifiez la fiche : un chiffre de synthèse ne remplace pas le détail.'], 'Repérer une échéance proche et retrouver le travail concerné.', 'Une valeur vide ou une erreur de chargement ne vaut pas zéro.'],
  accueil: ['Retrouver le suivi de son dossier', ['Dans Mon espace, parcourez les blocs disponibles : devis à examiner, projets, commandes et demandes.', 'Ouvrez uniquement les fiches pour lesquelles vous disposez d’un accès ; les listes peuvent être vides avant une première commande.', 'Conservez la référence de l’élément avant de contacter COMEXA.'], 'Retrouver la référence d’une demande et son état actuel.', 'Un compte sans dossier activé peut ne pas encore disposer de documents.'],
  notifications: ['Traiter ses alertes sans perdre le contexte', ['Choisissez Toutes, Non lues ou une catégorie disponible.', 'Lisez l’alerte et ouvrez son lien si la ressource est accessible.', 'Retrouvez le dossier avant d’effectuer une opération : une notification n’accorde pas de droits supplémentaires.'], 'Identifier une notification de tâche puis lire le contexte du travail.', 'Une ancienne alerte peut viser un document supprimé ou devenu inaccessible.'],
  contacts: ['Lire et qualifier le besoin avant le pipeline', ['Filtrez les demandes par statut.', 'Lisez le message, les coordonnées et les éventuelles notes.', 'Vérifiez si la demande est déjà convertie avant de préparer son suivi.'], 'Distinguer une demande réelle d’un message sans besoin exploitable.', 'La lecture seule ne permet pas de changer le statut ou de convertir.'],
  prospects: ['Lire le pipeline et l’historique d’un prospect', ['Dans le pipeline, repérez la référence et l’étape du prospect.', 'Ouvrez sa fiche pour lire contact, coordonnées, source, budget et notes disponibles.', 'Consultez son historique avant de décider de la prochaine action.'], 'Retrouver la dernière transition d’une proposition déjà envoyée.', 'Une carte dans le pipeline n’est pas encore un dossier client.'],
  devis: ['Relire une proposition commerciale', ['Ouvrez le devis concerné depuis la liste ou le suivi du dossier.', 'Vérifiez destinataire, objet, dates, devise, prestations, quantités, prix, remise et total.', 'Relisez Notes et Conditions. Si disponible, utilisez Aperçu ou Télécharger pour contrôler le PDF.'], 'Comparer les deux prestations d’un devis avec le besoin convenu.', 'Brouillon, Envoyé et Accepté correspondent à des étapes différentes. Un téléchargement ne transmet pas une décision.'],
  factures: ['Contrôler facture, encaissements et reste dû', ['Dans la liste, utilisez le filtre de statut et la devise quand ils sont proposés.', 'Ouvrez la fiche ou le document disponible. Comparez total TTC, montant payé et reste à payer.', 'Consultez les encaissements déjà affichés avant de conclure à un impayé. Le PDF peut être prévisualisé ou téléchargé avec les droits de lecture.'], 'Une facture de 1 000 dont 400 sont réglés garde un solde de 600.', 'Facturé ne signifie pas encaissé. Les monnaies ne s’additionnent pas entre elles.'],
  commandes: ['Lire la commande et son projet associé', ['Filtrez la liste par statut et ouvrez la commande voulue.', 'Relisez le récapitulatif : pack, montant enregistré, devise, paiement et date.', 'Consultez le client ou le projet associé seulement si le lien vous est autorisé.'], 'Retrouver le pack commandé et vérifier si un projet lui est déjà associé.', 'Limite constatée : les boutons de confirmation/refus de la liste appellent PATCH /orders/:id/status, absent du contrôleur actuel. La validation opérationnelle n’est donc pas enseignée comme fiable.'],
  demandes: ['Lire une demande de projet sur mesure', ['Choisissez un statut de filtre ou Toutes.', 'Lisez la référence, le client, le besoin et les informations de la demande.', 'Distinguez la demande d’étude du projet de production et de la commande de pack.'], 'Identifier la question à éclaircir avant d’établir une proposition.', 'Changer un statut ne prouve pas qu’un projet a été créé.'],
  clients: ['Retrouver un client sans créer de doublon', ['Recherchez la société ou utilisez le filtre de statut.', 'Ouvrez sa fiche et contrôlez la référence, les coordonnées et l’historique proposé.', 'Consultez les dossiers liés que vos droits permettent d’ouvrir.'], 'Deux sociétés au nom proche se distinguent par leur référence et leurs contacts.', 'La page auditée n’expose pas de formulaire général de création/modification de client : aucune telle procédure n’est inventée ici.'],
  projets: ['Lire l’état d’un projet et ses échéances', ['Filtrez les projets par statut, puis ouvrez le bon projet.', 'Vérifiez référence, client, état, avancement et échéances affichés.', 'Consultez les blocs autorisés : tâches, jalons, documents. Leur absence peut refléter vos droits.'], 'Préparer le point sur un projet dont l’échéance approche.', 'La liste ne comporte pas de création directe de projet. Une procédure de création manuelle n’est pas exposée par cet écran.'],
  taches: ['Retrouver le travail de son périmètre', ['En personnel, utilisez les vues de tâches, les filtres de nature et les objectifs disponibles ; en équipe, commencez par choisir le projet.', 'Lisez titre, échéance, statut et responsable avant de travailler.', 'Une tâche assignée, une tâche privée et une tâche créée par vous ne désignent pas nécessairement la même chose.'], 'Retrouver la tâche à échéance aujourd’hui sans la confondre avec celle d’un autre projet.', 'Être créateur ne donne pas automatiquement tous les droits ; le backend contrôle le périmètre.'],
  calendrier: ['Consulter l’agenda et ses différentes sources', ['Naviguez avec les flèches de période et choisissez une vue disponible.', 'Lisez les événements, tâches et échéances visibles dans cette période.', 'Utilisez Préférences du calendrier pour régler vue, horaires et couleurs des couches affichées.'], 'Retrouver le prochain rendez-vous et distinguer son heure d’une date limite de tâche.', 'Une échéance calculée depuis une tâche n’est pas un événement autonome à déplacer librement.'],
  temps: ['Relire sa feuille de temps et ses totaux', ['Choisissez une période affichée ; utilisez Dates précises si nécessaire et validez les bornes.', 'Lisez les totaux de cette même période, puis les lignes et leurs rattachements.', 'Utilisez le filtre de facturation et l’export CSV proposés pour contrôler le relevé.'], 'Vérifier une semaine avant de la communiquer.', 'Un filtre change le périmètre des totaux. L’écriture manuelle est proposée dans l’espace personnel, pas dans Suivi du temps de l’équipe.'],
  'rapports-journaliers': ['Consulter les bilans du jour', ['En personnel, choisissez une journée pour lire son rapport et son résumé.', 'En équipe, parcourez les rapports accessibles des derniers jours et identifiez leur auteur et leur date.', 'Distinguez ce qui est réalisé, ce qui est bloqué et ce qui reste à faire.'], 'Préparer un point en lisant le bilan de la veille plutôt que demander un résumé déjà écrit.', 'Le rapport journalier est distinct de la feuille de temps ; il ne crée pas automatiquement des durées.'],
  messagerie: ['Lire une conversation dans son contexte', ['Choisissez une conversation dans la liste ou recherchez-la.', 'Relisez les messages récents et consultez les messages plus anciens si nécessaire.', 'Vérifiez les participants et le projet avant de préparer une réponse.'], 'Retrouver un échange existant plutôt que créer un doublon.', 'La lecture d’une conversation ne donne pas accès à toutes ses ressources liées.'],
  modifications: ['Suivre les ajustements demandés', ['Filtrez les demandes si le filtre est proposé.', 'Lisez titre, description, priorité, statut et projet concerné.', 'Consultez la note de décision et l’éventuel supplément avec sa devise.'], 'Distinguer une demande en attente d’un ajustement accepté.', 'Une demande, une décision, une estimation et un encaissement sont quatre informations différentes.'],
  analytique: ['Interpréter les analyses sur 30 jours', ['Lisez la période affichée et les panneaux disponibles : temps, tâches et projets.', 'Contrôlez les messages de permissions manquantes ; les heures, tâches et noms nécessitent leurs propres accès.', 'Comparez les éléments dans le même périmètre avant de tirer une conclusion.'], 'Repérer un projet qui concentre les heures, puis vérifier son contexte.', 'Le droit de rapport seul ne donne pas nécessairement tous les détails de temps, de tâches ou de projets.'],
  repartition: ['Comprendre les relevés accessibles', ['Ouvrez un onglet autorisé. Soldes décrit parts, versements, avances et ajustements ; Règles et Calculs peuvent être absents.', 'Contrôlez le membre, la devise et les filtres avant de lire le solde.', 'Consultez les écritures et leurs motifs pour expliquer un montant.'], 'Lire son propre relevé sans additionner une part en euros et une avance en dinars.', 'Un solde n’est pas le budget du projet ni nécessairement un versement déjà réalisé.'],
  rapports: ['Retrouver un rapport et lire son résultat', ['Sélectionnez un rapport dans Rapports générés.', 'Lisez le résultat dans le panneau de détail.', 'Vérifiez type, période et périmètre avant toute comparaison.'], 'Retrouver un rapport existant pour une réunion de suivi.', 'Consulter n’autorise pas forcément la génération d’un nouveau rapport.'],
  contenu: ['Comprendre les contenus du site', ['Choisissez l’un des onglets que vos droits rendent disponibles.', 'Identifiez l’élément, son état visible/publié et ses champs.', 'Suivez le chapitre propre à cet onglet avant toute modification.'], 'Relire une FAQ existante avant d’ajouter une question proche.', 'Limite constatée : les études de cas existent dans l’API et dans la permission d’entrée, mais aucun onglet de cette page ne les expose. Leur édition n’est pas enseignée.'],
  membres: ['Lire les comptes et leurs accès', ['Recherchez par nom ou e-mail et utilisez les filtres Statut et Rôle.', 'Contrôlez l’identité, l’état du compte et les rôles affichés.', 'Avant de demander une modification, identifiez le périmètre nécessaire au travail réel.'], 'Différencier deux homonymes par l’adresse professionnelle.', 'Ne confondez pas suspension, suppression et changement de rôle.'],
  roles: ['Comprendre les périmètres des permissions', ['Choisissez un rôle dans la liste.', 'Lisez ses permissions par ressource : read, write et delete ne donnent pas les mêmes possibilités.', 'Distinguez own (ses données), assigned (affecté) et any (périmètre large).'], 'Un droit de lecture des factures n’accorde pas celui d’enregistrer un encaissement.', 'Le rôle Administrateur est verrouillé ; les droits sont appliqués au backend et non seulement aux menus.'],
  integrations: ['Inventorier les accès des intégrations', ['Parcourez Jetons existants si ce bloc vous est accessible.', 'Vérifiez nom technique, droits, expiration et état.', 'Identifiez les intégrations encore utilisées avant de demander une modification.'], 'Repérer un ancien jeton qui ne devrait plus être utilisé.', 'Un secret révélé ne doit pas être transmis dans une conversation. Sans le catalogue de permissions, certaines actions de gestion sont indisponibles.'],
  journal: ['Retrouver une opération dans l’audit', ['Parcourez le journal et ses filtres de recherche disponibles.', 'Relisez date, auteur, type d’entité et action.', 'Dans le tableau, rapprochez Date, Auteur, Action, Objet et Adresse ; aucune annulation n’est proposée ici.'], 'Retrouver la modification d’un rôle à une date donnée.', 'Le journal est une trace, pas un bouton permettant d’annuler une opération.'],
  parametres: ['Identifier le bon réglage et son périmètre', ['Choisissez une catégorie de paramètres.', 'Lisez la description des champs et les messages d’accès avant de modifier.', 'Distinguez identité interne, données financières et préférences personnelles ; utilisez la procédure correspondant à votre droit.'], 'Vérifier qu’un choix de devise d’affichage ne convertit pas les documents.', 'Le fait de pouvoir saisir une clé JSON ne prouve pas qu’elle est consommée par une fonctionnalité.'],
  commander: ['Comprendre offre, commande et demande d’étude', ['Choisissez un pack pour afficher l’offre calculée pour votre compte.', 'Lisez prix, devise et modalités disponibles.', 'Si la commande n’est pas disponible, utilisez le parcours de demande proposé plutôt qu’inventer un tarif.'], 'Exprimer un besoin sur mesure lorsqu’aucun tarif applicable n’est disponible.', 'Le serveur reste la source du tarif. Le parcours de commande des collaborateurs n’est pas proposé dans leur formation.'],
  compte: ['Sécuriser son accès et comprendre son profil', ['Ouvrez Mon compte depuis le menu du compte.', 'Relisez identité, rôles et sessions ouvertes.', 'Distinguez les préférences locales d’affichage des données métier.'], 'Identifier un appareil encore connecté avant de décider de le déconnecter.', 'Le profil affiché n’est pas un formulaire permettant de s’accorder des rôles.'],
};

const KNOWLEDGE_CHECKS = {
  'devis:create': { question: 'La création d’un devis brouillon l’envoie-t-elle au client ?', options: ['Oui, dès sa création.', 'Non : il faut relire puis utiliser l’action d’envoi autorisée.'], answer: 1, explanation: 'Créer et envoyer sont deux actions distinctes. Le devis envoyé n’est plus un brouillon réécrivable.' },
  'devis:invoice': { question: 'À partir de quel devis cette fiche permet-elle de créer la facture ?', options: ['Un devis accepté.', 'Tout devis, même refusé ou encore brouillon.'], answer: 0, explanation: 'Le bouton de création de facture est lié au statut Accepté et au droit d’écriture des factures.' },
  'devis:accept': { question: 'Vous refusez une proposition. Que devez-vous fournir ?', options: ['Une nouvelle saisie de temps.', 'Un motif d’au moins trois caractères, puis vérifier le statut retourné.'], answer: 1, explanation: 'Le refus est motivé ; l’acceptation demande une confirmation après relecture des prestations et du montant.' },
  'factures:payment': { question: 'Une facture de 1 000 a déjà 400 encaissés. Un nouveau versement réel de 200 est enregistré. Quel reste dû vérifier ?', options: ['800 dans n’importe quelle devise.', '400 dans la devise de la facture.'], answer: 1, explanation: 'Le reste dû est 1 000 − 400 − 200 = 400. La promesse d’un paiement n’est pas un encaissement.' },
  'factures:delete': { question: 'Supprimer une facture rembourse-t-il automatiquement son paiement ?', options: ['Oui, le paiement disparaît avec la facture.', 'Non : les encaissements et traces financières restent conservés.'], answer: 1, explanation: 'La suppression retire la pièce active. Ce n’est ni un remboursement ni une annulation de répartition.' },
  'devis:delete': { question: 'La suppression d’un devis supprime-t-elle automatiquement son projet et sa facture ?', options: ['Non : les relations et documents liés restent conservés.', 'Oui, toutes les données du dossier sont effacées.'], answer: 0, explanation: 'Chaque ressource suit son propre cycle ; supprimer un devis ne supprime pas les autres pièces.' },
  'temps:entry': { question: 'Votre minuteur a déjà enregistré 45 minutes. Faut-il aussi créer une saisie manuelle de 45 minutes pour ce travail ?', options: ['Oui, pour confirmer le minuteur.', 'Non, cela doublerait les heures.'], answer: 1, explanation: 'Relisez la saisie existante et corrigez-la si nécessaire au lieu de créer un doublon.' },
  'temps:timer': { question: 'Que produit Abandonner sur une session chronométrée ?', options: ['Une saisie du temps écoulé.', 'Après confirmation, la durée de cette session n’est pas enregistrée.'], answer: 1, explanation: 'Terminer et enregistrer est différent d’abandonner. Contrôlez ensuite la feuille de temps.' },
  'roles:permissions': { question: 'À qui s’applique une modification des permissions d’un rôle ?', options: ['À tous les comptes portant ce rôle.', 'Uniquement au compte actuellement connecté.'], answer: 0, explanation: 'Le rôle est partagé : sa modification doit être relue en tenant compte de tous ses utilisateurs.' },
  'integrations:token': { question: 'Où conserver le secret d’un jeton révélé à sa création ?', options: ['Dans le gestionnaire de secrets de l’intégration, avec des droits limités.', 'Dans une conversation d’équipe pour que chacun le retrouve.'], answer: 0, explanation: 'Le secret n’est montré qu’une fois et ne doit pas être diffusé. Une durée limitée réduit le risque.' },
  'rapports-journaliers:autofill': { question: 'Auto-remplir ma journée suffit-il à enregistrer le rapport ?', options: ['Oui, sans relecture.', 'Non : il faut relire, compléter et enregistrer.'], answer: 1, explanation: 'Le pré-remplissage prépare un contenu ; il ne valide pas le compte rendu à votre place.' },
  'modifications:decide': { question: 'Le motif d’une décision sur une modification est-il visible du client ?', options: ['Oui : il faut rédiger une réponse compréhensible et appropriée.', 'Non : c’est une note interne à l’équipe.'], answer: 0, explanation: 'La décision explique le traitement de la demande au client ; elle diffère d’une note interne de demande de projet.' },
};

function checkpoint(result) {
  return { question: 'Quel résultat faut-il vérifier avant de considérer cette étape comme acquise ?', options: [result, 'Le clic sur un bouton suffit, même si une erreur est affichée.'], answer: 0, explanation: 'Vérifiez le résultat et le message du serveur. La formation n’exécute aucune action métier à votre place.' };
}
export function permits(lesson, permissions, area) {
  const rights = permissions instanceof Set ? permissions : new Set(permissions ?? []);
  return (!lesson.areas || lesson.areas.includes(area))
    && (lesson.all ?? []).every((code) => rights.has(code))
    && (!lesson.any || lesson.any.some((code) => rights.has(code)))
    && (lesson.requiresAny ?? []).every((group) => group.some((code) => rights.has(code)));
}
function readChapter(item, area) {
  const section = item.section ?? item.href.split('/').filter(Boolean)[1] ?? 'accueil';
  const content = READ[section];
  if (!content) return null; // Jamais de procédure inventée pour une route non auditée.
  const result = `Je peux retrouver ${item.label.toLowerCase()} et expliquer les informations consultées dans mon périmètre.`;
  return { id: `${area}:${section}:read`, module: section, moduleLabel: item.label, title: content[0], level: 'notions', href: item.href, steps: content[1], example: content[2], pitfalls: content[3], result, quiz: checkpoint(result) };
}
export function buildOnboarding(groups, can = () => false) {
  // Compatibilité des anciens consommateurs : la formation structurée utilise buildTrainingCourses.
  return groups.flatMap((group) => group.items ?? []).map((item) => {
    const chapter = readChapter(item, 'team');
    return { ...item, instructions: chapter?.steps.join(' ') ?? 'Cette rubrique ne dispose pas encore de procédure auditée.', example: chapter?.example ?? 'Aucune mise en situation confirmée.', action: can('quote:write:any') && item.href.endsWith('/devis') ? 'La création est détaillée dans le chapitre Préparer un devis complet.' : 'Consultez uniquement les informations et opérations autorisées de votre périmètre.' };
  });
}

function clientNavigation(permissions) {
  const rights = new Set(permissions);
  const entries = [
    ['accueil', 'Mon espace', '', []], ['tableau-de-bord', 'Tableau de bord', '/tableau-de-bord', ['dashboard:read:own']],
    ['devis', 'Mes devis', '', ['quote:read:own']], ['projets', 'Mes projets', '', ['project:read:own']],
    ['factures', 'Mes factures', '/factures', ['invoice:read:own']], ['commander', 'Commander un pack', '/commander', []],
    ['modifications', 'Demandes de modification', '/modifications', ['modificationrequest:read:own', 'modificationrequest:write:own']],
    ['messagerie', 'Messagerie', '/messagerie', ['conversation:read:own']], ['notifications', 'Notifications', '/notifications', ['notification:read:own']],
  ];
  return [{ items: entries.filter(([, , , any]) => !any.length || any.some((code) => rights.has(code))).map(([section, label, suffix]) => ({ section, label, href: `/espace-client${suffix}` })) }];
}
export function buildTrainingCourses(access) {
  return (access ?? []).filter((space) => PREFIX[space.id]).map((space) => {
    const area = space.id;
    const permissions = new Set(space.permissions ?? []);
    const groups = area === 'client' ? clientNavigation(permissions) : visibleNavigation(area, permissions);
    const items = groups.flatMap((group) => group.items);
    if (area === 'client' || permissions.has('user:read:own')) items.push({ section: 'compte', label: 'Mon compte', href: `${PREFIX[area]}/compte` });
    const objective = SPACE_OBJECTIVES[area];
    const home = area === 'client' ? '/espace-client' : items.find((item) => item.href.endsWith('/tableau-de-bord'))?.href ?? items[0]?.href ?? null;
    const introResult = 'Je sais distinguer cet espace des autres et identifier uniquement les tâches qui m’y sont autorisées.';
    const chapters = [{ id: `${area}:introduction:v2`, module: 'introduction', moduleLabel: 'Découvrir cet espace', title: objective.title, level: 'notions', href: home, steps: objective.workflow, objective: objective.objective, example: objective.example, pitfalls: !home ? 'Votre compte ouvre cet espace, mais aucun module consultable n’est confirmé avec vos droits actuels. Demandez un accès en lecture adapté avant de suivre une procédure métier.' : 'Les chapitres se fondent sur les permissions effectives renvoyées par le serveur, pas sur le seul nom de votre rôle. Aucun exercice ne crée de données de démonstration.', result: introResult, quiz: checkpoint(introResult) }];
    const shellResult = 'Je peux retrouver mes rubriques autorisées et rouvrir cette formation sans modifier de données métier.';
    chapters.push({ id: `${area}:navigation:v2`, module: 'introduction', moduleLabel: 'Découvrir cet espace', title: 'Se repérer et retrouver l’aide', level: 'notions', href: home,
      steps: ['Utilisez la navigation de cet espace : seules les rubriques autorisées doivent servir de point de départ. Sur mobile, ouvrez le menu de navigation.', 'Si plusieurs espaces vous sont attribués, changez d’espace avec le sélecteur : les rubriques et le périmètre changent, mais vos acquis restent séparés.', 'Rouvrez Formation depuis la coque pour choisir directement un chapitre, reprendre ou consulter un acquis. Mettre en pause ne supprime aucun travail métier.'],
      example: 'Retrouver une procédure sans recommencer les chapitres déjà acquis.', pitfalls: 'Une rubrique absente ne se débloque pas en terminant le tutoriel. Demandez le droit nécessaire au responsable des accès.', result: shellResult, quiz: checkpoint(shellResult) });
    if (['personal', 'team'].includes(area)) {
      const consoleResult = 'Je sais ouvrir et fermer la Console et distinguer une proposition d’une opération confirmée.';
      chapters.push({ id: `${area}:console:v2`, module: 'introduction', moduleLabel: 'Découvrir cet espace', title: 'Utiliser la Console avec prudence', level: 'avance', href: home,
        steps: ['Ouvrez la Console Comexa depuis la coque. Le panneau propose une zone de message, des suggestions et un contrôle de largeur.', 'Pour apprendre sans modifier de données, préparez une question de consultation limitée à votre travail. Si le service est configuré, envoyez-la puis relisez sa réponse et les sources proposées.', 'Ne confirmez aucune opération sans en relire la cible et les conséquences. Fermez le panneau après lecture ; Nouvelle session efface la conversation de cet onglet, pas les données métier.'],
        example: 'Demander une synthèse de ses tâches sans demander la suppression ou la modification d’un dossier.', pitfalls: 'Le webhook n8n est une dépendance externe : ses capacités et sa disponibilité ne sont pas confirmées ici. Une erreur de configuration doit être signalée, pas contournée avec un jeton d’intégration.', result: consoleResult, quiz: checkpoint(consoleResult) });
    }
    for (const item of items) {
      const reading = readChapter(item, area);
      if (!reading) continue;
      chapters.push(reading);
      const section = reading.module;
      for (const lesson of [...PROCEDURES, ...CONTENT_PROCEDURES, ...ADDITIONAL_PROCEDURES]) {
        if (lesson.module !== section || !permits(lesson, permissions, area)) continue;
        chapters.push({ ...lesson, id: `${area}:${section}:${lesson.key}:v2`, moduleLabel: item.label, href: lesson.href ?? item.href, quiz: lesson.quiz ?? KNOWLEDGE_CHECKS[`${section}:${lesson.key}`] ?? checkpoint(lesson.result) });
      }
    }
    return { ...space, home, objective: objective.objective, chapters };
  });
}

/** Les acquis sont des identifiants stables, jamais des positions dans un tableau. */
export function courseProgress(course, saved) {
  const completed = new Set(saved?.completedChapterIds ?? []);
  const known = new Set(saved?.knownChapterIds ?? []);
  const done = course.chapters.filter((chapter) => completed.has(chapter.id));
  const remaining = course.chapters.filter((chapter) => !completed.has(chapter.id));
  const added = course.chapters.filter((chapter) => !known.has(chapter.id) && !completed.has(chapter.id));
  return { completed, done: done.length, total: course.chapters.length, remaining, added, percent: course.chapters.length ? Math.round(done.length * 100 / course.chapters.length) : 0 };
}
export function shouldProposeTraining(course, saved) {
  const progress = courseProgress(course, saved);
  if (!progress.remaining.length || saved?.status === 'paused') return false;
  // Un ancien parcours terminé ne doit pas être rouvert de force ; enrichissement disponible dans l’aide.
  if (saved?.curriculumVersion === 1 && saved?.status === 'completed') return false;
  return !saved || saved.status === 'active' || progress.added.length > 0;
}
