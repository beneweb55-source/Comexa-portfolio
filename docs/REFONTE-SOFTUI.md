# Refonte du dashboard — « soft UI pastel dans une coque noire »

Cette refonte ne touche **que la couche visuelle**. Les routes, les appels d'API,
les permissions, les mutations et les libellés métier sont inchangés : les pages
réécrites conservent `useListing` / `useObject` / `useAction`, les mêmes chemins
(`/clients`, `/projects`, `/quotes`, `/invoices`, `/orders`, `/dashboard`…) et les
mêmes garde-fous (`can(user, "…")`).

---

## 1. Fichiers de tokens

| Fichier | Rôle |
| --- | --- |
| `src/styles/softui.tokens.css` | Tous les jetons de la refonte : coque, dossier glacé, surfaces, pastels, encre, rayons, ombres, typographie, cadences. |
| `src/components/softui/tokens.js` | Miroir JavaScript strictement nécessaire : nuanciers de tonalité, table statut → tonalité, durées et `easing`. Aucune couleur en dur dans un composant. |
| `src/styles/softui.components.css` | Feuille unique des composants, tout est préfixé `sui-`. |
| `src/app/globals.css` | Importe Plus Jakarta Sans (`@fontsource/plus-jakarta-sans` 400/500/700/800) puis les deux feuilles ci-dessus. |

Rappel des valeurs demandées, toutes présentes telles quelles : `--shell #0B0A0F`,
`--backdrop #DBE7EF`, `--surface #F6F4F5`, `--card #FDFDFD` ; pastels `--blue
#D7E8F9`, `--green #D8EFBE`, `--yellow #F9E6B9`, `--lilac #EDD5F8`,
`--lilac-strong #EAC1F1`, `--pink #F9D5DD` ; `--ink #111`, `--muted #6B6B6B` ;
rayons 32 / 24 / 28 / pilules ; ombres `0 8px 24px rgba(0,0,0,.06)` et
`0 14px 32px rgba(0,0,0,.10)`.

---

## 2. Composants réutilisables

`import { Shell, Navbar, … } from "@/components/softui";`

