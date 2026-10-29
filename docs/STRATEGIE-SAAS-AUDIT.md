# Comexa Portfolio → deux produits : audit du code et première approche

Date : 27 octobre 2026.
Objet : analyse de la proposition « Comexa Personnel gratuit + Comexa Entreprise payant »
au regard de **ce que le dépôt contient réellement**, puis proposition d'un premier
chantier. Document de décision, pas de code modifié.

---

## 1. Verdict en une phrase

La direction proposée est bonne, mais elle est rédigée comme si Comexa partait de
zéro. Le dépôt est **déjà un ERP d'agence interne très avancé et mono-organisation**
(66 modèles Prisma, 25 migrations, 4 espaces, web + desktop + Android, audit,
permissions fines, facturation, répartition des soldes). Le risque n'est donc pas
« il manque des fonctionnalités » : c'est **vouloir vendre un logiciel mono-locataire
comme un SaaS multi-entreprises**. La première décision à prendre n'est pas « quel
module coder », c'est « quel est le modèle de locataire et d'abonnement ».

---

## 2. Ce que le dépôt possède déjà (et que la proposition propose de « développer »)

| Élément de la proposition | État réel dans le code |
| --- | --- |
| Espace personnel | Existant : `src/app/(session)/espace-personnel/*` (tableau de bord « Ma journée », tâches, calendrier, temps, rapports journaliers, compte). |
| Cockpit quotidien | Existant : `src/components/dashboard/PersonalDashboard.jsx` — retards, échéances du jour, 6 tâches prioritaires, agenda 7 jours, temps saisi semaine/jour, objectifs. |
| Mode concentration | Existant : `src/components/focus/*` + `TimerSession` + minuteur **serveur** (le décompte survit au rechargement, le temps finit dans `TimeEntry`). Voir `README.md`. |
| Objectifs découpés en étapes | Existant : `Goal`, `GoalTask` (un objectif regroupe des tâches personnelles **et** des tâches de projet sans rien écrire sur la tâche partagée). |
| Séparation privé / équipe | Partiellement existante et bien faite : `Task.isPersonal`, `CalendarEvent.visibility`, `PERSONAL_ONLY` et `PERSONAL_KEEP` dans `backend/src/common/spaces/space-policy.ts`, `X-Comexa-Space` appliqué par le garde JWT. |
| Bilan intelligent (prévu vs réel, reports, distractions) | **Absent.** `DailyReport` = un `contentJson` libre + un résumé de 280 caractères (`backend/src/modules/daily-reports/`). Aucune comparaison prévu/réel, aucune détection de reports, aucune vue hebdo. C'est le vrai trou produit. |
| Deux parcours de présentation | Absent : pages publiques = `/`, `/services`, `/realisations`, `/partenaires`, `/contact`, `/espaces/apercu`. Pas de page tarifs, pas de CTA « essayer gratuitement ». |
| Essai 14 jours, abonnement, permissions payantes | **Absent totalement** : aucun modèle `Plan`, `Subscription`, `Trial`, `Seat`, `Entitlement`. Les `Invoice` / `Quote` / `Payment` du dépôt sont la facturation **des prestations de Comexa**, pas des abonnements SaaS. Aucun PSP (Stripe, Chargily, SATIM) branché. |

À noter : une console IA existe déjà (`src/app/api/agent-chat`, `AiAgentDrawer`).
Le « bilan » doit donc être **déterministe et calculé sur les données**, exactement
comme le recommande la proposition — l'IA générique n'est pas le différenciateur.

---

## 3. Les cinq écarts bloquants entre la vision et le code

### 3.1 Un inscrit gratuit ne peut pas ouvrir l'espace personnel

`RegisterDto` n'accepte aucun rôle (`backend/src/modules/auth/dto/registration.dto.ts`) ;
`AuthService.register()` crée un `User` **sans rôle**
(`backend/src/modules/auth/auth.service.ts`). Or :

- `canEnterSpace()` exige `isTeamMember()`, c'est-à-dire au moins un rôle ≠ `CLIENT`
  (`backend/src/common/spaces/space-policy.ts`) ;
