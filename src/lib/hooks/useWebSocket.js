"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/session";

/**
 * Connexion temps reel — Socket.IO, namespace `/rt`.
 *
 * CINQ CHOSES QUI ONT FAIT QUE LA MESSAGERIE N'ETAIT PAS TEMPS REEL.
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
 * 4. LE TRANSPORT. Engine.io tente `polling` puis tente de monter en
 *    `websocket`. L'ordre inverse (websocket d'abord) etait un piege : quand
 *    l'upgrade WebSocket echoue — cas normal derriere un proxy HTTP qui ne
 *    relaie pas les upgrades — engine.io 6.6 NE REPLIQUE PAS sur `polling`
 *    (son `tryAllTransports` est hors defaut), et la connexion mourait sans
 *    message. `polling` d'abord, `tryAllTransports: true`, et l'upgrade se
 *    fait quand il reussit : le temps reel passe partout, et reste un WebSocket
 *    la ou c'est possible.
 *
 * 5. LA CONNEXION EST PARTAGEE. Deux composants utilisent ce hook — le fil de
 *    discussion et le compteur de notifications. Avec une connexion PAR
 *    COMPOSANT, chacun devalait la sienne, et le nettoyage de l'un coupait le
 *    socket de l'autre : les notifications cessaient d'arriver des que l'on
 *    quittait la messagerie. Le socket est donc UN SEUL objet partage, cree
 *    au niveau du module, et le hook n'est plus qu'un abonnement a son etat.
 *
 * OU SE CONNECTE-T-ON ? Deux cas, dans cet ordre :
 *
 *  - `NEXT_PUBLIC_SOCKET_URL` (variable PUBLIQUE, figee a la compilation) :
 *    le navigateur parle DIRECTEMENT au backend. C'est le mode de production
 *    souhaite : un WebSocket reel, aucune dependance au proxy du front, et
 *    aucune latence de polling. Exemple : `https://api.comexa.tld`.
 *  - sinon, meme origine : `/socket.io` passe par le relais Next, comme
 *    `/api`. Le mode de repli, utile en developpement et quand le front et
 *    l'API sont derriere le meme nom de domaine.
 *
 * Le jeton voyage dans `handshake.auth.token` (c'est ce que le navigateur
 * envoie) : aucune requete prealable n'est necessaire.
 */

/** URL de base du serveur temps reel, lue au chargement du module. */
const CONFIGURED_SOCKET_URL = (process.env.NEXT_PUBLIC_SOCKET_URL ?? "").trim();

/** Duree au-dela de laquelle la connexion est declaree en echec. */
const CONNECT_WATCHDOG_MS = 20000;

/**
 * L'origine du serveur temps reel.
 *
 * `NEXT_PUBLIC_SOCKET_URL` gagne toujours : c'est une decision
 * d'exploitation (le backend est ailleurs), pas une deduction. Sinon, meme
 * origine que la page.
 */
function resolveSocketBaseUrl() {
  if (CONFIGURED_SOCKET_URL) {
    return CONFIGURED_SOCKET_URL.replace(/\/+$/, "");
  }

  if (typeof window === "undefined") {
    return "";
  }

  return window.location.origin;
}

/* ---------------------------------------------------------------------------
 * L'ETAT PARTAGE
 * ------------------------------------------------------------------------- */

const initialState = {
  socket: null,
  isConnected: false,
  isConnecting: false,
  error: null,
};

/** Les abonnes au socket partage (un par composant qui l'utilise). */
const subscribers = new Set();

/** L'etat courant, partage par tous les abonnes. */
let sharedState = initialState;

/** Le socket physique — UN SEUL pour toute l'application. */
let socket = null;

/** Le jeton pour lequel le socket courant a ete ouvert. */
let socketToken = null;

/** Le jeton d'une ouverture en cours (l'import du module est asynchrone). */
let openingToken = null;

/**
 * Compteur de GENERATION.
 *
 * Il distingue deux tentatives d'ouverture qui portent le MEME jeton — ce que
 * le jeton seul ne sait pas faire. En mode strict, React monte, demonte, puis
 * remonte le composant : la premiere tentative (encore en attente de l'import
 * du module) et la seconde seraient confondues, et l'application tiendrait
 * DEUX sockets pour la meme session. Chaque fermeture incremente le compteur :
 * une tentative en cours qui se reveil apres la fermeture voit une generation
 * differente et s'abandonne.
 */
let generation = 0;

/** Minuterie de garde : sans elle, une connexion muette resterait « Connexion… ». */
let watchdog = null;

/** Nombre de composants abonnes — le socket ne ferme qu'a zero. */
let consumers = 0;

function publish(patch) {
  sharedState = { ...sharedState, ...patch };

  for (const listener of subscribers) {
    listener(sharedState);
  }
}

/** Ferme le socket courant et libere les ressources. */
function closeSocket() {
  if (watchdog) {
    clearTimeout(watchdog);
    watchdog = null;
  }

  if (socket) {
    socket.removeAllListeners?.();
    socket.disconnect();
  }

  socket = null;
  socketToken = null;
  openingToken = null;
  generation += 1;

  publish({ socket: null, isConnected: false, isConnecting: false });
}

