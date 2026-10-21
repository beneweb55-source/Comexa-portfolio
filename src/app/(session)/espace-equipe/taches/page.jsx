"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock } from "lucide-react";
import { formatDateOnly, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Field, Notice, Pagination, SkeletonList, inputClass, primaryButton, selectClass } from "@/components/workspace/ui";
import {
  EVERY_ASSIGNEE,
  EVERY_CREATOR,
  UNASSIGNED,
  canWriteProjectTask,
  creatorNameOf,
  taskAssigneesPath,
  taskCreatorsPath,
  taskListPath,
  tasksPayloadIsOutdated,
} from "@/lib/tasks";
import { canMoveTo, dueBucket, isClosedStatus } from "@/lib/task-status.mjs";
import { TaskCreatorFilter } from "@/components/workspace/TaskCreatorFilter";
import { useShellQuery } from "@/components/softui/Shell";
import { AssigneeChip, AssigneeSelect } from "@/components/tasks/AssigneeControls";
import TaskTimerButton from "@/components/timer/TaskTimerButton";

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

/**
 * Tableau Kanban des tâches de projet. `?tache=<id>` (notification, lien
 * partagé) ouvre le projet de la tâche et la met en avant.
 */
export default function TachesPage() {
  return (
    <Suspense fallback={<SkeletonList rows={3} />}>
      <TachesBoard />
    </Suspense>
  );
}

