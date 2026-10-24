/**
 * Processus principal de l'application desktop Comexa.
 *
 * PRINCIPE. En version installée, l'interface Next.js est embarquée dans le
 * paquet et servie par un serveur local. Cela permet de démarrer et naviguer
 * dans l'application sans charger le site Vercel. Les appels API restent
 * relayés vers le backend configuré à la compilation : sans réseau, l'interface
 * démarre mais les données et les opérations nécessitent encore le backend.
 * En développement (sans build embarqué), le site hébergé reste le repli.
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
 * HORS LIGNE. Le frontend embarqué permet au moins d'ouvrir les pages locales
 * sans réseau. Les données métier ne sont pas encore mises en cache et les
 * modifications hors ligne ne sont pas synchronisées : `offline.html` reste le
 * secours si le serveur local ou le repli hébergé ne démarre pas.
 */

const { app, BrowserWindow, Menu, shell, ipcMain, safeStorage, utilityProcess } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { loadConfig, startUrl, isAllowedPath } = require("./config");
const { OfflineStore } = require("./offline-store");

/** Fenêtre unique de l'application. */
let mainWindow = null;

/** Configuration effective, résolue au démarrage (voir `config.js`). */
let config = null;

function warn(message) {
  console.warn(`[comexa-desktop] ${message}`);
}

/** Serveur Next local embarqué ; nul en développement sans build préparé. */
let webServer = null;
let appOrigin = null;
let offlineStore = null;

