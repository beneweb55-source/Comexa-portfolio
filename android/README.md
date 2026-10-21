# Application Android Comexa

APK natif minimal : une **WebView verrouillée** sur le service Comexa hébergé,
pendant mobile de l'application desktop (`desktop/`). Même principe, mêmes
garde-fous : aucune copie du site n'est embarquée, la WebView ouvre
`https://comexa-portfolio.vercel.app` **sur le hub `/espaces`** — l'écran central
des trois espaces (Comexa Space, Espace personnel, Espace équipe, plus l'Espace
client selon le compte).

Comme pour le desktop, charger l'URL distante préserve à l'identique :

- la **session** : cookie HttpOnly posé par `/api/auth`, persisté par la WebView
  (`CookieManager`), donc connexion, déconnexion et reconnexion fonctionnent ;
- le **temps réel** : socket.io passe dans la WebView ; le centre de
  notifications du site et ses compteurs de non-lus vivent dessus ;
- le **CORS** et le proxy `/api/*` du front vers le backend NestJS.

## Exigences couvertes

1. **Même expérience que le `.exe`** : ouverture directe sur
   `{origine}/espaces`, navigation vers les trois espaces, interface bord à
   bord — la fenêtre s'étire sous les barres système, noires comme la coque
   (`--shell`), et le contenu est rembourré par les insets système (la navbar
   du site arrive sous l'horloge, sans marge blanche).
2. **Sécurité** : HTTPS strict (`usesCleartextTraffic="false"`, tout certificat
   douteux coupe le chargement, `http:` refusé) ; navigation limitée à
   l'origine configurée et aux chemins d'`AppConfig` (hub, espaces, parcours de
   connexion) ; **aucune interface JavaScript native** (pas de
   `addJavascriptInterface`) ; aucune fenêtre supplémentaire
   (`onCreateWindow` → false) ; les autres domaines, `mailto:` et `tel:`
   partent aux applications du téléphone ; ni accès fichiers ni accès contenu
   pour le site.
3. **Fonctionnement réel** : session persistée (`flush` des cookies en
   arrière-plan) ; déconnexion pilotée par le site ; notifications et temps
   réel via le socket du site ; téléchargements des factures et devis PDF via
   le `DownloadManager` système, **avec le cookie de session recopié** dans la
   requête (l'API de téléchargement est authentifiée) ; permission de
   notification demandée sur Android 13+.
4. **APK vérifié** : compilation GitHub Actions (`android.yml`), vérification
   de la signature (`apksigner verify`) et des métadonnées (`aapt2 badging` :
   paquet, activité, permissions, SDK) dans le run, artefact `comexa-android`.

## Périmètre de navigation

Identique au desktop (`desktop/config.js` ↔ `AppConfig.java`) : `/espaces`,
`/espace-personnel/**`, `/espace-equipe/**`, `/espace-comexa/**`,
`/espace-client/**`, `/connexion`, `/inscription`, `/mot-de-passe-oublie`,
`/reset-password`, `/verify-email`. Le verrou porte sur chaque chargement
(`shouldOverrideUrlLoading`) **et** sur les navigations pushState de Next.js
(`doUpdateVisitedHistory`, miroir de `did-navigate-in-page`) : une route hors
périmètre ramène au hub. Sans réseau, la page locale `offline.html` (servie
sans origine privilégiée) propose de réessayer.

## L'écran d'entrée porte l'esthétique du dashboard

Le hub `/espaces` — l'écran d'accueil de l'APK — est habillé **comme le
dashboard**, avec les mêmes pièces : la coque noire bord à bord, la navbar
noire et sa languette sous l'onglet actif, le rail gauche, le panneau clair,
les cartes pastel et le dock flottant (`src/components/softui/HubScreen.jsx`).

Sur téléphone, la coque bascule sur son chrome mobile : barre d'application
noire en haut (marque claire), barre d'onglets en bas. La **page de
connexion** — avant d'être connecté — repose sur la même coque.

L'application n'affiche donc jamais une page de site public : le premier
écran de l'APK est déjà le produit.

## Adresse du service

Configurable à la compilation, sans toucher au code :

```bash
./gradlew assembleDebug -PcomexaOrigin=https://exemple.internal
# ou
COMEXA_ANDROID_ORIGIN=https://exemple.internal ./gradlew assembleDebug
```

Défaut : `https://comexa-portfolio.vercel.app`.

## Compiler en local

Prérequis : JDK 17 et le SDK Android (plateforme 35) — Android Studio les
fournit ; en ligne de commande, ouvrir le dossier `android/` ou :

```bash
cd android
./gradlew assembleDebug
# APK : app/build/outputs/apk/debug/app-debug.apk
```

## Compilation automatique (GitHub Actions)

`.github/workflows/android.yml` : runner `ubuntu-latest`, JDK 17, SDK 35,
déclenchement manuel ou par étiquette `android-v*`. L'APK signé (certificat de
débogage du runner, installable tel quel) est déposé en artefact
`comexa-android`, conservation 30 jours.

## Protocole de test sur téléphone

1. Installer l'APK (autoriser les sources inconnues pour le navigateur ou le
   gestionnaire de fichiers qui l'ouvre).
2. Lancement : écran noir de coque puis hub `/espaces` ; non connecté →
   `/connexion` ; se connecter → retour au hub ; ouvrir chaque espace.
3. Bord à bord : aucune marge blanche autour de l'interface ; barres système
   noires prolongeant la coque.
4. Navigation : le logo ou une URL du site public ne doit pas sortir du
   périmètre (retour au hub) ; un lien externe ouvre le navigateur.
5. Session : tuer l'application, la relancer → toujours connecté ; se
   déconnecter → `/connexion`.
6. PDF : ouvrir une facture → télécharger → le fichier arrive dans
   Téléchargements et s'ouvre.
7. Temps réel : provoquer une notification depuis un autre compte → le
   compteur et le centre de notifications se mettent à jour.
8. Hors ligne (mode avion) : page « Connexion impossible » + Réessayer.

## Limite connue

Une WebView Android n'expose pas l'API Web Notifications : les **push OS**
natifs n'existent pas. Le temps réel du site (socket) couvre les notifications
à l'intérieur de l'application ; des push hors application demanderaient un
service FCM côté backend — hors périmètre actuel (« aucune API ajoutée »).

## Icône

Le symbole est celui du logo officiel (`public/comexa-logo-horizontal-transparent.png`) :
les deux dalles parallèles, sans le mot « Comexa » ni le slogan. Le tracé
vectoriel reprend cette silhouette (pas un pictogramme générique) et les bleus
mesurés dans le fichier. Fond uni `#071422` (bleu nuit, presque noir).

L'icône adaptative (`mipmap-anydpi-v26`) sépare le fond, le premier plan et la
couche monochrome (icônes thématiques Android 13+). Le symbole tient dans le
cercle de sécurité de 66 dp : les masques cercle, squircle et carré arrondi ne
le coupent pas. Les densités `mipmap-*` et `ic_launcher_round` couvrent
Android 7 à 7.1 (`minSdk` 24), avant les icônes adaptatives.

## Contenu du dossier

| Chemin | Rôle |
| --- | --- |
| `app/src/main/java/dz/comexa/android/MainActivity.java` | WebView, verrou de navigation, téléchargements, hors-ligne, bord à bord |
| `app/src/main/java/dz/comexa/android/AppConfig.java` | origine + chemins ouverts (miroir de `desktop/config.js`) |
| `app/src/main/assets/offline.html` | page hors-ligne, partagée avec le desktop |
| `app/src/main/res/…` | icône adaptative (premier plan vectoriel, fond, monochrome thématique) et densités héritées, thème noir de coque |
| `store/ic_launcher_512.png` | icône 512 px pour la fiche Play Store |
| `gradle/wrapper/` | wrapper Gradle 8.11.1 |
