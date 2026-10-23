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

## Couverture implémentée dans cette étape

Tous les appels JSON GET authentifiés qui passent par `useAuth().request` sont
cachés par compte, espace, chemin et query string après succès serveur. Lorsqu'un
appel suivant échoue pour raison réseau/passerelle, sa copie est relue depuis le
fichier local SQLite chiffré, si elle a déjà été consultée. Cela inclut les listes,
détails et indicateurs dont les composants utilisent cette couche commune.

Ne sont **pas** garantis sans première visite en ligne : données des autres pages,
autres paramètres de recherche/pagination, données récemment ajoutées ou rôles
modifiés. Il n'y a pas de snapshot de synchronisation global ni de curseur
serveur.

Les écritures sont explicitement refusées en mode hors ligne avec un message
indiquant qu'aucun changement n'a été enregistré. `fetchProtectedBlob`, PDF,
téléchargements, WebSocket, emails et intégrations ne sont pas mis en cache.

## Inventaire backend des contrôleurs consultés

`auth`, `users`, `roles`, `spaces`, `dashboard`, `activity`, `audit-log`,
`clients`/`contacts`, `prospects`, `orders`/`package-rates`/`project-requests`,
`projects`, `milestones`, `tasks`, `calendar`, `time-entries`, `timer`,
`daily-reports`, `goals`, `quotes`, `invoices`, `payments`, `documents`, `pdf`,
`messaging`/`shared-resources`, `notifications`, `content`, `currencies`,
`exchange-rates`, `distributions`, `balances`, `settings`, `integrations` et
`telegram-link`.

Le cache central couvre les GET JSON de ces contrôleurs sans remplacer leur
contrôle d'accès serveur. Aucun endpoint d'écriture hors ligne ni contrat serveur
de réplication n'est encore livré dans cette étape.
