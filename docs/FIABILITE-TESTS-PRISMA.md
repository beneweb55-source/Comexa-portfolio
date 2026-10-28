# Mission 7.2 — Fiabilisation des tests Prisma et de la CI

**Date :** 28 octobre 2026 (Africa/Algiers)  
**Branche :** `arena/c1004795-comexa-portfolio`  
**Périmètre :** fiabilité des tests backend Prisma, nettoyage garanti des stubs, isolation des processus, CI backend.  
**Aucune nouvelle fonctionnalité métier, aucune refonte graphique, aucune migration de base de données.**

---

## 1. Faiblesse initiale

La Mission 7.1 avait introduit un mécanisme de stubs Prisma hors ligne avec nettoyage via le lanceur `run-invariants.mjs`. Une relecture a identifié plusieurs défauts résiduels :

| Défaut | Conséquence |
|---|---|
| `stubsAreValid()` vérifiait deux fois le même chemin (`full.replace(/\.js$/, '.js')`) | Aucune validation réelle du contenu des fichiers stubs |
| Aucun test pour les stubs absents, vides ou incomplets | Impossible de détecter un stub corrompu |
| Le test d'échec du lanceur simulait manuellement `try/finally` | Ne prouvait pas que le lanceur réel nettoie après un échec |
| Aucune gestion explicite des signaux d'arrêt (SIGINT/SIGTERM) | Interruption du lanceur sans garantie de nettoyage |
| Pas de distinction claire entre tests automatisés, manuels et CI | Rapports ambigus sur ce qui est réellement vérifié |

---

## 2. Mécanisme retenu

### 2.1 Validation des stubs (`stubsAreValid()`) — `backend/tests/helpers/prisma-stubs.mjs`

`stubsAreValid()` vérifie désormais :

1. Les deux fichiers stubs existent (`enums.js`, `client.js`) et sont non vides
2. Le marqueur `.prisma-stubs-marker` existe avec le contenu attendu (`do not use in production`)
3. `client.js` contient bien `class PrismaClient`
4. `enums.js` contient bien au moins une exportation `Object.freeze`

`preparePrismaStubs()` utilise cette validation :
- Si des stubs valides existent déjà → idempotence, pas de réécriture
- Si des stubs invalides existent → nettoie uniquement les fichiers identifiés comme stubs, puis recrée proprement
- Si un vrai client complet (`.ts`) est présent → priorité absolue, aucun stub créé
- Si une génération partielle (un seul `.ts`) → aucun stub créé, aucun fichier `.ts` supprimé
- L'état ambigu (stubs invalides sans génération partielle) est résolu par nettoyage + recréation

### 2.2 Gestion des interruptions — `backend/tests/helpers/run-invariants.mjs`

Le lanceur gère désormais explicitement les signaux d'arrêt ordinaires :

- **SIGINT** : tue le processus enfant, exécute le nettoyage des stubs, quitte avec code 130
- **SIGTERM** : tue le processus enfant, exécute le nettoyage des stubs, quitte avec code 143
- **SIGKILL** : **ne peut pas être intercepté** — aucune garantie de nettoyage (documenté comme limite)

Le processus enfant est tué avant le nettoyage pour éviter qu'il n'écrive dans `src/generated/prisma/` pendant le nettoyage. Le bloc `finally` vérifie qu'aucun signal n'est en cours de traitement pour éviter un double nettoyage.

### 2.3 Tests d'intégration automatisés — `backend/tests/prisma-stubs-isolation.test.mjs`

Nouveaux tests :

| État | Test | Automatisé |
|---|---|---|
| Aucun client présent | Stubs créés et utilisables | ✅ |
| Stubs déjà présents | Pas de réécriture inutile (idempotence) | ✅ |
| Vrai client complet présent | Pas de stubs, client préservé | ✅ |
| Génération partielle (un seul `.ts`) | Pas de stubs, `.ts` préservé | ✅ |
| Stubs absents | `stubsAreValid()` retourne false | ✅ |
| Stubs vides | `stubsAreValid()` retourne false | ✅ |
| Stubs incomplets | `stubsAreValid()` retourne false | ✅ |
| Stubs valides | `stubsAreValid()` retourne true | ✅ |
| Stubs invalides → recréation | `preparePrismaStubs()` recrée proprement | ✅ |
| Lanceur avec suite défaillante | Sous-processus, code de sortie non nul, nettoyage garanti | ✅ |
| Relance successive | Idempotente et robuste | ✅ |

