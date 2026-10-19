"use client";

import { useEffect, useState } from "react";
import { Download, Eye } from "lucide-react";
import Viewer from "@/components/softui/Viewer";
import { Button } from "@/components/softui/primitives";
import { useAuth } from "@/lib/session";
import { canAny } from "@/lib/access";
import { Notice } from "@/components/workspace/ui";

/*
 * Aperçu et téléchargement du PDF d'un devis, via les routes authentifiées de
 * l'API.
 *
 * L'aperçu passe par `Viewer`, le volet du design system : le devis et la facture
 * s'ouvraient dans deux modales écrites séparément (l'une en `z-[100]` avec un
 * cadre scrollable autour de l'iframe, l'autre en `z-50` avec trois niveaux de
 * défilement), et aucune des deux ne suivait la charte. Une seule désormais.
 *
 * Pas de bouton d'envoi ici : la page de devis porte déjà « Envoyer au client »,
 * qui suit le circuit de validation du devis. Un second envoi par email aurait
 * été exactement le doublon reproché aux actions de facture.
 *
 * Le PDF n'est demandé qu'à l'ouverture de l'aperçu : le générer au montage
 * chargerait l'API pour un document que l'utilisateur ne regarde peut-être pas.
 */

export default function QuotePdfActions({ quoteId, reference }) {
  const { download, blobUrl, user } = useAuth();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [attempt, setAttempt] = useState(0);

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
        if (!cancelled) setLoadError("L’aperçu du devis n’a pas pu être chargé.");
      });

    return () => {
      cancelled = true;
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
    };
  }, [previewOpen, quoteId, canRead, blobUrl, attempt]);

  const loading = previewUrl === null && loadError === null;

  async function downloadPdf() {
    if (!canRead || downloading) return;

    setDownloading(true);
    setDownloadError(null);
    const safeReference = String(reference || quoteId).replace(/[^A-Za-z0-9._-]/g, "-");
    try {
      await download(`/pdf/quotes/${quoteId}`, `COMEXA-DEVIS-${safeReference}.pdf`);
    } catch {
      setDownloadError("Le PDF du devis n’a pas pu être téléchargé.");
    } finally {
      setDownloading(false);
    }
  }

  function closePreview() {
    setPreviewOpen(false);
    setLoadError(null);
  }

  if (!canRead) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={Eye} variant="dark" onClick={() => setPreviewOpen(true)}>
          Aperçu
        </Button>
        <Button icon={Download} disabled={downloading} onClick={downloadPdf}>
          {downloading ? "Préparation…" : "Télécharger"}
        </Button>
      </div>

      {downloadError ? (
        <div className="mt-2">
          <Notice>
            {downloadError}{" "}
            <button type="button" className="sui-btn sui-btn--sm" onClick={downloadPdf}>
              Réessayer
            </button>
          </Notice>
        </div>
      ) : null}

      {previewOpen ? (
        <Viewer
          eyebrow="Devis"
          title={reference || "Aperçu"}
          description="Le document tel qu’il sera téléchargé ou imprimé."
          src={previewUrl}
          loading={loading}
          loadingLabel="Génération du PDF…"
          error={loadError}
          onRetry={() => {
            setLoadError(null);
            setAttempt((current) => current + 1);
          }}
          onClose={closePreview}
          actions={
            <>
              {/* `aria-label` : sous 720 px le libellé s'efface, et un texte
                  masqué ne nomme plus le bouton pour les lecteurs d'écran. */}
              <Button
                icon={Download}
                aria-label="Télécharger le PDF du devis"
                onClick={downloadPdf}
                disabled={!previewUrl || downloading}
              >
                <span className="sui-btn__label">{downloading ? "Préparation…" : "Télécharger"}</span>
              </Button>
            </>
          }
        />
      ) : null}
    </>
  );
}
