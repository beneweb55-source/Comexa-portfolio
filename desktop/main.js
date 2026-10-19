/**
 * Processus principal de l'application desktop Comexa.
 *
 * PRINCIPE. Cette fenêtre native n'embarque AUCUNE copie du site : elle ouvre
 * le déploiement hébergé (par défaut `https://comexa-portfolio.vercel.app`) sur
 * le hub des espaces `/espaces`. Charger l'URL distante — plutôt qu'un build
 * local — préserve exactement ce que le navigateur connaît déjà : le cookie de
 * session HttpOnly posé par `/api/auth`, les règles CORS du backend, et le
 * socket temps réel pointé par `NEXT_PUBLIC_SOCKET_URL`. Rien n'est réinventé,
 * rien n'est simulé : les trois espaces, leurs routes, leurs rôles et leurs
 * permissions restent ceux de l'application web.
 *
 * GARDE-FOUS. La fenêtre est un outil de travail, pas un navigateur libre :
 *   - seules les routes utiles sont ouvertes (`config.js` → ALLOWED_PREFIXES) :
 *     le hub, les quatre espaces et le parcours de connexion. Le site public
 *     (vitrine, réalisations, partenaires) est refusé ;
 *   - la navigation Next.js étant client-side (pushState), le verrou porte à la
 *     fois sur `will-navigate` (chargements complets) et `did-navigate-in-page`
 *     (changements d'URL sans rechargement) ;
 *   - aucune fenêtre supplémentaire : `window.open` et les liens `_blank` sont
 *     refusés ; les adresses externes réellement utiles partent dans le
 *     navigateur du système ;
 *   - aucune intégration Node dans le rendu : `contextIsolation`, `sandbox`,
 *     pas de preload, pas de `nodeIntegration`.
 *
 * HORS LIGNE. Le site vit sur un hébergement : sans réseau, une page locale
 * (`offline.html`) explique la situation et propose de réessayer, au lieu d'un
 * écran d'erreur brut.
 */

const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("node:path");
const { loadConfig, startUrl, isAllowedPath } = require("./config");

/** Fenêtre unique de l'application. */
let mainWindow = null;

/** Configuration effective, résolue au démarrage (voir `config.js`). */
let config = null;

function warn(message) {
  console.warn(`[comexa-desktop] ${message}`);
}

/**
 * Une URL est-elle ouvrable dans la fenêtre ?
 * @returns {{ allowed: boolean, external: boolean }}
 */
function classifyUrl(target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return { allowed: false, external: false };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { allowed: false, external: false };
  }
  if (url.origin !== config.origin) return { allowed: false, external: true };
  return { allowed: isAllowedPath(url.pathname), external: false };
}

/** Ramène la fenêtre sur le hub des espaces. */
function goHome(reason) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (reason) warn(reason);
  mainWindow.loadURL(startUrl(config));
}

/** Verrouille toute sortie hors du périmètre autorisé. */
function lockNavigation(win) {
  const contents = win.webContents;

  // Chargements complets : liens, formulaires, `location.href`…
  contents.on("will-navigate", (event, target) => {
    const { allowed, external } = classifyUrl(target);
    if (allowed) return;
    event.preventDefault();
    if (external) {
      // Une adresse d'un autre domaine : le navigateur du système s'en charge.
      shell.openExternal(target);
      return;
    }
    goHome(`Navigation refusée vers ${target} : retour au hub.`);
  });

  // 404 réseau : l'origine déployée ne connaît pas la route demandée (vieux
  // déploiement, origine mal réglée). Rien n'est masqué — l'avertissement est
  // journalisé — et la reprise passe par le parcours de connexion EXISTANT,
  // avec son mécanisme `next` : login d'abord, hub ensuite. Si c'est déjà
  // `/connexion` qui répond 404, c'est l'origine elle-même qui est en cause :
  // on s'arrête là plutôt que de boucler.
  contents.on("did-navigate", (event, url, httpResponseCode) => {
    if (httpResponseCode !== 404) return;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.pathname === "/connexion") {
      warn(`404 sur ${url} : cette origine ne sert pas le parcours de connexion.`);
      return;
    }
    warn(`404 sur ${url} : reprise par la page de connexion, retour au hub ensuite.`);
    win.loadURL(`${config.origin}/connexion?next=${encodeURIComponent(parsed.pathname + parsed.search)}`);
  });

  // Navigation client-side de Next.js (pushState / replaceState) : aucun
  // `will-navigate` ne part, on corrige donc juste après le changement d'URL.
  contents.on("did-navigate-in-page", (event, target, isMainFrame) => {
    if (!isMainFrame) return;
    const { allowed } = classifyUrl(target);
    if (allowed) return;
    goHome(`Route hors périmètre (${target}) : retour au hub.`);
  });

  // Aucune fenêtre supplémentaire, jamais. Les adresses http(s) — un document
  // partagé, un lien partenaire — s'ouvrent dans le navigateur du système.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // Réseau coupé, DNS muet, hébergement injoignable : page locale explicative.
  contents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === -3) return; // navigation abandonnée (redirect rapide) : rien à signaler
    warn(`Chargement impossible (${errorCode} ${errorDescription}) pour ${validatedURL}.`);
    win.loadFile(path.join(__dirname, "offline.html"), {
      query: { retry: startUrl(config), code: String(errorCode), detail: errorDescription || "" },
    });
  });
}

function buildMenu() {
  const template = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { type: "separator" }, { role: "quit" }],
    });
  }

  template.push({
    label: "Navigation",
    submenu: [
      { label: "Hub des espaces", accelerator: "CmdOrCtrl+Shift+H", click: () => goHome() },
      { type: "separator" },
      { label: "Actualiser", role: "reload" },
      { label: "Recharger sans cache", role: "forceReload" },
      ...(config.devTools ? [{ label: "Outils développeur", role: "toggleDevTools" }] : []),
    ],
  });

  template.push({
    label: "Affichage",
    submenu: [
      { label: "Zoom avant", role: "zoomIn" },
      { label: "Zoom arrière", role: "zoomOut" },
      { label: "Taille normale", role: "resetZoom" },
      { type: "separator" },
      { label: "Plein écran", role: "togglefullscreen" },
    ],
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: config.window.width,
    height: config.window.height,
    minWidth: config.window.minWidth,
    minHeight: config.window.minHeight,
    show: false, // pas de fenêtre blanche : on attend le premier rendu
    title: "Comexa",
    backgroundColor: "#dbe7ef", // fond de coquille, identique au site
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (config.startMaximized) mainWindow.maximize();
    if (config.startFullscreen) mainWindow.setFullScreen(true);
    mainWindow.show();
  });

  lockNavigation(mainWindow);
  mainWindow.loadURL(startUrl(config));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Une seule instance : un second lancement rend la main à la fenêtre existante.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    config = loadConfig({
      app,
      exeDir: path.dirname(app.getPath("exe")),
      resourcesPath: process.resourcesPath || __dirname,
      appPath: app.getAppPath(),
      userDataPath: app.getPath("userData"),
    });

    app.setName("Comexa");
    if (process.platform === "win32") app.setAppUserModelId("dz.comexa.desktop");

    warn(`Origine : ${config.origin} (source : ${config.originSource}).`);

    buildMenu();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
