# Refonte du dashboard — « soft UI pastel dans une coque noire »

Refonte **visuelle uniquement** : les routes, les appels d'API, les permissions,
les mutations et les libellés métier sont inchangés. Les pages réécrites
conservent `useListing` / `useAllListing` / `useObject` / `useTimer`, les mêmes
chemins (`/clients`, `/projects`, `/quotes`, `/invoices`, `/orders`,
`/dashboard`…) et les mêmes garde-fous (`can(user, "…")`).

---

## 1. Fichiers de tokens

| Fichier | Rôle |
| --- | --- |
| `src/styles/softui.tokens.css` | Source de vérité : coque, halo glacé, surfaces, pastels, encre, rayons, ombres, typographie, cadences, gabarits. |
| `src/components/softui/tokens.js` | Miroir JavaScript strictement nécessaire : nuanciers, table statut → tonalité, durées et `easing`. Aucune couleur en dur dans un composant. |
| `src/styles/softui.components.css` | Feuille unique des composants, tout est préfixé `sui-` (coque, navbar, rail, KPI, cartes, Admin Desk, dock, tiroirs, palette ⌘K, focus, responsive, mouvement réduit). |
| `src/app/globals.css` | Importe Plus Jakarta Sans (400/500/700/800) puis les feuilles ; `softui.components.css` est chargée **en dernier** pour avoir le dernier mot sur les classes `sui-*`. |

Valeurs du brief, présentes telles quelles : `--shell #0B0A0F`,
`--backdrop #DBE7EF`, `--surface #F6F4F5`, `--card #FDFDFD` ; pastels `--blue
#D7E8F9`, `--green #D8EFBE`, `--yellow #F9E6B9`, `--lilac #EDD5F8`,
`--lilac-strong #EAC1F1`, `--pink #F9D5DD` ; `--ink #111` ; rayons coque 32 /
cartes 24 / KPI 28 / pilules pleines / boutons icône 36 ronds ; ombres
`0 8px 24px rgba(0,0,0,.06)` et `0 14px 32px rgba(0,0,0,.10)`.

Deux ajustements assumés (voir §4) : `--muted` à `#666` au lieu de `#6B6B6B`
(contraste AA sur `--surface`), et les rayons des découpes à rayon inversé
dérivés des rayons voisins (`--r-notch`, `--r-dock`) pour que les congés soient
tangents au bord noir.

---

## 2. Composants réutilisables

`import { Shell, Navbar, SideRail, KpiCard, FilterPills, ItemCard, AdminDeskPanel, Dock, StatusPill, IconButton } from "@/components/softui";`

