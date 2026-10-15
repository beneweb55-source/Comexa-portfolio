"use client";

import { useState } from "react";
import { ArrowUpRight, CalendarDays, CircleAlert, ReceiptText, Users } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/api";
import { INVOICE_STATUS, INVOICE_STATUS_TONE, remainingDue } from "@/lib/commercial";
import { useListing } from "@/lib/use-listing";
import { Empty, Pagination, SkeletonList } from "@/components/workspace/ui";
import { Alert, FilterPills, ItemCard, ItemGrid } from "@/components/softui";
import { useShellQuery } from "@/components/softui/Shell";

const TONE_MAP = { success: "green", warning: "yellow", danger: "pink", info: "blue", neutral: "plain" };

export default function FacturesEquipePage() {
  const { query } = useShellQuery();
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), perPage: "50" });
  if (filter) params.set("status", filter);
  if (query.trim()) params.set("search", query.trim());

  const invoices = useListing(`/invoices?${params.toString()}`);
  const items = invoices.items ?? [];

  return (
    <div className="flex flex-col gap-5">
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
        {invoices.items === null && !invoices.error ? <SkeletonList rows={4} /> : null}
        {invoices.items !== null && items.length === 0 ? (
          <Empty icon={ReceiptText}>Aucune facture pour ces critères.</Empty>
        ) : null}

        {items.length > 0 ? (
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
                    {
                      icon: ArrowUpRight,
                      label: `Ouvrir la facture ${invoice.reference}`,
                      href: `/espace-equipe/factures/${invoice.id}`,
                      variant: "dark",
                    },
                  ]}
                />
              );
            })}
          </ItemGrid>
        ) : null}

        <Pagination meta={invoices.meta} onPageChange={setPage} loading={invoices.loading} />
      </section>
    </div>
  );
}
