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
        variant={variant}
        initialConversationId={initialConversationId}
      />
    );
  }

  // Si mode minimaliste, afficher juste le bouton flottant. La bulle reprend
  // la charte du dashboard (coque noire, rayon pilule) et L'EMPREINTE OFFICIELLE
  // de Comexa — l'ancien dégradé bleu « générique chat » jurait avec tout le
  // reste et ne disait rien de la marque.
  if (isMinimized && !pageMode) {
    return (
      <button
        type="button"
        onClick={toggleMinimized}
        className="sui-chat__fab"
        title="Ouvrir la messagerie"
        aria-label="Ouvrir la messagerie"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={26} height={26} draggable="false" />
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
        className={`sui-chat__fab ${positions.button === "bottom-6 left-6" ? "sui-chat__fab--left" : ""}`.trim()}
        title="Ouvrir la messagerie"
        aria-label="Ouvrir la messagerie"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={26} height={26} draggable="false" />
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