/** Ouvre (ou rouvre) le socket partage pour un jeton donne. */
async function openSocket(token) {
  if (!token) {
    return;
  }

  const startedAt = generation;

  publish({ isConnecting: true, error: null });

  let io;

  try {
    // Import dynamique : le module n'est charge que dans le navigateur, et
    // son absence ne casse pas le rendu (le temps reel devient indisponible,
    // la messagerie reste lisible).
    const socketModule = await import("socket.io-client");
    io = socketModule.io ?? socketModule.default;
  } catch {
    publish({ isConnecting: false, error: "Le temps reel n'est pas disponible sur ce poste." });
    return;
  }

  // Le jeton a pu changer (ou la session finir) pendant l'import : dans ce
  // cas, la tentative est abandonnee — sans quoi deux sockets se disputeraient
  // la meme session. La GENERATION tranche le cas ou le jeton, lui, n'a pas
  // change : c'est la fermeture (ou la fermeture puis reouverture) qui invalide
  // la tentative en cours.
  if (generation !== startedAt || socketToken !== token || consumers === 0) {
    return;
  }

  if (typeof io !== "function") {
    publish({ isConnecting: false, error: "Le temps reel n'est pas disponible sur ce poste." });
    return;
  }

  const base = resolveSocketBaseUrl();

  if (!base) {
    publish({ isConnecting: false, error: "Le temps reel n'est pas disponible sur ce poste." });
    return;
  }

  const newSocket = io(`${base}/rt`, {
    path: "/socket.io",
    // `polling` d'abord : c'est le seul transport qui passe partout.
    // L'upgrade vers `websocket` est tente automatiquement ensuite.
    transports: ["polling", "websocket"],
    tryAllTransports: true,
    upgrade: true,
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 15000,
    timeout: 15000,
    autoConnect: false,
  });

  socket = newSocket;

  newSocket.on("connect", () => {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    publish({ isConnected: true, isConnecting: false, error: null });
  });

  newSocket.on("disconnect", () => {
    publish({ isConnected: false, isConnecting: false });
  });

  newSocket.on("connect_error", (err) => {
    publish({ isConnecting: false, error: err?.message || "Erreur de connexion" });
  });

  newSocket.on("rt:error", (data) => {
    publish({ error: data?.message || "Erreur serveur" });
  });

  newSocket.connect();
  publish({ socket: newSocket });

  // Filet de securite : sans lui, une connexion qui n'aboutit jamais
  // laisserait l'interface figee sur « Connexion… » — le pire des etats,
  // parce qu'il ne dit rien.
  watchdog = setTimeout(() => {
    watchdog = null;
    if (!socket || socket.connected) return;
    publish({ isConnecting: false, error: "Connexion temps reel indisponible." });
  }, CONNECT_WATCHDOG_MS);
}

/** Point d'entree unique : garantit UN SEUL socket pour un jeton donne. */
function ensureSocket(token) {
  if (!token) {
    if (socket || socketToken || openingToken) closeSocket();
    return;
  }

  // Deja ouvert, ou en cours d'ouverture : rien a faire.
  if (socket && socketToken === token) return;
  if (openingToken === token) return;

  if (socket || socketToken || openingToken) {
    // Le jeton a change (session renouvelee, compte change) : on repart d'une
    // connexion propre plutot que de reutiliser un socket lie a l'ancien jeton.
    closeSocket();
  }

  socketToken = token;
  openingToken = token;

  void openSocket(token).finally(() => {
    if (openingToken === token) {
      openingToken = null;
    }
  });
}

/* ---------------------------------------------------------------------------
 * LE HOOK
 * ------------------------------------------------------------------------- */

export function useSocketIO() {
  const { token } = useAuth();
  const [state, setState] = useState(sharedState);
  const tokenRef = useRef(token);

  // Abonnement a l'etat partage.
  useEffect(() => {
    const listener = (next) => setState(next);
    subscribers.add(listener);
    setState(sharedState);
    consumers += 1;

    return () => {
      subscribers.delete(listener);
      consumers -= 1;

      // Le dernier composant ferme la porte. Tant qu'un seul reste, le socket
      // vit : c'est ce qui evite qu'une sortie de la messagerie coupe les
      // notifications temps reel du reste de l'application.
      if (consumers === 0) {
        closeSocket();
      }
    };
  }, []);

  // Ouverture (eventuelle reconnexion) au montage et a chaque changement de
  // jeton. `ensureSocket` est idempotent : deux effets qui l'appellent pour le
  // meme jeton n'ouvrent qu'une seule connexion.
  useEffect(() => {
    tokenRef.current = token;
    ensureSocket(token);
  }, [token]);

  // Deconnexion : on coupe la connexion courante et on libere la ref.
  const disconnect = useCallback(() => {
    closeSocket();
  }, []);

  const connect = useCallback(async () => {
    ensureSocket(tokenRef.current);
  }, []);

  // Rejoindre une conversation
  const joinConversation = useCallback((conversationId) => {
    if (!socket || !conversationId) return Promise.resolve(false);

    return new Promise((resolve, reject) => {
      socket.emit("conversation:join", { conversationId }, (ack) => {
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
    if (!socket || !conversationId) return;
    socket.emit("conversation:leave", { conversationId });
  }, []);

  // Envoyer un indicateur de frappe
  const sendTyping = useCallback((conversationId, isTyping) => {
    if (!socket || !conversationId) return;
    socket.emit("typing", { conversationId, isTyping });
  }, []);

  // Ecouter un evenement
  const on = useCallback((event, callback) => {
    if (!socket) {
      return () => {};
    }

    socket.on(event, callback);
    return () => socket.off(event, callback);
  }, []);

  // Retirer un listener
  const off = useCallback((event, callback) => {
    if (!socket) return;
    socket.off(event, callback);
  }, []);

  return {
    socket: state.socket,
    isConnected: state.isConnected,
    isConnecting: state.isConnecting,
    error: state.error,
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
