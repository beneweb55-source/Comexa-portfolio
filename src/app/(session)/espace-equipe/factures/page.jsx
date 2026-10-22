"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, CircleAlert, CircleSlash, Hash, ReceiptText, Send, TriangleAlert } from "lucide-react";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { formatDateOnly, formatMoney } from "@/lib/api";
import { ALL_CURRENCIES, amountsPair, currencyRank, currencyShortLabel, normalizeCurrency } from "@/lib/currency";
import { useDisplayCurrency } from "@/lib/use-display-currency";
import { isDeadlinePassed } from "@/lib/date-utils.mjs";
import { INVOICE_STATUS, INVOICE_STATUS_TONE, remainingDue } from "@/lib/commercial";
import { useListing } from "@/lib/use-listing";
import { useAllListing } from "@/lib/use-all-listing";
import { Empty, Pagination, SkeletonList } from "@/components/workspace/ui";
import {
  Alert,
  CurrencyAmounts,
  CurrencyScopeToggle,
  FilterPills,
  ItemCard,
  ItemGrid,
  KpiGrid,
  RecordActions,
  StatusPill,
} from "@/components/softui";
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
 * Totaux PAR DEVISE : additionner des euros et des dinars n'aurait aucun sens.
 *
 * La liste reçue est déjà restreinte à la portée choisie (« DA », « EUR » ou
 * toutes) ; ce résumé ne fait donc que remplir un seau par devise, sans jamais
 * reporter le total d'une monnaie sur une autre. Les montants sont ensuite
 * choisis par `amountsPair` / `CurrencyAmounts`, qui ne mélangent rien.
 */
function summarize(list, now) {
  const counts = Object.fromEntries(STATUS_ORDER.map((key) => [key, 0]));
  const byCurrency = new Map();
  for (const invoice of list) {
    counts[invoice.status] = (counts[invoice.status] ?? 0) + 1;
    if (!BILLED.includes(invoice.status)) continue;
    const currency = normalizeCurrency(invoice.currency);
    const bucket = byCurrency.get(currency) ?? { currency, invoices: 0, billed: 0, paid: 0, due: 0, overdueAmount: 0 };
    bucket.invoices += 1;
    bucket.billed += Number(invoice.total) || 0;
    bucket.paid += Number(invoice.amountPaid) || 0;
    if (OPEN.includes(invoice.status)) bucket.due += remainingDue(invoice);
    if (invoice.status === "OVERDUE") bucket.overdueAmount += remainingDue(invoice);
    byCurrency.set(currency, bucket);
  }
  const buckets = [...byCurrency.values()]
    .map((bucket) => ({
      ...bucket,
      billed: Math.round(bucket.billed * 100) / 100,
      paid: Math.round(bucket.paid * 100) / 100,
      due: Math.round(bucket.due * 100) / 100,
      overdueAmount: Math.round(bucket.overdueAmount * 100) / 100,
    }))
    .sort((a, b) => currencyRank(a.currency) - currencyRank(b.currency) || a.currency.localeCompare(b.currency));

  const amounts = (key) => buckets.map((bucket) => ({ currency: bucket.currency, total: bucket[key] }));
  const open = list.filter((invoice) => OPEN.includes(invoice.status));
  const pastDue = open.filter((invoice) => invoice.dueDate && isDeadlinePassed(invoice.dueDate, now));

  return {
    total: list.length,
    counts,
    buckets,
    billedAmounts: amounts("billed"),
    paidAmounts: amounts("paid"),
    dueAmounts: amounts("due"),
    overdueAmounts: amounts("overdueAmount"),
    open,
    /* Comptes de factures, pas montants : la devise ne les change pas. */
    invoiceCount: buckets.reduce((total, bucket) => total + bucket.invoices, 0),
    openCount: open.length,
    overdue: counts.OVERDUE ?? 0,
    pastDue: pastDue.length,
  };
}

