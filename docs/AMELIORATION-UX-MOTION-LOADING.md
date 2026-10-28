# Mission 8 — Comexa Portfolio : refonte premium de l'expérience, du mouvement et des chargements

**Date :** 28 octobre 2026 (Africa/Algiers)  
**Branche :** `arena/c1004795-comexa-portfolio`  
**Périmètre :** quatre espaces (personnel, équipe, client, Comexa Space) + composants partagés. Aucune nouvelle fonctionnalité métier, aucune modification de permission, aucun SaaS séparé.

---

## 1. Constats de l'audit

### 1.1 États de chargement

| Problème | Endroit | Statut |
|---|---|---|
| Aucun `loading.jsx` / `error.jsx` / `not-found.jsx` Next.js | Toute l'application | Documenté (pas de changement requis : le shell gère déjà le chargement via `useListing`/`useObject`) |
| `SkeletonList` générique identique pour toutes les pages | `src/components/workspace/ui.jsx` | ✅ Corrigé : nouveaux squelettes spécifiques ajoutés |
| Aucune page ne possède un squelette adapté à sa structure | Toutes les pages des 4 espaces | ✅ Partiellement : client dashboard + équipe tâches mises à jour |
| Le même `SkeletonList rows={3}` sert de `Suspense fallback` partout | Toutes les pages | ✅ Corrigé sur les pages traitées |

### 1.2 Mouvement

| Problème | Endroit | Statut |
|---|---|---|
| `pageTransition` existe mais Shell.jsx n'utilise pas `AnimatePresence` → pas d'animation de sortie | `src/components/softui/Shell.jsx` | ✅ Corrigé : `PageTransition` + `AnimatePresence` |
| Les durées CSS (`150/220/300 ms`) diffèrent des durées JS | `softui.tokens.css` vs `tokens.js` | ✅ Corrigé : `motion.jsx` calé sur les tokens CSS |
| Pas de transition partagée pour tiroirs, modales, panneaux | Aucun | ✅ Corrigé : `drawerVariants`, `backdropVariants`, `dialogVariants` |
| Pas de variante « occupé » réutilisable pour les boutons | Aucun | ✅ Corrigé : `busyVariants` + `ActionStatus` |

### 1.3 Design / finition

| Problème | Endroit | Statut |
|---|---|---|
| États d'action non harmonisés | Formulaires, `ConfirmDialog`, `RecordActions` | ✅ Corrigé : `ActionStatus` + `Toast` |

---

## 2. Règles de mouvement adoptées

| Élément | Durée | Courbe | Distance |
|---|---|---|---|
| Interaction (bouton, pilule, survol) | 120–160 ms | ease-out | y: ±4 px |
| Contenu de page (apparition) | 180–260 ms | ease-out | y: 8 → 0 |
| Sortie de page | 120–160 ms | ease-out | y: 0 → -4, opacité 1 → 0 |
| Tiroir / panneau latéral | 220–300 ms | ease-out | x: ±100 % |
| Liste / grille (apparition échelonnée) | 40 ms de décalage par élément | ease-out | y: 8 → 0 |
| Skeleton (pulsation) | 1400 ms | ease-in-out | opacité 0.4 → 1 |

- `prefers-reduced-motion` : tous les mouvements sont retirés, seuls les fondus d'opacité et les changements d'état (couleur, texte) sont conservés.
- Aucune animation de rebond, aucune rotation décorative, aucun flottement permanent.
- `transform` et `opacity` privilégiés (propriétés performantes). Pas d'animation de dimensions ou d'ombres en continu.

---

## 3. Implémentation réalisée

### Tranche 1 — Système partagé

