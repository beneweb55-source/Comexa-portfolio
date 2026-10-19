"use client";

import { use, useState } from "react";
import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { INVOICE_STATUS, INVOICE_STATUS_TONE, PAYMENT_METHOD, PAYMENT_RECORD_STATUS, remainingDue } from "@/lib/commercial";
import { useAction, useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Field, Notice, inputClass, primaryButton, secondaryButton, selectClass } from "@/components/workspace/ui";
import { InvoicePdfActions } from "@/components/workspace/invoices";

const TODAY = () => new Date().toISOString().slice(0, 10);

/** Fiche d'une facture : état, encaissements, envoi au client et annulation. */
export default function FactureDetailPage({ params }) {
  const { id } = use(params);
  const { user } = useAuth();
  const canSendInvoice = can(user, "invoice:send:any");
  const canManageInvoice = can(user, "invoice:write:any");
  const canRecordPayment = can(user, "payment:write:any");
  const invoice = useListing(`/invoices/${id}`);
  const action = useAction(invoice.reload);
  const [payment, setPayment] = useState({ amount: "", method: "BANK_TRANSFER", paidAt: TODAY(), externalReference: "", notes: "" });
  const [paymentError, setPaymentError] = useState(null);

  if (invoice.items === null) {
    return <div className="flex flex-col gap-6">{invoice.error ? <Notice>{invoice.error}</Notice> : <p className="text-[14px] text-[var(--comexa-ink-soft)]">Chargement…</p>}</div>;
  }

  const data = invoice.items;
  const due = remainingDue(data);
  const payments = data.payments ?? [];
  const isOpen = !["PAID", "CANCELLED", "REFUNDED"].includes(data.status);
  const canAcceptPayment = ["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(data.status);

  async function send() {
    await action.run("send", `/invoices/${id}/send`, { method: "POST" }, "Facture envoyée au client.");
  }

  async function cancel() {
    await action.run("cancel", `/invoices/${id}/cancel`, { method: "POST" }, "Facture annulée.");
  }

  async function recordPayment(event) {
    event.preventDefault();
    setPaymentError(null);
    const amount = Number(payment.amount);
    if (!(amount > 0)) {
      setPaymentError("Indiquez un montant supérieur à zéro.");
      return;
    }
    if (amount > due + 0.001) {
      setPaymentError(`Le montant dépasse le reste à payer (${formatMoney(due, data.currency)}).`);
      return;
    }
    const body = { amount, method: payment.method, paidAt: payment.paidAt || undefined };
    if (payment.externalReference.trim()) body.externalReference = payment.externalReference.trim();
    if (payment.notes.trim()) body.notes = payment.notes.trim();
    const result = await action.run("payment", `/invoices/${id}/payments`, { method: "POST", body }, "Encaissement enregistré.");
    if (result) setPayment({ amount: "", method: "BANK_TRANSFER", paidAt: TODAY(), externalReference: "", notes: "" });
  }

  return (
    <div className="flex flex-col gap-6">
      <nav className="text-[14px] text-[var(--comexa-ink-soft)]">
        <Link href="/espace-equipe/factures" className="hover:underline">
          ← Retour aux factures
        </Link>
      </nav>

      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}

      <Card
        title={`${data.reference}${data.subject ? ` · ${data.subject}` : ""}`}
        action={<Badge tone={INVOICE_STATUS_TONE[data.status] ?? "neutral"}>{INVOICE_STATUS[data.status] ?? data.status}</Badge>}
      >
        <dl className="grid gap-4 text-[14.5px] sm:grid-cols-3">
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Client</dt>
            <dd>{data.client?.companyName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Émise le</dt>
            <dd>{formatDate(data.issueDate)}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Échéance</dt>
            <dd>{formatDate(data.dueDate)}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Total TTC</dt>
            <dd>{formatMoney(data.total, data.currency)}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Déjà réglé</dt>
            <dd>{formatMoney(data.amountPaid, data.currency)}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Reste à payer</dt>
            <dd className="font-semibold">{formatMoney(due, data.currency)}</dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          {data.status === "DRAFT" && canSendInvoice ? (
            <button type="button" onClick={send} disabled={Boolean(action.busy)} className={primaryButton}>
              {action.busy === "send" ? "Envoi…" : "Envoyer au client"}
            </button>
          ) : null}
          {isOpen && Number(data.amountPaid) === 0 && canManageInvoice ? (
            <button type="button" onClick={cancel} disabled={Boolean(action.busy)} className={secondaryButton}>
              {action.busy === "cancel" ? "Annulation…" : "Annuler la facture"}
            </button>
          ) : null}
        </div>
      </Card>

      <InvoicePdfActions invoiceId={data.id} reference={data.reference} />

      {canAcceptPayment && due > 0 && canRecordPayment ? (
        <Card title="Enregistrer un encaissement">
          <form onSubmit={recordPayment} noValidate className="grid gap-4 md:grid-cols-3">
            <Field id="pay-amount" label={`Montant (${data.currency}) *`} hint={`Reste à payer : ${formatMoney(due, data.currency)}`}>
              <input id="pay-amount" type="number" min="0.01" step="0.01" max={due} className={inputClass} value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} />
            </Field>
            <Field id="pay-method" label="Moyen de paiement">
              <select id="pay-method" className={selectClass} value={payment.method} onChange={(event) => setPayment({ ...payment, method: event.target.value })}>
                {Object.entries(PAYMENT_METHOD).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="pay-date" label="Date de l'encaissement">
              <input id="pay-date" type="date" className={inputClass} value={payment.paidAt} onChange={(event) => setPayment({ ...payment, paidAt: event.target.value })} />
            </Field>
            <Field id="pay-ref" label="Référence externe" hint="Numéro de virement, de chèque…">
              <input id="pay-ref" className={inputClass} value={payment.externalReference} onChange={(event) => setPayment({ ...payment, externalReference: event.target.value })} maxLength={200} />
            </Field>
            <Field id="pay-notes" label="Notes">
              <input id="pay-notes" className={inputClass} value={payment.notes} onChange={(event) => setPayment({ ...payment, notes: event.target.value })} maxLength={2000} />
            </Field>
            {paymentError ? <Notice>{paymentError}</Notice> : null}
            <div className="md:col-span-3 flex justify-end">
              <button type="submit" disabled={Boolean(action.busy)} className={primaryButton}>
                {action.busy === "payment" ? "Enregistrement…" : "Enregistrer l'encaissement"}
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title="Encaissements">
        {payments.length === 0 ? <Empty>Aucun encaissement enregistré.</Empty> : null}
        <ul className="flex flex-col gap-3">
          {payments.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] p-3 text-[14px]">
              <div>
                <p className="font-medium text-[var(--comexa-ink)]">
                  {formatMoney(entry.amount, entry.currency ?? data.currency)} · {PAYMENT_METHOD[entry.method] ?? entry.method}
                </p>
                <p className="text-[var(--comexa-ink-soft)]">
                  {entry.reference} · {formatDate(entry.paidAt)}
                  {entry.externalReference ? ` · Réf. ${entry.externalReference}` : ""}
                </p>
              </div>
              <Badge tone={entry.status === "SUCCEEDED" ? "success" : entry.status === "FAILED" ? "danger" : "neutral"}>
                {PAYMENT_RECORD_STATUS[entry.status] ?? entry.status}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
