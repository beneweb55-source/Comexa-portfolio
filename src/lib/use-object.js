"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/session";
import { messageOf } from "@/lib/api";

/**
 * Chargement d'une réponse « objet » (tableau de bord, détail de rapport).
 * Même contrat que `useListing` : erreur exposée, donnée précédente conservée lors d'un rechargement.
 */
export function useObject(path, enabled = true) {
  const { request } = useAuth();
  const activeRequest = useRef(null);
  const [state, setState] = useState({ data: null, error: null, errorStatus: null, loading: enabled });

  const reload = useCallback(async () => {
    activeRequest.current?.abort();
    activeRequest.current = null;

    if (!enabled || !path) {
      setState((current) => ({ ...current, loading: false }));
      return;
    }

    const controller = new AbortController();
    activeRequest.current = controller;
    setState((current) => ({ ...current, loading: true, error: null, errorStatus: null }));
    try {
      const { data } = await request(path, { signal: controller.signal });
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      setState({ data: data ?? null, error: null, errorStatus: null, loading: false });
    } catch (caught) {
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      setState((current) => ({ ...current, error: messageOf(caught), errorStatus: caught?.status ?? null, loading: false }));
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, [enabled, path, request]);

  useEffect(() => {
    reload();
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [reload]);

  return { ...state, reload };
}