### 2.4 Validation autonome du lanceur — `backend/tests/helpers/validate-launcher.mjs`

Script exécutable **hors contexte `node --test`** (directement avec `node`) pour vérifier de manière fiable le code de sortie du lanceur :

| Scénario | Code de sortie attendu | Résultat |
|---|---|---|
| Suite défaillante | Non nul (1) | ✅ Vérifié |
| Suite réussie | 0 | ✅ Vérifié |
| Exécution complète | 0 | ✅ Vérifié |

Usage : `node tests/helpers/validate-launcher.mjs`

---

## 3. Comportement lors d'un échec

### 3.1 Scénario validé (ligne de commande)

```
$ rm -rf src/generated/prisma/*
$ node tests/helpers/run-invariants.mjs tests/fixtures/failing-suite.test.mjs
# ... TAP output montrant l'échec ...
[run-invariants] nettoyage : enums.js, client.js, .prisma-stubs-marker supprimés
$ echo $?
1
$ ls src/generated/prisma/
# (répertoire vide)
```

Résultats :
- Code de sortie : **1** (non nul, l'échec n'est pas masqué)
- Stubs résiduels : **0**
- Vrai client `.ts` : jamais touché

### 3.2 Scénario de nettoyage défaillant

Si `cleanupPrismaStubs()` ne peut pas supprimer un fichier (permissions, verrou), l'erreur est consignée sur `stderr` et le processus quitte avec code non nul, sans masquer l'éventuel échec des tests.

### 3.3 Interruptions (SIGINT/SIGTERM)

| Signal | Comportement | Code de sortie | Nettoyage garanti |
|---|---|---|---|
| SIGINT (Ctrl+C) | Tue l'enfant, nettoie, quitte | 130 | ✅ Oui |
| SIGTERM | Tue l'enfant, nettoie, quitte | 143 | ✅ Oui |
| SIGKILL | Ne peut pas être intercepté | — | ❌ Non (limite documentée) |
| Panne système | Ne peut pas être interceptée | — | ❌ Non (limite documentée) |

---

## 4. Stratégie d'isolation des processus

Les suites de test sont exécutées **séquentiellement** (un processus enfant à la fois) par le lanceur, éliminant toute course sur `src/generated/prisma/` :

- Chaque suite s'exécute dans son propre processus Node
- `preparePrismaStubs()` est appelé au début (idempotent)
- `cleanupPrismaStubs()` est appelé une seule fois à la fin (bloc `finally`)
- Aucun état partagé entre suites sur le disque

---

## 5. Tests réellement exécutés

### 5.1 Tests automatisés (dans `node --test`)

| Commande | Résultat |
|---|---|
| `npm run test:invariants --prefix backend` | **55/55 pass** (25 + 5 + 8 + 6 + 11), 0 fail |
| 3 exécutions successives | Toutes vertes, 0 stubs résiduels |
| `npx eslint` (racine) | exit 0 |
| `npm run build` (Next, racine) | succès, 66/66 pages |
| `git diff --check` | OK |
| `ls src/generated/prisma/` après tests | Répertoire vide |

### 5.2 Vérifications manuelles (ligne de commande)

| Vérification | Résultat |
|---|---|
| Lanceur + suite défaillante | Exit code 1, 0 stubs résiduels |
| Préservation du vrai client `.ts` | Fichiers `.ts` intacts après tests |
| `node tests/helpers/validate-launcher.mjs` | SUCCÈS (3 scénarios) |

### 5.3 En CI (GitHub Actions, réseau disponible)

Le workflow `.github/workflows/backend.yml` a été exécuté avec succès :

