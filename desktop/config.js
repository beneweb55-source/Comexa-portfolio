/**
 * Configuration de l'application desktop Comexa.
 *
 * UNE SEULE ADRESSE, PLUSIEURS SOURCES. L'application charge le site hébergé :
 * c'est ce qui garde l'authentification (cookie HttpOnly sur `/api/auth`), le
 * CORS et le socket temps réel exactement tels que le navigateur les connaît —
 * l'origine de la fenêtre reste celle du site. L'adresse est donc configurable,
 * dans cet ordre de priorité, du plus ponctuel au plus durable :
 *
 *   1. `--origin=https://…` sur la ligne de commande (débogage, CI) ;
 *   2. `COMEXA_DESKTOP_ORIGIN` dans l'environnement ;
 *   3. `desktop-config.json` À CÔTÉ DE L'EXÉCUTABLE (le dossier du `.exe` une
 *      fois installé) : c'est le réglage que l'on touche sur un poste ;
 *   4. `desktop-config.json` dans `resources/` ( packagé ) ou à la racine du
 *      paquet en développement ;
 *   5. `desktop-config.json` dans le dossier de données utilisateur ;
 *   6. la valeur par défaut ci-dessous, fixée à la compilation du dépôt.
 *
 * Une valeur illisible (non http/https, vide, JSON cassé) est ÉCARTÉE avec un
 * avertissement dans la console, et la source suivante est consultée : un
 * fichier de config mal écrit ne doit pas produire une fenêtre cassée.
 */

const fs = require("node:fs");
const path = require("node:path");

/** Adresse par défaut : le déploiement Vercel de l'application. */
const DEFAULT_ORIGIN = "https://comexa-portfolio.vercel.app";

/** Écran d'entrée : le hub des espaces de travail. */
const DEFAULT_START_PATH = "/espaces";

/**
 * Chemins ouverts à l'application. Tout le reste est refusé — en particulier le
 * site public (vitrine, réalisations, partenaires) : la fenêtre desktop est un
 * outil de travail, pas une vitrine. Les pages du parcours de connexion restent
 * ouvertes, sinon un mot de passe oublié enfermerait l'utilisateur dehors.
 */
const ALLOWED_PREFIXES = [
  "/espaces",
  "/espace-personnel",
  "/espace-equipe",
  "/espace-comexa",
  "/espace-client",
  "/connexion",
  "/inscription",
  "/mot-de-passe-oublie",
  "/reset-password",
  "/verify-email",
];

const DEFAULTS = {
  origin: DEFAULT_ORIGIN,
  startPath: DEFAULT_START_PATH,
  window: { width: 1440, height: 900, minWidth: 1024, minHeight: 680 },
  startMaximized: false,
  startFullscreen: false,
  devTools: false,
};

function warn(message) {
  // `console.warn` : le processus principal n'a pas d'autre sortie visible.
  console.warn(`[comexa-desktop] ${message}`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Normalise une origine : `https://hote` sans barre finale, sinon `null`. */
function normalizeOrigin(candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) return null;
  let url;
  try {
    url = new URL(candidate.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.origin;
}

/** Normalise un chemin de départ : commence par `/`, jamais `//`. */
function normalizeStartPath(candidate) {
  if (typeof candidate !== "string") return null;
  const value = candidate.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

function configCandidates({ app, exeDir, resourcesPath, userDataPath, appPath }) {
  return [
    { label: "ligne de commande", value: app?.commandLine?.getSwitchValue?.("origin") || null, file: null },
    { label: "variable d'environnement", value: process.env.COMEXA_DESKTOP_ORIGIN || null, file: null },
    { label: "desktop-config.json (à côté de l'exécutable)", value: null, file: path.join(exeDir, "desktop-config.json") },
    { label: "desktop-config.json (resources)", value: null, file: path.join(resourcesPath, "desktop-config.json") },
    { label: "desktop-config.json (paquet applicatif)", value: null, file: path.join(appPath, "desktop-config.json") },
    { label: "desktop-config.json (données utilisateur)", value: null, file: path.join(userDataPath, "desktop-config.json") },
  ];
}

/**
 * Résout la configuration effective.
 *
 * @param {object} paths `{ app, resourcesPath, userDataPath }` — le processus
 *   principal les fournit ; les tests peuvent passer des chemins fictifs.
 */
function loadConfig(paths) {
  const config = { ...DEFAULTS, window: { ...DEFAULTS.window } };
  let originSource = "valeur par défaut";

  for (const candidate of configCandidates(paths)) {
    let raw = candidate.value;
    let fileData = null;

    if (!raw && candidate.file) {
      if (!fs.existsSync(candidate.file)) continue;
      fileData = readJson(candidate.file);
      if (!fileData) {
        warn(`${candidate.label} : JSON illisible, source ignorée (${candidate.file}).`);
        continue;
      }
      raw = fileData.origin;
    }

    const origin = normalizeOrigin(raw);
    if (!origin) {
      if (raw) warn(`${candidate.label} : origine invalide « ${raw} », source ignorée.`);
      continue;
    }

    config.origin = origin;
    originSource = candidate.label;

    if (fileData) {
      const startPath = normalizeStartPath(fileData.startPath);
      if (startPath) config.startPath = startPath;
      else if (fileData.startPath) warn(`${candidate.label} : « startPath » ignoré (${fileData.startPath}).`);

      const { width, height, minWidth, minHeight } = fileData.window ?? {};
      if (Number.isFinite(width) && width >= 800) config.window.width = Math.round(width);
      if (Number.isFinite(height) && height >= 600) config.window.height = Math.round(height);
      if (Number.isFinite(minWidth) && minWidth >= 800) config.window.minWidth = Math.round(minWidth);
      if (Number.isFinite(minHeight) && minHeight >= 600) config.window.minHeight = Math.round(minHeight);

      config.startMaximized = fileData.startMaximized === true;
      config.startFullscreen = fileData.startFullscreen === true;
      config.devTools = fileData.devTools === true;
    }
    break;
  }

  if (originSource === "valeur par défaut") {
    warn(`Aucune source de configuration : origine par défaut ${config.origin}.`);
  }

  return { ...config, originSource, allowedPrefixes: ALLOWED_PREFIXES };
}

/** URL de départ : l'origine + le hub. */
function startUrl(config) {
  return `${config.origin}${config.startPath}`;
}

/**
 * Un chemin du site est-il ouvert à la fenêtre ? Comparaison par préfixe de
 * SEGMENT : `/espaces` n'ouvre pas `/espaces-x`, `/connexion` n'ouvre pas
 * `/connexionx`.
 */
function isAllowedPath(pathname) {
  return ALLOWED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

module.exports = { loadConfig, startUrl, isAllowedPath, normalizeOrigin, ALLOWED_PREFIXES, DEFAULT_ORIGIN, DEFAULT_START_PATH };
