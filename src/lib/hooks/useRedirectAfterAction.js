"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Hook pour gérer les redirections après une action
 * 
 * Fonctionnalités:
 * - Ouvrir dans un nouvel onglet
 * - Rediriger la page actuelle
 * - Afficher un message de succès avec lien cliquable
 * - Design cohérent avec l'aesthetic Comexa
 */
export function useRedirectAfterAction() {
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [redirectError, setRedirectError] = useState(null);

  /**
   * Rediriger vers une URL
   * @param {string} url - URL de destination
   * @param {object} options - Options de redirection
   * @param {boolean} options.openInNewTab - Ouvrir dans un nouvel onglet (défaut: true)
   * @param {boolean} options.replace - Remplacer l'historique (défaut: false)
   */
  const redirectTo = useCallback((url, options = {}) => {
    const { openInNewTab = true, replace = false } = options;

    if (!url) return;

    try {
      setIsRedirecting(true);
      setRedirectError(null);

      if (openInNewTab) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else if (replace) {
        router.replace(url);
      } else {
        router.push(url);
      }
    } catch (error) {
      setRedirectError(error.message);
    } finally {
      setIsRedirecting(false);
    }
  }, [router]);

  /**
   * Exécuter une action et rediriger après succès
   * @param {Function} action - Fonction asynchrone à exécuter
   * @param {object} options - Options de redirection
   * @returns {Promise<any>} Résultat de l'action
   */
  const executeWithRedirect = useCallback(
    async (action, options = {}) => {
      const { openInNewTab = true, replace = false, successMessage, errorMessage } = options;

      try {
        setIsRedirecting(true);
        setRedirectError(null);

        const result = await action();

        // Si la réponse contient une URL de redirection
        if (result?.redirectUrl) {
          redirectTo(result.redirectUrl, { openInNewTab, replace });
        }

        // Si la réponse contient une action
        if (result?.action?.url) {
          redirectTo(result.action.url, {
            openInNewTab: result.action.type === 'open_tab',
            replace: result.action.type === 'redirect',
          });
        }

        return result;
      } catch (error) {
        setRedirectError(error.message || errorMessage || 'Une erreur est survenue');
        throw error;
      } finally {
        setIsRedirecting(false);
      }
    },
    [redirectTo],
  );

  /**
   * Composant de message de redirection avec aesthetic Comexa
   */
  const RedirectMessage = useCallback(
    ({ message, url, onClose }) => (
      <div
        className="fixed bottom-6 right-6 z-50 flex items-center gap-4 p-4 rounded-xl bg-[var(--comexa-surface)] shadow-lg border border-[var(--comexa-border-soft)]"
        style={{
          boxShadow: 'var(--comexa-shadow-md)',
        }}
      >
        <span className="text-[var(--comexa-ink)] text-sm">✅ {message}</span>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 text-sm font-medium text-white bg-[var(--comexa-blue-500)] rounded-lg hover:bg-[var(--comexa-blue-600)] transition-colors"
            style={{
              boxShadow: 'var(--comexa-shadow-sm)',
            }}
          >
            Voir sur Comexa
          </a>
        )}
        <button
          onClick={onClose}
          className="p-1 text-[var(--comexa-ink-muted)] hover:text-[var(--comexa-ink)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    ),
    [],
  );

  return {
    redirectTo,
    executeWithRedirect,
    isRedirecting,
    redirectError,
    RedirectMessage,
  };
}

export default useRedirectAfterAction;
