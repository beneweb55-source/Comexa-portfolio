"use client";

/*
 * Mes tâches personnelles : espace privé, sans projet ni client, visible du seul
 * membre (le serveur l'impose : `task:read:personal`, jamais ouvert par `any`).
 * Extrait de l'ancienne page « Tâches » de l'espace équipe, qui mélangeait cette
 * liste privée et le tableau Kanban partagé : elle vit désormais dans l'espace
 * personnel, à l'identique.
 */

import { useState } from "react";
import { formatDate, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Field, Notice, Pagination, inputClass, primaryButton, selectClass } from "@/components/workspace/ui";
import { useTimer } from "@/lib/timer";
import { canUseTimer } from "@/lib/timer-access";
import { useShellQuery } from "@/components/softui/Shell";

const PRIORITY_LABEL = { LOW: "Basse", NORMAL: "Normale", HIGH: "Haute", URGENT: "Urgente" };

const PERSONAL_STATUS_LABEL = {
  TODO: "À faire",
  IN_PROGRESS: "En cours",
  IN_REVIEW: "En revue",
  BLOCKED: "Bloqué",
  DONE: "Terminé",
  CANCELLED: "Annulé",
};
const PERSONAL_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "DONE", "CANCELLED"];

export default function PersonalTasks() {
  const { user, request } = useAuth();
  const { query: shellQuery } = useShellQuery();
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

  const q = shellQuery.trim().toLowerCase();
  const items = (tasks.items ?? []).filter(
    (t) => !q || String(t.title ?? "").toLowerCase().includes(q),
  );

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
                className="flex flex-wrap items-center gap-3 rounded-[14px] border border-[var(--comexa-border-soft)] bg-white/85 px-4 py-3"
              >
                <div className="flex min-w-[220px] flex-1 flex-col">
                  <span className="text-[14px] font-semibold text-[var(--comexa-ink)]">{task.title}</span>
                  <span className="text-[12px] text-[var(--comexa-ink-muted)]">
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
