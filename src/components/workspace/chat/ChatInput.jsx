"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Check, Paperclip, SendHorizontal, X } from "lucide-react";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { useActionNotification } from "@/components/workspace/ui/ActionNotification";
import { SharedResourcePicker } from "./SharedResourcePicker";
import { resourceKey, resourceTypeLabel } from "@/lib/chat-resources";

/**
 * ZONE DE SAISIE DU CHAT — le composeur, et la porte vers Comexa.
 *
 * DEUX GESTES, UNE SEULE LIGNE. Le texte se tape dans le champ ; les contenus
 * de la plateforme se joignent par le trombone, qui ouvre le picker SANS
 * quitter la conversation. Une piece jointe metier n'est pas un lien colle :
 * le message ne part qu'avec des couples (type, id) — la carte, le statut et
 * le droit de lecture se rechargent a l'affichage.
 *
 * CE QUI PART EST VU AVANT L'ENVOI. Les ressources selectionnees s'empilent en
 * puces au-dessus du champ : libelle, type, et un `X` par puce. On sait
 * exactement ce que l'on va partager avant d'appuyer sur Entree — c'est la
 * moitie du travail d'un canal d'equipe.
 *
 * CLAVIER : Entree envoie, Maj+Entree retourne a la ligne, Echap ferme le
 * picker et lui rend la main. `isComposing` evite d'envoyer en pleine saisie
 * d'un caractere accentue.
 */
