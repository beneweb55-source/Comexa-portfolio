"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { messageOf } from "@/lib/api";
import Dialog from "@/components/softui/Dialog";

export default function DeleteDocumentButton({ resource, id, label, returnTo }) {
  const { user, request } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const permission = { quotes: "quote", invoices: "invoice", documents: "document" }[resource];
  if (!permission || !can(user, `${permission}:delete:any`)) return null;

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await request(`/${resource}/${id}`, { method: "DELETE" });
      setSuccess(true);
      window.dispatchEvent(new CustomEvent("comexa:document-deleted", { detail: label || "Document" }));
      // Keep confirmation mounted until acknowledged, including on detail pages.
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (busy) return;
    setOpen(false);
    if (success && returnTo) router.replace(returnTo);
  }
  return <>
    <button type="button" className="sui-btn sui-btn--ghost" onClick={() => setOpen(true)}>Supprimer</button>
    {open ? <Dialog title={success ? "Suppression effectuée" : `Supprimer ${label || "ce document"} ?`} onClose={close}
      footer={success ? <button className="sui-btn sui-btn--dark" onClick={close}>Fermer</button> : <>
        <button className="sui-btn" disabled={busy} onClick={close}>Annuler</button>
        <button className="sui-btn sui-btn--dark" disabled={busy} onClick={remove}>{busy ? "Suppression…" : "Confirmer la suppression"}</button>
      </>}>
      {success ? <p role="status">Le document a été supprimé.</p> : <p>Le document sera retiré des listes et des totaux, quel que soit son statut. Les projets, factures et encaissements liés restent conservés pour leur traçabilité. Cette action ne rembourse aucun paiement.</p>}
      {error ? <p role="alert">{error}</p> : null}
    </Dialog> : null}
  </>;
}

/** Survit au démontage de la ligne supprimée et annonce le résultat aux lecteurs d’écran. */
export function DocumentDeletionFeedback() {
  const [message, setMessage] = useState(null);
  useEffect(() => {
    const show = (event) => setMessage(`${event.detail} : suppression effectuée.`);
    window.addEventListener('comexa:document-deleted', show);
    return () => window.removeEventListener('comexa:document-deleted', show);
  }, []);
  if (!message) return null;
  return <div role="status" className="sui-card" style={{ position: 'fixed', bottom: 90, left: 16, right: 16, zIndex: 100, maxWidth: 480, padding: 16 }}>
    <p>{message}</p><button className="sui-btn" onClick={() => setMessage(null)}>Fermer</button>
  </div>;
}
