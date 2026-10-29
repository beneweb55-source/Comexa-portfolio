"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, CalendarDays, CircleAlert, FileText, Hash, Plus, Send } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/api";
import { ALL_CURRENCIES, currencyRank, currencyShortLabel, normalizeCurrency } from "@/lib/currency";
import { useDisplayCurrency } from "@/lib/use-display-currency";
import { QUOTE_STATUS, QUOTE_STATUS_TONE, quoteRecipient } from "@/lib/commercial";
import {
  QUOTE_FOLLOWUP_WINDOW_DAYS,
  quoteFollowup,
  quotesNeedingFollowup,
} from "@/lib/quote-attention.mjs";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { Empty, Notice, Pagination, SkeletonList, primaryButton } from "@/components/workspace/ui";
import { Alert, CurrencyScopeToggle, FilterPills, ItemCard, ItemGrid, RecordActions } from "@/components/softui";
import { useShellQuery } from "@/components/softui/Shell";
import QuotePdfActions from "@/components/workspace/invoices/QuotePdfActions";

const TONE_MAP = { success: "green", warning: "yellow", danger: "pink", info: "blue", neutral: "plain" };

export default function DevisEquipePage() {
  const { user } = useAuth();
  const { query } = useShellQuery();
  const canCreateQuote = can(user, "quote:write:any");
  const canSendQuote = can(user, "quote:send:any");
  const canDeleteQuote = can(user, "quote:delete:any");
  /* Devise d'affichage partagée avec les factures et le tableau de bord. Ici
     elle filtre la liste : « EUR » ne montre que les devis en euros, « les
     deux » les montre tous, chacun avec sa propre devise. */
  const { scope } = useDisplayCurrency();
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const params = new URLSearchParams({ page: String(page), perPage: "50" });
  if (filter) params.set("status", filter);
  if (query.trim()) params.set("search", query.trim());
  if (scope !== ALL_CURRENCIES) params.set("currency", scope);

  const quotes = useListing(`/quotes?${params.toString()}`);
  const items = quotes.items ?? [];
  const followups = quotesNeedingFollowup(items, now);
  const availableCurrencies = [...new Set(items.map((quote) => normalizeCurrency(quote.currency)))].sort(
    (left, right) => currencyRank(left) - currencyRank(right) || left.localeCompare(right),
  );

  return (
    <div className="flex flex-col gap-5">
      {quotes.error ? <Alert icon={CircleAlert}>{quotes.error}</Alert> : null}

      {/* Signal d'ATTENTION, pas un nouveau statut : l'API a déjà dérivé
          `EXPIRED`. On montre seulement les devis encore envoyés/consultés
          dont la validité tombe dans les 3 prochains jours. Aucune notification
          ni relance automatique : le commercial ouvre le devis et décide. */}
      {followups.length > 0 ? (
        <div data-testid="quote-followup-banner">
          <Notice tone="warning">
            {followups.length > 1 ? `${followups.length} devis envoyés arrivent` : "1 devis envoyé arrive"} à échéance dans les{" "}
            {QUOTE_FOLLOWUP_WINDOW_DAYS} prochains jours.{" "}
            <Link className="sui-link" href={`/espace-equipe/devis/${followups[0].quote.id}`}>
              Ouvrir le plus urgent
            </Link>{" "}
            pour décider d’une relance manuelle.
          </Notice>
        </div>
      ) : null}

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
              const followup = quoteFollowup(quote, now);
              return (
                <ItemCard
                  key={quote.id}
                  cornerIcon={FileText}
                  cornerTone={followup ? followup.tone : (TONE_MAP[QUOTE_STATUS_TONE[quote.status]] ?? "lilac")}
                  title={quote.subject}
                  description={recipient}
                  meta={[
                    { icon: Hash, label: quote.reference },
                    { icon: CalendarDays, label: `Valable jusqu’au ${formatDate(quote.validUntil)}` },
                    ...(followup
                      ? [{
                          icon: CalendarClock,
                          label: (
                            <span data-testid="quote-followup-label" data-days={followup.days}>
                              À relancer · {followup.label}
                            </span>
                          ),
                        }]
                      : []),
                  ]}
                  info={formatMoney(quote.total, quote.currency)}
                  status={QUOTE_STATUS[quote.status] ?? quote.status}
                  statusTone={followup ? followup.tone : (TONE_MAP[QUOTE_STATUS_TONE[quote.status]] ?? "plain")}
                  actions={[
                    <RecordActions
                      key={`actions-${quote.id}`}
                      resource="/quotes"
                      id={quote.id}
                      record={quote}
                      entityLabel="devis"
                      displayName={quote.reference}
                      label={`Actions pour le devis ${quote.reference}`}
                      fields={[{ name: "subject", label: "Objet du devis", required: true, maxLength: 200 }]}
                      canRename={canCreateQuote && quote.status === "DRAFT"}
                      canDelete={canDeleteQuote}
                      deleteWarning={`Le devis ${quote.reference} sera retiré des listes. Son historique et les documents liés restent conservés.`}
                      extraActions={
                        canSendQuote && quote.status === "DRAFT"
                          ? [
                              {
                                key: "send",
                                label: "Envoyer au client",
                                icon: Send,
                                confirm: {
                                  title: "Envoyer ce devis ?",
                                  description: `« ${quote.subject} » sera envoyé à ${recipient}. Un devis envoyé ne peut plus être modifié.`,
                                  confirmLabel: "Envoyer",
                                },
                                run: ({ request, id: quoteId }) => request(`/quotes/${quoteId}/send`, { method: "POST" }),
                                success: "Devis envoyé au client.",
                              },
                            ]
                          : []
                      }
                      href={`/espace-equipe/devis/${quote.id}`}
                      onChanged={quotes.reload}
                    />,
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
