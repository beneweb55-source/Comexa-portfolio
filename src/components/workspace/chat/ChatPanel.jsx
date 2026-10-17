"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { messageOf } from "@/lib/api";
import { useListing } from "@/lib/use-listing";
import useSocketIO from "@/lib/hooks/useWebSocket";
import { ChatSidebar } from "./ChatSidebar";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { Empty } from "@/components/workspace/ui";
import { useActionNotification } from "@/components/workspace/ui/ActionNotification";

/**
 * Composant principal du chat moderne
 * 
 * Fonctionnalités:
 * - Interface style WhatsApp/Slack/Discord
 * - WebSocket pour le temps réel
 * - Liste des conversations à gauche
 * - Fil de discussion à droite
 * - Redimensionnable (peut occuper tout l'espace)
 * - Design cohérent avec l'identité Comexa
 * - Responsive (mobile, tablette, desktop)
 * - Mode minimaliste (bouton flottant) ou grande (plein écran)
 * - Notifications avec liens de redirection vers Comexa
 */
export function ChatPanel({
  isExpanded = false,
  onToggleExpand,
  defaultMinimized = false,
}) {
  const { request, user } = useAuth();
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [isMinimized, setIsMinimized] = useState(defaultMinimized);
  const [showSidebar, setShowSidebar] = useState(true);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

  // WebSocket
  const { socket, isConnected, isConnecting, error: wsError } = useSocketIO();

  // Notifications
  const { showNotification, NotificationComponent } = useActionNotification();

  const canWrite = can(user, "message:write:own");
  const canRead = can(user, "conversation:read:own");

  // Charger une conversation
  const loadConversation = useCallback(async (conversationId) => {
    if (!conversationId || !canRead) return;

    setLoadingMessages(true);
    setMessages([]);
    setNextCursor(null);

    try {
      const [{ data: conversation }, page] = await Promise.all([
        request(`/conversations/${conversationId}`),
        request(`/conversations/${conversationId}/messages?perPage=50`),
      ]);

      setSelectedConversation(conversation);
      setMessages([...(page.data ?? [])].reverse());
      setNextCursor(page.meta?.nextCursor ?? null);
      setHasMoreMessages(!!page.meta?.nextCursor);

      // Marquer comme lu
      await request(`/conversations/${conversationId}/read`, { method: "POST" }).catch(() => null);
    } catch (caught) {
      showNotification({
        message: messageOf(caught),
        duration: 5000,
      });
    } finally {
      setLoadingMessages(false);
    }
  }, [request, canRead, showNotification]);

  // Charger les messages plus anciens
  const loadOlderMessages = useCallback(async () => {
    if (!selectedConversation?.id || !nextCursor || loadingMessages) return;

    setLoadingMessages(true);

    try {
      const page = await request(
        `/conversations/${selectedConversation.id}/messages?perPage=50&cursor=${encodeURIComponent(nextCursor)}`
      );

      setMessages((prev) => [...[...(page.data ?? [])].reverse(), ...prev]);
      setNextCursor(page.meta?.nextCursor ?? null);
      setHasMoreMessages(!!page.meta?.nextCursor);
    } catch (caught) {
      showNotification({
        message: messageOf(caught),
        duration: 5000,
      });
    } finally {
      setLoadingMessages(false);
    }
  }, [selectedConversation, nextCursor, loadingMessages, request, showNotification]);

  // Envoyer un message
  const handleSend = useCallback(async (content) => {
    if (!selectedConversation?.id || !content.trim() || sending) return;

    setSending(true);

    try {
      const response = await request(`/conversations/${selectedConversation.id}/messages`, {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: content }),
      });

      if (response.ok) {
        const newMessage = await response.json();
        setMessages((prev) => [...prev, newMessage.data]);
        
        // Si la réponse contient une URL de redirection
        if (newMessage.redirectUrl) {
          showNotification({
            message: 'Message envoyé avec succès !',
            redirectUrl: newMessage.redirectUrl,
            action: newMessage.action,
            duration: 5000,
          });
        }
        
        scrollToBottom();
        return newMessage;
      }
    } catch (caught) {
      showNotification({
        message: messageOf(caught),
        duration: 5000,
      });
    } finally {
      setSending(false);
    }
  }, [selectedConversation, sending, request, scrollToBottom, showNotification]);

  // Faire défiler vers le bas
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Gérer les événements WebSocket
  useEffect(() => {
    if (!socket || !selectedConversation?.id) return;

    const handleNewMessage = (event) => {
      if (event.conversationId === selectedConversation.id) {
        setMessages((prev) => [...prev, event.message]);
        scrollToBottom();
        
        // Si le message contient une URL de redirection
        if (event.message.redirectUrl) {
          showNotification({
            message: 'Nouveau message reçu',
            redirectUrl: event.message.redirectUrl,
            action: event.message.action,
            duration: 5000,
          });
        }
      }
    };

    const handleTyping = (event) => {
      if (event.conversationId === selectedConversation.id) {
        setTypingUsers((prev) => ({
          ...prev,
          [event.userId]: event.isTyping,
        }));
      }
    };

    socket.on("message:new", handleNewMessage);
    socket.on("typing", handleTyping);

    return () => {
      socket.off("message:new", handleNewMessage);
      socket.off("typing", handleTyping);
    };
  }, [socket, selectedConversation, scrollToBottom, showNotification]);

  // Rejoindre la room de conversation via WebSocket
  useEffect(() => {
    if (!socket || !selectedConversation?.id || !isConnected) return;

    socket.emit("conversation:join", { conversationId: selectedConversation.id });

    return () => {
      if (socket && selectedConversation?.id) {
        socket.emit("conversation:leave", { conversationId: selectedConversation.id });
      }
    };
  }, [socket, selectedConversation?.id, isConnected]);

  // Faire défiler vers le bas quand les messages changent
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Gestion du clavier pour la recherche
  const handleKeyDown = useCallback((e) => {
    if (e.key === "Escape") {
      if (isExpanded) {
        onToggleExpand?.();
      } else if (isMinimized) {
        setIsMinimized(false);
      } else if (selectedConversation) {
        setSelectedConversation(null);
      } else {
        onToggleExpand?.();
      }
    }
  }, [isExpanded, isMinimized, selectedConversation, onToggleExpand]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Créer une nouvelle conversation
  const handleCreateConversation = useCallback((created) => {
    setSelectedConversation(created);
    
    showNotification({
      message: 'Conversation créée avec succès !',
      redirectUrl: `${window.location.origin}/dashboard/messages/${created.id}`,
      duration: 5000,
    });
  }, [showNotification]);

  // Basculer entre minimaliste et normal
  const toggleMinimized = useCallback(() => {
    setIsMinimized((prev) => !prev);
    if (isMinimized) {
      setShowSidebar(true);
    }
  }, [isMinimized]);

  // Basculer la sidebar (pour mobile)
  const toggleSidebar = useCallback(() => {
    setShowSidebar((prev) => !prev);
  }, []);

  // Afficher les utilisateurs qui tapent
  const typingText = Object.entries(typingUsers)
    .filter(([_, isTyping]) => isTyping)
    .map(([userId]) => {
      if (userId === user?.id) return null;
      if (selectedConversation?.participants) {
        const participant = selectedConversation.participants.find(p => p.userId === userId);
        if (participant) {
          return `${participant.firstName || ""} ${participant.lastName || ""}`.trim() || participant.email;
        }
      }
      return "Quelqu'un";
    })
    .filter(Boolean);

  // Déterminer la classe de taille en fonction du mode
  const getSizeClasses = () => {
    if (isExpanded) {
      return {
        container: "fixed inset-0 z-50",
        chat: "h-screen w-screen flex flex-col",
        sidebar: "w-80 flex-shrink-0",
        content: "flex-1 flex flex-col",
        header: "p-4 border-b border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)]",
        messages: "flex-1 overflow-y-auto p-4",
      };
    }

    if (isMinimized) {
      return {
        container: "fixed bottom-6 right-6 z-40",
        chat: "w-96 h-96 rounded-xl shadow-xl flex flex-col bg-[var(--comexa-surface-elevated)]",
        sidebar: "w-0 hidden",
        content: "flex-1 flex flex-col",
        header: "p-3 border-b border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)]",
        messages: "flex-1 overflow-y-auto p-3",
      };
    }

    return {
      container: "fixed bottom-6 right-6 z-40",
      chat: "w-[600px] h-[500px] rounded-xl shadow-xl flex flex-col bg-[var(--comexa-surface-elevated)]",
      sidebar: "w-80 flex-shrink-0 border-r border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)]",
      content: "flex-1 flex flex-col",
      header: "p-4 border-b border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)]",
      messages: "flex-1 overflow-y-auto p-4",
    };
  };

  const sizeClasses = getSizeClasses();

  // Si pas d'accès en lecture, ne rien afficher
  if (!canRead) {
    return null;
  }

  return (
    <>
      {/* Notification */}
      {NotificationComponent}

      {/* Overlay pour le mode plein écran */}
      {isExpanded && (
        <div
          className="fixed inset-0 bg-black bg-opacity-30 z-40"
          onClick={onToggleExpand}
        />
      )}

      <div
        className={`${sizeClasses.container}`}
        style={{
          boxShadow: isExpanded ? "none" : "var(--comexa-shadow-xl)",
        }}
      >
        <div
          className={`${sizeClasses.chat}`}
          style={{
            background: isExpanded ? "var(--comexa-bg)" : "var(--comexa-surface-elevated)",
          }}
        >
          {/* En-tête (mode plein écran ou normal) */}
          {(!isMinimized || isExpanded) && (
            <div className={sizeClasses.header}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {!isExpanded && (
                    <button
                      type="button"
                      onClick={toggleMinimized}
                      className="p-2 rounded-lg hover:bg-[var(--comexa-neutral-100)] transition-colors"
                      title={isMinimized ? "Agrandir" : "Réduire"}
                    >
                      <svg className="w-5 h-5 text-[var(--comexa-ink)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {isMinimized ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        )}
                      </svg>
                    </button>
                  )}
                  
                  {isExpanded && (
                    <button
                      type="button"
                      onClick={onToggleExpand}
                      className="p-2 rounded-lg hover:bg-[var(--comexa-neutral-100)] transition-colors"
                      title="Fermer"
                    >
                      <svg className="w-5 h-5 text-[var(--comexa-ink)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                  
                  {selectedConversation ? (
                    <>
                      {isExpanded && (
                        <h2 className="text-lg font-bold text-[var(--comexa-ink)]">Messagerie</h2>
                      )}
                    </>
                  ) : (
                    <h2 className="text-lg font-bold text-[var(--comexa-ink)]">
                      {isExpanded ? "Messagerie" : "Messages"}
                    </h2>
                  )}
                </div>

                {/* Statut de connexion */}
                {isExpanded && (
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isConnected ? "bg-[var(--comexa-success)]" : 
                        isConnecting ? "bg-[var(--comexa-warning)]" : 
                        "bg-[var(--comexa-error)]"
                      }`}
                    />
                    <span className="text-sm text-[var(--comexa-ink-muted)]">
                      {isConnected ? "Connecté" : isConnecting ? "Connexion..." : "Déconnecté"}
                    </span>
                  </div>
                )}
              </div>

              {/* En-tête de la conversation */}
              {selectedConversation && (
                <div className="flex items-center justify-between mt-4">
                  <div className="flex items-center gap-3">
                    {!isExpanded && !isMinimized && (
                      <button
                        type="button"
                        onClick={() => setSelectedConversation(null)}
                        className="p-2 rounded-lg hover:bg-[var(--comexa-neutral-100)] transition-colors lg:hidden"
                      >
                        <svg className="w-5 h-5 text-[var(--comexa-ink)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                    )}
                    
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[var(--comexa-blue-100)] flex items-center justify-center text-sm font-semibold text-[var(--comexa-blue-600)]">
                        {selectedConversation.isGroup
                          ? selectedConversation.groupName?.charAt(0).toUpperCase() || "G"
                          : selectedConversation.participants?.[0]?.firstName?.charAt(0).toUpperCase() || "U"
                        }
                      </div>
                      <div>
                        <h3 className="font-semibold text-[var(--comexa-ink)] truncate max-w-[200px]">
                          {selectedConversation.subject || selectedConversation.groupName || "Sans sujet"}
                        </h3>
                        {isExpanded && (
                          <p className="text-xs text-[var(--comexa-ink-muted)]">
                            {selectedConversation.isGroup
                              ? `${selectedConversation.participants?.length || 0} participants`
                              : selectedConversation.participants?.[0]?.email
                            }
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Indicateur de frappe */}
                    {typingText.length > 0 && (
                      <span className="text-sm text-[var(--comexa-blue-500)] italic">
                        {typingText.join(", ")} {typingText.length > 1 ? "tapent" : "tape"}...
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar - Liste des conversations */}
            {showSidebar && !isMinimized && (
              <div className={sizeClasses.sidebar}>
                <ChatSidebar
                  selectedConversationId={selectedConversation?.id}
                  onSelectConversation={loadConversation}
                  onCreateConversation={handleCreateConversation}
                  isExpanded={isExpanded}
                  onToggleSidebar={toggleSidebar}
                />
              </div>
            )}

            {/* Zone de chat */}
            <div className={sizeClasses.content}>
              {/* Bouton pour ouvrir la sidebar (mobile) */}
              {!showSidebar && !isExpanded && !isMinimized && (
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="p-2 m-2 rounded-lg bg-[var(--comexa-neutral-100)] hover:bg-[var(--comexa-neutral-200)] transition-colors lg:hidden"
                >
                  <svg className="w-5 h-5 text-[var(--comexa-ink)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              )}

              {/* Zone des messages */}
              <div
                ref={messagesContainerRef}
                className={sizeClasses.messages}
                style={{
                  backgroundImage: isExpanded ? "none" : 
                    "radial-gradient(circle at top left, var(--comexa-blue-50) 0%, transparent 30%), radial-gradient(circle at bottom right, var(--comexa-blue-50) 0%, transparent 30%)",
                }}
              >
                {!selectedConversation ? (
                  <div className="flex items-center justify-center h-full">
                    <Empty>
                      {isExpanded ? "Sélectionnez une conversation pour commencer à discuter." : "Pas de conversation sélectionnée"}
                    </Empty>
                  </div>
                ) : null}

                {loadingMessages && messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="animate-spin w-8 h-8 border-4 border-[var(--comexa-blue-500)] border-t-transparent rounded-full" />
                  </div>
                ) : null}

                {/* Messages plus anciens */}
                {hasMoreMessages && !isMinimized && (
                  <button
                    type="button"
                    onClick={loadOlderMessages}
                    disabled={loadingMessages}
                    className="mx-auto mb-4 px-4 py-2 text-sm text-[var(--comexa-blue-500)] bg-[var(--comexa-blue-50)] rounded-full hover:bg-[var(--comexa-blue-100)] transition-colors disabled:opacity-50"
                  >
                    {loadingMessages ? "Chargement..." : "Messages plus anciens"}
                  </button>
                )}

                {/* Liste des messages */}
                <div className="space-y-4">
                  {messages.map((message) => (
                    <ChatMessage
                      key={message.id}
                      message={message}
                      isCurrentUser={message.senderId === user?.id}
                      showAvatar={!isExpanded && !isMinimized}
                      showTimestamp={isExpanded}
                    />
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Input de message */}
              {selectedConversation && canWrite && (
                <ChatInput
                  conversationId={selectedConversation.id}
                  onSend={handleSend}
                  disabled={sending}
                  placeholder={isMinimized ? "Écrivez..." : "Écrivez un message..."}
                />
              )}

              {selectedConversation && !canWrite && (
                <div className="p-4 text-center text-sm text-[var(--comexa-ink-muted)]">
                  Votre rôle ne permet pas d'envoyer des messages.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bouton pour ouvrir le chat (mode réduit) */}
        {isMinimized && !isExpanded && (
          <button
            type="button"
            onClick={toggleMinimized}
            className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-[var(--comexa-blue-500)] text-white flex items-center justify-center shadow-lg hover:bg-[var(--comexa-blue-600)] transition-colors"
            title="Agrandir le chat"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* Bouton flottant pour ouvrir le chat (quand tout est fermé) */}
      {isMinimized && !isExpanded && !selectedConversation && (
        <button
          type="button"
          onClick={toggleMinimized}
          className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-[var(--comexa-blue-500)] to-[var(--comexa-blue-600)] text-white flex items-center justify-center shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-200"
          title="Ouvrir la messagerie"
          style={{
            boxShadow: "0 10px 40px -10px rgba(30, 134, 224, 0.4)",
          }}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          
          {/* Badge de notifications (à implémenter) */}
          {false && ( // Remplacer par le compte réel
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--comexa-error)] text-white text-xs rounded-full flex items-center justify-center">
              3
            </span>
          )}
        </button>
      )}
    </>
  );
}

/**
 * Composant Notice pour les erreurs
 */
function Notice({ tone = "info", text }) {
  const colors = {
    info: "bg-[var(--comexa-info-bg)] text-[var(--comexa-info)]",
    success: "bg-[var(--comexa-success-bg)] text-[var(--comexa-success)]",
    warning: "bg-[var(--comexa-warning-bg)] text-[var(--comexa-warning)]",
    error: "bg-[var(--comexa-error-bg)] text-[var(--comexa-error)]",
  };

  return (
    <div className={`px-4 py-2 rounded-lg ${colors[tone]}`}>
      {text}
    </div>
  );
}

export default ChatPanel;
