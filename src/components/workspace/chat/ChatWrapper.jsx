"use client";

import { useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";

/**
 * Enveloppe du chat — ajoute le mode « pastille flottante » et le plein ecran.
 *
 * `variant` :
 *  - `floating` (defaut) : le chat flotte dans un coin, reduit en pastille ;
 *  - `page` : le chat remplit la rubrique — c'est le mode des pages
 *    `/messagerie`, ou une pastille flottante ne montrait qu'un bouton.
 */
export function ChatWrapper({ defaultMinimized = true, variant = "floating", initialConversationId = null }) {
  const { user } = useAuth();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(defaultMinimized);

  const canRead = can(user, "conversation:read:own");
  const pageMode = variant === "page";

  // Toggle pour le mode plein écran
  const toggleExpand = () => {
    setIsExpanded((prev) => !prev);
    if (isExpanded) {
      setIsMinimized(false);
    }
  };

  // Toggle pour le mode minimaliste
  const toggleMinimized = () => {
    setIsMinimized((prev) => !prev);
  };

  // Si l'utilisateur n'a pas les permissions, ne rien afficher
  if (!canRead) {
    return null;
  }

  // Si mode plein écran, afficher le panel plein écran
  if (isExpanded) {
    return (
      <ChatPanel
        isExpanded={true}
        onToggleExpand={toggleExpand}
        isMinimized={false}
      />
    );
  }

  // Si mode minimaliste, afficher juste le bouton flottant
  if (isMinimized && !pageMode) {
    return (
      <button
        type="button"
        onClick={toggleMinimized}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-[var(--comexa-blue-500)] to-[var(--comexa-blue-600)] text-white flex items-center justify-center shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-200 z-40"
        title="Ouvrir la messagerie"
        style={{
          boxShadow: "0 10px 40px -10px rgba(30, 134, 224, 0.4)",
        }}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>
    );
  }

  // Sinon, afficher le panel normal
  return (
    <ChatPanel
      isExpanded={false}
      onToggleExpand={toggleExpand}
      defaultMinimized={false}
      variant={variant}
      initialConversationId={initialConversationId}
    />
  );
}

/**
 * Version alternative qui s'intègre directement dans le layout
 *
 * Cette version est conçue pour être utilisée dans une barre latérale
 * ou une zone dédiée du dashboard.
 */
export function ChatInLayout({
  position = "bottom-right", // bottom-right, bottom-left, top-right, top-left
  defaultOpen = false,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const getPositionClasses = () => {
    switch (position) {
      case 'bottom-left':
        return {
          button: "bottom-6 left-6",
          panel: "bottom-6 left-6",
        };
      case 'top-right':
        return {
          button: "top-6 right-6",
          panel: "top-6 right-6",
        };
      case 'top-left':
        return {
          button: "top-6 left-6",
          panel: "top-6 left-6",
        };
      default: // bottom-right
        return {
          button: "bottom-6 right-6",
          panel: "bottom-6 right-6",
        };
    }
  };

  const positions = getPositionClasses();

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`fixed ${positions.button} w-14 h-14 rounded-full bg-gradient-to-br from-[var(--comexa-blue-500)] to-[var(--comexa-blue-600)] text-white flex items-center justify-center shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-200 z-40`}
        title="Ouvrir la messagerie"
        style={{
          boxShadow: "0 10px 40px -10px rgba(30, 134, 224, 0.4)",
        }}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>
    );
  }

  return (
    <div className={`fixed ${positions.panel} z-40`}>
      <ChatPanel
        isExpanded={false}
        onToggleExpand={() => setIsOpen(false)}
        defaultMinimized={false}
      />
    </div>
  );
}

export default ChatWrapper;
