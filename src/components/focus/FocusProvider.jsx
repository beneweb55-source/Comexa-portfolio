"use client";

/*
 * MODE CONCENTRATION — le contexte.
 *
 * Une session de concentration, c'est une INTENTION (« 50 minutes sur cette
 * tâche ») posée par-dessus le minuteur existant. Ce contexte ne duplique donc
 * aucune horloge : il demande au minuteur de démarrer, de pauser, de
 * s'arrêter, et il lit `elapsedSeconds` pour savoir où en est le décompte.
 * Le temps enregistré à la fin est donc EXACTEMENT celui de la feuille de
 * temps — pas une deuxième chiffre qui s'en écarte.
 *
 * L'état qui survit à un rechargement (intention + historique + « ne pas
 * déranger ») est dans `lib/focus-store.mjs`, testé sans navigateur.
 *
 * POURQUOI UN FOURNISSEUR DÉDIÉ PLUTÔT QU'UN ÉTAT DANS LA COQUE. Le mode
 * concentration s'ouvre depuis le dock, depuis « Ma journée » et depuis le
 * clavier : trois entrées qui doivent partager la même session. Un contexte
 * évite de faire remonter l'état jusqu'à la coque pour le redescendre.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  FOCUS_PRESETS,
  clampMinutes,
  focusStats,
  formatPlanned,
  readFocusState,
  writeFocusState,
} from "@/lib/focus-store.mjs";
import { useTimer } from "@/lib/timer";

const FocusContext = createContext(null);

/** Stockage courant, tolérant : hors navigateur, tout est ignoré. */
function storage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function FocusProvider({ children }) {
  const timer = useTimer();
  const [state, setState] = useState(() => readFocusState(storage()));
  const [open, setOpen] = useState(false);
  // La session vient d'être terminée : on affiche le bilan avant de ranger.
  const [justFinished, setJustFinished] = useState(null);
  // Le drapeau de restauration : posé UNE fois la session rouverte.
  const restoredRef = useRef(false);

  const persist = useCallback((next) => {
    setState(next);
    writeFocusState(storage(), next);
  }, []);

  /* Le drapeau « ne pas déranger » est posé sur <html> : le CSS s'en sert pour
     taire les alertes entrantes, et n'importe quel composant peut le lire. */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (state.dnd) root.dataset.focusDnd = "on";
    else delete root.dataset.focusDnd;
  }, [state.dnd]);

  /* Une session survit au rechargement de page : si le minuteur tourne encore
     dessus, on rouvre le mode au retour. */
  useEffect(() => {
    /* L'ÉCRAN NE SE REOUVRE QUE SI LE MINUTEUR EST DEJA HYDRATE.
       Le drapeau n'est posé qu'une fois la session restaurée : avant, le
       minuteur est encore `null` (il se charge depuis le serveur) et le
       poser aurait fait perdre la reprise a jamais — c'est exactement ce qui
       se passait : au rechargement, l'effet passait une fois avec un
       minuteur vide, se Consumption, et la session en cours ne réapparaissait
       plus. */
    if (restoredRef.current) return;
    if (!state.session) return;
    if (!timer.timer || timer.timer.status === "STOPPED") return;
    restoredRef.current = true;
    // Différé dans une tâche : l'hydratation du minuteur arrive elle aussi
    // dans une tâche, et rouvrir l'écran depuis le corps de l'effet
    // déclencherait un rendu en cascade au montage.
    const id = window.setTimeout(() => setOpen(true), 0);
    return () => window.clearTimeout(id);
  }, [state.session, timer.timer]);

  /**
   * Démarre une session. `task` peut être nul : on démarre alors sans tâche,
   * exactement comme le démarrage rapide du minuteur.
   */
  const startSession = useCallback(
    async ({ task = null, plannedMinutes = FOCUS_PRESETS[1], note = "", dnd = true } = {}) => {
      const minutes = clampMinutes(plannedMinutes);
      const session = {
        taskId: task?.id ?? null,
        taskTitle: task?.title ?? "Sans tâche",
        projectName: task?.project?.name ?? null,
        plannedMinutes: minutes,
        note: typeof note === "string" ? note : "",
        startedAt: new Date().toISOString(),
      };

      // Le minuteur d'abord : si le serveur refuse (droits, session déjà en
      // cours), la session de concentration n'est pas créée et l'écran reste
      // honnête — pas de décompte qui tourne dans le vide.
      const started = task ? await timer.start(task, { note }) : await timer.startFree({ note });
      if (!started) return false;

      persist({ ...state, session, dnd, lastMinutes: minutes });
      setJustFinished(null);
      setOpen(true);
      return true;
    },
    [persist, state, timer],
  );

  /**
   * Termine la session : le minuteur enregistre la saisie, puis la session
   * part à l'historique avec le temps RÉELLEMENT passé.
   */
  const finishSession = useCallback(async () => {
    if (!state.session) return null;
    const elapsed = timer.elapsedSeconds;
    const planned = state.session.plannedMinutes;
    const outcome = await timer.stop({ description: state.session.note || undefined });
    // `stop` rend `null` si le serveur a refusé : on garde alors la session
    // ouverte plutôt que de perdre l'intention.
    if (!outcome) return null;

    const entry = {
      id: `${state.session.startedAt}-${Math.round(elapsed)}`,
      completedAt: new Date().toISOString(),
      focusedSeconds: elapsed,
      plannedMinutes: planned,
      taskTitle: state.session.taskTitle,
      // Menée à son terme = on a tenu la durée promise, à deux minutes près.
      completed: elapsed >= planned * 60 - 120,
    };
    persist({ ...state, session: null, history: [...state.history, entry].slice(-500) });
    setJustFinished(entry);
    return entry;
  }, [persist, state, timer]);

  /** Abandonne : rien n'est enregistré, la session est simplement oubliée. */
  const abandonSession = useCallback(async () => {
    if (!state.session) return false;
    const outcome = await timer.discard();
    if (!outcome) return false;
    persist({ ...state, session: null });
    setJustFinished(null);
    return true;
  }, [persist, state, timer]);

  /** Change la durée planifiée sans perdre le temps déjà écoulé. */
  const replan = useCallback(
    (minutes) => {
      if (!state.session) return;
      persist({ ...state, session: { ...state.session, plannedMinutes: clampMinutes(minutes) }, lastMinutes: clampMinutes(minutes) });
    },
    [persist, state],
  );

  const setDnd = useCallback((value) => persist({ ...state, dnd: Boolean(value) }), [persist, state]);

  /** Ouvre le mode sur la session en cours, ou sur le tableau de bord des stats. */
  const openFocus = useCallback(() => setOpen(true), []);
  const closeFocus = useCallback(() => {
    setOpen(false);
    setJustFinished(null);
  }, []);

  /* Échap ferme le mode — sauf si une boîte de dialogue est ouverte par-dessus
     (elle a déjà son propre Échap, et elle doit garder la priorité). */
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      if (document.querySelector(".sui-dialog-backdrop")) return;
      closeFocus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closeFocus]);

  const session = state.session;
  const dnd = state.dnd;
  const running = Boolean(timer.timer);
  const elapsed = timer.elapsedSeconds;
  const remaining = session ? Math.max(0, session.plannedMinutes * 60 - elapsed) : 0;
  const over = session ? elapsed >= session.plannedMinutes * 60 : false;

  const value = useMemo(
    () => ({
      session,
      running,
      elapsed,
      remaining,
      over,
      plannedMinutes: session?.plannedMinutes ?? state.lastMinutes ?? FOCUS_PRESETS[1],
      dnd,
      stats: focusStats(state.history),
      history: state.history,
      justFinished,
      open,
      openFocus,
      closeFocus,
      startSession,
      finishSession,
      abandonSession,
      replan,
      setDnd,
      saving: timer.saving,
      error: timer.error,
      clearError: timer.clearError,
      pause: timer.pause,
      resume: timer.resume,
      saveNote: timer.saveNote,
      note: session?.note ?? "",
      timerStatus: timer.timer?.status ?? null,
      task: timer.timer?.task ?? null,
    }),
    [
      session,
      running,
      elapsed,
      remaining,
      over,
      state.lastMinutes,
      dnd,
      state.history,
      justFinished,
      open,
      openFocus,
      closeFocus,
      startSession,
      finishSession,
      abandonSession,
      replan,
      setDnd,
      timer.saving,
      timer.error,
      timer.clearError,
      timer.pause,
      timer.resume,
      timer.saveNote,
      timer.timer,
    ],
  );

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export function useFocus() {
  const value = useContext(FocusContext);
  if (!value) throw new Error("useFocus doit être utilisé dans FocusProvider.");
  return value;
}

/** Variante tolérante : hors d'un espace qui monte le mode concentration. */
export function useOptionalFocus() {
  return useContext(FocusContext);
}

export { formatPlanned };
