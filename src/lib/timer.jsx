"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";

/*
 * Minuteur global de l'équipe. L'état « en cours » vit dans le navigateur (localStorage)
 * pour survivre à un rechargement. L'ARRÊT crée une vraie entrée de temps côté API
 * (POST /tasks/:id/time-entries) : rien n'est enregistré tant qu'on n'a pas arrêté.
 */
const STORAGE_KEY = "comexa.timer.v1";
const TimerContext = createContext(null);

function readStoredTimer() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function TimerProvider({ children }) {
  const { request } = useAuth();
  // Lecture du minuteur sauvegardé à l'initialisation (navigateur seulement : l'espace n'est rendu qu'après connexion).
  const [timer, setTimer] = useState(() => readStoredTimer());
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!timer) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timer]);

  const start = useCallback((task) => {
    const next = { taskId: task.id, title: task.title ?? "Tâche", startedAt: new Date().toISOString() };
    setError(null);
    setTimer(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  /** Arrête et enregistre. En cas d'échec, le minuteur continue : aucune minute perdue. */
  const stop = useCallback(async () => {
    if (!timer) return null;
    const elapsedMinutes = Math.round((Date.now() - new Date(timer.startedAt).getTime()) / 60000);
    const minutes = Math.min(1440, Math.max(1, elapsedMinutes));
    setSaving(true);
    setError(null);
    try {
      await request(`/tasks/${timer.taskId}/time-entries`, {
        method: "POST",
        body: { minutes, spentOn: new Date().toISOString(), description: `Minuteur : ${timer.title}`.slice(0, 500), billable: true },
      });
      setTimer(null);
      window.localStorage.removeItem(STORAGE_KEY);
      return minutes;
    } catch (caught) {
      setError(messageOf(caught));
      return null;
    } finally {
      setSaving(false);
    }
  }, [timer, request]);

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
