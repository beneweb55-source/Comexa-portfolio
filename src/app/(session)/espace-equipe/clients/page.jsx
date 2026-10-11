"use client";

import Link from "next/link";
import { useState } from "react";
import { useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Notice, Pagination, inputClass } from "@/components/workspace/ui";

const CLIENT_STATUS = { ACTIVE: "Actif", INACTIVE: "Inactif", ARCHIVED: "Archivé" };

export default function ClientsEquipePage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), perPage: "50" });
  if (search.trim()) query.set("search", search.trim());
  const clients = useListing(`/clients?${query.toString()}`);
  const items = clients.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      {clients.error ? <Notice>{clients.error}</Notice> : null}
      <Card
        title="Clients"
        action={
          <label className="flex items-center gap-2">
            <span className="sr-only">Rechercher un client</span>
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className={`${inputClass} h-10 w-[min(280px,60vw)]`}
              placeholder="Rechercher une entreprise…"
            />
          </label>
        }
      >
        {clients.items === null && !clients.error ? <p className="cx-small" role="status">Chargement des clients…</p> : null}
        {clients.items !== null && items.length === 0 ? <Empty>Aucun client pour cette recherche.</Empty> : null}
        <ul className="flex flex-col gap-3">
          {items.map((client) => (
            <li key={client.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--comexa-border-soft)] p-4 transition-colors hover:bg-[var(--comexa-neutral-50)]">
              <div className="min-w-0">
                <p className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">{client.reference}</p>
                <Link href={`/espace-equipe/clients/${client.id}`} className="font-semibold text-[var(--comexa-ink)] hover:text-[var(--comexa-accent-strong)] hover:underline">
                  {client.companyName}
                </Link>
                <p className="text-[13.5px] text-[var(--comexa-ink-soft)]">
                  {[client.sector, client.city, client.country].filter(Boolean).join(" · ") || "Coordonnées à compléter"}
                </p>
              </div>
              <Badge tone={client.status === "ACTIVE" ? "success" : "neutral"}>{CLIENT_STATUS[client.status] ?? client.status}</Badge>
            </li>
          ))}
        </ul>
        <Pagination meta={clients.meta} onPageChange={setPage} loading={clients.loading} />
      </Card>
    </div>
  );
}
