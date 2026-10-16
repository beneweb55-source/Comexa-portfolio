"use client";

import { useState } from "react";
import Link from "next/link";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { formatDate, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Field, Notice, Pagination, SkeletonList, inputClass, primaryButton, selectClass } from "@/components/workspace/ui";
import { EVERY_CREATOR, creatorNameOf, taskCreatorsPath, taskListPath, tasksPayloadIsOutdated } from "@/lib/tasks";
import { TaskCreatorFilter } from "@/components/workspace/TaskCreatorFilter";
import { UserAvatar } from "@/components/workspace/UserAvatar";
import { useShellQuery } from "@/components/softui/Shell";

const COLUMNS = [
  { id: "TODO", label: "À faire" },
  { id: "IN_PROGRESS", label: "En cours" },
  { id: "IN_REVIEW", label: "En revue" },
  { id: "DONE", label: "Terminé" },
];

function columnOf(status) {
  if (status === "BLOCKED") return "IN_PROGRESS";
  return COLUMNS.some((c) => c.id === status) ? status : null;
}

const PRIORITY_TONE = { LOW: "neutral", NORMAL: "info", HIGH: "warning", URGENT: "danger" };
const PRIORITY_LABEL = { LOW: "Basse", NORMAL: "Normale", HIGH: "Haute", URGENT: "Urgente" };

export default function TachesPage() {
  const { user } = useAuth();
  const canReadProjects = ["project:read:any", "project:read:own", "project:read:assigned"].some((permission) => can(user, permission));
  const [projectPage, setProjectPage] = useState(1);
  const projects = useListing(canReadProjects ? `/projects?page=${projectPage}&perPage=100` : null);
  const [projectId, setProjectId] = useState("");
  const list = projects.items ?? [];
  const current = projectId || list[0]?.id || "";

  return (
    <div className="flex flex-col gap-6">
      <p className="sui-space-hint">
        Vos tâches personnelles et privées se trouvent dans votre{" "}
        <Link href="/espace-personnel/taches">espace personnel</Link> : elles n’apparaissent jamais dans ce tableau partagé.
      </p>

      <Card
        title="Tableau Kanban par projet"
        subtitle="Glissez une tâche d’une colonne à l’autre pour mettre à jour son statut."
        action={
          <Field id="kanban-project" label="Choisir le projet">
            <select id="kanban-project" className={`${selectClass} !w-[320px]`} value={current} onChange={(e) => setProjectId(e.target.value)} disabled={list.length === 0}>
              {list.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </Field>
        }
      >
        {!canReadProjects ? <Notice>Votre rôle ne permet pas de consulter les projets nécessaires à ce tableau.</Notice> : null}
        {canReadProjects && projects.error ? <Notice>{projects.error}</Notice> : null}
        {canReadProjects && projects.items !== null && list.length === 0 ? <Empty>Aucun projet accessible.</Empty> : null}
        {canReadProjects ? (
          <Pagination
            meta={projects.meta}
            label="Pagination des projets"
            onPageChange={(nextPage) => {
              setProjectId("");
              setProjectPage(nextPage);
            }}
            loading={projects.loading}
          />
        ) : null}
      </Card>

      {current ? <Board key={current} projectId={current} /> : null}
    </div>
  );
}

function Board({ projectId }) {
  const { user, request } = useAuth();
  const { query: shellQuery } = useShellQuery();
  const canReadTasks = ["task:read:any", "task:read:assigned", "task:read:own"].some((permission) => can(user, permission));
  const canWriteAny = can(user, "task:write:any");
  const canWriteOwn = can(user, "task:write:own");
  const canWrite = canWriteAny || canWriteOwn;
  const canWriteTask = (task) => canWriteAny || (canWriteOwn && task.assigneeId === user?.id);
  const [taskPage, setTaskPage] = useState(1);
  const [creatorId, setCreatorId] = useState(EVERY_CREATOR);
  const tasks = useListing(canReadTasks ? taskListPath(projectId, { page: taskPage, perPage: 100, reporterId: creatorId }) : null);
  const creators = useListing(canReadTasks ? taskCreatorsPath(projectId) : null);
  const [overrides, setOverrides] = useState({});
  const [error, setError] = useState(null);
  const [activeId, setActiveId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const q = shellQuery.trim().toLowerCase();
  const all = (tasks.items ?? [])
    .map((t) => ({ ...t, status: overrides[t.id] ?? t.status }))
    .filter((t) => !q || String(t.title ?? "").toLowerCase().includes(q));

  const byColumn = Object.fromEntries(COLUMNS.map((c) => [c.id, []]));
  for (const task of all) {
    const col = columnOf(task.status);
    if (col) byColumn[col].push(task);
  }
  const active = activeId ? all.find((t) => t.id === activeId) : null;

  async function move(taskId, targetColumn) {
    const task = all.find((t) => t.id === taskId);
    if (!task || !canWriteTask(task) || columnOf(task.status) === targetColumn) return;
    const previous = task.status;
    setError(null);
    setOverrides((o) => ({ ...o, [taskId]: targetColumn }));
    try {
      await request(`/tasks/${taskId}/status`, { method: "PATCH", body: { status: targetColumn } });
    } catch (caught) {
      setOverrides((o) => {
        const next = { ...o };
        delete next[taskId];
        return next;
      });
      setError(`« ${task.title} » n’a pas pu être déplacée (${messageOf(caught)}). Statut restauré : ${previous}.`);
    }
  }

  function onDragEnd(event) {
    setActiveId(null);
    const { active: dragged, over } = event;
    if (over && canWrite) move(dragged.id, over.id);
  }

  async function onTaskCreated() {
    setCreatorId(EVERY_CREATOR);
    if (taskPage === 1) await tasks.reload();
    else setTaskPage(1);
    await creators.reload();
  }

  function onCreatorChange(nextCreatorId) {
    setCreatorId(nextCreatorId);
    setTaskPage(1);
  }

  return (
    <div className="flex flex-col gap-6">
      {canWrite ? <NewTask projectId={projectId} onCreated={onTaskCreated} /> : null}
      {canReadTasks && tasks.error ? <Notice>{tasks.error}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
      {canReadTasks && tasks.items === null && !tasks.error ? <SkeletonList rows={3} /> : null}
      {!canReadTasks ? <Notice>Votre rôle ne permet pas de consulter la liste des tâches de ce projet.</Notice> : null}

      {canReadTasks ? (
        <>
          <TaskCreatorFilter
            creators={creators.items}
            value={creatorId}
            onChange={onCreatorChange}
            loading={creators.loading}
            error={creators.error}
            errorStatus={creators.errorStatus}
          />
          {tasksPayloadIsOutdated(tasks.items) ? (
            <Notice>
              Cette version de l’API ne renvoie ni le projet ni le créateur des tâches : le serveur
              backend tourne sur une version antérieure au frontend. Reconstruisez-le et redémarrez-le
              (npm run build puis node dist/main.js dans backend/).
            </Notice>
          ) : null}
          {tasks.items?.length === 0 ? (
            <Empty>
              {creatorId
                ? "Aucune tâche de cette personne dans ce projet."
                : "Aucune tâche dans ce projet."}
            </Empty>
          ) : null}
          <DndContext sensors={sensors} onDragStart={(e) => setActiveId(e.active.id)} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" role="list" aria-label="Tableau des tâches">
              {COLUMNS.map((column) => (
                <Column key={column.id} column={column} tasks={byColumn[column.id]} canWrite={canWrite} canWriteTask={canWriteTask} />
              ))}
            </div>
            <DragOverlay>{active ? <TaskCard task={active} canWrite={canWriteTask(active)} overlay /> : null}</DragOverlay>
          </DndContext>
          <Pagination meta={tasks.meta} onPageChange={setTaskPage} loading={tasks.loading} />
        </>
      ) : null}
    </div>
  );
}

function Column({ column, tasks, canWrite, canWriteTask }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: !canWrite });
  return (
    <section
      ref={setNodeRef}
      role="listitem"
      aria-label={`${column.label} (${tasks.length})`}
      className={`flex min-h-[260px] flex-col gap-3 rounded-2xl border p-3.5 transition ${isOver ? "border-[var(--comexa-accent)] bg-[var(--comexa-accent-soft)]" : "border-[var(--comexa-border-soft)] bg-[var(--comexa-surface-alt)]"}`}
    >
      <header className="flex items-center justify-between px-1 pt-1">
        <h3 className="text-[14px] font-bold text-[var(--comexa-ink)]">{column.label}</h3>
        <span className="cx-tabular rounded-full bg-[var(--comexa-surface)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--comexa-ink-soft)] shadow-2xs">{tasks.length}</span>
      </header>
      {tasks.map((task) => (
        <DraggableTask key={task.id} task={task} canWrite={canWriteTask(task)} />
      ))}
      {tasks.length === 0 ? <p className="px-1 py-6 text-center text-[13px] text-[var(--comexa-ink-muted)]">Aucune tâche</p> : null}
    </section>
  );
}

function DraggableTask({ task, canWrite }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled: !canWrite });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform) }} className={isDragging ? "opacity-40" : ""} {...attributes} {...listeners}>
      <TaskCard task={task} canWrite={canWrite} />
    </div>
  );
}

