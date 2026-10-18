"use client";

import { useMemo } from "react";
import { FileText } from "lucide-react";
import { formatDate, formatTime } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { SharedResourceCard } from "./SharedResourceCard";
import { resourceKey } from "@/lib/chat-resources";

/**
 * Message du chat.
 *
 * Habillage : design system « soft UI pastel dans une coque noire » — mes
 * messages en bulle noire (l'accent unique de la charte), ceux des autres en
 * bulle blanche, les messages système en pilule jaune centrée.
 *
 * LES RESSOURCES PARTAGEES NE SONT PAS DU TEXTE. Le message ne transporte que
 * des couples (type, id) ; la carte, elle, se relit dans le perimetre du
 * LECTEUR (voir `SharedResourceCard`). Une bulle peut donc etre vide de texte
 * et pleine d'infos — un « partage pur » est un message à part entière.
 */
export function ChatMessage({
  message,
  isCurrentUser,
  showAvatar = false,
  showTimestamp = true,
  resourceViews = {},
  area = "team",
  onRetryResources,
}) {
  const { user } = useAuth();
  const userId = user?.id;
  const isMine = isCurrentUser || message.senderId === userId;

  // Déterminer le type de message
  const isSystem = message.type === "SYSTEM";
  const isDeleted = message.deletedAt;

  const sharedResources = message.sharedResources ?? [];
  const hasBody = typeof message.body === "string" && message.body.trim().length > 0;

  // Formatage de la date
  const formattedDate = useMemo(() => {
    if (!message.createdAt) return "";
    const now = new Date();
    const msgDate = new Date(message.createdAt);

    // Si c'est aujourd'hui, afficher juste l'heure
    if (msgDate.toDateString() === now.toDateString()) {
      return formatTime(msgDate);
    }

    // Si c'était hier
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (msgDate.toDateString() === yesterday.toDateString()) {
      return `Hier à ${formatTime(msgDate)}`;
    }

    // Sinon, afficher la date complète
    return formatDate(msgDate);
  }, [message.createdAt]);

  // Nom de l'expéditeur
  const senderName = useMemo(() => {
    if (isSystem) return "Système";
    if (isMine) return "Vous";
    if (message.sender) {
      return `${message.sender.firstName || ""} ${message.sender.lastName || ""}`.trim() ||
             message.sender.email || "Inconnu";
    }
    return "Inconnu";
  }, [isMine, isSystem, message.sender]);

  if (isSystem) {
    return (
      <div className="sui-chat__msg" data-message-id={message.id}>
        <div className="sui-chat__bubble sui-chat__bubble--system">{message.body}</div>
      </div>
    );
  }

  return (
    <div
      className={`sui-chat__msg ${isMine ? "sui-chat__msg--mine" : "sui-chat__msg--other"}`}
      data-message-id={message.id}
    >
      {showAvatar && !isMine ? (
        <span className="sui-chat__avatar" aria-hidden="true">
          {senderName.charAt(0).toUpperCase()}
        </span>
      ) : null}

      <div className="sui-chat__stack">
        {showTimestamp ? (
          <div className="sui-chat__sender">
            {senderName} · {formattedDate}
          </div>
        ) : null}

        <div className={`sui-chat__bubble${isDeleted ? " sui-chat__bubble--deleted" : ""}`}>
          {isDeleted ? (
            <em>Message supprimé</em>
          ) : (
            <>
              {hasBody ? message.body : null}

              {/* Pieces jointes : l'API renvoie les documents lies au message. */}
              {message.attachments?.length > 0 ? (
                <div className={`sui-chat__cards${hasBody ? "" : " sui-chat__cards--alone"}`}>
                  {message.attachments.map((attachment) => (
                    <DocumentPreview key={attachment.documentId ?? attachment.id} attachment={attachment} />
                  ))}
                </div>
              ) : null}

              {/* Ressources partagees : cartes vivantes, relues a l'affichage. */}
              {sharedResources.length > 0 ? (
                <div className={`sui-chat__cards${hasBody ? "" : " sui-chat__cards--alone"}`}>
                  {sharedResources.map((resource) => (
                    <SharedResourceCard
                      key={resource.id ?? resourceKey(resource)}
                      resource={resource}
                      view={resourceViews[resourceKey(resource)]}
                      area={area}
                      onRetry={onRetryResources}
                    />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Statut de lecture (pour les messages envoyes) */}
        {isMine && message.readReceipts?.length > 0 ? (
          <p className="sui-chat__preview" style={{ textAlign: "right" }}>
            Lu par {message.readReceipts.length}
          </p>
        ) : null}
      </div>

      {showAvatar && isMine ? (
        <span className="sui-chat__avatar" aria-hidden="true">
          {senderName.charAt(0).toUpperCase()}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Aperçu d'une pièce jointe (document lié au message).
 */
function DocumentPreview({ attachment }) {
  const document = attachment?.document;
  const name = document?.name ?? "Document";
  const size = Number.isFinite(document?.sizeBytes) ? `${Math.round(document.sizeBytes / 1024)} Ko` : null;

  return (
    <div className="sui-chat__attachment">
      <span className="sui-chat__ref-icon" data-tone="plain" aria-hidden="true">
        <FileText size={16} strokeWidth={1.9} />
      </span>
      <div className="sui-chat__attachment__body">
        <strong>{name}</strong>
        {document?.mimeType || size ? (
          <span>{[document?.mimeType, size].filter(Boolean).join(" · ")}</span>
        ) : null}
      </div>
    </div>
  );
}

export default ChatMessage;
