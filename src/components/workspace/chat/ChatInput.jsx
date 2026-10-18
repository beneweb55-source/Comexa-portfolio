"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { SendHorizontal } from "lucide-react";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { useActionNotification } from "@/components/workspace/ui/ActionNotification";

/**
 * Zone de saisie du chat.
 *
 * Fonctionnalités:
 * - Champ de texte avec auto-grow
 * - Envoi par Enter ou bouton
 * - Indication de frappe (typing)
 * - Design system « soft UI pastel dans une coque noire » : champ sur fond de
 *   panneau, bouton d'envoi noir (l'accent unique de la charte).
 */
export function ChatInput({
  conversationId,
  onSend,
  onTyping,
  disabled = false,
  placeholder = "Écrivez un message…",
  maxLength = 10000,
}) {
  const { user } = useAuth();
  const [content, setContent] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const { showNotification } = useActionNotification();

  const canWrite = can(user, "message:write:own");

  // Auto-grow du textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [content]);

  // Gestion de l'indicateur de frappe
  //
  // L'indicateur est annonce AU SERVEUR, qui le relaie aux autres
  // participants de la conversation. Il se referme tout seul : sans cela,
  // l'indicateur resterait allume chez le destinataire si l'expediteur
  // s'arretait de taper sans envoyer.
  const handleTyping = useCallback(
    (value) => {
      const isNowTyping = value.length > 0;

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }

      if (isNowTyping !== isTyping) {
        setIsTyping(isNowTyping);
        onTyping?.(isNowTyping);
      }

      if (isNowTyping) {
        typingTimeoutRef.current = setTimeout(() => {
          typingTimeoutRef.current = null;
          setIsTyping(false);
          onTyping?.(false);
        }, 3000);
      }
    },
    [isTyping, onTyping],
  );

  // Nettoyage du timeout
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      // On previent le serveur qu'on ne tape plus : l'indicateur ne doit pas
      // rester allume chez les autres apres avoir quitté la conversation.
      onTyping?.(false);
    };
  }, [onTyping]);

  // Gestion de l'envoi avec notification
  const handleSend = async () => {
    if (!content.trim() || isSending || disabled || !canWrite) return;

    setIsSending(true);
    setIsTyping(false);
    onTyping?.(false);

    try {
      await onSend(content.trim());
      setContent("");
    } catch (error) {
      showNotification({
        message: "Erreur lors de l'envoi du message",
        duration: 5000,
      });
    } finally {
      setIsSending(false);
    }
  };

  // Gestion du clavier
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Gestion du collage
  const handlePaste = (e) => {
    const pastedText = e.clipboardData.getData("text/plain");
    const newContent = content + pastedText;

    if (newContent.length > maxLength) {
      e.preventDefault();
      const remaining = maxLength - content.length;
      const truncated = pastedText.substring(0, remaining);
      setContent(content + truncated);
    }
  };

  if (!canWrite) {
    return <p className="sui-chat__hint">Votre rôle ne permet pas d’envoyer des messages.</p>;
  }

  return (
    <>
      <div className="sui-chat__composer">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            handleTyping(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled || isSending}
          rows={1}
          className="sui-input"
          aria-label="Écrire un message"
        />

        <button
          type="button"
          onClick={handleSend}
          disabled={!content.trim() || isSending || disabled}
          className="sui-iconbtn"
          style={{ background: "var(--shell)", color: "#ffffff", width: 46, height: 46 }}
          title="Envoyer"
          aria-label="Envoyer le message"
        >
          {isSending ? (
            <span className="sui-spin" aria-hidden="true">
              <SendHorizontal size={19} strokeWidth={1.9} />
            </span>
          ) : (
            <SendHorizontal size={19} strokeWidth={1.9} aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Indicateur de limite et rappel clavier */}
      {content.length > maxLength * 0.8 ? (
        <p className="sui-chat__hint" style={{ textAlign: "right" }}>
          {content.length}/{maxLength}
        </p>
      ) : null}
      <p className="sui-chat__hint">Entrée pour envoyer · Maj + Entrée pour un saut de ligne</p>
    </>
  );
}

export default ChatInput;
