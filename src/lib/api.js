/**
 * Acces HTTP a l'API Comexa.
 *
 * Toutes les reponses suivent l'enveloppe du backend (voir shared/api/envelope.ts) :
 *   succes : { success: true, data, meta? }
 *   erreur : { success: false, error: { code, message, details } }
 * Une erreur devient une ApiError : l'interface affiche son message, sans jamais
 * modifier l'etat deja affiche (une erreur ne doit pas corrompre l'ecran).
 */

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const NETWORK_MESSAGE = "Le serveur est injoignable pour le moment. Réessayez dans un instant.";

/** En-tête de l'espace de travail actif (voir `lib/spaces.js`). */
const SPACE_HEADER = "X-Comexa-Space";

/**
 * Routes qui répondent SANS jeton : contenu public, authentification, santé.
 * Partout ailleurs, appeler le serveur sans jeton est une erreur de session —
 * inutile d'aller chercher un 401 (voir `apiFetch`).
 */
const PUBLIC_PREFIXES = ["/public", "/auth", "/health"];

function isPublicPath(path) {
  if (typeof path !== "string") return false;
  return PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Passerelle en erreur : le backend ne répond pas (démarrage, redéploiement). */
const GATEWAY_STATUSES = new Set([502, 503, 504]);
const GATEWAY_MESSAGE =
  "Le serveur applicatif ne répond pas pour le moment (passerelle 502/503/504). " +
  "Il démarre peut-être : réessayez dans quelques secondes.";

/**
 * Un 502 n'est pas une réponse métier : c'est la passerelle qui n'a pas joint
 * l'API (backend endormi, redéploiement Render en cours). Rejouer UNE fois la
 * lecture est sans risque et évite de présenter un échec à l'utilisateur pour
 * un simple réveil ; on ne rejoue jamais une écriture métier.
 */
function retryableStatus(status, path, method) {
  if (!GATEWAY_STATUSES.has(status)) return false;
  if (method === "GET" || method === "HEAD") return true;
  return path === "/auth/refresh" || path === "/auth/login";
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Délai maximal d'une requête ordinaire : passé ce délai, on rend la main. */
const DEFAULT_TIMEOUT_MS = 30_000;

function desktopOfflineBridge() {
  return typeof window !== "undefined" && window.comexaDesktop?.isDesktop === true
    ? window.comexaDesktop.offline
    : null;
}

function notifyOfflineMode(cachedAt = null) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("comexa:offline-cache-used", { detail: { cachedAt } }));
  }
}

function canCacheOffline(method, path, userId) {
  return method === "GET" && typeof userId === "string" && userId.length > 0 &&
    !path.startsWith("/auth/") && !path.startsWith("/public/") && path !== "/health";
}

async function readOfflineCache({ userId, space, path }) {
  const bridge = desktopOfflineBridge();
  if (!bridge || !userId) return null;
  try {
    const hit = await bridge.getCachedResponse({ userId, space: space ?? "", requestKey: path });
    if (!hit?.response?.success) return null;
    const envelope = hit.response;
    notifyOfflineMode(hit.cachedAt);
    return {
      data: envelope.data,
      meta: envelope.meta,
      message: envelope.message,
      redirectUrl: envelope.redirectUrl,
      action: envelope.action,
      offline: true,
      cachedAt: hit.cachedAt,
    };
  } catch (error) {
    console.warn("[comexa-offline] Lecture du cache local impossible.", error);
    return null;
  }
}

/**
 * `space` : espace de travail annoncé au serveur (`personal`, `team`, `comexa`).
 * Le serveur restreint alors les droits de la requête à cet espace. Absent, la
 * requête garde les droits du rôle (espace client, site public, connexion).
 */
