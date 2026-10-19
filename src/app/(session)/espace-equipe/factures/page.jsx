"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, CircleAlert, Hash, ReceiptText, TriangleAlert } from "lucide-react";
import { formatDateOnly, formatMoney } from "@/lib/api";
import { isDeadlinePassed } from "@/lib/date-utils.mjs";
import { INVOICE_STATUS, INVOICE_STATUS_TONE, remainingDue } from "@/lib/commercial";
import { useListing } from "@/lib/use-listing";
import { useAllListing } from "@/lib/use-all-listing";
import { Empty, Pagination, SkeletonList } from "@/components/workspace/ui";
import { Alert, FilterPills, ItemCard, ItemGrid, KpiGrid, StatusPill } from "@/components/softui";
import { ListTable, ViewToggle, useViewMode } from "@/components/softui/ListView";
import { useShellQuery } from "@/components/softui/Shell";
import { InvoicePdfActions } from "@/components/workspace/invoices";

const TONE_MAP = { success: "green", warning: "yellow", danger: "pink", info: "blue", neutral: "plain" };

/* Ordre des filtres : ce qui demande une action d'abord (retards, soldes
   ouverts), puis le reste du cycle de vie. */
const STATUS_ORDER = ["OVERDUE", "SENT", "PARTIALLY_PAID", "DRAFT", "PAID", "CANCELLED", "REFUNDED"];
/* Factures émises et non tranchées : elles portent un solde à encaisser. */
const OPEN = ["SENT", "PARTIALLY_PAID", "OVERDUE"];
/* Factures qui comptent dans le chiffre facturé (ni brouillon, ni annulée, ni remboursée). */
const BILLED = ["SENT", "PARTIALLY_PAID", "PAID", "OVERDUE"];

const toneOf = (status) => TONE_MAP[INVOICE_STATUS_TONE[status]] ?? "plain";

/**
 * Totaux par devise : additionner des euros et des dinars n'aurait aucun sens.
 * La synthèse affiche la devise la plus représentée et signale les autres.
 */
function summarize(list, now) {
  const counts = Object.fromEntries(STATUS_ORDER.map((key) => [key, 0]));
  const byCurrency = new Map();
  for (const invoice of list) {
    counts[invoice.status] = (counts[invoice.status] ?? 0) + 1;
    if (!BILLED.includes(invoice.status)) continue;
    const currency = invoice.currency || "EUR";
    const bucket = byCurrency.get(currency) ?? { currency, invoices: 0, billed: 0, paid: 0, due: 0, overdueAmount: 0 };
    bucket.invoices += 1;
    bucket.billed += Number(invoice.total) || 0;
    bucket.paid += Number(invoice.amountPaid) || 0;
    if (OPEN.includes(invoice.status)) bucket.due += remainingDue(invoice);
    if (invoice.status === "OVERDUE") bucket.overdueAmount += remainingDue(invoice);
    byCurrency.set(currency, bucket);
  }
  const buckets = [...byCurrency.values()].sort((a, b) => b.invoices - a.invoices);
  const main = buckets[0] ?? { currency: "EUR", invoices: 0, billed: 0, paid: 0, due: 0, overdueAmount: 0 };
  const open = list.filter((invoice) => OPEN.includes(invoice.status));
  const pastDue = open.filter((invoice) => invoice.dueDate && isDeadlinePassed(invoice.dueDate, now));
  return {
    total: list.length,
    counts,
    main,
    otherCurrencies: buckets.length - 1,
    /* Même devise que le montant affiché à côté. */
    open: open.filter((invoice) => (invoice.currency || "EUR") === main.currency).length,
    overdue: counts.OVERDUE ?? 0,
    pastDue: pastDue.length,
  };
}

