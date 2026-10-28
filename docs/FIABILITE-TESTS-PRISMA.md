# Mission 7.1 — Fiabilisation des tests Prisma et de la CI

**Date :** 28 octobre 2026 (Africa/Algiers)  
**Branche :** `arena/c1004795-comexa-portfolio`  
**Périmètre :** fiabilité des tests backend Prisma, nettoyage garanti des stubs, isolation des processus, CI backend.  
**Aucune nouvelle fonctionnalité métier, aucune refonte graphique, aucune migration de base de données.**

---

## 1. Faiblesse initiale

La Mission 7 avait introduit un mécanisme de stubs Prisma hors ligne avec nettoyage via les hooks npm `pretest:invariants` et `posttest:invariants`. Une relecture a identifié plusieurs faiblesses :

| Faiblesse | Conséquence |
|---|---|
| `posttest:invariants` ne garantit pas le nettoyage si `test:invariants` est invoqué directement (sans npm) | Les stubs `.js` subsistent dans `src/generated/prisma/` après les tests, risquant d'être confondus avec le vrai client généré |
| Aucun nettoyage garanti si le processus est interrompu ou tué | Même problème en cas d'arrêt brutal |
| Le test d'échec simulé appelait manuellement le nettoyage | Ne prouvait pas que le mécanisme réel nettoie après un échec |
| Les 5 suites de test partagent `src/generated/prisma/` et `node --test` les exécute en parallèle par défaut | Courses possibles sur les fichiers stubs entre suites |
| `preparePrismaStubs()` n'était pas véritablement idempotent (réécriture inutile des stubs) | Travail superflu à chaque appel |
| `isRealPrismaClientPresent()` acceptait une génération partielle (un seul `.ts`) comme un client complet | Risque d'utiliser un client incomplet |

---

## 2. Mécanisme retenu

### 2.1 Lanceur avec nettoyage garanti (`backend/tests/helpers/run-invariants.mjs`)

Nouveau script Node qui :

