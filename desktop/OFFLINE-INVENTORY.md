# Inventaire fonctionnel du dashboard et couverture hors ligne actuelle

Cet inventaire vient des routes sous `src/app/(session)`, des composants
`src/components/dashboard`, `src/components/workspace`, des usages de
`useListing`, `useAllListing`, `useObject`, `useAuth().request`, des contrôleurs
NestJS sous `backend/src/modules` et des modèles Prisma.

## Écrans et données nécessaires

| Espace / routes | Fonctions et données principales |
| --- | --- |
| Hub `/espaces` | Espaces disponibles, préférences de navigation, profil/droits. |
| Personnel `/espace-personnel` | `/tableau-de-bord` : tâches, objectifs et indicateurs ; `/taches` : tâches personnelles/assignées, statuts et objectifs ; `/calendrier` : événements, tâches, projets visibles ; `/temps` : saisies et minuteurs ; `/rapports-journaliers` : tâches terminées et rapports ; `/notifications` : boîte, compteurs, accusés de lecture ; `/compte` : profil et préférences. |
| Équipe `/espace-equipe` | `/tableau-de-bord`, `/analytique` : agrégats, membres, projets, tâches, devis, factures, commandes ; `/calendrier` ; `/taches` ; `/projets` et `/projets/[id]` : projets, membres, jalons, tâches, documents, demandes ; `/prospects` et `/prospects/[id]` : prospects, historique, devis ; `/clients` et `/clients/[id]` : clients, contacts, projets, factures ; `/commandes` et `/commandes/[id]` ; `/devis`, `/devis/nouveau`, `/devis/[id]` : devis et lignes ; `/factures`, `/factures/[id]` : factures, lignes, échéances, paiements ; `/temps` ; `/rapports`, `/rapports-journaliers` ; `/repartition` : règles, bénéficiaires, distributions, soldes ; `/demandes`, `/contacts`, `/modifications` ; `/messagerie` et ressources partagées ; `/notifications` ; `/compte`. |
| Comexa `/espace-comexa` | `/tableau-de-bord` : KPI ; `/contenu` : services, packs/tarifs, témoignages, partenaires, FAQ ; `/membres` et `/roles` : utilisateurs, rôles et permissions ; `/integrations` : jetons et liaisons externes ; `/journal` : activité/audit ; `/parametres` : devises, taux, configuration ; `/compte` ; `/notifications`. |
| Client `/espace-client` | `/tableau-de-bord` : projet, factures, devis, notifications ; `/projets/[id]` : jalons, livrables et demandes ; `/commander` : packs/tarifs/commandes ; `/factures` ; `/devis/[id]` : lecture/acceptation/refus ; `/messagerie` ; `/modifications` ; `/notifications` ; `/compte`. |
| Authentification | `/connexion`, `/inscription`, `/mot-de-passe-oublie`, `/reset-password`, `/verify-email` ; les opérations d'inscription, récupération, changement de mot de passe et vérification par courriel exigent le serveur. |

## Domaines et relations persistantes observés

Le backend comporte notamment les domaines auth/utilisateurs/rôles, espaces,
clients/contacts/prospects, commandes/forfaits/tarifs/demandes, projets/membres/
jalons/tâches, calendrier, saisie de temps/minuteurs/objectifs, rapports,
devis/lignes, factures/lignes/paiements, documents, devises/taux de change,
distributions/règles/bénéficiaires/soldes, messagerie/conversations/messages/
ressources, notifications, contenu public, paramètres, audit/activité,
intégrations (dont Telegram), PDF.

Les relations métier déterminantes incluent :

- un `User` porte rôles/permissions, peut être un client lié à `Client`, créateur,
  responsable, destinataire ou auteur d'activité ;
- `Order` relie compte, client, forfait/tarif et éventuellement projet ;
- `Project` relie client, équipe, jalons, tâches, documents, devis et factures ;
- `Task` peut être personnelle ou reliée à projet/jalon/tâche parente, assignée,
  et reliée aux saisies de temps/rapports/objectifs ;
- `Quote` possède des lignes, peut viser un prospect puis un client, et peut
  produire projet/facture ;
- `Invoice` possède des lignes, appartient à un client et peut référencer projet/
  devis ; ses paiements déterminent `amountPaid` ;
- `Payment` peut référencer un document justificatif et génère des écritures de
  solde ;
- les distributions créent des transactions de solde ; les messages peuvent
  référencer des ressources métier et accusés de lecture.

Ces relations interdisent un rejeu générique aveugle : des IDs, références,
séquences annuelles, autorisations, transitions d'état et transactions sont
attribués/vérifiés côté serveur.

## Couverture offline-first actuelle

Le cache GET est chiffré par compte/espace/URL et alimenté uniquement par des
réponses serveur réussies. Il est plafonné à 1 000 entrées et 128 Mio par compte.
La file d'écriture persistante est chiffrée dans la même base SQLite, ordonnée,
plafonnée à 10 000 opérations et 64 Mio par compte. Les créations ont des IDs
locaux stables ; les opérations dépendantes sont rejouées après résolution des
IDs serveur. Une première authentification en ligne est obligatoire pour ouvrir
les données offline ; aucun mot de passe clair n'est stocké.

