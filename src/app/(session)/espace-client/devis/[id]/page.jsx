"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/session";
import { formatDate, formatMoney } from "@/lib/api";
import { QUOTE_OPEN_STATUSES, QUOTE_STATUS, QUOTE_STATUS_TONE } from "@/lib/commercial";
import { useAction, useListing } from "@/lib/use-listing";
import { Badge, Card, Field, Notice, inputClass, primaryButton, secondaryButton } from "@/components/workspace/ui";

/**
 * Devis vu par le client. Il peut le consulter, l'accepter ou le refuser tant qu'il
 * est ouvert (envoyé ou consulté). Une fois tranché, la page reste en lecture seule.
 */
export default function DevisClientPage({ params }) {
  const { id } = use(params);
  const { user, request } = useAuth();
  const quote = useListing(`/quotes/${id}`);
  const action = useAction(quote.reload);
  const [confirming, setConfirming] = useState(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(null);
  const viewedOnce = useRef(false);

  // Premier affichage d'un devis envoyé : on le marque comme consulté (une seule fois).
  const currentStatus = quote.items?.status;
  const reloadQuote = quote.reload;
  useEffect(() => {
    if (currentStatus !== "SENT" || viewedOnce.current) return;
    viewedOnce.current = true;
    request(`/quotes/${id}/view`, { method: "POST" })
      .then(() => reloadQuote())
      .catch(() => {});
  }, [currentStatus, id, reloadQuote, request]);

  if (quote.items === null) {
    return <div className="flex flex-col gap-6">{quote.error ? <Notice>{quote.error}</Notice> : <p className="text-[14px] text-[var(--comexa-ink-soft)]">Chargement…</p>}</div>;
  }

  const data = quote.items;
  const isOpen = QUOTE_OPEN_STATUSES.includes(data.status);
  const items = data.items ?? [];

  async function accept() {
    const result = await action.run("accept", `/quotes/${id}/accept`, { method: "POST" }, "Devis accepté. Merci !");
    if (result) setConfirming(null);
  }

  async function refuse(event) {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setReasonError("Indiquez brièvement la raison du refus (3 caractères minimum).");
      return;
    }
    setReasonError(null);
    const result = await action.run("refuse", `/quotes/${id}/refuse`, { method: "POST", body: { reason: reason.trim() } }, "Votre refus a bien été transmis.");
    if (result) {
      setConfirming(null);
      setReason("");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <nav className="text-[14px] text-[var(--comexa-ink-soft)]">
        <Link href="/espace-client" className="hover:underline">
          ← Retour à mon espace
        </Link>
      </nav>

      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}

      <Card title={data.subject} action={<Badge tone={QUOTE_STATUS_TONE[data.status] ?? "neutral"}>{QUOTE_STATUS[data.status] ?? data.status}</Badge>}>
        <dl className="grid gap-4 text-[14.5px] sm:grid-cols-3">
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Référence</dt>
            <dd>{data.reference}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Émis le</dt>
            <dd>{formatDate(data.issueDate)}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Valable jusqu&apos;au</dt>
            <dd>{formatDate(data.validUntil)}</dd>
          </div>
        </dl>

        {data.status === "ACCEPTED" ? <p className="mt-4 text-[14.5px]">Vous avez accepté ce devis le {formatDate(data.acceptedAt)}.</p> : null}
        {data.status === "REJECTED" ? <p className="mt-4 text-[14.5px]">Vous avez refusé ce devis le {formatDate(data.rejectedAt)}.</p> : null}
        {data.status === "EXPIRED" ? <p className="mt-4 text-[14.5px]">Ce devis est arrivé à échéance. Contactez l&apos;agence pour un nouveau devis.</p> : null}
      </Card>

      <Card title="Détail des prestations">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[14px]">
            <thead className="border-b border-[var(--comexa-border-soft)] text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">
              <tr>
                <th className="py-2 pr-3">Prestation</th>
                <th className="py-2 pr-3 text-right">Qté</th>
                <th className="py-2 pr-3 text-right">Prix HT</th>
                <th className="py-2 text-right">Total HT</th>
              </tr>
            </thead>
            <tbody>
              {items.map((line) => (
                <tr key={line.id} className="border-b border-[var(--comexa-border-soft)] align-top">
                  <td className="py-3 pr-3">
                    <p className="font-medium text-[var(--comexa-ink)]">{line.title}</p>
                    {line.description ? <p className="text-[13px] text-[var(--comexa-ink-muted)]">{line.description}</p> : null}
                  </td>
                  <td className="py-3 pr-3 text-right">{Number(line.quantity)}</td>
                  <td className="py-3 pr-3 text-right">{formatMoney(line.unitPrice, data.currency)}</td>
                  <td className="py-3 text-right font-medium">{formatMoney(line.lineTotal, data.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-6 ml-auto grid max-w-[320px] grid-cols-2 gap-2 text-[14.5px]">
          <dt>Sous-total HT</dt>
          <dd className="text-right">{formatMoney(data.subtotal, data.currency)}</dd>
          <dt>TVA ({Number(data.taxRate)} %)</dt>
          <dd className="text-right">{formatMoney(data.taxAmount, data.currency)}</dd>
          <dt className="font-semibold">Total TTC</dt>
          <dd className="text-right font-semibold">{formatMoney(data.total, data.currency)}</dd>
        </dl>
        {data.notes ? <p className="mt-6 whitespace-pre-line text-[14px] text-[var(--comexa-ink-soft)]">{data.notes}</p> : null}
        {data.terms ? <p className="mt-4 whitespace-pre-line text-[13px] text-[var(--comexa-ink-muted)]">{data.terms}</p> : null}
      </Card>

      {isOpen ? (
        <Card title="Votre décision">
          {confirming === null ? (
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => setConfirming("accept")} className={primaryButton}>
                Accepter le devis
              </button>
              <button type="button" onClick={() => setConfirming("refuse")} className={secondaryButton}>
                Refuser
              </button>
            </div>
          ) : null}

          {confirming === "accept" ? (
            <div className="flex flex-col gap-3">
              <p className="text-[15px]">
                En acceptant, vous confirmez la commande des prestations ci-dessus pour un montant de {formatMoney(data.total, data.currency)} TTC. Une facture vous sera
                transmise.
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={accept} disabled={action.busy === "accept"} className={primaryButton}>
                  {action.busy === "accept" ? "Validation…" : "Confirmer l'acceptation"}
                </button>
                <button type="button" onClick={() => setConfirming(null)} className={secondaryButton}>
                  Annuler
                </button>
              </div>
            </div>
          ) : null}

          {confirming === "refuse" ? (
            <form onSubmit={refuse} noValidate className="flex flex-col gap-3">
              <Field id="refuse-reason" label="Raison du refus *" error={reasonError}>
                <input id="refuse-reason" className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} />
              </Field>
              <div className="flex gap-3">
                <button type="submit" disabled={action.busy === "refuse"} className={primaryButton}>
                  {action.busy === "refuse" ? "Envoi…" : "Confirmer le refus"}
                </button>
                <button type="button" onClick={() => setConfirming(null)} className={secondaryButton}>
                  Annuler
                </button>
              </div>
            </form>
          ) : null}
        </Card>
      ) : null}

      <p className="text-[13px] text-[var(--comexa-ink-muted)]">Connecté en tant que {user ? `${user.firstName} ${user.lastName}` : "—"}.</p>
    </div>
  );
}
