"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";

/*
 * Minuteur global de l'équipe — PILOTÉ PAR LE SERVEUR.
 *
 * L'état (session, statut, secondes cumulées) vit en base, chez l'utilisateur
 * connecté. Ce contexte ne fait que :
 *   1. l'HYDRATER au montage (`GET /timer`) — le minuteur survit donc à un
 *      rechargement, à la fermeture de l'onglet, et à un changement de machine ;
 *   2. transmettre les gestes (`POST /timer/start|pause|resume|stop`) ;
 *   3. INTERPOLER l'affichage entre deux réponses : le décompte serveur est
 *      reçu avec `serverTime`, et le tick local ajoute simplement
 *      `Date.now() - fetchedAt` tant que la session est RUNNING. L'horloge du
 *      navigateur n'est jamais la référence — elle anime juste l'écran.
 *
 * L'arrêt crée la saisie de temps côté serveur, dans la même transaction que
 * l'arrêt de la session : rien n'est enregistré « en attendant », et deux
 * arrêts simultanés ne produisent pas deux saisies (le serveur tranche).
 *
 * Un compte client n'a pas de minuteur : `canUseTimer` ne l'affiche pas, et le
 * serveur refuse de toute façon.
 */
const TimerContext = createContext(null);

/** Forme exposée : `timer.title` garde le nom de l'API historique de l'écran. */
function presentSession(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    status: raw.status,
    taskId: raw.taskId,
    title: raw.taskTitle ?? "Tâche",
    taskIsPersonal: Boolean(raw.taskIsPersonal),
    startedAt: raw.startedAt,
    elapsedSeconds: raw.elapsedSeconds ?? 0,
  };
}

export function TimerProvider({ children }) {
  const { request, user } = useAuth();
  const ownerId = typeof user?.id === "string" ? user.id : null;

  // Un changement de compte remonte le contexte et relit la session du porteur.
  return (
    <TimerSession key={ownerId ?? "anonymous"} ownerId={ownerId} request={request}>
      {children}
    </TimerSession>
  );
}

function TimerSession({ children, ownerId, request }) {
  const [timer, setTimer] = useState(null);
  const [baseline, setBaseline] = useState(0);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(ownerId));
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Applique une réponse serveur comme nouvelle base d'affichage. */
  const applySession = useCallback((raw) => {
    setTimer(presentSession(raw));
    setBaseline(raw?.elapsedSeconds ?? 0);
    setFetchedAt(Date.now());
    setNow(Date.now());
    setLoading(false);
  }, []);

  /** Hydratation : la session serveur est la vérité, au montage et après chaque geste. */
  const refresh = useCallback(async () => {
    if (!ownerId) return null;
    try {
      // `request` renvoie l'enveloppe { data, meta } : c'est `data` qui porte
      // la session (ou null). Ne pas déballer ici afficherait une session vide.
      const { data } = await request("/timer");
      if (mounted.current) applySession(data ?? null);
      return data ?? null;
    } catch (caught) {
      if (mounted.current) {
        setLoading(false);
        setError(messageOf(caught));
      }
      return null;
    }
  }, [ownerId, request, applySession]);

  useEffect(() => {
    if (!ownerId) return undefined;
    // L'hydratation est ASYNCHRONE par nature : differee dans un timeout 0, elle
    // ne déclenche pas de cascade de rendus depuis le corps de l'effet.
    const id = window.setTimeout(() => {
      refresh();
    }, 0);
    return () => window.clearTimeout(id);
  }, [ownerId, refresh]);

  // Tick d'affichage : n'advance QUE pour une session RUNNING (et jamais quand
  // elle est en pause — le décompte est alors figé, côté serveur comme ici).
  useEffect(() => {
    if (!timer || timer.status !== "RUNNING") return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timer]);

  const elapsedSeconds = timer
    ? Math.max(0, baseline + (timer.status === "RUNNING" ? Math.floor((now - fetchedAt) / 1000) : 0))
    : 0;

  /**
   * Démarre sur une tâche. En cas de 409 (session déjà active ailleurs), on
   * RELIT la session serveur : l'écran se resynchronise au lieu d'afficher un
   * fantôme local.
   */
  const start = useCallback(
    async (task) => {
      if (!ownerId || typeof task?.id !== "string" || task.id.length === 0) {
        setError("Impossible de démarrer le minuteur sans compte connecté et tâche valide.");
        return null;
      }
      setSaving(true);
      setError(null);
      try {
        const { data } = await request("/timer/start", { method: "POST", body: { taskId: task.id } });
        if (mounted.current) {
          applySession(data);
          setSaving(false);
        }
        return presentSession(data);
      } catch (caught) {
        if (mounted.current) {
          setError(messageOf(caught));
          setSaving(false);
          await refresh();
        }
        return null;
      }
    },
    [ownerId, request, applySession, refresh],
  );

  /** Pause : le serveur replie le segment en cours dans le solde. */
  const pause = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const { data } = await request("/timer/pause", { method: "POST" });
      if (mounted.current) {
        applySession(data);
        setSaving(false);
      }
      return presentSession(data);
    } catch (caught) {
      if (mounted.current) {
        setError(messageOf(caught));
        setSaving(false);
        await refresh();
      }
      return null;
    }
  }, [request, applySession, refresh]);

  /** Reprise : un nouveau segment part de maintenant. */
  const resume = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const { data } = await request("/timer/resume", { method: "POST" });
      if (mounted.current) {
        applySession(data);
        setSaving(false);
      }
      return presentSession(data);
    } catch (caught) {
      if (mounted.current) {
        setError(messageOf(caught));
        setSaving(false);
        await refresh();
      }
      return null;
    }
  }, [request, applySession, refresh]);

  /**
   * Arrêt : la saisie de temps est créée et enregistrée PAR LE SERVEUR, dans la
   * même transaction que l'arrêt de la session. Retourne `{ savedMinutes,
   * remainingMinutes, overflowMinutes }` — `remainingMinutes` est toujours 0
   * (la durée entière est sauvée ou rien n'est perdu silencieusement), et
   * `overflowMinutes` signale un dépassement de 24 h corrigé à la main.
   */
  const stop = useCallback(async () => {
    if (!timer || !ownerId) return null;
    setSaving(true);
    setError(null);
    try {
      const { data } = await request("/timer/stop", { method: "POST" });
      const result = {
        savedMinutes: data?.savedMinutes ?? 0,
        remainingMinutes: 0,
        overflowMinutes: data?.overflowMinutes ?? 0,
        timeEntryId: data?.timeEntryId ?? null,
      };
      if (mounted.current) {
        setTimer(null);
        setBaseline(0);
        setSaving(false);
      }
      return result;
    } catch (caught) {
      if (mounted.current) {
        setError(messageOf(caught));
        setSaving(false);
        await refresh();
      }
      return null;
    }
  }, [ownerId, request, timer, refresh]);

  const value = useMemo(
    () => ({
      timer,
      elapsedSeconds,
      loading,
      start,
      pause,
      resume,
      stop,
      saving,
      error,
    }),
    [timer, elapsedSeconds, loading, start, pause, resume, stop, saving, error],
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
