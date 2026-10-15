"use client";

import { useState } from "react";
import { ArrowUpRight, CalendarDays, CircleAlert, Folder, FolderKanban, Users } from "lucide-react";
import { formatDate } from "@/lib/api";
import { PROJECT_STATUS } from "@/lib/labels";
import { useListing } from "@/lib/use-listing";
import { Empty, Pagination, SkeletonList } from "@/components/workspace/ui";
import { Alert, FilterPills, ItemCard, ItemGrid } from "@/components/softui";
import { useShellQuery } from "@/components/softui/Shell";

const STATUS_TONE = {
  DRAFT: "plain",
  PLANNED: "blue",
  IN_PROGRESS: "yellow",
  ON_HOLD: "lilac",
  REVIEW: "lilac",
  IN_REVIEW: "lilac",
  COMPLETED: "green",
  CANCELLED: "pink",
  ARCHIVED: "plain",
};

const PROJECT_FILTERS = [
  { id: "", label: "Tous" },
  { id: "IN_PROGRESS", label: "En cours" },
  { id: "PLANNED", label: "Planifiés" },
  { id: "IN_REVIEW", label: "En revue" },
  { id: "ON_HOLD", label: "En pause" },
  { id: "COMPLETED", label: "Terminés" },
];

export default function ProjetsEquipePage() {
  const { query } = useShellQuery();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), perPage: "50" });
  if (status) params.set("status", status);
  if (query.trim()) params.set("search", query.trim());

  const projects = useListing(`/projects?${params.toString()}`);
  const items = projects.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      {projects.error ? <Alert icon={CircleAlert}>{projects.error}</Alert> : null}

      <FilterPills
        label="Filtrer les projets par statut"
        value={status}
        onChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
        items={PROJECT_FILTERS}
      />

      <section className="sui-section" aria-label="Liste des projets">
        {projects.items === null && !projects.error ? <SkeletonList rows={4} /> : null}
        {projects.items !== null && items.length === 0 ? (
          <Empty icon={FolderKanban}>
            Aucun projet trouvé pour ces critères. Un projet est créé lorsqu’une commande ou une demande est validée par l’équipe.
          </Empty>
        ) : null}

        {items.length > 0 ? (
          <ItemGrid label="Projets">
            {items.map((project) => (
              <ItemCard
                key={project.id}
                cornerIcon={Folder}
                cornerTone={STATUS_TONE[project.status] === "plain" ? "blue" : STATUS_TONE[project.status]}
                title={project.name}
                description={project.client?.companyName ?? "Client non renseigné"}
                meta={[
                  { icon: Users, label: project.reference },
                  { icon: CalendarDays, label: `Échéance ${formatDate(project.dueDate)}` },
                ]}
                progress={{ value: project.progressPercent, ratio: `${project.progressPercent ?? 0} %` }}
                status={PROJECT_STATUS[project.status] ?? project.status}
                statusTone={STATUS_TONE[project.status] ?? "plain"}
                actions={[
                  {
                    icon: ArrowUpRight,
                    label: `Ouvrir le projet ${project.name}`,
                    href: `/espace-equipe/projets/${project.id}`,
                    variant: "dark",
                  },
                ]}
              />
            ))}
          </ItemGrid>
        ) : null}

        <Pagination meta={projects.meta} onPageChange={setPage} loading={projects.loading} />
      </section>
    </div>
  );
}
