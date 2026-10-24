# Application desktop Comexa

Fenêtre native (Electron) qui embarque l'interface Comexa et l'ouvre sur le
**hub des espaces de travail** : une page centrale présente les espaces puis
chaque carte ouvre l'espace correspondant, avec ses routes, rôles et
permissions existants.

Dans l'installateur, un serveur Next.js autonome local sert l'interface. Le
backend NestJS reste distant. Après un premier login en ligne confirmé, le `.exe`
peut authentifier localement le même utilisateur pendant au plus sept jours et
relire les réponses GET déjà consultées, stockées dans une base SQLite chiffrée.
Les sessions desktop sont distinctes de celles du navigateur.

**Limite actuelle :** les écritures ne sont pas mises en file et ne fonctionnent
pas hors ligne ; documents/PDF, téléchargements, messagerie temps réel et
intégrations restent en ligne. Les lectures hors ligne ne couvrent que les
réponses déjà mises en cache. Voir [`OFFLINE-MODE.md`](./OFFLINE-MODE.md) et
l'inventaire [`OFFLINE-INVENTORY.md`](./OFFLINE-INVENTORY.md).

## Périmètre de navigation

Seules ces routes sont ouvertes dans la fenêtre (voir `config.js`) :

| Route | Rôle |
| --- | --- |
| `/espaces` | hub des espaces (écran d'entrée) |
| `/espace-personnel/**`, `/espace-equipe/**`, `/espace-comexa/**`, `/espace-client/**` | les espaces et leurs pages |
| `/connexion`, `/inscription`, `/mot-de-passe-oublie`, `/reset-password`, `/verify-email` | parcours de connexion |

Tout le reste est refusé — notamment le site public (vitrine, réalisations,
partenaires) : la fenêtre est un outil de travail. Une adresse d'un **autre
domaine** part dans le navigateur du système. `window.open` et les liens
`_blank` sont refusés : **aucune fenêtre supplémentaire**. Le verrou porte sur
`will-navigate` (chargements complets) **et** `did-navigate-in-page`
(navigation client-side Next.js, pushState), plus `setWindowOpenHandler`.

`offline.html` reste une page de secours en cas d'échec du frontend, pas le mode
hors ligne. L'inventaire par écran et les limites actuelles sont décrits dans
[`OFFLINE-INVENTORY.md`](./OFFLINE-INVENTORY.md).

## L'écran d'entrée porte l'esthétique du dashboard

La fenêtre s'ouvre sur `/espaces`, le hub des espaces — et ce hub est habillé
**comme le dashboard**, avec les mêmes pièces : la coque noire bord à bord, la
navbar noire et sa languette sous l'onglet actif, le rail gauche, le panneau
clair, les cartes pastel et le dock flottant (`src/components/softui/HubScreen.jsx`).

Les deux applications n'affichent donc jamais une page de site public : le
premier écran du `.exe` est déjà le produit. La **page de connexion** — que l'on
rencontre avant d'être connecté — repose sur la même coque : barre noire, marque
claire, panneau clair.

## Lancer en développement

Pour tester aussi le parcours hors connexion, il faut d'abord compiler le
frontend embarqué. Depuis la racine du dépôt :

```bash
npm ci
cd desktop
npm ci
npm run build:web  # construit le frontend autonome local
npm start           # ouvre la fenêtre sur le hub local
```

`npm start` sans `build:web` est un mode de développement hébergé : il ouvre le
site configuré et nécessite Internet. Il ne représente pas le comportement de
l'installateur hors ligne. Prérequis : Node.js 20 ou plus récent. Le premier
`npm ci` desktop télécharge le binaire Electron (~100 Mo) ; il reste hors de Git
(`node_modules/` ignoré).

## Configuration de l'adresse de repli

Dans l'installateur, le frontend est servi localement ; il ne se rabat jamais
silencieusement sur un site distant si le bundle local manque. `origin` sert
uniquement au lancement en développement sans frontend embarqué. Cette adresse
est résolue dans cet ordre, du plus ponctuel au plus durable :

1. `--origin=https://…` sur la ligne de commande ;
2. variable d'environnement `COMEXA_DESKTOP_ORIGIN` ;
3. `desktop-config.json` **à côté de l'exécutable** (réglage d'un poste installé) ;
4. `desktop-config.json` dans `resources/` puis dans le paquet applicatif ;
5. `desktop-config.json` dans le dossier de données utilisateur ;
6. valeur par défaut compilée : `https://comexa-portfolio.vercel.app`.

