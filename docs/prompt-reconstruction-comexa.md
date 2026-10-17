# PROMPT MAÎTRE — Reconstruire « Comexa » de zéro, en mieux

> **Comment utiliser ce document.** Copie l'intégralité de ce texte comme consigne
> unique et suffisante. Il décrit **QUOI** construire et **POURQUOI**, jamais
> **COMMENT** techniquement : aucune stack, aucun framework, aucun ORM, aucun
> patron d'architecture, aucune bibliothèque ne t'est imposé ni même suggéré.
> Choisis tout toi-même, et justifie chaque choix technique en une phrase au
> moment où tu le poses. Là où ce prompt impose quelque chose, c'est toujours un
> **résultat observable** (un comportement, une garantie, une règle métier),
> jamais un outil.
>
> Toute ressemblance avec une implémentation existante serait un défaut : on te
> demande de refaire **mieux**, pas de reproduire.

---

## 0. Méthode de travail exigée

1. Lis ce prompt en entier avant d'écrire la première ligne de code.
2. Produis une **application complète et exécutable**, pas une maquette : chaque
   écran décrit ici existe, est relié aux données réelles, et gère ses états
   chargement / vide / erreur / succès.
3. Découpe le travail en jalons que tu annonces, puis respecte-les :
   socle (auth + droits + contrat d'erreurs) → CRM commercial → devis/factures →
   projets/production → espace client → site public + CMS → messagerie/notifications →
   rapports/audit/administration → polish (accessibilité, performance, tests).
4. Aucune donnée métier n'est simulée côté interface : toute valeur affichée
   vient du serveur. Un écran n'invente jamais un chiffre, un tarif, un statut.
5. Une erreur ne doit **jamais** vider ni corrompre un écran déjà rempli : un
   bloc qui échoue affiche son propre message, les autres blocs restent vivants.
6. Livre à la fin : la commande de lancement, un jeu de données de démarrage
   (voir §12), la liste des tests et comment les lancer, et une page de
   documentation du contrat d'API généré depuis le code.
7. Signale explicitement, dans un fichier `LIMITES.md`, toute exigence de ce
   prompt que tu n'as pas remplie, avec la raison. Ne laisse jamais une
   fonctionnalité manquante silencieuse.

---

## 1. Le produit en une page

**Comexa** est une agence de développement web (basée en Algérie, projets en
Algérie et à l'international). Le produit est un ensemble cohérent de trois
surfaces partageant un même compte utilisateur et une même base :

1. **Le site public** : vitrine commerciale et machine à acquérir des demandes
   (services, réalisations, partenaires, témoignages, FAQ, contact). Tout son
   contenu est pilotable depuis l'espace équipe, sans redéploiement.
2. **L'espace client** : le dossier en ligne d'un client — ses commandes, ses
   devis à accepter ou refuser, ses factures et paiements, ses projets suivis en
   transparence, ses documents partagés, sa messagerie avec l'agence, ses
   demandes de modification.
3. **L'espace équipe** : l'outil de travail interne — CRM complet
   (demandes entrantes → prospects → clients), devis et facturation, commandes
   en ligne et demandes de projet, gestion de projets (membres, jalons, tâches,
   temps passé, activité), messagerie, notifications, rapports et analytique,
   gestion des membres et des droits, journal d'audit, paramètres, et
   administration du contenu du site public.

**Langue** : français, partout (interface, messages d'erreur, e-mails,
documents). **Devises** : dinar algérien (DZD) et euro (EUR), sans conversion
automatique entre elles. **Ton** : clair, humain, sans jargon ; on explique à
l'utilisateur ce qui se passe et ce qu'il doit faire ensuite.

**Promesse centrale du produit** : un client voit exactement ce qui le concerne
— ni plus, ni moins — et l'agence garde une trace fiable et imputable de tout
ce qui engage (devis accepté, facture, paiement, décision).

---

## 2. Acteurs, rôles et droits

### 2.1 Les sept rôles

| Rôle | Ce qu'il fait |
|---|---|
| **Administrateur** | Accès complet ; comptes, rôles, paramètres, audit. |
| **Gérant communication** | Anime le site public et ses contenus, traite les demandes entrantes, gère prospects et clients légers. |
| **Chef de projet** | Pilote projets, équipes, jalons, tâches, temps ; valide commandes ; devis et factures en lecture/écriture ; rapports. |
| **Développeur** | Travaille sur les tâches qui lui sont assignées ; saisit son temps ; dépose des documents sur ses projets. |
| **Gestion réseaux sociaux** | Même accès que Développeur (deux métiers, mêmes besoins d'accès). |
| **Commercial** | Qualifie prospects, convertit en clients, émet et envoie devis, suit factures et paiements, valide commandes. |
| **Client** | Accès strictement limité à son propre dossier : ses projets, ses devis (accepter/refuser), ses factures, ses paiements, ses documents partagés, sa messagerie, ses demandes de modification. |

### 2.2 Principes de droits (non négociables)

- Les droits sont des **permissions élémentaires** de forme
  `ressource:action:portée` (ex. `tache:ecrire:assignees`,
  `facture:lire:siennes`). Le catalogue est une **source de vérité unique**,
  lue par les contrôles d'accès, l'interface et les tests.
- La **portée** est le cœur du modèle : `toutes` (toute l'agence),
  `assignees`/`siennes` (ce qui me revient), `client` (ce qui est partageable
  avec un client). Deux personnes peuvent avoir « lire les tâches » sans voir
  les mêmes tâches.
- « Siennes » a un sens **défini par ressource** et documenté : pour une tâche
  en lecture = assignée **ou** créée par moi ; en écriture = assignée à moi
  seulement ; pour une saisie de temps = mes saisies, pas celles des tâches que
  je partage ; pour un devis client = les devis de mon dossier client.
- **Le contrôle est toujours côté serveur.** Cacher un bouton n'est qu'un
  confort : aucune requête ne doit aboutir sans vérification de permission ET
  de périmètre. Un identifiant envoyé par le client (`clientId`, `projectId`…)
  ne peut jamais élargir son périmètre.
- **Hors périmètre = introuvable.** Une ressource qui existe mais n'est pas
  accessible au porteur répond « introuvable », pas « interdit » : on ne révèle
  pas l'existence d'une ligne.
- **Isolation du client** : aucune permission de lire les tâches internes, le
  temps passé interne, les rapports internes ni les documents internes. Un
  document n'est visible d'un client que si sa visibilité explicite le permet
  **et** que sa permission le permet : deux barrières, pas une.
- Les rôles système ne peuvent pas être supprimés par l'administration ; les
  permissions d'un rôle sont modifiables sauf pour le rôle administrateur.
- Protections d'identité : impossible de supprimer ou suspendre son propre
  compte, impossible de retirer le dernier administrateur.

---

## 3. Modèle de données

> Décrit en langage métier. À toi de le traduire dans le schéma de ton choix,
> en conservant **toutes** les règles d'intégrité listées.

### 3.1 Règles d'intégrité transverses

- **Argent** : décimal exact à deux décimales, jamais de flottant binaire.
  Arrondi commercial au centime (les ,5 au-dessus) uniquement là où un arrondi
  est inévitable (quantité × prix, remise en %, taxe) ; les sous-totaux et
  totaux sont des sommes de valeurs déjà arrondies.
- **Durées** : entiers en minutes, jamais d'heures flottantes.
- **Dates** : horodatées avec fuseau ; une « journée métier » (saisie de temps,
  rapport journalier) est une date calendaire sans heure, jamais décalée par le
  fuseau de lecture.
- **Suppression douce** (`supprimé le…`) sur tout ce qui porte un historique :
  prospects, clients, projets, tâches, devis, factures, paiements, documents,
  contenus, comptes. Suppression physique réservée aux liens et aux jetons.
- **Références lisibles et uniques** : chaque objet métier porte une référence
  humaine `PRÉFIXE-ANNÉE-SÉQUENCE` (4 chiffres, sans troncature au-delà de
  9999), préfixes fixes : prospect `PRO`, client `CLI`, projet `PRJ`, devis
  `DEV`, facture `FAC`, paiement `PAY`, demande de contact `CTR`, demande de
  modification `MOD`, commande `CMD`, demande de projet `DEM`. La séquence est
  attribuée **dans la transaction** qui crée l'objet (deux créations simultanées
  ne peuvent pas recevoir le même numéro) et ne recommence jamais à zéro en
  cours d'année.
- **Comptabilité légale** : devis et factures portent en plus une numérotation
  continue par année (couple année+séquence unique).
- Aucun binaire en base : les fichiers vivent dans un stockage objet ; la base
  ne garde que métadonnées (nom, MIME, taille, empreinte, clé de stockage).

### 3.2 Identité et accès

- **Compte** (un seul modèle pour tous, internes comme clients) : e-mail unique,
  empreinte de mot de passe, prénom, nom, téléphone, **pays de résidence**
  (détermine la devise des commandes), avatar (clé de stockage), statut
  (invité / actif / suspendu / archivé), e-mail vérifié ou non (+ date),
  dernière connexion, compteur d'échecs de connexion + date de déblocage,
  drapeau « doit changer son mot de passe », lien optionnel vers son dossier
  client.
- **Rôle** (code stable + libellé + description + drapeau système),
  **Permission** (code + ressource/action/portée dérivées du code), liaison
  rôle↔permission, liaison compte↔rôle (avec auteur et date d'attribution).
- **Jetons de session longue** : empreinte uniquement (jamais le jeton en
  clair), famille de rotation, agent et IP d'origine (information d'affichage,
  pas un facteur d'authentification), expiration, révocation.
- **Jetons de vérification d'e-mail** et **jetons de réinitialisation** :
  empreinte, expiration, usage unique, date d'utilisation.

### 3.3 CRM

- **Demande de contact** (site public) : identité, e-mail, téléphone, société,
  fonction, site web, sujet, message, rattachement optionnel au service ou pack
  concerné, fourchette budgétaire déclarative, statut (nouvelle / en cours
  d'examen / convertie / spam / archivée), traces techniques (source, UTM, IP,
  agent), traitement (auteur, date, note interne), lien unique vers le prospect
  issu (une demande → au plus un prospect).
- **Prospect** : référence, identité du contact, société, secteur, site,
  source (site, formulaire, recommandation, réseau social, prospection,
  événement, partenaire, autre), statut de pipeline, estimation interne et
  fourchette budgétaire, notes, motif de perte, responsable commercial, lien
  vers le client issu de la conversion (+ date).
- **Historique de pipeline** : pour chaque changement d'étape, d'où, vers où,
  note, auteur, date. C'est la preuve du parcours.
- **Client** : référence, nom commercial, raison sociale, n° d'enregistrement
  et n° de TVA (facultatifs), secteur, site, taille, adresse complète, statut
  (actif / inactif / archivé), responsable de compte, notes.
- **Interlocuteur** : rattaché à un client, identité, e-mail, téléphone,
  fonction, drapeau « principal » (un seul par client), notes.

### 3.4 Projets et production

- **Projet** : référence, nom, code court unique optionnel, description, client
  (obligatoire), statut, santé (à l'heure / à risque / en dérive), priorité,
  dates de début/échéance/clôture, budget contractuel + devise (donnée métier
  issue du devis accepté, pas un tarif catalogue), avancement déclaré 0-100,
  responsable, créateur, lien un-à-un vers le devis dont il est né, lien
  optionnel vers la commande dont il est né.
- **Membre de projet** : compte + rôle libellé *sur ce projet* (distinct du rôle
  global) + pourcentage d'allocation + dates d'entrée/sortie.
- **Jalon** : titre, description, échéance, statut (prévu / en cours / atteint /
  manqué / annulé), date d'atteinte, ordre.
- **Tâche** : projet, jalon optionnel, tâche mère optionnelle (sous-tâches),
  titre, description, statut, priorité, assigné, rapporteur, estimation en
  minutes, dates début/échéance/clôture, **visibilité client faux par défaut**,
  ordre.
- **Saisie de temps** : projet (hérité de la tâche), tâche optionnelle, auteur,
  jour, minutes, description, facturable ou non.
- **Activité** (fil d'un projet) : type (commentaire, changement de statut,
  tâche créée/terminée, jalon atteint, fichier déposé, temps saisi, note,
  système), message, charge libre (ancien/nouveau statut…), acteur, drapeau
  « visible du client ».

### 3.5 Commercial et facturation

- **Tarif de pack** : pack, devise, montant, **date d'effet**, actif ou non,
  auteur. Un tarif ne se modifie jamais : une correction est un nouveau tarif ;
  l'ancien reste pour l'historique.
- **Commande** (pack acheté en ligne) : référence, compte auteur, client, pack,
  tarif utilisé, projet créé à la validation (null avant), **instantané figé**
  (nom du pack, devise, montant, pays, moyen de paiement), statut de traitement
  (reçue / en validation / en préparation / en cours / terminée / annulée) et
  **état de paiement indépendant** (impayée / partielle / réglée / échec /
  remboursée), dates.
- **Demande de projet** : ce que reçoit l'équipe quand la commande en ligne
  n'est pas possible ou pas souhaitée — compte auteur, pack optionnel, pays,
  **motif relevé par le serveur** (pays inconnu / aucun tarif en vigueur / aucun
  moyen de paiement compatible / choix du client), message, statut, note
  interne, traitant.
- **Devis** : référence + numérotation annuelle, cible **prospect ou client**
  (règle « exactement l'un des deux » tenue par le code métier ; un devis
  accepté porte légitimement les deux : l'origine et le client créé), objet,
  notes, conditions, statut, dates d'émission et de validité, devise, sous-total,
  remise, taux et montant de taxe, total, dates d'envoi / de consultation /
  d'acceptation / de refus + motif de refus, identité figée de l'acceptant
  (nom tel que signé, IP, compte), créateur.
- **Ligne de devis** : position, titre, description, quantité décimale, prix
  unitaire, remise en %, taux de taxe, **total de ligne stocké** (un devis
  accepté est un document figé).
- **Facture** : référence + numérotation annuelle, client **obligatoire**,
  projet et devis d'origine optionnels, type (standard / acompte / avoir),
  statut, objet, notes, conditions, dates d'émission et d'échéance, date de
  règlement, devise, sous-total, remise, taxe, total, **cumul encaissé** (le
  solde se déduit, jamais stocké), dates d'envoi/annulation, créateur.
- **Ligne de facture** : mêmes champs qu'une ligne de devis.
- **Paiement** : référence, facture, montant, devise, moyen (virement, carte,
  espèces, chèque, PayPal, CCP, BaridiMob, autre), statut (en attente / réussi /
  échec / remboursé), date, référence externe, justificatif (document),
  encaisseur, notes.

### 3.6 Messagerie, notifications, documents

- **Conversation** : type (directe / projet / client / support), sujet,
  rattachements projet/client, créateur, dernier message (date + aperçu),
  archivée ou non.
- **Participant** : compte, rôle dans la conversation (propriétaire / membre /
  invité), dates d'entrée/sortie, muet, **marqueur de lecture** (« lu jusqu'à
  telle date ») — le compteur de non-lus se calcule, il ne se stocke pas.
- **Message** : conversation, expéditeur, type (texte / système / fichier),
  corps, réponse à un autre message, date d'édition. **Le message est d'abord
  écrit en base** ; le temps réel n'est qu'un canal de diffusion de ce qui vient
  d'être persisté : une déconnexion ne perd rien.
- **Pièce jointe de message** : réutilise le modèle Document (un seul chemin
  d'accès au stockage, une seule règle de visibilité, une seule purge).
- **Notification** : destinataire, type (tâche assignée, échéance proche, tâche
  terminée, jalon atteint, statut de projet, devis envoyé/accepté/refusé,
  facture émise, facture en retard, paiement reçu, message reçu, document
  partagé, demande de modification, demande de contact, système), titre, corps,
  lien profond + type/identifiant d'objet (recalculable si les routes
  changent), date de lecture.
- **Document** : nom, nom d'origine, MIME, taille, pilote de stockage, clé,
  empreinte, catégorie (contrat, devis, facture, spécification, design,
  rapport, juridique, marque, autre), **visibilité (interne / client /
  public)**, déposant, rattachements optionnels (client, projet, tâche, devis,
  facture), **versionnage** (une nouvelle version pointe la précédente ;
  l'historique reste consultable), expiration.

### 3.7 Contenu du site public (CMS)

- **Service** : slug unique, titre, description courte et longue, icône,
  visuel, points forts, **prix de départ facultatif** (saisi à la main, jamais
  inventé ; devise obligatoire si prix), ordre, actif, mis en avant, SEO.
- **Pack** : slug, nom, accroche, description, fonctionnalités incluses **et
  exclues** (tableau comparatif honnête), badge, ordre, actif, mis en avant,
  SEO. **Aucun prix dans le pack** : les tarifs vivent dans leurs propres
  lignes datées (voir 3.5).
- **Catégorie d'étude de cas**, **Étude de cas** (slug, titre, client, extrait,
  contenu, visuel, galerie, stack, URL, catégorie, statut de publication +
  date, ordre, mis en avant, SEO), **Témoignage** (auteur, fonction, société,
  avatar, citation, note, **non publié par défaut**, ordre, liens étude de cas
  et client), **Partenaire** (nom, URL de logo hébergé ailleurs, site, ordre,
  actif), **FAQ** (question, réponse, catégorie, ordre, publiée).
- **Demande de modification** (client → agence) : projet, client, titre,
  description, statut (soumise / approuvée / refusée / en cours / faite),
  priorité, impact estimé en minutes et surcoût éventuel (le chiffrage repasse
  par un devis), demandeur, décideur, date et note de décision.

### 3.8 Système

- **Compteur** de numérotation : une ligne par (portée, année), incrémentée en
  transaction.
- **Paramètre** : clé, valeur structurée, description, auteur et date de
  dernière modification. Les paramètres « internes » sont masqués aux lectures
  non autorisées (la règle doit se tromper dans le sens du masquage).
- **Journal d'audit** : acteur, action, type et identifiant d'objet, avant et
  après (structurés), IP, agent, date. Toute action sensible y laisse une
  trace imputable ; les secrets y sont expurgés.
- **Rapport** : type (avancement projet, tâches, temps passé, pipeline
  commercial, revenus, encours de factures, activité), format demandé, titre,
  statut (en attente / généré / échoué), paramètres, période, projet optionnel,
  document produit, auteur, erreur éventuelle, dates. **Le résultat est un
  instantané figé à sa date de génération** : relire un rapport ancien ne
  recalcule rien.
- **Rapport journalier** : un par personne et par jour (unicité), contenu riche
  au format structuré de l'éditeur (jamais de balisage brut stocké), résumé
  court.

---

## 4. Règles métier impératives

### 4.1 Devis

- Machine à états : brouillon → envoyé → consulté → accepté / refusé ; plus
  expiré / annulé.
- **Un devis envoyé ne se réécrit plus.** C'est la règle qui commande tout :
  le client accepte un document ; si ce document pouvait changer entre l'envoi
  et l'acceptation, l'accord porterait sur autre chose que ce qui a été signé.
  Brouillon seul modifiable et supprimable.
- On n'envoie qu'un brouillon ; « consulté » est une information de lecture,
  pas un changement de droit.
- Accepter ou refuser n'est possible que sur un devis envoyé/consulté ; le
  refus exige un motif ; acceptation et refus sont **définitifs** (un devis
  refusé se remplace par un nouveau devis, qui garde sa trace).
- Une facture ne peut naître que d'un devis **accepté**.
- **L'acceptation d'un devis crée le client** (si la cible était un prospect)
  **et le projet** : c'est le seul chemin de création d'un client commercial.
  Le prospect passe à « gagné » et son historique le raconte.
- Tous les totaux sont recalculés côté serveur ; **aucun montant envoyé par le
  client n'est cru** (une ligne porte quantité, prix, remises, taxe ; le total
  de ligne et les totaux du document sont dérivés).

### 4.2 Factures et paiements

- Le **statut d'une facture se dérive de la somme des paiements encaissés**, il
  ne s'incrémente jamais : impayée → partielle → réglée, et le retour en
  arrière est possible (remboursement → le statut redescend). Les états que le
  solde n'exprime pas (annulée, remboursée, brouillon) sont préservés.
- Une facture n'est payable qu'**envoyée** ; un brouillon n'est pas un document.
- Un paiement est **plafonné au solde restant** : impossible de créer un
  trop-perçu par l'API.
- Annulation ouverte seulement tant qu'aucun centime n'est encaissé
  (brouillon, envoyée, en retard) ; dès qu'il y a de l'argent, la correction
  comptable est un **avoir**, pas une annulation silencieuse.
- Une facture en retard est une facture envoyée dont l'échéance est passée :
  un mécanisme périodique (tâche planifiée) bascule les factures concernées et
  notifie ; rien n'est déduit du seul calendrier côté interface.
- La date de règlement n'est posée que lorsque la facture passe à « réglée »,
  et retirée si elle redescend.

### 4.3 Pipeline commercial

- Table de transitions **exhaustive et unique** :
  - nouveau → contacté, qualifié, perdu ;
  - contacté → qualifié, proposition envoyée, négociation, perdu ;
  - qualifié → proposition envoyée, négociation, perdu ;
  - proposition envoyée ⇄ négociation ; proposition envoyée → gagné, perdu ;
  - négociation → gagné, perdu ;
  - **gagné : terminal** ; **perdu → nouveau seulement** (une piste perdue se
    reprend comme une nouvelle piste, avec son propre historique).
- On ne saute pas la qualification (nouveau → gagné ou nouveau → proposition
  envoyée sont refusés) ; nouveau → qualifié est autorisé (piste entrante déjà
  cadrée).
- Une transition refusée répond avec la **liste des sorties réellement
  autorisées** depuis l'état courant, pour que l'écran propose les seules
  étapes valides sans re-dériver la table.
- Changer d'étape écrit une ligne d'historique (auteur, note, date) ; un
  changement vers la même étape est refusé, pas ignoré.
- Conversion prospect → client : idempotente **par refus** (rejouer l'appel
  répond « déjà converti », ne crée pas un second dossier).

### 4.4 Tâches, jalons, temps

- Tâches : transitions contrôlées ; une tâche portant des sous-tâches ouvertes
  ne peut pas être fermée ; une sous-tâche d'une tâche fermée ne peut pas être
  rouverte librement ; lecture et écriture ont des périmètres différents
  (voir §2.2).
- Jalons : un jalon atteint n'est pas supprimable ; un jalon portant des tâches
  n'est pas supprimable.
- Temps : minutes entières, strictement positives, **plafonnées à 24 h par
  saisie** ; **pas de saisie sur un jour futur** ; correction et suppression
  contrôlées par périmètre ; le temps saisi finit en facturation, donc une
  durée fausse se paie.
- **Minuteur global** : l'équipe dispose d'un minuteur visible en permanence ;
  son état survit à un rechargement de page et est cloisonné par compte ;
  l'arrêt crée une **vraie saisie de temps** côté serveur — rien n'est
  enregistré tant que l'appel n'a pas réussi.

### 4.5 Commandes en ligne et demandes de projet

- **La devise vient du pays, jamais du navigateur** : Algérie → DZD ; tout
  autre pays valide → EUR ; pays absent ou invalide → aucune devise (on ne
  devine pas).
- **Aucune conversion** : un pack a un tarif par devise ; si le tarif de la
  devise du pays n'existe pas à la date du jour, la commande n'est pas
  proposée.
- **Aucun moyen de paiement configuré pour la devise = pas de commande en
  ligne** : le visiteur est orienté vers une demande de projet, **jamais
  refusé**. Le motif exact (pays inconnu / aucun tarif / aucun moyen de
  paiement) est dit au client, avec le chemin de secours.
- Le tarif affiché vient **du serveur** au moment du choix, jamais d'un prix
  codé dans l'interface.
- Une commande fige son instantané (nom du pack, montant, devise, moyen de
  paiement, pays) : un changement de tarif ultérieur ne modifie aucune commande
  existante. Une commande annulée n'est jamais supprimée.
- La commande **active immédiatement l'espace client** de son auteur.
- Côté équipe : valider une commande crée le projet ; enregistrer l'état du
  paiement et démarrer le projet sont des gestes distincts et tracés.
- Le client voit une **frise d'étapes** dont aucune n'est « faite » avant que
  le serveur ne l'ait atteinte, plus la « prochaine action attendue » expliquée
  en une phrase.

### 4.6 Contenus publics et cache

- Rien n'est publié sans geste explicite : témoignages non publiés par défaut,
  contenus en brouillon/archivés non servis au public.
- Slugs uniques et réservés (pas de slug système).
- Le site public sert un contenu **mis en cache côté serveur** (référencement)
  avec purge à la demande : toute écriture d'un contenu depuis l'espace équipe
  rend le site à jour immédiatement, via un secret partagé entre les deux
  bouts — pas un rafraîchissement horaire seul.
- En cas d'indisponibilité du contenu, la page publique reste remplie grâce à
  un contenu de repli **assumé et unique** (voir §11 : pas de double source de
  vérité dissimulée).

### 4.7 Numérotation, argent, références

- Voir §3.1. En plus : un libellé de statut, un motif d'offre ou un code
  d'erreur inconnu de l'interface s'affiche tel quel plutôt que d'être
  transformé en autre chose ; l'interface commute sur des **codes stables**,
  jamais sur des messages.

---

## 5. Parcours bout en bout à faire fonctionner

1. **Visiteur → client** : lit le site → dépose une demande de contact →
   l'équipe la qualifie, la convertit en prospect → pipeline → devis envoyé →
   le prospect ouvre le devis (marqué consulté) → accepte → client + projet
   créés, facture générable → paiements encaissés → solde et statut dérivés.
2. **Commande en ligne** : compte créé et e-mail vérifié → choisit un pack →
   tarif serveur affiché dans sa devise → commande (ou demande de projet si
   impossible) → espace client actif → équipe valide → projet créé → démarré →
   suivi visible du client.
3. **Suivi de projet côté client** : avancement, jalons, tâches **visibles
   client seulement**, fil d'activité filtré, documents partagés, messagerie,
   demande de modification soumise puis approuvée/refusée avec note.
4. **Production côté équipe** : projet → membres affectés → jalons → tâches et
   sous-tâches assignées → saisies de temps (manuelles ou minuteur) → rapport
   journalier rédigé → activité tracée.
5. **Pilotage** : tableau de bord personnel et/ou agence selon droits,
   analytique par période, rapports générés et figés, journal d'audit
   consultable avec filtres.
6. **Administration** : création de compte (mot de passe généré, renvoyé une
   seule fois), attribution de rôles, suspension/réactivation avec fermeture
   des sessions, édition des permissions d'un rôle, paramètres, contenus du
   site (services, packs + tarifs datés, études de cas, témoignages,
   partenaires, FAQ).
7. **Compte** : changement de mot de passe (ancien exigé), mot de passe oublié
   (réponse identique que le compte existe ou non), liste des sessions ouvertes
   avec agent et IP, fermeture d'une session ou de toutes.

---

## 6. Inventaire des écrans

### 6.1 Site public

- **Accueil** : héro (promesse + deux appels à l'action), bandeau de
  compétences, présentation de l'agence, services (avec prix de départ
  *seulement s'il est saisi*), réalisations mises en avant, méthode en quatre
  étapes, témoignages, partenaires, bloc contact, appel à l'action final.
- **Services** : détail de chaque service actif.
- **Réalisations** : études de cas publiées, filtrables par catégorie, détail
  par slug.
- **Partenaires** : logos et liens.
- **Contact** : formulaire complet (identité, société, e-mail, téléphone,
  besoin choisi parmi les services, fourchette budgétaire, message) qui
  **fonctionne réellement**, avec accusé de réception et protection anti-abus ;
  coordonnées de l'agence.
- Pages d'**authentification** : inscription (avec pays), vérification d'e-mail
  (renvoi du lien), connexion, mot de passe oublié, réinitialisation.

### 6.2 Espace client

- **Mon espace** : synthèse — commandes avec frise d'étapes et prochaine
  action, projets avec avancement, demandes de projet, devis ouverts, factures
  et solde restant.
- **Commander un pack** : choix du pack, tarif serveur, commande ou demande de
  projet selon disponibilité, confirmation avec référence.
- **Détail d'un devis** : lignes, totaux, validité, accepter (avec identité de
  signature) ou refuser (motif obligatoire) ; états fermés expliqués.
- **Détail d'un projet** : avancement, jalons, tâches visibles client,
  activité filtrée, documents partagés.
- **Demandes de modification** : liste + dépôt d'une demande.
- **Messagerie** : conversations, messages temps réel, pièces jointes.
- **Notifications** : liste, lecture unitaire et globale.
- **Tableau de bord** : indicateurs personnels (projets, factures, documents).
- **Mon compte** : identité, mot de passe, sessions.

### 6.3 Espace équipe (navigation groupée, filtrée par droits)

- **Tableau de bord** « bento » : salutation datée, indicateurs agence ou
  personnels selon droits (avec sélecteur de période), répartition par statut,
  minuteur, facturation et encours, santé des projets, échéances, pipeline
  commercial repliable avec tableau glisser-déposer des prospects.
- **Contacts** : file des demandes de contact, traitement, conversion en
  prospect.
- **Prospects** : liste filtrable, fiche, pipeline (changements d'étape avec
  transitions autorisées), historique, conversion en client.
- **Devis** : liste filtrable par statut, création (lignes éditable, totaux
  serveur), détail, envoi, suivi consultation, acceptation/refus, génération de
  facture.
- **Factures** : liste, détail lignes et paiements, envoi, encaissements
  (plafonnés au solde), annulation selon règles, justificatifs.
- **Commandes** : liste, détail, validation (crée le projet), état de paiement,
  démarrage du projet.
- **Demandes de projet** : file, traitement, note interne.
- **Clients** : liste, fiche (interlocuteurs, projets, devis, factures,
  documents, conversations).
- **Projets** : liste, fiche (statut/santé/avancement, membres, jalons,
  tâches, activité, documents, conversations).
- **Tâches** : tableau par statut, création/édition/assignation, sous-tâches.
- **Calendrier** : vue mensuelle des échéances tâches et jalons.
- **Suivi du temps** : feuille de temps personnelle ou d'équipe selon droits,
  saisie, correction, suppression.
- **Rapports journaliers** : rédaction riche (un par jour), lecture des autres
  selon droits.
- **Messagerie**, **Notifications**.
- **Analytique** : graphiques par période (pipeline, revenus, encours,
  activité, temps).
- **Rapports** : génération par type et période, résultat figé consultable.
- **Demandes de modification** : file de décision (approuver/refuser avec
  note, impact estimé).
- **Contenu du site** : administration services, packs **et tarifs datés par
  devise**, études de cas et catégories, témoignages (modération),
  partenaires, FAQ.
- **Membres et droits** : comptes, création (mot de passe généré affiché une
  fois), suspension/réactivation, rôles.
- **Rôles et permissions** : catalogue, édition des permissions par rôle.
- **Journal d'audit** : filtres par acteur, action, objet, période.
- **Paramètres** : lecture/écriture selon droits, internes masqués.
- **Mon compte**.

---

## 7. Exigences d'interface et de design

### 7.1 Charte (à respecter comme identité, pas comme contrainte technique)

- **Police** : Space Grotesk (titres et corps), graisses 400/500/600.
- **Palette** : bleu Comexa — encre `#0b2545`, accents `#1e86e0`, `#1568b4`,
  ciel `#4fb0f0`, fonds bleutés `#e2effd` / `#f1f7fe` ; neutres teintés bleu ;
  sémantiques succès `#0e7a4a`, alerte `#a85b0a`, erreur `#c0271f`, info
  `#1568b4` avec fonds doux à 8 %.
- **Signature visuelle** : ombres « dures » décalées (trait plein sous la
  carte, style néo-brutaliste sobre) sur les éléments primaires du site
  public ; rayons généreux (6 → 45 px, pilule) ; dégradés de marque bleu
  profond → ciel.
- **Deux ambiances cohérentes** : site public et espace client **clairs**
  (fond blanc/gris bleuté, cartes blanches bordées) ; espace équipe **sombre
  « verre liquide »** (fond bleu nuit `#080f18`, surfaces translucides, flou
  réservé aux couches flottantes — barre latérale, barre supérieure, cartes du
  tableau de bord — jamais au corps des listes ; accent lumineux `#59b2ff`).
- **Rythme** : espacements sur base 4 px, conteneur 1240 px, hauteur de
  contrôle 48 px, rupture unique autour de 900 px.
- **Mouvement** : apparitions douces au défilement, micro-interactions 140-320
  ms, et **respect de la préférence « réduire les animations »**.

### 7.2 Composants et états

- Badges de statut à tons cohérents (succès/info/alerte/erreur/neutre) partout
  où un statut apparaît ; mêmes libellés français partout (un seul dictionnaire
  de libellés partagé).
- Cartes, listes, tableaux filtrables, pagination (20 par défaut, choix
  possibles), états vides **explicatifs** (ce qui apparaîtra ici, et quand),
  squelettes de chargement, avis d'erreur lisibles, confirmations pour les
  gestes destructeurs.
- Formulaires : libellés visibles, aide contextuelle, erreurs par champ
  reprises du serveur, boutons désactivés pendant l'action, aucune perte de
  saisie en cas d'erreur.
- Navigation des espaces : barre latérale groupée par familles, repliable,
  tiroir sur mobile avec piège de focus ; fil d'Ariane et titre de page
  déduits de la navigation ; **chaque entrée de menu n'apparaît que si le
  porteur a le droit correspondant**.
- Montants formatés dans leur devise, dates en français ; une journée métier
  s'affiche sans décalage de fuseau.

### 7.3 Accessibilité (niveau visé : WCAG 2.2 AA)

- Contrastes textes et bordures de contrôle conformes ; focus visible partout ;
  navigation clavier complète (menus, dialogs, tableaux glisser-déposer avec
  alternative clavier explicite) ; liens d'évitement ; rôles et `aria-*`
  corrects sur navigation, onglets, badges et notifications ; annonces d'état
  (`role=status`) pour les chargements et confirmations.

---

## 8. Exigences de sécurité (résultats attendus)

- Mots de passe : empreinte par algorithme moderne à coût réglable ; politique
  de robustesse expliquée à l'utilisateur ; changement exige l'ancien ;
  réinitialisation par lien à usage unique, empreinte en base, durée limitée ;
  **verrouillage temporaire après échecs répétés**, avec réponse identique que
  le compte existe ou non.
- **Connexion interdite tant que l'e-mail n'est pas vérifié** ; lien de
  vérification à usage unique et daté ; renvoi possible, réponse identique.
- Session : jeton court vécu **en mémoire seulement** côté navigateur ; jeton
  long dans un cookie inaccessible au JavaScript, **rotatif** (chaque usage le
  révoque et le remplace) avec **détection de rejeu** (un jeton révoqué qui
  resurgit révoque toute sa famille) ; liste des sessions avec agent et IP ;
  fermeture unitaire, globale, et automatique à la suspension/suppression.
- Autorisation : permissions vérifiées **à chaque requête**, périmètre appliqué
  **dans la requête de lecture elle-même** (on ne charge jamais une ligne sans
  droit), jamais après coup.
- Limitation de débit globale et renforcée sur l'authentification ; en-têtes de
  sécurité stricts ; origines CORS en liste blanche ; confiance aux en-têtes de
  proxy **explicite et documentée** (sinon le limiteur compte une seule adresse
  et bloque tout le monde).
- Téléversements : taille et type contrôlés, stockage objet hors base, clé
  non devinable, URLs signées à durée courte, visibilité par document.
- Journal d'audit des actions sensibles avec avant/après **expurgé des
  secrets** ; les journaux ne contiennent jamais mot de passe, jeton ni secret.
- Configuration : **le serveur refuse de démarrer** si un secret manque, si
  deux secrets devant être différents sont identiques, ou si aucun moyen
  d'envoi d'e-mail n'est configuré en production ; un message de démarrage
  nomme la variable en cause. Aucune valeur secrète dans le dépôt ; un fichier
  d'exemple sans secret est versionné.
- Documentation d'API : fermée par défaut en production ; si ouverte, protégée
  par identifiants (page de connexion servie par le serveur, et authentification
  basique acceptée pour les clients non-navigateurs) ; un mot de passe court la
  rend inutilisable (les routes de documentation ne passent pas par le limiteur).
- Le site public ne parle jamais directement au backend depuis le navigateur :
  un relais côté serveur garde le cookie de session sur le même site (pas de CORS
  exposé, pas d'adresse interne côté client).

---

## 9. Contrat d'API et d'erreurs (comportement observable)

- **Une seule enveloppe** : succès `{ succes, donnees, meta? }` ; erreur
  `{ succes: faux, erreur: { code, message, details } }`.
- Listes paginées : `donnees` **est** le tableau ; `meta` porte page, taille,
  total, total de pages (**0 sur une liste vide**, pas 1).
- **Codes d'erreur stables** en MAJUSCULES_SOULIGNÉES, contractuels
  (`PROJET_INTROUVABLE`, `VALIDATION_ECHOUEE`, `TRANSITION_INTERDITE`…) ;
  `message` destiné à l'humain, libre de changer ; `details` porte les
  informations actionnables (champ fautif **nommé, jamais sa valeur** ; liste
  des transitions autorisées ; etc.). Aucune pile d'exécution ne sort en
  production.
- Statuts HTTP cohérents : 400 validation, 401 non authentifié, 403 droit,
  **404 hors périmètre**, 409 doublon ou déjà décidé, 422 règle métier, 413
  trop lourd, 429 débit, 500/503 panne.
- Convention de nommage des codes : `<OBJET>_INTROUVABLE` (404),
  `<OBJET>_DEJA_<ÉTAT>` ou `_CODE_PRIS` (409), `<OBJET>_<CONTRAINTE>` (422).

---

## 10. Exigences de qualité et de livraison

- Les **règles pures** (machines à états, arithmetic money, tables de
  transitions, périmètres, politiques de mot de passe et de durée) vivent dans
  des modules sans accès aux données, **testés unitairement état par état**.
- Des tests de parcours couvrent : inscription→vérification→connexion, chaîne
  commerciale complète, commande en ligne et ses trois motifs de repli,
  isolation client (tentatives d'accès croisés), facturation et remboursements,
  messagerie temps réel, contenus publics et purge de cache.
- Jeu de données de démarrage **idempotent**, sans mot de passe fixe (générés
  et affichés une fois), **sans aucun prix inventé**, adresses de démonstration
  sur un domaine réservé impossible à contacter.
- Migrations de base versionnées ; aucune modification manuelle de schéma en
  production ; le client d'accès aux données est un artefact généré, jamais
  versionné.
- Lint et formatage propres sur tout l'arbre ; documentation d'API générée
  depuis le code ; runbook de déploiement sans secret ; image d'exécution sans
  outils de développement.
- Référencement du site public : rendu serveur du contenu, métadonnées et
  cartes de partage complètes par page (titre « comexa » seul est insuffisant).

---

## 11. Ce que la version actuelle rate — fais mieux

> Liste relevée sur l'existant ; chaque point est une occasion d'amélioration,
> pas une consigne de reproduction.

1. **Deux formulaires de contact** : celui de la page d'accueil est désactivé
   (« pas encore raccordé ») pendant que `/contact` fonctionne → un seul
   formulaire, fonctionnel partout où il apparaît.
2. **Contenu de repli codé en dur** dans les vues publiques, en double des
   contenus CMS → repli unique, explicite, et jamais présenté comme du contenu
   réel.
3. **Rapports « PDF » annoncés, jamais produits** : le résultat est un
   instantané structuré → produire de vrais exports téléchargeables (PDF et/ou
   feuille de calcul) en plus de l'instantané.
4. **Avoirs déclarés mais inexistants** : une facture encaissée ne peut pas
   être corrigée comptablement → implémenter l'avoir de bout en bout.
5. **Catalogue de permissions incomplet** (codes manquants contournés par des
   replis, annulation de facture réservée de fait à l'administrateur,
   impossibilité pour un exécutant de générer son propre rapport) → catalogue
   exhaustif et cohérent dès le départ, avec les tests qui vont avec.
6. **Minuteur stocké seulement dans le navigateur** → état serveur : le
   minuteur survit au changement d'appareil et à la purge du navigateur.
7. **Instantané de rapport rangé dans le champ « paramètres »** et paramètres
   « internes » déduits de leur nom → colonnes dédiées.
8. **Captures et documentation visuelles obsolètes** dans le dépôt →
   documentation visuelle regénérée à chaque changement d'interface.
9. **Pas de recherche globale**, pas d'exports de listes, pas de relance
   automatique des factures en retard (le statut bascule, personne n'est
   relancé) → recherche, exports CSV, et relances notifiées/e-mail.
10. **Messagerie sans recherche ni mentions** ; pièces jointes sans aperçu →
    recherche plein-texte, mentions, aperçus.
11. **Tout le texte est en français dans le code** → structure
    d'internationalisation prête (fr livré, ar/en préparables).
12. **Listes paginées sans virtualisation** sur les gros volumes → pages
    fluides même avec des milliers de lignes.
13. **Avancement de projet déclaré à la main** alors que les tâches permettent
    de le calculer → avancement calculé, valeur déclarée conservée comme
    override explicité.

---

## 12. Jeu de données de démarrage attendu

- Les sept rôles avec leurs permissions complètes ; un compte de démonstration
  par rôle (mots de passe **générés et affichés une fois** au lancement).
- Contenus publics : six services, trois packs (sans prix), quatre catégories
  et quatre études de cas, six questions de FAQ, quatre partenaires, trois
  témoignages dont un non publié.
- Un dossier complet et cohérent pour la démonstration : un client avec
  interlocuteurs, un projet avec membres, jalons, tâches et sous-tâches,
  saisies de temps et activité ; un devis accepté devenu projet, sa facture
  partiellement payée ; un devis en cours auprès d'un prospect ; une commande
  en ligne validée et une demande de projet en attente ; conversations et
  notifications alimentées ; quelques écritures d'audit.
- Tarifs de démonstration **saisis comme données d'exemple explicitement
  marquées**, jamais présentés comme des tarifs officiels du produit.

---

## 13. Critères d'acceptation (recette finale)

Coche et démontre chacun :

- [ ] Un visiteur anonyme lit tout le site public, même base vide, même API
      momentanément indisponible.
- [ ] Inscription → e-mail de vérification → connexion impossible avant
      vérification → connexion possible après.
- [ ] Mot de passe oublié : réponse identique pour un compte existant ou non ;
      lien à usage unique ; ancien lien invalide après usage.
- [ ] Demande de contact → conversion prospect → pipeline avec transitions
      refusées listant les sorties autorisées → conversion client.
- [ ] Devis : brouillon modifiable, envoyé figé, consulté tracé, accepté →
      client + projet créés, facture générable ; refus motivé définitif.
- [ ] Facture : envoi, encaissement partiel puis solde, statut dérivé à chaque
      étape, remboursement qui fait redescendre le statut, paiement au-delà du
      solde refusé.
- [ ] Commande en ligne depuis un compte algérien (DZD) et européen (EUR) ;
      pays sans tarif ni moyen de paiement → demande de projet avec le bon
      motif ; commande validée → projet créé.
- [ ] Un compte client ne voit **jamais** tâches internes, temps interne,
      documents internes, ni une ligne d'un autre client (y compris en forçant
      des identifiants dans les requêtes).
- [ ] Un développeur ne modifie que ses tâches assignées ; un chef de projet
      modifie toutes les tâches ; les deux voient exactement ce que leurs
      droits prévoient.
- [ ] Minuteur : démarrage, rechargement de page, arrêt → saisie de temps
      créée ; deux comptes simultanés indépendants.
- [ ] Messagerie : message reçu sans rechargement par l'autre participant ;
      déconnexion puis reconnexion → historique intact.
- [ ] Écriture d'un contenu public → site public à jour immédiatement.
- [ ] Suspension d'un compte → sessions fermées, connexion refusée, audit
      écrit ; dernier administrateur protégé.
- [ ] Journal d'audit : toute action sensible ci-dessus y figure, sans secret.
- [ ] Accessibilité : parcours clavier complet des trois surfaces ; préférence
      « réduire les animations » respectée.
- [ ] `LIMITES.md` liste honnêtement ce qui reste ouvert.

---

## 14. Format de ta réponse

1. **Plan** : architecture retenue et justification en une phrase par choix ;
   découpage en jalons.
2. **Code complet**, organisé, exécutable, commenté en français là où une
   règle métier se joue.
3. **Procédure de lancement** et jeu de données de démarrage.
4. **Preuves** : commandes de tests lancées et résultat, liste des critères
   d'acceptation cochés.
5. **LIMITES.md**.

Commence par reformuler le produit en dix lignes pour vérifier ta lecture,
puis enchaîne sans attendre de validation supplémentaire.