| Run | Statut | Durée | Lien |
|---|---|---|---|
| 40701503757 (Mission 7.1) | ✅ success | 1m45s | [Voir le run](https://github.com/beneweb55-source/Comexa-portfolio/actions/runs/40701503757) |
| 40705447917 (Mission 7.2) | ✅ success | 2m09s | [Voir le run](https://github.com/beneweb55-source/Comexa-portfolio/actions/runs/40705447917) |

Étapes validées en CI (run 40705447917) :
- Génération du vrai client Prisma (`prisma generate`) ✅
- Vérification des fichiers générés (`client.ts`, `enums.ts`) ✅
- Compilation réelle de NestJS (`nest build`) ✅, 0 erreur TS
- Tests backend (vrai client, pas de stubs) ✅
- ESLint backend ✅
- ESLint frontend ✅
- Build Next.js ✅
- Tests frontend et contrat API ✅

---

## 6. Limites encore ouvertes

| Domaine | Limite |
|---|---|
| Vrai `nest build` en local | Non exécutable (blocage TLS `binaries.prisma.sh` sandbox). Validé uniquement en CI. |
| Codes de sortie enfants depuis `node --test` | Les codes de sortie des processus enfants `node --test` ne sont pas toujours propagés de manière fiable depuis un contexte `node --test` parent. Validé par `validate-launcher.mjs` (processus indépendant) et exécution directe bash. |
| Vraie base de données PostgreSQL | Aucune disponible localement ; les tests backend utilisent des stubs ou un vrai client généré sans connexion. |
| Workflow n8n externe | Absent du dépôt ; le contrat `metadata.jwt` est conservé. |
| `EMAIL_VERIFICATION_REQUIRED=false` | Non modifié (décision produit liée à Mailjet). |
| Nettoyage après SIGKILL / panne système | Impossible à garantir — signaux non interceptables. |

---

## 7. Invariants de sécurité préservés

- [x] Un vrai client généré n'est jamais remplacé par des stubs
- [x] Le nettoyage ne supprime jamais les fichiers `.ts` du vrai client
- [x] Aucun fichier de test ne fabrique de déclaration TypeScript pour faire compiler NestJS
- [x] Le build utilise toujours le vrai client Prisma (généré par `prisma generate`)
- [x] Les stubs ne servent jamais à présenter le build NestJS comme réussi

---

## 8. Fichiers modifiés ou créés

| Fichier | Action |
|---|---|
| `backend/tests/helpers/prisma-stubs.mjs` | `stubsAreValid()` corrigé (contenu, marqueur, intégrité) ; `preparePrismaStubs()` utilise la validation |
| `backend/tests/helpers/run-invariants.mjs` | Gestion SIGINT/SIGTERM, arrêt du processus enfant, nettoyage garanti |
| `backend/tests/helpers/validate-launcher.mjs` | Créé : validation autonome du lanceur hors `node --test` |
| `backend/tests/helpers/prepare-prisma-stubs-cli.mjs` | Conservé (utilitaire autonome) |
| `backend/tests/helpers/cleanup-prisma-stubs-cli.mjs` | Conservé (utilitaire autonome) |
| `backend/tests/prisma-stubs-isolation.test.mjs` | Tests stubsAreValid + test d'intégration du lanceur |
| `backend/tests/fixtures/failing-suite.test.mjs` | Créé : fixture dédiée pour le test du lanceur |
| `backend/package.json` | `test:invariants` utilise le lanceur |
| `.github/workflows/backend.yml` | Déclencheurs étendus à `main` |
| `docs/FIABILITE-TESTS-PRISMA.md` | Mis à jour (ce rapport) |

---

## 9. Critères de réussite

- [x] Les stubs invalides sont détectés (`stubsAreValid()` pour absent, vide, incomplet, valide)
- [x] Le comportement du véritable lanceur est testé automatiquement en cas d'échec (sous-processus avec fixture dédiée)
- [x] Les limites d'interruption sont honnêtement documentées (SIGKILL non couvert)
- [x] La CI reste verte (run 40705447917, succès)
- [x] Les tests hors ligne n'altèrent plus l'environnement réel (0 stubs résiduels après 3 exécutions)
- [x] Un client Prisma réellement généré n'est jamais remplacé ni mélangé avec un stub
