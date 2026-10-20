# COMEXA — Inventaire de formation audité

Date : 20 octobre 2026. Source de vérité : routes et composants du dépôt, catalogue des permissions, politique serveur des espaces. Aucun accès réel de production n’a été utilisé.

## Périmètre et règles

- Accès : `backend/src/common/spaces/space-policy.ts`, `permissions.catalogue.ts`, `src/lib/access.js`, `space-navigation.js`, layouts des quatre espaces.
- Formation : `auth/onboarding.service.ts`, `src/lib/onboarding.mjs` et `onboarding-curriculum.mjs`.
- Les lignes ci-dessous décrivent les chapitres possibles, pas les attributions à imposer aux utilisateurs. Chaque session reçoit uniquement ses espaces serveur et les chapitres compatibles avec ses permissions effectives.
- Une procédure exige la présence du module consultable et ses conditions supplémentaires all/any/requiresAny. Les liens sont testés contre les véritables gardes de navigation. Un compte disposant seulement de droits d’écriture peut n’avoir aucune rubrique consultable : explication affichée, aucun lien inventé.
- Les espaces personnel et équipe disposent des outils de production ; Comexa ne monte ni minuteur ni Console. La commande client n’est proposée ni aux collaborateurs ni aux intégrations.

## Matrice des rôles du catalogue

Les nombres sont des chapitres distincts par espace, et non des écrans ou des obligations contractuelles. Les utilisateurs multirôles et à permissions personnalisées sont traités selon leurs droits, pas selon cette matrice illustrative.

| Rôle | Parcours et nombres de chapitres |
|---|---|
| ADMIN | Espace personnel : 24 ; Espace équipe : 59 ; Comexa Space : 46 |
| COMMUNICATION_MANAGER | Espace personnel : 24 ; Espace équipe : 28 ; Comexa Space : 34 |
| PROJECT_MANAGER | Espace personnel : 24 ; Espace équipe : 42 ; Comexa Space : 12 |
| DEVELOPER | Espace personnel : 24 ; Espace équipe : 25 |
| SOCIAL_MEDIA_MANAGER | Espace personnel : 24 ; Espace équipe : 25 |
| SALES | Espace personnel : 24 ; Espace équipe : 38 ; Comexa Space : 10 |
| CLIENT | Espace client : 22 |

## Inventaire des parcours, modules et contrôles d’accès

Le catalogue maximal ADMIN et le parcours CLIENT couvrent les quatre espaces. Chaque chapitre comprend une procédure, un exemple, un résultat attendu, les pièges et un contrôle de compréhension. Les quiz ne réalisent aucune opération métier.

### Espace personnel

**Objectif :** Retrouver ses tâches, organiser son agenda, enregistrer son temps et préparer son bilan personnel.

