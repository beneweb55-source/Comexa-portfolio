"use client";

import { useState } from "react";
import { ArrowUpRight, Archive, CircleAlert, Eye, UserCheck, UserX, Users } from "lucide-react";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { Empty, Pagination, SkeletonList } from "@/components/workspace/ui";
import { Alert, FilterPills, ItemCard, ItemGrid, RecordActions } from "@/components/softui";
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
  const { user } = useAuth();
  const { query } = useShellQuery();
  const canRenameClient = can(user, "client:write:any");
  const canDeleteClient = can(user, "client:delete:any");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), perPage: "50" });
  if (query.trim()) params.set("search", query.trim());
  if (status) params.set("status", status);
  const clients = useListing(`/clients?${params.toString()}`);
  const items = clients.items ?? [];

  /* Changement d'état d'un dossier : la même route `PATCH /clients/:id` que le
     renommage, avec un seul champ. Aucune route dédiée n'est inventée. */
  const clientExtras = canRenameClient
    ? [
        {
          key: "activate",
          label: "Marquer comme actif",
          icon: UserCheck,
          when: true,
          run: ({ request, id }) => request(`/clients/${id}`, { method: "PATCH", body: { status: "ACTIVE" } }),
          success: "Dossier client marqué comme actif.",
        },
        {
          key: "deactivate",
          label: "Marquer comme inactif",
          icon: UserX,
          run: ({ request, id }) => request(`/clients/${id}`, { method: "PATCH", body: { status: "INACTIVE" } }),
          success: "Dossier client marqué comme inactif.",
        },
        {
          key: "archive",
          label: "Archiver le dossier",
          icon: Archive,
          confirm: {
            title: "Archiver ce dossier client ?",
            description: "Le dossier quittera les vues actives mais restera consultable dans le filtre « Archivés ».",
            confirmLabel: "Archiver",
          },
          run: ({ request, id }) => request(`/clients/${id}`, { method: "PATCH", body: { status: "ARCHIVED" } }),
          success: "Dossier client archivé.",
        },
      ]
    : [];

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
                  <RecordActions
                    key={`actions-${client.id}`}
                    resource="/clients"
                    id={client.id}
                    record={client}
                    entityLabel="dossier client"
                    displayName={client.companyName}
                    label={`Actions pour le client ${client.companyName}`}
                    fields={[{ name: "companyName", label: "Raison sociale", required: true, maxLength: 200 }]}
                    canRename={canRenameClient}
                    canDelete={canDeleteClient}
                    extraActions={clientExtras}
                    href={`/espace-equipe/clients/${client.id}`}
                    onChanged={clients.reload}
                    deleteWarning={`« ${client.companyName} » sera retiré des listes, ainsi que ses interlocuteurs. Ses devis, factures et paiements restent conservés. Un dossier portant un projet en cours ne peut pas être supprimé.`}
                  />,
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
