"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/session";
import { can, canAny } from "@/lib/access";
import { useActionNotification } from "@/components/workspace/ui/ActionNotification";
import { primaryButton, secondaryButton } from "@/components/workspace/ui";

/**
 * Composant de prévisualisation et export PDF pour les factures
 *
 * Fonctionnalités:
 * - Aperçu du PDF dans un iframe
 * - Téléchargement du PDF
 * - Envoi par email
 * - Design épuré et professionnel avec aesthetic Comexa
 *
 * CE QUI A ÉTÉ CORRIGÉ ICI, ET POURQUOI C'ÉTAIT INVISIBLE :
 *
 * L'aperçu faisait `request(..., { responseType: "blob" })` puis testait
 * `response.ok`. Or `request` renvoie l'ENVELOPPE JSON déjà parsée
 * (`{ success, data, message, … }`), pas une `Response` : `response.ok` valait
 * donc `undefined` — toujours faux — et `response.blob()` n'existait pas. Le
 * cadre restait vide, sans aucun message. Le composant n'était de toute façon
 * jamais monté, faute de droits évalués correctement (voir `InvoicePdfActions`).
 *
 * L'aperçu passe maintenant par `blobUrl()`, exposé par la session : un `fetch`
 * authentifié qui rend une URL d'objet, avec rafraîchissement du jeton sur 401.
 * Un `<iframe src>` ne peut PAS porter l'en-tete `Authorization`, et le jeton
 * d'accès vit en mémoire : charger le PDF directement était donc impossible.
 *
 * L'envoi par email, lui, passe par `request()` normal — l'API répond en JSON —
 * et consomme la redirection que le serveur propose (`action`), via la
 * notification d'action. C'est le contrat du système de redirection.
 */