| Module / chapitre | Niveau | Route | Conditions supplémentaires de la procédure |
|---|---|---|---|
| Découvrir cet espace — Organiser sa journée et rendre compte du travail | notions | /espace-personnel/tableau-de-bord | Accès au module/espace selon navigation effective |
| Découvrir cet espace — Se repérer et retrouver l’aide | notions | /espace-personnel/tableau-de-bord | Accès au module/espace selon navigation effective |
| Découvrir cet espace — Utiliser la Console avec prudence | avance | /espace-personnel/tableau-de-bord | Accès au module/espace selon navigation effective |
| Ma journée — Lire les priorités et les indicateurs | notions | /espace-personnel/tableau-de-bord | Accès au module/espace selon navigation effective |
| Notifications — Traiter ses alertes sans perdre le contexte | notions | /espace-personnel/notifications | Accès au module/espace selon navigation effective |
| Notifications — Marquer une alerte comme lue ou la retirer | courant | /espace-personnel/notifications | tous : notification:manage:own |
| Mes tâches — Retrouver le travail de son périmètre | notions | /espace-personnel/taches | Accès au module/espace selon navigation effective |
| Mes tâches — Créer une tâche personnelle | courant | /espace-personnel/taches | tous : task:write:personal |
| Mes tâches — Organiser ses tâches par objectif | avance | /espace-personnel/taches | tous : task:read:personal, task:write:personal |
| Mes tâches — Terminer ou corriger une tâche personnelle | courant | /espace-personnel/taches | tous : task:read:personal, task:write:personal |
| Mon agenda — Consulter l’agenda et ses différentes sources | notions | /espace-personnel/calendrier | Accès au module/espace selon navigation effective |
| Mon agenda — Planifier un événement | courant | /espace-personnel/calendrier | tous : calendar:write:own ; au moins un : calendar:read:own, calendar:read:team |
| Mon temps — Relire sa feuille de temps et ses totaux | notions | /espace-personnel/temps | Accès au module/espace selon navigation effective |
| Mon temps — Saisir et corriger une durée | courant | /espace-personnel/temps | un parmi : time:write:any, time:write:own ; au moins un : task:read:any, task:read:assigned, task:read:own, task:read:personal ; au moins un : time:write:any, task:write:any, task:write:own, task:write:personal |
| Mon temps — Préparer un bloc de concentration | avance | /espace-personnel/temps | un parmi : time:write:own, time:write:any ; au moins un : task:read:personal, task:read:assigned, task:read:own, task:read:any ; au moins un : time:write:any, task:write:any, task:write:own, task:write:personal |
| Mon temps — Utiliser le minuteur sans doubler ses heures | avance | /espace-personnel/temps | un parmi : time:write:own, time:write:any ; au moins un : task:read:personal, task:read:assigned, task:read:own, task:read:any ; au moins un : time:write:any, task:write:any, task:write:own, task:write:personal |
| Mes rapports du jour — Consulter les bilans du jour | notions | /espace-personnel/rapports-journaliers | Accès au module/espace selon navigation effective |
| Mes rapports du jour — Rédiger le compte rendu de sa journée | courant | /espace-personnel/rapports-journaliers | tous : time:write:own |
| Mes rapports du jour — Préparer le rapport à partir du travail enregistré | avance | /espace-personnel/rapports-journaliers | tous : time:write:own ; au moins un : time:read:own, time:read:any ; au moins un : task:read:any, task:read:assigned, task:read:own, task:read:personal |
| Mon compte — Sécuriser son accès et comprendre son profil | notions | /espace-personnel/compte | Accès au module/espace selon navigation effective |
| Mon compte — Changer son mot de passe | sensible | /espace-personnel/compte | Accès au module/espace selon navigation effective |
| Mon compte — Fermer une session non reconnue | sensible | /espace-personnel/compte | Accès au module/espace selon navigation effective |
| Mon compte — Choisir la devise d’affichage sans convertir les données | courant | /espace-personnel/compte | Accès au module/espace selon navigation effective |
| Mon compte — Lier son Telegram personnel au bot | avance | /espace-personnel/compte | Accès au module/espace selon navigation effective |

### Espace équipe

**Objectif :** Suivre les dossiers partagés selon son périmètre : commerce, projets, production et pilotage.