| Composant | Fichier | Rôle |
| --- | --- | --- |
| `Shell` | `softui/Shell.jsx` | Coque complète : navbar, languette à rayon inversé, rail, panneau clair scrollable, Admin Desk, dock, barre d'icônes mobile, tiroirs, palette ⌘K, densité du texte. Expose `useShellQuery()`. |
| `Navbar` | `softui/Navbar.jsx` | Marque + badge de rôle, 6 à 8 onglets autorisés dont seul l'actif déplie sa pilule (`layoutId`), profil (initiales, nom, courriel, chevron). |
| `SideRail` | `softui/SideRail.jsx` | 56 px : partage, toutes les rubriques, bascule de l'Admin Desk, cloche avec compteur, `+` / `−` de densité. |
| `PageHeader` | `softui/PageHeader.jsx` | Pastille + grand titre + sous-titre, actions, recherche en pilule grise (affichée seulement si un filtre est branché). |
| `KpiCard` / `KpiGrid` | `softui/KpiCard.jsx` | Cartes pastel 28 px, badge, décoration `Sparkles`, variante `ghost` en pointillés. |
| `FilterPills` / `Pill` / `Button` / `Alert` / `SectionHead` / `IconButton` / `StatusPill` / `StatusPillFor` | `softui/primitives.jsx` | Pilules de filtre (actif = noir plein, `aria-pressed`, lien ou état local), boutons gris/noir, alertes pastel, boutons icône avec `aria-label` + infobulle, pilules de statut. |
| `ItemCard` / `ItemGrid` / `ProgressBar` | `softui/ItemCard.jsx` | Carte blanche : titre, description, méta, pilule blanche d'info, barre 4 px, statut, 2–3 boutons icône (le dernier en noir plein), pastille chevauchante, variante `highlight` (`--lilac-strong`). |
| `AdminDeskPanel` | `softui/AdminDeskPanel.jsx` | Panneau droit : titre, sous-titre de compteurs, contrôle segmenté animé, cartes teintées (3 lignes + pilule blanche d'action et mini-icônes). |
| `Dock` | `softui/Dock.jsx` | Dock noir flottant à congés concaves, boutons pastel, « + » cerclé, infobulles. |
| `Panel` / `ActivityList` / `HealthList` | `softui/panels.jsx` | Panneau blanc, liste d'activité (icône en cercle, phrase en gras, heure grise), barres de santé avec ratio. |
| `Tooltip` | `softui/Tooltip.jsx` | Infobulle portailée (jamais rognée par la coque), survol **et** focus clavier, `role="tooltip"`. |
| `SoftMotionProvider`, `staggerItem`, `pageTransition`, `cardHover`, `layoutSpring` | `softui/motion.jsx` | Mouvement partagé : 150–300 ms, ease-out, échelonnage 40 ms, `layoutId`, `reducedMotion="user"`. |
| `formatRelativeTime`, `notificationMeta` | `softui/time.js`, `softui/notification-map.js` | Horodatage court et table `NotificationType` → icône / libellé / pastel. |

`src/components/dashboard/icons.jsx` reste le point d'entrée historique
(`<Icon name="users" />`) et **toutes** ses entrées résolvent vers
`lucide-react` : une seule source d'icônes pour l'ancien et le nouveau code.

---

## 3. Pages réécrites avec ces composants

| Page | Ce qui change (visuel uniquement) |
| --- | --- |
| `espace-equipe/tableau-de-bord` (`dashboard/ControlCenter.jsx`) | Control Center : 4 KPI pastel dont la carte fantôme « À traiter », accès direct en pilules + bascule « Vue agence / Ma journée », file de validation en cartes (impayés, projets, devis, échéances), activité récente + santé de l'espace. Les données détaillées (facturation, échéances à 7 jours, minuteur, encaissements 6 mois, pipeline, vues agence/journée) restent accessibles, repliées en bas de page. |
| `espace-equipe/clients` | Grille de cartes : initiales en pastille, référence, secteur/ville/pays, statut ; filtres en pilules ; la recherche du bandeau alimente le paramètre `search` de l'API. |
| `espace-equipe/projets` | Grille de cartes avec barre de progression 4 px et ratio, pilule de statut, action principale noire vers la fiche. |
| `espace-equipe/devis` | Filtres en pilules, montant en pilule blanche, bouton principal noir conditionné à `quote:write:any`. |
| `espace-equipe/factures` | Idem, avec total et reste à payer (`remainingDue`). |
| `espace-equipe/commandes` | Reste un **tableau** (file d'actions), habillé soft UI : pilules de filtre, alertes pastel, boutons secondaire/principal, statuts en pilules. Toute la logique (validation, démarrage, paiement, confirmations) est conservée. |
| Autres pages `espace-equipe/*` et `espace-client/*` | Bénéficient de la coque (navbar, rail, en-tête, Admin Desk, dock, tiroirs) sans modification de page. |

`WorkspaceShell` conserve sa signature (`space`, `groups`, `children`) : il
convertit les groupes autorisés en liens et délègue à `softui/Shell`.

Supprimés parce que remplacés : `dashboard/BentoDashboard.jsx` et
`dashboard/DashboardTiles.jsx` (leur logique de données a été recopiée telle
quelle dans `ControlCenter.jsx`), ainsi que `styles/workspace-liquid.css`
(surcharges « verre liquide » qui écrasaient la coque).

---

## 4. Écarts par rapport au brief (et pourquoi)

1. **Le menu complet reste accessible.** Le brief décrit 6 à 8 onglets et un rail
   de 3 boutons, mais l'espace équipe compte 25 rubriques protégées par
   permissions. La navbar affiche les 8 plus utilisées **parmi celles
   autorisées** ; le bouton « menu » du rail, le « + » du dock et l'onglet
   « Rubriques » sur mobile ouvrent un tiroir qui liste **toutes** les rubriques,
   groupées comme dans les layouts. Aucune route n'a été supprimée.
2. **Le bouton « grille » du rail pilote l'Admin Desk** au lieu d'une vue grille :
   une bascule « 3 colonnes / liste » n'est pas réalisable sur toutes les pages
   sans toucher à leur logique. Le même bouton masque le panneau intégré sur
   grand écran et l'ouvre en tiroir sous 1024 px — un contrôle, deux
   comportements cohérents.
3. **Les boutons `+` / `−` règlent la densité du texte (90 / 100 / 110 / 120 %)**
   du panneau principal, préférence mémorisée dans `localStorage`
   (`comexa:panel-zoom`). Le brief ne précisait pas leur action ; le zoom est la
   seule action utile et non destructive à cet endroit.
4. **Le dock s'adapte aux permissions.** Cinq boutons pastel + « + » quand c'est
   possible ; pour un porteur qui n'a pas les droits correspondants, les actions
   interdites sont retirées (jamais de bouton mort). L'espace client a son propre
   jeu d'actions, dont « Imprimer cette vue » pour l'export.
5. **Le contenu de l'Admin Desk vient de l'API** (`/notifications`, `/me/tasks`,
   `/activity`), filtré par permissions, au lieu d'être simulé. Ses trois onglets
   sont donc nommés d'après les données réelles : « Mes tâches · À traiter ·
   Historique » (au lieu de « Events / Approvals / Audit log »).
6. **La page « Commandes » reste un tableau**, pas une grille de cartes : sept
   colonnes avec un sélecteur de paiement par ligne se lisent mal en cartes.
7. **L'identité Comexa est conservée** : logo horizontal clair sur la navbar
   noire (le « Dei » de l'inspiration n'existe pas ici), point jaune et badge de
   rôle repris du brief. Le vocabulaire reste celui du produit (clients, projets,
   devis, factures) et non celui de l'inspiration (cours, événements).
8. **La navigation n'affiche que les rubriques autorisées** : le nombre d'onglets
   peut descendre sous 6 pour un porteur très restreint (contrainte de sécurité,
   pas un oubli).
9. **Les graphiques Recharts du tableau de bord deviennent des barres pastel en
   `div`** (encaissements 6 mois, pipeline). Même données, même lecture, mais
   cohérentes avec les barres 4 px du brief et sans dépendance de couleurs
   externes.
10. **Le minuteur reste dans le tableau de bord** (volet détaillé) en plus de la
    pastille flottante du layout : c'était une fonctionnalité existante, elle est
    conservée à l'identique (même contexte, mêmes appels).
11. **Page d'aperçu de développement** : `/refonte-apercu` montre tous les
    composants avec des données de démonstration. Elle répond 404 en production
    (`notFound()` si `NODE_ENV === "production"`).
12. **Plancher typographique à 12 px** partout ; les tailles décoratives de
    l'inspiration (10-11 px) ont été remontées, et le gris de texte est passé de
    `#6B6B6B` à `#666` pour tenir AA (5,04:1) sur le panneau `#F6F4F5`.
13. **Les tableaux détaillés d'origine** (vues « agence » et « ma journée »)
    conservent les classes de la charte (`cx-*`) : ce sont des tableaux de
    données, pas des cartes. Les convertir aurait fait perdre de l'information.
14. **La palette de commandes ⌘K et la console IA** (fonctionnalités existantes,
    hors brief) ont été conservées et rhabillées aux jetons soft UI plutôt que
    supprimées.

---

## 5. Accessibilité et mouvement

- **Aucun emoji** dans l'interface : titres, badges, statuts, listes et boutons
  passent tous par `lucide-react` (16-20 px, trait 1,75, couleur héritée). Seules
  subsistent des flèches typographiques (← →) dans les liens « retour », qui sont
  du texte et non des pictogrammes.
- `aria-label` + `title` sur chaque bouton icône seul, infobulle au survol **et**
  au focus clavier ; `aria-current="page"` sur l'onglet actif ; `aria-pressed`
  sur les filtres ; `role="progressbar"` avec valeur sur chaque barre ;
  `role="tablist"/"tab"/"tabpanel"` sur le contrôle segmenté de l'Admin Desk.
- Focus visible (anneau 2 px) sur tout élément interactif, anneau blanc dans la
  coque noire ; lien d'évitement « Passer à la zone de travail ».
- Cibles tactiles : 40 px minimum (44 px pour la barre d'icônes mobile et les
  boutons du dock), 36 px pour les mini-actions internes d'une carte — calibre
  demandé par le brief.
- `prefers-reduced-motion` : `MotionConfig reducedMotion="user"` retire
  transformations et transitions de `layoutId` (il ne reste que les fondus), la
  feuille de styles neutralise aussi les déplacements au survol.
- Responsive : < 1024 px l'Admin Desk devient un tiroir et le rail disparaît ;
  < 768 px la navbar devient une barre d'icônes en bas, les grilles passent à une
  colonne, le dock se compacte et se pose au-dessus de cette barre.

---

## 6. Vérifications

```bash
npm run lint     # ESLint (règles React Compiler incluses)
npm run build    # Next 16, Turbopack
npm run test:unit
```

Pour voir la coque remplie sans le backend Nest : le tableau de bord et les
pages liste consomment l'API relayée par `/api/*` (`BACKEND_URL`, défaut
`http://localhost:3001`). `/refonte-apercu` (développement uniquement) montre
tous les composants avec des données de démonstration, sans session.
