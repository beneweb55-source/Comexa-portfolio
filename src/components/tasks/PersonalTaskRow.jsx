"use client";

/*
 * Une ligne de « Mes tâches » : case à cocher, titre, repères (objectif,
 * projet ou « personnel », échéance, priorité, estimation), minuteur, et un
 * panneau de détail dépliable.
 *
 * Le détail est le même pour toutes les tâches (statut selon les transitions
 * permises, objectif), et s'enrichit selon la nature de la tâche :
 *  - PERSONNELLE : titre, description, échéance, priorité, estimation
 *    modifiables, et suppression (confirmée) ;
 *  - DE PROJET : lecture de la description, lien vers le projet, créateur.
 */

import Link from "next/link";
import { useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  Clock3,
  Flag,
  FolderKanban,
  Lock,
  Target,
  Trash2,
} from "lucide-react";
import { formatDateOnly } from "@/lib/api";
import { TASK_STATUS } from "@/lib/labels";
import { goalTone } from "@/lib/goals.mjs";
import { dueBucket, isClosedStatus, nextStatuses } from "@/lib/task-status.mjs";
import { formatMinutes } from "@/lib/timer-format.mjs";
import { creatorNameOf } from "@/lib/tasks";
import TaskCheck from "./TaskCheck";
import TaskTimerButton from "@/components/timer/TaskTimerButton";

const PRIORITY_LABEL = { LOW: "Basse", NORMAL: "Normale", HIGH: "Haute", URGENT: "Urgente" };
const STATUS_TONE = { IN_PROGRESS: "blue", BLOCKED: "pink", IN_REVIEW: "lilac" };

export default function PersonalTaskRow({
  task,
  goals,
  expanded,
  focused,
  busy,
  canEditPersonal,
  canLinkGoals,
  canWriteProject = true,
  onToggleExpand,
  onStatus,
  onGoal,
  onSave,
  onDelete,
  now,
}) {
  const closed = isClosedStatus(task.status);
  const bucket = closed ? null : dueBucket(task, now);
  const writable = task.isPersonal ? canEditPersonal : canWriteProject;
  const lockedReason = writable ? null : "Votre rôle ne permet pas de modifier cette tâche de projet.";
  const goal = task.goal;
  const detailId = `task-detail-${task.id}`;

  return (
    <li
      id={`tache-${task.id}`}
      className={`sui-mytask${closed ? " is-closed" : ""}${task.status === "CANCELLED" ? " is-cancelled" : ""}${expanded ? " is-expanded" : ""}${focused ? " is-focused" : ""}`}
    >
      <div className="sui-mytask__row">
        <TaskCheck task={task} busy={busy} lockedReason={lockedReason} onToggle={(next) => onStatus(task, next)} />

        <button
          type="button"
          className="sui-mytask__main"
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={() => onToggleExpand(task.id)}
        >
          <span className="sui-mytask__title">{task.title}</span>
          <span className="sui-mytask__meta">
            {goal ? (
              <span className="sui-mytask__chip is-goal" style={{ "--tone-fill": `var(--fill-${goalTone(goal.color)})` }}>
                <span className="sui-mytask__goal-dot" aria-hidden="true" />
                {goal.title}
              </span>
            ) : null}
            {task.isPersonal ? (
              <span className="sui-mytask__chip">
                <Lock size={12} strokeWidth={2} aria-hidden="true" /> Personnel
              </span>
            ) : task.project ? (
              <span className="sui-mytask__chip">
                <FolderKanban size={12} strokeWidth={2} aria-hidden="true" /> {task.project.name}
              </span>
            ) : null}
            {STATUS_TONE[task.status] ? (
              <span className={`sui-mytask__chip is-${STATUS_TONE[task.status]}`}>{TASK_STATUS[task.status] ?? task.status}</span>
            ) : null}
            {task.dueDate ? (
              <span className={`sui-mytask__chip${bucket === "overdue" ? " is-late" : bucket === "today" ? " is-today" : ""}`}>
                <CalendarClock size={12} strokeWidth={2} aria-hidden="true" />
                {bucket === "overdue" ? "En retard · " : bucket === "today" ? "Aujourd’hui · " : ""}
                {formatDateOnly(task.dueDate)}
              </span>
            ) : null}
            {task.priority === "HIGH" || task.priority === "URGENT" ? (
              <span className={`sui-mytask__chip${task.priority === "URGENT" ? " is-late" : " is-warm"}`}>
                <Flag size={12} strokeWidth={2} aria-hidden="true" /> {PRIORITY_LABEL[task.priority]}
              </span>
            ) : null}
            {task.estimateMinutes ? (
              <span className="sui-mytask__chip">
                <Clock3 size={12} strokeWidth={2} aria-hidden="true" /> {formatMinutes(task.estimateMinutes)}
              </span>
            ) : null}
          </span>
        </button>

        <div className="sui-mytask__actions">
          {!closed && writable ? <TaskTimerButton task={task} size="sm" /> : null}
          <button
            type="button"
            className="sui-mytask__more"
            aria-expanded={expanded}
            aria-controls={detailId}
            aria-label={expanded ? `Replier « ${task.title} »` : `Détails de « ${task.title} »`}
            onClick={() => onToggleExpand(task.id)}
          >
            <ChevronDown size={17} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      </div>

      {expanded ? (
        <TaskDetail
          id={detailId}
          task={task}
          goals={goals}
          busy={busy}
          canEditPersonal={canEditPersonal}
          canLinkGoals={canLinkGoals}
          writable={writable}
          onStatus={onStatus}
          onGoal={onGoal}
          onSave={onSave}
          onDelete={onDelete}
        />
      ) : null}
    </li>
  );
}