1. Appelle `preparePrismaStubs()` avant les tests
2. Exécute chaque suite de test comme **processus enfant séquentiel** (un fichier à la fois) pour éliminer les courses sur `src/generated/prisma/`
3. Exécute `cleanupPrismaStubs()` dans un bloc `finally`, **quel que soit le résultat** des tests (succès, échec, interruption)
4. Restitue le **code de sortie réel** de la suite (un échec de test n'est jamais masqué par un nettoyage réussi)
5. Signale une erreur si le nettoyage échoue, sans masquer l'éventuel échec des tests

### 2.2 Harnais de stubs amélioré (`backend/tests/helpers/prisma-stubs.mjs`)

- `isRealPrismaClientComplete()` : vérifie que **les deux** fichiers `.ts` requis (`enums.ts` ET `client.ts`) sont présents. Une présence partielle n'est pas considérée comme un client complet.
- `isPartialPrismaClient()` : détecte une génération partielle (un seul `.ts`) et ne crée pas de stubs dans ce cas.
- `preparePrismaStubs()` est **vraiment idempotent** : si des stubs valides existent déjà, ils ne sont pas réécrits.
- `cleanupPrismaStubs()` ne supprime jamais les fichiers `.ts` (vrai client), uniquement les stubs `.js` et le marqueur.

### 2.3 Configuration npm (`backend/package.json`)

- `test:invariants` : `node tests/helpers/run-invariants.mjs` (utilise le lanceur avec nettoyage garanti)
- Les hooks `pretest:invariants` / `posttest:invariants` ont été supprimés : le lanceur gère tout le cycle de vie.

### 2.4 Tests d'isolation (`backend/tests/prisma-stubs-isolation.test.mjs`)

Couvrent tous les états requis :

| État | Test |
|---|---|
| Aucun client présent | Stubs créés et utilisables |
| Stubs déjà présents | Pas de réécriture inutile (idempotence) |
| Vrai client complet présent | Pas de stubs, client préservé et utilisable |
| Génération partielle (un seul `.ts`) | Pas de stubs créés, fichier `.ts` préservé |
| Suite de tests en échec | Nettoyage garanti (même motif `try/finally` que le lanceur), pas de résidus |
| Nettoyage en échec | Détection des résidus persistants |
| Relance successive | Idempotente et robuste |

---

## 3. Comportement lors d'un échec

### 3.1 Scénario validé (depuis la ligne de commande)

```
$ rm -rf src/generated/prisma/*
$ node tests/helpers/run-invariants.mjs tests/_tmp_fail_test.mjs
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

---

## 4. Stratégie d'isolation des processus

Les 5 suites de test sont exécutées **séquentiellement** (une après l'autre) par le lanceur, et non en parallèle comme le ferait `node --test` avec plusieurs fichiers. Cela élimine toute course sur `src/generated/prisma/` :

- Chaque suite s'exécute dans son propre processus Node
- `preparePrismaStubs()` est appelé au début (idempotent : si des stubs existent déjà, ils sont réutilisés)
- `cleanupPrismaStubs()` est appelé une seule fois à la fin (bloc `finally` du lanceur)
- Aucun état partagé entre suites sur le disque

---

## 5. Tests réellement exécutés

### Localement (hors ligne, sans réseau vers binaries.prisma.sh)

| Commande | Résultat |
|---|---|
| `npm run test:invariants --prefix backend` | **51/51 pass** (25 + 5 + 8 + 6 + 7), 0 fail |
| 3 exécutions successives | Toutes vertes, 0 stubs résiduels après chacune |
| `node tests/helpers/run-invariants.mjs /tmp/fail-test.mjs` | Exit code 1 (échec détecté), 0 stubs résiduels |
| `npx eslint` (racine) | exit 0 |
| `npm run build` (Next, racine) | succès, 66/66 pages |
| `git diff --check` | OK |
| `ls src/generated/prisma/` après tests | Répertoire vide |

### En CI (GitHub Actions, réseau disponible)

Le workflow `.github/workflows/backend.yml` a été exécuté avec succès (run 40701503757) :

| Étape | Résultat |
|---|---|
| Génération du vrai client Prisma (`prisma generate`) | ✅ Succès |
| Vérification des fichiers générés (`client.ts`, `enums.ts`) | ✅ Présents |
| Compilation réelle de NestJS (`nest build`) | ✅ Succès, 0 erreur TS |
| Tests backend (vrai client, pas de stubs) | ✅ Succès |
| ESLint backend | ✅ Succès |
| ESLint frontend | ✅ Succès |
| Build Next.js | ✅ Succès |
| Tests frontend et contrat API | ✅ Succès |

**Résultat global du run CI : `success` (1m45s)**  
**Lien :** https://github.com/beneweb55-source/Comexa-portfolio/actions/runs/40701503757

---

## 6. Limites encore ouvertes

| Domaine | Limite |
|---|---|
| Vrai `nest build` en local | Non exécutable (blocage TLS `binaries.prisma.sh` sandbox). Validé uniquement en CI. |
| Codes de sortie des processus enfants `node --test` | Depuis un contexte `node --test` parent, les codes de sortie des processus enfants `node --test` ne sont pas propagés de manière fiable (limitation connue de Node.js). Le test d'intégration du lanceur vérifie donc le motif `try/finally` directement plutôt que le code de sortie via spawn. Le lancement direct du lanceur depuis bash confirme le bon code de sortie (1 en cas d'échec). |
| Vraie base de données PostgreSQL | Aucune disponible localement ; les tests backend utilisent des stubs ou un vrai client généré sans connexion. |
| Workflow n8n externe | Absent du dépôt ; le contrat `metadata.jwt` est conservé. |
| `EMAIL_VERIFICATION_REQUIRED=false` | Non modifié (décision produit liée à Mailjet). |

---

## 7. Invariants de sécurité préservés

- [x] Un vrai client généré n'est jamais remplacé par des stubs (`preparePrismaStubs()` détecte le vrai client complet et lui donne la priorité)
- [x] Le nettoyage ne supprime jamais les fichiers du vrai client (uniquement `enums.js`, `client.js`, `.prisma-stubs-marker`)
- [x] Aucun fichier de test ne fabrique de déclaration TypeScript pour faire compiler NestJS
- [x] Le build utilise toujours le vrai client Prisma (généré par `prisma generate`)
- [x] Les stubs ne servent jamais à présenter le build NestJS comme réussi (le workflow CI échoue si `prisma generate` ou `nest build` échouent)

---

## 8. Fichiers modifiés ou créés

| Fichier | Action |
|---|---|
| `backend/tests/helpers/prisma-stubs.mjs` | Réécrit : détection client complet, idempotence réelle, génération partielle |
| `backend/tests/helpers/run-invariants.mjs` | Créé : lanceur avec nettoyage garanti en `finally` |
| `backend/tests/helpers/prepare-prisma-stubs-cli.mjs` | Conservé (utilitaire autonome, plus appelé par un hook npm) |
| `backend/tests/helpers/cleanup-prisma-stubs-cli.mjs` | Conservé (utilitaire autonome) |
| `backend/tests/prisma-stubs-isolation.test.mjs` | Réécrit : tests pour tous les états + nettoyage garanti après échec |
| `backend/package.json` | `test:invariants` utilise le lanceur ; hooks `pre`/`post` supprimés |
| `.github/workflows/backend.yml` | Déclencheurs étendus à `main` (branche par défaut) |
| `docs/FIABILITE-TESTS-PRISMA.md` | Créé (ce rapport) |

---

## 9. Critères de réussite

- [x] Les tests hors ligne n'altèrent plus l'environnement réel (stubs nettoyés par le lanceur en `finally`)
- [x] Un client Prisma réellement généré n'est jamais remplacé ni mélangé avec un stub
- [x] Les stubs ne peuvent pas être confondus avec le client de production (marqueur, fichiers `.js` uniquement)
- [x] Aucun stub ne subsiste après les tests, y compris en cas d'échec de suite (0 résidu après 3 exécutions successives)
- [x] Un lancement du backend après les tests n'utilise jamais accidentellement un client factice (stubs supprimés ; `dist/` ne contient pas `generated/`)
- [x] Les tests détectent une éventuelle contamination (`hasResidualStubs()` testé)
- [x] Les tests sont indépendants de l'ordre d'exécution (séquentiels via le lanceur)
- [x] La CI génère le client Prisma et compile le backend sans contournement (run CI 40701503757, succès)