| Domaine / module existant | Hors ligne : opérations en file | À la reconnexion / limites |
| --- | --- | --- |
| Projets, tâches, jalons | Création, modification, suppression ; tâches personnelles et saisies de temps | Rejeu séquentiel, dépendances/IDs locaux, contrôle serveur des droits ; version `If-Match` sur les modèles versionnés concernés. |
| Objectifs, associations tâches-objectifs, calendrier personnel, temps | Création, modification, suppression et rattachement/retrait d'une tâche à un objectif personnel dans les routes API allowlistées | Comparaison du snapshot de base ; conflits conservés pour résolution explicite. |
| Rapports journaliers | `PUT` par date et suppression | Overlay local par date ; les conflits sont préservés. |
| Clients et contacts | Création/modification/suppression selon les routes clients et contacts présentes | Permissions backend revalidées ; les refus restent visibles dans la file. |
| Prospects | Création, modification, statut, suppression | Même rejeu idempotent et contrôle de permissions. |
| Rapports | Mise en file des demandes de génération (`POST /reports`) | Le rapport généré n'existe qu'après confirmation du serveur ; l'élément local reste marqué en attente. |
| Documents | Modification des métadonnées et suppression | **Pas** de transfert de fichier offline ; une pièce jointe doit être téléversée en ligne. |
| Notifications | Accusé de lecture et suppression des notifications dans les routes prévues | Overlay local ; les compteurs agrégés peuvent rester ceux du dernier cache. |
| Auth, utilisateurs/rôles, devis/factures/paiements, commandes/demandes, distributions/soldes, contenu/paramètres, intégrations, messagerie, audit et modules restants | Lecture seule depuis le cache précédemment obtenu ; mutations non allowlistées refusées sans prétendre avoir réussi | Première visite en ligne requise pour le cache. Emails, intégrations, WebSocket et opérations de sécurité restent côté serveur. |

Avant chaque rejeu, le client confirme la session via `/auth/me`, rafraîchit les
vues cachées et compare les champs modifiés au snapshot local. Les champs locaux
inchangés depuis leur snapshot peuvent fusionner ; sinon les deux versions sont
conservées avec un diff et une résolution explicite. Pour les modèles supportés,
`If-Match` ajoute un contrôle de version côté backend. Le backend réserve chaque
clé d'idempotence avant exécution, rejoue la réponse confirmée et bloque une clé
dont l'issue serveur est incertaine au lieu de risquer un doublon. Les refus 4xx
restent dans la file et sont exposés dans l'interface ; ils ne sont pas effacés.

Le cache reste « à la première visite » : aucune prépopulation exhaustive ni
curseur de changements distants. Les opérations non autorisées par allowlist,
les documents binaires/PDF, uploads, téléchargements protégés et ressources
jamais consultées en ligne ne sont pas disponibles hors connexion. Une réservation
serveur laissée en cours par un crash nécessite une réconciliation manuelle ; le
rejeu est bloqué par sécurité et le client affiche l'opération à vérifier.

## Validation réalisée et restante

- Desktop : `npm test` — **15/15** tests réussis (chiffrement, redémarrage,
  migrations, outbox, dépendances/IDs locaux, conflits, filtres, permissions,
  contacts et demandes de rapports).
- Frontend : `npm run lint` et `npm run build` réussis.
- Backend : Prettier et ESLint des fichiers modifiés réussis. `npm run build`
  demeure non validé : le checkout ne contient pas le client Prisma généré
  (`backend/src/generated/prisma`), et la génération Prisma antérieure a échoué
  au téléchargement du moteur TLS ; le build a donc rapporté des erreurs en
  cascade de types/modèles manquants. Aucune migration de schéma n'est requise
  par cette tranche.
- Les « 14 scénarios » d'acceptation ne sont pas présents dans le dépôt retrouvé ;
  aucun test réel contre un backend/base intégrés, ni installeur Windows, n'a été
  exécuté. Les tests outbox utilisent le stockage chiffré réel du client, mais
  des scénarios backend idempotence/concurrence doivent encore être ajoutés.

## Inventaire backend des contrôleurs consultés

`auth`, `users`, `roles`, `spaces`, `dashboard`, `activity`, `audit-log`,
`clients`/`contacts`, `prospects`, `orders`/`package-rates`/`project-requests`,
`projects`, `milestones`, `tasks`, `calendar`, `time-entries`, `timer`,
`daily-reports`, `goals`, `reports`, `quotes`, `invoices`, `payments`,
`documents`, `pdf`, `messaging`/`shared-resources`, `notifications`, `content`,
`currencies`, `exchange-rates`, `distributions`, `balances`, `settings`,
`integrations` et `telegram-link`.