function standaloneServerPath() {
  const packaged = path.join(process.resourcesPath || "", "web", "server.js");
  if (fs.existsSync(packaged)) return packaged;
  const development = path.resolve(__dirname, "..", ".next", "standalone", "server.js");
  return fs.existsSync(development) ? development : null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function checkLocalServer(port) {
  return new Promise((resolve) => {
    const request = http.get({ hostname: "127.0.0.1", port, path: "/espaces", timeout: 900 }, (response) => {
      response.resume();
      resolve(response.statusCode < 500);
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

async function startEmbeddedWebServer() {
  const entry = standaloneServerPath();
  if (!entry) {
    warn("Frontend local absent ; utilisation du site hébergé (mode développement ou paquet incomplet).");
    return null;
  }

  const port = await freePort();
  const serverEnv = { NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port) };
  for (const key of ["PATH", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA"]) {
    if (process.env[key]) serverEnv[key] = process.env[key];
  }
  try {
    webServer = utilityProcess.fork(entry, [], {
      cwd: path.dirname(entry),
      env: serverEnv,
      stdio: "ignore",
      serviceName: "Comexa frontend",
    });
  } catch (error) {
    warn(`Impossible de démarrer le frontend local : ${error.message}.`);
    return null;
  }
  webServer.once("exit", (code) => {
    if (code !== null) warn(`Le serveur local s'est arrêté (code ${code}).`);
    webServer = null;
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && webServer) {
    if (await checkLocalServer(port)) {
      appOrigin = `http://127.0.0.1:${port}`;
      warn(`Frontend embarqué prêt sur ${appOrigin}.`);
      return appOrigin;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (webServer) webServer.kill();
  webServer = null;
  warn("Le frontend embarqué n'a pas démarré à temps.");
  return null;
}

function stopEmbeddedWebServer() {
  if (webServer) {
    webServer.kill();
    webServer = null;
  }
}

function assertTrustedIpc(event) {
  const senderUrl = event.senderFrame?.url;
  if (!appOrigin || typeof senderUrl !== "string" || new URL(senderUrl).origin !== appOrigin) {
    throw new Error("Accès au stockage hors ligne refusé.");
  }
  if (!offlineStore) throw new Error("Le stockage local chiffré n'est pas disponible sur cet appareil.");
}

function requestLocalApi(pathname, { method = "GET", headers = {}, body } = {}) {
  if (!appOrigin) return Promise.reject(new Error("Le backend local n'est pas prêt."));
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const request = http.request(`${appOrigin}${pathname}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
        ...headers,
      },
      timeout: 10_000,
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
        if (text.length > 512 * 1024) request.destroy(new Error("Réponse d'authentification trop volumineuse."));
      });
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode, envelope: JSON.parse(text) });
        } catch {
          reject(new Error("Réponse d'authentification invalide."));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("Vérification de session expirée.")));
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function verifyOnlineUser({ user, accessToken }) {
  if (typeof accessToken !== "string" || accessToken.length < 16 || accessToken.length > 8192) {
    throw new Error("Preuve de session en ligne invalide.");
  }
  const { status, envelope } = await requestLocalApi("/api/auth/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const serverUser = envelope?.data;
  const sameIdentity = status === 200 && envelope?.success === true && serverUser?.id === user?.id &&
    String(serverUser?.email || "").toLowerCase() === String(user?.email || "").toLowerCase();
  if (!sameIdentity) throw new Error("Le serveur n'a pas confirmé l'identité de ce compte.");
  return serverUser;
}

async function verifyOnlineCredentials({ email, password, user, accessToken }) {
  if (typeof email !== "string" || email.length > 320 || typeof password !== "string" || password.length > 512 ||
      typeof accessToken !== "string" || accessToken.length < 16 || accessToken.length > 8192) {
    throw new Error("Identifiants en ligne invalides.");
  }
  const { status, envelope } = await requestLocalApi("/api/auth/offline-authorization", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: { password },
  });
  const serverUser = envelope?.data;
  if (status !== 200 || envelope?.success !== true || serverUser?.id !== user?.id ||
      String(serverUser?.email || "").toLowerCase() !== email.trim().toLowerCase() ||
      String(serverUser?.email || "").toLowerCase() !== String(user?.email || "").toLowerCase()) {
    throw new Error("Le backend n'a pas confirmé les identifiants du compte.");
  }
  return serverUser;
}

function registerOfflineIpc() {
  const register = (channel, handler) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, payload) => {
      assertTrustedIpc(event);
      return handler(payload);
    });
  };

  register("comexa:offline:remember-online", async (payload) => {
    const user = await verifyOnlineCredentials(payload);
    return offlineStore.rememberOnline({ ...payload, user });
  });
  register("comexa:offline:activate-online", async (payload) => {
    const user = await verifyOnlineUser(payload);
    return offlineStore.activateOnline({ user });
  });
  register("comexa:offline:authenticate", (payload) => offlineStore.authenticateOffline(payload));
  register("comexa:offline:cache-response", (payload) => offlineStore.cacheResponse(payload));
  register("comexa:offline:get-cached-response", (payload) => offlineStore.getCachedResponse(payload));
  register("comexa:offline:status", (payload) => offlineStore.status(payload));
  register("comexa:offline:mark-sync-success", (payload) => offlineStore.markSyncSuccess(payload));
  register("comexa:offline:enqueue-mutation", (payload) => offlineStore.enqueueMutation(payload));
  register("comexa:offline:list-pending", (payload) => offlineStore.listPendingOperations(payload));
  register("comexa:offline:list-id-mappings", (payload) => offlineStore.listLocalIdMappings(payload));
  register("comexa:offline:update-operation", (payload) => offlineStore.updateOperation(payload));
  register("comexa:offline:record-conflict", (payload) => offlineStore.recordConflict(payload));
  register("comexa:offline:list-conflicts", (payload) => offlineStore.listConflicts(payload));
  register("comexa:offline:resolve-conflict", (payload) => offlineStore.resolveConflict(payload));
  register("comexa:offline:list-cached", (payload) => offlineStore.listCachedEntries(payload));
  register("comexa:offline:find-cached-entity", (payload) => offlineStore.findCachedEntity(payload));
  register("comexa:offline:rename-cached-request", (payload) => offlineStore.renameCachedRequest(payload));
  register("comexa:offline:delete-cache-entry", (payload) => offlineStore.deleteCachedEntry(payload));
  register("comexa:offline:logout", () => offlineStore.clearActiveAccount());
}

async function initializeOfflineStore() {
  registerOfflineIpc();
  try {
    offlineStore = await new OfflineStore({ app, safeStorage }).initialize();
    warn("Base locale chiffrée prête.");
  } catch (error) {
    offlineStore = null;
    warn(`Mode hors ligne sécurisé indisponible : ${error.message}`);
  }
}

/** URL d'entrée locale (paqueté) ou hébergée (développement/repli). */
function currentStartUrl() {
  return appOrigin ? `${appOrigin}${config.startPath}` : startUrl(config);
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
  const trustedOrigin = url.origin === config.origin || (appOrigin && url.origin === appOrigin);
  if (!trustedOrigin) return { allowed: false, external: true };
  return { allowed: isAllowedPath(url.pathname), external: false };
}

/** Ramène la fenêtre sur le hub des espaces. */
function goHome(reason) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (reason) warn(reason);
  mainWindow.loadURL(currentStartUrl());
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
    // Icône de la fenêtre — et de la barre des tâches sous Windows, où
    // l'exécutable ne porte pas toujours la sienne. Absent sous macOS, qui
    // lit l'icône du bundle.
    icon: path.join(__dirname, "build", "icon.png"),
    // Fond de la coque noire du dashboard (`--shell`) : toutes les routes
    // ouvertes à la fenêtre (hub des espaces, espaces, connexion) commencent
    // par une barre noire. Le fond de fenêtre prend cette couleur, donc le
    // démarrage ne montre jamais un éclair clair.
    backgroundColor: "#0b0a0f",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      ...(appOrigin ? { preload: path.join(__dirname, "preload.js") } : {}),
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (config.startMaximized) mainWindow.maximize();
    if (config.startFullscreen) mainWindow.setFullScreen(true);
    mainWindow.show();
  });

  lockNavigation(mainWindow);
  mainWindow.loadURL(currentStartUrl());

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

  app.whenReady().then(async () => {
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
    await startEmbeddedWebServer();
    if (appOrigin) await initializeOfflineStore();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    try {
      offlineStore?.close();
    } catch (error) {
      warn(`La base locale n'a pas pu être finalisée : ${error.message}`);
    } finally {
      offlineStore = null;
      stopEmbeddedWebServer();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