export async function apiFetch(
  path,
  {
    method = "GET",
    body,
    token,
    signal,
    space,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    offlineMode = false,
    offlineUserId = null,
  } = {},
) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const bearer = token;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (space) headers[SPACE_HEADER] = space;

  const desktopBridge = desktopOfflineBridge();
  const browserKnowsOffline = desktopBridge && typeof navigator !== "undefined" && navigator.onLine === false;

  // Détection navigateur rapide : ne pas attendre le timeout HTTP quand le
  // système sait déjà qu'il n'y a aucun réseau.
  if (!offlineMode && browserKnowsOffline && offlineUserId) {
    notifyOfflineMode();
    if (method !== "GET") {
      throw new ApiError(0, "OFFLINE_WRITE_UNSUPPORTED", "Cette action nécessite encore une connexion. Aucune modification n'a été enregistrée.");
    }
    const cached = await readOfflineCache({ userId: offlineUserId, space, path });
    if (cached) return cached;
    throw new ApiError(0, "OFFLINE_CACHE_MISS", "Ces données n'ont pas encore été enregistrées sur cet appareil.");
  }

  // En mode déconnecté, seules les lectures dont une copie chiffrée existe
  // localement sont rendues. Aucune mutation n'est simulée comme réussie : la
  // file d'opérations métier doit être intégrée explicitement avant d'accepter
  // une écriture hors ligne.
  if (offlineMode) {
    if (method !== "GET") {
      throw new ApiError(0, "OFFLINE_WRITE_UNSUPPORTED", "Cette action nécessite encore une connexion. Aucune modification n'a été enregistrée.");
    }
    const cached = await readOfflineCache({ userId: offlineUserId, space, path });
    if (cached) return cached;
    throw new ApiError(0, "OFFLINE_CACHE_MISS", "Ces données n'ont pas encore été enregistrées sur cet appareil.");
  }

  // SESSION ABSENTE — on ne frappe pas le serveur pour récolter un 401.
  // Hors routes publiques, la réponse est connue d'avance : on la rend localement.
  if (!bearer && !isPublicPath(path)) {
    throw new ApiError(
      401,
      "SESSION_ABSENTE",
      "Votre session a expiré. Reconnectez-vous pour continuer.",
    );
  }

  // AUCUNE requête sans délai maximal. Sans lui, un serveur qui ne répond pas
  // (réveil d'un hébergement endormi, amorçage de la base d'entraînement qui
  // traîne) laissait l'interface figée sur son indicateur de chargement —
  // « Ouverture de l'environnement… » pour toujours, sans erreur ni issue.
  // Le signal de l'appelant reste maître : son annulation n'est pas convertie
  // en erreur réseau.
  const controller = new AbortController();
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let response;
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await fetch(`/api${path}`, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
      } catch (error) {
        if (error?.name === "AbortError" && !timedOut) throw error;
        const networkError = timedOut
          ? new ApiError(0, "TIMEOUT", "Le serveur met trop de temps à répondre. Réessayez dans un instant.")
          : new ApiError(0, "NETWORK", NETWORK_MESSAGE);
        if (canCacheOffline(method, path, offlineUserId) && !signal?.aborted) {
          notifyOfflineMode();
          const cached = await readOfflineCache({ userId: offlineUserId, space, path });
          if (cached) return cached;
        }
        throw networkError;
      }
      if (attempt === 0 && retryableStatus(response.status, path, method)) {
        await delay(1200);
        continue;
      }
      break;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }

  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!response.ok && GATEWAY_STATUSES.has(response.status) && canCacheOffline(method, path, offlineUserId)) {
    notifyOfflineMode();
    const cached = await readOfflineCache({ userId: offlineUserId, space, path });
    if (cached) return cached;
  }

  if (!response.ok || !json?.success) {
    const error = json?.error ?? {};
    const fallback = GATEWAY_STATUSES.has(response.status)
      ? GATEWAY_MESSAGE
      : "Une erreur est survenue. Réessayez.";
    throw new ApiError(
      response.status,
      error.code ?? `HTTP_${response.status}`,
      error.message ?? fallback,
      error.details,
    );
  }

  // L'ENVELOPPE COMPLÈTE EST RENDUE, et ce n'est pas un détail de confort.
  //
  // Cette fonction ne renvoyait que `{ data, meta }`. Le serveur, lui, répond
  // aussi `message`, `redirectUrl` et `action` — c'est le contrat du système de
  // redirection post-action (`buildResponse` dans `url-builder.service.ts`) :
  // après un envoi de facture, la réponse dit quelle page ouvrir et comment.
  // En jetant ces trois champs, `request()` rendait la redirection IMPOSSIBLE :
  // `useRedirectAfterAction` lit `result.action.url`, `ActionNotification` lit
  // `redirectUrl || action.url` — tous deux toujours `undefined`. Les deux
  // mécanismes existaient, étaient testés, et ne pouvaient rien faire.
  //
  // Ajouter des champs ne casse aucun appelant : les 37 appels existants
  // déstructurent `{ data }` (parfois `{ data, meta }`), ce qui continue de
  // fonctionner à l'identique.
  const result = {
    data: json.data,
    meta: json.meta,
    message: json.message,
    redirectUrl: json.redirectUrl,
    action: json.action,
  };

  if (canCacheOffline(method, path, offlineUserId)) {
    const bridge = desktopOfflineBridge();
    try {
      await bridge?.cacheResponse({ userId: offlineUserId, space: space ?? "", requestKey: path, response: json });
    } catch (error) {
      // Un cache indisponible ne transforme pas une réponse serveur réussie en échec.
      console.warn("[comexa-offline] Impossible de persister la réponse locale.", error);
    }
  }
  return result;
}

