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
import { ApiError, apiFetch, downloadFile, fetchProtectedBlob } from "@/lib/api";

import { notifyWorkspaceUpdate } from "@/lib/workspace-updates.mjs";
import { synchronizeOfflineWork } from "@/lib/offline-sync";

const AuthContext = createContext(null);
const GATEWAY_STATUSES_FOR_OFFLINE = new Set([502, 503, 504]);

export function AuthProvider({ children }) {
  // Le jeton vit dans l'etat (il doit etre PUBLIQUE : la messagerie temps
  // reel le presente dans la poignee de main du WebSocket) ET dans une ref
  // (les appels HTTP le lisent sans provoquer de rendu).
  const [state, setState] = useState({ status: "loading", user: null, token: null, offlineReady: false, offlineSetupWarning: null, syncStatus: null, conflicts: [] });
  const tokenRef = useRef(null);
  const offlineRef = useRef(false);
  const offlineUserIdRef = useRef(null);
  const userRef = useRef(null);
  const refreshing = useRef(null);
  // Un rafraîchissement qui échoue (passerelle 502, backend endormi, cookie
  // absent) ne doit pas être retenté par CHAQUE requête : sans ce délai de
  // grâce, une page qui sonde (notifications, minuteur, tâches) produisait une
  // rafale de POST /auth/refresh dans la console.
  const refreshBlockedUntil = useRef(0);

  const applySession = useCallback((data, { offline = false, offlineReady = offline } = {}) => {
    tokenRef.current = data.accessToken ?? null;
    offlineRef.current = offline;
    offlineUserIdRef.current = data.user?.id ?? null;
    userRef.current = data.user ?? null;
    setState({
      status: "authenticated",
      user: data.user,
      token: data.accessToken ?? null,
      offline,
      offlineReady,
      offlineSetupWarning: null,
      lastCachedAt: null,
      syncStatus: null,
      syncError: null,
      syncing: false,
      conflicts: [],
      pendingOperations: [],
    });
    return data.user;
  }, []);

  const clearSession = useCallback(() => {
    tokenRef.current = null;
    offlineRef.current = false;
    offlineUserIdRef.current = null;
    userRef.current = null;
    setState({ status: "anonymous", user: null, token: null, offline: false, offlineReady: false, offlineSetupWarning: null, lastCachedAt: null, syncStatus: null, syncError: null, syncing: false, conflicts: [], pendingOperations: [] });
  }, []);

  const refresh = useCallback(() => {
    if (!refreshing.current && Date.now() < refreshBlockedUntil.current) {
      return Promise.resolve(null);
    }
    if (!refreshing.current) {
      const desktopTimeoutMs = typeof window !== "undefined" && window.comexaDesktop?.offline ? 8_000 : undefined;
      refreshing.current = apiFetch("/auth/refresh", { method: "POST", timeoutMs: desktopTimeoutMs })
        .then(async ({ data }) => {
          refreshBlockedUntil.current = 0;
          let offlineReady = false;
          try {
            offlineReady = Boolean(
              await window.comexaDesktop?.offline?.activateOnline?.({ user: data.user, accessToken: data.accessToken }),
            );
          } catch {
            // Une session en ligne reste valide même si le stockage local est indisponible.
          }
          return applySession(data, { offlineReady });
        })
        .catch((error) => {
          // Nouvelle tentative possible après 10 s, pas à chaque requête. Un
          // refus d'authentification serveur (401/403) invalide aussi la session
          // hors ligne ; seuls les problèmes de transport/serveur la préservent.
          refreshBlockedUntil.current = Date.now() + 10_000;
          const transientFailure = error?.status === 0 || error?.status >= 500;
          if (offlineRef.current && transientFailure) return userRef.current;
          clearSession();
          window.comexaDesktop?.offline?.logout?.().catch?.(() => {});
          return null;
        })
        .finally(() => {
          refreshing.current = null;
        });
    }
    return refreshing.current;
  }, [applySession, clearSession]);

  const syncingRef = useRef(false);

  const refreshOfflineStatus = useCallback(async () => {
    const bridge = window.comexaDesktop?.offline;
    const userId = offlineUserIdRef.current;
    if (!bridge || !userId) return null;
    try {
      const [syncStatus, conflicts, pendingOperations] = await Promise.all([
        bridge.status({ userId }),
        bridge.listConflicts({ userId }),
        bridge.listPending({ userId, includeFailed: true }),
      ]);
      setState((current) => current.user?.id === userId ? { ...current, syncStatus, conflicts, pendingOperations } : current);
      return { syncStatus, conflicts, pendingOperations };
    } catch {
      return null;
    }
  }, []);

  const syncNow = useCallback(async ({ refreshViews = true } = {}) => {
    const bridge = window.comexaDesktop?.offline;
    const userId = offlineUserIdRef.current;
    if (!bridge || !userId) throw new Error("Le moteur de synchronisation desktop n'est pas disponible.");
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("Aucune connexion Internet détectée.");
    if (syncingRef.current) return null;
    syncingRef.current = true;
    setState((current) => ({ ...current, syncing: true, syncError: null }));
    try {
      if (!tokenRef.current) await refresh();
      const token = tokenRef.current;
      if (!token) throw new Error("Reconnectez-vous au serveur pour synchroniser.");
      const result = await synchronizeOfflineWork({ userId, token, bridge, refreshViews });
      offlineRef.current = false;
      const [conflicts, pendingOperations] = await Promise.all([
        bridge.listConflicts({ userId }),
        bridge.listPending({ userId, includeFailed: true }),
      ]);
      setState((current) => ({ ...current, offline: false, syncing: false, syncError: result.failed ? "Certaines opérations attendent une nouvelle tentative ou une correction." : null, syncStatus: result.status, conflicts, pendingOperations }));
      notifyWorkspaceUpdate("/offline/sync", { method: "POST" });
      return result;
    } catch (error) {
      setState((current) => ({ ...current, syncing: false, syncError: error?.message || "La synchronisation a échoué." }));
      throw error;
    } finally {
      syncingRef.current = false;
    }
  }, [refresh]);

  useEffect(() => {
    // Au démarrage desktop, ne pas attendre l'expiration du délai HTTP pour
    // afficher la connexion locale quand Chromium sait déjà qu'il n'y a pas de réseau.
    if (window.comexaDesktop?.offline && typeof navigator !== "undefined" && navigator.onLine === false) {
      clearSession();
      return;
    }
    refresh().then(() => {
      if (window.comexaDesktop?.offline && navigator.onLine) {
        refreshOfflineStatus();
      }
    });
  }, [clearSession, refresh, refreshOfflineStatus]);

  useEffect(() => {
    const updateConnection = async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (offlineRef.current) {
        const user = await refresh();
        if (user && tokenRef.current) syncNow().catch(() => {});
        return;
      }
      if (offlineUserIdRef.current && window.comexaDesktop?.offline) {
        const status = await window.comexaDesktop.offline.status({ userId: offlineUserIdRef.current }).catch(() => null);
        if ((status?.pending || status?.failed) && !syncingRef.current) syncNow({ refreshViews: false }).catch(() => {});
      }
    };
    const showOffline = (event) => {
      if (!offlineUserIdRef.current) return;
      offlineRef.current = true;
      const cachedAt = Number(event?.detail?.cachedAt) || null;
      setState((current) => current.status === "authenticated"
        ? {
            ...current,
            offline: true,
            lastCachedAt: cachedAt ? Math.max(current.lastCachedAt ?? 0, cachedAt) : current.lastCachedAt,
          }
        : current);
      refreshOfflineStatus();
    };
    window.addEventListener("online", updateConnection);
    window.addEventListener("comexa:offline-cache-used", showOffline);
    const timer = window.setInterval(updateConnection, 20_000);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("comexa:offline-cache-used", showOffline);
      window.clearInterval(timer);
    };
  }, [refresh, syncNow, refreshOfflineStatus]);

  const loginOffline = useCallback(async (email, password) => {
    const offlineApi = window.comexaDesktop?.offline;
    if (!offlineApi) {
      throw new ApiError(0, "OFFLINE_LOGIN_UNAVAILABLE", "La connexion hors ligne est disponible uniquement dans l’application desktop.");
    }
    try {
      const data = await offlineApi.authenticate({ email: email.trim(), password });
      const user = applySession({ ...data, accessToken: null }, { offline: true, offlineReady: true });
      await refreshOfflineStatus();
      return user;
    } catch (offlineError) {
      throw new ApiError(0, "OFFLINE_LOGIN_FAILED", offlineError?.message || "Connexion hors ligne impossible.");
    }
  }, [applySession, refreshOfflineStatus]);

  const login = useCallback(
    async (email, password) => {
      const offlineApi = window.comexaDesktop?.offline;
      if (offlineApi && typeof navigator !== "undefined" && navigator.onLine === false) {
        return loginOffline(email, password);
      }

      try {
        const desktopTimeoutMs = offlineApi ? 12_000 : undefined;
        const { data } = await apiFetch("/auth/login", { method: "POST", body: { email, password }, timeoutMs: desktopTimeoutMs });
        const user = applySession(data);
        if (offlineApi) {
          try {
            await offlineApi.rememberOnline({ email, password, user, accessToken: data.accessToken });
            setState((current) => ({ ...current, offlineReady: true, offlineSetupWarning: null }));
          } catch (error) {
            console.warn("[comexa-offline] Impossible de préparer l'accès hors ligne sécurisé.", error);
            setState((current) => ({
              ...current,
              offlineReady: false,
              offlineSetupWarning: "L'accès hors ligne sécurisé n'a pas pu être préparé sur cet appareil.",
            }));
          }
        }
        await refreshOfflineStatus();
        return user;
      } catch (networkError) {
        const isConnectionFailure =
          networkError instanceof ApiError &&
          (networkError.status === 0 || GATEWAY_STATUSES_FOR_OFFLINE.has(networkError.status));
        if (!isConnectionFailure || !offlineApi) throw networkError;
        return loginOffline(email, password);
      }
    },
    [applySession, loginOffline, refreshOfflineStatus],
  );

  const logout = useCallback(async () => {
    if (!offlineRef.current) {
      try {
        await apiFetch("/auth/logout", { method: "POST", token: tokenRef.current });
      } catch {
        // Session déjà expirée ou serveur indisponible : on nettoie quand même l'écran.
      }
    }
    try {
      await window.comexaDesktop?.offline?.logout?.();
    } catch {
      // L'effacement de la session React reste prioritaire ; le compte local exige son mot de passe.
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
        const result = await apiFetch(path, {
          ...options,
          token: tokenRef.current,
          offlineMode: offlineRef.current,
          offlineUserId: offlineUserIdRef.current,
        });
        if (!result.offline || result.pendingOperation) notifyWorkspaceUpdate(path, options);
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
      if (offlineRef.current) {
        throw new ApiError(0, "OFFLINE_DOWNLOAD_UNSUPPORTED", "Le téléchargement nécessite une connexion. Aucune action n'a été effectuée.");
      }
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

  /**
   * URL d'objet pointant vers un fichier protégé (PDF généré par l'API).
   *
   * MÊME discipline que `download` — rafraîchissement puis rejeu sur 401 — mais
   * sans déclencher l'enregistrement : c'est ce qu'il faut pour un `<iframe>`
   * ou une balise `<embed>`, qui ne peuvent pas porter l'en-tete
   * `Authorization`. L'appelant REVOQUE l'URL quand il n'en a plus besoin ; le
   * faire ici serait impossible, puisque la durée de vie de l'aperçu ne dépend
   * pas de celle de l'appel.
   */
  const blobUrl = useCallback(
    async (path, options = {}) => {
      if (offlineRef.current) {
        throw new ApiError(0, "OFFLINE_DOCUMENT_UNSUPPORTED", "L'aperçu de document nécessite une connexion. Aucune action n'a été effectuée.");
      }
      const read = async () => {
        const blob = await fetchProtectedBlob(path, { token: tokenRef.current, space: options.space });
        return URL.createObjectURL(blob);
      };
      try {
        return await read();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const user = await refresh();
          if (user) return read();
        }
        throw error;
      }
    },
    [refresh],
  );

  /** Relit les droits réels sans réémettre de jeton ni conserver une ancienne session. */
  const refreshProfile = useCallback(async () => {
    if (offlineRef.current) return state.user;
    const { data } = await request("/auth/me", { space: null });
    setState((current) => {
      if (current.status !== "authenticated" || current.user?.id !== data?.id) return current;
      if (JSON.stringify(current.user) === JSON.stringify(data)) return current;
      return { ...current, user: data };
    });
    return data;
  }, [request, state.user]);

  const value = useMemo(
    () => ({
      status: state.status,
      offline: state.offline === true,
      offlineReady: state.offlineReady === true,
      offlineSetupWarning: state.offlineSetupWarning ?? null,
      syncing: state.syncing === true,
      syncError: state.syncError ?? null,
      syncStatus: state.syncStatus ?? null,
      conflicts: state.conflicts ?? [],
      pendingOperations: state.pendingOperations ?? [],
      syncNow,
      refreshOfflineStatus,
      user: state.user,
      /** Compte complet, droits du rôle, même à l'intérieur d'un espace. */
      baseUser: state.user,
      /** Espace de travail actif (`null` hors espaces). */
      space: null,
      /**
       * Jeton d'acces, en memoire comme le reste de la session.
       *
       * Il est EXPOSE parce que la messagerie temps reel doit le presenter
       * dans la poignee de main du WebSocket (`handshake.auth.token`) : un
       * navigateur ne peut pas poser un en-tete `Authorization` sur une
       * connexion WebSocket, et le jeton de rafraichissement, lui, est un
       * cookie HttpOnly inaccessible au script. Sans ce jeton, le socket ne
       * s'ouvrait jamais et la messagerie n'etait jamais temps reel.
       *
       * Il ne quitte jamais le navigateur : il n'est ni dans un cookie lisible
       * par le script, ni dans le localStorage.
       */
      token: state.token,
      login,
      loginOffline,
      logout,
      request,
      download,
      blobUrl,
      refreshProfile,
    }),
    [state, login, loginOffline, logout, request, download, blobUrl, refreshProfile, syncNow, refreshOfflineStatus],
  );

  return (
    <AuthContext.Provider value={value}>
      {state.offline ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 top-0 z-[1000] flex min-h-10 items-center justify-center bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-amber-950 shadow-sm"
        >
          Hors connexion — seules les données déjà consultées et mises en cache sont disponibles{state.lastCachedAt ? ` (cache utilisé le ${new Date(state.lastCachedAt).toLocaleString("fr-FR")})` : ""}. Les opérations prises en charge sont enregistrées ici puis synchronisées au retour du réseau ; les autres fonctions, dont les documents, nécessitent Internet.
        </div>
      ) : state.offlineSetupWarning ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 top-0 z-[1000] flex min-h-10 items-center justify-center bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-amber-950 shadow-sm"
        >
          {state.offlineSetupWarning} Votre session en ligne reste active ; déconnectez-vous puis reconnectez-vous pour réessayer.
        </div>
      ) : state.status === "authenticated" && !state.offlineReady && typeof window !== "undefined" && window.comexaDesktop?.offline ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 top-0 z-[1000] flex min-h-10 items-center justify-center bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-amber-950 shadow-sm"
        >
          L’accès hors ligne n’est pas encore préparé sur cet appareil. Déconnectez-vous puis reconnectez-vous avec votre mot de passe pendant que vous êtes en ligne.
        </div>
      ) : null}
      {state.status === "authenticated" && typeof window !== "undefined" && window.comexaDesktop?.offline ? (
        <>
          <div className="fixed bottom-3 right-3 z-[1000] flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-800 shadow-lg backdrop-blur">
            <span className={`inline-block h-2 w-2 rounded-full ${state.offline || navigator.onLine === false ? "bg-amber-500" : "bg-emerald-500"}`} />
            <strong>{state.offline || navigator.onLine === false ? "Hors ligne" : "En ligne"}</strong>
            {state.offlineReady ? <span className="text-emerald-700">Accès hors ligne prêt</span> : null}
            <span>{state.syncStatus?.pending ?? 0} en attente</span>
            {(state.syncStatus?.failed ?? 0) > 0 ? <span className="text-rose-700">{state.syncStatus.failed} refus/erreurs</span> : null}
            {(state.syncStatus?.conflicts ?? state.conflicts?.length ?? 0) > 0 ? <span className="text-amber-800">{state.syncStatus?.conflicts ?? state.conflicts.length} conflit(s)</span> : null}
            {state.syncStatus?.lastSyncAt ? <span>Dernière synchro {new Date(state.syncStatus.lastSyncAt).toLocaleString("fr-FR")}</span> : <span>Pas encore synchronisé</span>}
            <button type="button" disabled={state.syncing || navigator.onLine === false} onClick={() => syncNow().catch(() => {})} className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {state.syncing ? "Synchronisation…" : "Synchroniser"}
            </button>
            {state.syncError ? <span className="w-full text-rose-700" role="alert">{state.syncError}</span> : null}
            {state.pendingOperations?.some((operation) => operation.state === "failed") ? (
              <details className="w-full border-t border-slate-200 pt-2">
                <summary className="cursor-pointer font-semibold text-rose-700">Opérations refusées ou à vérifier</summary>
                <ul className="mt-2 max-h-36 space-y-2 overflow-auto">
                  {state.pendingOperations.filter((operation) => operation.state === "failed").map((operation) => (
                    <li key={operation.operationId} className="rounded-lg bg-rose-50 p-2">
                      <strong>{operation.method} {operation.path}</strong>
                      <p>{operation.lastError || "Le serveur n'a pas confirmé cette opération."}</p>
                      <p className="text-[10px] text-slate-500">Votre modification locale est conservée. Réessayer enverra la même clé idempotente.</p>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
          {state.conflicts?.length ? (
            <section aria-label="Résolution des conflits hors ligne" className="fixed inset-x-3 bottom-20 z-[1001] mx-auto max-h-[55vh] max-w-3xl overflow-auto rounded-2xl border border-amber-300 bg-white p-4 shadow-2xl">
              <h2 className="text-base font-bold text-slate-900">Modifications à arbitrer ({state.conflicts.length})</h2>
              <p className="mb-3 mt-1 text-sm text-slate-600">Aucune version locale n’a été supprimée. Choisissez explicitement quelle version conserver.</p>
              {state.conflicts.map((conflict) => (
                <article key={conflict.conflictId} className="mb-3 rounded-xl border border-slate-200 p-3">
                  <h3 className="font-semibold">{conflict.entityType} · {conflict.entityId}</h3>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {conflict.fields.map((field) => (
                      <div key={field} className="rounded-lg bg-slate-50 p-2 text-xs">
                        <strong className="block">{field}</strong>
                        <span>Avant : {JSON.stringify(conflict.base?.[field] ?? null)}</span><br />
                        <span>Local : {JSON.stringify(conflict.local?.[field] ?? conflict.local ?? null)}</span><br />
                        <span>Serveur : {JSON.stringify(conflict.server?.[field] ?? null)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={async () => { await window.comexaDesktop.offline.resolveConflict({ userId: state.user.id, conflictId: conflict.conflictId, resolution: "local" }); await refreshOfflineStatus(); await syncNow({ refreshViews: false }).catch(() => {}); }} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Conserver ma version locale</button>
                    <button type="button" onClick={async () => { await window.comexaDesktop.offline.resolveConflict({ userId: state.user.id, conflictId: conflict.conflictId, resolution: "server" }); await refreshOfflineStatus(); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">Conserver la version serveur</button>
                  </div>
                </article>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
      {children}
    </AuthContext.Provider>
  );
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
  const { request: parentRequest, download: parentDownload, blobUrl: parentBlobUrl } = parent;

  const request = useCallback(
    (path, options = {}) => parentRequest(path, { space, ...options }),
    [parentRequest, space],
  );
  const download = useCallback(
    (path, filename, options = {}) => parentDownload(path, filename, { space, ...options }),
    [parentDownload, space],
  );
  const blobUrl = useCallback(
    (path, options = {}) => parentBlobUrl(path, { space, ...options }),
    [parentBlobUrl, space],
  );

  const value = useMemo(() => {
    const user = parent.user && permissions ? { ...parent.user, permissions: [...permissions] } : parent.user;
    return { ...parent, user, baseUser: parent.user, space, request, download, blobUrl };
  }, [parent, permissions, space, request, download, blobUrl]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth doit etre utilise dans <AuthProvider>.");
  return context;
}
