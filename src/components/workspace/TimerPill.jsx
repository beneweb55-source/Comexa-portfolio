"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { formatElapsed, useTimer } from "@/lib/timer";
import { useListing } from "@/lib/use-listing";
import { useAuth } from "@/lib/session";
import { canUseTimer } from "@/lib/timer-access";
import { Pagination } from "@/components/workspace/ui";
import Icon from "@/components/dashboard/icons";

/** Minuteur flottant Comexa, avec des surfaces claires et un menu clavier accessible. */
export default function TimerPill() {
  const pathname = usePathname() ?? "/";
  return <TimerPillContent key={pathname} pathname={pathname} />;
}

function TimerPillContent({ pathname }) {
  const { timer, elapsedSeconds, start, stop, saving, error } = useTimer();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState("");
  const [taskPage, setTaskPage] = useState(1);
  const { user } = useAuth();
  const allowed = canUseTimer(user);
  const tasks = useListing(allowed ? `/me/tasks?page=${taskPage}&perPage=50` : null);
  const list = (tasks.items ?? []).filter((task) => task.status !== "DONE" && task.status !== "CANCELLED");
  const [stopError, setStopError] = useState(null);
  const dialogId = useId();
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const rootRef = useRef(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) {
        wasOpen.current = false;
        if (triggerRef.current?.isConnected) triggerRef.current.focus();
      }
      return undefined;
    }

    wasOpen.current = true;
    panelRef.current?.querySelector("select, button:not(:disabled)")?.focus();

    function closeOnEscape(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      wasOpen.current = false;
      setOpen(false);
      triggerRef.current?.focus();
    }
    function closeOutside(event) {
      if (rootRef.current?.contains(event.target)) return;
      wasOpen.current = false;
      setOpen(false);
    }

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [open]);

  async function onStop() {
    setStopError(null);
    const result = await stop();
    if (result === null) setStopError("Enregistrement impossible : le minuteur continue.");
    else if (result.remainingMinutes > 0) {
      setStopError(`${result.savedMinutes} min enregistrées. Le minuteur continue pour les ${result.remainingMinutes} min restantes.`);
    } else setOpen(false);
  }

  // Sur le tableau de bord, le minuteur est déjà une tuile : éviter le doublon.
  if (!allowed || pathname === "/espace-equipe/tableau-de-bord") return null;

  return (
    <div ref={rootRef} className="cx-timer-pill" data-theme="team-dark">
      {open ? (
        <section ref={panelRef} id={dialogId} role="dialog" aria-labelledby={`${dialogId}-title`} className="cx-timer-pill__panel">
          {timer ? (
            <>
              <p className="cx-timer-pill__eyebrow">Enregistrement en cours</p>
              <h2 id={`${dialogId}-title`} className="cx-timer-pill__time">{formatElapsed(elapsedSeconds)}</h2>
              <p className="cx-timer-pill__task" title={timer.title}>{timer.title}</p>
              <button type="button" onClick={onStop} disabled={saving} className="cx-timer-pill__stop">
                <Icon name="stop" />
                {saving ? "Enregistrement…" : "Arrêter et enregistrer"}
              </button>
            </>
          ) : (
            <>
              <h2 id={`${dialogId}-title`} className="cx-timer-pill__title">Chronométrer une tâche</h2>
              {tasks.error ? <p className="cx-timer-pill__error" role="alert">{tasks.error}</p> : null}
              <label htmlFor={`${dialogId}-task`} className="cx-timer-pill__label">Tâche</label>
              <select id={`${dialogId}-task`} value={picked} onChange={(event) => setPicked(event.target.value)} className="cx-timer-pill__select">
                <option value="">{list.length ? "Choisir une tâche…" : tasks.items === null ? "Chargement…" : "Aucune tâche assignée"}</option>
                {list.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
              </select>
              <Pagination
                meta={tasks.meta}
                onPageChange={(nextPage) => { setPicked(""); setTaskPage(nextPage); }}
                loading={tasks.loading}
                label="Pagination des tâches du minuteur"
              />
              <button
                type="button"
                disabled={!picked || saving}
                onClick={() => {
                  const task = list.find((item) => item.id === picked);
                  if (task) start(task);
                }}
                className="cx-timer-pill__start"
              >
                <Icon name="play" />
                Démarrer
              </button>
            </>
          )}
          {error || stopError ? <p role="alert" className="cx-timer-pill__error">{error ?? stopError}</p> : null}
        </section>
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={dialogId}
        className={`cx-timer-pill__trigger${timer ? " is-active" : ""}`}
      >
        <Icon name={timer ? "clock" : "play"} />
        {timer ? <span className="cx-timer-pill__trigger-time">{formatElapsed(elapsedSeconds)}</span> : "Minuteur"}
      </button>
    </div>
  );
}
