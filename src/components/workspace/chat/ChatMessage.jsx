"use client";

import { useMemo } from "react";
import { formatDate, formatTime } from "@/lib/api";
import { useAuth } from "@/lib/session";

/**
 * Message du chat.
 *
 * Habillage : design system « soft UI pastel dans une coque noire » — mes
 * messages en bulle noire (l'accent unique de la charte), ceux des autres en
 * bulle blanche, les messages système en pilule jaune centrée.
 */
export function ChatMessage({
  message,
  isCurrentUser,
  showAvatar = false,
  showTimestamp = true,
  onReact,
}) {
  const { user } = useAuth();
  const userId = user?.id;
  const isMine = isCurrentUser || message.senderId === userId;

  // Déterminer le type de message
  const isSystem = message.type === "SYSTEM";
  const isDeleted = message.deletedAt;

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
              {message.body}

              {/* Pieces jointes : l'API renvoie les documents lies au message. */}
              {message.attachments?.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {message.attachments.map((attachment) => (
                    <DocumentPreview key={attachment.documentId ?? attachment.id} attachment={attachment} />
                  ))}
                </div>
              ) : null}

              {/* Afficher les ressources partagées */}
              {message.sharedResources?.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {message.sharedResources.map((resource) => (
                    <SharedResourcePreview key={resource.id} resource={resource} />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Statut de lecture (pour les messages envoyés) */}
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
 * Apercu d'une piece jointe (document lie au message).
 */
function DocumentPreview({ attachment }) {
  const document = attachment?.document;
  const name = document?.name ?? "Document";

  return (
    <div className="sui-chat__attachment">
      <span aria-hidden="true">📎</span>
      <div className="min-w-0">
        <strong>{name}</strong>
        {document?.mimeType ? <span>{document.mimeType}</span> : null}
      </div>
    </div>
  );
}

/**
 * Composant pour l'aperçu d'une ressource partagée
 */
function SharedResourcePreview({ resource }) {
  const getResourceIcon = (type) => {
    switch (type) {
      case "PROJECT": return "📁";
      case "TASK": return "✓";
      case "CLIENT": return "👤";
      case "QUOTE": return "💰";
      case "INVOICE": return "📄";
      case "PAYMENT": return "💳";
      case "DOCUMENT": return "📎";
      case "FOLDER": return "📂";
      default: return "🔗";
    }
  };

  const getTypeLabel = (type) => {
    switch (type) {
      case "PROJECT": return "Projet";
      case "TASK": return "Tâche";
      case "CLIENT": return "Client";
      case "QUOTE": return "Devis";
      case "INVOICE": return "Facture";
      case "PAYMENT": return "Paiement";
      case "DOCUMENT": return "Document";
      case "FOLDER": return "Dossier";
      default: return "Ressource";
    }
  };

  return (
    <div className="sui-chat__attachment">
      <span aria-hidden="true">{getResourceIcon(resource.resourceType)}</span>
      <div className="flex-1 min-w-0">
        <strong>{getTypeLabel(resource.resourceType)}</strong>
        {resource.previewTitle ? <span>{resource.previewTitle}</span> : null}
        {resource.previewText ? <span>{resource.previewText}</span> : null}
      </div>
    </div>
  );
}

export default ChatMessage;
