"use client";

/*
 * Devis (espace équipe) — même appel `/quotes`, filtres convertis en pilules
 * (statut actif = noir plein) et cartes de grille. Le bouton principal noir
 * n'apparaît que si le porteur peut créer un devis : aucune action fantôme.
 */

import { useState } from "react";
import { ArrowUpRight, CalendarDays, CircleAlert, FileText, Plus, Users } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/api";
import { QUOTE_STATUS, QUOTE_STATUS_TONE } from "@/lib/commercial";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { Pagination } from "@/components/workspace/ui";
import { Alert, Button, FilterPills, ItemCard, ItemGrid } from "@/components/softui";

const TONE_MAP = { success: "green", warning: "yellow", danger: "pink", info: "blue", neutral: "plain" };

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
    <div className="flex flex-col">
      {quotes.error ? <Alert icon={CircleAlert}>{quotes.error}</Alert> : null}

      <FilterPills
        label="Filtrer les devis par statut"
        value={filter}
        onChange={(value) => {
          setFilter(value);
          setPage(1);
        }}
        items={[{ id: "", label: "Tous" }, ...Object.entries(QUOTE_STATUS).map(([id, label]) => ({ id, label }))]}
        actions={
          canCreateQuote ? (
            <Button variant="dark" icon={Plus} href="/espace-equipe/devis/nouveau">
              Nouveau devis
            </Button>
          ) : null
        }
      />

      <section className="sui-section" aria-label="Liste des devis">
        {quotes.items === null && !quotes.error ? <p className="sui-card__desc" role="status">Chargement des devis…</p> : null}
        {quotes.items !== null && items.length === 0 ? <p className="sui-card__desc">Aucun devis pour ces critères.</p> : null}

        <ItemGrid label="Devis">
          {items.map((quote) => {
            const recipient = quote.client?.companyName
              ?? (quote.prospect ? `${quote.prospect.companyName || quote.prospect.email} (prospect)` : "Destinataire non renseigné");
            return (
              <ItemCard
                key={quote.id}
                cornerIcon={FileText}
                cornerTone={TONE_MAP[QUOTE_STATUS_TONE[quote.status]] ?? "lilac"}
                title={quote.subject}
                description={recipient}
                meta={[
                  { icon: Users, label: quote.reference },
                  { icon: CalendarDays, label: `Valable jusqu’au ${formatDate(quote.validUntil)}` },
                ]}
                info={formatMoney(quote.total, quote.currency)}
                status={QUOTE_STATUS[quote.status] ?? quote.status}
                statusTone={TONE_MAP[QUOTE_STATUS_TONE[quote.status]] ?? "plain"}
                actions={[
                  { icon: ArrowUpRight, label: `Ouvrir le devis ${quote.reference}`, href: `/espace-equipe/devis/${quote.id}`, variant: "dark" },
                ]}
              />
            );
          })}
        </ItemGrid>

        <Pagination meta={quotes.meta} onPageChange={setPage} loading={quotes.loading} />
      </section>
    </div>
  );
}