function TaskDetail({ id, task, goals, busy, canEditPersonal, canLinkGoals, writable, onStatus, onGoal, onSave, onDelete }) {
  const editable = task.isPersonal && canEditPersonal;
  const [form, setForm] = useState(() => ({
    title: task.title ?? "",
    description: task.description ?? "",
    dueDate: task.dueDate ? String(task.dueDate).slice(0, 10) : "",
    priority: task.priority ?? "NORMAL",
    estimateMinutes: task.estimateMinutes ? String(task.estimateMinutes) : "",
  }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const options = writable ? nextStatuses(task) : [];
  const selectableGoals = (goals ?? []).filter((goal) => goal.status !== "ARCHIVED");
  // Objectif archivé : il reste affiché (et non « Aucun objectif », qui mentirait).
  const archivedGoal = task.goal && !selectableGoals.some((goal) => goal.id === task.goal.id) ? task.goal : null;
  const dirty =
    editable &&
    (form.title.trim() !== (task.title ?? "") ||
      form.description.trim() !== (task.description ?? "") ||
      form.dueDate !== (task.dueDate ? String(task.dueDate).slice(0, 10) : "") ||
      form.priority !== (task.priority ?? "NORMAL") ||
      form.estimateMinutes !== (task.estimateMinutes ? String(task.estimateMinutes) : ""));

  return (
    <div className="sui-mytask__detail" id={id}>
      <div className="sui-mytask__controls">
        <label className="sui-field">
          <span className="sui-field__label">Statut</span>
          <select
            className="sui-input"
            value={task.status}
            disabled={busy || options.length === 0}
            onChange={(event) => onStatus(task, event.target.value)}
          >
            <option value={task.status}>{TASK_STATUS[task.status] ?? task.status}</option>
            {options.map((status) => (
              <option key={status} value={status}>
                {TASK_STATUS[status] ?? status}
              </option>
            ))}
          </select>
        </label>
        {canLinkGoals ? (
          <label className="sui-field">
            <span className="sui-field__label">
              <Target size={12} strokeWidth={2.2} aria-hidden="true" /> Objectif
            </span>
            <select
              className="sui-input"
              value={task.goal?.id ?? ""}
              disabled={busy}
              onChange={(event) => onGoal(task, event.target.value || null)}
            >
              <option value="">Aucun objectif</option>
              {archivedGoal ? <option value={archivedGoal.id}>{archivedGoal.title} (archivé)</option> : null}
              {selectableGoals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                  {goal.status === "ACHIEVED" ? " (atteint)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {editable ? (
        <form
          className="sui-mytask__edit"
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty) onSave(task, form);
          }}
        >
          <label className="sui-field sui-mytask__wide">
            <span className="sui-field__label">Titre</span>
            <input
              className="sui-input"
              maxLength={300}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </label>
          <label className="sui-field sui-mytask__wide">
            <span className="sui-field__label">Notes</span>
            <textarea
              className="sui-input"
              rows={2}
              maxLength={5000}
              value={form.description}
              placeholder="Détails, liens, étapes…"
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          <label className="sui-field">
            <span className="sui-field__label">Échéance</span>
            <input
              type="date"
              className="sui-input"
              value={form.dueDate}
              onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
            />
          </label>
          <label className="sui-field">
            <span className="sui-field__label">Priorité</span>
            <select className="sui-input" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
              {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="sui-field">
            <span className="sui-field__label">Estimation (min)</span>
            <input
              type="number"
              min={1}
              max={60000}
              className="sui-input"
              value={form.estimateMinutes}
              placeholder="—"
              onChange={(event) => setForm({ ...form, estimateMinutes: event.target.value })}
            />
          </label>
          <div className="sui-mytask__edit-actions">
            {confirmDelete ? (
              <span className="sui-mytask__confirm" role="alert">
                Supprimer définitivement cette tâche ?
                <button type="button" className="sui-btn" onClick={() => setConfirmDelete(false)}>
                  Garder
                </button>
                <button type="button" className="sui-btn sui-timer__danger" disabled={busy} onClick={() => onDelete(task)}>
                  <Trash2 size={15} strokeWidth={1.9} aria-hidden="true" /> Supprimer
                </button>
              </span>
            ) : (
              <>
                <button type="button" className="sui-mytask__delete" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={15} strokeWidth={1.9} aria-hidden="true" /> Supprimer
                </button>
                <button type="submit" className="sui-btn sui-btn--dark" disabled={!dirty || busy}>
                  Enregistrer
                </button>
              </>
            )}
          </div>
        </form>
      ) : (
        <div className="sui-mytask__info">
          {task.description ? <p className="sui-mytask__desc">{task.description}</p> : null}
          <p className="sui-mytask__facts">
            {task.project ? (
              <Link href={`/espace-equipe/projets/${task.project.id}`} className="sui-mytask__link">
                <FolderKanban size={14} strokeWidth={1.9} aria-hidden="true" /> Ouvrir le projet {task.project.name}
              </Link>
            ) : null}
            {task.reporter ? <span>Créée par {creatorNameOf(task.reporter)}</span> : null}
            {task.priority ? <span>Priorité {PRIORITY_LABEL[task.priority]?.toLowerCase()}</span> : null}
            {task.isPersonal ? null : (
              <span>Statut et temps synchronisés avec le tableau de l’équipe.</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