export default function FacturesEquipePage() {
  const { user } = useAuth();
  const { query } = useShellQuery();
  const canSendInvoice = can(user, "invoice:send:any");
  const canCancelInvoice = can(user, "invoice:write:any");
  const canDeleteInvoice = can(user, "invoice:delete:any");
  /* La portée choisie vaut à la fois pour les totaux ET pour la liste : choisir
     « EUR » ne laisse pas des totaux en dinars au-dessus de factures en euros. */
  const { scope } = useDisplayCurrency();
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  /* Une liste de factures se lit en colonnes (montants, échéances) : la vue
     tableau est l'affichage par défaut, les cartes restent disponibles. */
  const [mode, setMode] = useViewMode("equipe-factures", "list");
  const [now] = useState(() => Date.now());

  const params = new URLSearchParams({ page: String(page), perPage: "50" });
  if (filter) params.set("status", filter);
  if (query.trim()) params.set("search", query.trim());
  if (scope !== ALL_CURRENCIES) params.set("currency", scope);

  const invoices = useListing(`/invoices?${params.toString()}`);
  const all = useAllListing("/invoices?perPage=100");
  const items = invoices.items ?? [];
  const allItems = useMemo(() => all.items ?? [], [all.items]);

  const availableCurrencies = useMemo(
    () =>
      [...new Set(allItems.map((invoice) => normalizeCurrency(invoice.currency)))].sort(
        (left, right) => currencyRank(left) - currencyRank(right) || left.localeCompare(right),
      ),
    [allItems],
  );

  /* Synthèse sur TOUTES les factures accessibles, restreinte à la portée. */
  const scopedItems = useMemo(
    () =>
      scope === ALL_CURRENCIES
        ? allItems
        : allItems.filter((invoice) => normalizeCurrency(invoice.currency) === scope),
    [allItems, scope],
  );
  const summary = useMemo(() => summarize(scopedItems, now), [scopedItems, now]);
  const ready = all.items !== null;

  const billedPair = amountsPair(summary.billedAmounts, scope);
  const paidPair = amountsPair(summary.paidAmounts, scope);
  const duePair = amountsPair(summary.dueAmounts, scope);
  const currencyNote =
    scope === ALL_CURRENCIES && summary.buckets.length > 1
      ? ` · ${summary.buckets.length} devises`
      : "";

  const filters = [
    { id: "", label: "Toutes", count: ready ? summary.total : undefined },
    ...STATUS_ORDER.filter((key) => !ready || summary.counts[key] > 0 || key === filter).map((key) => ({
      id: key,
      label: INVOICE_STATUS[key] ?? key,
      count: ready ? summary.counts[key] : undefined,
    })),
  ];

  const isPastDue = (invoice) => OPEN.includes(invoice.status) && invoice.dueDate && isDeadlinePassed(invoice.dueDate, now);

  /* Options d'une facture : les routes existantes seulement (`/send`, `/cancel`,
     `DELETE`). Aucune facture ne se réécrit — une facture émise ne se corrige
     pas, elle s'annule : le menu propose donc d'envoyer ou d'annuler, jamais de
     renommer. */
  const invoiceActions = (invoice) => [
    {
      key: "send",
      label: "Envoyer au client",
      icon: Send,
      when: canSendInvoice && invoice.status === "DRAFT",
      confirm: {
        title: "Envoyer cette facture ?",
        description: `La facture ${invoice.reference} sera transmise au client et deviendra payable.`,
        confirmLabel: "Envoyer",
      },
      run: ({ request, id }) => request(`/invoices/${id}/send`, { method: "POST" }),
      success: "Facture envoyée au client.",
    },
    {
      key: "cancel",
      label: "Annuler la facture",
      icon: CircleSlash,
      tone: "danger",
      when: canCancelInvoice && ["DRAFT", "SENT", "OVERDUE"].includes(invoice.status),
      confirm: {
        title: "Annuler cette facture ?",
        description: `La facture ${invoice.reference} passera en « Annulée ». Une facture déjà encaissée ne peut pas être annulée.`,
        confirmLabel: "Annuler la facture",
        danger: true,
      },
      run: ({ request, id }) => request(`/invoices/${id}/cancel`, { method: "POST" }),
      success: "Facture annulée.",
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {invoices.error ? <Alert icon={CircleAlert}>{invoices.error}</Alert> : null}
      {!invoices.error && all.error ? <Alert icon={CircleAlert}>Synthèse indisponible : {all.error}</Alert> : null}

      <div className="flex flex-col gap-2">
        <CurrencyScopeToggle
          available={availableCurrencies}
          label="Devise des factures"
          onScopeChange={() => setPage(1)}
        />
        {ready && scope !== ALL_CURRENCIES && allItems.length > scopedItems.length ? (
          <p className="sui-card__desc">
            {allItems.length - scopedItems.length} facture{allItems.length - scopedItems.length > 1 ? "s" : ""} dans une autre devise{" "}
            {allItems.length - scopedItems.length > 1 ? "sont masquées" : "est masquée"}. Choisissez « Les deux » pour tout
            afficher, chacune dans sa monnaie.
          </p>
        ) : null}
      </div>

      <KpiGrid
        label="Synthèse de la facturation"
        items={[
          {
            id: "billed",
            tone: "blue",
            badge: ready
              ? `${summary.invoiceCount} facture${summary.invoiceCount > 1 ? "s" : ""} émise${summary.invoiceCount > 1 ? "s" : ""}${currencyNote}`
              : "Facturation",
            value: ready ? billedPair.value : "…",
            secondary: ready ? billedPair.secondary : null,
            label: "Total facturé",
          },
          {
            id: "paid",
            tone: "green",
            badge: "Paiements reçus",
            value: ready ? paidPair.value : "…",
            secondary: ready ? paidPair.secondary : null,
            label: "Encaissé",
          },
          {
            id: "due",
            tone: "yellow",
            badge: ready
              ? `${summary.openCount} facture${summary.openCount > 1 ? "s" : ""} ouverte${summary.openCount > 1 ? "s" : ""}`
              : "Soldes",
            value: ready ? duePair.value : "…",
            secondary: ready ? duePair.secondary : null,
            label: "Reste à encaisser",
          },
          {
            id: "overdue",
            tone: summary.overdue ? "pink" : "lilac",
            badge: summary.overdue ? (
              <CurrencyAmounts amounts={summary.overdueAmounts} scope={scope} />
            ) : (
              "Aucun retard"
            ),
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
            {query.trim() || filter || scope !== ALL_CURRENCIES
              ? `Aucune facture ne correspond à ces critères${scope !== ALL_CURRENCIES ? ` en ${currencyShortLabel(scope)}` : ""}.`
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
                    <RecordActions
                      key={`actions-${invoice.id}`}
                      resource="/invoices"
                      id={invoice.id}
                      record={invoice}
                      entityLabel="facture"
                      displayName={invoice.reference}
                      label={`Actions pour la facture ${invoice.reference}`}
                      canDelete={canDeleteInvoice}
                      deleteWarning={`La facture ${invoice.reference} sera retirée des listes et des totaux. Les paiements et encaissements liés restent conservés pour la traçabilité.`}
                      extraActions={invoiceActions(invoice)}
                      href={`/espace-equipe/factures/${invoice.id}`}
                      onChanged={invoices.reload}
                    />,
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
                key: "actions",
                label: "Actions",
                align: "end",
                render: (invoice) => (
                  <span className="flex justify-end">
                    <RecordActions
                      resource="/invoices"
                      id={invoice.id}
                      record={invoice}
                      entityLabel="facture"
                      displayName={invoice.reference}
                      label={`Actions pour la facture ${invoice.reference}`}
                      canDelete={canDeleteInvoice}
                      extraActions={invoiceActions(invoice)}
                      href={`/espace-equipe/factures/${invoice.id}`}
                      onChanged={invoices.reload}
                    />
                  </span>
                ),
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
