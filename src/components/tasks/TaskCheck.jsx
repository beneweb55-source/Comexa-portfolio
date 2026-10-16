"use client";

/*
 * Case à cocher d'une tâche : cocher = terminer, décocher = remettre à faire
 * (tâche personnelle) ou rouvrir (tâche de projet).
 *
 * La case ne propose que ce que le serveur acceptera (`completionToggle`) :
 * une tâche de projet bloquée ou annulée ne se coche pas directement, et la
 * case grisée dit pourquoi (infobulle et nom accessible) au lieu de laisser
 * une erreur 422 surgir après coup.
 */

import { Check, Loader } from "lucide-react";
import { completionToggle } from "@/lib/task-status.mjs";

const stop = (event) => event.stopPropagation();

export default function TaskCheck({ task, onToggle, busy = false, size = "md", lockedReason = null }) {
  const base = completionToggle(task);
  // `lockedReason` : le rôle ne permet pas de modifier cette tâche (ancienne
  // assignation à un compte sans droit d'écriture) — la case le dit.
  const toggle = lockedReason ? { ...base, next: null, reason: lockedReason } : base;
  const unavailable = !toggle.next;
  const label = unavailable ? `${task.title} — ${toggle.reason}` : `${toggle.label} : ${task.title}`;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={toggle.checked}
      aria-disabled={unavailable || busy ? "true" : undefined}
      aria-label={label}
      title={toggle.reason ?? toggle.label}
      className={`sui-taskcheck sui-taskcheck--${size}${toggle.checked ? " is-checked" : ""}${unavailable ? " is-unavailable" : ""}${busy ? " is-busy" : ""}`}
      onPointerDown={stop}
      onKeyDown={stop}
      onClick={(event) => {
        event.stopPropagation();
        if (unavailable || busy) return;
        onToggle?.(toggle.next);
      }}
    >
      {busy ? (
        <Loader size={13} strokeWidth={2.4} className="sui-spin" aria-hidden="true" />
      ) : (
        <Check size={size === "sm" ? 12 : 14} strokeWidth={3} aria-hidden="true" />
      )}
    </button>
  );
}
