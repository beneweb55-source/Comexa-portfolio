"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/session";
import { normalizeTimePreferences } from "@/lib/time-workspace.mjs";

const EVENT = "comexa:time-preferences";
const serverSnapshot = () => null;
function subscribe(callback) {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}
export function useTimePreferences() {
  const { user } = useAuth();
  const key = user?.id ? `comexa.time-preferences:${user.id}` : null;
  const snapshot = useCallback(() => {
    try {
      return key ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const preferences = normalizeTimePreferences(parsed);
  function save(value) {
    if (!key)
      throw new Error("Connectez-vous pour enregistrer vos préférences.");
    localStorage.setItem(key, JSON.stringify(normalizeTimePreferences(value)));
    window.dispatchEvent(new Event(EVENT));
  }
  return { preferences, save };
}
