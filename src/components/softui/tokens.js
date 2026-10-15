/**
 * Tokens du système « soft UI pastel dans une coque noire ».
 *
 * La source de vérité reste les variables CSS (`src/styles/softui.tokens.css`) :
 * les composants consomment `var(--…)`. Ce module n'expose que ce que le JavaScript
 * doit connaître (nuanciers de tonalité, cadences d'animation, échelle typographique)
 * pour ne jamais dupliquer une couleur en dur dans un composant.
 */

export const TONES = {
  blue: { bg: "var(--blue)", ink: "var(--ink)", name: "Bleu" },
  green: { bg: "var(--green)", ink: "var(--ink)", name: "Vert" },
  yellow: { bg: "var(--yellow)", ink: "var(--ink)", name: "Jaune" },
  lilac: { bg: "var(--lilac)", ink: "var(--ink)", name: "Lilas" },
  "lilac-strong": { bg: "var(--lilac-strong)", ink: "var(--ink)", name: "Lilas soutenu" },
  pink: { bg: "var(--pink)", ink: "var(--ink)", name: "Rose" },
  ghost: { bg: "transparent", ink: "var(--muted)", name: "Attente" },
  plain: { bg: "var(--surface)", ink: "var(--ink)", name: "Neutre" },
};

/** Ordre d'attribution des pastels (cycle) quand un appelant ne fixe pas la teinte. */
export const TONE_CYCLE = ["blue", "green", "yellow", "lilac", "pink"];

export function toneAt(index) {
  return TONE_CYCLE[((index % TONE_CYCLE.length) + TONE_CYCLE.length) % TONE_CYCLE.length];
}

/** Statuts métier → tonalité de la pilule. Les libellés viennent des pages (FR). */
export const STATUS_TONES = {
  active: "green",
  published: "green",
  paid: "green",
  validated: "green",
  success: "green",
  pending: "yellow",
  ordered: "yellow",
  "in-review": "yellow",
  "in-progress": "yellow",
  warning: "yellow",
  live: "pink",
  open: "pink",
  failed: "pink",
  suspended: "pink",
  blocked: "pink",
  draft: "plain",
  inactive: "plain",
  archived: "plain",
  unknown: "plain",
};

export function statusTone(key, fallback = "plain") {
  if (!key) return fallback;
  return STATUS_TONES[String(key).toLowerCase()] ?? fallback;
}

/** Cadences (ms) — alignées sur le brief : 150–300 ms, ease-out, stagger 40 ms. */
export const MOTION = {
  fast: 0.15,
  base: 0.22,
  slow: 0.3,
  stagger: 0.04,
  easeOut: [0.16, 1, 0.3, 1],
};
