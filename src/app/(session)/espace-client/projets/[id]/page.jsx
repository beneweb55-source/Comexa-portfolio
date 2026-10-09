"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/session";
import { formatDate, messageOf } from "@/lib/api";
import { useListing } from "@/lib/use-listing";
import { MILESTONE_STATUS, PROJECT_STATUS, TASK_STATUS } from "@/lib/labels";
import { Badge, Card, Empty, Notice, ProgressBar, secondaryButton } from "@/components/workspace/ui";

const MILESTONE_TONE = { PLANNED: "neutral", REACHED: "success", MISSED: "danger", CANCELLED: "neutral" };

/**
 * Suivi d'un projet, cote client. Chaque bloc est charge a part : un bloc refuse
 * (droits) est simplement masque, il ne bloque pas le reste de la page.
 */
export default function ProjetClientPage({ params }) {
  const { id } = use(params);
  const { download } = useAuth();
  const project = useListing(`/projects/${id}`);
  const milestones = useListing(`/projects/${id}/milestones`);
  const tasks = useListing(`/projects/${id}/tasks?perPage=100`);
  const documents = useListing(`/documents?projectId=${id}&perPage=100`);
  const [downloadError, setDownloadError] = useState(null);

  const current = project.items;
  // Taches : un compte sans droit recoit un refus, le bloc est alors masque.
  const tasksVisible = tasks.items !== null;
  const documentsList = documents.items ?? [];
  const milestoneList = milestones.items ?? [];

  async function handleDownload(document) {
    setDownloadError(null);
    try {
      await download(`/documents/${document.id}/content`, document.originalName);
    } catch (caught) {
      setDownloadError(messageOf(caught));
    }
  }

  if (project.error && !current) {
    return (
      <div className="flex flex-col gap-4">
        <Notice>{project.error}</Notice>
        <Link href="/espace-client" className={`${secondaryButton} self-start`}>
          Retour à mon espace
        </Link>
      </div>
    );
  }

  if (!current) {
    return <p className="text-[14px] text-[#4B5563]" role="status">Chargement du projet…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/espace-client" className="text-[14px] text-[#1683E5] hover:underline">
        ← Retour à mon espace
      </Link>

      <Card title={current.name}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{PROJECT_STATUS[current.status] ?? current.status}</Badge>
            <span className="text-[13px] text-[#6B7280]">Référence {current.reference}</span>
          </div>
          <ProgressBar value={current.progressPercent} />
          <p className="text-[14px] text-[#4B5563]">
            Échéance prévue : <strong className="text-[#111827]">{formatDate(current.dueDate)}</strong>
            {current.manager ? (
              <>
                {" "}· Chef de projet : {current.manager.firstName} {current.manager.lastName}
              </>
            ) : null}
          </p>
        </div>
      </Card>

      <Card title="Jalons">
        {milestoneList.length === 0 ? <Empty>Les jalons du projet seront publiés ici.</Empty> : null}
        <ol className="flex flex-col gap-3">
          {milestoneList.map((milestone) => (
            <li key={milestone.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[#E5ECF5] p-4">
              <div>
                <h3 className="text-[15px] font-semibold text-[#0B2545]">{milestone.title}</h3>
                {milestone.description ? <p className="text-[13.5px] text-[#4B5563]">{milestone.description}</p> : null}
                <p className="text-[13px] text-[#6B7280]">
                  Échéance {formatDate(milestone.dueDate)}
                  {milestone.reachedAt ? ` · atteint le ${formatDate(milestone.reachedAt)}` : ""}
                </p>
              </div>
              <Badge tone={MILESTONE_TONE[milestone.status] ?? "neutral"}>{MILESTONE_STATUS[milestone.status] ?? milestone.status}</Badge>
            </li>
          ))}
        </ol>
      </Card>

      {tasksVisible ? (
        <Card title="Tâches et échéances">
          {tasks.items.length === 0 ? <Empty>Aucune tâche visible pour le moment.</Empty> : null}
          <ul className="flex flex-col gap-2">
            {tasks.items.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E5ECF5] px-4 py-3">
                <span className="text-[15px] text-[#111827]">{task.title}</span>
                <span className="flex items-center gap-3 text-[13px] text-[#4B5563]">
                  échéance {formatDate(task.dueDate)}
                  <Badge tone={task.status === "DONE" ? "success" : "neutral"}>{TASK_STATUS[task.status] ?? task.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="Documents">
        {downloadError ? <Notice>{downloadError}</Notice> : null}
        {documentsList.length === 0 ? <Empty>Aucun document partagé pour le moment.</Empty> : null}
        <ul className="flex flex-col gap-2">
          {documentsList.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E5ECF5] px-4 py-3">
              <div>
                <p className="text-[15px] text-[#111827]">{document.name}</p>
                <p className="text-[12.5px] text-[#6B7280]">
                  {formatDate(document.createdAt)} · version {document.version}
                </p>
              </div>
              <button type="button" onClick={() => handleDownload(document)} className={secondaryButton}>
                Télécharger
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
