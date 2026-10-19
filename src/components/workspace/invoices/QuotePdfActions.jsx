"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/session";
import { canAny } from "@/lib/access";
import { Notice, secondaryButton } from "@/components/workspace/ui";

/** Aperçu et téléchargement PDF de devis via les routes authentifiées de l'API. */
export default function QuotePdfActions({ quoteId, reference }) {
  const { user, download, blobUrl } = useAuth();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const canRead = canAny(user, ["quote:read:any", "quote:read:own"]);

  useEffect(() => {
    if (!previewOpen || !quoteId || !canRead) return undefined;
    let cancelled = false;
    blobUrl(`/pdf/quotes/${quoteId}/preview`)
      .then((url) => {
        if (cancelled) URL.revokeObjectURL(url);
        else setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError("L’aperçu du devis n’a pas pu être chargé.");
      });
    return () => {
      cancelled = true;
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
    };
  }, [previewOpen, quoteId, canRead, blobUrl]);

  async function downloadPdf() {
    if (!canRead || downloading) return;
    setDownloading(true);
    setError(null);
    const safeReference = String(reference || quoteId).replace(/[^A-Za-z0-9._-]/g, "-");
    try {
      await download(`/pdf/quotes/${quoteId}`, `COMEXA-DEVIS-${safeReference}.pdf`);
    } catch {
      setError("Le PDF du devis n’a pas pu être téléchargé.");
    } finally {
      setDownloading(false);
    }
  }

  if (!canRead) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secondaryButton} onClick={() => setPreviewOpen(true)}>
          Aperçu PDF
        </button>
        <button type="button" className={secondaryButton} onClick={downloadPdf} disabled={downloading}>
          {downloading ? "Préparation…" : "Télécharger PDF"}
        </button>
        {error && !previewOpen ? <span role="alert" className="text-sm text-[var(--comexa-error)]">{error}</span> : null}
      </div>

      {previewOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`Aperçu du devis ${reference || ""}`}>
          <section className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-[var(--comexa-surface)] shadow-2xl">
            <header className="flex items-center justify-between gap-3 border-b border-[var(--comexa-border-soft)] p-4">
              <h2 className="font-semibold text-[var(--comexa-ink)]">Devis {reference}</h2>
              <div className="flex items-center gap-2">
                <button type="button" className={secondaryButton} onClick={downloadPdf} disabled={downloading}>
                  {downloading ? "Préparation…" : "Télécharger"}
                </button>
                <button type="button" className={secondaryButton} onClick={() => setPreviewOpen(false)} aria-label="Fermer l’aperçu">
                  Fermer
                </button>
              </div>
            </header>
            {error ? <div className="p-4"><Notice>{error}</Notice></div> : null}
            {!previewUrl && !error ? <p className="p-8 text-center text-sm text-[var(--comexa-ink-soft)]">Génération de l’aperçu…</p> : null}
            {previewUrl ? <iframe title={`PDF du devis ${reference}`} src={previewUrl} className="min-h-[60vh] flex-1 bg-white" /> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
