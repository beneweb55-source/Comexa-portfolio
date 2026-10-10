import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * Page d'où l'utilisateur vient (sessionStorage). Lu via useSyncExternalStore : pas d'effet,
 * et `null` au rendu serveur pour éviter un décalage d'hydratation.
 */
export function usePreviousPage(pathname, pageLabels, fallback) {
  const previousPath = useSyncExternalStore(
    noopSubscribe,
    () => window.sessionStorage.getItem("comexa-previous-path"),
    () => null,
  );
  if (previousPath && previousPath !== pathname) {
    return { path: previousPath, label: pageLabels[previousPath] ?? "Page précédente" };
  }
  return fallback;
}
