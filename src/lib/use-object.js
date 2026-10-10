"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/session";
import { messageOf } from "@/lib/api";

/**
 * Chargement d'une réponse « objet » (tableau de bord, détail de rapport).
 * Même contrat que `useListing` : erreur exposée, donnée précédente conservée lors d'un rechargement.
 */
export function useObject(path, enabled = true) {
  const { request } = useAuth();
  const [state, setState] = useState({ data: null, error: null, errorStatus: null, loading: enabled });

  const reload = useCallback(async () => {
    if (!enabled || !path) return;
    setState((current) => ({ ...current, loading: true }));
    try {
      const { data } = await request(path);
      setState({ data: data ?? null, error: null, errorStatus: null, loading: false });
    } catch (caught) {
      setState((current) => ({ ...current, error: messageOf(caught), errorStatus: caught?.status ?? null, loading: false }));
    }
  }, [enabled, path, request]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...state, reload };
}
