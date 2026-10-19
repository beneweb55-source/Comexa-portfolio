"use client";

import { useState } from "react";
import { Download, Eye, Mail } from "lucide-react";
import { Button, IconButton } from "@/components/softui/primitives";
import { useAuth } from "@/lib/session";
import { can, canAny } from "@/lib/access";
import { Notice } from "@/components/workspace/ui";
import { InvoicePdfPreview } from "./InvoicePdfPreview";
import { PdfEmailDialog } from "./PdfEmailDialog";

/*
 * Rangée d'actions PDF d'une facture : aperçu, téléchargement, envoi par email.
 *
 * Habillée par le design system (`sui-btn` / `sui-iconbtn`) au lieu des anciens
 * jetons `--comexa-*` : elle vit au milieu de panneaux soft UI, et ses boutons
 * bleus saturés étaient les derniers de la page à ne pas suivre la charte.
 *
 * UNE ACTION, UN CLIC. Le bouton « Email » ouvrait auparavant l'APERÇU complet —
 * génération du PDF comprise — dans lequel il fallait retrouver un second bouton
 * « Envoyer par Email ». Il ouvre maintenant le formulaire d'envoi directement,
 * le même que celui du lecteur. Le doublon signalé sur la capture d'écran vient
 * de là : ce n'était pas deux fois la même chose, c'était la même chose en deux
 * clics.
 *
 * `size="sm"` (rangées de liste) rend trois boutons icône de 34 px avec infobulle
 * plutôt que trois libellés : la place manque, et l'icône suffit quand le
 * contexte dit déjà de quelle facture il s'agit.
 *
 * Les trois erreurs invisibles corrigées ici autrefois restent corrigées : `can()`
 * prend une permission complète (`invoice:read:any`), pas un couple
 * ressource/action ; le droit d'envoi réel est `invoice:send:any` (il n'existe pas
 * de `email:send:any` dans le catalogue) ; et `useAuth()` est appelé dans le corps
 * du composant, jamais à l'intérieur d'une fonction asynchrone.
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);

  // Lecture : le portail client passe par `invoice:read:own`, l'équipe par
  // `invoice:read:any`. C'est exactement la porte posée par le contrôleur.
  const canRead = canAny(user, ["invoice:read:any", "invoice:read:own"]);
  // Envoi : c'est l'équipe qui envoie la facture au client, jamais le client qui
  // se l'envoie à lui-même. D'où `:any` seul.
  const canSendEmail = can(user, "invoice:send:any");

  /* Télécharger directement le PDF. `download` porte le jeton, l'espace actif et
     le rafraîchissement sur 401 : le refaire à la main ici serait une deuxième
     implémentation du même protocole, condamnée à diverger. */
  async function downloadPdf() {
    if (!canRead || downloading) return;

    setDownloading(true);
    setError(null);
    try {
      const safeReference = String(reference || invoiceId).replace(/[^A-Za-z0-9._-]/g, "-");
      await download(`/pdf/invoices/${invoiceId}`, `COMEXA-FACTURE-${safeReference}.pdf`);
    } catch {
      setError("Le PDF n’a pas pu être téléchargé.");
    } finally {
      setDownloading(false);
    }
  }

  if (!canRead) return null;

  const compact = size === "sm";
  const emailSubject = reference ? `Facture ${reference}` : "";

  const actions = [
    showPreviewButton
      ? {
          key: "preview",
          label: "Aperçu",
          title: "Aperçu du PDF",
          icon: Eye,
          primary: true,
          onClick: () => setPreviewOpen(true),
        }
      : null,
    showDownloadButton
      ? {
          key: "download",
          label: downloading ? "Préparation…" : "Télécharger",
          title: "Télécharger le PDF",
          icon: Download,
          busy: downloading,
          onClick: downloadPdf,
        }
      : null,
    showEmailButton && canSendEmail
      ? {
          key: "email",
          label: "Email",
          title: "Envoyer la facture par email",
          icon: Mail,
          onClick: () => setEmailOpen(true),
        }
      : null,
  ].filter(Boolean);

  if (!actions.length && !error) return null;

  return (
    <>
      {actions.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((action) =>
            compact ? (
              <IconButton
                key={action.key}
                icon={action.icon}
                label={action.title}
                size="sm"
                busy={action.busy}
                onClick={action.onClick}
              />
            ) : (
              <Button
                key={action.key}
                icon={action.icon}
                variant={action.primary ? "dark" : "ghost"}
                disabled={action.busy}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ),
          )}
        </div>
      ) : null}

      {error ? (
        <div className="mt-2">
          <Notice>
            {error}{" "}
            <button type="button" className="sui-btn sui-btn--sm" onClick={downloadPdf}>
              Réessayer
            </button>
          </Notice>
        </div>
      ) : null}

      {previewOpen ? (
        <InvoicePdfPreview
          invoiceId={invoiceId}
          reference={reference}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}

      {emailOpen && canSendEmail ? (
        <PdfEmailDialog
          endpoint={`/pdf/invoices/${invoiceId}/email`}
          title={reference ? `Envoyer la facture ${reference}` : "Envoyer la facture"}
          description="Le PDF est joint au message."
          defaultSubject={emailSubject}
          onClose={() => setEmailOpen(false)}
        />
      ) : null}
    </>
  );
}

export default InvoicePdfActions;
