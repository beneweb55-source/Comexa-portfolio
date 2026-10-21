# Application desktop Comexa

Fenêtre native (Electron) qui ouvre l'application Comexa hébergée sur le **hub
des espaces de travail** : une page centrale présente les trois espaces —
**Comexa Space**, **Espace personnel**, **Espace équipe** (et l'Espace client
pour les comptes clients) — et chaque carte ouvre l'espace correspondant, avec
ses routes, ses rôles et ses permissions existants.

L'application n'embarque **aucune copie du site** : elle charge le déploiement
Vercel (`https://comexa-portfolio.vercel.app` par défaut). C'est ce qui
préserve, à l'identique du navigateur :

- la session : cookie HttpOnly posé par `/api/auth`, rafraîchissement compris ;
- le CORS et le proxy `/api/*` du front vers le backend NestJS ;
- le temps réel : socket pointé par `NEXT_PUBLIC_SOCKET_URL`.

Un compte non connecté tombe sur `/connexion` (le hub redirige lui-même), puis
revient au hub une fois connecté. Aucun espace fictif, aucune API ajoutée : la
fenêtre n'est qu'un cadre de confiance autour du site existant.

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

Sans réseau, une page locale `offline.html` explique la situation et propose de
réessayer.

## Lancer en développement

```bash
cd desktop
npm install
npm start          # ouvre la fenêtre sur le hub
```

Prérequis : Node.js 20 ou plus récent. Le premier `npm install` télécharge le
binaire Electron (~100 Mo) ; il reste hors de Git (`node_modules/` ignoré).

## Configuration de l'adresse

L'origine est résolue dans cet ordre, du plus ponctuel au plus durable :

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

```bash
npm run dist         # cible du système hôte
npm run dist:win     # installeur NSIS (.exe)
npm run dist:mac     # image disque macOS
npm run dist:linux   # AppImage
```

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
| `main.js` | processus principal : fenêtre, verrou de navigation, menu, hors-ligne |
| `config.js` | résolution de l'origine et liste des routes ouvertes |
| `offline.html` | page locale affichée quand le service est injoignable |
| `desktop-config.example.json` | modèle de configuration par poste |
| `build/icon.ico` | icône Windows : exécutable, raccourci, installeur (16 → 256 px) |
| `build/icon.png` | icône macOS et Linux (1024 px, fond transparent) |
| `package.json` | paquet isolé du front : Electron ne pèse rien dans les déploiements Vercel |
