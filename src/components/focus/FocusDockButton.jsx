"use client";

/*
 * Déclencheur du mode concentration, dans le dock de la coque.
 *
 * Le bouton montre l'état réel de la session : à l'arrêt il propose d'ouvrir
 * le mode ; en cours il affiche le temps restant, pour qu'on sache depuis
 * n'importe quel écran qu'un bloc tourne — et qu'on puisse y retourner d'un
 * clic. La pastille verte signale la session active.
 */

import { Target } from "lucide-react";
import { formatElapsed } from "@/lib/timer-format.mjs";
import { useOptionalFocus } from "./FocusProvider";

export default function FocusDockButton() {
  const focus = useOptionalFocus();
  // Hors d'un espace qui monte le mode (comptes sans minuteur) : rien.
  if (!focus) return null;

  const active = Boolean(focus.session);
  const label = active
    ? `Concentration en cours, il reste ${formatElapsed(focus.remaining)} — ouvrir le mode concentration`
    : "Démarrer une session de concentration";

  return (
    <button
      type="button"
      data-role="focus-trigger"
      className={`sui-dock-timer__trigger${active ? " is-active" : ""}`}
      onClick={focus.openFocus}
      aria-label={label}
      title={active ? `Concentration · reste ${formatElapsed(focus.remaining)}` : "Mode concentration"}
    >
      <Target size={16} strokeWidth={2.2} aria-hidden="true" />
      {active ? <span className="cx-timer-pill__trigger-time">{formatElapsed(focus.remaining)}</span> : <span>Concentration</span>}
      {active ? <span className="sui-dock-timer__task">{focus.session.taskTitle}</span> : null}
    </button>
  );
}
