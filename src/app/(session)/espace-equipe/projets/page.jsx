"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, CircleAlert, Folder, FolderKanban, Hash, TriangleAlert } from "lucide-react";
import { formatDateOnly } from "@/lib/api";
import { isDeadlinePassed } from "@/lib/date-utils.mjs";
import { PROJECT_STATUS } from "@/lib/labels";
import { useListing } from "@/lib/use-listing";
import { useAllListing } from "@/lib/use-all-listing";
import { Empty, Pagination, SkeletonList } from "@/components/workspace/ui";
import { Alert, FilterPills, ItemCard, ItemGrid, KpiGrid, ProgressBar, StatusPill } from "@/components/softui";
import { ListTable, ViewToggle, useViewMode } from "@/components/softui/ListView";
import { useShellQuery } from "@/components/softui/Shell";

const STATUS_TONE = {
  DRAFT: "plain",
  PLANNED: "blue",
  IN_PROGRESS: "yellow",
  ON_HOLD: "lilac",
  IN_REVIEW: "lilac",
  COMPLETED: "green",
  CANCELLED: "pink",
  ARCHIVED: "plain",
};

/* Ordre de lecture des filtres : le cycle de vie d'un projet. Chaque statut
   affiché sur une carte a désormais son filtre (Brouillon, Annulés et Archivés
   manquaient). */
const STATUS_ORDER = ["IN_PROGRESS", "PLANNED", "IN_REVIEW", "ON_HOLD", "DRAFT", "COMPLETED", "CANCELLED", "ARCHIVED"];
const ACTIVE = ["PLANNED", "IN_PROGRESS", "IN_REVIEW"];
const CLOSED = ["COMPLETED", "CANCELLED", "ARCHIVED"];

/** Barre d'avancement cohérente avec le statut : un projet annulé n'est pas « vert ». */
function progressTone(status) {
  if (status === "CANCELLED" || status === "ARCHIVED") return "muted";
  if (status === "ON_HOLD") return "lilac";
  if (status === "COMPLETED") return "green";
  if (status === "DRAFT") return "muted";
  return undefined;
}