| Module / chapitre | Niveau | Route | Conditions supplémentaires de la procédure |
|---|---|---|---|
| Découvrir cet espace — Coordonner le travail et le suivi commercial | notions | /espace-equipe/tableau-de-bord | Accès au module/espace selon navigation effective |
| Découvrir cet espace — Se repérer et retrouver l’aide | notions | /espace-equipe/tableau-de-bord | Accès au module/espace selon navigation effective |
| Découvrir cet espace — Utiliser la Console avec prudence | avance | /espace-equipe/tableau-de-bord | Accès au module/espace selon navigation effective |
| Tableau de bord — Lire les priorités et les indicateurs | notions | /espace-equipe/tableau-de-bord | Accès au module/espace selon navigation effective |
| Notifications — Traiter ses alertes sans perdre le contexte | notions | /espace-equipe/notifications | Accès au module/espace selon navigation effective |
| Notifications — Marquer une alerte comme lue ou la retirer | courant | /espace-equipe/notifications | tous : notification:manage:own |
| Contacts — Lire et qualifier le besoin avant le pipeline | notions | /espace-equipe/contacts | Accès au module/espace selon navigation effective |
| Contacts — Qualifier une demande reçue | courant | /espace-equipe/contacts | tous : contactrequest:write:any |
| Contacts — Transformer une demande en prospect | sensible | /espace-equipe/contacts | tous : contactrequest:convert:any |
| Prospects — Lire le pipeline et l’historique d’un prospect | notions | /espace-equipe/prospects | Accès au module/espace selon navigation effective |
| Prospects — Mettre à jour le pipeline commercial | courant | /espace-equipe/prospects | un parmi : prospect:write:any, prospect:write:own |
| Prospects — Convertir un prospect en client | sensible | /espace-equipe/prospects | tous : prospect:convert:any |
| Devis — Relire une proposition commerciale | notions | /espace-equipe/devis | Accès au module/espace selon navigation effective |
| Devis — Préparer un devis complet | courant | /espace-equipe/devis | tous : quote:write:any ; au moins un : client:read:any, prospect:read:any, prospect:read:own |
| Devis — Envoyer la proposition au client | sensible | /espace-equipe/devis | tous : quote:send:any |
| Devis — Créer une facture depuis un devis accepté | avance | /espace-equipe/devis | tous : invoice:write:any |
| Devis — Supprimer un devis | sensible | /espace-equipe/devis | tous : quote:delete:any |
| Factures — Contrôler facture, encaissements et reste dû | notions | /espace-equipe/factures | Accès au module/espace selon navigation effective |
| Factures — Émettre la facture | sensible | /espace-equipe/factures | tous : invoice:send:any |
| Factures — Enregistrer un encaissement réel | sensible | /espace-equipe/factures | tous : payment:write:any |
| Factures — Annuler une facture sans effacer son historique | sensible | /espace-equipe/factures | tous : invoice:write:any |
| Factures — Supprimer une facture | sensible | /espace-equipe/factures | tous : invoice:delete:any |
| Commandes — Lire la commande et son projet associé | notions | /espace-equipe/commandes | Accès au module/espace selon navigation effective |
| Demandes de projet — Lire une demande de projet sur mesure | notions | /espace-equipe/demandes | Accès au module/espace selon navigation effective |
| Demandes de projet — Traiter une demande de projet | courant | /espace-equipe/demandes | tous : project_request:manage:any |
| Clients — Retrouver un client sans créer de doublon | notions | /espace-equipe/clients | Accès au module/espace selon navigation effective |
| Projets — Lire l’état d’un projet et ses échéances | notions | /espace-equipe/projets | Accès au module/espace selon navigation effective |
| Projets — Mettre à jour le statut d’un projet | sensible | /espace-equipe/projets | tous : project:manage:status |
| Projets — Ajouter une tâche à un projet | courant | /espace-equipe/projets | un parmi : task:write:any, task:write:own ; au moins un : task:read:any, task:read:own, task:read:assigned |
| Projets — Confier une tâche à un membre | avance | /espace-equipe/projets | tous : task:assign:any ; un parmi : task:write:any, task:write:own ; au moins un : task:read:any, task:read:own, task:read:assigned |
| Projets — Ajouter un jalon | courant | /espace-equipe/projets | tous : milestone:read:any, milestone:write:any |
| Projets — Consulter les documents d’un projet | courant | /espace-equipe/projets | un parmi : document:read:any, document:read:own, document:read:client |
| Projets — Supprimer un document de projet | sensible | /espace-equipe/projets | tous : document:delete:any ; un parmi : document:read:any, document:read:own, document:read:client |
| Tâches — Retrouver le travail de son périmètre | notions | /espace-equipe/taches | Accès au module/espace selon navigation effective |
| Tâches — Faire avancer une tâche de projet | courant | /espace-equipe/taches | un parmi : task:write:any, task:write:own ; au moins un : project:read:any, project:read:assigned, project:read:own |
| Tâches — Créer une tâche depuis le tableau d’équipe | courant | /espace-equipe/taches | un parmi : task:write:any, task:write:own ; au moins un : project:read:any, project:read:own, project:read:assigned ; au moins un : task:read:any, task:read:own, task:read:assigned |
| Calendrier — Consulter l’agenda et ses différentes sources | notions | /espace-equipe/calendrier | Accès au module/espace selon navigation effective |
| Calendrier — Planifier un événement | courant | /espace-equipe/calendrier | tous : calendar:write:own ; au moins un : calendar:read:own, calendar:read:team |
| Suivi du temps — Relire sa feuille de temps et ses totaux | notions | /espace-equipe/temps | Accès au module/espace selon navigation effective |
| Suivi du temps — Corriger une saisie dans le suivi d’équipe | sensible | /espace-equipe/temps | un parmi : time:write:any, time:write:own |
| Rapports journaliers — Consulter les bilans du jour | notions | /espace-equipe/rapports-journaliers | Accès au module/espace selon navigation effective |
| Messagerie — Lire une conversation dans son contexte | notions | /espace-equipe/messagerie | Accès au module/espace selon navigation effective |
| Messagerie — Envoyer un message contextualisé | courant | /espace-equipe/messagerie | tous : message:write:own |
| Messagerie — Créer une conversation | avance | /espace-equipe/messagerie | tous : conversation:create:own |
| Messagerie — Joindre une ressource COMEXA à un message | avance | /espace-equipe/messagerie | tous : message:write:own ; un parmi : project:read:any, project:read:own, project:read:assigned, task:read:any, task:read:own, task:read:assigned, task:read:personal, client:read:any, quote:read:any, quote:read:own, invoice:read:any, invoice:read:own, document:read:any, document:read:own, document:read:client |
| Demandes de modification — Suivre les ajustements demandés | notions | /espace-equipe/modifications | Accès au module/espace selon navigation effective |
| Demandes de modification — Arbitrer une demande de modification | sensible | /espace-equipe/modifications | tous : modificationrequest:decide:any |
| Analytique — Interpréter les analyses sur 30 jours | notions | /espace-equipe/analytique | Accès au module/espace selon navigation effective |
| Répartition & soldes — Comprendre les relevés accessibles | notions | /espace-equipe/repartition | Accès au module/espace selon navigation effective |
| Répartition & soldes — Configurer une règle de répartition | avance | /espace-equipe/repartition | tous : distribution:read:any, distribution:manage:any, project:read:any |
| Répartition & soldes — Vérifier un calcul avant de l’appliquer | sensible | /espace-equipe/repartition | tous : distribution:read:any, distribution:manage:any ; un parmi : project:read:any, project:read:assigned |
| Répartition & soldes — Enregistrer et contrepasser une opération de solde | sensible | /espace-equipe/repartition | tous : balance:manage:any ; un parmi : balance:read:any, balance:read:own |
| Rapports — Retrouver un rapport et lire son résultat | notions | /espace-equipe/rapports | Accès au module/espace selon navigation effective |
| Rapports — Générer un rapport exploitable | avance | /espace-equipe/rapports | tous : report:generate:any |
| Mon compte — Sécuriser son accès et comprendre son profil | notions | /espace-equipe/compte | Accès au module/espace selon navigation effective |
| Mon compte — Changer son mot de passe | sensible | /espace-equipe/compte | Accès au module/espace selon navigation effective |
| Mon compte — Fermer une session non reconnue | sensible | /espace-equipe/compte | Accès au module/espace selon navigation effective |
| Mon compte — Choisir la devise d’affichage sans convertir les données | courant | /espace-equipe/compte | Accès au module/espace selon navigation effective |
| Mon compte — Lier son Telegram personnel au bot | avance | /espace-equipe/compte | Accès au module/espace selon navigation effective |