export function ChatInput({
  conversationId,
  onSend,
  onTyping,
  disabled = false,
  placeholder = "Écrivez un message ou joignez une ressource…",
  maxLength = 10000,
}) {
  const { user } = useAuth();
  const [content, setContent] = useState("");
  const [staged, setStaged] = useState([]); // [{resourceType, resourceId, title}]
  const [isTyping, setIsTyping] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const { showNotification } = useActionNotification();

  const canWrite = can(user, "message:write:own");
  // Le trombone ne se montre que si quelque chose est joignable : sans aucun
  // droit de lecture sur une ressource, le picker serait une porte decorative.
  const hasShareableSources = can(user, "project:read:any") || can(user, "project:read:assigned") || can(user, "project:read:own")
    || can(user, "task:read:any") || can(user, "task:read:assigned") || can(user, "task:read:own") || can(user, "task:read:personal")
    || can(user, "client:read:any")
    || can(user, "quote:read:any") || can(user, "quote:read:own")
    || can(user, "invoice:read:any") || can(user, "invoice:read:own")
    || can(user, "document:read:any") || can(user, "document:read:own") || can(user, "document:read:client");

  // Auto-grow du textarea.
  useEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 150)}px`;
  }, [content]);

  // Gestion de l'indicateur de frappe, annonce AU SERVEUR qui le relaie aux
  // autres participants. Il se referme tout seul : sans cela, il resterait
  // allume chez le destinataire si l'expediteur s'arretait de taper.
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

  // Nettoyage du timeout.
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      // On previent le serveur qu'on ne tape plus : l'indicateur ne doit pas
      // rester allume chez les autres apres avoir quitte la conversation.
      onTyping?.(false);
    };
  }, [onTyping]);

  const canSend = (content.trim().length > 0 || staged.length > 0) && !isSending && !disabled;

  // Gestion de l'envoi, avec les ressources jointes.
  const handleSend = async () => {
    if (!canSend || !canWrite) return;

    setIsSending(true);
    setIsTyping(false);
    onTyping?.(false);

    try {
      // Corps vide + ressources : le service autorise (message « partage pur »)
      // et l'apercu de liste est reconstruit par le serveur.
      const refs = staged.map((item) => ({ resourceType: item.resourceType, resourceId: item.resourceId }));
      await onSend(content.trim(), refs);
      setContent("");
      setStaged([]);
      setPickerOpen(false);
      textareaRef.current?.focus();
    } catch (error) {
      showNotification({
        message: "Erreur lors de l'envoi du message",
        duration: 5000,
      });
    } finally {
      setIsSending(false);
    }
  };

  // Gestion du clavier — dans l'ordre : le picker a la priorite sur l'envoi.
  const handleKeyDown = (event) => {
    if (event.key === "Escape" && pickerOpen) {
      event.preventDefault();
      setPickerOpen(false);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing) {
      event.preventDefault();
      handleSend();
    }
  };

  // Gestion du collage.
  const handlePaste = (event) => {
    const pastedText = event.clipboardData.getData("text/plain");
    const newContent = content + pastedText;

    if (newContent.length > maxLength) {
      event.preventDefault();
      const remaining = maxLength - content.length;
      setContent(content + pastedText.substring(0, remaining));
    }
  };

  // Le picker ajoute OU retire : la meme action dans les deux sens, un seul
  // geste a reapprendre. La limite est celle du serveur (10 par message) ; la
  // refuser ici plutot qu'a l'envoi evite une deception en fin de geste.
  const MAX_STAGED = 10;
  const toggleStaged = (item) => {
    setStaged((current) => {
      const key = resourceKey(item);
      const existing = current.find((ref) => resourceKey(ref) === key);
      if (existing) return current.filter((ref) => resourceKey(ref) !== key);
      if (current.length >= MAX_STAGED) {
        showNotification({ message: `Jusqu'à ${MAX_STAGED} ressources par message.`, duration: 4000 });
        return current;
      }
      return [...current, item];
    });
  };

  if (!canWrite) {
    return <p className="sui-chat__hint">Votre rôle ne permet pas d’envoyer des messages.</p>;
  }

  return (
    <div className="sui-chat__composer-shell">
      {/* Picker : popover au-dessus du composeur, ancre a la colonne. */}
      {hasShareableSources && pickerOpen ? (
        <>
          <div className="sui-res-picker__scrim" onClick={() => setPickerOpen(false)} role="presentation" />
          <SharedResourcePicker
            open={pickerOpen}
            onClose={() => {
              setPickerOpen(false);
              textareaRef.current?.focus();
            }}
            selected={staged}
            onToggle={toggleStaged}
          />
        </>
      ) : null}

      {/* Aperçu avant envoi : ce qui partira avec le message. */}
      {staged.length > 0 ? (
        <div className="sui-chat__staged" aria-label="Ressources jointes au message">
          {staged.map((item) => (
            <span key={resourceKey(item)} className="sui-chat__ref-chip">
              <Check size={12} strokeWidth={2.6} aria-hidden="true" />
              <span className="sui-chat__ref-chip__type">{resourceTypeLabel(item.resourceType)}</span>
              <strong title={item.title ?? ""}>{item.title ?? item.resourceId}</strong>
              <button
                type="button"
                className="sui-chat__ref-chip__remove"
                onClick={() => toggleStaged(item)}
                aria-label={`Retirer ${item.title ?? resourceTypeLabel(item.resourceType)}`}
              >
                <X size={12} strokeWidth={2.4} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="sui-chat__composer">
        {hasShareableSources ? (
          <button
            type="button"
            className={`sui-iconbtn sui-chat__attach${pickerOpen ? " is-active" : ""}`}
            onClick={() => setPickerOpen((value) => !value)}
            aria-expanded={pickerOpen}
            title="Joindre un projet, une tâche, un client, une facture…"
            aria-label="Joindre une ressource Comexa"
          >
            <Paperclip size={18} strokeWidth={1.9} aria-hidden="true" />
          </button>
        ) : null}

        <textarea
          ref={textareaRef}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            handleTyping(event.target.value);
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
          disabled={!canSend}
          className="sui-iconbtn sui-chat__send"
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

      {/* Indicateur de limite et rappel clavier. */}
      {content.length > maxLength * 0.8 ? (
        <p className="sui-chat__hint" style={{ textAlign: "right" }}>
          {content.length}/{maxLength}
        </p>
      ) : null}
      <p className="sui-chat__hint">
        Entrée pour envoyer · Maj + Entrée pour un saut de ligne
        {hasShareableSources ? " · 📎 pour joindre un contenu de Comexa" : ""}
      </p>
    </div>
  );
}

export default ChatInput;
