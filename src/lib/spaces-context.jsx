"use client";

/**
 * Espaces accessibles au compte connecté, tels que l'API les calcule.
 *
 * Monté une seule fois sous `AuthProvider` : changer d'espace (donc de layout)
 * ne relance pas la requête. `GET /me/spaces` donne la liste des espaces ET les
 * droits effectifs de chacun — ceux que le serveur appliquera réellement. Tant
 * que la réponse n'est pas arrivée (ou si l'API ne connaît pas encore cette
 * route), le miroir local de la politique (`lib/spaces.js`) sert de repli pour
 * éviter un menu vide.
 *
 * `unreadBySpace` alimente les pastilles du sélecteur : chaque compteur reste
 * propre à son espace, rien n'est additionné entre espaces.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/session";
import { SPACE_IDS, accessibleSpaces, effectivePermissions } from "@/lib/spaces";

const SpacesContext = createContext({
  ready: false,
  spaces: [],
  permissionsFor: () => null,
  unreadBySpace: {},
  refreshUnread: () => {},
});

const SUMMARY_INTERVAL_MS = 60_000;

export function SpacesProvider({ children }) {
  const { status, user, request } = useAuth();
  const userId = user?.id ?? null;
  // Une modification de permissions doit invalider les droits d'espace en cache.
  const accessKey = JSON.stringify([user?.roles ?? [], [...(user?.permissions ?? [])].sort()]);
  const [server, setServer] = useState({ userId: null, spaces: null, failed: false });
  const [unread, setUnread] = useState({ userId: null, bySpace: {} });

  const isMember = status === "authenticated" && (user?.roles ?? []).some((role) => (typeof role === "string" ? role : role?.code) !== "CLIENT");

  useEffect(() => {
    if (!isMember || !userId) return undefined;
    const controller = new AbortController();
    request("/me/spaces", { signal: controller.signal, space: null })
      .then(({ data }) => {
        if (!controller.signal.aborted) setServer({ userId, spaces: Array.isArray(data?.spaces) ? data.spaces : null, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setServer({ userId, spaces: null, failed: true });
      });
    return () => controller.abort();
  }, [accessKey, isMember, request, userId]);

  const refreshUnread = useCallback(() => {
    if (!isMember || !userId) return;
    request("/notifications/summary", { space: null })
      .then(({ data }) => setUnread({ userId, bySpace: data?.unreadBySpace ?? {} }))
      .catch(() => {
        // Compteurs indisponibles : les pastilles restent simplement absentes.
      });
  }, [isMember, request, userId]);

  useEffect(() => {
    if (!isMember || !userId) return undefined;
    refreshUnread();
    const interval = window.setInterval(refreshUnread, SUMMARY_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isMember, refreshUnread, userId]);

  const value = useMemo(() => {
    if (!isMember || !user) {
      return { ready: status !== "loading", spaces: [], permissionsFor: () => null, unreadBySpace: {}, refreshUnread };
    }
    const fromServer = server.userId === user.id ? server.spaces : null;
    const spaces = fromServer
      ? fromServer.filter((space) => SPACE_IDS.includes(space.id))
      : accessibleSpaces(user).map((id) => ({ id, permissions: [...effectivePermissions(id, user.permissions ?? [])] }));
    const byId = new Map(spaces.map((space) => [space.id, new Set(space.permissions ?? [])]));
    return {
      ready: Boolean(fromServer) || server.failed || server.userId === user.id,
      spaces,
      permissionsFor: (id) => byId.get(id) ?? null,
      unreadBySpace: unread.userId === user.id ? unread.bySpace : {},
      refreshUnread,
    };
  }, [isMember, refreshUnread, server, status, unread, user]);

  return <SpacesContext.Provider value={value}>{children}</SpacesContext.Provider>;
}

export function useSpaces() {
  return useContext(SpacesContext);
}
