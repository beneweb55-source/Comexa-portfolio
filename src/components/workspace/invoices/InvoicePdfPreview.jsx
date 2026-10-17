"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { useActionNotification } from "@/components/workspace/ui/ActionNotification";

/**
 * Composant de prévisualisation et export PDF pour les factures
 * 
 * Fonctionnalités:
 * - Aperçu du PDF dans un iframe
 * - Téléchargement du PDF
 * - Envoi par email avec redirection vers Comexa
 * - Design épuré et professionnel avec aesthetic Comexa
 */
export function InvoicePdfPreview({
  invoiceId,
  onClose,
}) {
  const { request, user } = useAuth();
  const [pdfUrl, setPdfUrl] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [showEmailForm, setShowEmailForm] = useState(false);
  const iframeRef = useRef(null);

  const { showNotification, NotificationComponent } = useActionNotification();

  const canRead = can(user, 'invoice', 'read');
  const canSendEmail = can(user, 'email', 'send');

  // Charger le PDF
  useEffect(() => {
    if (!invoiceId || !canRead) return;

    loadPdf();
  }, [invoiceId, canRead]);

  const loadPdf = async () => {
    setLoading(true);

    try {
      // Générer l'aperçu
      const response = await request(`/api/pdf/invoices/${invoiceId}/preview`, {
        responseType: 'blob',
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        
        // Générer l'URL de téléchargement
        const downloadResponse = await request(`/api/pdf/invoices/${invoiceId}`, {
          responseType: 'blob',
        });
        
        if (downloadResponse.ok) {
          const downloadBlob = await downloadResponse.blob();
          const downloadUrl = URL.createObjectURL(downloadBlob);
          setPdfUrl(downloadUrl);
        }
      }
    } catch (error) {
      showNotification({
        message: 'Erreur lors du chargement du PDF',
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  // Télécharger le PDF
  const downloadPdf = () => {
    if (!pdfUrl) return;

    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = `facture-${invoiceId}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Envoyer par email
  const sendByEmail = async () => {
    if (!email || !canSendEmail) return;

    setSending(true);

    try {
      const response = await request(`/api/pdf/invoices/${invoiceId}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: email,
          subject: subject || `Facture ${invoiceId}`,
          message: message || '',
          includePdf: true,
          language: 'fr',
        }),
      });

      if (response.ok) {
        const result = await response.json();
        
        // Afficher la notification avec lien de redirection
        showNotification({
          message: 'Facture envoyée par email avec succès !',
          redirectUrl: result.redirectUrl,
          action: result.action,
          duration: 8000,
        });
        
        setShowEmailForm(false);
        setEmail('');
        setSubject('');
        setMessage('');
      } else {
        const error = await response.json();
        showNotification({
          message: error.error || 'Erreur lors de l\'envoi par email',
          duration: 5000,
        });
      }
    } catch (error) {
      showNotification({
        message: 'Erreur lors de l\'envoi par email',
        duration: 5000,
      });
    } finally {
      setSending(false);
    }
  };

  // Nettoyage des URLs
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [previewUrl, pdfUrl]);

  if (!canRead) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-[var(--comexa-surface)] rounded-xl p-6 max-w-md shadow-xl">
          <h3 className="text-lg font-bold text-[var(--comexa-ink)] mb-4">Accès refusé</h3>
          <p className="text-[var(--comexa-ink-muted)]">Vous n'avez pas les permissions pour consulter cette facture.</p>
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
            <h2 className="text-lg font-bold text-[var(--comexa-ink)]">Aperçu Facture</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={downloadPdf}
                disabled={!pdfUrl}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--comexa-blue-500)] rounded-lg hover:bg-[var(--comexa-blue-600)] disabled:bg-[var(--comexa-neutral-300)] disabled:cursor-not-allowed transition-colors"
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
              >
                <svg className="w-5 h-5 text-[var(--comexa-ink-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Zone de chargement */}
          {loading && !previewUrl && (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-spin w-8 h-8 border-4 border-[var(--comexa-blue-500)] border-t-transparent rounded-full" />
            </div>
          )}

          {/* Aperçu PDF */}
          {previewUrl && !loading && (
            <div className="flex-1 overflow-auto p-4 bg-[var(--comexa-neutral-50)]">
              <iframe
                ref={iframeRef}
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
                  >
                    <svg className="w-5 h-5 text-[var(--comexa-ink-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); sendByEmail(); }} className="flex flex-col gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--comexa-ink)] mb-1">Email *</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full px-3 py-2 text-sm bg-[var(--comexa-neutral-50)] rounded-lg border border-[var(--comexa-border-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--comexa-blue-500)] transition-all"
                      placeholder="email@client.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--comexa-ink)] mb-1">Sujet</label>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-[var(--comexa-neutral-50)] rounded-lg border border-[var(--comexa-border-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--comexa-blue-500)] transition-all"
                      placeholder="Facture N°..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--comexa-ink)] mb-1">Message (optionnel)</label>
                    <textarea
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
                      className="px-4 py-2 text-sm font-medium text-white bg-[var(--comexa-blue-500)] rounded-lg hover:bg-[var(--comexa-blue-600)] disabled:bg-[var(--comexa-neutral-300)] disabled:cursor-not-allowed transition-colors"
                    >
                      {sending ? 'Envoi...' : 'Envoyer'}
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
