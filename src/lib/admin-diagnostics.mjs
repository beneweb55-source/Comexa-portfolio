/**
 * Comexa Space — diagnostics purs, sans secret et sans appel reseau.
 *
 * Ce module aide l'administration a repondre a trois questions :
 *   1. que s'est-il passe ? (journal d'audit lisible) ;
 *   2. qu'est-ce qui est reellement verifie ? (sante operationnelle) ;
 *   3. un reglage a-t-il un effet confirme ? (parametres).
 *
 * Il ne remplace jamais le masquage backend (`audit/redact.ts`) : il ajoute une
 * seconde barriere cote interface pour eviter qu'un jour un champ sensible
 * atteigne le DOM. Aucune fonction ici ne donne un droit supplementaire.
 */

export const MASK_LABEL = "Masqué par sécurité";
const SENSITIVE_KEY = /pass|pwd|secret|token|hash|credential|authorization|authheader|cookie|privatekey|apikey|accesskey|signingkey|salt|signature|bearer|jwt/i;
const JWT_VALUE = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const INTEGRATION_TOKEN_VALUE = /^cxi_[A-Za-z0-9_-]+$/;
const BEARER_VALUE = /^bearer\s+\S+/i;
const BACKEND_MASK = "[masque]";
const MAX_DIFF_DEPTH = 8;
const MAX_VALUE_LENGTH = 140;
const STALE_TOKEN_DAYS = 90;

/**
 * Fait de code, PAS de runtime : le proxy `/api/agent-chat` transmet encore
 * `metadata.jwt` au workflow n8n. Ce drapeau doit passer a false le jour ou
 * une delegation courte durée remplace effectivement ce contrat.
 */
export const AGENT_SESSION_JWT_FORWARDING = true;

export const HEALTH_STATE = Object.freeze({
  operational: "Opérationnel",
  degraded: "Dégradé",
  unavailable: "Indisponible",
  unknown: "État inconnu",
  notConfigured: "Vérification non configurée",
});

const STATE_SEVERITY = { operational: 0, notConfigured: 1, unknown: 2, degraded: 3, unavailable: 4 };

