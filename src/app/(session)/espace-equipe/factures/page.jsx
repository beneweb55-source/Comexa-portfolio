"use client";

/*
 * Factures (espace équipe) — même appel `/invoices`, filtres en pilules,
 * grille de cartes avec montant total, reste à payer, pilule de statut et action
 * principale noire. Aucune règle métier ne bouge : `remainingDue` reste la source
 * du « reste à payer ».
 */

import { useState } from "react";
import { ArrowUpRight, CalendarDays, CircleAlert, ReceiptText, Users } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/api";
import { INVOICE_STATUS, INVOICE_STATUS_TONE, remainingDue } from "@/lib/commercial";
import { useListing } from "@/lib/use-listing";
import { Pagination } from "@/components/workspace/ui";
import { Alert, FilterPills, ItemCard, ItemGrid } from "@/components/softui";

const TONE_MAP = { success: "green", warning: "yellow", danger: "pink", info: "blue", neutral: "plain" };

export default function FacturesEquipePage() {
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), perPage: "50" });
  if (filter) query.set("status", filter);
  const invoices = useListing(`/invoices?${query.toString()}`);
  const items = invoices.items ?? [];

  return (
    <div className="flex flex-col">
      {invoices.error ? <Alert icon={CircleAlert}>{invoices.error}</Alert> : null}

      <FilterPills
        label="Filtrer les factures par statut"
        value={filter}
        onChange={(value) => {
          setFilter(value);
          setPage(1);
        }}
        items={[{ id: "", label: "Tous" }, ...Object.entries(INVOICE_STATUS).map(([id, label]) => ({ id, label }))]}
      />

      <section className="sui-section" aria-label="Liste des factures">
        {invoices.items === null && !invoices.error ? <p className="sui-card__desc" role="status">Chargement des factures…</p> : null}
        {invoices.items !== null && items.length === 0 ? <p className="sui-card__desc">Aucune facture pour ces critères.</p> : null}

        <ItemGrid label="Factures">
          {items.map((invoice) => {
            const tone = TONE_MAP[INVOICE_STATUS_TONE[invoice.status]] ?? "plain";
            return (
              <ItemCard
                key={invoice.id}
                cornerIcon={ReceiptText}
                cornerTone={tone === "plain" ? "lilac" : tone}
                title={invoice.subject || invoice.reference}
                description={invoice.client?.companyName ?? "Client non renseigné"}
                meta={[
                  { icon: Users, label: invoice.reference },
                  { icon: CalendarDays, label: `Émise le ${formatDate(invoice.issueDate)}` },
                  { icon: CalendarDays, label: `Échéance ${formatDate(invoice.dueDate)}` },
                ]}
                info={`${formatMoney(invoice.total, invoice.currency)} · reste ${formatMoney(remainingDue(invoice), invoice.currency)}`}
                status={INVOICE_STATUS[invoice.status] ?? invoice.status}
                statusTone={tone}
                actions={[
                  { icon: ArrowUpRight, label: `Ouvrir la facture ${invoice.reference}`, href: `/espace-equipe/factures/${invoice.id}`, variant: "dark" },
                ]}
              />
            );
          })}
        </ItemGrid>

        <Pagination meta={invoices.meta} onPageChange={setPage} loading={invoices.loading} />
      </section>
    </div>
  );
}
