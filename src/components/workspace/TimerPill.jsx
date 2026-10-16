"use client";

/*
 * Minuteur du dock : un déclencheur toujours visible (décompte vivant quand il
 * tourne) et le panneau complet du minuteur au-dessus du dock.
 *
 * `variant="dock"` : rendu DANS le dock de la coque (segment de droite). Sur
 * mobile, le panneau devient une feuille posée en bas d'écran.
 * `variant="floating"` (historique) : pastille flottante dans le coin.
 */

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Pause, Play } from "lucide-react";
import { useAuth } from "@/lib/session";
import { useTimer } from "@/lib/timer";
import { canUseTimer } from "@/lib/timer-access";
import { formatElapsed } from "@/lib/timer-format.mjs";
import TimerPanel from "@/components/timer/TimerPanel";

export default function TimerPill({ variant = "floating" }) {
  const pathname = usePathname() ?? "/";
  const docked = variant === "dock";
  const { timer, elapsedSeconds, refreshSummary } = useTimer();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const titleId = useId();
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const rootRef = useRef(null);
  const wasOpen = useRef(false);
  const lastPath = useRef(pathname);

  // Une navigation referme le panneau (on vient de cliquer un lien du dock).
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) {
        wasOpen.current = false;
        if (triggerRef.current?.isConnected) triggerRef.current.focus();
      }
      return undefined;
    }

    wasOpen.current = true;
    refreshSummary();
    const focusTarget = panelRef.current?.querySelector("input, textarea, button:not(:disabled)");
    focusTarget?.focus();

    function closeOnEscape(event) {
      if (event.key !== "Escape") return;
      // Une boîte de dialogue ouverte par-dessus (bascule) garde la priorité.
      if (document.querySelector(".sui-dialog-backdrop")) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
    function closeOutside(event) {
      if (rootRef.current?.contains(event.target)) return;
      if (event.target.closest?.(".sui-dialog-backdrop")) return;
      setOpen(false);
    }

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [open, refreshSummary]);

  // Sur le tableau de bord de l'équipe, la pastille flottante ferait doublon
  // avec la tuile ; dans le dock, le minuteur reste à sa place.
  if (!canUseTimer(user) || (!docked && pathname === "/espace-equipe/tableau-de-bord")) return null;

  const paused = timer?.status === "PAUSED";
  const triggerClass = docked
    ? `sui-dock-timer__trigger${timer ? " is-active" : ""}${paused ? " is-paused" : ""}`
    : `cx-timer-pill__trigger${timer ? " is-active" : ""}`;

  return (
    <div ref={rootRef} className={docked ? "sui-dock-timer" : "cx-timer-pill"}>
      {open ? (
        <section
          ref={panelRef}
          id={dialogId}
          role="dialog"
          aria-labelledby={titleId}
          className="sui-dock-timer__panel"
        >
          <TimerPanel variant="popover" titleId={titleId} onClose={() => setOpen(false)} />
        </section>
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={
          timer
            ? `Minuteur ${paused ? "en pause" : "en cours"} sur ${timer.title} : ${formatElapsed(elapsedSeconds)}`
            : "Ouvrir le minuteur"
        }
        className={triggerClass}
      >
        {timer ? (
          <>
            {paused ? (
              <Pause size={16} strokeWidth={2.2} aria-hidden="true" />
            ) : (
              <span className="sui-dock-timer__pulse" aria-hidden="true" />
            )}
            <span className="cx-timer-pill__trigger-time">{formatElapsed(elapsedSeconds)}</span>
            <span className="sui-dock-timer__task">{timer.title}</span>
          </>
        ) : (
          <>
            <Play size={16} strokeWidth={2.2} aria-hidden="true" />
            <span>Minuteur</span>
          </>
        )}
      </button>
    </div>
  );
}
