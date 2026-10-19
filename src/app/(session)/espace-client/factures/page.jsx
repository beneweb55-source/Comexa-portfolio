"use client";

import { useState } from "react";
import { CalendarDays, CircleAlert, ReceiptText } from "lucide-react";
import { formatDateOnly, formatMoney } from "@/lib/api";
import { INVOICE_STATUS, INVOICE_STATUS_TONE, remainingDue } from "@/lib/commercial";
import { useListing } from "@/lib/use-listing";
import { Empty, Pagination, SkeletonList } from "@/components/workspace/ui";
import { Alert, Panel, StatusPill } from "@/components/softui";
import { InvoicePdfActions } from "@/components/workspace/invoices";

const TONE_MAP = { success: "green", warning: "yellow", danger: "pink", info: "blue", neutral: "plain" };

function statusTone(status) {
  return TONE_MAP[INVOICE_STATUS_TONE[status]] ?? "plain";
}

/** Factures émises du dossier client connecté, avec aperçu et téléchargement authentifiés. */
export default function FacturesClientPage() {
  const [page, setPage] = useState(1);
  const invoices = useListing(`/invoices?page=${page}&perPage=25`);
  const items = invoices.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Mes factures"
        subtitle="Consultez les factures émises pour votre dossier, leur échéance et le solde restant."
      >
        {invoices.error ? <Alert icon={CircleAlert}>{invoices.error}</Alert> : null}
        {invoices.items === null && !invoices.error ? <SkeletonList rows={4} /> : null}
        {invoices.items !== null && items.length === 0 ? (
          <Empty icon={ReceiptText}>
            Aucune facture émise pour le moment. Une facture apparaît ici lorsqu’elle est envoyée par l’équipe Comexa.
          </Empty>
        ) : null}

        {items.length > 0 ? (
          <ul className="flex flex-col gap-3" aria-label="Factures émises">
            {items.map((invoice) => (
              <li key={invoice.id} className="sui-row">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="sui-row__title">{invoice.subject || `Facture ${invoice.reference}`}</h2>
                      <StatusPill tone={statusTone(invoice.status)} label={INVOICE_STATUS[invoice.status] ?? invoice.status} />
                    </div>
                    <p className="sui-chat__preview mt-1">Référence : {invoice.reference}</p>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--comexa-ink-muted)]">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays size={14} aria-hidden="true" /> Émise le {formatDateOnly(invoice.issueDate)}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays size={14} aria-hidden="true" /> Échéance : {formatDateOnly(invoice.dueDate)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-start gap-1 sm:items-end">
                    <strong className="sui-tabular">{formatMoney(invoice.total, invoice.currency)}</strong>
                    <span className="text-sm text-[var(--comexa-ink-muted)]">
                      Réglé : {formatMoney(invoice.amountPaid, invoice.currency)}
                    </span>
                    <span className="text-sm text-[var(--comexa-ink-muted)]">
                      Solde : {formatMoney(remainingDue(invoice), invoice.currency)}
                    </span>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--comexa-border-soft)] pt-3">
                  <InvoicePdfActions
                    invoiceId={invoice.id}
                    reference={invoice.reference}
                    showEmailButton={false}
                    size="sm"
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <Pagination meta={invoices.meta} onPageChange={setPage} loading={invoices.loading} />
      </Panel>
    </div>
  );
}