- `homeFor()` renvoie tout compte non-équipe vers `/espace-client` (`src/lib/access.js`) ;
- le rôle `CLIENT` n'est attribué qu'**à la première commande**, quand `orders.service.ts`
  crée la fiche `Client` ;
- `CLIENT` n'a aucune permission `task:*`, `time:*`, `calendar:*`
  (`permissions.catalogue.ts`). Tous les widgets de `PersonalDashboard` sont donc
  masqués pour lui.

**Conséquence : aujourd'hui « gratuit pour toujours » = un portail client vide avec
ses devis et ses factures.** C'est le premier truc à corriger, et c'est peu coûteux
(un rôle + quelques entrées de catalogue + 3 fonctions de politique d'espace).

### 3.2 Aucune notion d'organisation / de locataire

Recherche sur tout `backend/src`, `prisma/` et `src/` : **zéro** `organizationId`,
`workspaceId`, `tenantId`. Les 7 rôles (`RoleCode`) et les permissions sont
**globaux à l'instance**. Les « espaces » ne sont qu'une restriction contextuelle
des droits portée par un en-tête HTTP — le commentaire de `space-policy.ts` le dit
explicitement : « aucune table nouvelle, aucune donnée dupliquée, aucune migration ».

Donc :

- la séparation **données personnelles ↔ données de l'équipe** est faite (au niveau
  de l'utilisateur, proprement) ;
- la séparation **entreprise A ↔ entreprise B** n'existe pas. Deux entreprises
  clientes dans la même base partageraient le même « espace équipe » et les mêmes
  portées `*:read:any`. **C'est un risque de confidentialité, pas un détail de
  paramétrage.**

C'est le point que la proposition formule (« séparer les données ») sans voir que
la moitié du travail est déjà faite et que l'autre moitié est un chantier lourd.
Le multi-tenant touchera ~20 tables (Project, Client, Quote, Invoice, Order, Task
non personnelles, Document, Conversation, …), tous les services qui passent par
`AccessPolicy`, et les gardes.

### 3.3 Aucune couche commerciale

Pas de plan, pas d'abonnement, pas d'essai, pas de « lecture seule après
expiration ». `PaymentMethod` contient `CASH`, `CCP`, `BARIDIMOB`,
`BANK_TRANSFER`, `CARD` ; `render.yaml` fixe `PAYMENT_METHODS_DZD=BANK_TRANSFER,CASH`.
Autrement dit : la facturation actuelle est **manuelle et orientée prestations**,
ce qui est une bonne nouvelle pour des pilotes, mais un projet entier pour du
self-serve.

Le mode « lecture seule après l'essai » devra être appliqué **côté serveur sur
toutes les écritures**, pas seulement dans l'UI. La bonne nouvelle : l'architecture
de gardes (`JwtAuthGuard`, `AccessPolicy`, integration tokens, idempotence) est
solide et permet d'ajouter un `SubscriptionGuard` proprement.

### 3.4 L'infrastructure n'est pas encore un service payant

- `render.yaml` : backend sur le plan **free**, « s'endort après 15 min ». Incompatible
  avec un engagement de service, même pour 3 pilotes.
- `EMAIL_VERIFICATION_REQUIRED: "false"` en production (« veille »). Ouvrir les
  inscriptions à des inconnus sans verification e-mail = comptes jetables et abus.
- Rate limit global 120 req/min, sans protection spécifique à l'inscription.
- Tests automatisés très fins (3 fichiers de test hors desktop) ; aucun test
  retrouvé pour `effectivePermissions` / `canEnterSpace` alors que le commentaire
  de `space-policy.ts` les annonce « testés à l'unité ». À corriger **avant** de
  toucher à la politique d'accès.

### 3.5 Le gratuit a un coût, et la cible « étudiant » n'est pas le client payant

Le rapport ChartMogul/ProductLed (200 produits B2B, janvier 2026) confirme le
chiffre cité — 62 % des essais durent 14 jours — mais il apporte surtout deux
nuances : le taux médian de conversion free→paid est de **8 %**, et **80 % des
produits à essai gratuit gardent un contact humain** quand une entreprise entre
dans l'essai [1](https://chartmogul.com/reports/saas-conversion-report/). Le rapport
note aussi que garder des utilisateurs gratuits coûte de plus en plus cher dès qu'il
y a de l'IA derrière [1](https://chartmogul.com/reports/saas-conversion-report/).

Conclusion : il ne faut pas attendre une conversion automatique étudiant → PME.
Le gratuit sert la **rétention, la marque et la distribution** ; l'acquisition B2B
viendra du réseau de Comexa et de pilotes accompagnés.

---

## 4. Ce que je répondrais à ChatGPT (message prêt à copier)

> Merci, le cadre est bon et je le garde : produit personnel réellement utile,
> entreprise payante, essai sans carte, facturation à l'organisation, deux
> parcours de présentation. J'ai vérifié ton chiffre ChartMogul : il est exact
> (étude de janvier 2026 sur 200 produits, 62 % d'essais de 14 jours). Le même
> rapport dit aussi que la conversion médiane free→paid est de 8 % et que 80 %
> des essais B2B gardent un accompagnement humain — donc je ne tablerai pas sur
> du 100 % self-serve.
>
> En revanche, ton analyse suppose qu'on part de zéro. J'ai audité le dépôt :
> l'espace personnel existe déjà (cockpit « Ma journée », tâches privées,
> agenda, objectifs, minuteur serveur, mode concentration, rapports du jour),
> ainsi qu'un ERP d'agence complet (projets, devis, factures, temps,
> répartition des soldes, audit, permissions fines, desktop + Android).
>
> Trois corrections à ta proposition :
>
> 1. « Séparer les données personnelles et celles de l'entreprise » est déjà
>    fait à 60 % au niveau utilisateur (tâches privées, objectifs, agenda,
>    restriction par espace). Le vrai sujet, c'est qu'il n'existe **aucune
>    notion d'organisation** dans le schéma : rôles et permissions sont globaux
>    à l'instance. Vendre à une autre entreprise, aujourd'hui, voudrait dire
>    partager une base et un même « espace équipe ». C'est un blocage
>    architectural, pas une option de tarification.
> 2. « Un utilisateur crée son compte et utilise Comexa gratuitement » est faux
>    dans le code actuel : l'inscription crée un compte **sans rôle**, et la
>    politique d'espaces renvoie ce compte vers le portail client (devis /
>    factures). Le premier chantier n'est donc pas un nouveau module, c'est
>    **ouvrir réellement l'espace personnel aux comptes gratuits**.
> 3. « Essai 14 jours puis lecture seule » suppose une couche d'abonnement qui
>    n'existe pas (aucun Plan/Subscription/Trial). Et pour le marché algérien,
>    « sans carte bancaire » n'est pas seulement un choix de conversion : CIB /
>    Dahabia via SATIM demande un contrat marchand de plusieurs semaines. Je
>    commencerai donc par 3-5 entreprises pilotes facturées manuellement.
>
> Ce que je change dans la feuille de route : je ne développe pas « le cockpit,
> le mode concentration et le bilan » — les deux premiers existent. Je
> construis **le seul morceau manquant et différenciant** : le bilan intelligent
> (prévu vs réel, tâches reportées, temps estimé vs temps passé), calculé de
> façon déterministe à partir des données déjà en base. Ensuite seulement
> l'organisation / abonnement, une fois des pilotes signés.

