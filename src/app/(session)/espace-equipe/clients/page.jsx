"use client";

import { useState } from "react";
import { ArrowUpRight, CircleAlert, Eye, Users } from "lucide-react";
import { useListing } from "@/lib/use-listing";
import { Empty, Pagination, SkeletonList } from "@/components/workspace/ui";
import { Alert, FilterPills, ItemCard, ItemGrid } from "@/components/softui";
import { useShellQuery } from "@/components/softui/Shell";

const CLIENT_STATUS = { ACTIVE: "Actif", INACTIVE: "Inactif", ARCHIVED: "Archivé" };
const STATUS_FILTERS = [
  { id: "", label: "Tous" },
  { id: "ACTIVE", label: "Actifs" },
  { id: "INACTIVE", label: "Inactifs" },
  { id: "ARCHIVED", label: "Archivés" },
];

function initialsOf(value) {
  const letters = String(value ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
  return letters.toLocaleUpperCase("fr-FR") || "—";
}

export default function ClientsEquipePage() {
  const { query } = useShellQuery();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), perPage: "50" });
  if (query.trim()) params.set("search", query.trim());
  if (status) params.set("status", status);
  const clients = useListing(`/clients?${params.toString()}`);
  const items = clients.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      {clients.error ? <Alert icon={CircleAlert}>{clients.error}</Alert> : null}

      <FilterPills
        label="Filtrer les clients par statut"
        value={status}
        onChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
        items={STATUS_FILTERS}
      />

      <section className="sui-section" aria-label="Liste des clients">
        {clients.items === null && !clients.error ? <SkeletonList rows={4} /> : null}
        {clients.items !== null && items.length === 0 ? (
          <Empty icon={Users}>Aucun client ne correspond à ces critères.</Empty>
        ) : null}

        {items.length > 0 ? (
          <ItemGrid label="Clients">
            {items.map((client) => (
              <ItemCard
                key={client.id}
                corner={initialsOf(client.companyName)}
                cornerTone="blue"
                title={client.companyName}
                description={
                  [client.sector, client.city, client.country].filter(Boolean).join(" · ") ||
                  "Coordonnées à compléter"
                }
                meta={[
                  { icon: Users, label: client.reference },
                  { icon: Eye, label: CLIENT_STATUS[client.status] ?? client.status },
                ]}
                status={CLIENT_STATUS[client.status] ?? client.status}
                statusTone={client.status === "ACTIVE" ? "green" : "plain"}
                actions={[
                  {
                    icon: Eye,
                    label: `Voir la fiche de ${client.companyName}`,
                    href: `/espace-equipe/clients/${client.id}`,
                  },
                  {
                    icon: ArrowUpRight,
                    label: `Ouvrir la fiche de ${client.companyName}`,
                    href: `/espace-equipe/clients/${client.id}`,
                    variant: "dark",
                  },
                ]}
              />
            ))}
          </ItemGrid>
        ) : null}

        <Pagination meta={clients.meta} onPageChange={setPage} loading={clients.loading} />
      </section>
    </div>
  );
}
