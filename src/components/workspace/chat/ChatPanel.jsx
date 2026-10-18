"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, MessageCircle, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { messageOf } from "@/lib/api";
import useSocketIO from "@/lib/hooks/useWebSocket";
import { ChatSidebar } from "./ChatSidebar";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { conversationTitle, isGroupConversation, participantName } from "@/lib/conversation-labels";
import { appendUnique, messagesFromPage } from "@/lib/chat-messages";
import { Empty } from "@/components/workspace/ui";
import { useActionNotification } from "@/components/workspace/ui/ActionNotification";
import { hasTeamAccess } from "@/lib/access";
import { spaceForPath } from "@/lib/spaces";
import {
  extractResourceRefs,
  invalidateResourceKeys,
  resolveResourceRefs,
} from "./resource-resolver";

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
  variant = "floating",
  initialConversationId = null,
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

  // WebSocket
  const { socket, isConnected, isConnecting, error: wsError } = useSocketIO();

  // Notifications
  const { showNotification, NotificationComponent } = useActionNotification();

  const canWrite = can(user, "message:write:own");
  const canRead = can(user, "conversation:read:own");
  // Espace courant : c'est lui qui decide OU mene le clic sur une carte
  // (l'equipe ouvre la fiche d'equipe, le client son portail, le membre sa
  // liste personnelle). Meme convention que les notifications.
  const pathname = usePathname();
  const area = hasTeamAccess(user) ? (spaceForPath(pathname) ?? "team") : "client";
  // Mode « page » : la messagerie remplit la rubrique au lieu de flotter.
  const pageMode = variant === "page";

  // Charger une conversation
  const loadConversation = useCallback(async (conversationId) => {
    if (!conversationId || !canRead) return;

    setLoadingMessages(true);
    setMessages([]);
    setNextCursor(null);
    conversationIdRef.current = conversationId;

    try {
      const [{ data: conversation }, page] = await Promise.all([
        request(`/conversations/${conversationId}`),
        request(`/conversations/${conversationId}/messages?perPage=50`),
      ]);

      setSelectedConversation(conversation);
      // L'API renvoie les messages du plus recent au plus ancien : le helper
      // les remet dans l'ordre de lecture (du plus ancien en haut).
      setMessages(messagesFromPage(page));
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

      setMessages((prev) => [...messagesFromPage(page), ...prev]);
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

  // Faire défiler vers le bas
  // ATTENTION A L'ORDRE : ce callback est APPele par `handleSend` et listé dans
  // ses dependances. Le declarer APRÈS `handleSend` le faisait lire dans la
  // zone morte temporelle (TDZ) — la page de messagerie plantait au premier
  // rendu, avant meme l'affichage des conversations.
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Ajouter un message SANS le dupliquer.
  //
  // Un message ecrit par CE poste peut arriver deux fois : par la reponse de
  // l'API, et par le WebSocket — l'emetteur fait partie de la room de sa
  // conversation. Sans deduplication, la bulle s'affiche en double.
  const appendMessage = useCallback((message) => {
    setMessages((prev) => appendUnique(prev, message));
  }, []);

  /* --- Cartes de ressources partagees ------------------------------------
     Le fil ne contient que des (type, id). Les cartes se rechargent ici, en
     un lot par vue de fil, dans le PERIMETRE DU LECTEUR : deux membres de la
     meme conversation ne voient pas la meme carte si l'un n'a pas acces a la
     ressource. L'effet se re-declenche a chaque ajout de message — les refs
     deja connues sont servies par le cache du resolver, la liste "manquante"
     est vide, aucune requete ne part. ------------------------------------ */
  const [resourceViews, setResourceViews] = useState({});
  const conversationIdRef = useRef(null);

  useEffect(() => {
    // Le resolver repond immediatement (microtask) quand tout est en cache, y
    // compris « rien a resoudre » : un fil sans partage rend `{}` et remplace
    // ainsi les vues de la conversation precedente, sans setState synchrone.
    const refs = extractResourceRefs(messages);
    let cancelled = false;
    resolveResourceRefs(request, refs).then((views) => {
      if (!cancelled) setResourceViews(views);
    });
    return () => {
      cancelled = true;
    };
  }, [messages, request]);

  const retryResourceViews = useCallback(() => {
    const refs = extractResourceRefs(messages);
    if (refs.length === 0) return;
    invalidateResourceKeys(refs.map((ref) => `${ref.resourceType}:${ref.resourceId}`));
    resolveResourceRefs(request, refs).then(setResourceViews);
  }, [messages, request]);

  // Envoyer un message — avec, si l'utilisateur en a joints, les ressources
  // partagees sous forme de couples (type, id). Pas d'URL, pas de copie : la
  // carte se relit a l'affichage dans le perimetre de CHAQUE lecteur.
  const handleSend = useCallback(async (content, sharedResources = []) => {
    if (!selectedConversation?.id || sending) return null;
    if (!content.trim() && sharedResources.length === 0) return null;

    setSending(true);

    try {
      // `request` renvoie `{ data, meta }` : la reponse n'a pas de `.ok` ni de
      // `.json()`. Et le corps se donne en OBJET — `apiFetch` le serialise.
      const { data: message } = await request(
        `/conversations/${selectedConversation.id}/messages`,
        {
          method: "POST",
          body: {
            body: content,
            ...(sharedResources.length > 0
              ? { sharedResources: sharedResources.map((r) => ({ resourceType: r.resourceType, resourceId: r.resourceId })) }
              : {}),
          },
        },
      );

      appendMessage(message);
      scrollToBottom();
      return message;
    } catch (caught) {
      showNotification({
        message: messageOf(caught),
        duration: 5000,
      });
      return null;
    } finally {
      setSending(false);
    }
  }, [selectedConversation, sending, request, scrollToBottom, showNotification, appendMessage]);

  // Gérer les événements WebSocket
  useEffect(() => {
    if (!socket || !selectedConversation?.id) return;

    const handleNewMessage = (event) => {
      if (event.conversationId === selectedConversation.id) {
        // `appendMessage` ignore un message deja present : l'expediteur
        // recoit son propre message par le WebSocket ET par l'API.
        appendMessage(event.message);
        scrollToBottom();
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
  }, [socket, selectedConversation, scrollToBottom, appendMessage]);

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

  // LIEN PROFOND : ouvrir la conversation demandée dans l'URL.
  //
  // `?conversation=<id>` est ce que le serveur propose après une action
  // (`buildResponse` → `conversation(id)`), et c'est aussi ce qu'une
  // notification peut porter. Sans cet effet, arriver sur
  // `/espace-equipe/messagerie?conversation=x` affichait la messagerie sans
  // sélectionner x : le lien était suivi, puis ignoré.
  //
  // L'effet ne se déclenche qu'au changement d'identifiant, pas à chaque rendu
  // (une frappe au clavier ne rouvre donc pas la conversation), et il laisse la
  // main à l'utilisateur ensuite : changer de conversation met `selected` sur
  // une autre, ce qui ne relance rien.
  useEffect(() => {
    if (!initialConversationId || !canRead) return;
    if (selectedConversation?.id === initialConversationId) return;
    // `loadConversation` pose son propre état de chargement AVANT le premier
    // `await`, ce que la règle `set-state-in-effect` signale. C'est ici le
    // comportement voulu : l'écran doit montrer qu'il charge la conversation
    // demandée, pas la précédente. Le désactiver sur cette seule ligne, avec la
    // raison, vaut mieux que recopier la fonction juste pour l'effet.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversation(initialConversationId);
    // `loadConversation` est stable (useCallback) ; le reprendre ici
    // rechargerait la conversation à chaque rendu du parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId, canRead, selectedConversation?.id]);

  // Gestion du clavier pour la recherche
  const handleKeyDown = useCallback((e) => {
    // Le mode concentration est modalement sus : ses raccourcis gardent la
    // main, et un Echap double qui refermait la messagerie derriere l'ecran
    // de session etait un bug, pas une economie de code.
    if (document.querySelector(".sui-focus")) return;
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
    // La conversation creee est directement affichee : pas de renvoi vers une
    // URL de messagerie qui n'existe pas sur ce site.
    setSelectedConversation(created);
    showNotification({
      message: "Conversation creee.",
      duration: 4000,
    });
  }, [showNotification]);

  // Indicateur de frappe : le serveur le relaie aux participants de la room.
  const notifyTyping = useCallback(
    (isTyping) => {
      if (!socket || !selectedConversation?.id) return;
      socket.emit("typing", { conversationId: selectedConversation.id, isTyping });
    },
    [socket, selectedConversation],
  );

  // Basculer entre minimaliste et normal
  const toggleMinimized = useCallback(() => {
    setIsMinimized((prev) => !prev);
    if (isMinimized) {
      setShowSidebar(true);
    }
  }, [isMinimized]);

  // Afficher les utilisateurs qui tapent
  const typingText = Object.entries(typingUsers)
    .filter(([_, isTyping]) => isTyping)
    .map(([userId]) => {
      if (userId === user?.id) return null;
      if (selectedConversation?.participants) {
        const participant = selectedConversation.participants.find((p) => p.userId === userId);
        if (participant) {
          return participantName(participant) || "Quelqu'un";
        }
      }
      return "Quelqu'un";
    })
    .filter(Boolean);

  /* Gabarit du panneau selon le mode :
     - `page` : la messagerie remplit la rubrique (c'est le mode de `/messagerie`) ;
     - `overlay` : plein écran, par-dessus la coque ;
     - `pill` / `float` : la pastille et la fenêtre flottantes, pour un chat
       qu'on survole sans quitter sa page. */
  const modeClass = pageMode
    ? "sui-chat--page"
    : isExpanded
      ? "sui-chat--overlay"
      : isMinimized
        ? "sui-chat--pill"
        : "sui-chat--float";

  // Sur petit écran, en mode page, la liste et le fil ne se partagent pas la
  // place : on affiche l'un ou l'autre.
  const asideHidden = pageMode && selectedConversation ? "sui-chat__aside--hidden" : "";
  const mainHidden = pageMode && !selectedConversation ? "sui-chat__main--hidden" : "";

  // Si pas d'accès en lecture, ne rien afficher
  if (!canRead) {
    return null;
  }

  return (
    <>
      {/* Notification */}
      {NotificationComponent}

      {/* Overlay pour le mode plein écran */}
      {isExpanded ? (
        <div className="sui-dialog-backdrop" role="presentation" onClick={onToggleExpand} />
      ) : null}

      <div className={`sui-chat__host ${modeClass}`}>
        <div className="sui-chat">
          {/* En-tête du panneau */}
          {!isMinimized || isExpanded ? (
            <div className="sui-chat__head">
              <div className="flex items-center gap-2">
                {!isExpanded && !pageMode ? (
                  <button
                    type="button"
                    onClick={toggleMinimized}
                    className="sui-iconbtn sui-iconbtn--ghost"
                    title={isMinimized ? "Agrandir" : "Réduire"}
                    aria-label={isMinimized ? "Agrandir la messagerie" : "Réduire la messagerie"}
                  >
                    <ChevronLeft size={18} strokeWidth={1.9} aria-hidden="true" />
                  </button>
                ) : null}

                {isExpanded ? (
                  <button
                    type="button"
                    onClick={onToggleExpand}
                    className="sui-iconbtn sui-iconbtn--ghost"
                    title="Fermer"
                    aria-label="Fermer la messagerie"
                  >
                    <X size={18} strokeWidth={1.9} aria-hidden="true" />
                  </button>
                ) : null}

                {/* L'empreinte Comexa sur la messagerie : la marque officielle
                    (le « singe » du logo, `app/icon.svg`) en guise d'avatar du
                    service — pas un logo re-dessine, le meme fichier que le
                    favicon, donc net a toute taille. */}
                <span className="sui-chat__brand" aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icon.svg" alt="" width={26} height={26} draggable="false" />
                </span>
                <h2 className="sui-section__title">Messagerie</h2>
              </div>

              {/* État de la connexion temps réel */}
              <span className="sui-chat__live">
                <i className={`sui-chat__dot${isConnected ? "" : " sui-chat__dot--off"}`} aria-hidden="true" />
                {isConnected ? "Connecté" : isConnecting ? "Connexion…" : "Hors ligne"}
              </span>
            </div>
          ) : null}

          {/* En-tête de la conversation ouverte */}
          {selectedConversation ? (
            <div className="sui-chat__head">
              <div className="flex items-center gap-3">
                {!isExpanded && !isMinimized ? (
                  <button
                    type="button"
                    onClick={() => setSelectedConversation(null)}
                    className="sui-iconbtn sui-iconbtn--ghost md:hidden"
                    title="Revenir aux conversations"
                    aria-label="Revenir à la liste des conversations"
                  >
                    <ChevronLeft size={18} strokeWidth={1.9} aria-hidden="true" />
                  </button>
                ) : null}

                <span className="sui-chat__avatar" aria-hidden="true">
                  {conversationTitle(selectedConversation, user?.id).charAt(0).toUpperCase() || "U"}
                </span>
                <div className="min-w-0">
                  <h3 className="sui-chat__title">
                    {conversationTitle(selectedConversation, user?.id)}
                  </h3>
                  <p className="sui-chat__preview">
                    {isGroupConversation(selectedConversation)
                      ? `${selectedConversation.participants?.length || 0} participants`
                      : (selectedConversation.participants ?? [])
                          .filter((participant) => participant.userId !== user?.id)
                          .map((participant) => participant.email)
                          .join(", ")}
                  </p>
                </div>
              </div>

              {/* Indicateur de frappe */}
              {typingText.length > 0 ? (
                <span className="sui-chat__typing" aria-live="polite">
                  <i aria-hidden="true" />
                  <i aria-hidden="true" />
                  <i aria-hidden="true" />
                  {typingText.join(", ")} {typingText.length > 1 ? "tapent" : "tape"}…
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="sui-chat__body">
            {/* Colonne des conversations */}
            {showSidebar && !isMinimized ? (
              <ChatSidebar
                className={asideHidden}
                selectedConversationId={selectedConversation?.id}
                onSelectConversation={loadConversation}
                onCreateConversation={handleCreateConversation}
              />
            ) : null}

            {/* Fil de discussion */}
            <div className={`sui-chat__main ${mainHidden}`.trim()}>
              <div className="sui-chat__thread">
                {!selectedConversation ? (
                  <Empty>Sélectionnez une conversation pour commencer à discuter.</Empty>
                ) : null}

                {loadingMessages && messages.length === 0 ? (
                  <p className="sui-card__desc" style={{ margin: "auto" }}>
                    Chargement des messages…
                  </p>
                ) : null}

                {/* Messages plus anciens */}
                {hasMoreMessages && !isMinimized ? (
                  <button
                    type="button"
                    onClick={loadOlderMessages}
                    disabled={loadingMessages}
                    className="sui-btn sui-btn--sm"
                    style={{ alignSelf: "center" }}
                  >
                    {loadingMessages ? "Chargement…" : "Messages plus anciens"}
                  </button>
                ) : null}

                {/* Liste des messages */}
                {messages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    isCurrentUser={message.senderId === user?.id}
                    showAvatar={!isExpanded && !isMinimized}
                    showTimestamp={isExpanded}
                    resourceViews={resourceViews}
                    area={area}
                    onRetryResources={retryResourceViews}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Zone de saisie */}
              {selectedConversation && canWrite ? (
                <ChatInput
                  conversationId={selectedConversation.id}
                  onSend={handleSend}
                  onTyping={notifyTyping}
                  disabled={sending}
                />
              ) : null}
            </div>
          </div>
        </div>

        {/* Bouton pour ouvrir le chat (mode réduit) */}
        {isMinimized && !isExpanded && !pageMode ? (
          <button
            type="button"
            onClick={toggleMinimized}
            className="sui-iconbtn"
            style={{
              position: "absolute",
              top: -12,
              right: -12,
              background: "var(--shell)",
              color: "#ffffff",
              boxShadow: "var(--shadow-pop)",
            }}
            title="Agrandir le chat"
            aria-label="Agrandir le chat"
          >
            <ChevronLeft size={18} strokeWidth={1.9} style={{ transform: "rotate(180deg)" }} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* Pastille flottante : le chat est réduit et aucune conversation n'est ouverte */}
      {isMinimized && !isExpanded && !pageMode && !selectedConversation ? (
        <button
          type="button"
          onClick={toggleMinimized}
          className="sui-chat__fab"
          title="Ouvrir la messagerie"
          aria-label="Ouvrir la messagerie"
        >
          <MessageCircle size={22} strokeWidth={1.9} aria-hidden="true" />
        </button>
      ) : null}
    </>
  );
}

export default ChatPanel;
