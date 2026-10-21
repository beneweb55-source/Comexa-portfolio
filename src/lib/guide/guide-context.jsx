"use client";

/**
 * GUIDE DE DÉMARRAGE — état partagé.
 *
 * Remplace l'ancien mode « formation » : plus de session, plus de jeton dédié,
 * plus de base d'exercice. Le serveur expose `GET /guide` (étapes visibles pour
 * vos droits + état réel) et `POST /guide/steps/:id/complete`.
 *
 * Ce contexte ne fait que trois choses :
 *  - charger l'état du guide pour l'espace courant ;
 *  - le rafraîchir quand on change d'écran ou quand l'onglet revient au premier
 *    plan (une action faite ailleurs se voit donc tout de suite) ;
 *  - exposer `complete(stepId, optionId)` pour valider une étape.
 *
 * Un échec de chargement n'est JAMAIS bloquant : le guide est une aide, pas un
 * portail. Toutes les erreurs restent silencieuses à l'écran, sauf la réponse
 * d'une validation demandée explicitement par le membre.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/session";
import { nextStep as pickNextStep } from "@/lib/guide/guide-format.mjs";

const GuideContext = createContext(null);

const REFRESH_MS = 60_000;
const HIDDEN_KEY = "comexa.guide.hidden";

/*
 * « Plus tard » est un état LOCAL (le membre cache la pastille sur cet
 * appareil), lu via `useSyncExternalStore` : la valeur du serveur rendu est
 * `false`, puis React relit le stockage après l'hydratation. Pas de
 * `setState` dans un effet, donc pas de rendu en cascade — et pas de
 * mismatch d'hydratation.
 */
const hiddenListeners = new Set();

function subscribeHidden(listener) {
  hiddenListeners.add(listener);
  return () => hiddenListeners.delete(listener);
}

function readHidden() {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHidden(hidden) {
  try {
    if (hidden) window.localStorage.setItem(HIDDEN_KEY, "1");
    else window.localStorage.removeItem(HIDDEN_KEY);
  } catch {
    /* stockage indisponible : l'état vaut pour la session en cours */
  }
  for (const listener of hiddenListeners) listener();
}

export function GuideProvider({ children }) {
  const { user, request } = useAuth();
  const pathname = usePathname();
  const [overview, setOverview] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [open, setOpen] = useState(false);
  const dismissed = useSyncExternalStore(subscribeHidden, readHidden, () => false);
  const [busyStepId, setBusyStepId] = useState(null);
  const [notice, setNotice] = useState(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!user) {
        setOverview(null);
        setStatus("idle");
        return null;
      }
      if (!quiet) setStatus("loading");
      try {
        const { data } = await request("/guide", { space: null });
        if (!aliveRef.current) return null;
        setOverview(data ?? null);
        setStatus("ready");
        return data ?? null;
      } catch {
        if (!aliveRef.current) return null;
        // Silencieux : un guide indisponible ne doit pas afficher d'erreur sur
        // un écran de travail. On garde le dernier état connu.
        setStatus((current) => (current === "ready" ? current : "error"));
        return null;
      }
    },
    [request, user],
  );

  // Chargement initial, puis à chaque changement d'écran : revenir sur « Mes
  // tâches » après avoir créé une tâche doit cocher l'étape sans rechargement.
  //
  // Le chargement part APRÈS le rendu (microtâche) : `load` écrit l'état, et un
  // `setState` synchrone dans un effet provoquerait un second rendu immédiat —
  // exactement ce que le compilateur React interdit ici.
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => {
      if (alive) void load();
    });
    return () => {
      alive = false;
    };
  }, [load, pathname]);

  // Retour au premier plan + sondage lent : le guide n'est pas un tableau de
  // bord, il n'a pas besoin de temps réel.
  useEffect(() => {
    if (!user) return undefined;
    const onFocus = () => void load({ quiet: true });
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load({ quiet: true });
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => void load({ quiet: true }), REFRESH_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [load, user]);

  const hide = useCallback(() => {
    writeHidden(true);
    setOpen(false);
  }, []);

  const show = useCallback(() => {
    writeHidden(false);
    setOpen(true);
  }, []);

  const complete = useCallback(
    async (stepId, optionId) => {
      setBusyStepId(stepId);
      setNotice(null);
      try {
        const { data } = await request(`/guide/steps/${encodeURIComponent(stepId)}/complete`, {
          method: "POST",
          body: optionId ? { optionId } : {},
          space: null,
        });
        if (data?.overview) setOverview(data.overview);
        if (data?.ok === false && data.correction) {
          setNotice({ stepId, tone: "warning", text: data.correction.explanation });
        } else if (data?.explanation) {
          setNotice({ stepId, tone: "success", text: data.explanation });
        }
        return data;
      } catch (error) {
        setNotice({ stepId, tone: "error", text: error?.message ?? "La validation a échoué." });
        // Une erreur 409 signifie « pas encore détecté » : on rafraîchit pour
        // montrer l'état réel plutôt que de laisser un bouton bloqué.
        void load({ quiet: true });
        return null;
      } finally {
        setBusyStepId(null);
      }
    },
    [load, request],
  );

  const steps = useMemo(() => overview?.spaces.flatMap((space) => space.steps) ?? [], [overview]);
  const current = useMemo(
    () => steps.find((step) => step.id === overview?.nextStepId) ?? pickNextStep(steps),
    [overview, steps],
  );

  const value = useMemo(
    () => ({
      overview,
      steps,
      current,
      status,
      open,
      dismissed,
      busyStepId,
      notice,
      total: overview?.total ?? steps.length,
      done: overview?.done ?? steps.filter((step) => step.done).length,
      refresh: load,
      complete,
      openGuide: () => setOpen(true),
      closeGuide: () => setOpen(false),
      hide,
      show,
      clearNotice: () => setNotice(null),
    }),
    [overview, steps, current, status, open, dismissed, busyStepId, notice, load, complete, hide, show],
  );

  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>;
}

export function useGuide() {
  const context = useContext(GuideContext);
  if (!context) {
    throw new Error("useGuide doit être utilisé dans un <GuideProvider>.");
  }
  return context;
}