export default function FacturesEquipePage() {
  const { query } = useShellQuery();
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  /* Une liste de factures se lit en colonnes (montants, échéances) : la vue
     tableau est l'affichage par défaut, les cartes restent disponibles. */
  const [mode, setMode] = useViewMode("equipe-factures", "list");
  const [now] = useState(() => Date.now());

  const params = new URLSearchParams({ page: String(page), perPage: "50" });
  if (filter) params.set("status", filter);
  if (query.trim()) params.set("search", query.trim());

  const invoices = useListing(`/invoices?${params.toString()}`);
  const all = useAllListing("/invoices?perPage=100");
  const items = invoices.items ?? [];

  /* Synthèse sur TOUTES les factures accessibles, indépendante du filtre actif. */
  const summary = useMemo(() => summarize(all.items ?? [], now), [all.items, now]);
  const ready = all.items !== null;
  const money = (value) => (ready ? formatMoney(value, summary.main.currency) : "…");
  const currencyNote = summary.otherCurrencies > 0 ? ` · +${summary.otherCurrencies} devise${summary.otherCurrencies > 1 ? "s" : ""}` : "";

  const filters = [
    { id: "", label: "Toutes", count: ready ? summary.total : undefined },
    ...STATUS_ORDER.filter((key) => !ready || summary.counts[key] > 0 || key === filter).map((key) => ({
      id: key,
      label: INVOICE_STATUS[key] ?? key,
      count: ready ? summary.counts[key] : undefined,
    })),
  ];

  const isPastDue = (invoice) => OPEN.includes(invoice.status) && invoice.dueDate && isDeadlinePassed(invoice.dueDate, now);

  return (
    <div className="flex flex-col gap-5">
      {invoices.error ? <Alert icon={CircleAlert}>{invoices.error}</Alert> : null}
      {!invoices.error && all.error ? <Alert icon={CircleAlert}>Synthèse indisponible : {all.error}</Alert> : null}

      <KpiGrid
        label="Synthèse de la facturation"
        items={[
          {
            id: "billed",
            tone: "blue",
            badge: ready ? `${summary.main.invoices} facture${summary.main.invoices > 1 ? "s" : ""} émise${summary.main.invoices > 1 ? "s" : ""}${currencyNote}` : "Facturation",
            value: money(summary.main.billed),
            label: "Total facturé",
          },
          { id: "paid", tone: "green", badge: "Paiements reçus", value: money(summary.main.paid), label: "Encaissé" },
          {
            id: "due",
            tone: "yellow",
            badge: ready ? `${summary.open} facture${summary.open > 1 ? "s" : ""} ouverte${summary.open > 1 ? "s" : ""}` : "Soldes",
            value: money(summary.main.due),
            label: "Reste à encaisser",
          },
          {
            id: "overdue",
            tone: summary.overdue ? "pink" : "lilac",
            badge: summary.overdue ? money(summary.main.overdueAmount) : "Aucun retard",
            value: ready ? summary.overdue : "…",
            label: summary.overdue > 1 ? "Factures en retard" : "Facture en retard",
          },
        ]}
      />

      <FilterPills
        label="Filtrer les factures par statut"
        value={filter}
        onChange={(value) => {
          setFilter(value);
          setPage(1);
        }}
        items={filters}
        actions={<ViewToggle value={mode} onChange={setMode} label="Affichage des factures" />}
      />

      <section className="sui-section" aria-label="Liste des factures">
        {invoices.items === null && !invoices.error ? <SkeletonList rows={4} /> : null}
        {invoices.items !== null && items.length === 0 ? (
          <Empty icon={ReceiptText}>
            {query.trim() || filter
              ? "Aucune facture ne correspond à ces critères."
              : "Aucune facture pour le moment. Une facture se génère depuis un devis accepté."}
          </Empty>
        ) : null}

        {items.length > 0 && mode === "cards" ? (
          <ItemGrid label="Factures">
            {items.map((invoice) => {
              const tone = toneOf(invoice.status);
              const late = isPastDue(invoice);
              return (
                <ItemCard
                  key={invoice.id}
                  cornerIcon={late ? TriangleAlert : ReceiptText}
                  cornerTone={late ? "pink" : tone === "plain" ? "lilac" : tone}
                  title={invoice.subject || invoice.reference}
                  titleHref={`/espace-equipe/factures/${invoice.id}`}
                  description={invoice.client?.companyName ?? "Client non renseigné"}
                  meta={[
                    { icon: Hash, label: invoice.reference },
                    { icon: CalendarDays, label: `Émise le ${formatDateOnly(invoice.issueDate)}` },
                    { icon: CalendarDays, label: `${late ? "Échéance dépassée · " : "Échéance "}${formatDateOnly(invoice.dueDate)}` },
                  ]}
                  info={`${formatMoney(invoice.total, invoice.currency)} · reste ${formatMoney(remainingDue(invoice), invoice.currency)}`}
                  status={INVOICE_STATUS[invoice.status] ?? invoice.status}
                  statusTone={tone}
                  actions={[
                    <InvoicePdfActions
                      key={`pdf-${invoice.id}`}
                      invoiceId={invoice.id}
                      reference={invoice.reference}
                      showEmailButton={false}
                      size="sm"
                    />,
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

        {items.length > 0 && mode === "list" ? (
          <ListTable
            label="Factures"
            rows={items}
            rowHref={(invoice) => `/espace-equipe/factures/${invoice.id}`}
            columns={[
              {
                key: "reference",
                label: "Facture",
                render: (invoice) => (
                  <span className="sui-table__primary">
                    <strong>{invoice.reference}</strong>
                    {invoice.subject ? <span>{invoice.subject}</span> : null}
                  </span>
                ),
              },
              { key: "client", label: "Client", render: (invoice) => invoice.client?.companyName ?? "—" },
              {
                key: "status",
                label: "Statut",
                render: (invoice) => <StatusPill tone={toneOf(invoice.status)} label={INVOICE_STATUS[invoice.status] ?? invoice.status} />,
              },
              {
                key: "due",
                label: "Échéance",
                render: (invoice) =>
                  isPastDue(invoice) ? (
                    <span className="sui-table__late" title="Échéance dépassée">
                      {formatDateOnly(invoice.dueDate)}
                      <span className="sr-only"> — échéance dépassée</span>
                    </span>
                  ) : (
                    formatDateOnly(invoice.dueDate)
                  ),
              },
              { key: "total", label: "Montant", align: "end", render: (invoice) => formatMoney(invoice.total, invoice.currency) },
              {
                key: "remaining",
                label: "Reste dû",
                align: "end",
                render: (invoice) => {
                  const remaining = remainingDue(invoice);
                  if (!OPEN.includes(invoice.status)) return <span className="sui-table__muted">—</span>;
                  return <strong>{formatMoney(remaining, invoice.currency)}</strong>;
                },
              },
              {
                key: "pdf",
                label: "PDF",
                align: "end",
                render: (invoice) => (
                  <InvoicePdfActions
                    invoiceId={invoice.id}
                    reference={invoice.reference}
                    showPreviewButton={false}
                    showEmailButton={false}
                    size="sm"
                  />
                ),
              },
            ]}
          />
        ) : null}

        <Pagination meta={invoices.meta} onPageChange={setPage} loading={invoices.loading} />
      </section>
    </div>
  );
}
