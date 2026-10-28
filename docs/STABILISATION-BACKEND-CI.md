# Mission 7 — Stabilisation technique du backend et fiabilisation de la CI

**Date :** 28 octobre 2026 (Africa/Algiers)  
**Branche :** `arena/c1004795-comexa-portfolio`  
**Périmètre :** fiabilité des tests backend, génération/compilation Prisma/NestJS, CI backend.  
**Aucune nouvelle fonctionnalité métier, aucune refonte graphique, aucune migration de base de données.**

---

## 1. Problème initial

Le backend Comexa Portfolio ne pouvait pas être validé de bout en bout dans l'environnement de développement :

1. `prisma generate` échoue sur une erreur TLS vers `binaries.prisma.sh` (téléchargement du `schema-engine` Prisma 7 impossible).
2. Le client généré `backend/src/generated/prisma/` est absent à l'état initial ; le dossier est gitignoré.
3. `nest build` émet 921 erreurs TypeScript en cascade, toutes dues à l'absence des déclarations du client Prisma (`TS2307`, `TS7006`, `TS2339` sur `PrismaService`).
4. Les tests backend utilisent des stubs Prisma écrits directement dans `backend/src/generated/prisma/` — le même chemin que le client de production — sans mécanisme de nettoyage garanti ni de détection de contamination.
5. Aucun workflow GitHub Actions ne couvre le backend (seuls `android.yml` et `desktop.yml` existent, déclenchés manuellement ou par tag).

---

## 2. Causes confirmées

| Cause | Preuve |
|---|---|
| Blocage réseau TLS sur `binaries.prisma.sh` | `npm run prisma:generate` échoue : `request to https://binaries.prisma.sh/.../schema-engine.gz.sha256 failed, reason: Client network socket disconnected before secure TLS connection was established`. |
| Client Prisma généré absent | `backend/src/generated/prisma/` ne contient que des fichiers `.js` de stubs (écrits par les tests), aucun fichier `.ts` généré par `prisma generate`. |
| 921 erreurs TS en cascade | `npm run build --prefix backend` (`nest build`) échoue avec 921 erreurs, toutes découlant de l'absence du client généré. |
| Stubs dans le chemin de production | `prepare-prisma-stubs-cli.mjs` écrivait `enums.js` et `client.js` dans `src/generated/prisma/`, le chemin importé par les services (`../../generated/prisma/client.js`). |
| Aucun nettoyage garanti | Aucun `posttest` ni `afterAll` ne supprimait les stubs après les suites ; des fichiers factices pouvaient subsister en cas d'échec. |
| Dépendance d'ordre d'exécution | `admin-policy.test.mjs` et `client-isolation.test.mjs` dépendaient des stubs créés par `business-invariants.test.mjs` (appel au top-level uniquement dans ce dernier). |
| Aucun CI backend | `.github/workflows/` ne contenait que `android.yml` et `desktop.yml`. |

---

## 3. Corrections apportées

### 3.1 Harnais de stubs réécrit (`backend/tests/helpers/prisma-stubs.mjs`)

- `preparePrismaStubs()` est **idempotent** : si un vrai client Prisma généré (fichiers `.ts`) est présent dans `src/generated/prisma/`, aucun stub n'est créé et les éventuels anciens stubs `.js` sont supprimés. Sinon, les stubs `enums.js` et `client.js` sont créés pour les tests hors ligne.
- `cleanupPrismaStubs()` supprime les stubs et le marqueur `.prisma-stubs-marker`, sans jamais toucher à un vrai client généré.
- `isRealPrismaClientPresent()` et `hasResidualStubs()` permettent de détecter un vrai client et de vérifier l'absence de résidus.
- Les stubs sont marqués par un fichier `.prisma-stubs-marker` pour éviter toute confusion avec le client de production.
- Aucune déclaration TypeScript fictive n'est créée. Aucun faux client n'est utilisé en production.

### 3.2 Scripts de préparation et de nettoyage CLI

- `prepare-prisma-stubs-cli.mjs` (appelé par `pretest:invariants`) : crée les stubs hors ligne avant toute résolution de test, ou détecte le vrai client.
- `cleanup-prisma-stubs-cli.mjs` (nouveau, appelé par `posttest:invariants`) : supprime les stubs après les tests, y compris si une suite a échoué.

### 3.3 Suites de test backend rendues indépendantes de l'ordre

