# Audit et refonte du dashboard Comexa

Date : 15 octobre 2026.
Périmètre principal : `/espace-equipe/tableau-de-bord`, dans la coque partagée des espaces authentifiés.

> **Document historique.** L'audit ci-dessous a été mené pour la direction
> « verre liquide » qui a suivi la première refonte. Cette direction a depuis été
> **remplacée** par la charte « soft UI pastel dans une coque noire », décrite
> dans [`REFONTE-SOFTUI.md`](REFONTE-SOFTUI.md) : la feuille
> `workspace-liquid.css` a été supprimée, la coque est redevenue une coque noire
> à panneau clair, et le tableau de bord est désormais
> `dashboard/ControlCenter.jsx`. Les défauts listés ici restent utiles : ils
> expliquent les garde-fous conservés (adaptateur `WorkspaceShell`, container
> queries, recherche branchée, un seul `h1`, permissions `dashboard:read:any`).

## Défauts identifiés et corrections

| Défaut observé dans le code | Impact | Correction |
| --- | --- | --- |
| `WorkspaceShell` transmet `space/groups`, alors que `Shell` attend `area/title/links`. | Navigation vide, espace équipe interprété comme un espace client, actions contextuelles incorrectes. | Adaptateur explicite, en conservant les liens déjà filtrés par les autorisations. |
| Contenu plafonné à 1 520 px. | Espace inutilisé sur les grands écrans. | Suppression du plafond ; largeur disponible intégralement utilisée, avec des marges internes adaptatives. |
| Une partie des règles de verre cible l'ancienne classe `.cx-workspace--team`, absente de la coque active. | Effet demandé peu perceptible et styles incohérents entre composants. | Feuille `workspace-liquid.css` ciblant la vraie coque `.sui-viewport`. |
| Grilles dimensionnées selon la largeur de la fenêtre, sans tenir compte du menu latéral. | Cartes trop étroites, badges et valeurs qui se disputent l'espace. | Container queries : 1, 2 ou 4 colonnes de KPI et 1, 2 ou 3 colonnes de widgets selon la largeur réellement disponible. |
| `PageHeader` utilise des classes sans styles et ignore les propriétés d'actions transmises par la coque. | Hiérarchie peu lisible et actions absentes. | Titre, sous-titre, surtitre et boutons stylés ; prise en charge des liens et des actions. |
| Recherche de `PageHeader` affichée sans gestionnaire. | Champ saisissable sans effet. | Recherche affichée uniquement lorsqu'un filtre est branché. Dans le dashboard, la recherche du bandeau ouvre la palette globale. |
| Deux titres `h1` identiques. | Hiérarchie sémantique confuse. | Un seul `h1` dans l'en-tête du contenu ; contexte de navigation en texte simple. |
| Permission `dashboard:read:agency` et route `/dashboard/agency` incompatibles avec le backend du dépôt. | Vue agence inaccessible. | Utilisation de `dashboard:read:any` et de `/dashboard`. |
| Propriétés de Facturation, Santé des projets, Échéances, Minuteur et vues détaillées incompatibles avec les composants existants. | Montants absents, listes vides, tâches non proposées dans le minuteur, risque de plantage des vues détaillées. | Raccordement aux contrats réels : objets financiers, lignes de santé, tâches normalisées, résultat de listing et objets des endpoints dashboard. |
| Minuteur flottant et console IA présents dans la coque et le layout équipe. | Deux instances superposées une fois le raccordement équipe réparé. | Le layout conserve la responsabilité de ces deux composants. |
| Bouton Console IA affiché sur mobile à cause de la priorité des règles CSS sur les utilitaires `hidden`. | En-tête comprimé et titre tronqué. | Règle responsive explicite ; la console reste accessible via son lanceur flottant. |
| Couleur blanche forcée sur la rubrique active. | Texte illisible sur le nouveau verre clair. | Suppression du `!important` et état actif à texte bleu dense. |
| Erreurs répétées et chargement confondu avec l'échec ou l'absence de données. | Empilement d'alertes et messages trompeurs. | Déduplication des messages ; distinction du chargement, des listes vides et des données indisponibles pour les widgets concernés. |