### Comexa Space

**Objectif :** Maintenir l’organisation, ses contenus publics et ses accès sans confondre lecture et administration.

| Module / chapitre | Niveau | Route | Conditions supplémentaires de la procédure |
|---|---|---|---|
| Découvrir cet espace — Administrer les contenus et les accès | notions | /espace-comexa/tableau-de-bord | Accès au module/espace selon navigation effective |
| Découvrir cet espace — Se repérer et retrouver l’aide | notions | /espace-comexa/tableau-de-bord | Accès au module/espace selon navigation effective |
| Vue d’ensemble — Lire les priorités et les indicateurs | notions | /espace-comexa/tableau-de-bord | Accès au module/espace selon navigation effective |
| Notifications — Traiter ses alertes sans perdre le contexte | notions | /espace-comexa/notifications | Accès au module/espace selon navigation effective |
| Notifications — Marquer une alerte comme lue ou la retirer | courant | /espace-comexa/notifications | tous : notification:manage:own |
| Contenu du site — Comprendre les contenus du site | notions | /espace-comexa/contenu | Accès au module/espace selon navigation effective |
| Contenu du site — Consulter : Services | notions | /espace-comexa/contenu | tous : service:read:any |
| Contenu du site — Créer ou modifier : Services | courant | /espace-comexa/contenu | tous : service:read:any, service:write:any |
| Contenu du site — Contrôler la publication : Services | sensible | /espace-comexa/contenu | tous : service:read:any, service:write:any |
| Contenu du site — Retirer : Services | sensible | /espace-comexa/contenu | tous : service:read:any, service:write:any |
| Contenu du site — Consulter : Packs et tarifs | notions | /espace-comexa/contenu | tous : package:read:any |
| Contenu du site — Créer ou modifier : Packs et tarifs | courant | /espace-comexa/contenu | tous : package:read:any, package:write:any |
| Contenu du site — Contrôler la publication : Packs et tarifs | sensible | /espace-comexa/contenu | tous : package:read:any, package:write:any |
| Contenu du site — Retirer : Packs et tarifs | sensible | /espace-comexa/contenu | tous : package:read:any, package:write:any |
| Contenu du site — Consulter : Témoignages | notions | /espace-comexa/contenu | tous : testimonial:read:any |
| Contenu du site — Créer ou modifier : Témoignages | courant | /espace-comexa/contenu | tous : testimonial:read:any, testimonial:write:any |
| Contenu du site — Contrôler la publication : Témoignages | sensible | /espace-comexa/contenu | tous : testimonial:read:any, testimonial:moderate:any |
| Contenu du site — Retirer : Témoignages | sensible | /espace-comexa/contenu | tous : testimonial:read:any, testimonial:write:any |
| Contenu du site — Consulter : Partenaires | notions | /espace-comexa/contenu | tous : partner:read:any |
| Contenu du site — Créer ou modifier : Partenaires | courant | /espace-comexa/contenu | tous : partner:read:any, partner:write:any |
| Contenu du site — Contrôler la publication : Partenaires | sensible | /espace-comexa/contenu | tous : partner:read:any, partner:write:any |
| Contenu du site — Retirer : Partenaires | sensible | /espace-comexa/contenu | tous : partner:read:any, partner:write:any |
| Contenu du site — Consulter : Questions fréquentes | notions | /espace-comexa/contenu | tous : faq:read:any |
| Contenu du site — Créer ou modifier : Questions fréquentes | courant | /espace-comexa/contenu | tous : faq:read:any, faq:write:any |
| Contenu du site — Contrôler la publication : Questions fréquentes | sensible | /espace-comexa/contenu | tous : faq:read:any, faq:write:any |
| Contenu du site — Retirer : Questions fréquentes | sensible | /espace-comexa/contenu | tous : faq:read:any, faq:write:any |
| Contenu du site — Ajouter un tarif daté à un pack | sensible | /espace-comexa/contenu | tous : package:read:any, package:write:any |
| Membres et droits — Lire les comptes et leurs accès | notions | /espace-comexa/membres | Accès au module/espace selon navigation effective |
| Membres et droits — Créer un compte et transmettre son accès | sensible | /espace-comexa/membres | tous : user:manage:any, role:read:any |
| Membres et droits — Modifier les rôles et suspendre un compte | sensible | /espace-comexa/membres | tous : user:manage:any, role:read:any |
| Rôles et permissions — Comprendre les périmètres des permissions | notions | /espace-comexa/roles | Accès au module/espace selon navigation effective |
| Rôles et permissions — Ajuster les permissions d’un rôle | sensible | /espace-comexa/roles | tous : role:manage:any, permission:read:any |
| API & Intégrations — Inventorier les accès des intégrations | notions | /espace-comexa/integrations | Accès au module/espace selon navigation effective |
| API & Intégrations — Créer un jeton d’intégration limité | sensible | /espace-comexa/integrations | tous : integration:manage:any, permission:read:any |
| API & Intégrations — Renouveler ou révoquer un jeton | sensible | /espace-comexa/integrations | tous : integration:manage:any, integration:read:any |
| Journal d’audit — Retrouver une opération dans l’audit | notions | /espace-comexa/journal | Accès au module/espace selon navigation effective |
| Paramètres — Identifier le bon réglage et son périmètre | notions | /espace-comexa/parametres | Accès au module/espace selon navigation effective |
| Paramètres — Mettre à jour les informations de l’organisation | sensible | /espace-comexa/parametres | tous : setting:write:any |
| Paramètres — Modifier une clé JSON existante | avance | /espace-comexa/parametres | tous : setting:write:any |
| Paramètres — Tenir le référentiel des devises | avance | /espace-comexa/parametres | tous : currency:read:any, currency:manage:any |
| Paramètres — Lire et enregistrer un taux de change daté | sensible | /espace-comexa/parametres | tous : exchangerate:read:any, exchangerate:manage:any, currency:read:any |
| Mon compte — Sécuriser son accès et comprendre son profil | notions | /espace-comexa/compte | Accès au module/espace selon navigation effective |
| Mon compte — Changer son mot de passe | sensible | /espace-comexa/compte | Accès au module/espace selon navigation effective |
| Mon compte — Fermer une session non reconnue | sensible | /espace-comexa/compte | Accès au module/espace selon navigation effective |
| Mon compte — Choisir la devise d’affichage sans convertir les données | courant | /espace-comexa/compte | Accès au module/espace selon navigation effective |
| Mon compte — Lier son Telegram personnel au bot | avance | /espace-comexa/compte | Accès au module/espace selon navigation effective |

