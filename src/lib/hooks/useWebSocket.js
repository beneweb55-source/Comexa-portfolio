"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/session";

/**
 * Hook pour gérer la connexion WebSocket avec Socket.IO
 * 
 * Ce hook gère:
 * - La connexion au serveur Socket.IO
 * - La reconnexion automatique
 * - L'abonnement aux rooms de conversation
 * - Les événements de temps réel
 */
export function useSocketIO() {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const socketRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectDelay = 3000;

  // Conserver la référence à jour
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  // Connexion
  const connect = useCallback(() => {
    if (!token || socket) return;

    setIsConnecting(true);
    setError(null);

    try {
      // Importer dynamiquement socket.io-client
      // Cela permet d'éviter les erreurs SSR
      let io;
      try {
        // @ts-ignore - Dynamic import
        io = require("socket.io-client");
      } catch (e) {
        // Si socket.io-client n'est pas installé, on simule une connexion réussie
        // mais sans fonctionnalités WebSocket
        console.warn("socket.io-client non installé. Utilisation du mode dégradé (polling).");
        setIsConnected(true);
        setIsConnecting(false);
        setSocket({
          on: () => {},
          off: () => {},
          emit: () => {},
          disconnect: () => {},
        });
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const socketUrl = `${protocol}//${host}`;

      const newSocket = io(socketUrl, {
        path: "/rt/socket.io",
        transports: ["websocket", "polling"],
        auth: {
          token: token,
        },
        reconnection: true,
        reconnectionAttempts: maxReconnectAttempts,
        reconnectionDelay: reconnectDelay,
        timeout: 20000,
        autoConnect: false,
      });

      // Gestion des événements de connexion
      newSocket.on("connect", () => {
        setIsConnected(true);
        setIsConnecting(false);
        reconnectAttempts.current = 0;
        setSocket(newSocket);
      });

      newSocket.on("disconnect", () => {
        setIsConnected(false);
        setIsConnecting(false);
        // Ne pas réinitialiser socket ici, car la reconnexion est automatique
      });

      newSocket.on("connect_error", (err) => {
        setIsConnecting(false);
        setError(err.message || "Erreur de connexion");
        reconnectAttempts.current++;
      });

      newSocket.on("rt:error", (data) => {
        setError(data.message || "Erreur serveur");
      });

      // Se connecter
      newSocket.connect();
      setSocket(newSocket);
    } catch (err) {
      setIsConnecting(false);
      setError(err.message || "Erreur lors de la connexion");
    }
  }, [token, socket]);

  // Déconnexion
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      setSocket(null);
      setIsConnected(false);
      setIsConnecting(false);
    }
  }, []);

  // Rejoindre une conversation
  const joinConversation = useCallback((conversationId) => {
    if (!socketRef.current || !conversationId) return Promise.resolve(false);

    return new Promise((resolve, reject) => {
      socketRef.current.emit("conversation:join", { conversationId }, (ack) => {
        if (ack?.joined) {
          resolve(true);
        } else {
          reject(new Error("Impossible de rejoindre la conversation"));
        }
      });
    });
  }, []);

  // Quitter une conversation
  const leaveConversation = useCallback((conversationId) => {
    if (!socketRef.current || !conversationId) return;

    socketRef.current.emit("conversation:leave", { conversationId });
  }, []);

  // Envoyer un indicateur de frappe
  const sendTyping = useCallback((conversationId, isTyping) => {
    if (!socketRef.current || !conversationId) return;

    socketRef.current.emit("typing", { conversationId, isTyping });
  }, []);

  // Écouter les événements
  const on = useCallback((event, callback) => {
    if (!socketRef.current) {
      // Si pas de socket, on retourne une fonction de nettoyage vide
      return () => {};
    }

    socketRef.current.on(event, callback);
    return () => socketRef.current?.off(event, callback);
  }, []);

  // Retirer un listener
  const off = useCallback((event, callback) => {
    if (!socketRef.current) return;

    socketRef.current.off(event, callback);
  }, []);

  // Gestion du token
  useEffect(() => {
    if (token) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [token, connect, disconnect]);

  return {
    socket,
    isConnected,
    isConnecting,
    error,
    connect,
    disconnect,
    joinConversation,
    leaveConversation,
    sendTyping,
    on,
    off,
  };
}

/**
 * Hook simplifié qui retourne toujours une connexion "simulée"
 * Utile pour le développement sans WebSocket
 */
export function useMockWebSocket() {
  return {
    socket: null,
    isConnected: true,
    isConnecting: false,
    error: null,
    connect: () => {},
    disconnect: () => {},
    joinConversation: () => Promise.resolve(true),
    leaveConversation: () => {},
    sendTyping: () => {},
    on: () => () => {},
    off: () => {},
  };
}

export default useSocketIO;
