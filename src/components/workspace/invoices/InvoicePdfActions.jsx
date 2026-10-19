"use client";

import { useState } from "react";
import { useAuth } from "@/lib/session";
import { can, canAny } from "@/lib/access";
import { InvoicePdfPreview } from "./InvoicePdfPreview";
import { secondaryButton } from "@/components/workspace/ui";

/**
 * Composant pour les actions PDF/Email sur une facture
 *
 * Affiche des boutons pour:
 * - Prévisualiser le PDF
 * - Télécharger le PDF
 * - Envoyer par email
 *
 * Design épuré et professionnel avec l'aesthetic Comexa
 *
 * TROIS ERREURS CORRIGÉES, et aucune n'était visible à l'écran — ce qui est
 * précisément ce qui les rendait dangereuses :
 *
 * 1. `can(user, 'invoice', 'read')` : `can()` prend UNE permission complète
 *    (`invoice:read:any`), pas un couple ressource/action. L'appel rendait
 *    toujours `false`, donc le composant rendait `null` : AUCUN bouton PDF
 *    n'apparaissait jamais, sur aucune facture, pour personne.
 * 2. `can(user, 'email', 'send')` : le code `email:send:any` n'existe pas dans
 *    le catalogue des permissions. Le bouton d'envoi était donc condamné à
 *    rester invisible même une fois le premier correctif fait. Le droit réel,
 *    celui que vérifie le contrôleur, est `invoice:send:any`.
 * 3. `const { request } = useAuth()` était appelé À L'INTÉRIEUR de la fonction
 *    asynchrone `downloadPdf` : un crochet React hors du corps du composant. Il
 *    fonctionnait par accident (le nombre de crochets ne changeait pas), mais
 *    casse au premier `react-hooks/rules-of-hooks` et au compilateur React.
 */
export function InvoicePdfActions({
  invoiceId,
  reference,
  showPreviewButton = true,
  showDownloadButton = true,
  showEmailButton = true,
  size = "md", // sm, md, lg
}) {
  const { download, user } = useAuth();
  const [showPreview, setShowPreview] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);

  // Lecture : le portail client passe par `invoice:read:own`, l'équipe par
  // `invoice:read:any`. C'est exactement la porte posée par le contrôleur.
  const canRead = canAny(user, ["invoice:read:any", "invoice:read:own"]);
  // Envoi : c'est l'équipe qui envoie la facture au client, jamais le client
  // qui se l'envoie à lui-même. D'où `:any` seul.
  const canSendEmail = can(user, "invoice:send:any");

  // Télécharger directement le PDF. `download` porte le jeton, l'espace actif
  // et le rafraîchissement sur 401 : le refaire à la main ici serait une
  // deuxième implémentation du même protocole, condamnée à diverger.
  const downloadPdf = async () => {
    if (!canRead || downloading) return;

    setDownloading(true);
    setError(null);
    try {
      const safeReference = String(reference || invoiceId).replace(/[^A-Za-z0-9._-]/g, "-");
      await download(`/pdf/invoices/${invoiceId}`, `COMEXA-FACTURE-${safeReference}.pdf`);
    } catch (caught) {
      setError("Le PDF n'a pas pu être téléchargé.");
    } finally {
      setDownloading(false);
    }
  };

  // Ouvrir la prévisualisation
  const openPreview = () => {
    if (!canRead) return;
    setShowPreview(true);
  };

  // Styles en fonction de la taille
  const getButtonStyles = () => {
    switch (size) {
      case "sm":
        return { button: "px-2 py-1 text-xs", icon: "w-4 h-4", gap: "gap-1" };
      case "lg":
        return { button: "px-4 py-2 text-base", icon: "w-5 h-5", gap: "gap-2" };
      default: // md
        return { button: "px-3 py-1.5 text-sm", icon: "w-4 h-4", gap: "gap-1.5" };
    }
  };

  const styles = getButtonStyles();

  if (!canRead) {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-1">
        {showPreviewButton && (
          <button
            type="button"
            onClick={openPreview}
            className={`${styles.button} ${styles.gap} text-[var(--comexa-blue-500)] bg-[var(--comexa-blue-50)] rounded-lg hover:bg-[var(--comexa-blue-100)] transition-colors flex items-center`}
            title="Aperçu PDF"
          >
            <svg className={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {size !== "sm" && <span>Aperçu</span>}
          </button>
        )}

        {showDownloadButton && (
          <button
            type="button"
            onClick={downloadPdf}
            disabled={downloading}
            className={`${styles.button} ${styles.gap} text-white bg-[var(--comexa-blue-500)] rounded-lg hover:bg-[var(--comexa-blue-600)] disabled:bg-[var(--comexa-neutral-300)] disabled:cursor-not-allowed transition-colors flex items-center`}
            title="Télécharger PDF"
          >
            {downloading ? (
              <div className={`animate-spin ${styles.icon} border-2 border-white border-t-transparent rounded-full`} />
            ) : (
              <svg className={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
            {size !== "sm" && <span>PDF</span>}
          </button>
        )}

        {showEmailButton && canSendEmail && (
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className={`${styles.button} ${styles.gap} text-[var(--comexa-blue-500)] bg-[var(--comexa-blue-50)] rounded-lg hover:bg-[var(--comexa-blue-100)] transition-colors flex items-center`}
            title="Envoyer par email"
          >
            <svg className={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {size !== "sm" && <span>Email</span>}
          </button>
        )}
      </div>

      {/* Erreur de téléchargement, courte et sous les boutons. */}
      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-[var(--comexa-error)]">
          {error}{" "}
          <button type="button" onClick={downloadPdf} className={secondaryButton}>
            Réessayer
          </button>
        </p>
      ) : null}

      {/* Modal de prévisualisation */}
      {showPreview && (
        <InvoicePdfPreview
          invoiceId={invoiceId}
          reference={reference}
          onClose={() => setShowPreview(false)}
        />
      )}
    </>
  );
}

export default InvoicePdfActions;
