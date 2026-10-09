"use client";

import Link from "next/link";
import { formatDate } from "@/lib/api";
import { PROJECT_STATUS } from "@/lib/labels";
import { useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Notice, ProgressBar } from "@/components/workspace/ui";

export default function ProjetsEquipePage() {
  const projects = useListing("/projects?perPage=50");
  const items = projects.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      {projects.error ? <Notice>{projects.error}</Notice> : null}
      <Card title="Projets">
        {projects.items === null && !projects.error ? <p className="text-[14px] text-[#4B5563]">Chargement…</p> : null}
        {projects.items !== null && items.length === 0 ? (
          <Empty>Aucun projet. Un projet est créé lorsqu’une commande ou une demande est validée par l’équipe.</Empty>
        ) : null}
        <ul className="flex flex-col gap-3">
          {items.map((project) => (
            <li key={project.id} className="grid gap-3 rounded-lg border border-[#E5ECF5] p-4 md:grid-cols-[1fr_200px_auto] md:items-center">
              <div>
                <p className="text-[12px] uppercase tracking-wide text-[#6B7280]">{project.reference}</p>
                <Link href={`/espace-equipe/projets/${project.id}`} className="text-[16px] font-semibold text-[#0B2545] hover:text-[#1683E5]">
                  {project.name}
                </Link>
                <p className="text-[13px] text-[#4B5563]">
                  {project.client?.companyName ?? "Client non renseigné"} · échéance {formatDate(project.dueDate)}
                </p>
              </div>
              <ProgressBar value={project.progressPercent} />
              <Badge tone="info">{PROJECT_STATUS[project.status] ?? project.status}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
