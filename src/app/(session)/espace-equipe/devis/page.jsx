"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/api";
import { QUOTE_STATUS, QUOTE_STATUS_TONE } from "@/lib/commercial";
import { useListing } from "@/lib/use-listing";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { Badge, Card, Empty, Notice, Pagination, inputClass, primaryButton } from "@/components/workspace/ui";

export default function DevisEquipePage() {
  const { user } = useAuth();
  const canCreateQuote = can(user, "quote:write:any");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), perPage: "50" });
  if (filter) query.set("status", filter);
  const quotes = useListing(`/quotes?${query.toString()}`);
  const items = quotes.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      {quotes.error ? <Notice>{quotes.error}</Notice> : null}
      <Card
        title="Devis"
        action={
          <div className="flex items-center gap-3">
            <select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }} className={`${inputClass} h-10 w-auto text-[13px]`} aria-label="Filtrer par statut">
              <option value="">Tous les statuts</option>
              {Object.entries(QUOTE_STATUS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {canCreateQuote ? (
              <Link href="/espace-equipe/devis/nouveau" className={primaryButton}>
                Nouveau devis
              </Link>
            ) : null}
          </div>
        }
      >
        {quotes.items === null && !quotes.error ? <p className="text-[14px] text-[var(--comexa-ink-soft)]">Chargement…</p> : null}
        {quotes.items !== null && items.length === 0 ? <Empty>Aucun devis pour ces critères.</Empty> : null}

        <ul className="flex flex-col gap-3">
          {items.map((quote) => (
            <li key={quote.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] p-4">
              <div className="min-w-0">
                <p className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">
                  {quote.reference} · {formatDate(quote.issueDate)}
                </p>
                <h3 className="text-[16px] font-semibold text-[var(--comexa-ink)]">
                  <Link href={`/espace-equipe/devis/${quote.id}`} className="hover:underline">
                    {quote.subject}
                  </Link>
                </h3>
                <p className="text-[13.5px] text-[var(--comexa-ink-soft)]">
                  {quote.client ? `${quote.client.companyName}` : quote.prospect ? `${quote.prospect.companyName || quote.prospect.email} (prospect)` : "Destinataire non renseigné"}
                  {" · "}
                  Valable jusqu&apos;au {formatDate(quote.validUntil)}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[15px] font-medium text-[var(--comexa-ink)]">{formatMoney(quote.total, quote.currency)}</span>
                <Badge tone={QUOTE_STATUS_TONE[quote.status] ?? "neutral"}>{QUOTE_STATUS[quote.status] ?? quote.status}</Badge>
              </div>
            </li>
          ))}
        </ul>
        <Pagination meta={quotes.meta} onPageChange={setPage} loading={quotes.loading} />
      </Card>
    </div>
  );
}