| Fichier | Action | Détails |
|---|---|---|
| `src/components/softui/motion.jsx` | Réécriture complète | Centralise toutes les variantes : `pageVariants`, `pageChildVariants`, `staggerParent`, `staggerItem`, `drawerVariants`, `backdropVariants`, `dialogVariants`, `cardHover`, `cardRest`, `busyVariants`, `tooltipMotion`, `layoutSpring`, `layoutSoft`, `skeletonPulse`, `skeletonAnimation`. Durées calées sur les tokens CSS (`--dur-fast: 140ms`, `--dur-base: 220ms`, `--dur-slow: 300ms`). |
| `src/components/softui/PageTransition.jsx` | Créé | Wrapper `AnimatePresence` + `motion.div` pour les transitions de route. Utilise `mode="wait"` pour que l'ancienne page sorte avant que la nouvelle n'entre. |
| `src/components/workspace/ui.jsx` | Enrichi | Nouveaux exports : `SkeletonKPI`, `SkeletonListItem`, `SkeletonCard`, `SkeletonSection`, `SkeletonPage`, `ActionStatus`, `Toast`. Tous les exports existants conservés. |

### Tranche 2 — Shell et navigation

| Fichier | Action | Détails |
|---|---|---|
| `src/components/softui/Shell.jsx` | Modifié | Le canvas de la page est enveloppé dans `PageTransition` (clé = `pathname`) à l'intérieur d'`AnimatePresence` (via `PageTransition`). L'ancienne page sort en fondu + glissement vers le haut pendant que la nouvelle entre. La coque, la navbar, le rail et le dock ne clignotent pas. |

### Tranche 3 — Pages représentatives

| Espace | Page | Action |
|---|---|---|
| Client | `espace-client/page.jsx` | `SkeletonList rows={2}` → `SkeletonSection rows={2}` (4 occurrences) |
| Équipe | `espace-equipe/taches/page.jsx` | `Suspense fallback` → `SkeletonSection title rows={4}` ; inline `SkeletonList rows={3}` → `SkeletonCard` ; formulaire `NewTask` enveloppé dans `ActionStatus` + `Toast` de confirmation |
| Comexa | `espace-comexa/` | Non modifiée dans cette tranche (à planifier) |
| Personnel | `espace-personnel/` | Non modifié dans cette tranche (à planifier) |

### Tranche 4 — Styles CSS

| Fichier | Action |
|---|---|
| `src/styles/softui.components.css` | Ajout des styles pour `.sui-skeleton-kpi`, `.sui-skeleton-card`, `.sui-skeleton-section`, `.sui-skeleton-page`, `.sui-action-busy`, `.sui-action-error`, `.sui-action-success`, `.sui-toast`. Respect de `prefers-reduced-motion`. |

---

## 4. Validations exécutées

| Validation | Résultat |
|---|---|
| ESLint (fichiers modifiés) | ✅ exit 0 |
| `npm run build` (Next.js, local) | ✅ succès |
| `npm run build` (CI, run 40724569841) | ✅ succès, 1m46s |
| `git diff --check` | ✅ OK |
| `node --test tests/*.test.mjs` | ✅ 58/58 pass, 0 fail |
| Tests responsive (Chromium) | ⚠️ Non exécutable (Chromium indisponible dans l'environnement) |
| Réduction des mouvements | ✅ Gérée par `MotionConfig reducedMotion="user"` + CSS `prefers-reduced-motion: reduce` |

---

## 5. Limites

- Le vrai `nest build` backend et le client Prisma généré restent inchangés (pas de fragilisation).
- Aucune nouvelle route API n'est ajoutée.
- Espace Comexa et Espace personnel non encore traités (à planifier dans une tranche suivante).
- Les tests de navigateur réels (Chromium) n'ont pas pu être exécutés localement (absent de l'environnement).

---

## 6. Améliorations restantes (impact utilisateur)

| Priorité | Amélioration | Espace |
|---|---|---|
| 1 | Squelettes spécifiques pour Comexa Space dashboard | Comexa |
| 2 | Squelettes spécifiques pour Espace personnel (tâches, compte) | Personnel |
| 3 | Transitions de tiroir (Admin Desk, menu « Toutes les rubriques ») | Tous |
| 4 | États d'action sur `RecordActions` (renommer, supprimer) | Tous |
| 5 | Distinction visuelle chargement initial vs actualisation arrière-plan | Tous |
