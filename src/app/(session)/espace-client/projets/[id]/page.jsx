"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/session";
import { formatDate, messageOf } from "@/lib/api";
import { useListing } from "@/lib/use-listing";
import { MILESTONE_STATUS, PROJECT_STATUS, TASK_STATUS } from "@/lib/labels";
import { Badge, Card, Empty, Notice, Pagination, ProgressBar, secondaryButton } from "@/components/workspace/ui";

const MILESTONE_TONE = { PLANNED: "neutral", REACHED: "success", MISSED: "danger", CANCELLED: "neutral" };

/**
 * Suivi d'un projet, cote client. Chaque bloc est charge a part : un bloc refuse
 * (droits) est simplement masque, il ne bloque pas le reste de la page.
 */
export default function ProjetClientPage({ params }) {
  const { id } = use(params);
  const { download } = useAuth();
  const [milestonePage, setMilestonePage] = useState(1);
  const [taskPage, setTaskPage] = useState(1);
  const [documentPage, setDocumentPage] = useState(1);
  const project = useListing(`/projects/${encodeURIComponent(id)}`);
  const milestones = useListing(`/projects/${encodeURIComponent(id)}/milestones?page=${milestonePage}&perPage=100`);
  const tasks = useListing(`/projects/${encodeURIComponent(id)}/tasks?page=${taskPage}&perPage=100`);
  const documents = useListing(`/documents?projectId=${encodeURIComponent(id)}&page=${documentPage}&perPage=100`);
  const [downloadError, setDownloadError] = useState(null);

  const current = project.items;
  // Taches : un compte sans droit recoit un refus, le bloc est alors masque.
  const tasksVisible = tasks.errorStatus !== 403;
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
    return <p className="text-[14px] text-[var(--comexa-ink-soft)]" role="status">Chargement du projet…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/espace-client" className="text-[14px] text-[var(--comexa-accent-strong)] hover:underline">
        ← Retour à mon espace
      </Link>

      <Card title={current.name}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{PROJECT_STATUS[current.status] ?? current.status}</Badge>
            <span className="text-[13px] text-[var(--comexa-ink-muted)]">Référence {current.reference}</span>
          </div>
          <ProgressBar value={current.progressPercent} />
          <p className="text-[14px] text-[var(--comexa-ink-soft)]">
            Échéance prévue : <strong className="text-[var(--comexa-ink)]">{formatDate(current.dueDate)}</strong>
            {current.manager ? (
              <>
                {" "}· Chef de projet : {current.manager.firstName} {current.manager.lastName}
              </>
            ) : null}
          </p>
        </div>
      </Card>

      {milestones.errorStatus === 403 ? null : (
        <Card title="Jalons">
          {milestones.error ? <Notice>{milestones.error}</Notice> : null}
          {milestones.items === null && !milestones.error ? <p className="cx-small" role="status">Chargement des jalons…</p> : null}
          {milestones.items !== null && milestoneList.length === 0 ? <Empty>Les jalons du projet seront publiés ici.</Empty> : null}
          <ol className="flex flex-col gap-3">
            {milestoneList.map((milestone) => (
              <li key={milestone.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] p-4">
                <div>
                  <h3 className="text-[15px] font-semibold text-[var(--comexa-ink)]">{milestone.title}</h3>
                  {milestone.description ? <p className="text-[13.5px] text-[var(--comexa-ink-soft)]">{milestone.description}</p> : null}
                  <p className="text-[13px] text-[var(--comexa-ink-muted)]">
                    Échéance {formatDate(milestone.dueDate)}
                    {milestone.reachedAt ? ` · atteint le ${formatDate(milestone.reachedAt)}` : ""}
                  </p>
                </div>
                <Badge tone={MILESTONE_TONE[milestone.status] ?? "neutral"}>{MILESTONE_STATUS[milestone.status] ?? milestone.status}</Badge>
              </li>
            ))}
          </ol>
          <Pagination meta={milestones.meta} onPageChange={setMilestonePage} loading={milestones.loading} />
        </Card>
      )}

      {tasksVisible ? (
        <Card title="Tâches et échéances">
          {tasks.error ? <Notice>{tasks.error}</Notice> : null}
          {tasks.items === null && !tasks.error ? <p className="cx-small" role="status">Chargement des tâches…</p> : null}
          {tasks.items !== null && tasks.items.length === 0 ? <Empty>Aucune tâche visible pour le moment.</Empty> : null}
          <ul className="flex flex-col gap-2">
            {(tasks.items ?? []).map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] px-4 py-3">
                <span className="text-[15px] text-[var(--comexa-ink)]">{task.title}</span>
                <span className="flex items-center gap-3 text-[13px] text-[var(--comexa-ink-soft)]">
                  échéance {formatDate(task.dueDate)}
                  <Badge tone={task.status === "DONE" ? "success" : "neutral"}>{TASK_STATUS[task.status] ?? task.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
          <Pagination meta={tasks.meta} onPageChange={setTaskPage} loading={tasks.loading} />
        </Card>
      ) : null}

      {documents.errorStatus === 403 ? null : (
        <Card title="Documents">
          {downloadError ? <Notice>{downloadError}</Notice> : null}
          {documents.error ? <Notice>{documents.error}</Notice> : null}
          {documents.items === null && !documents.error ? <p className="cx-small" role="status">Chargement des documents…</p> : null}
          {documents.items !== null && documentsList.length === 0 ? <Empty>Aucun document partagé pour le moment.</Empty> : null}
          <ul className="flex flex-col gap-2">
            {documentsList.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] px-4 py-3">
                <div>
                  <p className="text-[15px] text-[var(--comexa-ink)]">{document.name}</p>
                  <p className="text-[13px] text-[var(--comexa-ink-muted)]">
                    {formatDate(document.createdAt)} · version {document.version}
                  </p>
                </div>
                <button type="button" onClick={() => handleDownload(document)} className={secondaryButton}>
                  Télécharger
                </button>
              </li>
            ))}
          </ul>
          <Pagination meta={documents.meta} onPageChange={setDocumentPage} loading={documents.loading} />
        </Card>
      )}
    </div>
  );
}
