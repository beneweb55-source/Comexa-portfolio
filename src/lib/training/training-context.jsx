"use client";

/**
 * MODE FORMATION — état de session et accès à l'API de formation.
 *
 * Ce contexte pilote :
 *  - l'entrée/sortie du mode formation (`enter`/`exit`) : à l'entrée, le jeton
 *    de FORMATION remplace le jeton réel pour toutes les requêtes métier (voir
 *    `lib/api.js`) — mêmes pages, mêmes formulaires, base d'entraînement ;
 *  - la bannière permanente « MODE FORMATION — DONNÉES FICTIVES » (le serveur
 *    fournit le libellé) ;
 *  - le catalogue de missions filtré par les permissions réelles ;
 *  - la progression (démarrage, vérification, validation finale).
 *
 * La VALIDATION d'une mission est toujours serveur : `completeMission` ne
 * rapporte qu'un verdict calculé sur l'état des données d'exercice. Un clic
 * local ne réussit jamais une mission.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, setTrainingToken } from "@/lib/api";
import { useAuth } from "@/lib/session";

const TrainingContext = createContext(null);

export function TrainingProvider({ children }) {
  const { user, token, request } = useAuth();
  const [state, setState] = useState({
    status: "idle", // idle | ready | active
    configured: false,
    banner: "MODE FORMATION — DONNÉES FICTIVES",
    sessionId: null,
    expiresAt: null,
  });
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState(null);
  const authedRef = useRef({ user, token });
  useEffect(() => {
    authedRef.current = { user, token };
  }, [user, token]);

  // État initial : la formation est-elle configurée sur ce serveur ?
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    apiFetch("/training/status", { token: authedRef.current.token })
      .then(({ data }) => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          status: "ready",
          configured: Boolean(data?.configured),
          banner: data?.banner ?? s.banner,
        }));
      })
      .catch(() => {
        // Un serveur sans module de formation (ancien contrat) : l'entrée sera
        // refusée avec un message clair au moment du clic.
        if (!cancelled) setState((s) => ({ ...s, status: "ready", configured: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const enter = useCallback(
    async (missionId) => {
      const { data } = await request("/training/enter", {
        method: "POST",
        body: missionId ? { missionId } : {},
      });
      setTrainingToken(data.token);
      setState((s) => ({
        ...s,
        status: "active",
        configured: true,
        banner: data.banner ?? s.banner,
        sessionId: data.sessionId,
        expiresAt: data.expiresAt,
      }));
      return data;
    },
    [request],
  );

  const exit = useCallback(async () => {
    try {
      await request("/training/exit", { method: "POST", body: {} });
    } finally {
      setTrainingToken(null);
      setState((s) => ({ ...s, status: "ready", sessionId: null, expiresAt: null }));
    }
  }, [request]);

  const reset = useCallback(async () => {
    const { data } = await request("/training/reset", {
      method: "POST",
      body: { confirm: true },
    });
    setCatalog(null);
    return data;
  }, [request]);

  const refreshCatalog = useCallback(
    async (space) => {
      const path = space ? `/training/catalog?space=${encodeURIComponent(space)}` : "/training/catalog";
      const { data } = await request(path);
      setCatalog(Array.isArray(data) ? data : []);
      setCatalogError(null);
      return data;
    },
    [request],
  );

  const startMission = useCallback(
    async (missionId, assistanceLevel = "full") => {
      const { data } = await request(`/training/missions/${encodeURIComponent(missionId)}/start`, {
        method: "POST",
        body: { assistanceLevel },
      });
      return data;
    },
    [request],
  );

  const checkMission = useCallback(
    async (missionId, { evaluation = false } = {}) => {
      const suffix = evaluation ? "?evaluation=true" : "";
      const { data } = await request(
        `/training/missions/${encodeURIComponent(missionId)}/check${suffix}`,
      );
      return data;
    },
    [request],
  );

  const completeMission = useCallback(
    async (missionId, assistanceLevel = "full") => {
      const { data } = await request(
        `/training/missions/${encodeURIComponent(missionId)}/complete`,
        { method: "POST", body: { assistanceLevel } },
      );
      return data;
    },
    [request],
  );

  const loadReport = useCallback(async () => {
    const { data } = await request("/training/report");
    return data;
  }, [request]);

  // Sans session, on n'est jamais « en formation » : valeur dérivée, pas d'état
  // dupliqué (règle React : pas de setState synchrone dans un effet).
  const effectiveState = useMemo(
    () => (user ? state : { ...state, status: "idle" }),
    [user, state],
  );

  const value = useMemo(
    () => ({
      ...effectiveState,
      active: effectiveState.status === "active",
      catalog,
      catalogError,
      enter,
      exit,
      reset,
      refreshCatalog,
      startMission,
      checkMission,
      completeMission,
      loadReport,
    }),
    [effectiveState, catalog, catalogError, enter, exit, reset, refreshCatalog, startMission, checkMission, completeMission, loadReport],
  );

  return <TrainingContext.Provider value={value}>{children}</TrainingContext.Provider>;
}

export function useTraining() {
  const context = useContext(TrainingContext);
  if (!context) throw new Error("useTraining doit être utilisé dans <TrainingProvider>.");
  return context;
}