### Espace client

**Objectif :** Exprimer son besoin, suivre ses demandes et consulter les documents de son propre dossier.

| Module / chapitre | Niveau | Route | Conditions supplémentaires de la procédure |
|---|---|---|---|
| Découvrir cet espace — Préparer et suivre sa relation avec COMEXA | notions | /espace-client | Accès au module/espace selon navigation effective |
| Découvrir cet espace — Se repérer et retrouver l’aide | notions | /espace-client | Accès au module/espace selon navigation effective |
| Mon espace — Retrouver le suivi de son dossier | notions | /espace-client | Accès au module/espace selon navigation effective |
| Tableau de bord — Lire les priorités et les indicateurs | notions | /espace-client/tableau-de-bord | Accès au module/espace selon navigation effective |
| Mes devis — Relire une proposition commerciale | notions | /espace-client | Accès au module/espace selon navigation effective |
| Mes devis — Accepter ou refuser une proposition | sensible | /espace-client | tous : quote:accept:own |
| Mes projets — Lire l’état d’un projet et ses échéances | notions | /espace-client | Accès au module/espace selon navigation effective |
| Mes projets — Consulter les documents d’un projet | courant | /espace-client | un parmi : document:read:any, document:read:own, document:read:client |
| Mes factures — Contrôler facture, encaissements et reste dû | notions | /espace-client/factures | Accès au module/espace selon navigation effective |
| Commander un pack — Comprendre offre, commande et demande d’étude | notions | /espace-client/commander | Accès au module/espace selon navigation effective |
| Commander un pack — Choisir un pack ou demander un projet sur mesure | courant | /espace-client/commander | Accès au module/espace selon navigation effective |
| Demandes de modification — Suivre les ajustements demandés | notions | /espace-client/modifications | Accès au module/espace selon navigation effective |
| Demandes de modification — Demander une modification de son projet | courant | /espace-client/modifications | tous : modificationrequest:write:own ; un parmi : project:read:own, project:read:assigned, project:read:any |
| Messagerie — Lire une conversation dans son contexte | notions | /espace-client/messagerie | Accès au module/espace selon navigation effective |
| Messagerie — Envoyer un message contextualisé | courant | /espace-client/messagerie | tous : message:write:own |
| Messagerie — Joindre une ressource COMEXA à un message | avance | /espace-client/messagerie | tous : message:write:own ; un parmi : project:read:any, project:read:own, project:read:assigned, task:read:any, task:read:own, task:read:assigned, task:read:personal, client:read:any, quote:read:any, quote:read:own, invoice:read:any, invoice:read:own, document:read:any, document:read:own, document:read:client |
| Notifications — Traiter ses alertes sans perdre le contexte | notions | /espace-client/notifications | Accès au module/espace selon navigation effective |
| Notifications — Marquer une alerte comme lue ou la retirer | courant | /espace-client/notifications | tous : notification:manage:own |
| Mon compte — Sécuriser son accès et comprendre son profil | notions | /espace-client/compte | Accès au module/espace selon navigation effective |
| Mon compte — Changer son mot de passe | sensible | /espace-client/compte | Accès au module/espace selon navigation effective |
| Mon compte — Fermer une session non reconnue | sensible | /espace-client/compte | Accès au module/espace selon navigation effective |
| Mon compte — Choisir la devise d’affichage sans convertir les données | courant | /espace-client/compte | Accès au module/espace selon navigation effective |