---

## 5. Mon point de vue stratégique

### 5.1 Ce qu'il faut vendre en premier

Ce n'est pas « le dashboard » en général : il y en a quatre (personnel, équipe,
client, administration). Le plus vendable est **l'ERP d'équipe + portail client**
(projets, devis, factures, temps, rapports), parce qu'il est branché sur l'argent
d'une entreprise. Le tableau de bord personnel seul arrive sur un marché saturé
(Notion, Todoist, …) où l'acquisition coûte cher.

Positionnement recommandé :

- **Comexa Personnel** — gratuit, un compte = un espace privé, aucune donnée
  d'entreprise. Rôle : faire connaître le produit, créer l'habitude, et rendre
  l'offre équipe crédible (« l'outil que j'utilise déjà »).
- **Comexa Business** — payant, facturé **par organisation** (forfait + nombre de
  collaborateurs inclus). Rôle : revenu récurrent. Vendu d'abord à des agences /
  PME qui ressemblent à Comexa (francophones, DZD, devis/factures/projets).
- Le site portfolio reste un site vitrine, sur un chemin ou un sous-domaine
  distinct. Mélanger « vitrine de prestations » et « outil gratuit » dans le
  même menu crée de la confusion.

### 5.2 Le vrai choix de départ : trois options de locataire