/**
 * Lit un fichier protege et rend son BLOB, sans declencher de telechargement.
 *
 * CETTE FONCTION EXISTE PARCE QU'UN `<iframe src>` NE PEUT PAS S'AUTHENTIFIER.
 * Le jeton d'acces vit en memoire, jamais dans un cookie : un cadre ou un lien
 * chargé directement par le navigateur arrive donc sur l'API SANS en-tete
 * `Authorization`, et recoit un 401. Afficher un PDF genere par l'API passait
 * pourtant par `request(..., { responseType: "blob" })` puis `response.ok` —
 * sauf que `request` renvoie l'enveloppe JSON déjà parsée, pas une `Response` :
 * `response.ok` valait `undefined` et `response.blob()` n'existait pas. L'aperçu
 * ne s'affichait donc jamais, et l'erreur était avalée par un `catch` muet.
 *
 * Le jeton est fourni par l'appelant (`session.jsx`), qui sait aussi le
 * rafraîchir : c'est ce qui permet à un aperçu de survivre à l'expiration du
 * jeton d'accès, exactement comme le téléchargement.
 */
export async function fetchProtectedBlob(path, { token, space }) {
  const bearer = token;
  const response = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${bearer}`, ...(space ? { [SPACE_HEADER]: space } : {}) },
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ApiError(response.status, `HTTP_${response.status}`, "Le document n'a pas pu être téléchargé.");
  }
  return response.blob();
}

/** Telecharge un fichier protege (le jeton doit etre dans l'en-tete). */
export async function downloadFile(path, { token, filename, space }) {
  const blob = await fetchProtectedBlob(path, { token, space });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename ?? "document";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Message affichable pour une erreur, avec les codes les plus frequents traduits. */
const FRIENDLY = {
  INVALID_CREDENTIALS: "Adresse e-mail ou mot de passe incorrect.",
  ACCOUNT_INVITED:
    "Votre compte n'est pas encore activé. Ouvrez le lien de vérification reçu par e-mail.",
  ACCOUNT_LOCKED: "Trop de tentatives de connexion. Réessayez plus tard.",
  ACCOUNT_SUSPENDED: "Ce compte ne peut pas se connecter. Contactez l'équipe Comexa.",
  UNAUTHENTICATED: "Votre session a expiré. Reconnectez-vous.",
  FORBIDDEN: "Vous n'avez pas les droits pour cette action.",
  TOKEN_EXPIRED: "Ce lien a expiré. Demandez-en un nouveau.",
  TOKEN_INVALID: "Ce lien n'est plus valide. Demandez-en un nouveau.",
  RATE_LIMITED: "Trop de demandes. Patientez une minute avant de réessayer.",
  SPACE_FORBIDDEN: "Cet espace de travail ne vous est pas accessible.",
};

export function messageOf(error) {
  if (error instanceof ApiError) {
    // Validation : le serveur range le detail (une phrase par regle) dans `details`.
    if (error.code === "VALIDATION_FAILED" && Array.isArray(error.details) && error.details.length > 0) {
      return error.details.filter((line) => typeof line === "string").join(" ");
    }
    return FRIENDLY[error.code] ?? error.message;
  }
  return "Une erreur inattendue est survenue. Réessayez.";
}

/**
 * Montant formate dans sa devise, sans conversion.
 *
 * L'implementation vit dans `lib/currency.js` : elle est partagee par les
 * ecrans qui additionnent par devise et par ceux qui affichent une ligne
 * isolee. Le dinar y est ecrit « DA » (comme sur les PDF) et non « DZD ».
 *
 * Ré-exporté ici parce que tous les écrans importaient déjà `formatMoney`
 * depuis `@/lib/api` : déplacer le seul point d'appel aurait été un
 * renommage sans valeur.
 */
export { formatMoney } from "./currency";

export function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value));
}

/** Formate l'heure d'une date */
export function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" }).format(new Date(value));
}

/** Formate une journée métier stockée à minuit UTC sans la décaler au fuseau local. */
export function formatDateOnly(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}