export function InvoicePdfPreview({
  invoiceId,
  reference,
  onClose,
}) {
  const { request, download, blobUrl, user } = useAuth();
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);

  const { showNotification, NotificationComponent } = useActionNotification();

  const canRead = canAny(user, ["invoice:read:any", "invoice:read:own"]);
  const canSendEmail = can(user, "invoice:send:any");

  // Charger le PDF : une URL d'objet par ouverture, révoquée à la fermeture.
  // Sans cette révocation, chaque aperçu laissait un blob en mémoire jusqu'au
  // rechargement de la page — invisible, mais cumulatif sur une session longue.
  useEffect(() => {
    if (!invoiceId || !canRead) return undefined;

    let cancelled = false;

    blobUrl(`/pdf/invoices/${invoiceId}/preview`)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setLoadError("L’aperçu du PDF n’a pas pu être chargé.");
      });

    return () => {
      cancelled = true;
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
    };
  }, [invoiceId, canRead, blobUrl, previewAttempt]);

  // L'état de chargement se DÉDUIT de ce que l'on détient, au lieu d'être un
  // quatrième état à garder synchronisé : pas d'URL et pas d'erreur, c'est que
  // le chargement est en cours. Un état `loading` posé dans l'effet aurait été
  // un `setState` synchrone — refusé par le lint du dépôt — et aurait surtout pu
  // afficher « chargement » alors que l'URL était déjà là.
  const loading = previewUrl === null && loadError === null;

  // Télécharger le PDF
  const downloadPdf = async () => {
    try {
      const safeReference = String(reference || invoiceId).replace(/[^A-Za-z0-9._-]/g, "-");
      await download(`/pdf/invoices/${invoiceId}`, `COMEXA-FACTURE-${safeReference}.pdf`);
    } catch {
      showNotification({ message: "Le PDF n’a pas pu être téléchargé.", duration: 5000 });
    }
  };

  // Envoyer par email
  const sendByEmail = async () => {
    if (!email || !canSendEmail || sending) return;

    setSending(true);

    try {
      const result = await request(`/pdf/invoices/${invoiceId}/email`, {
        method: "POST",
        body: {
          to: email,
          subject: subject || `Facture ${reference || invoiceId}`,
          message: message || "",
          includePdf: true,
          language: "fr",
        },
      });

      // La notification porte le verbe du serveur ET la redirection qu'il
      // propose : c'est le contrat de `buildResponse`, et c'est ce qui permet à
      // l'utilisateur de sauter directement sur la facture concernée.
      showNotification({
        message: result?.message ?? "Facture envoyée par email avec succès.",
        redirectUrl: result?.redirectUrl,
        action: result?.action,
        duration: 8000,
      });

      setShowEmailForm(false);
      setEmail("");
      setSubject("");
      setMessage("");
    } catch (error) {
      showNotification({
        message: error?.message ?? "Erreur lors de l'envoi par email",
        duration: 5000,
      });
    } finally {
      setSending(false);
    }
  };

  if (!canRead) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-[var(--comexa-surface)] rounded-xl p-6 max-w-md shadow-xl">
          <h3 className="text-lg font-bold text-[var(--comexa-ink)] mb-4">Accès refusé</h3>
          <p className="text-[var(--comexa-ink-muted)]">Vous n’avez pas les permissions pour consulter cette facture.</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 px-4 py-2 bg-[var(--comexa-blue-500)] text-white rounded-lg hover:bg-[var(--comexa-blue-600)] transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Notification */}
      {NotificationComponent}

      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-[var(--comexa-surface)] rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
          {/* En-tête avec aesthetic Comexa */}
          <div className="flex items-center justify-between p-4 border-b border-[var(--comexa-border-soft)] bg-[var(--comexa-glass-bg)] backdrop-blur-[var(--comexa-glass-blur)]">
            <h2 className="text-lg font-bold text-[var(--comexa-ink)]">
              Aperçu {reference ? `facture ${reference}` : "facture"}
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={downloadPdf}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--comexa-blue-500)] rounded-lg hover:bg-[var(--comexa-blue-600)] transition-colors"
              >
                Télécharger PDF
              </button>
              {canSendEmail && (
                <button
                  type="button"
                  onClick={() => setShowEmailForm(true)}
                  className="px-4 py-2 text-sm font-medium text-[var(--comexa-blue-500)] bg-[var(--comexa-blue-50)] rounded-lg hover:bg-[var(--comexa-blue-100)] transition-colors"
                >
                  Envoyer par Email
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-[var(--comexa-neutral-100)] transition-colors"
                aria-label="Fermer l'aperçu"
              >
                <svg className="w-5 h-5 text-[var(--comexa-ink-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Zone de chargement */}
          {loading && !previewUrl && (
            <div className="flex-1 flex items-center justify-center p-10">
              <div className="animate-spin w-8 h-8 border-4 border-[var(--comexa-blue-500)] border-t-transparent rounded-full" />
            </div>
          )}

          {/* Échec de chargement : dire POURQUOI le cadre est vide vaut mieux
              qu'un cadre vide sans explication. */}
          {loadError && !loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-10 text-center">
              <p className="text-[14px] text-[var(--comexa-ink)]">{loadError}</p>
              <button
                type="button"
                onClick={() => {
                  setLoadError(null);
                  setPreviewAttempt((attempt) => attempt + 1);
                }}
                className={secondaryButton}
              >
                Réessayer
              </button>
            </div>
          ) : null}

          {/* Aperçu PDF */}
          {previewUrl && !loading && (
            <div className="flex-1 overflow-auto p-4 bg-[var(--comexa-neutral-50)]">
              <iframe
                src={previewUrl}
                className="w-full h-full min-h-[400px] rounded-lg border border-[var(--comexa-border-soft)]"
                title="Aperçu PDF"
              />
            </div>
          )}

          {/* Formulaire d'envoi par email */}
          {showEmailForm && canSendEmail && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-[var(--comexa-surface)] rounded-xl shadow-xl max-w-md w-full p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-[var(--comexa-ink)]">Envoyer par Email</h3>
                  <button
                    type="button"
                    onClick={() => setShowEmailForm(false)}
                    className="p-2 rounded-lg hover:bg-[var(--comexa-neutral-100)] transition-colors"
                    aria-label="Fermer le formulaire"
                  >
                    <svg className="w-5 h-5 text-[var(--comexa-ink-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); sendByEmail(); }} className="flex flex-col gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--comexa-ink)] mb-1" htmlFor="pdf-email-to">Email *</label>
                    <input
                      id="pdf-email-to"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full px-3 py-2 text-sm bg-[var(--comexa-neutral-50)] rounded-lg border border-[var(--comexa-border-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--comexa-blue-500)] transition-all"
                      placeholder="email@client.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--comexa-ink)] mb-1" htmlFor="pdf-email-subject">Sujet</label>
                    <input
                      id="pdf-email-subject"
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-[var(--comexa-neutral-50)] rounded-lg border border-[var(--comexa-border-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--comexa-blue-500)] transition-all"
                      placeholder="Facture N°..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--comexa-ink)] mb-1" htmlFor="pdf-email-message">Message (optionnel)</label>
                    <textarea
                      id="pdf-email-message"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 text-sm bg-[var(--comexa-neutral-50)] rounded-lg border border-[var(--comexa-border-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--comexa-blue-500)] transition-all resize-none"
                      placeholder="Message personnalisé..."
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-[var(--comexa-border-soft)]">
                    <button
                      type="button"
                      onClick={() => setShowEmailForm(false)}
                      className="px-4 py-2 text-sm font-medium text-[var(--comexa-ink-muted)] bg-[var(--comexa-neutral-100)] rounded-lg hover:bg-[var(--comexa-neutral-200)] transition-colors"
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      disabled={sending || !email}
                      className={primaryButton}
                    >
                      {sending ? "Envoi..." : "Envoyer"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default InvoicePdfPreview;
