"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/api";
import { INVOICE_STATUS, INVOICE_STATUS_TONE, remainingDue } from "@/lib/commercial";
import { useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Notice, inputClass } from "@/components/workspace/ui";

export default function FacturesEquipePage() {
  const [filter, setFilter] = useState("");
  const path = filter ? `/invoices?perPage=50&status=${filter}` : "/invoices?perPage=50";
  const invoices = useListing(path);
  const items = invoices.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      {invoices.error ? <Notice>{invoices.error}</Notice> : null}
      <Card
        title="Factures"
        action={
          <select value={filter} onChange={(event) => setFilter(event.target.value)} className={`${inputClass} h-9 w-auto text-[13px]`} aria-label="Filtrer par statut">
            <option value="">Tous les statuts</option>
            {Object.entries(INVOICE_STATUS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        }
      >
        {invoices.items === null && !invoices.error ? <p className="text-[14px] text-[var(--comexa-ink-soft)]">Chargement…</p> : null}
        {invoices.items !== null && items.length === 0 ? <Empty>Aucune facture pour ces critères.</Empty> : null}

        <ul className="flex flex-col gap-3">
          {items.map((invoice) => (
            <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] p-4">
              <div className="min-w-0">
                <p className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">
                  {invoice.reference} · émise le {formatDate(invoice.issueDate)} · échéance {formatDate(invoice.dueDate)}
                </p>
                <h3 className="text-[16px] font-semibold text-[var(--comexa-ink)]">
                  <Link href={`/espace-equipe/factures/${invoice.id}`} className="hover:underline">
                    {invoice.subject || invoice.reference}
                  </Link>
                </h3>
                <p className="text-[13.5px] text-[var(--comexa-ink-soft)]">
                  {invoice.client?.companyName ?? "Client non renseigné"}
                  {" · "}Reste à payer : {formatMoney(remainingDue(invoice), invoice.currency)}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[15px] font-medium text-[var(--comexa-ink)]">{formatMoney(invoice.total, invoice.currency)}</span>
                <Badge tone={INVOICE_STATUS_TONE[invoice.status] ?? "neutral"}>{INVOICE_STATUS[invoice.status] ?? invoice.status}</Badge>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