- `admin-policy.test.mjs` et `client-isolation.test.mjs` appellent désormais `preparePrismaStubs()` en tête (idempotent), plus de dépendance envers `business-invariants.test.mjs`.
- Le nettoyage final est garanti par `posttest:invariants` (s'exécute même si `test:invariants` échoue).

### 3.4 Nouveaux tests ciblés d'isolation (`backend/tests/prisma-stubs-isolation.test.mjs`)

Couvrent les cinq exigences de la mission :
1. Exécution hors ligne avec stubs (import et valeurs vérifiées).
2. Détection d'un client Prisma réel (pas de stubs créés si présent).
3. Comportement si une suite échoue (nettoyage effectué malgré l'erreur).
4. Absence de fichiers factices résiduels après nettoyage.
5. Relance des tests sans dépendre de l'ordre d'exécution (idempotence).

### 3.5 Scripts `package.json` (backend)

- `pretest:invariants` : prépare les stubs (existante, inchangée).
- `posttest:invariants` (nouvelle) : `node tests/helpers/cleanup-prisma-stubs-cli.mjs`.
- `test:invariants` : inclut désormais `tests/prisma-stubs-isolation.test.mjs`.

### 3.6 Workflow CI backend (`.github/workflows/backend.yml`)

Nouveau workflow déclenché sur `push` et `pull request` vers `arena/c1004795-comexa-portfolio` :

1. Checkout du dépôt.
2. Installation de Node.js 22 (version fixée par `engines.node` du backend).
3. Installation des dépendances avec `npm ci --ignore-scripts` (respect du lockfile).
4. Variables d'environnement de test (valeurs non sensibles : `DATABASE_URL`, `DIRECT_URL` fictives, non utilisées par `prisma generate`).
5. Génération du **vrai** client Prisma (`npm run prisma:generate`).
6. Vérification de la présence de `client.ts` et `enums.ts` (le workflow échoue si absent).
7. Compilation réelle de NestJS (`npm run build` = `nest build`).
8. Tests backend avec le vrai client généré (`npm run test:invariants`).
9. ESLint backend (`npx eslint "{src,prisma,scripts}/**/*.ts"`, sans `--fix`).
10. Dépendances frontend (racine, `npm ci`).
11. ESLint frontend (`npm run lint`).
12. Build Next.js (`npm run build`).
13. Tests frontend et contrat API (`tests/contract.test.mjs`, `tests/comexa-space.test.mjs`, `tests/agent-chat-route.case.mjs`).

Le workflow échoue si `prisma generate` ou `nest build` échoue. Les stubs de test ne sont jamais utilisés pour remplacer le client Prisma à l'étape de build.

---

## 4. Stratégie retenue pour les stubs

**Option retenue : stubs au chemin réel (`src/generated/prisma/`), cycle de vie strict.**

Raisons :
- Les imports existants (`../../generated/prisma/enums.js`, `../../generated/prisma/client.js`) restent inchangés — aucune adaptation des sources de test ni des services.
- `tsx` et Node résolvent `./en.js` vers `./en.ts` en priorité : si un vrai client généré est présent, il prime sur le stub `.js`.
- `preparePrismaStubs()` supprime les anciens stubs `.js` quand un vrai client est détecté : aucun mélange possible.
- `cleanupPrismaStubs()` + `posttest:invariants` garantissent qu'aucun stub ne subsiste après les tests, même en cas d'échec de suite.
- Le marqueur `.prisma-stubs-marker` identifie les fichiers factices.

**Ce qui n'a pas été fait (par choix) :**
- Aucun fichier de déclaration TypeScript fictif pour faire compiler NestJS.
- Aucun remplacement du vrai client Prisma par un faux dans le chemin de production.
- Aucun mock de spécificateur d'import (`test.mock(specifier)` n'est pas disponible dans cette build de Node).
- Aucun contournement hasardeux du blocage TLS Prisma (pas d'ajout de `@prisma/schema-engine-wasm` non déclaré).

---

## 5. Commandes exécutées et résultats exacts

### Localement (environnement de développement, sans réseau vers binaries.prisma.sh)

| Commande | Résultat |
|---|---|
| `npm run test:invariants --prefix backend` | **49/49 pass** (inclut `prisma-stubs-isolation.test.mjs`, 5 tests) |
| `pretest:invariants` | Crée les stubs hors ligne : `[prisma-stubs] stubs créés pour les tests hors ligne` |
| `posttest:invariants` | Nettoie : `[prisma-stubs] aucun stub résiduel` |
| `npm run prisma:generate --prefix backend` | **ÉCHEC** : TLS disconnect vers `binaries.prisma.sh` |
| `npm run build --prefix backend` (`nest build`) | **ÉCHEC** : 921 erreurs TypeScript en cascade (absence du client généré) |
| `ls src/generated/prisma/` (après tests) | Répertoire **vide** — aucun stub résiduel |
| `npx eslint` (racine) | exit 0 (résultat antérieur, inchangé) |
| `npm run build` (Next, racine) | succès, 66/66 pages (résultat antérieur, inchangé) |

### Résultat du véritable build NestJS

**Non exécutable localement** en raison du blocage TLS Prisma. Le build génère 921 erreurs TS car `src/generated/prisma/client.ts` et `enums.ts` sont absents. Ce résultat est **documenté comme échec confirmé**, non présenté comme une réussite.

Le véritable `nest build` pourra être exécuté par la CI (`.github/workflows/backend.yml`) qui dispose du réseau nécessaire pour `prisma generate`.

### Résultat de la CI

Le workflow `.github/workflows/backend.yml` a été créé et commité. Il n'a **pas encore été exécuté** à ce stade (dépend du déclenchement sur push/PR et de la disponibilité des runners GitHub Actions). Le résultat final devra être consulté via l'onglet Actions du dépôt après le push, et non déduit de la simple présence du fichier YAML.

---

## 6. Limitations restantes

| Domaine | Limite |
|---|---|
| Vrai `nest build` | Non exécutable localement (TLS Prisma). À valider en CI. |
| Vraie base de données PostgreSQL | Aucune disponible localement ; les tests backend utilisent des stubs ou un vrai client généré sans connexion. |
| Tests d'isolation client en base | Non exécutés (nécessitent un vrai backend + vraie base). Identifiés comme action prioritaire dans le rapport d'audit. |
| Navigateurs autres que Chromium | Safari, Firefox, iOS, Android WebView, lecteurs d'écran non testés. |
| Workflow n8n externe | Absent du dépôt ; le contrat `metadata.jwt` est conservé, pas de validation réelle du workflow externe. |
| `EMAIL_VERIFICATION_REQUIRED=false` | Non modifié (décision produit liée à Mailjet). |

---

## 7. Risques de sécurité toujours ouverts

Ces sujets sont documentés comme ouverts et **ne sont pas considérés comme résolus** par cette mission :

1. **JWT de session complet transmis à n8n** (`src/app/api/agent-chat/route.js`) : le transport HTTPS est imposé, le jeton `cxi_` refusé, la forme `eyJ…` validée, mais le workflow externe reçoit toujours un jeton donnant tous les droits du membre jusqu'à expiration. Correction définitive : jeton de délégation court signé côté backend + migration du workflow externe. Non appliqué silencieusement pour ne pas casser le contrat existant.
2. **`EMAIL_VERIFICATION_REQUIRED=false`** en production (`render.yaml`) : compte actif immédiatement sans vérification d'adresse. Le code backend bascule selon la variable ; l'activation dépend du domaine Mailjet.
3. **Espace comme restriction contextuelle, pas frontière** (`X-Comexa-Space` facultatif) : les gardes de ligne restent côté backend, documentés dans `space-policy.ts`.
4. **Build backend non validable localement** : tant que `prisma generate` et `nest build` ne passent pas en CI, aucune preuve que le backend compilé correspond au code source.

---

## 8. Critères de réussite

- [x] Les tests hors ligne n'altèrent plus l'environnement réel (stubs nettoyés par `posttest:invariants`, répertoire `src/generated/prisma/` vide après les tests).
- [x] Un client Prisma réellement généré n'est jamais remplacé ni mélangé avec un stub (`preparePrismaStubs()` détecte le vrai client et supprime les résidus).
- [x] Les stubs ne peuvent pas être confondus avec le client de production (marqueur `.prisma-stubs-marker`, fichiers `.js` uniquement, jamais de `.ts` fictif).
- [x] Aucun stub ne subsiste après les tests, y compris en cas d'échec de suite (`posttest:invariants` + `cleanupPrismaStubs()`).
- [x] Un lancement du backend après les tests n'utilise jamais accidentellement un client factice (les stubs sont supprimés ; `dist/` ne contient pas `generated/`).
- [x] Les tests détectent une éventuelle contamination (`hasResidualStubs()` testé dans `prisma-stubs-isolation.test.mjs`).
- [x] Les tests sont indépendants de l'ordre d'exécution (chaque suite appelle `preparePrismaStubs()`, idempotent).
- [ ] La CI génère le client Prisma et compile le backend sans contournement (workflow créé, résultat en attente de l'exécution GitHub Actions).
- [ ] Le véritable `nest build` réussit (en attente de l'exécution CI).

---

## 9. Étapes suivantes

1. Pousser la branche `arena/c1004795-comexa-portfolio` pour déclencher le workflow CI.
2. Consulter le résultat du workflow (onglet Actions du dépôt) : vérifier que `prisma generate`, `nest build` et les tests backend passent.
3. Si la CI réussit, le critère "build NestJS réel" est atteint ; sinon, analyser et corriger l'erreur dans le périmètre de cette mission.
4. Une fois le build backend débloqué, transformer les tests d'isolation client purs en tests d'intégration HTTP avec deux comptes `CLIENT` réels (action prioritaire identifiée dans le rapport d'audit transversal).