## Direction visuelle (remplacée)

Direction « verre liquide » appliquée à l'époque de cet audit, depuis remplacée
par la charte pastel sur coque noire :

- Fond lumineux bleu glacier, avec touches lavande et cyan, sans image ni téléchargement externe.
- Verre dépoli inspiré de macOS/iOS : transparence modérée, saturation, reflets en dégradé, arêtes claires et ombres douces.
- Texte sombre et couleurs sémantiques conservées pour les montants et statuts.
- Typographie Plus Jakarta Sans dans l'espace de travail ; le site public conserve sa typographie.
- Rayons et espacements homogènes ; micro-interaction de survol réservée aux cartes interactives.
- Suppression des boutons « Nouveau devis » redondants : une action principale dans l'en-tête.
- Barre de navigation mobile flottante, cibles principales de 44 px et prise en compte des zones de sécurité.

Direction actuelle (voir `REFONTE-SOFTUI.md`) : coque noire `#0B0A0F` arrondie à
32 px posée sur un halo `#DBE7EF`, panneau clair `#F6F4F5`, cartes blanches
`#FDFDFD` à 24 px, six pastels pour coder les catégories, un seul accent noir
pour les actions principales, découpes à rayon inversé (languette sous la
navbar, congés du dock), Plus Jakarta Sans.

## Plein écran

La coque occupe la fenêtre (`100dvh`, avec repli `100vh`), sans cadre extérieur ni largeur maximale du contenu. La barre supérieure et la navigation restent en place ; le contenu défile dans sa propre zone. Plein écran signifie ici utiliser tout l'espace du navigateur, pas masquer les barres du navigateur via l'API Fullscreen.

## Accessibilité et dégradation

- Un seul titre principal ; sélecteur Vue agence/Ma journée utilisant des boutons à état `aria-pressed`.
- Focus clavier conservés et navigation globale accessible avec Ctrl/Cmd+K.
- Animations et transitions neutralisées avec `prefers-reduced-motion`.
- Surfaces opaques sans prise en charge de `backdrop-filter` ; préférence de transparence réduite prise en charge.
- Flou limité aux surfaces et au chrome, pas appliqué à chaque ligne de tableau.

## Vérifications réalisées

### Refonte soft UI (état actuel du dépôt)

- `npm run lint` : réussi (règles React Compiler incluses).
- `npm run test:unit` : 33 tests réussis.
- `npm run build` : compilation de production réussie (Next 16, Turbopack).
- Contrôle statique des classes : toute classe `sui-*` utilisée par un composant
  est définie dans `softui.components.css`, et inversement (hors identifiants
  `layoutId` et gabarits d'`id` ARIA).
- Contrôle « aucun emoji » sur `src/` : aucun pictogramme emoji dans les
  composants du dashboard (seul subsiste un `✓` typographique dans une puce de
  liste du site public, hors périmètre).
- Rendu serveur vérifié sur `/refonte-apercu` (tous les composants du brief sont
  présents dans le HTML servi) et sur les routes d'espace (200, aucune erreur de
  compilation). Les vérifications navigateur multi-résolutions ci-dessous
  datent de la direction précédente et sont à rejouer sur la coque noire.

### Audit initial (direction « verre liquide »)

- Vérifications Chromium avec API interceptée pour tester l'interface sans compte réel :
  - 320 × 740, 390 × 844, 768 × 1 024, 1 024 × 768, 1 440 × 1 000, 1 920 × 1 080 ;
  - pas de débordement horizontal du document ; hauteur de coque égale à celle de la fenêtre ;
  - dépliage/repliage du menu, palette de commandes, changement Vue agence/Ma journée et ouverture du menu mobile ;
  - un seul `h1`, rubrique active en texte sombre ;
  - listes vides, erreur de chargement des projets, utilisateur sans permission agence ;
  - aucune erreur JavaScript non interceptée dans les scénarios exécutés.

Les réponses simulées sont utilisées uniquement dans le navigateur de test : aucune donnée fictive ni dérogation d'authentification n'est ajoutée à l'application. Ces vérifications ne remplacent pas une recette avec le backend réel ni des essais sur Safari/iPhone physique.
