"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Expose uniquement des opérations métier explicites. Aucun accès SQL, fichier,
// chemin arbitraire, jeton ou objet ipcRenderer n'est transmis au renderer.
contextBridge.exposeInMainWorld("comexaDesktop", Object.freeze({
  isDesktop: true,
  offline: Object.freeze({
    rememberOnline: (record) => ipcRenderer.invoke("comexa:offline:remember-online", record),
    activateOnline: (record) => ipcRenderer.invoke("comexa:offline:activate-online", record),
    authenticate: (credentials) => ipcRenderer.invoke("comexa:offline:authenticate", credentials),
    cacheResponse: (entry) => ipcRenderer.invoke("comexa:offline:cache-response", entry),
    getCachedResponse: (query) => ipcRenderer.invoke("comexa:offline:get-cached-response", query),
    status: (query) => ipcRenderer.invoke("comexa:offline:status", query),
    markSyncSuccess: (query) => ipcRenderer.invoke("comexa:offline:mark-sync-success", query),
    enqueueMutation: (operation) => ipcRenderer.invoke("comexa:offline:enqueue-mutation", operation),
    listPending: (query) => ipcRenderer.invoke("comexa:offline:list-pending", query),
    listIdMappings: (query) => ipcRenderer.invoke("comexa:offline:list-id-mappings", query),
    updateOperation: (operation) => ipcRenderer.invoke("comexa:offline:update-operation", operation),
    recordConflict: (conflict) => ipcRenderer.invoke("comexa:offline:record-conflict", conflict),
    listConflicts: (query) => ipcRenderer.invoke("comexa:offline:list-conflicts", query),
    resolveConflict: (resolution) => ipcRenderer.invoke("comexa:offline:resolve-conflict", resolution),
    listCached: (query) => ipcRenderer.invoke("comexa:offline:list-cached", query),
    findCachedEntity: (query) => ipcRenderer.invoke("comexa:offline:find-cached-entity", query),
    renameCachedRequest: (query) => ipcRenderer.invoke("comexa:offline:rename-cached-request", query),
    deleteCacheEntry: (query) => ipcRenderer.invoke("comexa:offline:delete-cache-entry", query),
    logout: () => ipcRenderer.invoke("comexa:offline:logout"),
  }),
}));