| Option | Coût | Pour | Contre |
| --- | --- | --- | --- |
| **A. Multi-tenant maintenant** (`Organization`, `Membership`, `organizationId` partout) | Très lourd (20+ tables, tous les services, migration des données de prod, nouveaux tests) | Propre à long terme, un seul compte pour personnel + entreprise | 6-10 semaines de refactor **avant** de savoir si quelqu'un paie |
| **B. Une instance par entreprise pilote** (une base + un déploiement par client) | Faible (infrastructure as code déjà présente : `render.yaml`, Supabase, Docker) | Isolation parfaite immédiate, zéro refactor, validation commerciale en 2-3 semaines | Le compte personnel et le compte entreprise sont séparés ; à changer de modèle plus tard |
| **C. Nouveau service SaaS vierge** (UI réutilisée) | Très lourd, deux codebases | Séparation nette | Duplication de 66 modèles et du travail déjà fait |

**Recommandation : B pour valider, A seulement après 3 entreprises payantes.**
Le jour où A devient nécessaire, on aura appris quelles tables ont vraiment
besoin d'un `organizationId` — et on ne l'aura pas deviné.

### 5.3 Tarification et encaissement (contexte Algérie)

- Premier palier : **forfait par entreprise**, 5 à 10 collaborateurs inclus,
  puis palier supérieur. Plus lisible qu'un prix par siège au début.
- Encaissement pilote : virement bancaire / CCP / BaridiMob + facture émise
  depuis le module `Invoice` existant, et suivi manuel du statut d'abonnement.
  Pas besoin de PSP pour encaisser les 3 premiers clients.
