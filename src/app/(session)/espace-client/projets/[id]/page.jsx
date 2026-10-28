"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { formatDate, messageOf } from "@/lib/api";
import { useListing } from "@/lib/use-listing";
import { TASK_STATUS } from "@/lib/labels";
import { Badge, Card, Empty, Notice, Pagination, secondaryButton } from "@/components/workspace/ui";
import ClientProjectStory from "@/components/client/ClientProjectStory";

/**
 * Suivi d'un projet, cote client. La fiche et les jalons sont deja filtres par
 * le backend. Aucune tache interne n'est demandee : le role CLIENT n'a aucun
 * droit `task:*`, et le nouveau recit n'utilise que des jalons partageables.
 */
export default function ProjetClientPage({ params }) {
  const { id } = use(params);
  const { download, user } = useAuth();
  const canReadTasks = ["task:read:any", "task:read:assigned", "task:read:own"].some((code) => can(user, code));
  const [taskPage, setTaskPage] = useState(1);
  const [documentPage, setDocumentPage] = useState(1);
  const project = useListing(`/projects/${encodeURIComponent(id)}`);
  const milestones = useListing(`/projects/${encodeURIComponent(id)}/milestones?page=1&perPage=100`);
  const tasks = useListing(canReadTasks ? `/projects/${encodeURIComponent(id)}/tasks?page=${taskPage}&perPage=100` : null);
  const documents = useListing(`/documents?projectId=${encodeURIComponent(id)}&page=${documentPage}&perPage=100`);
  const [downloadError, setDownloadError] = useState(null);

  const current = project.items;
  const tasksVisible = canReadTasks && tasks.errorStatus !== 403;
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
      <ClientProjectStory
        project={current}
        milestones={milestoneList}
        loading={milestones.items === null && !milestones.error}
        error={milestones.error}
      />

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
        <Card title="Documents partagés" subtitle="Seuls les documents autorisés pour votre dossier apparaissent ici.">
          {downloadError ? <Notice>{downloadError}</Notice> : null}
          {documents.error ? <Notice>{documents.error}</Notice> : null}
          {documents.items === null && !documents.error ? <p className="cx-small" role="status">Chargement des documents…</p> : null}
          {documents.items !== null && documentsList.length === 0 ? <Empty>Aucun document partagé pour le moment.</Empty> : null}
          <ul className="flex flex-col gap-2">
            {documentsList.map((document) => (
              <li key={document.id} className="client-document">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-[var(--comexa-ink)]">{document.name}</p>
                  <p className="text-[13px] text-[var(--comexa-ink-muted)]">
                    Ajouté le {formatDate(document.createdAt)} · version {document.version}
                  </p>
                </div>
                <button type="button" onClick={() => handleDownload(document)} className="client-focus__link" data-testid="client-document-download">
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
