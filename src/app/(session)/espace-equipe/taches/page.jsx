"use client";

import { useState } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { formatDate, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Field, Notice, inputClass, primaryButton, selectClass } from "@/components/workspace/ui";

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
  const projects = useListing("/projects?perPage=100");
  const [projectId, setProjectId] = useState("");
  const list = projects.items ?? [];
  const current = projectId || list[0]?.id || "";

  return (
    <div className="flex flex-col gap-6">
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
        {projects.error ? <Notice>{projects.error}</Notice> : null}
        {projects.items !== null && list.length === 0 ? <Empty>Aucun projet accessible.</Empty> : null}
      </Card>

      {current ? <Board key={current} projectId={current} /> : null}
    </div>
  );
}

function Board({ projectId }) {
  const { user, request } = useAuth();
  const canWrite = can(user, "task:write:any") || can(user, "task:write:own");
  const tasks = useListing(`/projects/${projectId}/tasks?perPage=100`);
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
    if (!task || columnOf(task.status) === targetColumn) return;
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

  return (
    <div className="flex flex-col gap-6">
      {canWrite ? <NewTask projectId={projectId} onCreated={tasks.reload} /> : null}
      {tasks.error ? <Notice>{tasks.error}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
      {tasks.items === null && !tasks.error ? <p className="cx-small">Chargement des tâches…</p> : null}

      <DndContext sensors={sensors} onDragStart={(e) => setActiveId(e.active.id)} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" role="list" aria-label="Tableau des tâches">
          {COLUMNS.map((column) => (
            <Column key={column.id} column={column} tasks={byColumn[column.id]} canWrite={canWrite} />
          ))}
        </div>
        <DragOverlay>{active ? <TaskCard task={active} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({ column, tasks, canWrite }) {
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
        <DraggableTask key={task.id} task={task} canWrite={canWrite} />
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

function TaskCard({ task, overlay = false }) {
  return (
    <article
      className={`rounded-xl border border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)] p-3 shadow-sm ${overlay ? "rotate-1 shadow-lg" : ""} cursor-grab touch-none`}
      aria-roledescription="tâche déplaçable"
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
