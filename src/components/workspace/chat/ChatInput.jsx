"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { useActionNotification } from "@/components/workspace/ui/ActionNotification";

/**
 * Composant d'entrée pour le chat
 * Fonctionnalités:
 * - Champ de texte avec auto-grow
 * - Envoi par Enter ou bouton
 * - Indication de frappe (typing)
 * - Support pour les pièces jointes
 * - Emojis (optionnel)
 * - Design épuré avec aesthetic Comexa
 */
export function ChatInput({
  conversationId,
  onSend,
  onTyping,
  disabled = false,
  placeholder = "Écrivez un message...",
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
    return (
      <div className="p-4 text-center text-[var(--comexa-ink-muted)] text-sm">
        Votre rôle ne permet pas d&apos;envoyer des messages.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 border-t border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)]">
      {/* Zone de saisie */}
      <div className="relative flex items-end gap-3">
        {/* Bouton pour les pièces jointes (optionnel) */}
        <button
          type="button"
          className="p-2 rounded-lg text-[var(--comexa-ink-muted)] hover:bg-[var(--comexa-neutral-100)] hover:text-[var(--comexa-ink)] transition-colors disabled:opacity-50"
          disabled={disabled || isSending}
          title="Joindre un fichier"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>

        {/* Champ de texte */}
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
          className="flex-1 min-h-[44px] max-h-[150px] resize-none bg-[var(--comexa-neutral-50)] rounded-xl px-4 py-3 text-[var(--comexa-ink)] placeholder:text-[var(--comexa-ink-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--comexa-blue-500)] focus:ring-offset-0 transition-all"
          style={{
            boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.05)",
          }}
        />

        {/* Bouton d'envoi */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!content.trim() || isSending || disabled}
          className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--comexa-blue-500)] text-white flex items-center justify-center hover:bg-[var(--comexa-blue-600)] disabled:bg-[var(--comexa-neutral-300)] disabled:cursor-not-allowed transition-colors"
          title="Envoyer"
        >
          {isSending ? (
            <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          )}
        </button>
      </div>

      {/* Indicateur de limite */}
      {content.length > maxLength * 0.8 && (
        <div className="flex justify-end text-xs text-[var(--comexa-ink-muted)]">
          {content.length}/{maxLength}
        </div>
      )}

      {/* Message d'aide */}
      <div className="text-xs text-[var(--comexa-ink-subtle)] text-center">
        Appuyez sur Entrée pour envoyer · Shift + Entrée pour un saut de ligne
      </div>
    </div>
  );
}

export default ChatInput;
