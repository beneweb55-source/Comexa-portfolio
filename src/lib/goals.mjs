/**
 * Objectifs personnels : teintes, compte à rebours, avancement.
 * Fonctions pures, sans dépendance à React ni à l'API. L'avancement affiché vient
 * du serveur (`progress`) ; le recalcul local ne sert qu'aux mises à jour
 * optimistes (case cochée avant la réponse).
 */

import { localDay } from "./task-status.mjs";

export const GOAL_TONES = ["blue", "green", "yellow", "lilac", "pink"];

export const GOAL_TONE_LABEL = {
  blue: "Bleu",
  green: "Vert",
  yellow: "Jaune",
  lilac: "Lilas",
  pink: "Rose",
};

export function goalTone(color) {
  return GOAL_TONES.includes(color) ? color : "blue";
}

/** Même règle que le serveur : une tâche annulée ne compte ni pour ni contre. */
export function goalProgressOf(statuses) {
  const list = Array.isArray(statuses) ? statuses : [];
  const total = list.length;
  const done = list.filter((status) => status === "DONE").length;
  const cancelled = list.filter((status) => status === "CANCELLED").length;
  const counted = total - cancelled;
  return {
    total,
    done,
    cancelled,
    open: total - done - cancelled,
    percent: counted === 0 ? 0 : Math.round((done / counted) * 100),
  };
}

/**
 * MIROIR de `backend/src/modules/goals/goal-rules.ts` (`goalCanBeAchieved`).
 * Le serveur reste la référence (il refuse la déclaration) ; ce miroir sert
 * uniquement à ne pas PROPOSER un geste qu'il refusera, et à expliquer pourquoi.
 *
 * « Atteint » exige au moins une tâche réellement terminée et aucune tâche
 * ouverte. Un objectif vide — ou dont toutes les tâches sont annulées — ne
 * l'est pas. L'anneau n'est donc jamais forcé à 100 % : un pourcentage tape
 * (ou calculé) à la place des faits finit toujours par mentir.
 */
export function goalCanBeAchieved(progress) {
  if (!progress) return false;
  const counted = progress.total - progress.cancelled;
  return counted > 0 && progress.done > 0 && progress.open === 0 && progress.done === counted;
}

function dayNumber(day) {
  return Math.round(new Date(`${day}T00:00:00Z`).getTime() / 86_400_000);
}

/**
 * Compte à rebours vers la date cible (jour stocké à minuit UTC).
 *
 * @returns {{ label: string, tone: "late" | "soon" | "ok" } | null}
 */
export function goalCountdown(targetDate, now = Date.now()) {
  if (!targetDate) return null;
  const target = new Date(targetDate);
  if (!Number.isFinite(target.getTime())) return null;
  const diff = dayNumber(target.toISOString().slice(0, 10)) - dayNumber(localDay(now));
  if (diff < 0) return { label: `Dépassé de ${-diff} j`, tone: "late" };
  if (diff === 0) return { label: "Aujourd’hui", tone: "soon" };
  if (diff === 1) return { label: "Demain", tone: "soon" };
  return { label: `J-${diff}`, tone: diff <= 7 ? "soon" : "ok" };
}
