"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { formatDate, messageOf } from "@/lib/api";
import { MILESTONE_STATUS, PROJECT_STATUS, TASK_STATUS } from "@/lib/labels";
import { EVERY_CREATOR, creatorNameOf, taskCreatorsPath, taskListPath } from "@/lib/tasks";
import { useAction, useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Notice, Pagination, inputClass, primaryButton, secondaryButton } from "@/components/workspace/ui";
import { TaskCreatorFilter } from "@/components/workspace/TaskCreatorFilter";
import { UserAvatar } from "@/components/workspace/UserAvatar";

const TASK_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE", "CANCELLED"];
const PROJECT_STATUSES = ["DRAFT", "PLANNED", "IN_PROGRESS", "ON_HOLD", "IN_REVIEW", "COMPLETED", "CANCELLED", "ARCHIVED"];

export default function ProjetEquipePage({ params }) {
  const { id } = use(params);
  const { user, download } = useAuth();
  const canReadTasks = ["task:read:any", "task:read:assigned", "task:read:own"].some((permission) => can(user, permission));
  const canWriteTasks = ["task:write:any", "task:write:own"].some((permission) => can(user, permission));
  const canReadMilestones = can(user, "milestone:read:any");
  const canWriteMilestones = can(user, "milestone:write:any");
  const canReadDocuments = ["document:read:any", "document:read:own", "document:read:client"].some((permission) => can(user, permission));
  const canSetProjectStatus = can(user, "project:manage:status");
  const [milestonePage, setMilestonePage] = useState(1);
  const [taskPage, setTaskPage] = useState(1);
  const [documentPage, setDocumentPage] = useState(1);
  // « Tous » par défaut : aucune tâche du projet n'est masquée à l'ouverture.
  const [taskCreatorId, setTaskCreatorId] = useState(EVERY_CREATOR);
  const project = useListing(`/projects/${id}`);
  const milestones = useListing(canReadMilestones ? `/projects/${id}/milestones?page=${milestonePage}&perPage=100` : null);
  // Les tâches du projet, quel que soit leur auteur. Le filtre « par personne »
  // ajoute `reporterId` — un identifiant de compte — et le serveur le combine en
  // `AND` avec ce projet : le filtre ne peut pas faire sortir la liste d'ici.
  const tasks = useListing(canReadTasks ? taskListPath(id, { page: taskPage, perPage: 100, reporterId: taskCreatorId }) : null);
  const taskCreators = useListing(canReadTasks ? taskCreatorsPath(id) : null);
  const documents = useListing(canReadDocuments ? `/documents?projectId=${id}&page=${documentPage}&perPage=100` : null);

  const reloadAll = async () => {
    const reloads = [project.reload()];
    if (canReadMilestones) reloads.push(milestones.reload());
    if (canReadTasks) reloads.push(tasks.reload(), taskCreators.reload());
    await Promise.all(reloads);
  };
  const action = useAction(reloadAll);

  const [projectStatus, setProjectStatus] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskVisible, setTaskVisible] = useState(false);
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDue, setMilestoneDue] = useState("");
  const [taskFormError, setTaskFormError] = useState(null);
  const [milestoneFormError, setMilestoneFormError] = useState(null);
  const [downloadError, setDownloadError] = useState(null);

  const current = project.items;

  async function changeProjectStatus(event) {
    event.preventDefault();
    const status = projectStatus || current?.status;
    await action.run("project-status", `/projects/${id}/status`, { method: "PATCH", body: { status } }, "Statut du projet mis à jour.");
  }

  async function createTask(event) {
    event.preventDefault();
    setTaskFormError(null);
    if (!taskTitle.trim()) {
      setTaskFormError("Le titre de la tâche est obligatoire.");
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
      // Le créateur est le porteur : la tâche qui vient de naître doit être
      // visible, donc on revient sur « Tous » plutôt que de la cacher derrière un
      // filtre resté sur quelqu'un d'autre.
      setTaskCreatorId(EVERY_CREATOR);
      setTaskPage(1);
    }
  }

  async function createMilestone(event) {
    event.preventDefault();
    setMilestoneFormError(null);
    if (!milestoneTitle.trim()) {
      setMilestoneFormError("Le titre du jalon est obligatoire.");
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

  const error = project.error ?? (canReadMilestones ? milestones.error : null) ?? (canReadTasks ? tasks.error : null);

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
            {canSetProjectStatus ? (
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
                <button type="submit" disabled={Boolean(action.busy)} className={`${secondaryButton} h-10`}>
                  Enregistrer le statut
                </button>
              </form>
            ) : null}
          </div>
        </Card>
      ) : null}

      {canReadMilestones || canWriteMilestones ? (
        <Card title="Jalons">
        {canReadMilestones && milestones.items?.length === 0 ? <Empty>Aucun jalon.</Empty> : null}
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
        {canReadMilestones ? <Pagination meta={milestones.meta} onPageChange={setMilestonePage} loading={milestones.loading} /> : null}
        {canWriteMilestones ? (
          <form onSubmit={createMilestone} className="mt-5 grid gap-3 border-t border-[var(--comexa-border-soft)] pt-5 md:grid-cols-[1fr_180px_auto] md:items-end">
            <label className="flex flex-col gap-1 text-[13px] text-[var(--comexa-ink-soft)]">
              Nouveau jalon
              <input value={milestoneTitle} onChange={(event) => setMilestoneTitle(event.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] text-[var(--comexa-ink-soft)]">
              Échéance
              <input type="date" value={milestoneDue} onChange={(event) => setMilestoneDue(event.target.value)} className={inputClass} />
            </label>
            <button type="submit" disabled={Boolean(action.busy)} className={primaryButton}>
              Ajouter le jalon
            </button>
          </form>
        ) : null}
        {canWriteMilestones && milestoneFormError ? <div className="mt-3"><Notice>{milestoneFormError}</Notice></div> : null}
        </Card>
      ) : null}

      {canReadTasks || canWriteTasks ? (
        <Card title="Tâches">
        {canReadTasks ? (
          <div className="mb-5">
            <TaskCreatorFilter
              creators={taskCreators.items}
              value={taskCreatorId}
              onChange={(creatorId) => {
                setTaskCreatorId(creatorId);
                // Un changement de filtre repart de la première page : rester en
                // page 3 d'une liste qui vient de se réduire afficherait un vide
                // trompeur.
                setTaskPage(1);
              }}
              loading={taskCreators.loading}
              error={taskCreators.error}
            />
          </div>
        ) : null}
        {canReadTasks && tasks.items?.length === 0 ? (
          <Empty>
            {taskCreatorId
              ? "Aucune tâche de cette personne dans ce projet."
              : "Aucune tâche dans ce projet."}
          </Empty>
        ) : null}
        <ul className="flex flex-col gap-2">
          {(tasks.items ?? []).map((task) => (
            <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] px-4 py-3">
              <div className="min-w-0">
                <p className="text-[15px] text-[var(--comexa-ink)]">{task.title}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--comexa-ink-muted)]">
                  <span>Projet {task.project?.name ?? current?.name ?? "—"}</span>
                  <span>échéance {formatDate(task.dueDate)}</span>
                  {task.isClientVisible ? <span>visible par le client</span> : null}
                  <span className="inline-flex items-center gap-2 text-[var(--comexa-ink-soft)]">
                    <UserAvatar profile={task.reporter} size={24} />
                    {creatorNameOf(task.reporter)}
                  </span>
                </p>
              </div>
              {canWriteTasks ? (
                <label className="flex items-center gap-2 text-[13px] text-[var(--comexa-ink-soft)]">
                  <span className="sr-only">Statut de la tâche {task.title}</span>
                  <select
                    value={task.status}
                    disabled={Boolean(action.busy)}
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
              ) : <Badge>{TASK_STATUS[task.status] ?? task.status}</Badge>}
            </li>
          ))}
        </ul>
        {canReadTasks ? <Pagination meta={tasks.meta} onPageChange={setTaskPage} loading={tasks.loading} /> : null}
        {canWriteTasks ? (
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
              <button type="submit" disabled={Boolean(action.busy)} className={primaryButton}>
                Ajouter
              </button>
            </div>
          </form>
        ) : null}
        {canWriteTasks && taskFormError ? <div className="mt-3"><Notice>{taskFormError}</Notice></div> : null}
        </Card>
      ) : null}

      {canReadDocuments ? (
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
        <Pagination meta={documents.meta} onPageChange={setDocumentPage} loading={documents.loading} />
        </Card>
      ) : null}
    </div>
  );
}
