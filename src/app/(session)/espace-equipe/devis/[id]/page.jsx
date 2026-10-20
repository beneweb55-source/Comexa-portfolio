"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDate, formatMoney } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { QUOTE_STATUS, QUOTE_STATUS_TONE, daysFromToday } from "@/lib/commercial";
import { useAction, useListing } from "@/lib/use-listing";
import { Badge, Card, Notice, primaryButton, secondaryButton } from "@/components/workspace/ui";
import QuotePdfActions from "@/components/workspace/invoices/QuotePdfActions";

/**
 * Fiche d'un devis. Le cycle est linéaire : brouillon → envoyé (le client le consulte,
 * l'accepte ou le refuse) → facture, une fois accepté. Chaque action n'est proposée
 * que dans l'état où elle a un sens ; le serveur reste le juge final.
 */
export default function DevisDetailPage({ params }) {
  const { id } = use(params);
  const { user } = useAuth();
  const canSendQuote = can(user, "quote:send:any");
  const canCreateInvoice = can(user, "invoice:write:any");
  const canReadInvoices = can(user, "invoice:read:any");
  const router = useRouter();
  const quote = useListing(`/quotes/${id}`);
  const action = useAction(quote.reload);
  const [invoiceCreated, setInvoiceCreated] = useState(null);

  if (quote.items === null) {
    return (
      <div className="flex flex-col gap-6">
        {quote.error ? <Notice>{quote.error}</Notice> : <p className="text-[14px] text-[var(--comexa-ink-soft)]">Chargement…</p>}
      </div>
    );
  }

  const data = quote.items;
  const items = data.items ?? [];
  const recipient = data.client
    ? data.client.companyName
    : data.prospect
      ? data.prospect.companyName || `${data.prospect.contactFirstName} ${data.prospect.contactLastName}`
      : "Destinataire non renseigné";

  async function send() {
    await action.run("send", `/quotes/${id}/send`, { method: "POST" }, "Devis envoyé au client.");
  }

  async function createInvoice() {
    setInvoiceCreated(null);
    const response = await action.run(
      "invoice",
      `/quotes/${id}/invoice`,
      { method: "POST", body: { dueDate: daysFromToday(30) } },
      "Facture créée à partir du devis.",
    );
    const invoice = response?.data;
    if (invoice?.id) setInvoiceCreated(invoice);
  }

  return (
    <div className="flex flex-col gap-6">
      <nav className="text-[14px] text-[var(--comexa-ink-soft)]">
        <Link href="/espace-equipe/devis" className="hover:underline">
          ← Retour aux devis
        </Link>
      </nav>

      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}
      {invoiceCreated?.id ? (
        <Notice tone="success">
          Facture {invoiceCreated.reference} créée.{" "}
          {canReadInvoices ? (
            <button type="button" className="underline" onClick={() => router.push(`/espace-equipe/factures/${invoiceCreated.id}`)}>
              Ouvrir la facture
            </button>
          ) : null}
        </Notice>
      ) : null}

      <Card
        title={data.subject}
        action={<Badge tone={QUOTE_STATUS_TONE[data.status] ?? "neutral"}>{QUOTE_STATUS[data.status] ?? data.status}</Badge>}
      >
        <dl className="grid gap-4 text-[14.5px] sm:grid-cols-3">
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Référence</dt>
            <dd>{data.reference}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Destinataire</dt>
            <dd>{recipient}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Émis le</dt>
            <dd>{formatDate(data.issueDate)}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Valable jusqu&apos;au</dt>
            <dd>{formatDate(data.validUntil)}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Envoyé le</dt>
            <dd>{data.sentAt ? formatDate(data.sentAt) : "Pas encore envoyé"}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Consulté le</dt>
            <dd>{data.viewedAt ? formatDate(data.viewedAt) : "—"}</dd>
          </div>
        </dl>

        {data.status === "ACCEPTED" ? (
          <p className="mt-4 text-[14.5px] text-[var(--comexa-ink)]">
            Accepté le {formatDate(data.acceptedAt)} par {data.acceptedByName || "le client"}.
          </p>
        ) : null}
        {data.status === "REJECTED" ? (
          <p className="mt-4 text-[14.5px] text-[var(--comexa-ink)]">Refusé le {formatDate(data.rejectedAt)}. Motif : {data.rejectionReason || "non précisé"}</p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          {data.status === "DRAFT" && canSendQuote ? (
            <button type="button" onClick={send} disabled={Boolean(action.busy)} className={primaryButton}>
              {action.busy === "send" ? "Envoi…" : "Envoyer au client"}
            </button>
          ) : null}
          {data.status === "ACCEPTED" && canCreateInvoice ? (
            <button type="button" onClick={createInvoice} disabled={Boolean(action.busy)} className={primaryButton}>
              {action.busy === "invoice" ? "Création…" : "Créer la facture"}
            </button>
          ) : null}
          {data.status === "DRAFT" ? <span className="self-center text-[14px] text-[var(--comexa-ink-soft)]">Le devis doit être envoyé avant d&apos;être accepté par le client.</span> : null}
        </div>
      </Card>

      <QuotePdfActions quoteId={data.id} reference={data.reference} />

      <Card title="Prestations">
        <div className="overflow-x-auto">
          <table className="cx-stack-table w-full text-left text-[14px]">
            <thead className="border-b border-[var(--comexa-border-soft)] text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">
              <tr>
                <th className="py-2 pr-3">Intitulé</th>
                <th className="py-2 pr-3 text-right">Qté</th>
                <th className="py-2 pr-3 text-right">Prix HT</th>
                <th className="py-2 pr-3 text-right">Remise</th>
                <th className="py-2 text-right">Total HT</th>
              </tr>
            </thead>
            <tbody>
              {items.map((line) => (
                <tr key={line.id} className="border-b border-[var(--comexa-border-soft)] align-top">
                  <td className="py-3 pr-3" data-label="Intitulé">
                    <p className="font-medium text-[var(--comexa-ink)]">{line.title}</p>
                    {line.description ? <p className="text-[13px] text-[var(--comexa-ink-muted)]">{line.description}</p> : null}
                  </td>
                  <td className="py-3 pr-3 text-right" data-label="Qté">{Number(line.quantity)}</td>
                  <td className="py-3 pr-3 text-right" data-label="Prix HT">{formatMoney(line.unitPrice, data.currency)}</td>
                  <td className="py-3 pr-3 text-right" data-label="Remise">{Number(line.discountPercent) ? `${Number(line.discountPercent)} %` : "—"}</td>
                  <td className="py-3 text-right font-medium" data-label="Total HT">{formatMoney(line.lineTotal, data.currency)}</td>
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
        <div className="mt-4">
          <button type="button" onClick={() => window.print()} className={secondaryButton}>
            Imprimer
          </button>
        </div>
      </Card>
    </div>
  );
}