Modèle à copier : `desktop-config.example.json`. Tous les champs sont
optionnels ; une valeur illisible est écartée avec un avertissement, jamais
fatale.

```json
{
  "origin": "https://comexa-portfolio.vercel.app",
  "startPath": "/espaces",
  "window": { "width": 1440, "height": 900 },
  "startMaximized": false,
  "startFullscreen": false,
  "devTools": false
}
```

`devTools: true` ajoute l'entrée « Outils développeur » au menu Navigation
(désactivée par défaut sur un poste de travail).

## Compiler un installable

Le script `build:web` compile Next.js en mode standalone, fixe l'adresse du
backend et copie les ressources statiques dans le bundle. `dist:*` l'exécute
automatiquement avant electron-builder. Depuis la racine du dépôt :

```bash
npm ci
cd desktop
npm ci
npm run dist:win     # installeur NSIS (.exe)
# ou : npm run dist / dist:mac / dist:linux selon le système cible
```

Le relais API par défaut est `https://comexa-portfolio.onrender.com`. Pour une
autre instance, définir `BACKEND_URL` et `NEXT_PUBLIC_SOCKET_URL` dans
l'environnement avant `npm run dist:win`.

Le résultat sort dans `desktop/dist/` (ignoré par Git). Les icônes de
`build/` reprennent le dessin de `src/app/icon.svg` :

- `build/icon.ico` porte sept résolutions (16 à 256 px) et sert à
  l'exécutable, au raccourci, à l'installeur et au désinstalleur Windows ;
- `build/icon.png` (1024 px, fond transparent) sert macOS et Linux.

Le `.ico` est versionné plutôt que dérivé au build : electron-builder
rééchantillonne un PNG correctement pour l'exécutable et le raccourci, mais
l'icône de l'installeur NSIS ressort alors floue. Fournir les deux tailles
évite cette dégradation.

Compilation croisée : produire un `.exe` depuis Linux ou macOS demande les
outils indiqués par electron-builder (Wine pour l'édition de l'icône de
l'exécutable). Le chemin recommandé reste le runner Windows ci-dessous.

## Compilation automatique (GitHub Actions)

`.github/workflows/desktop.yml` compile l'installeur Windows :

- à la main : onglet **Actions → Application desktop → Run workflow** ;
- ou en poussant une étiquette `desktop-v*` (ex. `desktop-v1.0.0`).

L'installeur est déposé en artefact `comexa-desktop-windows` (conservation
30 jours). Rien n'est publié automatiquement : diffuser reste un geste humain.

## Contenu du dossier

| Fichier | Rôle |
| --- | --- |
| `main.js` | processus principal : serveur Next, fenêtre, IPC allowlisté, chiffrement et secours |
| `build-frontend.cjs` | build standalone Next + copie des ressources pour electron-builder |
| `preload.js` | API IPC minimale exposée au renderer (`contextIsolation`) |
| `offline-store.js` | SQLite WASM chiffrée via `safeStorage`, migrations, profils, cache de lectures |
| `config.js` | résolution de l'origine de repli et liste des routes ouvertes |
| `../.next/standalone/` | frontend Next autonome embarqué dans l'installateur |
| `OFFLINE-MODE.md` | décisions retenues, sécurité, état réel et phases du mode hors ligne |
| `OFFLINE-INVENTORY.md` | inventaire des espaces, écrans, domaines et couverture actuelle |
| `offline.html` | page locale affichée quand le service est injoignable |
| `desktop-config.example.json` | modèle de configuration par poste |
| `build/icon.ico` | icône Windows : exécutable, raccourci, installeur (16 → 256 px) |
| `build/icon.png` | icône macOS et Linux (1024 px, fond transparent) |
| `package.json` | paquet isolé du front : Electron ne pèse rien dans les déploiements Vercel |
