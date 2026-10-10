"use client";

import { useEffect, useState } from "react";
import { apiFetch, messageOf } from "@/lib/api";

/**
 * Contenu public (sans session) : `GET /api/public/...`.
 * Renvoie `items` (null tant que la requête court, ou en cas d'erreur) et `error`.
 * Une erreur n'empêche jamais le rendu : la page garde son contenu de repli.
 */
export function usePublicList(path) {
  const [state, setState] = useState({ items: null, error: null });

  useEffect(() => {
    let cancelled = false;
    apiFetch(path)
      .then((body) => {
        if (!cancelled) setState({ items: Array.isArray(body?.data) ? body.data : [], error: null });
      })
      .catch((caught) => {
        if (!cancelled) setState({ items: null, error: messageOf(caught) });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return state;
}

/** Initiales d'un nom : « Claire Vasseur » -> « CV ». */
export function initialsOf(name) {
  return String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}
