"use client";

/*
 * Bouton « Chronométrer » d'une tâche (listes, cartes Kanban, fiche projet).
 *
 * Sur la tâche chronométrée, il devient une pastille vivante : décompte,
 * pause/reprise, terminer. Ailleurs, il démarre le minuteur — ou propose de
 * BASCULER si un autre tourne déjà (confirmation unique, voir `TimerProvider`).
 *
 * Utilisable dans une carte déplaçable : les pressions et les touches ne
 * remontent pas jusqu'au glisser-déposer.
 */

import { Pause, Play, Square } from "lucide-react";
import { useAuth } from "@/lib/session";
import { useOptionalTimer } from "@/lib/timer";
import { canUseTimer } from "@/lib/timer-access";
import { formatElapsed } from "@/lib/timer-format.mjs";

const stop = (event) => event.stopPropagation();

export default function TaskTimerButton({ task, size = "md", disabled = false, className = "" }) {
  const timer = useOptionalTimer();
  const { user } = useAuth();
  if (!timer || !task?.id || !canUseTimer(user)) return null;

  const current = timer.timer;
  const live = current?.taskId === task.id;
  const paused = live && current.status === "PAUSED";

  if (live) {
    return (
      <span
        className={`sui-ttb is-live${paused ? " is-paused" : ""} sui-ttb--${size} ${className}`.trim()}
        onPointerDown={stop}
        onKeyDown={stop}
      >
        <span className="sui-ttb__time" title={paused ? "Minuteur en pause" : "Minuteur en cours"}>
          <span className="sui-ttb__dot" aria-hidden="true" />
          <span className="sr-only">{paused ? "En pause : " : "En cours : "}</span>
          {formatElapsed(timer.elapsedSeconds)}
        </span>
        <button
          type="button"
          className="sui-ttb__icon"
          onClick={() => (paused ? timer.resume() : timer.pause())}
          disabled={timer.saving}
          aria-label={paused ? `Reprendre le minuteur de « ${task.title} »` : `Mettre en pause le minuteur de « ${task.title} »`}
          title={paused ? "Reprendre" : "Pause"}
        >
          {paused ? <Play size={14} strokeWidth={2.2} aria-hidden="true" /> : <Pause size={14} strokeWidth={2.2} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="sui-ttb__icon"
          onClick={() => timer.stop()}
          disabled={timer.saving}
          aria-label={`Terminer et enregistrer le temps de « ${task.title} »`}
          title="Terminer et enregistrer"
        >
          <Square size={12} strokeWidth={2.6} aria-hidden="true" />
        </button>
      </span>
    );
  }

  const switching = Boolean(current);
  const label = switching ? `Basculer le minuteur sur « ${task.title} »` : `Chronométrer « ${task.title} »`;
  return (
    <button
      type="button"
      className={`sui-ttb sui-ttb--${size} ${className}`.trim()}
      onPointerDown={stop}
      onKeyDown={stop}
      onClick={() => timer.requestStart(task)}
      disabled={disabled || timer.saving}
      aria-label={label}
      title={switching ? "Enregistrer le minuteur en cours et basculer sur cette tâche" : "Démarrer le minuteur sur cette tâche"}
    >
      <Play size={size === "sm" ? 13 : 15} strokeWidth={2.2} aria-hidden="true" />
      {size === "sm" ? null : <span>{switching ? "Basculer" : "Chronométrer"}</span>}
    </button>
  );
}