function TaskCard({ task, canWrite = false, overlay = false }) {
  return (
    <article
      className={`rounded-2xl border border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)] p-3.5 shadow-xs transition hover:border-[rgba(30,134,224,0.28)] ${overlay ? "rotate-1 shadow-lg" : ""} ${canWrite ? "cursor-grab touch-none" : "cursor-default"}`}
      aria-roledescription={canWrite ? "tâche déplaçable" : undefined}
    >
      <p className="text-[14px] font-semibold text-[var(--comexa-ink)]">{task.title}</p>
      {task.project?.name ? <p className="mt-0.5 text-[12px] text-[var(--comexa-ink-muted)]">Projet {task.project.name}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
        <Badge tone={PRIORITY_TONE[task.priority] ?? "neutral"}>{PRIORITY_LABEL[task.priority] ?? task.priority}</Badge>
        {task.status === "BLOCKED" ? <Badge tone="danger">Bloquée</Badge> : null}
        {task.dueDate ? <span className="text-[var(--comexa-ink-muted)]">Échéance {formatDate(task.dueDate)}</span> : null}
      </div>
      <div className="mt-2.5 flex items-center gap-2 text-[12px] text-[var(--comexa-ink-soft)]">
        <UserAvatar profile={task.reporter} size={22} />
        <span>{creatorNameOf(task.reporter)}</span>
      </div>
    </article>
  );
}

function NewTask({ projectId, onCreated }) {
  const { request } = useAuth();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (title.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      await request(`/projects/${projectId}/tasks`, { method: "POST", body: { title: title.trim() } });
      setTitle("");
      await onCreated();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      {error ? <div className="w-full"><Notice>{error}</Notice></div> : null}
      <Field id="new-task-title" label="Nouvelle tâche">
        <input id="new-task-title" className={`${inputClass} !w-[360px]`} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Maquette de la page d’accueil" />
      </Field>
      <button type="submit" disabled={busy || title.trim().length < 2} className={primaryButton}>{busy ? "Ajout…" : "Ajouter"}</button>
    </form>
  );
}
