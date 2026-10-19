"use client";

import { useEffect, useState } from "react";
import { Download, Mail } from "lucide-react";
import Viewer from "@/components/softui/Viewer";
import Dialog from "@/components/softui/Dialog";
import { Button } from "@/components/softui/primitives";
import { useAuth } from "@/lib/session";
import { can, canAny } from "@/lib/access";
import { useActionNotification } from "@/components/workspace/ui/ActionNotification";
import { PdfEmailDialog } from "./PdfEmailDialog";

/*
 * Aperçu du PDF d'une facture.
 *
 * Ce composant ne s'occupe plus que de trois choses : obtenir le document,
 * décider qui a le droit de le voir, et proposer les deux actions qui le
 * concernent (télécharger, envoyer). L'affichage est confié à `Viewer`, le volet
 * du design system — le même que pour les devis.
 *
 * POURQUOI `blobUrl` ET PAS UN `src` DIRECT. Un `<iframe src>` ne peut pas porter
 * l'en-tête `Authorization`, et le jeton d'accès vit en mémoire : le PDF doit
 * donc être chargé par un `fetch` authentifié, puis présenté au cadre sous forme
 * d'URL d'objet. `blobUrl()` fait cela avec le rafraîchissement du jeton sur 401
 * et le rejeu de la requête — le même protocole que `download()`, écrit une seule
 * fois. (Une version précédente testait `response.ok` sur l'enveloppe JSON déjà
 * parsée de `request()` : toujours `undefined`, donc un cadre vide sans message.)
 *
 * L'URL d'objet est révoquée à la fermeture : sans cela, chaque aperçu laisse un
 * blob en mémoire jusqu'au rechargement de la page.
 */

export function InvoicePdfPreview({ invoiceId, reference, onClose }) {
  const { download, blobUrl, user } = useAuth();
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [emailOpen, setEmailOpen] = useState(false);
  const { showNotification, NotificationComponent } = useActionNotification();

  // Lecture : le portail client passe par `invoice:read:own`, l'équipe par
  // `invoice:read:any`. C'est exactement la porte posée par le contrôleur.
  const canRead = canAny(user, ["invoice:read:any", "invoice:read:own"]);
  // Envoi : c'est l'équipe qui envoie la facture au client, jamais le client qui
  // se l'envoie à lui-même. D'où `:any` seul.
  const canSendEmail = can(user, "invoice:send:any");

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
  }, [invoiceId, canRead, blobUrl, attempt]);

  /* L'état de chargement se DÉDUIT de ce que l'on détient, au lieu d'être un
     quatrième état à garder synchronisé : pas d'URL et pas d'erreur, c'est que le
     chargement est en cours. */
  const loading = previewUrl === null && loadError === null;

  async function downloadPdf() {
    try {
      const safeReference = String(reference || invoiceId).replace(/[^A-Za-z0-9._-]/g, "-");
      await download(`/pdf/invoices/${invoiceId}`, `COMEXA-FACTURE-${safeReference}.pdf`);
    } catch {
      showNotification({ message: "Le PDF n’a pas pu être téléchargé.", duration: 5000 });
    }
  }

  function retry() {
    setLoadError(null);
    setAttempt((current) => current + 1);
  }

  if (!canRead) {
    return (
      <Dialog
        title="Accès refusé"
        tone="pink"
        onClose={onClose}
        footer={
          <button type="button" className="sui-btn sui-btn--dark" onClick={onClose}>
            Fermer
          </button>
        }
      >
        <p className="sui-dialog__desc">Vous n’avez pas les permissions pour consulter cette facture.</p>
      </Dialog>
    );
  }

  return (
    <>
      {NotificationComponent}

      <Viewer
        eyebrow="Facture"
        title={reference || "Aperçu"}
        description="Le document tel qu’il sera téléchargé, imprimé ou envoyé."
        src={previewUrl}
        loading={loading}
        loadingLabel="Génération du PDF…"
        error={loadError}
        onRetry={retry}
        onClose={onClose}
        actions={
          <>
            {/* `aria-label` : sous 720 px le libellé s'efface (`.sui-btn__label`)
                et un `display: none` retire aussi le texte de l'arbre
                d'accessibilité — sans nom de remplacement, le bouton devenait
                muet pour les lecteurs d'écran. */}
            <Button icon={Download} aria-label="Télécharger le PDF" onClick={downloadPdf} disabled={!previewUrl}>
              <span className="sui-btn__label">Télécharger</span>
            </Button>
            {canSendEmail ? (
              <Button icon={Mail} aria-label="Envoyer la facture par email" onClick={() => setEmailOpen(true)}>
                <span className="sui-btn__label">Email</span>
              </Button>
            ) : null}
          </>
        }
      />

      {emailOpen && canSendEmail ? (
        <PdfEmailDialog
          endpoint={`/pdf/invoices/${invoiceId}/email`}
          title={reference ? `Envoyer la facture ${reference}` : "Envoyer la facture"}
          description="Le PDF est joint au message."
          defaultSubject={reference ? `Facture ${reference}` : ""}
          onClose={() => setEmailOpen(false)}
        />
      ) : null}
    </>
  );
}

export default InvoicePdfPreview;
