"use client";

/*
 * Notifications EN TEMPS RÉEL.
 *
 * Le backend pousse déjà chaque notification dans la room personnelle de son
 * destinataire (`realtime.gateway.ts`, événement `notification`) — mais rien ne
 * l'écoutait côté client : une notification n'apparaissait qu'au rechargement
 * suivant. Ce comble est ce que ce hook corrige.
 *
 * POURQUOI S'ABONNER À `socket` ET PAS À `on()`. Le hook `useSocketIO` expose
 * un `on()` qui rend une fonction vide tant que la connexion n'est pas établie
 * (`if (!socketRef.current) return () => {}`). S'y abonner au montage ne
 * brancherait donc rien. On attend l'objet socket lui-même, qui arrive avec
 * l'état — le même contournement que la messagerie utilise déjà.
 *
 * LA DÉDUPLICATION EST OBLIGATOIRE. Le socket se reconnecte (5 tentatives), et
 * une notification déjà reçue peut être repoussée. Sans garde des identifiants
 * vus, l'utilisateur verrait la même alerte deux fois.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import useSocketIO from "@/lib/hooks/useWebSocket";

/** Nombre d'identifiants mémorisés : largement plus que ce qu'une reconnexion repousse. */
const SEEN_LIMIT = 100;

export function useRealtimeNotifications(onNotification) {
  const { socket } = useSocketIO();
  const handlerRef = useRef(onNotification);
  const seen = useRef(new Set());

  // Le rappel est recopié dans une ref APRÈS le rendu, pas pendant : une ref
  // n'a pas à être à jour au moment où React peint, et l'écrire pendant le
  // rendu est exactement ce que React interdit.
  useEffect(() => {
    handlerRef.current = onNotification;
  }, [onNotification]);

  useEffect(() => {
    if (!socket) return undefined;

    function handle(payload) {
      // Le serveur envoie `{ notification }` ; certains clients historiques
      // envoient la notification à plat. Les deux formes sont acceptées.
      const notification = payload?.notification ?? payload;
      if (!notification?.id) return;
      if (seen.current.has(notification.id)) return;

      seen.current.add(notification.id);
      if (seen.current.size > SEEN_LIMIT) {
        const oldest = seen.current.values().next().value;
        seen.current.delete(oldest);
      }
      handlerRef.current?.(notification);
    }

    socket.on("notification", handle);
    return () => socket.off("notification", handle);
  }, [socket]);

  return { connected: Boolean(socket) };
}

/**
 * Variante prête à l'emploi : rend la dernière notification arrivée et permet
 * de la masquer. `onNotification` est appelé une seule fois par notification.
 */
export function useLatestNotification(onNotification) {
  const [latest, setLatest] = useState(null);
  const stable = useCallback(
    (notification) => {
      setLatest(notification);
      onNotification?.(notification);
    },
    [onNotification],
  );
  useRealtimeNotifications(stable);
  const dismiss = useCallback(() => setLatest(null), []);
  return { latest, dismiss };
}

export default useRealtimeNotifications;
