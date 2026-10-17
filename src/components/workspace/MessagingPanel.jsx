"use client";

/*
 * NOUVELLE MESSAGERIE COMEXA
 * 
 * Ce composant remplace l'ancienne messagerie par un chat moderne
 * avec les fonctionnalités suivantes:
 * 
 * ✅ Design moderne style WhatsApp/Slack/Discord
 * ✅ Glassmorphism et aesthetic Comexa
 * ✅ WebSocket pour le temps réel
 * ✅ Partage de ressources (projets, tâches, devis, factures)
 * ✅ Responsive design (mobile, tablette, desktop)
 * ✅ 3 modes: Minimaliste, Normal, Plein écran
 * 
 * Intégration:
 * - Utilisez simplement <MessagingPanel /> comme avant
 * - Aucune modification nécessaire dans le code existant
 * - Le composant gère automatiquement tous les modes
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { ChatWrapper } from "./chat/ChatWrapper";

/**
 * Messagerie moderne - Remplace l'ancien MessagingPanel
 * 
 * Ce composant est rétro-compatible avec l'ancien usage.
 * Il gère automatiquement:
 * - La connexion WebSocket
 * - Le chargement des conversations
 * - L'affichage des messages en temps réel
 * - Les modes: Minimaliste, Normal, Plein écran
 * - Le respect de l'aesthetic du dashboard
 */
export default function MessagingPanel() {
  const { user } = useAuth();
  const [isMounted, setIsMounted] = useState(false);

  const canRead = can(user, "conversation:read:own");

  // Éviter le rendu SSR pour éviter les erreurs avec window
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Si pas d'accès en lecture, ne rien afficher
  if (!canRead) {
    return null;
  }

  // Pendant le chargement
  if (!isMounted) {
    return null;
  }

  // Utiliser le nouveau composant ChatWrapper
  return <ChatWrapper />;
}

/**
 * Export alternatif pour une intégration plus fine
 */
export { ChatWrapper } from "./chat/ChatWrapper";
export { ChatPanel } from "./chat/ChatPanel";
export { ChatSidebar } from "./chat/ChatSidebar";
export { ChatMessage } from "./chat/ChatMessage";
export { ChatInput } from "./chat/ChatInput";
