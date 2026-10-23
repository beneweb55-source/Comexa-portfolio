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
    logout: () => ipcRenderer.invoke("comexa:offline:logout"),
  }),
}));
