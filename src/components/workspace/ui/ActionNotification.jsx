"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";

/*
 * Notification d'action (message court, lien de redirection facultatif).
 *
 * Habillage : design system « soft UI pastel dans une coque noire » — carte
 * blanche très arrondie, pastel selon la gravité, un seul bouton noir.
 *
 * ATTENTION, piège déjà rencontré : `useCallback` fait partie des imports de
 * `react`. Sans lui, `useActionNotification` lève un `ReferenceError` au
 * premier rendu du composant appelant — et la messagerie entière reste blanche.
 */

const TONE = {
  success: { bg: "var(--green)", Icon: CircleCheck },
  error: { bg: "var(--pink)", Icon: CircleAlert },
  info: { bg: "var(--blue)", Icon: Info },
};

function toneOf(message) {
  const text = String(message ?? "").toLowerCase();
  if (text.includes("succès") || text.includes("success") || text.includes("modifié")) return "success";
  if (text.includes("erreur") || text.includes("error") || text.includes("impossible")) return "error";
  return "info";
}

export function ActionNotification({
  message,
  redirectUrl,
  action,
  onClose,
  duration = 5000,
}) {
  const [isVisible, setIsVisible] = useState(true);
  const tone = TONE[toneOf(message)] ?? TONE.info;

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
  const openInNewTab = action?.type === "open_tab";

  return (
    <div className="sui-toast" role="status" aria-live="polite">
      <div className="sui-toast__card">
        <span className="sui-toast__icon" style={{ "--tone-bg": tone.bg }} aria-hidden="true">
          <tone.Icon size={18} strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="sui-toast__message">{message}</p>
          {url ? (
            <a
              href={url}
              target={openInNewTab ? "_blank" : "_self"}
              rel="noopener noreferrer"
              className="sui-btn sui-btn--dark sui-btn--sm sui-toast__link"
            >
              Voir sur Comexa
            </a>
          ) : null}
        </div>
        <button
          onClick={() => {
            setIsVisible(false);
            onClose?.();
          }}
          className="sui-iconbtn sui-iconbtn--ghost"
          aria-label="Fermer la notification"
        >
          <X size={17} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * Hook pour afficher des notifications d'action.
 *
 * `showNotification` et `hideNotification` sont mémoïsés : le panneau de
 * messagerie les liste dans les dépendances de ses rappels, une nouvelle
 * fonction à chaque rendu relancerait ses effets en boucle.
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