/** Convertit une date de formulaire en borne ISO attendue par le DTO backend. */
export function auditDateBoundary(value, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** Une URL de webhook externe ne doit jamais recevoir un secret en clair sur HTTP. */
export function isSafeAgentWebhookUrl(rawUrl, { isProduction = process.env.NODE_ENV === "production" } = {}) {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") return false;
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:") return true;
    if (!isProduction && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

/** Deuxieme barriere : le backend masque deja, l'interface ne doit jamais re-afficher un secret. */
export function safeAuditText(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
  if (text === BACKEND_MASK || JWT_VALUE.test(text) || INTEGRATION_TOKEN_VALUE.test(text) || BEARER_VALUE.test(text)) return MASK_LABEL;
  if (text.length > MAX_VALUE_LENGTH) return `${text.slice(0, MAX_VALUE_LENGTH - 1)}…`;
  return text;
}

function safeKey(key) {
  return !SENSITIVE_KEY.test(String(key).replace(/[^a-z0-9]/gi, "").toLowerCase());
}

function flattenAuditValue(value, path, depth, out) {
  if (depth >= MAX_DIFF_DEPTH) {
    out[path] = "[détail trop profond]";
    return;
  }
  if (value === null || value === undefined) {
    out[path] = null;
    return;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out[path] = value;
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out[path] = [];
      return;
    }
    value.slice(0, 30).forEach((item, index) => flattenAuditValue(item, `${path}[${index}]`, depth + 1, out));
    if (value.length > 30) out[`${path}[+${value.length - 30}]`] = "…";
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).slice(0, 50);
    for (const [key, item] of entries) {
      out[`${path}${path ? "." : ""}${key}`] = safeKey(key) ? undefined : BACKEND_MASK;
      if (safeKey(key)) flattenAuditValue(item, `${path}${path ? "." : ""}${key}`, depth + 1, out);
    }
    return;
  }
  out[path] = String(value);
}

function flattenRoot(value) {
  const out = {};
  if (value === null || value === undefined) return out;
  flattenAuditValue(value, "", 0, out);
  for (const [key, item] of Object.entries(out)) {
    if (item === undefined) delete out[key];
    else out[key] = safeAuditText(item);
  }
  return out;
}

/**
 * Compare deux charges utiles deja redigee par le backend. Ne produit ni JSON
 * brut ni secret : uniquement des chemins, des valeurs courtes et un etat.
 */
export function diffAuditPayload(before, after) {
  const left = flattenRoot(before);
  const right = flattenRoot(after);
  const paths = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const rows = paths.map((path) => {
    const hasBefore = Object.prototype.hasOwnProperty.call(left, path);
    const hasAfter = Object.prototype.hasOwnProperty.call(right, path);
    const beforeValue = hasBefore ? left[path] : null;
    const afterValue = hasAfter ? right[path] : null;
    let state = "changed";
    if (!hasBefore) state = "added";
    else if (!hasAfter) state = "removed";
    else if (beforeValue === afterValue) state = "unchanged";
    return {
      path: path || "(valeur)",
      label: path.replace(/\[(\d+)\]/g, " → $1").replace(/\./g, " › ") || "(valeur)",
      before: beforeValue,
      after: afterValue,
      state,
      masked: beforeValue === MASK_LABEL || afterValue === MASK_LABEL || beforeValue === BACKEND_MASK || afterValue === BACKEND_MASK,
    };
  });
  return {
    rows,
    changed: rows.filter((row) => row.state !== "unchanged"),
    hasPayload: before !== null && before !== undefined || after !== null && after !== undefined,
  };
}

const ENTITY_LINKS = {
  Quote: { permission: "quote:read:any", label: "Ouvrir le devis", href: (id) => `/espace-equipe/devis/${encodeURIComponent(id)}` },
  Invoice: { permission: "invoice:read:any", label: "Ouvrir la facture", href: (id) => `/espace-equipe/factures/${encodeURIComponent(id)}` },
  Project: { permission: "project:read:any", label: "Ouvrir le projet", href: (id) => `/espace-equipe/projets/${encodeURIComponent(id)}` },
  Client: { permission: "client:read:any", label: "Ouvrir le client", href: (id) => `/espace-equipe/clients/${encodeURIComponent(id)}` },
  Prospect: { permission: "prospect:read:any", label: "Ouvrir le prospect", href: (id) => `/espace-equipe/prospects/${encodeURIComponent(id)}` },
  Order: { permission: "order:read:any", label: "Ouvrir la commande", href: (id) => `/espace-equipe/commandes/${encodeURIComponent(id)}` },
  User: { permission: "user:read:any", label: "Voir les membres", href: () => "/espace-comexa/membres" },
  Role: { permission: "role:read:any", label: "Voir les rôles", href: () => "/espace-comexa/roles" },
  IntegrationToken: { permission: "integration:read:any", label: "Voir les intégrations", href: () => "/espace-comexa/integrations" },
  Setting: { permission: "setting:read:any", label: "Voir les paramètres", href: () => "/espace-comexa/parametres?onglet=advanced" },
  Service: { permission: "service:read:any", label: "Voir le contenu", href: () => "/espace-comexa/contenu" },
  Package: { permission: "package:read:any", label: "Voir le contenu", href: () => "/espace-comexa/contenu" },
  Testimonial: { permission: "testimonial:read:any", label: "Voir le contenu", href: () => "/espace-comexa/contenu" },
  Partner: { permission: "partner:read:any", label: "Voir le contenu", href: () => "/espace-comexa/contenu" },
  Faq: { permission: "faq:read:any", label: "Voir le contenu", href: () => "/espace-comexa/contenu" },
};

/** Lien uniquement si la rubrique existe et si le porteur a le droit de l'ouvrir. */
export function auditEntityHref(entry, hasPermission = () => false) {
  const spec = ENTITY_LINKS[String(entry?.entityType ?? "")];
  if (!spec || !entry?.entityId || !hasPermission(spec.permission)) return null;
  return { href: spec.href(entry.entityId), label: spec.label };
}

/** Les jetons jamais utilises ou inactifs depuis longtemps sont une revue, pas une revocation automatique. */
export function summarizeTokenReview(tokens, now = Date.now()) {
  if (!Array.isArray(tokens)) return { known: false, active: 0, neverUsed: 0, stale: 0, expiring: 0 };
  const active = tokens.filter((token) => token?.active);
  const in30Days = now + 30 * 24 * 3600 * 1000;
  return {
    known: true,
    active: active.length,
    neverUsed: active.filter((token) => !token.lastUsedAt).length,
    stale: active.filter((token) => {
      const usedAt = token.lastUsedAt ? Date.parse(token.lastUsedAt) : null;
      return Number.isFinite(usedAt) && now - usedAt > STALE_TOKEN_DAYS * 24 * 3600 * 1000;
    }).length,
    expiring: active.filter((token) => token.expiresAt && Date.parse(token.expiresAt) < in30Days).length,
  };
}

/**
 * Sante operationnelle honnete : seuls les faits verifies par `/health` passent
 * au vert. Mail, stockage et cron restent explicitement non verifies.
 */
export function buildAdminHealth({
  responseOk = false,
  payload = null,
  error = null,
  requiredFeatures = [],
  tokens = null,
  now = Date.now(),
  agentSessionJwtForwarding = true,
} = {}) {
  const data = payload?.data ?? null;
  const apiUp = Boolean(responseOk && !error && data?.status === "ok" && data?.database === "up");
  const contract = data?.contract ?? null;
  const missingFeatures = contract ? requiredFeatures.filter((feature) => contract.features?.[feature] !== true) : requiredFeatures;
  const tokenReview = summarizeTokenReview(tokens, now);

  const checks = [
    {
      key: "api",
      label: "API et base de données",
      state: apiUp ? "operational" : "unavailable",
      detail: apiUp
        ? "La sonde /health a répondu et exécuté sa vérification de base."
        : error ?? "La sonde /health n'a pas confirmé la disponibilité de la base.",
    },
    {
      key: "contract",
      label: "Contrat API",
      state: !contract ? "unknown" : missingFeatures.length ? "degraded" : "operational",
      detail: !contract
        ? "Le serveur n'a pas exposé de contrat : impossible de comparer les fonctionnalités."
        : missingFeatures.length
          ? `Fonctionnalités manquantes : ${missingFeatures.join(", ")}.`
          : `Version ${contract.version ?? "inconnue"} : fonctionnalités attendues présentes.`,
    },
    {
      key: "mail",
      label: "Envoi d'e-mails",
      state: "notConfigured",
      detail: "Aucune sonde d'envoi réel n'est exposée. La présence de variables SMTP/Mailjet n'est pas une preuve de disponibilité.",
    },
    {
      key: "storage",
      label: "Stockage des fichiers",
      state: "unknown",
      detail: "Aucune vérification de lecture/écriture n'est exposée par l'API actuelle.",
    },
    {
      key: "overdue-cron",
      label: "Relance des factures",
      state: "unknown",
      detail: "Aucune date de dernière exécution réussie n'est exposée. État inconnu, pas une panne confirmée.",
    },
    {
      key: "tokens",
      label: "Jetons d'intégration",
      state: !tokenReview.known ? "unknown" : tokenReview.stale > 0 ? "degraded" : tokenReview.neverUsed > 0 ? "unknown" : "operational",
      detail: !tokenReview.known
        ? "Liste des jetons indisponible."
        : `${tokenReview.active} actif(s), ${tokenReview.neverUsed} jamais utilisé(s), ${tokenReview.stale} sans usage depuis ${STALE_TOKEN_DAYS} jours, ${tokenReview.expiring} expirant sous 30 jours. Le dernier usage est arrondi à la minute par le backend.`,
    },
  ];

  const risks = agentSessionJwtForwarding
    ? [
        {
          key: "agent-auth",
          label: "Assistant IA / n8n",
          state: "degraded",
          detail: "Risque confirmé par le code : le proxy transmet encore un JWT de session au webhook. Prévoir une délégation courte durée et limitée avant de modifier le workflow externe.",
        },
      ]
    : [];

  const worst = [...checks, ...risks].reduce(
    (current, check) => (STATE_SEVERITY[check.state] > STATE_SEVERITY[current] ? check.state : current),
    "operational",
  );

  return {
    checkedAt: data?.timestamp ?? new Date(now).toISOString(),
    contractVersion: contract?.version ?? null,
    missingFeatures,
    checks,
    risks,
    tokenReview,
    summary: {
      state: worst,
      label: worst === "operational" ? "Tous les contrôles disponibles sont opérationnels" : "Contrôles partiels : ne pas conclure à une santé globale verte",
      verified: checks.filter((check) => check.state === "operational").length,
      unverified: checks.filter((check) => check.state === "unknown" || check.state === "notConfigured").length,
    },
  };
}

/** Effet reel des onglets de parametres, verifie dans le code courant. */
export function settingsImpactForTab(tab) {
  switch (tab) {
    case "agency":
      return {
        tone: "warning",
        title: "Enregistré, effet non confirmé",
        body: "Ces coordonnées sont stockées dans la table des paramètres, mais aucun service backend ne les lit aujourd'hui. Les PDF utilisent les variables serveur PDF_COMPANY_*. Ne les présentez pas comme l'identité officielle des documents.",
      };
    case "advanced":
      return {
        tone: "warning",
        title: "Effet non vérifié",
        body: "Une clé technique n'agit que si un module la lit explicitement. Aucune liste de consommateurs n'est exposée par l'API : considérez toute nouvelle clé comme inactive jusqu'à preuve contraire.",
      };
    case "time":
      return {
        tone: "info",
        title: "Actif, mais local au navigateur",
        body: "Ces préférences sont enregistrées dans le stockage de ce navigateur pour votre compte. Elles ne modifient pas la configuration serveur et ne sont pas partagées entre appareils.",
      };
    case "devises":
      return { tone: "success", title: "Réglage actif", body: "Ce panneau lit et modifie l'API dédiée /currencies." };
    case "taux":
      return { tone: "success", title: "Réglage actif", body: "Ce panneau lit et modifie l'API dédiée /exchange-rates." };
    case "repartitions":
      return { tone: "info", title: "Renvoi vers l'Espace équipe", body: "Les règles de répartition ne sont plus administrées ici ; ce panneau renvoie vers le module financier de l'équipe." };
    default:
      return null;
  }
}
