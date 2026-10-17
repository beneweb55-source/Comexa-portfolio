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

  const canRead = can(user, "conversation:read:own");

  // Si pas d'accès en lecture, ne rien afficher.
  // Rien n'est rendu tant que la session n'est pas chargee : sans compte,
  // il n'y a ni conversation a lire ni donneur de permission.
  if (!canRead) {
    return null;
  }

  // Utiliser le nouveau composant ChatWrapper.
  // Mode « page » : la messagerie remplit la rubrique. Le mode flottant
  // (pastille dans un coin) est fait pour un chat qu'on survole, pas pour une
  // page dediee a la messagerie.
  return <ChatWrapper defaultMinimized={false} variant="page" />;
}

/**
 * Export alternatif pour une intégration plus fine
 */
export { ChatWrapper } from "./chat/ChatWrapper";
export { ChatPanel } from "./chat/ChatPanel";
export { ChatSidebar } from "./chat/ChatSidebar";
export { ChatMessage } from "./chat/ChatMessage";
export { ChatInput } from "./chat/ChatInput";
