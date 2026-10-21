"use client";

import DeleteDocumentButton from "@/components/workspace/DeleteDocumentButton";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, CircleAlert, FileText, Hash, Plus } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/api";
import { ALL_CURRENCIES, currencyRank, currencyShortLabel, normalizeCurrency } from "@/lib/currency";
import { useDisplayCurrency } from "@/lib/use-display-currency";
import { QUOTE_STATUS, QUOTE_STATUS_TONE, quoteRecipient } from "@/lib/commercial";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { Empty, Pagination, SkeletonList, primaryButton } from "@/components/workspace/ui";
import { Alert, CurrencyScopeToggle, FilterPills, ItemCard, ItemGrid } from "@/components/softui";
import { useShellQuery } from "@/components/softui/Shell";
import QuotePdfActions from "@/components/workspace/invoices/QuotePdfActions";

const TONE_MAP = { success: "green", warning: "yellow", danger: "pink", info: "blue", neutral: "plain" };

export default function DevisEquipePage() {
  const { user } = useAuth();
  const { query } = useShellQuery();
  const canCreateQuote = can(user, "quote:write:any");
  /* Devise d'affichage partagée avec les factures et le tableau de bord. Ici
     elle filtre la liste : « EUR » ne montre que les devis en euros, « les
     deux » les montre tous, chacun avec sa propre devise. */
  const { scope } = useDisplayCurrency();
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), perPage: "50" });
  if (filter) params.set("status", filter);
  if (query.trim()) params.set("search", query.trim());
  if (scope !== ALL_CURRENCIES) params.set("currency", scope);

  const quotes = useListing(`/quotes?${params.toString()}`);
  const items = quotes.items ?? [];
  const availableCurrencies = [...new Set(items.map((quote) => normalizeCurrency(quote.currency)))].sort(
    (left, right) => currencyRank(left) - currencyRank(right) || left.localeCompare(right),
  );

  return (
    <div className="flex flex-col gap-5">
      {quotes.error ? <Alert icon={CircleAlert}>{quotes.error}</Alert> : null}

      {/* Pas d'action « Nouveau devis » ici : l'en-tête de la coque affiche déjà
          ce CTA principal (même destination). Le doubler créait deux boutons
          noirs identiques dans la même vue. */}
      <div className="flex flex-col gap-2">
        <CurrencyScopeToggle
          available={availableCurrencies}
          label="Devise des devis"
          onScopeChange={() => setPage(1)}
        />
        {scope !== ALL_CURRENCIES ? (
          <p className="sui-card__desc">
            Seuls les devis en {currencyShortLabel(scope)} sont listés. Choisissez « Les deux » pour voir toutes les
            devises.
          </p>
        ) : null}
      </div>

      <FilterPills
        label="Filtrer les devis par statut"
        value={filter}
        onChange={(value) => {
          setFilter(value);
          setPage(1);
        }}
        items={[{ id: "", label: "Tous" }, ...Object.entries(QUOTE_STATUS).map(([id, label]) => ({ id, label }))]}
      />

      <section className="sui-section" aria-label="Liste des devis">
        {quotes.items === null && !quotes.error ? <SkeletonList rows={4} /> : null}
        {quotes.items !== null && items.length === 0 ? (
          <Empty
            icon={FileText}
            action={
              canCreateQuote ? (
                <Link href="/espace-equipe/devis/nouveau" className={primaryButton} data-coach-id="devis-create-button">
                  <Plus size={15} /> Créer un devis
                </Link>
              ) : null
            }
          >
            {scope !== ALL_CURRENCIES
              ? `Aucun devis en ${currencyShortLabel(scope)} ne correspond à ces critères.`
              : "Aucun devis ne correspond à ces critères."}
          </Empty>
        ) : null}

        {items.length > 0 ? (
          <ItemGrid label="Devis">
            {items.map((quote) => {
              const recipient = quoteRecipient(quote);
              return (
                <ItemCard
                  key={quote.id}
                  cornerIcon={FileText}
                  cornerTone={TONE_MAP[QUOTE_STATUS_TONE[quote.status]] ?? "lilac"}
                  title={quote.subject}
                  description={recipient}
                  meta={[
                    { icon: Hash, label: quote.reference },
                    { icon: CalendarDays, label: `Valable jusqu’au ${formatDate(quote.validUntil)}` },
                  ]}
                  info={formatMoney(quote.total, quote.currency)}
                  status={QUOTE_STATUS[quote.status] ?? quote.status}
                  statusTone={TONE_MAP[QUOTE_STATUS_TONE[quote.status]] ?? "plain"}
                  actions={[
                    <DeleteDocumentButton key="delete" resource="quotes" id={quote.id} label={quote.reference} />,
                    <QuotePdfActions key={`pdf-${quote.id}`} quoteId={quote.id} reference={quote.reference} />,
                    {
                      icon: ArrowUpRight,
                      label: `Ouvrir le devis ${quote.reference}`,
                      href: `/espace-equipe/devis/${quote.id}`,
                      variant: "dark",
                    },
                  ]}
                />
              );
            })}
          </ItemGrid>
        ) : null}

        <Pagination meta={quotes.meta} onPageChange={setPage} loading={quotes.loading} />
      </section>
    </div>
  );
}
