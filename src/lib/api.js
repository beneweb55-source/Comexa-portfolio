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
 * `space` : espace de travail annoncé au serveur (`personal`, `team`, `comexa`).
 * Le serveur restreint alors les droits de la requête à cet espace. Absent, la
 * requête garde les droits du rôle (espace client, site public, connexion).
 */
export async function apiFetch(path, { method = "GET", body, token, signal, space } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (space) headers[SPACE_HEADER] = space;

  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK", NETWORK_MESSAGE);
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

  if (!response.ok || !json?.success) {
    const error = json?.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? `HTTP_${response.status}`,
      error.message ?? "Une erreur est survenue. Réessayez.",
      error.details,
    );
  }

  return { data: json.data, meta: json.meta };
}

/** Telecharge un fichier protege (le jeton doit etre dans l'en-tete). */
export async function downloadFile(path, { token, filename, space }) {
  const response = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${token}`, ...(space ? { [SPACE_HEADER]: space } : {}) },
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ApiError(response.status, `HTTP_${response.status}`, "Le document n'a pas pu être téléchargé.");
  }
  const blob = await response.blob();
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

/** Montant formate dans sa devise, sans conversion. */
export function formatMoney(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value));
}

/** Formate une journée métier stockée à minuit UTC sans la décaler au fuseau local. */
export function formatDateOnly(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}