| Composant | Fichier | Rôle |
| --- | --- | --- |
| `Shell` | `softui/Shell.jsx` | Coque complète : navbar, languette à rayon inversé, rail, panneau clair, Admin Desk, dock, tiroirs, préférence de densité. Expose `useShellQuery()`. |
| `Navbar` | `softui/Navbar.jsx` | Logo + badge de rôle, 6–8 onglets (pilule `layoutId` sur l'onglet actif), profil (initiales, nom, courriel, chevron). Sous 1024 px : barre d'icônes en bas. |
| `SideRail` | `softui/SideRail.jsx` | 56 px : partage, menu, bascule de l'Admin Desk, cloche avec compteur, `+` / `−` de densité. |
| `KpiCard` / `KpiGrid` | `softui/KpiCard.jsx` | Cartes pastel 28 px, pastille de badge, décoration `Sparkles`, variante `ghost` en pointillés pour « à traiter ». |
| `FilterPills` / `Pill` | `softui/primitives.jsx` | Filtres en pilules (actif = noir plein, `aria-pressed`), compteurs optionnels, actions de droite. |
| `ItemCard` / `ItemGrid` | `softui/ItemCard.jsx` | Carte blanche : titre, description, méta, pilule de statut, 2–3 boutons icône, pastille chevauchante, variante mise en avant (`lilac-strong`), `progress`. |
| `AdminDeskPanel` | `softui/AdminDeskPanel.jsx` | Panneau droit : titre, sous-titre de compteurs, contrôle segmenté animé, cartes teintées avec 3 lignes + pilule blanche d'action et mini-icônes. |
| `Dock` | `softui/Dock.jsx` | Dock noir flottant à découpe inversée, boutons pastel, « + » cerclé, infobulles. |
| `StatusPill` / `StatusPillFor` | `softui/primitives.jsx` | Pilule de statut (texte foncé sur pastel, variante blanche sur carte mise en avant). |
| `IconButton` | `softui/primitives.jsx` | Bouton icône seul : `aria-label`, infobulle, `title`, 36/40 px. |
| `Tooltip` | `softui/Tooltip.jsx` | Infobulle portailée (jamais rognée par la coque), survol **et** focus clavier, `role="tooltip"`. |
| `Button`, `Alert`, `SectionHead`, `Panel`, `ActivityList`, `HealthList`, `ProgressBar` | `softui/primitives.jsx`, `softui/panels.jsx`, `softui/ItemCard.jsx` | Boutons gris/noir, alertes pastel, titres de section, listes d'activité et barres de santé. |
| `SoftMotionProvider`, `staggerItem`, `pageTransition`, `cardHover`, `tooltipMotion` | `softui/motion.jsx` | Mouvement partagé : 150–300 ms, ease-out, échelonnage 40 ms, `layoutId`. |
| `formatRelativeTime`, `notificationMeta` | `softui/time.js`, `softui/notification-map.js` | Horodatage court et table `NotificationType` → icône/label/pastel. |

`src/components/dashboard/icons.jsx` reste le point d'entrée historique
(`<Icon name="users" />`) mais **toutes** ses entrées résolvent désormais vers une
icône `lucide-react` : une seule source d'icônes pour l'ancien et le nouveau code.

---

## 3. Pages réécrites avec ces composants

| Page | Ce qui change (visuel uniquement) |
| --- | --- |
| `espace-equipe/tableau-de-bord` | Control Center : 4 KPI (dont la carte fantôme « retards cumulés »), filtres de période en pilules, file de validation en cartes, activité récente + santé de l'espace. Les tableaux détaillés d'origine restent accessibles, repliés en bas de page. |
| `espace-equipe/clients` | Grille de cartes : initiales en pastille, référence, secteur/ville/pays, statut. Filtres par statut en pilules ; la recherche du bandeau alimente le paramètre `search` de l'API. |
| `espace-equipe/projets` | Grille de cartes : barre de progression 4 px avec ratio, pilule de statut, action principale noire vers la fiche. |
| `espace-equipe/devis` | Filtres de statut convertis en pilules, cartes avec montant en pilule, bouton principal noir conditionné à `quote:write:any`. |
| `espace-equipe/factures` | Idem, avec total et reste à payer (`remainingDue`) et pilule de statut. |
| `espace-equipe/commandes` | Reste un **tableau** (file d'actions), mais habillé soft UI : pilules de filtre, alertes pastel, boutons secondaire/principal, statuts en pilules. Toute la logique (validation, démarrage, paiement, confirmations) est conservée. |
| `espace-client/*`, `espace-equipe/*` (autres) | Bénéficient déjà de la nouvelle coque (navbar, rail, Admin Desk, dock, en-tête) sans modification de page. |

L'ancien `WorkspaceShell` conserve sa signature
(`space`, `groups`, `children`) : il délègue simplement à `softui/Shell`.

---

## 4. Écarts par rapport au brief (et pourquoi)

1. **Le menu complet reste accessible.** Le brief décrit 6–8 onglets et un rail de
   3 boutons, mais l'espace équipe compte 25 rubriques protégées par permissions.
   Les onglets affichés sont les 8 plus utilisées **parmi celles autorisées** ; le
   bouton « menu » du rail (et le « + » du dock) ouvre un tiroir qui liste **toutes**
   les rubriques, groupées comme avant. Aucune route n'a été supprimée.
2. **Le bouton « grille » du rail pilote l'Admin Desk** au lieu d'une vue grille :
   une bascule « 3 colonnes / liste » n'est pas réalisable pour toutes les pages
   sans toucher à leur logique. Le même bouton ouvre l'Admin Desk en tiroir sous
   1024 px — un contrôle, deux comportements cohérents.
3. **Les boutons `+` / `−` règlent la densité (90 / 100 / 110 / 120 %)** du panneau
   principal, préférence mémorisée localement. Le brief ne précisait pas leur
   action ; le zoom était la seule action utile et non destructive.
4. **Le dock s'adapte aux permissions.** Cinq boutons pastel + « + » quand c'est
   possible ; pour un porteur qui n'a pas les droits correspondants, les actions
   interdites sont retirées (jamais de bouton mort). L'espace client a son propre
   jeu d'actions.
5. **Le contenu de l'Admin Desk vient de l'API** (`/notifications` et
   `/me/tasks`), filtré par permissions, au lieu d'être simulé. Ses trois onglets
   sont donc nommés d'après les données réelles : « Mes tâches · À traiter ·
   Historique » (au lieu de « Events / Approvals / Audit log »).
6. **Les pages « Commandes » reste un tableau**, pas une grille de cartes : sept
   colonnes avec un sélecteur de paiement par ligne se lisent mal en cartes. Le
   reste des pages liste passe en grille.
7. **L'identité Comexa est conservée** : logo horizontal sur la navbar noire,
   « Comèxa » dans le tiroir, et la coque reprend les pastels demandés. Le
   vocabulaire reste celui du produit (clients, projets, devis, factures) et non
   celui de l'inspiration (cours, événements).
8. **La navigation n'affiche que les rubriques autorisées** : le nombre d'onglets
   peut descendre sous 6 pour un porteur très restreint (c'est une contrainte de
   sécurité, pas un oubli).
9. **Le petit « + » du dock ouvre le tiroir de navigation** plutôt qu'une action
   invisible : aucune action d'écriture n'existe aujourd'hui au niveau global.
10. **Page d'aperçu de développement** : `/refonte-apercu` montre tous les
    composants avec des données de démonstration. Elle répond 404 en production
    (`notFound()` si `NODE_ENV === "production"`).
11. **Plancher typographique à 12 px** partout (le brief l'exige) : les tailles
    décoratives du brief (11 px pour un badge de rôle) ont été remontées à 12 px.
12. **Les tableaux d'origine du tableau de bord sont conservés** sous
    « Explorer les données détaillées » : ils utilisent encore les classes de la
    charte (`cx-*`) car ce sont des tableaux de données, pas des cartes. Les
    convertir en cartes aurait fait perdre de l'information.

---

## 5. Accessibilité et mouvement

- **Aucun emoji** dans l'interface : titres, badges, statuts, listes et boutons
  passent tous par `lucide-react` (taille 16–20 px, trait 1,75, couleur héritée).
- `aria-label` + `title` sur chaque bouton icône seul, infobulle aussi au focus
  clavier ; `aria-current="page"` sur l'onglet actif ; `aria-pressed` sur les
  filtres ; `role="progressbar"` avec valeur sur chaque barre.
- Focus visible (anneau 2 px) sur tout élément interactif, y compris dans la coque
  noire (anneau blanc) ; lien d'évitement « Passer à la zone de travail ».
- Cibles tactiles : 40 px minimum (36 px pour les mini-actions internes aux
  cartes, taille sanctionnée par les jetons « boutons icône 36 px ronds »).
- `prefers-reduced-motion` : `MotionConfig reducedMotion="user"` désactive
  transformations et transitions de `layoutId`, il ne reste que les fondus ; la
  feuille de styles neutralise aussi les survols et un `@media` dédié.
- Responsive : < 1024 px l'Admin Desk devient un tiroir, le rail disparaît et la
  navbar devient une barre d'icônes en bas ; < 720 px les grilles passent à une
  colonne et le dock devient une barre d'actions flottante compacte.
