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
      try {
        return await apiFetch(path, { ...options, token: tokenRef.current });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const user = await refresh();
          if (user) return apiFetch(path, { ...options, token: tokenRef.current });
        }
        throw error;
      }
    },
    [refresh],
  );

  /** Telechargement protege : meme regle de rafraichissement que `request`. */
  const download = useCallback(
    async (path, filename) => {
      try {
        return await downloadFile(path, { token: tokenRef.current, filename });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const user = await refresh();
          if (user) return downloadFile(path, { token: tokenRef.current, filename });
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
      login,
      logout,
      request,
      download,
    }),
    [state, login, logout, request, download],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth doit etre utilise dans <AuthProvider>.");
  return context;
}
