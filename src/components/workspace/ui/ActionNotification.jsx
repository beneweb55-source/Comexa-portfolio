"use client";

import { useState, useEffect } from "react";

/**
 * Composant de notification d'action avec lien de redirection
 * 
 * Design :
 * - Glassmorphism avec fond semi-transparent
 * - Bleu Comexa pour les boutons
 * - Ombres douces
 * - Animations fluides
 */
export function ActionNotification({
  message,
  redirectUrl,
  action,
  onClose,
  duration = 5000,
}) {
  const [isVisible, setIsVisible] = useState(true);

  // Auto-fermeture après le délai
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      onClose?.();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  if (!isVisible) return null;

  // Déterminer l'URL de redirection
  const url = redirectUrl || action?.url;
  const openInNewTab = action?.type === 'open_tab';

  // Icône en fonction du type
  const getIcon = () => {
    if (message?.includes('succès') || message?.includes('success')) {
      return (
        <svg className="w-5 h-5 text-[var(--comexa-success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    }
    if (message?.includes('erreur') || message?.includes('error')) {
      return (
        <svg className="w-5 h-5 text-[var(--comexa-error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5 text-[var(--comexa-blue-500)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    );
  };

  return (
    <div
      className="fixed bottom-6 right-6 z-50 w-80"
      style={{
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
      }}
    >
      <div
        className="flex items-start gap-3 p-4 rounded-xl backdrop-blur-[var(--comexa-glass-blur)] bg-[var(--comexa-glass-bg)] border border-[var(--comexa-glass-border)] shadow-lg"
        style={{
          boxShadow: 'var(--comexa-shadow-md)',
        }}
      >
        {/* Icône */}
        <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>

        {/* Message */}
        <div className="flex-1">
          <p className="text-sm text-[var(--comexa-ink)]">{message}</p>
          
          {/* Lien de redirection */}
          {url && (
            <a
              href={url}
              target={openInNewTab ? '_blank' : '_self'}
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 px-3 py-1.5 text-sm font-medium text-white bg-[var(--comexa-blue-500)] rounded-lg hover:bg-[var(--comexa-blue-600)] transition-colors"
              style={{
                boxShadow: 'var(--comexa-shadow-sm)',
              }}
            >
              Voir sur Comexa
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>

        {/* Bouton de fermeture */}
        <button
          onClick={() => {
            setIsVisible(false);
            onClose?.();
          }}
          className="flex-shrink-0 p-1 text-[var(--comexa-ink-muted)] hover:text-[var(--comexa-ink)] transition-colors"
          aria-label="Fermer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Hook pour afficher des notifications d'action
 */
export function useActionNotification() {
  const [notification, setNotification] = useState(null);

  const showNotification = useCallback((params) => {
    setNotification(params);
  }, []);

  const hideNotification = useCallback(() => {
    setNotification(null);
  }, []);

  const NotificationComponent = notification ? (
    <ActionNotification
      message={notification.message}
      redirectUrl={notification.redirectUrl}
      action={notification.action}
      onClose={hideNotification}
      duration={notification.duration || 5000}
    />
  ) : null;

  return {
    showNotification,
    hideNotification,
    NotificationComponent,
  };
}

export default ActionNotification;