- Self-serve plus tard : CIB / Edahabia via une passerelle locale (Chargily,
  SlickPay, CIBWeb/SATIM). Prévoir un contrat marchand, un RC à jour et 4 à 12
  semaines d'activation [3](https://amarneche.me/blog/accept-online-payments-algeria)
  [4](https://dz-ecom.com/en/blog/integrer-paiement-cib-satim-site-ecommerce-algerie).
  Stripe/PayPal ne sont pas utilisables pour des cartes algériennes
  [3](https://amarneche.me/blog/accept-online-payments-algeria).
- Plafonner l'IA sur le plan gratuit (coût de tokens) et garder le bilan
  déterministe hors IA.

### 5.4 Ce que je ne ferais pas maintenant

- Refaire le design (la charte soft UI est récente et documentée).
- Ajouter un énième module (CRM avancé, IA conversationnelle, mobile natif).
- Construire une page tarifs / deux landing pages avant que l'inscription
  gratuite mène réellement à quelque chose.
- Promettre « gratuit pour toujours » sans avoir chiffré le coût d'hébergement
  par utilisateur actif.

---

## 6. La première approche concrète (4 étapes)

### Étape 0 — Décisions à prendre (1 semaine, zéro code)

1. Quel produit est commercialisé en premier : Personnel seul, Business seul,
   ou les deux ? (Recommandation : Business en premier, Personnel comme levier.)
2. Marché : Algérie uniquement (DZD, virement, français) ou international ?
3. Option de locataire : B (recommandé) ou A.
4. Métrique de réussite du gratuit : **utilisateurs actifs hebdomadaires ayant
   terminé au moins une tâche ou une session de concentration**, mesurée à J7
   et J30. Sans cette mesure, « apporter une vraie valeur » reste une opinion.

### Étape 1 — Rendre le gratuit réel (2 sprints, sur l'instance actuelle)

- Nouveau rôle `PERSONAL` (ou attribution automatique à la vérification d'e-mail)
  avec uniquement des portées `own` / `personal` : `task:read:personal`,
  `task:write:personal`, `calendar:read:own`, `calendar:write:own`,
  `time:read:own`, `time:write:own`, `dashboard:read:own`,
  `notification:read:own`, `notification:manage:own`, `user:read:own`.
  Fichiers : `permissions.catalogue.ts`, `prisma/seed.ts`, nouvelle migration.
- Ouvrir l'espace `personal` à ce rôle sans ouvrir `team` / `comexa` :
  `isTeamMember`, `canEnterSpace`, `effectivePermissions`
  (`backend/src/common/spaces/space-policy.ts`) et `homeFor`
  (`src/lib/access.js`). **Ajouter les tests unitaires manquants avant de modifier.**
- Activer `EMAIL_VERIFICATION_REQUIRED=true`, passer le backend sur un plan
  Render payant, ajouter une limitation spécifique à l'inscription.
- Instrumenter un événement minimal `TASK_COMPLETED` / `FOCUS_SESSION_ENDED`
  pour la métrique de l'étape 0 (l'`AuditLog` existant peut servir de socle).

### Étape 2 — Le bilan intelligent v1 (2 sprints, le vrai différenciateur)

Nouveau endpoint `GET /me/insights/week`, **calculé, sans LLM**, à partir de
données déjà présentes :

- prévu vs réalisé : `Task.estimateMinutes` / `Task.dueDate` / `Task.completedAt`
  contre `TimeEntry.minutes` et `TimerSession.accumulatedSeconds` ;
- tâches reportées : les `TASK_UPDATED` de l'`AuditLog` dont `after.dueDate` est
  renseigné (l'info existe déjà, aucune table d'historique à créer en v1) ;
- objectifs en danger : `Goal.targetDate` + progression `GoalTask` ;
- une seule suggestion actionnable par semaine, formulée par une règle claire
  (« 3 tâches reportées 2 fois → réduire la charge de mercredi »).

Front : un onglet « Bilan » dans `/espace-personnel/tableau-de-bord`. Pas de
nouveau parcours, pas de nouvelle charte.

Livrable de validation : 20 à 30 utilisateurs externes réels, mesure J7/J30.

### Étape 3 — Pilotes Business (en parallèle de l'étape 2)

- 3 à 5 entreprises pilotes, chacune sur **sa propre instance** (base dédiée),
  avec les modules déjà prêts : projets, devis, factures, temps, rapports.
- Essai 14 jours sans carte, **accompagné** (on installe, on forme, on appelle).
- Abonnement = enregistrement manuel dans un premier temps (facture + virement),
  avec un état `TRIALING / ACTIVE / READ_ONLY` appliqué par un garde serveur.
- À la fin de l'essai : lecture seule de l'espace entreprise, **jamais** de
  suppression de données ; l'espace personnel de chaque collaborateur continue
  de fonctionner.

### Étape 4 — Industrialiser seulement si ça paie

Une fois 3 entreprises payantes : introduire `Organization` / `Membership` /
`organizationId`, `Plan` / `Subscription`, la page tarifs, les deux parcours de
présentation, et l'encaissement CIB/Edahabia. Pas avant.

---

## 7. Questions ouvertes (à trancher avant tout code)

1. « Le dashboard à commercialiser à part » désigne-t-il l'ERP équipe ou
   l'espace personnel ? Ce document suppose **Business d'abord**.
2. Combien d'entreprises pilotes pouvez-vous mobiliser dans les 30 prochains
   jours ? Si la réponse est 0, l'étape 3 n'a aucun sens et il faut rester sur
   l'étape 1-2.
3. Visez-vous uniquement l'Algérie au lancement ? (Change la devise, les moyens
   de paiement, les mentions légales et la langue des landing pages.)
4. Qui maintient les instances pilotes (une par client) ? Sans automatisation
   du déploiement, l'option B devient coûteuse au-delà de ~5 clients.

---

## 8. Sources externes

- [1] ChartMogul / Kyle Poyar / ProductLed, *The SaaS Conversion Report*,
  4 février 2026, étude de janvier 2026 sur 200 produits B2B :
  https://chartmogul.com/reports/saas-conversion-report/
- [3] *How to accept online payments in Algeria* (CIB, Edahabia, SlickPay,
  OneClick), octobre 2026 :
  https://amarneche.me/blog/accept-online-payments-algeria
- [4] *Intégrer le paiement CIB / SATIM en Algérie* (délais et prérequis
  marchands), mai 2026 :
  https://dz-ecom.com/en/blog/integrer-paiement-cib-satim-site-ecommerce-algerie