function TachesBoard() {
  const { user, request } = useAuth();
  const searchParams = useSearchParams();
  const focusId = searchParams.get("tache");
  const canReadProjects = ["project:read:any", "project:read:own", "project:read:assigned"].some((permission) => can(user, permission));
  const [projectPage, setProjectPage] = useState(1);
  const projects = useListing(canReadProjects ? `/projects?page=${projectPage}&perPage=100` : null);
  const [projectId, setProjectId] = useState("");
  const [focus, setFocus] = useState({ id: focusId, error: null });
  const list = projects.items ?? [];
  const current = projectId || list[0]?.id || "";

  // Lien profond : la tâche indique son projet, qui devient le tableau affiché.
  useEffect(() => {
    if (!focusId) return undefined;
    let cancelled = false;
    request(`/tasks/${encodeURIComponent(focusId)}`)
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.projectId) setProjectId(data.projectId);
        setFocus({ id: data?.id ?? focusId, error: null });
      })
      .catch((caught) => {
        if (!cancelled) setFocus({ id: null, error: messageOf(caught) });
      });
    return () => {
      cancelled = true;
    };
  }, [focusId, request]);

  return (
    <div className="flex flex-col gap-6">
      <p className="sui-space-hint">
        Vos tâches personnelles et privées se trouvent dans votre{" "}
        <Link href="/espace-personnel/taches">espace personnel</Link> : elles n’apparaissent jamais dans ce tableau partagé.
      </p>

      {focus.error ? <Notice>La tâche demandée n’est pas accessible : {focus.error}</Notice> : null}

      <Card
        title="Tableau Kanban par projet"
        subtitle="Glissez une tâche d’une colonne à l’autre pour mettre à jour son statut."
        action={
          <Field id="kanban-project" label="Choisir le projet">
            <select id="kanban-project" className={`${selectClass} !w-[320px] max-w-full`} value={current} onChange={(e) => setProjectId(e.target.value)} disabled={list.length === 0}>
              {list.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
              {current && !list.some((project) => project.id === current) ? <option value={current}>Projet de la tâche demandée</option> : null}
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

      {current ? <Board key={current} projectId={current} focusId={focus.id} /> : null}
    </div>
  );
}

function Board({ projectId, focusId }) {
  const { user, request } = useAuth();
  const { query: shellQuery } = useShellQuery();
  const canReadTasks = ["task:read:any", "task:read:assigned", "task:read:own"].some((permission) => can(user, permission));
  const canWriteAny = can(user, "task:write:any");
  const canWriteOwn = can(user, "task:write:own");
  const canWrite = canWriteAny || canWriteOwn;
  const canAssign = can(user, "task:assign:any");
  const canWriteTask = (task) => canWriteProjectTask(task, { userId: user?.id, writeAny: canWriteAny, writeOwn: canWriteOwn });
  const [taskPage, setTaskPage] = useState(1);
  const [creatorId, setCreatorId] = useState(EVERY_CREATOR);
  const [assignee, setAssignee] = useState(EVERY_ASSIGNEE);
  const tasks = useListing(canReadTasks ? taskListPath(projectId, { page: taskPage, perPage: 100, reporterId: creatorId, assignee }) : null);
  const creators = useListing(canReadTasks ? taskCreatorsPath(projectId) : null);
  const people = useListing(canAssign ? taskAssigneesPath(projectId) : null);
  const [overrides, setOverrides] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [highlight, setHighlight] = useState(focusId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  // Met en avant la tâche du lien profond une fois le tableau chargé.
  useEffect(() => {
    if (!highlight || !tasks.items) return undefined;
    const node = document.getElementById(`kanban-${highlight}`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    const id = window.setTimeout(() => setHighlight(null), 4200);
    return () => window.clearTimeout(id);
  }, [highlight, tasks.items]);

  const q = shellQuery.trim().toLowerCase();
  const all = (tasks.items ?? [])
    .map((t) => ({ ...t, status: overrides[t.id] ?? t.status }))
    .filter((t) => !q || `${t.title ?? ""} ${t.assignee?.firstName ?? ""} ${t.assignee?.lastName ?? ""}`.toLowerCase().includes(q));

  const byColumn = Object.fromEntries(COLUMNS.map((c) => [c.id, []]));
  for (const task of all) {
    const col = columnOf(task.status);
    if (col) byColumn[col].push(task);
  }
  const active = activeId ? all.find((t) => t.id === activeId) : null;
  const unassignedCount = (tasks.items ?? []).filter((task) => !task.assigneeId && !isClosedStatus(task.status)).length;

  async function move(taskId, targetColumn) {
    const task = all.find((t) => t.id === taskId);
    if (!task || !canWriteTask(task) || columnOf(task.status) === targetColumn) return;
    const previous = task.status;
    setError(null);
    // Le serveur refuserait la transition : on l'explique au lieu de tenter.
    if (!canMoveTo({ status: previous, isPersonal: false }, targetColumn)) {
      setError(
        previous === "BLOCKED" && targetColumn === "DONE"
          ? `« ${task.title} » est bloquée : passez-la d’abord en « En cours » (ou « À faire ») avant de la terminer.`
          : `« ${task.title} » ne peut pas passer directement à « ${COLUMNS.find((c) => c.id === targetColumn)?.label} ».`,
      );
      return;
    }
    setOverrides((o) => ({ ...o, [taskId]: targetColumn }));
    try {
      await request(`/tasks/${taskId}/status`, { method: "PATCH", body: { status: targetColumn } });
    } catch (caught) {
      setOverrides((o) => {
        const next = { ...o };
        delete next[taskId];
        return next;
      });
      setError(`« ${task.title} » n’a pas pu être déplacée (${messageOf(caught)}). Statut restauré.`);
    }
  }

  async function assign(task, assigneeId) {
    setError(null);
    setNotice(null);
    setBusyId(task.id);
    try {
      const { data } = await request(`/tasks/${task.id}/assign`, { method: "PATCH", body: { assigneeId } });
      await Promise.all([tasks.reload(), people.reload()]);
      setNotice(
        assigneeId
          ? `« ${task.title} » est confiée à ${data?.assignee ? `${data.assignee.firstName} ${data.assignee.lastName}`.trim() : "la personne choisie"} : elle la retrouve dans ses tâches et a été prévenue.`
          : `« ${task.title} » n’est plus assignée.`,
      );
    } catch (caught) {
      setError(`« ${task.title} » : ${messageOf(caught)}`);
    } finally {
      setBusyId(null);
    }
  }

  function onDragEnd(event) {
    setActiveId(null);
    const { active: dragged, over } = event;
    if (over && canWrite) move(dragged.id, over.id);
  }

  async function onTaskCreated(message) {
    setCreatorId(EVERY_CREATOR);
    setAssignee(EVERY_ASSIGNEE);
    setNotice(message ?? null);
    if (taskPage === 1) await tasks.reload();
    else setTaskPage(1);
    await creators.reload();
    if (canAssign) await people.reload();
  }

  const cardProps = {
    canWriteTask,
    canAssign,
    people: people.items,
    onAssign: assign,
    busyId,
    highlight,
  };

  return (
    <div className="flex flex-col gap-6">
      {canWrite ? <NewTask projectId={projectId} canAssign={canAssign} people={people.items} onCreated={onTaskCreated} /> : null}
      {canReadTasks && tasks.error ? <Notice>{tasks.error}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {canReadTasks && tasks.items === null && !tasks.error ? <SkeletonList rows={3} /> : null}
      {!canReadTasks ? <Notice>Votre rôle ne permet pas de consulter la liste des tâches de ce projet.</Notice> : null}

      {canReadTasks ? (
        <>
          <div className="sui-board-filters" data-coach-id="taches-board">
            <TaskCreatorFilter
              creators={creators.items}
              value={creatorId}
              onChange={(next) => {
                setCreatorId(next);
                setTaskPage(1);
              }}
              loading={creators.loading}
              error={creators.error}
              errorStatus={creators.errorStatus}
            />
            <div className="sui-seg sui-board-filters__assign" role="group" aria-label="Filtrer par assignation">
              {[
                { id: EVERY_ASSIGNEE, label: "Toutes" },
                { id: user?.id ?? "me", label: "Les miennes" },
                { id: UNASSIGNED, label: unassignedCount && assignee !== UNASSIGNED ? `Non assignées (${unassignedCount})` : "Non assignées" },
              ].map((entry) => (
                <button
                  key={String(entry.id)}
                  type="button"
                  className="sui-seg__tab"
                  aria-pressed={assignee === entry.id}
                  onClick={() => {
                    setAssignee(entry.id);
                    setTaskPage(1);
                  }}
                >
                  {assignee === entry.id ? <span className="sui-seg__pill" aria-hidden="true" /> : null}
                  <span className="relative">{entry.label}</span>
                </button>
              ))}
            </div>
          </div>
          {tasksPayloadIsOutdated(tasks.items) ? (
            <Notice>
              Cette version de l’API ne renvoie ni le projet ni le créateur des tâches : le serveur
              backend tourne sur une version antérieure au frontend. Reconstruisez-le et redémarrez-le
              (npm run build puis node dist/main.js dans backend/).
            </Notice>
          ) : null}
          {tasks.items?.length === 0 ? (
            <Empty>
              {assignee === UNASSIGNED
                ? "Toutes les tâches de ce projet sont assignées."
                : assignee
                  ? "Aucune tâche ne vous est assignée dans ce projet."
                  : creatorId
                    ? "Aucune tâche de cette personne dans ce projet."
                    : "Aucune tâche dans ce projet."}
            </Empty>
          ) : null}
          <DndContext sensors={sensors} onDragStart={(e) => setActiveId(e.active.id)} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" role="list" aria-label="Tableau des tâches">
              {COLUMNS.map((column) => (
                <Column key={column.id} column={column} tasks={byColumn[column.id]} canWrite={canWrite} {...cardProps} />
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

function Column({ column, tasks, canWrite, canWriteTask, ...cardProps }) {
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
        <DraggableTask key={task.id} task={task} canWrite={canWriteTask(task)} {...cardProps} />
      ))}
      {tasks.length === 0 ? <p className="px-1 py-6 text-center text-[13px] text-[var(--comexa-ink-muted)]">Aucune tâche</p> : null}
    </section>
  );
}

function DraggableTask({ task, canWrite, ...cardProps }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled: !canWrite });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform) }} className={isDragging ? "opacity-40" : ""} {...attributes} {...listeners}>
      <TaskCard task={task} canWrite={canWrite} {...cardProps} />
    </div>
  );
}

function TaskCard({ task, canWrite = false, overlay = false, canAssign = false, people = null, onAssign, busyId, highlight }) {
  const closed = isClosedStatus(task.status);
  const due = !closed && task.dueDate ? dueBucket(task) : null;
  return (
    <article
      id={`kanban-${task.id}`}
      className={`sui-kcard rounded-2xl border border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)] p-3.5 shadow-xs transition hover:border-[rgba(30,134,224,0.28)] ${overlay ? "rotate-1 shadow-lg" : ""} ${canWrite ? "cursor-grab touch-none" : "cursor-default"}${highlight === task.id ? " is-focused" : ""}`}
      aria-roledescription={canWrite ? "tâche déplaçable" : undefined}
    >
      <p className="text-[14px] font-semibold text-[var(--comexa-ink)]">{task.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
        <Badge tone={PRIORITY_TONE[task.priority] ?? "neutral"}>{PRIORITY_LABEL[task.priority] ?? task.priority}</Badge>
        {task.status === "BLOCKED" ? <Badge tone="danger">Bloquée</Badge> : null}
        {task.dueDate ? (
          <span className={`sui-kcard__due${due === "overdue" ? " is-late" : due === "today" ? " is-today" : ""}`}>
            <CalendarClock size={12} strokeWidth={2} aria-hidden="true" />
            {due === "overdue" ? "En retard · " : due === "today" ? "Aujourd’hui · " : ""}
            {formatDateOnly(task.dueDate)}
          </span>
        ) : null}
      </div>
      <div className="sui-kcard__people">
        {canAssign && !overlay ? (
          <AssigneeSelect variant="chip" short task={task} people={people} onAssign={onAssign} busy={busyId === task.id} />
        ) : (
          <AssigneeChip profile={task.assignee} prefix="Assignée à" short />
        )}
        {canWrite && !closed && !overlay ? <TaskTimerButton task={task} size="sm" /> : null}
      </div>
      <p className="sui-kcard__creator">Créée par {creatorNameOf(task.reporter)}</p>
    </article>
  );
}

function NewTask({ projectId, canAssign, people, onCreated }) {
  const { user, request } = useAuth();
  const ownOnly = !can(user, "task:write:any");
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const list = Array.isArray(people) ? people : [];

  async function submit(event) {
    event.preventDefault();
    if (title.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await request(`/projects/${projectId}/tasks`, {
        method: "POST",
        body: {
          title: title.trim(),
          priority,
          ...(dueDate ? { dueDate } : {}),
          ...(canAssign && assigneeId ? { assigneeId } : {}),
        },
      });
      setTitle("");
      setDueDate("");
      setPriority("NORMAL");
      const who = data?.assignee ? `${data.assignee.firstName} ${data.assignee.lastName}`.trim() : null;
      await onCreated(
        who
          ? `« ${data.title} » est créée et confiée à ${who}${data.assignee.id === user?.id ? " (vous)" : ""}.`
          : `« ${data?.title ?? title.trim()} » est créée, sans assigné pour l’instant.`,
      );
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="sui-newtask flex flex-wrap items-end gap-3" data-coach-id="taches-create-form">
      {error ? <div className="w-full"><Notice>{error}</Notice></div> : null}
      <Field id="new-task-title" label="Nouvelle tâche">
        <input id="new-task-title" data-coach-id="taches-create-title" className={`${inputClass} !w-[340px] max-w-full`} maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Maquette de la page d’accueil" />
      </Field>
      {canAssign ? (
        <Field id="new-task-assignee" label="Confier à">
          <select id="new-task-assignee" className={`${selectClass} !w-[220px]`} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} disabled={people === null}>
            <option value="">Personne pour l’instant</option>
            {list.map((person) => (
              <option key={person.id} value={person.id}>
                {`${person.firstName} ${person.lastName}`.trim()}
                {person.isMe ? " (moi)" : ""}
                {person.isMember ? "" : " — hors équipe"}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field id="new-task-due" label="Échéance">
        <input id="new-task-due" type="date" className={`${inputClass} !w-[170px]`} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </Field>
      <Field id="new-task-priority" label="Priorité">
        <select id="new-task-priority" className={`${selectClass} !w-[140px]`} value={priority} onChange={(e) => setPriority(e.target.value)}>
          {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Field>
      <button type="submit" disabled={busy || title.trim().length < 2} className={primaryButton} data-coach-id="taches-create-submit">{busy ? "Ajout…" : "Ajouter"}</button>
      {ownOnly ? <p className="w-full text-[12.5px] text-[var(--comexa-ink-muted)]">La tâche vous sera assignée : vous la retrouverez dans « Mes tâches ».</p> : null}
    </form>
  );
}
