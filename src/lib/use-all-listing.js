"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { fetchAllPages } from "@/lib/pagination.mjs";

/** Chargement exhaustif d'une ressource paginée, réservé aux agrégats complets. */
export function useAllListing(path, enabled = true, { perPage = 100, maxPages = 500 } = {}) {
  const { request } = useAuth();
  const activeRequest = useRef(null);
  const [state, setState] = useState({ items: null, meta: null, error: null, errorStatus: null, loading: Boolean(enabled && path) });

  const reload = useCallback(async () => {
    activeRequest.current?.abort();
    activeRequest.current = null;

    if (!enabled || !path) {
      setState({ items: [], meta: null, error: null, errorStatus: null, loading: false });
      return;
    }

    const controller = new AbortController();
    activeRequest.current = controller;
    setState((current) => ({ ...current, loading: true, error: null, errorStatus: null }));
    try {
      const result = await fetchAllPages(request, path, { perPage, maxPages, signal: controller.signal });
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      setState({ items: result.items, meta: result.meta, error: null, errorStatus: null, loading: false });
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
  }, [enabled, maxPages, path, perPage, request]);

  useEffect(() => {
    reload();
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [reload]);

  return { ...state, reload };
}
