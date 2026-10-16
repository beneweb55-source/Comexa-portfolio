"use client";

/**
 * Session de l'utilisateur connecte.
 *
 * - Le jeton d'acces vit en memoire seulement (jamais dans localStorage).
 * - Le jeton de rafraichissement est un cookie HttpOnly pose par le backend :
 *   au chargement, on tente un rafraichissement silencieux.
 * - Les rafraichissements sont dedupliques : deux requetes 401 simultanees ne
 *   doivent pas presenter deux fois le meme refresh token (le backend
 *   revoquerait alors toute la session par detection de rejeu).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiFetch, downloadFile } from "@/lib/api";

import { notifyWorkspaceUpdate } from "@/lib/workspace-updates.mjs";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: "loading", user: null });
  const tokenRef = useRef(null);
  const refreshing = useRef(null);

  const applySession = useCallback((data) => {
    tokenRef.current = data.accessToken;
    setState({ status: "authenticated", user: data.user });
    return data.user;
  }, []);

  const clearSession = useCallback(() => {
    tokenRef.current = null;
    setState({ status: "anonymous", user: null });
  }, []);

  const refresh = useCallback(() => {
    if (!refreshing.current) {
      refreshing.current = apiFetch("/auth/refresh", { method: "POST" })
        .then(({ data }) => applySession(data))
        .catch(() => {
          clearSession();
          return null;
        })
        .finally(() => {
          refreshing.current = null;
        });
    }
    return refreshing.current;
  }, [applySession, clearSession]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (email, password) => {
      const { data } = await apiFetch("/auth/login", { method: "POST", body: { email, password } });
      return applySession(data);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST", token: tokenRef.current });
    } catch {
      // Session deja expiree cote serveur : on nettoie quand meme l'ecran.
    }
    clearSession();
  }, [clearSession]);

  /**
   * Appel authentifie. Sur 401, tente un rafraichissement puis rejoue une fois.
   * Une erreur metier (403, 404, 422...) remonte telle quelle, sans toucher la session.
   */
  const request = useCallback(
    async (path, options = {}) => {
      const execute = async () => {
        const result = await apiFetch(path, { ...options, token: tokenRef.current });
        notifyWorkspaceUpdate(path, options);
        return result;
      };
      try {
        return await execute();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const user = await refresh();
          if (user) return execute();
        }
        throw error;
      }
    },
    [refresh],
  );

  /** Telechargement protege : meme regle de rafraichissement que `request`. */
  const download = useCallback(
    async (path, filename, options = {}) => {
      try {
        return await downloadFile(path, { token: tokenRef.current, filename, space: options.space });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const user = await refresh();
          if (user) return downloadFile(path, { token: tokenRef.current, filename, space: options.space });
        }
        throw error;
      }
    },
    [refresh],
  );

  const value = useMemo(
    () => ({
      status: state.status,
      user: state.user,
      /** Compte complet, droits du rôle, même à l'intérieur d'un espace. */
      baseUser: state.user,
      /** Espace de travail actif (`null` hors espaces). */
      space: null,
      login,
      logout,
      request,
      download,
    }),
    [state, login, logout, request, download],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Session VUE DEPUIS UN ESPACE DE TRAVAIL.
 *
 * Posé par le layout de chaque espace, ce fournisseur republie la session avec :
 *  - `user.permissions` réduit aux droits effectifs de l'espace : tous les
 *    `can(user, …)` existants (menus, boutons, pages) deviennent ainsi
 *    cohérents avec l'espace, sans modifier chaque page ;
 *  - `request`/`download` qui annoncent l'espace au serveur (`X-Comexa-Space`),
 *    lequel applique la MÊME restriction : l'interface n'est jamais la seule
 *    barrière.
 * `baseUser` garde le compte complet (sélecteur d'espace, menu de compte).
 */
export function SpaceScopedAuth({ space, permissions, children }) {
  const parent = useAuth();
  const { request: parentRequest, download: parentDownload } = parent;

  const request = useCallback(
    (path, options = {}) => parentRequest(path, { space, ...options }),
    [parentRequest, space],
  );
  const download = useCallback(
    (path, filename, options = {}) => parentDownload(path, filename, { space, ...options }),
    [parentDownload, space],
  );

  const value = useMemo(() => {
    const user = parent.user && permissions ? { ...parent.user, permissions: [...permissions] } : parent.user;
    return { ...parent, user, baseUser: parent.user, space, request, download };
  }, [parent, permissions, space, request, download]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth doit etre utilise dans <AuthProvider>.");
  return context;
}
