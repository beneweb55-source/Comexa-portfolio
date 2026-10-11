"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { elapsedMinutes, parseStoredTimer, splitTimerDuration, timerStorageKey } from "@/lib/timer-utils.mjs";

/*
 * Minuteur global de l'équipe. Son état local est cloisonné par compte et
 * survit à un rechargement. L'arrêt crée une vraie saisie côté API ; rien n'est
 * enregistré tant que l'appel n'a pas réussi.
 */
const TimerContext = createContext(null);

function readStoredTimer(ownerId) {
  const key = timerStorageKey(ownerId);
  if (!key || typeof window === "undefined") return null;

  for (const area of ["localStorage", "sessionStorage"]) {
    try {
      const storage = window[area];
      const raw = storage.getItem(key);
      const timer = parseStoredTimer(raw, ownerId);
      if (timer) return timer;
      if (raw) storage.removeItem(key);
    } catch {
      // Le navigateur peut interdire une zone de stockage entière.
    }
  }
  return null;
}

function writeStoredTimer(ownerId, timer) {
  const key = timerStorageKey(ownerId);
  if (!key || typeof window === "undefined") return false;
  const serialized = JSON.stringify(timer);
  try {
    window.localStorage.setItem(key, serialized);
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Le localStorage contient la valeur valide ; l'ancien secours sera ignoré.
    }
    return true;
  } catch {
    try {
      window.sessionStorage.setItem(key, serialized);
      return true;
    } catch {
      return false;
    }
  }
}

function removeStoredTimer(ownerId) {
  const key = timerStorageKey(ownerId);
  if (!key || typeof window === "undefined") return false;
  let removedEverywhere = true;
  for (const area of ["localStorage", "sessionStorage"]) {
    try {
      window[area].removeItem(key);
    } catch {
      removedEverywhere = false;
    }
  }
  return removedEverywhere;
}

export function TimerProvider({ children }) {
  const { request, user } = useAuth();
  const ownerId = typeof user?.id === "string" ? user.id : null;

  // Un changement de compte remonte le contexte et relit uniquement le stockage de ce porteur.
  return (
    <TimerSession key={ownerId ?? "anonymous"} ownerId={ownerId} request={request}>
      {children}
    </TimerSession>
  );
}

function TimerSession({ children, ownerId, request }) {
  const [timer, setTimer] = useState(() => readStoredTimer(ownerId));
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!timer) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timer]);

  const start = useCallback((task) => {
    if (!ownerId || typeof task?.id !== "string" || task.id.length === 0) {
      setError("Impossible de démarrer le minuteur sans compte connecté et tâche valide.");
      return;
    }

    const next = {
      ownerId,
      taskId: task.id,
      title: typeof task.title === "string" && task.title.trim() ? task.title : "Tâche",
      startedAt: new Date().toISOString(),
    };
    setError(null);
    setNow(Date.now());
    setTimer(next);
    if (!writeStoredTimer(ownerId, next)) {
      setError("Minuteur démarré, mais le navigateur ne peut pas le conserver après rechargement.");
    }
  }, [ownerId]);

  /** Arrête et enregistre. En cas d'échec API, le minuteur continue sans perte de durée. */
  const stop = useCallback(async () => {
    if (!timer || !ownerId || timer.ownerId !== ownerId) return null;

    const elapsed = elapsedMinutes(timer.startedAt, Date.now());
    if (elapsed === null) {
      setError("La date de départ du minuteur est invalide. Il n'a pas été arrêté.");
      return null;
    }
    const totalMinutes = Math.max(1, elapsed);
    const plan = splitTimerDuration(timer.startedAt, totalMinutes);
    if (!plan) {
      setError("La durée du minuteur ne peut pas être répartie en saisies valides.");
      return null;
    }

    setSaving(true);
    setError(null);
    let savedMinutes = 0;
    try {
      for (const chunk of plan.chunks) {
        await request(`/tasks/${encodeURIComponent(timer.taskId)}/time-entries`, {
          method: "POST",
          body: {
            minutes: chunk.minutes,
            spentOn: chunk.spentOn,
            description: `Minuteur : ${timer.title}`.slice(0, 500),
            billable: true,
          },
        });
        savedMinutes += chunk.minutes;

        const remainingMinutes = totalMinutes - savedMinutes;
        if (remainingMinutes > 0) {
          const remainingTimer = { ...timer, startedAt: chunk.resumeAt };
          setTimer(remainingTimer);
          if (!writeStoredTimer(ownerId, remainingTimer)) {
            setError(`${savedMinutes} min enregistrées. Le minuteur continue, mais sa reprise ne peut pas être conservée par le navigateur.`);
            return { savedMinutes, remainingMinutes };
          }
        }
      }

      const remainingMinutes = totalMinutes - savedMinutes;
      if (remainingMinutes > 0) {
        setError(`${savedMinutes} min enregistrées. Le minuteur continue pour les ${remainingMinutes} min restantes.`);
        return { savedMinutes, remainingMinutes };
      }

      setTimer(null);
      if (!removeStoredTimer(ownerId)) {
        setError("Temps enregistré, mais le navigateur n'a pas pu effacer l'état local du minuteur.");
      }
      return { savedMinutes, remainingMinutes: 0 };
    } catch (caught) {
      setError(messageOf(caught));
      return null;
    } finally {
      setSaving(false);
    }
  }, [ownerId, request, timer]);

  const value = useMemo(
    () => ({
      timer,
      elapsedSeconds: timer ? Math.max(0, Math.floor((now - new Date(timer.startedAt).getTime()) / 1000)) : 0,
      start,
      stop,
      saving,
      error,
    }),
    [timer, now, start, stop, saving, error],
  );

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useTimer() {
  const value = useContext(TimerContext);
  if (!value) throw new Error("useTimer doit être utilisé dans TimerProvider.");
  return value;
}

/** Format HH:MM:SS. */
export function formatElapsed(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}
