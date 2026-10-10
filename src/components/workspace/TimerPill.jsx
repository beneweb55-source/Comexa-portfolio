"use client";

import { useEffect, useState } from "react";
import { formatElapsed, useTimer } from "@/lib/timer";
import { useListing } from "@/lib/use-listing";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import Icon from "@/components/dashboard/icons";

/*
 * Minuteur global, toujours visible en bas à droite de l'espace équipe.
 * Replié : une pastille (temps écoulé si actif). Déplié : choix d'une tâche, démarrer / arrêter.
 */
export default function TimerPill() {
  const { timer, elapsedSeconds, start, stop, saving, error } = useTimer();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState("");
  const { user: timerUser } = useAuth();
  const canSeeTasks = can(timerUser, "task:read:any") || can(timerUser, "task:read:assigned") || can(timerUser, "task:read:own");
  const tasks = useListing(canSeeTasks ? "/me/tasks?perPage=50" : null);
  const list = (tasks.items ?? []).filter((t) => t.status !== "DONE" && t.status !== "CANCELLED");
  const [stopError, setStopError] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function onStop() {
    setStopError(null);
    const minutes = await stop();
    if (minutes === null) setStopError("Enregistrement impossible : le minuteur continue.");
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open ? (
        <div role="dialog" aria-label="Minuteur" className="w-[300px] rounded-3xl border border-white/10 bg-[#0b2545]/90 p-5 text-white shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-2xl">
          {timer ? (
            <>
              <p className="text-[12px] uppercase tracking-[0.14em] text-sky-300/80">En cours</p>
              <p className="mt-1 font-mono text-[30px] font-semibold tabular-nums">{formatElapsed(elapsedSeconds)}</p>
              <p className="mt-1 truncate text-[13px] text-white/65">{timer.title}</p>
              <button type="button" onClick={onStop} disabled={saving} className="mt-4 w-full rounded-2xl bg-rose-500/90 px-4 py-2.5 text-[14px] font-medium hover:bg-rose-500 disabled:opacity-60">
                {saving ? "Enregistrement…" : "Arrêter et enregistrer"}
              </button>
            </>
          ) : (
            <>
              <p className="text-[14px] font-semibold">Chronométrer une tâche</p>
              {tasks.error ? <p className="mt-2 text-[12.5px] text-rose-300" role="alert">{tasks.error}</p> : null}
              <label htmlFor="pill-task" className="sr-only">Tâche</label>
              <select id="pill-task" value={picked} onChange={(e) => setPicked(e.target.value)} className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-[14px] text-white outline-none focus:border-sky-300/60">
                <option value="" className="text-[#0b2545]">{list.length ? "Choisir une tâche…" : tasks.items === null ? "Chargement…" : "Aucune tâche assignée"}</option>
                {list.map((task) => (
                  <option key={task.id} value={task.id} className="text-[#0b2545]">{task.title}</option>
                ))}
              </select>
              <button type="button" disabled={!picked} onClick={() => { const t = list.find((x) => x.id === picked); if (t) start(t); }} className="mt-3 w-full rounded-2xl bg-white px-4 py-2.5 text-[14px] font-medium text-[#0b2545] hover:bg-sky-100 disabled:opacity-40">
                Démarrer
              </button>
            </>
          )}
          {error || stopError ? <p role="alert" className="mt-3 text-[12.5px] text-rose-300">{error ?? stopError}</p> : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex items-center gap-2 rounded-full border border-white/10 px-4 py-3 text-[14px] font-medium text-white shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-2xl transition ${timer ? "bg-emerald-500/85 hover:bg-emerald-500" : "bg-[#0b2545]/85 hover:bg-[#0f3a66]"}`}
      >
        <Icon name={timer ? "clock" : "play"} className="h-4 w-4" />
        {timer ? <span className="font-mono tabular-nums">{formatElapsed(elapsedSeconds)}</span> : "Minuteur"}
      </button>
    </div>
  );
}
