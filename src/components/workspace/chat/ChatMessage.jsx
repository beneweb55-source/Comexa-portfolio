"use client";

import { useMemo } from "react";
import { formatDate, formatTime } from "@/lib/api";
import { useAuth } from "@/lib/session";

/**
 * Composant pour afficher un message dans le chat
 * Style: bulles de message modernes avec glassmorphism
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

  // Couleurs en fonction du type
  const getMessageStyles = () => {
    if (isSystem) {
      return {
        bubble: "bg-[var(--comexa-neutral-100)] text-[var(--comexa-ink-muted)]",
        text: "text-sm",
      };
    }
    
    if (isMine) {
      return {
        bubble: "bg-[var(--comexa-blue-500)] text-white",
        text: "text-white",
      };
    }
    
    return {
      bubble: "bg-[var(--comexa-glass-bg)] backdrop-blur-[var(--comexa-glass-blur)] border border-[var(--comexa-glass-border)]",
      text: "text-[var(--comexa-ink)]",
    };
  };

  const styles = getMessageStyles();

  // Rendu du contenu du message
  const renderContent = () => {
    if (isDeleted) {
      return <em className="text-[var(--comexa-ink-muted)] italic">Message supprimé</em>;
    }
    
    if (isSystem) {
      return <span className="font-medium">{message.body}</span>;
    }
    
    // Contenu normal avec support pour les ressources partagées
    return (
      <div className="whitespace-pre-wrap break-words">
        {message.body}

        {/* Pieces jointes : l'API renvoie les documents lies au message. */}
        {message.attachments?.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.attachments.map((attachment) => (
              <DocumentPreview key={attachment.documentId ?? attachment.id} attachment={attachment} />
            ))}
          </div>
        )}

        {/* Afficher les ressources partagées */}
        {message.sharedResources?.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.sharedResources.map((resource) => (
              <SharedResourcePreview key={resource.id} resource={resource} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div 
      className={`flex ${isMine ? "justify-end" : "justify-start"} gap-2 group`}
      data-message-id={message.id}
    >
      {/* Avatar (optionnel) */}
      {showAvatar && !isMine && !isSystem && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--comexa-blue-100)] flex items-center justify-center text-sm font-semibold text-[var(--comexa-blue-600)]">
          {senderName.charAt(0).toUpperCase()}
        </div>
      )}
      
      <div 
        className={`flex flex-col gap-1 max-w-[80%] lg:max-w-[70%]`}
      >
        {/* En-tête du message (expéditeur + date) */}
        {!isSystem && showTimestamp && (
          <div className={`flex items-center gap-2 text-xs ${isMine ? "justify-end" : "justify-start"}`}>
            <span className="font-medium text-[var(--comexa-ink-muted)]">{senderName}</span>
            <span className="text-[var(--comexa-ink-subtle)]">{formattedDate}</span>
          </div>
        )}
        
        {/* Bulle du message */}
        <div 
          className={`rounded-xl px-4 py-3 ${styles.bubble} ${styles.text} ${
            isMine ? "rounded-br-sm" : "rounded-bl-sm"
          }`}
          style={{
            boxShadow: isMine ? "none" : "var(--comexa-shadow-sm)",
          }}
        >
          {renderContent()}
        </div>
        
        {/* Statut de lecture (pour les messages envoyés) */}
        {isMine && message.readReceipts?.length > 0 && (
          <div className="flex items-center justify-end gap-1 text-xs text-[var(--comexa-blue-400)]">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
            </svg>
            <span>Lu par {message.readReceipts.length}</span>
          </div>
        )}
      </div>
      
      {/* Avatar pour les messages envoyés (optionnel) */}
      {showAvatar && isMine && !isSystem && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--comexa-blue-500)] flex items-center justify-center text-sm font-semibold text-white">
          {senderName.charAt(0).toUpperCase()}
        </div>
      )}
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
    <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--comexa-white)] border border-[var(--comexa-border-soft)]">
      <span className="text-xl" aria-hidden="true">📎</span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--comexa-ink)] truncate">{name}</p>
        {document?.mimeType ? (
          <p className="text-xs text-[var(--comexa-ink-muted)] truncate">{document.mimeType}</p>
        ) : null}
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
      case "PROJECT":
        return <span className="text-[var(--comexa-blue-500)]">📁</span>;
      case "TASK":
        return <span className="text-[var(--comexa-blue-500)]">✓</span>;
      case "CLIENT":
        return <span className="text-[var(--comexa-blue-500)]">👤</span>;
      case "QUOTE":
        return <span className="text-[var(--comexa-blue-500)]">💰</span>;
      case "INVOICE":
        return <span className="text-[var(--comexa-blue-500)]">📄</span>;
      case "PAYMENT":
        return <span className="text-[var(--comexa-blue-500)]">💳</span>;
      case "DOCUMENT":
        return <span className="text-[var(--comexa-blue-500)]">📎</span>;
      case "FOLDER":
        return <span className="text-[var(--comexa-blue-500)]">📂</span>;
      default:
        return <span className="text-[var(--comexa-blue-500)]">🔗</span>;
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
    <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--comexa-white)] border border-[var(--comexa-border-soft)] hover:bg-[var(--comexa-neutral-50)] transition-colors cursor-pointer">
      <span className="text-xl">{getResourceIcon(resource.resourceType)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[var(--comexa-ink)]">{getTypeLabel(resource.resourceType)}</span>
        </div>
        {resource.previewTitle && (
          <p className="text-sm text-[var(--comexa-ink-muted)] truncate">{resource.previewTitle}</p>
        )}
        {resource.previewText && (
          <p className="text-sm text-[var(--comexa-ink-subtle)] line-clamp-1">{resource.previewText}</p>
        )}
      </div>
    </div>
  );
}

export default ChatMessage;
