"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { formatElapsed, titleWithTimer } from "@/lib/timer-format.mjs";
import Dialog from "@/components/softui/Dialog";
import { Button } from "@/components/softui/primitives";

export { formatElapsed };

/*
 * Minuteur global de l'équipe — PILOTÉ PAR LE SERVEUR.
 *
 * L'état (session, statut, secondes cumulées, note) vit en base, chez
 * l'utilisateur connecté. Ce contexte ne fait que :
 *   1. l'HYDRATER (`GET /timer`) au montage, au retour sur l'onglet, à chaque
 *      minute tant que l'onglet est visible, et quand un AUTRE onglet le modifie
 *      (BroadcastChannel) — deux onglets ne se contredisent donc jamais
 *      longtemps, et un arrêt fait depuis le téléphone se voit sur l'ordinateur ;
 *   2. transmettre les gestes : démarrer (sur une tâche ou sans), mettre en
 *      pause, reprendre, CHANGER DE TÂCHE sans perdre le temps, noter, terminer
 *      (la saisie de temps est créée par le serveur) ou abandonner ;
 *   3. INTERPOLER l'affichage entre deux réponses : le décompte serveur est la
 *      référence, le tick local ajoute `Date.now() - fetchedAt` tant que la
 *      session tourne.
 *
 * Basculer d'une tâche à une autre (bouton « Chronométrer » d'une autre tâche
 * pendant qu'un minuteur tourne) passe par une confirmation unique, rendue ici :
 * la session en cours est enregistrée, puis la nouvelle démarre.
 *
 * Un compte client n'a pas de minuteur : `canUseTimer` ne l'affiche pas, et le
 * serveur refuse de toute façon.
 */
const TimerContext = createContext(null);
const CHANNEL_NAME = "comexa-timer";
const POLL_MS = 60_000;

