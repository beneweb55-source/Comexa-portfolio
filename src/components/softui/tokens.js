/**
 * Tokens du système SoftUI + Liquid Glass harmonisé avec la charte Comexa.
 *
 * La source de vérité reste les variables CSS (`src/styles/softui.tokens.css`) :
 * les composants consomment `var(--…)`.
 */

export const TONES = {
  blue: { bg: "var(--blue)", ink: "var(--ink)", name: "Bleu Comexa" },
  green: { bg: "var(--green)", ink: "var(--ink)", name: "Émeraude" },
  yellow: { bg: "var(--yellow)", ink: "var(--ink)", name: "Ambre" },
  lilac: { bg: "var(--lilac)", ink: "var(--ink)", name: "Indigo" },
  "lilac-strong": { bg: "var(--lilac-strong)", ink: "var(--ink)", name: "Indigo soutenu" },
  pink: { bg: "var(--pink)", ink: "var(--ink)", name: "Corail" },
  ghost: { bg: "transparent", ink: "var(--muted)", name: "Attente" },
  plain: { bg: "var(--surface)", ink: "var(--ink)", name: "Neutre" },
};

/** Ordre d'attribution des pastels (cycle) quand un appelant ne fixe pas la teinte. */
export const TONE_CYCLE = ["blue", "green", "yellow", "lilac", "pink"];

export function toneAt(index) {
  return TONE_CYCLE[((index % TONE_CYCLE.length) + TONE_CYCLE.length) % TONE_CYCLE.length];
}

export function toneStyle(tone = "plain") {
  return TONES[tone] ?? TONES.plain;
}

/** Statuts métier → tonalité de la pilule. Les libellés viennent des pages (FR). */
export const STATUS_TONES = {
  active: "green",
  published: "green",
  paid: "green",
  validated: "green",
  success: "green",
  completed: "green",
  done: "green",
  accepted: "green",
  pending: "yellow",
  ordered: "yellow",
  submitted: "yellow",
  "in-review": "yellow",
  "in-progress": "yellow",
  in_progress: "yellow",
  in_review: "lilac",
  planned: "blue",
  warning: "yellow",
  live: "pink",
  open: "pink",
  failed: "pink",
  suspended: "pink",
  blocked: "pink",
  overdue: "pink",
  rejected: "pink",
  cancelled: "pink",
  draft: "plain",
  inactive: "plain",
  archived: "plain",
  unknown: "plain",
};

export function statusTone(key, fallback = "plain") {
  if (!key) return fallback;
  return STATUS_TONES[String(key).toLowerCase()] ?? fallback;
}

/** Cadences (secondes) — ressort fluide Apple/Linear (200–360 ms, stagger 40 ms). */
export const MOTION = {
  fast: 0.16,
  base: 0.24,
  slow: 0.34,
  stagger: 0.04,
  easeOut: [0.16, 1, 0.3, 1],
};
