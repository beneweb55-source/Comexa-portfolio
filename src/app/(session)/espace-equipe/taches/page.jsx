"use client";

import { useState } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { formatDate, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Field, Notice, Pagination, inputClass, primaryButton, selectClass } from "@/components/workspace/ui";
import { useTimer } from "@/lib/timer";
import { canUseTimer } from "@/lib/timer-access";

const COLUMNS = [
  { id: "TODO", label: "À faire" },
  { id: "IN_PROGRESS", label: "En cours" },
  { id: "IN_REVIEW", label: "En revue" },
  { id: "DONE", label: "Terminé" },
];

/** BLOCKED reste visible dans « En cours » (avec un badge) ; CANCELLED n'apparaît pas. */
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
      <PersonalTasks />

      <Card
        title="Projet"
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
  const canReadTasks = ["task:read:any", "task:read:assigned", "task:read:own"].some((permission) => can(user, permission));
  const canWriteAny = can(user, "task:write:any");
  const canWriteOwn = can(user, "task:write:own");
  const canWrite = canWriteAny || canWriteOwn;
  const canWriteTask = (task) => canWriteAny || (canWriteOwn && task.assigneeId === user?.id);
  const [taskPage, setTaskPage] = useState(1);
  const tasks = useListing(canReadTasks ? `/projects/${projectId}/tasks?page=${taskPage}&perPage=100` : null);
  const [overrides, setOverrides] = useState({});
  const [error, setError] = useState(null);
  const [activeId, setActiveId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const all = (tasks.items ?? []).map((t) => ({ ...t, status: overrides[t.id] ?? t.status }));
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
    if (taskPage === 1) await tasks.reload();
    else setTaskPage(1);
  }

  return (
    <div className="flex flex-col gap-6">
      {canWrite ? <NewTask projectId={projectId} onCreated={onTaskCreated} /> : null}
      {canReadTasks && tasks.error ? <Notice>{tasks.error}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
      {canReadTasks && tasks.items === null && !tasks.error ? <p className="cx-small">Chargement des tâches…</p> : null}
      {!canReadTasks ? <Notice>Votre rôle ne permet pas de consulter la liste des tâches de ce projet.</Notice> : null}

      {canReadTasks ? (
        <>
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
      className={`flex min-h-[260px] flex-col gap-3 rounded-2xl border p-3 transition ${isOver ? "border-[var(--comexa-accent)] bg-[var(--comexa-accent-soft)]" : "border-[var(--comexa-border-soft)] bg-[var(--comexa-surface-alt)]"}`}
    >
      <header className="flex items-center justify-between px-1 pt-1">
        <h3 className="text-[14px] font-semibold text-[var(--comexa-ink)]">{column.label}</h3>
        <span className="rounded-full bg-[var(--comexa-surface)] px-2 py-0.5 text-[12.5px] text-[var(--comexa-ink-soft)]">{tasks.length}</span>
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
      className={`rounded-xl border border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)] p-3 shadow-sm ${overlay ? "rotate-1 shadow-lg" : ""} ${canWrite ? "cursor-grab touch-none" : "cursor-default"}`}
      aria-roledescription={canWrite ? "tâche déplaçable" : undefined}
    >
      <p className="text-[14px] font-medium text-[var(--comexa-ink)]">{task.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
        <Badge tone={PRIORITY_TONE[task.priority] ?? "neutral"}>{PRIORITY_LABEL[task.priority] ?? task.priority}</Badge>
        {task.status === "BLOCKED" ? <Badge tone="danger">Bloquée</Badge> : null}
        {task.dueDate ? <span className="text-[var(--comexa-ink-muted)]">Échéance {formatDate(task.dueDate)}</span> : null}
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


// -----------------------------------------------------------------------------
// Tâches personnelles
// -----------------------------------------------------------------------------

const PERSONAL_STATUS_LABEL = {
  TODO: "À faire",
  IN_PROGRESS: "En cours",
  IN_REVIEW: "En revue",
  BLOCKED: "Bloqué",
  DONE: "Terminé",
  CANCELLED: "Annulé",
};
const PERSONAL_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "DONE", "CANCELLED"];

/**
 * « Mes tâches personnelles » — l'espace de travail privé de chaque membre.
 *
 * SÉPARATION STRICTE des deux espaces : ces tâches n'ont ni projet, ni client,
 * ni assignation (elles appartiennent à leur créateur), et n'apparaissent ni
 * dans le kanban d'un projet ni dans la vue d'un chef de projet. Le filtre
 * `?personalOnly=true` et le périmètre serveur (`task-read/WriteWhereFor`)
 * garantissent la même chose côté API : personne ne lit les tâches
 * personnelles d'un autre, quel que soit son rôle.
 */
function PersonalTasks() {
  const { user, request } = useAuth();
  const { start, timer } = useTimer();
  const canRead =
    ["task:read:any", "task:read:assigned", "task:read:own", "task:read:personal"].some((permission) =>
      can(user, permission),
    );
  const canCreate = can(user, "task:write:personal");
  const canTime = canUseTimer(user);
  const [page, setPage] = useState(1);
  const tasks = useListing(canRead ? `/me/tasks?personalOnly=true&page=${page}&perPage=25` : null);
  const [form, setForm] = useState({ title: "", description: "", priority: "NORMAL", dueDate: "", estimateMinutes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);

  if (!canRead) return null;

  async function refresh() {
    setConfirmingId(null);
    await tasks.reload();
  }

  async function onCreate(event) {
    event.preventDefault();
    if (!form.title.trim() || form.title.trim().length < 2) {
      setError("Le titre doit contenir au moins 2 caractères.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request("/me/tasks", {
        method: "POST",
        body: {
          title: form.title.trim(),
          ...(form.description.trim() ? { description: form.description.trim() } : {}),
          priority: form.priority,
          ...(form.dueDate ? { dueDate: new Date(`${form.dueDate}T12:00:00Z`).toISOString() } : {}),
          ...(form.estimateMinutes ? { estimateMinutes: Number(form.estimateMinutes) } : {}),
        },
      });
      setForm({ title: "", description: "", priority: "NORMAL", dueDate: "", estimateMinutes: "" });
      await refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onStatus(task, status) {
    if (status === task.status) return;
    setError(null);
    try {
      await request(`/tasks/${task.id}/status`, { method: "PATCH", body: { status } });
      await refresh();
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function onDelete(task) {
    setError(null);
    try {
      await request(`/tasks/${task.id}`, { method: "DELETE" });
      await refresh();
    } catch (caught) {
      setError(messageOf(caught));
      setConfirmingId(null);
    }
  }

  const items = tasks.items ?? [];

  return (
    <Card
      title="Mes tâches personnelles"
      action={<Badge tone="neutral">Privé · visible de vous seul</Badge>}
    >
      {canCreate ? (
        <form onSubmit={onCreate} className="mb-4 flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr]">
            <Field id="personal-title" label="Nouvelle tâche">
              <input
                id="personal-title"
                className={inputClass}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Ex. Préparer les notes de réunion"
                maxLength={300}
              />
            </Field>
            <Field id="personal-priority" label="Priorité">
              <select
                id="personal-priority"
                className={selectClass}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field id="personal-due" label="Échéance">
              <input
                id="personal-due"
                type="date"
                className={inputClass}
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </Field>
            <Field id="personal-estimate" label="Estimation (min)">
              <input
                id="personal-estimate"
                type="number"
                min={1}
                max={60000}
                className={inputClass}
                value={form.estimateMinutes}
                onChange={(e) => setForm({ ...form, estimateMinutes: e.target.value })}
                placeholder="60"
              />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className={primaryButton} disabled={busy || !form.title.trim()}>
              {busy ? "Création…" : "Créer la tâche"}
            </button>
            {error ? <p role="alert" className="text-[13px] text-[var(--comexa-error)]">{error}</p> : null}
          </div>
        </form>
      ) : null}

      {tasks.error ? <Notice>{tasks.error}</Notice> : null}
      {tasks.items !== null && items.length === 0 && !tasks.error ? (
        <Empty>Aucune tâche personnelle pour le moment.</Empty>
      ) : null}

      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((task) => {
            const running = timer?.taskId === task.id;
            return (
              <li
                key={task.id}
                className="flex flex-wrap items-center gap-3 rounded-[14px] border border-[var(--comexa-border-soft)] bg-white/70 px-4 py-3"
              >
                <div className="flex min-w-[220px] flex-1 flex-col">
                  <span className="text-[14px] font-semibold text-[var(--comexa-ink)]">{task.title}</span>
                  <span className="text-[12px] text-[#647991]">
                    {PRIORITY_LABEL[task.priority] ?? task.priority}
                    {task.dueDate ? ` · échéance ${formatDate(task.dueDate)}` : ""}
                    {task.estimateMinutes ? ` · ${task.estimateMinutes} min` : ""}
                    {running ? " · minuteur actif" : ""}
                  </span>
                </div>
                <select
                  aria-label={`Statut de ${task.title}`}
                  className={`${selectClass} !w-auto`}
                  value={task.status}
                  onChange={(e) => onStatus(task, e.target.value)}
                >
                  {PERSONAL_STATUSES.map((status) => (
                    <option key={status} value={status}>{PERSONAL_STATUS_LABEL[status]}</option>
                  ))}
                </select>
                {canTime && !running && task.status !== "DONE" && task.status !== "CANCELLED" ? (
                  <button
                    type="button"
                    className="rounded-[10px] border border-[var(--comexa-border-soft)] px-3 py-2 text-[12.5px] font-semibold text-[var(--comexa-ink)] hover:bg-white"
                    onClick={() => start(task)}
                  >
                    Minuteur
                  </button>
                ) : null}
                {confirmingId === task.id ? (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-[10px] bg-[var(--comexa-error)] px-3 py-2 text-[12.5px] font-semibold text-white"
                      onClick={() => onDelete(task)}
                    >
                      Confirmer
                    </button>
                    <button
                      type="button"
                      className="rounded-[10px] border border-[var(--comexa-border-soft)] px-3 py-2 text-[12.5px]"
                      onClick={() => setConfirmingId(null)}
                    >
                      Annuler
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="rounded-[10px] border border-[var(--comexa-border-soft)] px-3 py-2 text-[12.5px] text-[var(--comexa-error)] hover:bg-white"
                    onClick={() => setConfirmingId(task.id)}
                  >
                    Supprimer
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      <Pagination meta={tasks.meta} onPageChange={setPage} loading={tasks.loading} label="Pagination des tâches personnelles" />
    </Card>
  );
}
