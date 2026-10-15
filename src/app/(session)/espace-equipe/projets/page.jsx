"use client";

/*
 * Projets (espace équipe) — même appel `/projects`, présentation en cartes
 * « soft UI » : pastille de statut, barre de progression 4 px avec ratio en
 * texte, méta client et échéance, action principale noire vers la fiche projet.
 */

import { useState } from "react";
import { ArrowUpRight, CalendarDays, CircleAlert, Folder, Users } from "lucide-react";
import { formatDate } from "@/lib/api";
import { PROJECT_STATUS } from "@/lib/labels";
import { useListing } from "@/lib/use-listing";
import { Pagination } from "@/components/workspace/ui";
import { Alert, ItemCard, ItemGrid } from "@/components/softui";

const STATUS_TONE = {
  DRAFT: "plain",
  PLANNED: "blue",
  IN_PROGRESS: "yellow",
  ON_HOLD: "lilac",
  REVIEW: "lilac",
  COMPLETED: "green",
  CANCELLED: "pink",
  ARCHIVED: "plain",
};

export default function ProjetsEquipePage() {
  const [page, setPage] = useState(1);
  const projects = useListing(`/projects?page=${page}&perPage=50`);
  const items = projects.items ?? [];

  return (
    <div className="flex flex-col">
      {projects.error ? <Alert icon={CircleAlert}>{projects.error}</Alert> : null}

      <section className="sui-section" style={{ marginTop: 0 }} aria-label="Liste des projets">
        {projects.items === null && !projects.error ? <p className="sui-card__desc" role="status">Chargement des projets…</p> : null}
        {projects.items !== null && items.length === 0 ? (
          <p className="sui-card__desc">Aucun projet. Un projet est créé lorsqu’une commande ou une demande est validée par l’équipe.</p>
        ) : null}

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
                { icon: ArrowUpRight, label: `Ouvrir le projet ${project.name}`, href: `/espace-equipe/projets/${project.id}`, variant: "dark" },
              ]}
            />
          ))}
        </ItemGrid>

        <Pagination meta={projects.meta} onPageChange={setPage} loading={projects.loading} />
      </section>

      {items.length ? (
        <p className="sui-card__desc" style={{ marginTop: 12 }}>
          {items.length} projet{items.length > 1 ? "s" : ""} sur cette page.
        </p>
      ) : null}
    </div>
  );
}
