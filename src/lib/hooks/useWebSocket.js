"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/session";

/**
 * Connexion temps reel — Socket.IO, namespace `/rt`.
 *
 * TROIS CHOSES QUI ONT FAIT QUE LA MESSAGERIE N'ETAIT PAS TEMPS REEL.
 *
 * 1. LE NAMESPACE. La passerelle du backend est declaree sur `/rt`
 *    (`REALTIME_NAMESPACE`) : le client doit s'y connecter avec
 *    `io(origin + '/rt', ...)`. Brancher sur la racine aurait ouvert une
 *    connexion sur le namespace par defaut, ou personne n'ecoute : la
 *    connexion « reussit » et aucun message n'arrive jamais.
 *
 * 2. LE CHEMIN. Le serveur socket.io du backend est monte par Nest sur le
 *    chemin engine.io par defaut (`/socket.io`) ; le namespace ne change que
 *    le routage, pas le chemin. Le client annonce donc `path: '/socket.io'` —
 *    et `/rt/socket.io` ne repondrait a personne.
 *
 * 3. LA BOUCLE DE RECONNEXION. Le callback `connect` dependait de l'etat
 *    `socket`, et l'effet qui l'appelle nettoyait en coupant la connexion :
 *    chaque connexion changeait l'etat, donc l'effet se relancait, donc il
 *    coupait, donc il reconnectait — sans fin. Ici, `connect` ne depend QUE du
 *    jeton, et la connexion courante est suivie dans une ref : l'effet ne
 *    tourne qu'une fois par jeton.
 *
 * Le jeton voyage dans `handshake.auth.token` (c'est ce que le navigateur
 * envoie), et l'URL reste celle du site : le proxy Next relaie `/socket.io`
 * vers le backend, comme il relaie `/api`.
 */
export function useSocketIO() {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const socketRef = useRef(null);

  // Deconnexion : on coupe la connexion courante et on libere la ref.
  const disconnect = useCallback(() => {
    const current = socketRef.current;
    socketRef.current = null;
    if (current) {
      current.removeAllListeners?.();
      current.disconnect();
    }
    setSocket(null);
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  // Connexion. Ne depend QUE du jeton : c'est ce qui casse la boucle.
  const connect = useCallback(async () => {
    if (!token || socketRef.current) return;

    let io;
    try {
      // Import dynamique : le module n'est charge que dans le navigateur, et
      // son absence ne casse pas le rendu (le temps reel devient indisponible,
      // la messagerie reste lisible).
      const socketModule = await import("socket.io-client");
      io = socketModule.io ?? socketModule.default;
    } catch {
      setError("Le temps reel n'est pas disponible sur ce poste.");
      return;
    }

    // Le jeton a pu changer (ou la session finir) pendant l'import.
    if (!token || socketRef.current) {
      return;
    }

    setIsConnecting(true);
    setError(null);

    const origin = window.location.origin;

    const newSocket = io(`${origin}/rt`, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 3000,
      timeout: 20000,
      autoConnect: false,
    });

    socketRef.current = newSocket;

    newSocket.on("connect", () => {
      setIsConnected(true);
      setIsConnecting(false);
      setError(null);
    });

    newSocket.on("disconnect", () => {
      setIsConnected(false);
      setIsConnecting(false);
    });

    newSocket.on("connect_error", (err) => {
      setIsConnecting(false);
      setError(err?.message || "Erreur de connexion");
    });

    newSocket.on("rt:error", (data) => {
      setError(data?.message || "Erreur serveur");
    });

    newSocket.connect();
    setSocket(newSocket);
  }, [token]);

  // Une seule connexion par jeton.
  useEffect(() => {
    // Sans jeton, il n'y a rien a connecter. La fermeture de la connexion
    // precedente est faite par le nettoyage de l'effet precedent.
    if (!token) {
      return undefined;
    }

    // La connexion demarre dans une tache, pas dans le corps de l'effet :
    // l'effet ne fait que synchroniser l'etat du composant avec celui du
    // socket, et le rendu n'est jamais declenche en cascade par lui.
    const timer = setTimeout(() => connect(), 0);

    return () => {
      clearTimeout(timer);
      disconnect();
    };
  }, [token, connect, disconnect]);

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

  // Ecouter un evenement
  const on = useCallback((event, callback) => {
    if (!socketRef.current) {
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

export default useSocketIO;
