"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/session";
import { formatDate, messageOf } from "@/lib/api";
import { MILESTONE_STATUS, PROJECT_STATUS, TASK_STATUS } from "@/lib/labels";
import { useAction, useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Notice, inputClass, primaryButton, secondaryButton } from "@/components/workspace/ui";

const TASK_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE", "CANCELLED"];
const PROJECT_STATUSES = ["DRAFT", "PLANNED", "IN_PROGRESS", "ON_HOLD", "IN_REVIEW", "COMPLETED", "CANCELLED", "ARCHIVED"];

export default function ProjetEquipePage({ params }) {
  const { id } = use(params);
  const { download } = useAuth();
  const project = useListing(`/projects/${id}`);
  const milestones = useListing(`/projects/${id}/milestones`);
  const tasks = useListing(`/projects/${id}/tasks?perPage=100`);
  const documents = useListing(`/documents?projectId=${id}&perPage=100`);

  const reloadAll = async () => {
    await Promise.all([project.reload(), milestones.reload(), tasks.reload()]);
  };
  const action = useAction(reloadAll);

  const [projectStatus, setProjectStatus] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskVisible, setTaskVisible] = useState(false);
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDue, setMilestoneDue] = useState("");
  const [formError, setFormError] = useState(null);
  const [downloadError, setDownloadError] = useState(null);

  const current = project.items;

  async function changeProjectStatus(event) {
    event.preventDefault();
    const status = projectStatus || current?.status;
    await action.run("project-status", `/projects/${id}/status`, { method: "PATCH", body: { status } }, "Statut du projet mis à jour.");
  }

  async function createTask(event) {
    event.preventDefault();
    setFormError(null);
    if (!taskTitle.trim()) {
      setFormError("Le titre de la tâche est obligatoire.");
      return;
    }
    const result = await action.run(
      "task-create",
      `/projects/${id}/tasks`,
      { method: "POST", body: { title: taskTitle.trim(), dueDate: taskDue || null, isClientVisible: taskVisible } },
      "Tâche créée.",
    );
    if (result) {
      setTaskTitle("");
      setTaskDue("");
      setTaskVisible(false);
    }
  }

  async function createMilestone(event) {
    event.preventDefault();
    setFormError(null);
    if (!milestoneTitle.trim()) {
      setFormError("Le titre du jalon est obligatoire.");
      return;
    }
    const result = await action.run(
      "milestone-create",
      `/projects/${id}/milestones`,
      { method: "POST", body: { title: milestoneTitle.trim(), dueDate: milestoneDue || null } },
      "Jalon ajouté.",
    );
    if (result) {
      setMilestoneTitle("");
      setMilestoneDue("");
    }
  }

  async function handleDownload(document) {
    setDownloadError(null);
    try {
      await download(`/documents/${document.id}/content`, document.originalName);
    } catch (caught) {
      setDownloadError(messageOf(caught));
    }
  }

  const error = project.error ?? milestones.error ?? tasks.error;

  if (project.error && !current) {
    return (
      <div className="flex flex-col gap-4">
        <Notice>{project.error}</Notice>
        <Link href="/espace-equipe/projets" className={`${secondaryButton} self-start`}>
          Retour aux projets
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/espace-equipe/projets" className="text-[14px] text-[var(--comexa-accent-strong)] hover:underline">
        ← Retour aux projets
      </Link>

      {error ? <Notice>{error}</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}

      {current ? (
        <Card title={current.name}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 text-[14px] text-[var(--comexa-ink-soft)]">
              <span>{current.reference}</span>
              <Badge tone="info">{PROJECT_STATUS[current.status] ?? current.status}</Badge>
              <span>Client : {current.client?.companyName ?? "—"}</span>
              <span>Échéance : {formatDate(current.dueDate)}</span>
            </div>
            <form onSubmit={changeProjectStatus} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-[13px] text-[var(--comexa-ink-soft)]">
                Changer le statut
                <select value={projectStatus || current.status} onChange={(event) => setProjectStatus(event.target.value)} className={`${inputClass} h-10 w-auto min-w-[200px] text-[14px]`}>
                  {PROJECT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {PROJECT_STATUS[status]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={action.busy === "project-status"} className={`${secondaryButton} h-10`}>
                Enregistrer le statut
              </button>
            </form>
          </div>
        </Card>
      ) : null}

      <Card title="Jalons">
        {milestones.items?.length === 0 ? <Empty>Aucun jalon.</Empty> : null}
        <ol className="flex flex-col gap-2">
          {(milestones.items ?? []).map((milestone) => (
            <li key={milestone.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] px-4 py-3">
              <span className="text-[15px] text-[var(--comexa-ink)]">{milestone.title}</span>
              <span className="flex items-center gap-3 text-[13px] text-[var(--comexa-ink-soft)]">
                échéance {formatDate(milestone.dueDate)}
                <Badge>{MILESTONE_STATUS[milestone.status] ?? milestone.status}</Badge>
              </span>
            </li>
          ))}
        </ol>
        <form onSubmit={createMilestone} className="mt-5 grid gap-3 border-t border-[var(--comexa-border-soft)] pt-5 md:grid-cols-[1fr_180px_auto] md:items-end">
          <label className="flex flex-col gap-1 text-[13px] text-[var(--comexa-ink-soft)]">
            Nouveau jalon
            <input value={milestoneTitle} onChange={(event) => setMilestoneTitle(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-[var(--comexa-ink-soft)]">
            Échéance
            <input type="date" value={milestoneDue} onChange={(event) => setMilestoneDue(event.target.value)} className={inputClass} />
          </label>
          <button type="submit" disabled={action.busy === "milestone-create"} className={primaryButton}>
            Ajouter le jalon
          </button>
        </form>
      </Card>

      <Card title="Tâches">
        {tasks.items?.length === 0 ? <Empty>Aucune tâche.</Empty> : null}
        <ul className="flex flex-col gap-2">
          {(tasks.items ?? []).map((task) => (
            <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] px-4 py-3">
              <div>
                <p className="text-[15px] text-[var(--comexa-ink)]">{task.title}</p>
                <p className="text-[13px] text-[var(--comexa-ink-muted)]">
                  échéance {formatDate(task.dueDate)}
                  {task.isClientVisible ? " · visible par le client" : ""}
                </p>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-[var(--comexa-ink-soft)]">
                <span className="sr-only">Statut de la tâche {task.title}</span>
                <select
                  value={task.status}
                  onChange={(event) =>
                    action.run(`task:${task.id}`, `/tasks/${task.id}/status`, { method: "PATCH", body: { status: event.target.value } }, "Statut de la tâche mis à jour.")
                  }
                  className={`${inputClass} h-9 w-auto text-[13px]`}
                >
                  {TASK_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {TASK_STATUS[status]}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
        <form onSubmit={createTask} className="mt-5 grid gap-3 border-t border-[var(--comexa-border-soft)] pt-5 md:grid-cols-[1fr_180px_auto] md:items-end">
          <label className="flex flex-col gap-1 text-[13px] text-[var(--comexa-ink-soft)]">
            Nouvelle tâche
            <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-[var(--comexa-ink-soft)]">
            Échéance
            <input type="date" value={taskDue} onChange={(event) => setTaskDue(event.target.value)} className={inputClass} />
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-[var(--comexa-ink-soft)]">
              <input type="checkbox" checked={taskVisible} onChange={(event) => setTaskVisible(event.target.checked)} />
              Visible par le client
            </label>
            <button type="submit" disabled={action.busy === "task-create"} className={primaryButton}>
              Ajouter
            </button>
          </div>
        </form>
        {formError ? <div className="mt-3"><Notice>{formError}</Notice></div> : null}
      </Card>

      <Card title="Documents">
        {downloadError ? <Notice>{downloadError}</Notice> : null}
        {documents.error ? <Notice>{documents.error}</Notice> : null}
        {documents.items?.length === 0 ? <Empty>Aucun document rattaché à ce projet.</Empty> : null}
        <ul className="flex flex-col gap-2">
          {(documents.items ?? []).map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] px-4 py-3">
              <div>
                <p className="text-[15px] text-[var(--comexa-ink)]">{document.name}</p>
                <p className="text-[13px] text-[var(--comexa-ink-muted)]">
                  {document.category} · {document.visibility} · version {document.version}
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