/** Forme exposée. `timer.title` reste le nom lu par les écrans historiques. */
function presentSession(raw) {
  if (!raw) return null;
  const task =
    raw.task ??
    (raw.taskId
      ? { id: raw.taskId, title: raw.taskTitle ?? "Tâche", isPersonal: Boolean(raw.taskIsPersonal), project: null, estimateMinutes: null, loggedMinutes: 0 }
      : null);
  return {
    id: raw.id,
    status: raw.status,
    taskId: raw.taskId ?? null,
    title: task?.title ?? "Sans tâche",
    taskIsPersonal: Boolean(task?.isPersonal),
    task,
    note: raw.note ?? "",
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
  const [summary, setSummary] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [pendingSwitch, setPendingSwitch] = useState(null);
  const mounted = useRef(true);
  const channel = useRef(null);
  const lastRefresh = useRef(0);

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

  /** Hydratation : la session serveur est la vérité. */
  const refresh = useCallback(async () => {
    if (!ownerId) return null;
    lastRefresh.current = Date.now();
    try {
      // `request` renvoie l'enveloppe { data, meta } : c'est `data` qui porte
      // la session (ou null).
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

  /** Mon temps du jour et de la semaine (silencieux en cas d'échec : c'est un bonus). */
  const refreshSummary = useCallback(async () => {
    if (!ownerId) return null;
    try {
      const { data } = await request("/timer/summary");
      if (mounted.current) setSummary(data ?? null);
      return data ?? null;
    } catch {
      return null;
    }
  }, [ownerId, request]);

  /** Prévient les autres onglets qu'il faut relire le minuteur. */
  const broadcast = useCallback(() => {
    try {
      channel.current?.postMessage({ type: "changed", at: Date.now() });
    } catch {
      // canal indisponible : les autres onglets se resynchroniseront au focus
    }
  }, []);

  useEffect(() => {
    if (!ownerId) return undefined;
    // Différée dans un timeout 0 : l'hydratation ne déclenche pas de cascade
    // de rendus depuis le corps de l'effet.
    const id = window.setTimeout(() => {
      refresh();
      refreshSummary();
    }, 0);

    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel(`${CHANNEL_NAME}:${ownerId}`);
      channel.current.onmessage = () => {
        refresh();
        refreshSummary();
      };
    }

    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefresh.current < 5_000) return;
      refresh();
      refreshSummary();
    }
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearTimeout(id);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      channel.current?.close();
      channel.current = null;
    };
  }, [ownerId, refresh, refreshSummary]);

  // Tick d'affichage : n'avance QUE pour une session RUNNING.
  useEffect(() => {
    if (!timer || timer.status !== "RUNNING") return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timer]);

  const elapsedSeconds = timer
    ? Math.max(0, baseline + (timer.status === "RUNNING" ? Math.floor((now - fetchedAt) / 1000) : 0))
    : 0;

  // Le décompte dans le titre de l'onglet : on le voit depuis un autre onglet.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const next = titleWithTimer(document.title, timer?.status ?? null, elapsedSeconds);
    if (next !== document.title) document.title = next;
  }, [timer?.status, elapsedSeconds]);

  useEffect(
    () => () => {
      if (typeof document !== "undefined") document.title = titleWithTimer(document.title, null, 0);
    },
    [],
  );

  /** Geste générique : envoie, applique la session renvoyée, prévient les autres onglets. */
  const mutate = useCallback(
    async (path, { method = "POST", body } = {}) => {
      setSaving(true);
      setError(null);
      try {
        const { data } = await request(path, { method, ...(body === undefined ? {} : { body }) });
        if (mounted.current) setSaving(false);
        broadcast();
        return { ok: true, data };
      } catch (caught) {
        if (mounted.current) {
          setError(messageOf(caught));
          setSaving(false);
          await refresh();
        }
        return { ok: false, data: null };
      }
    },
    [broadcast, refresh, request],
  );

  /** Démarre sur une tâche. En cas de 409, la session serveur est relue. */
  const start = useCallback(
    async (task, { note } = {}) => {
      if (!ownerId || typeof task?.id !== "string" || task.id.length === 0) {
        setError("Impossible de démarrer le minuteur sans compte connecté et tâche valide.");
        return null;
      }
      const result = await mutate("/timer/start", { body: { taskId: task.id, ...(note ? { note } : {}) } });
      if (!result.ok) return null;
      if (mounted.current) {
        applySession(result.data);
        setLastResult(null);
      }
      return presentSession(result.data);
    },
    [ownerId, mutate, applySession],
  );

  /** Démarrage rapide, SANS tâche : la tâche peut être choisie ensuite. */
  const startFree = useCallback(
    async ({ note } = {}) => {
      if (!ownerId) return null;
      const result = await mutate("/timer/start", { body: note ? { note } : {} });
      if (!result.ok) return null;
      if (mounted.current) {
        applySession(result.data);
        setLastResult(null);
      }
      return presentSession(result.data);
    },
    [ownerId, mutate, applySession],
  );

  const pause = useCallback(async () => {
    const result = await mutate("/timer/pause");
    if (result.ok && mounted.current) applySession(result.data);
    return result.ok ? presentSession(result.data) : null;
  }, [mutate, applySession]);

  const resume = useCallback(async () => {
    const result = await mutate("/timer/resume");
    if (result.ok && mounted.current) applySession(result.data);
    return result.ok ? presentSession(result.data) : null;
  }, [mutate, applySession]);

  /** Change la tâche de la session EN COURS (le temps écoulé est conservé). `null` : aucune. */
  const setTask = useCallback(
    async (task) => {
      const result = await mutate("/timer", { method: "PATCH", body: { taskId: task?.id ?? null } });
      if (result.ok && mounted.current) applySession(result.data);
      return result.ok ? presentSession(result.data) : null;
    },
    [mutate, applySession],
  );

  /** Enregistre la note de la session (elle deviendra la description de la saisie). */
  const saveNote = useCallback(
    async (note) => {
      try {
        const { data } = await request("/timer", { method: "PATCH", body: { note: note ?? null } });
        // La note devient celle de la session partagée : un autre panneau
        // (dock, carte « Ma journée ») l'affiche sans attendre une relecture.
        if (mounted.current && data) {
          setTimer((current) => (current && current.id === data.id ? { ...current, note: data.note ?? "" } : current));
        }
        broadcast();
        return presentSession(data);
      } catch (caught) {
        if (mounted.current) setError(messageOf(caught));
        return null;
      }
    },
    [broadcast, request],
  );

  /**
   * Arrêt : la saisie de temps est créée PAR LE SERVEUR, dans la même
   * transaction que l'arrêt. `description` (facultative) l'emporte sur la note.
   * Retourne `{ savedMinutes, overflowMinutes, timeEntryId }`, ou `null`.
   */
  const stop = useCallback(
    async ({ description } = {}) => {
      if (!timer || !ownerId) return null;
      const title = timer.title;
      const trimmed = typeof description === "string" ? description.trim() : "";
      const result = await mutate("/timer/stop", { body: trimmed ? { description: trimmed } : {} });
      if (!result.ok) return null;
      const outcome = {
        savedMinutes: result.data?.savedMinutes ?? 0,
        remainingMinutes: 0,
        overflowMinutes: result.data?.overflowMinutes ?? 0,
        timeEntryId: result.data?.timeEntryId ?? null,
        title,
      };
      if (mounted.current) {
        setTimer(null);
        setBaseline(0);
        setLastResult({ kind: "saved", ...outcome, at: Date.now() });
      }
      refreshSummary();
      return outcome;
    },
    [ownerId, mutate, refreshSummary, timer],
  );

  /** Abandon : la session est close SANS saisie (geste confirmé par l'écran). */
  const discard = useCallback(async () => {
    if (!timer) return null;
    const title = timer.title;
    const result = await mutate("/timer/discard");
    if (!result.ok) return null;
    if (mounted.current) {
      setTimer(null);
      setBaseline(0);
      setLastResult({ kind: "discarded", title, discardedSeconds: result.data?.discardedSeconds ?? 0, at: Date.now() });
    }
    return result.data;
  }, [mutate, timer]);

  /** Enregistre la session en cours puis démarre sur `task`. */
  const switchTo = useCallback(
    async (task) => {
      if (timer) {
        const saved = await stop();
        if (saved === null) return null;
      }
      return start(task);
    },
    [start, stop, timer],
  );

  /**
   * Point d'entrée des boutons « Chronométrer » : démarre tout de suite si rien
   * ne tourne ; sinon, demande confirmation avant de basculer.
   */
  const requestStart = useCallback(
    (task) => {
      if (!task?.id) return;
      if (!timer) {
        start(task);
        return;
      }
      if (timer.taskId === task.id) return;
      setPendingSwitch(task);
    },
    [start, timer],
  );

  const clearResult = useCallback(() => setLastResult(null), []);

  const value = useMemo(
    () => ({
      timer,
      elapsedSeconds,
      loading,
      saving,
      error,
      summary,
      lastResult,
      start,
      startFree,
      pause,
      resume,
      stop,
      discard,
      setTask,
      saveNote,
      switchTo,
      requestStart,
      refresh,
      refreshSummary,
      clearResult,
      clearError: () => setError(null),
    }),
    [
      timer,
      elapsedSeconds,
      loading,
      saving,
      error,
      summary,
      lastResult,
      start,
      startFree,
      pause,
      resume,
      stop,
      discard,
      setTask,
      saveNote,
      switchTo,
      requestStart,
      refresh,
      refreshSummary,
      clearResult,
    ],
  );

  return (
    <TimerContext.Provider value={value}>
      {children}
      {pendingSwitch && timer ? (
        <Dialog
          title="Basculer le minuteur ?"
          icon={ArrowLeftRight}
          tone="green"
          description={`Le minuteur en cours sur « ${timer.title} » (${formatElapsed(elapsedSeconds)}) sera enregistré dans votre feuille de temps, puis un nouveau démarrera sur « ${pendingSwitch.title} ».`}
          onClose={() => setPendingSwitch(null)}
          footer={
            <>
              <Button onClick={() => setPendingSwitch(null)}>Annuler</Button>
              <Button
                variant="dark"
                data-autofocus
                disabled={saving}
                onClick={async () => {
                  const target = pendingSwitch;
                  setPendingSwitch(null);
                  await switchTo(target);
                }}
              >
                Enregistrer et basculer
              </Button>
            </>
          }
        />
      ) : null}
    </TimerContext.Provider>
  );
}

export function useTimer() {
  const value = useContext(TimerContext);
  if (!value) throw new Error("useTimer doit être utilisé dans TimerProvider.");
  return value;
}

/** Variante tolérante : `null` hors d'un espace qui monte le minuteur. */
export function useOptionalTimer() {
  return useContext(TimerContext);
}