## Audit des workflows et limites fonctionnelles constatées

| Domaine | Points confirmés dans le code / limites respectées |
|---|---|
| Tâches / objectifs | Tâche personnelle privée, tâches de projet, responsable distinct du créateur, visibilité client, échéance, statut, suppression confirmée ; retirer un objectif ne supprime pas ses tâches. |
| Projets / clients | Lecture, détail et actions existantes ; pas de création de projet ou client inventée depuis les listes. Les tâches se créent aussi dans un projet autorisé. |
| Documents | Consultation et suppression selon droits ; aucun dépôt de fichier enseigné : formulaire de dépôt absent. Les relations financières restent conservées par la suppression historique. |
| Agenda / temps | Périmètre personnel ou partagé ; saisie et corrections propres distinctes des corrections d’équipe ; minuteur et concentration utilisent le même compteur ; abandon sans sauvegarde. |
| Rapports journaliers | Date, résumé limité à 280 caractères, éditeur, enregistrement explicite ; auto-remplir prépare mais ne sauvegarde pas. |
| Prospection | Refus/perte avec motif d’au moins trois caractères ; verrouillages après conversion. |
| Devis | Brouillon, lignes/remises/taxes, PDF et envoi distincts ; conversion d’un devis accepté avec droit d’écriture facture. |
| Factures / paiements | Montant positif et inférieur ou égal au restant dû, devise de facture ; suppression conservant les relations et l’historique selon règles existantes. |
| Commandes / demandes | Parcours client réel et suivi équipe ; endpoint PATCH de statut de commande absent, aucune procédure de changement de statut prétendue. |
| Modifications | Création client et décision équipe distinctes ; motif de décision lisible par le client, notes internes de demande de projet distinctes. |
| Membres / rôles | Édition réservée aux droits effectifs ; changer un rôle affecte tous ses porteurs ; ne pas présenter ces actions aux profils lecteurs. |
| Catalogue public | Packs et services via formulaires existants ; témoignage publié après modération ; aucune édition d’étude de cas inventée si l’UI est absente. |
| Tarifs / répartition | Tarifs datés, désactivation et historique ; répartition consultée dans l’équipe et non dans un panneau Comexa fictif. |
| Intégrations / audit | Jeton à révélation unique, permissions minimales, expiration/révocation ; journal de consultation et filtres selon lecture autorisée. |
| Mon compte / Telegram | Mot de passe de 12 caractères minimum, sessions, statut personnel Telegram et code temporaire /lier ; connexion réelle au bot non vérifiée dans cet environnement. |
| Notifications / messagerie | Conversation et pièces de référence selon ressources lisibles ; effacer une notification n’efface pas la donnée métier. |
| Console | Panneau confirmé, nouvelle session et messages ; webhook n8n externe non vérifié. Aucune promesse de capacité métier de l’agent distant. |

Les procédures détaillées et leurs champs sont dans le catalogue français chargé par le guide, plutôt que dans une copie documentaire qui dériverait. Les formulaires/API et leurs validations demeurent la référence.
