"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/session";
import { messageOf } from "@/lib/api";

/**
 * Chargement d'une liste paginee de l'API.
 *
 * En cas d'erreur, la liste deja affichee est CONSERVEE et le message est expose
 * a part : un rechargement rate ne vide jamais l'ecran.
 * `path` peut changer (filtres) : la liste est alors rechargee. `null` = ne pas charger.
 */
export function useListing(path) {
  const { request } = useAuth();
  const activeRequest = useRef(null);
  const [state, setState] = useState({ items: null, meta: null, error: null, errorStatus: null, loading: path !== null });

  const reload = useCallback(async () => {
    activeRequest.current?.abort();
    activeRequest.current = null;

    // Chemin null : ressource non accessible à ce porteur, aucune requête (évite un 403 inutile).
    if (path === null) {
      setState({ items: [], meta: null, error: null, errorStatus: null, loading: false });
      return;
    }

    const controller = new AbortController();
    activeRequest.current = controller;
    setState((current) => ({ ...current, loading: true, error: null, errorStatus: null }));
    try {
      const { data, meta } = await request(path, { signal: controller.signal });
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      setState({ items: data, meta: meta ?? null, error: null, errorStatus: null, loading: false });
    } catch (caught) {
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      setState((current) => ({
        ...current,
        error: messageOf(caught),
        errorStatus: caught?.status ?? null,
        loading: false,
      }));
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, [path, request]);

  useEffect(() => {
    reload();
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [reload]);

  return { ...state, reload };
}

/**
 * Action d'ecriture : pendant l'envoi, l'element est marque occupe ; en cas
 * d'echec le message est retourne, la liste n'est pas modifiee.
 */
export function useAction(onDone) {
  const { request } = useAuth();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  async function run(key, path, options, successMessage) {
    setBusy(key);
    setError(null);
    setSuccess(null);
    try {
      const result = await request(path, options);
      setSuccess(successMessage ?? "Enregistré.");
      if (onDone) await onDone();
      return result;
    } catch (caught) {
      setError(messageOf(caught));
      return null;
    } finally {
      setBusy(null);
    }
  }

  return { run, busy, error, success, setError, setSuccess };
}