export default function ProjetsEquipePage() {
  const { query } = useShellQuery();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [mode, setMode] = useViewMode("equipe-projets", "cards");
  const [now] = useState(() => Date.now());

  const params = new URLSearchParams({ page: String(page), perPage: "50" });
  if (status) params.set("status", status);
  if (query.trim()) params.set("search", query.trim());

  const projects = useListing(`/projects?${params.toString()}`);
  const all = useAllListing("/projects?perPage=100");
  const items = projects.items ?? [];

  /* Synthèse sur TOUS les projets accessibles (indépendante du filtre). */
  const summary = useMemo(() => {
    const list = all.items ?? [];
    const counts = Object.fromEntries(STATUS_ORDER.map((key) => [key, 0]));
    for (const project of list) counts[project.status] = (counts[project.status] ?? 0) + 1;
    const active = list.filter((project) => ACTIVE.includes(project.status));
    const late = active.filter((project) => project.dueDate && isDeadlinePassed(project.dueDate, now));
    const avg = active.length ? Math.round(active.reduce((sum, project) => sum + (Number(project.progressPercent) || 0), 0) / active.length) : 0;
    const monthEnd = new Date(now);
    monthEnd.setMonth(monthEnd.getMonth() + 1, 0);
    const dueThisMonth = active.filter((project) => project.dueDate && new Date(project.dueDate) <= monthEnd && !isDeadlinePassed(project.dueDate, now));
    return { total: list.length, counts, active: active.length, late: late.length, avg, dueThisMonth: dueThisMonth.length };
  }, [all.items, now]);

  const ready = all.items !== null;
  const filters = [
    { id: "", label: "Tous", count: ready ? summary.total : undefined },
    ...STATUS_ORDER.filter((key) => !ready || summary.counts[key] > 0 || key === status).map((key) => ({
      id: key,
      label: PROJECT_STATUS[key] ?? key,
      count: ready ? summary.counts[key] : undefined,
    })),
  ];

  return (
    <div className="flex flex-col gap-5">
      {projects.error ? <Alert icon={CircleAlert}>{projects.error}</Alert> : null}

      <KpiGrid
        label="Synthèse des projets"
        items={[
          { id: "active", tone: "yellow", badge: ready ? `${summary.total} au total` : "Projets", value: ready ? summary.active : "…", label: summary.active > 1 ? "Projets actifs" : "Projet actif" },
          { id: "late", tone: summary.late ? "pink" : "green", badge: summary.late ? "À débloquer" : "Dans les temps", value: ready ? summary.late : "…", label: summary.late > 1 ? "Projets en retard" : "Projet en retard" },
          { id: "avg", tone: "blue", badge: "Projets actifs", value: ready ? `${summary.avg} %` : "…", label: "Avancement moyen" },
          { id: "month", tone: "lilac", badge: "D’ici la fin du mois", value: ready ? summary.dueThisMonth : "…", label: summary.dueThisMonth > 1 ? "Livraisons prévues" : "Livraison prévue" },
        ]}
      />

      <FilterPills
        label="Filtrer les projets par statut"
        value={status}
        onChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
        items={filters}
        actions={<ViewToggle value={mode} onChange={setMode} label="Affichage des projets" />}
      />

      <section className="sui-section" aria-label="Liste des projets">
        {projects.items === null && !projects.error ? <SkeletonList rows={4} /> : null}
        {projects.items !== null && items.length === 0 ? (
          <Empty icon={FolderKanban}>
            {query.trim() || status
              ? "Aucun projet ne correspond à ces critères."
              : "Aucun projet pour le moment. Un projet est créé lorsqu’une commande ou une demande est validée par l’équipe."}
          </Empty>
        ) : null}

        {items.length > 0 && mode === "cards" ? (
          <ItemGrid label="Projets">
            {items.map((project) => {
              const closed = CLOSED.includes(project.status);
              const late = !closed && project.dueDate && isDeadlinePassed(project.dueDate, now);
              return (
                <ItemCard
                  key={project.id}
                  cornerIcon={late ? TriangleAlert : Folder}
                  cornerTone={late ? "pink" : STATUS_TONE[project.status] === "plain" ? "blue" : STATUS_TONE[project.status]}
                  title={project.name}
                  titleHref={`/espace-equipe/projets/${project.id}`}
                  description={project.client?.companyName ?? "Client non renseigné"}
                  meta={[
                    { icon: Hash, label: project.reference },
                    { icon: CalendarDays, label: project.dueDate ? `${late ? "En retard · " : "Échéance "}${formatDateOnly(project.dueDate)}` : "Sans échéance" },
                  ]}
                  progress={{
                    value: project.progressPercent,
                    ratio: `${project.progressPercent ?? 0} %`,
                    tone: progressTone(project.status),
                    label: `Avancement de ${project.name}`,
                  }}
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
              );
            })}
          </ItemGrid>
        ) : null}

        {items.length > 0 && mode === "list" ? (
          <ListTable
            label="Projets"
            rows={items}
            rowHref={(project) => `/espace-equipe/projets/${project.id}`}
            columns={[
              {
                key: "name",
                label: "Projet",
                render: (project) => (
                  <span className="sui-table__primary">
                    <strong>{project.name}</strong>
                    <span>{project.reference}</span>
                  </span>
                ),
              },
              { key: "client", label: "Client", render: (project) => project.client?.companyName ?? "—" },
              {
                key: "status",
                label: "Statut",
                render: (project) => <StatusPill tone={STATUS_TONE[project.status] ?? "plain"} label={PROJECT_STATUS[project.status] ?? project.status} />,
              },
              {
                key: "progress",
                label: "Avancement",
                className: "sui-table__progress",
                render: (project) => <ProgressBar value={project.progressPercent} tone={progressTone(project.status)} label={`Avancement de ${project.name}`} />,
              },
              {
                key: "due",
                label: "Échéance",
                align: "end",
                render: (project) => {
                  const late = !CLOSED.includes(project.status) && project.dueDate && isDeadlinePassed(project.dueDate, now);
                  if (!project.dueDate) return <span className="sui-table__muted">—</span>;
                  return late ? (
                    <span className="sui-table__late" title="Échéance dépassée">
                      {formatDateOnly(project.dueDate)}
                      <span className="sr-only"> — échéance dépassée</span>
                    </span>
                  ) : (
                    formatDateOnly(project.dueDate)
                  );
                },
              },
            ]}
          />
        ) : null}

        <Pagination meta={projects.meta} onPageChange={setPage} loading={projects.loading} />
      </section>
    </div>
  );
}
