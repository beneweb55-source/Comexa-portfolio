"use client";

/*
 * Tâches de projet qui me sont assignées, vues depuis l'espace personnel.
 *
 * C'est la même donnée que le tableau Kanban de l'équipe (aucune copie) : la
 * liste vient de `GET /me/tasks`, que le serveur borne à mes tâches dans cet
 * espace, et le changement de statut passe par `PATCH /tasks/:id/status`, avec
 * ses règles de transition. Le membre suit ainsi son travail sans parcourir
 * chaque projet.
 */

import Link from "next/link";
import { useState } from "react";
import { CalendarClock, CircleAlert, FolderKanban, Play } from "lucide-react";
import { formatDateOnly, messageOf } from "@/lib/api";
import { isDeadlinePassed } from "@/lib/date-utils.mjs";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { useTimer } from "@/lib/timer";
import { canUseTimer } from "@/lib/timer-access";
import { TASK_STATUS } from "@/lib/labels";
import { Alert, Panel, StatusPill } from "@/components/softui";
import { Empty, Pagination, selectClass } from "@/components/workspace/ui";
import { useShellQuery } from "@/components/softui/Shell";

const STATUS_ORDER = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE", "CANCELLED"];
const STATUS_TONE = { TODO: "plain", IN_PROGRESS: "blue", BLOCKED: "pink", IN_REVIEW: "lilac", DONE: "green", CANCELLED: "plain" };
const PRIORITY_LABEL = { LOW: "Basse", NORMAL: "Normale", HIGH: "Haute", URGENT: "Urgente" };

export default function AssignedTasks() {
  const { user, request } = useAuth();
  const { query } = useShellQuery();
  const { start, timer } = useTimer();
  const canTime = canUseTimer(user);
  const [page, setPage] = useState(1);
  const tasks = useListing(`/me/tasks?page=${page}&perPage=50`);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [now] = useState(() => Date.now());

  const q = query.trim().toLowerCase();
  const items = (tasks.items ?? [])
    .filter((task) => !task.isPersonal)
    .filter((task) => !q || `${task.title} ${task.project?.name ?? ""}`.toLowerCase().includes(q));

  async function changeStatus(task, status) {
    if (status === task.status) return;
    setError(null);
    setBusyId(task.id);
    try {
      await request(`/tasks/${task.id}/status`, { method: "PATCH", body: { status } });
      await tasks.reload();
    } catch (caught) {
      setError(`« ${task.title} » : ${messageOf(caught)}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel
      title="Tâches de projet qui me sont assignées"
      action={<span className="sui-section__count">{tasks.items === null ? "…" : items.length}</span>}
    >
      {tasks.error ? <Alert icon={CircleAlert}>{tasks.error}</Alert> : null}
      {error ? <Alert icon={CircleAlert}>{error}</Alert> : null}
      {tasks.items === null && !tasks.error ? <p className="sui-card__desc">Chargement de vos tâches…</p> : null}
      {tasks.items !== null && items.length === 0 && !tasks.error ? (
        <Empty icon={FolderKanban}>Aucune tâche de projet ne vous est assignée pour le moment.</Empty>
      ) : null}

      {items.length > 0 ? (
        <ul className="sui-tasklist">
          {items.map((task) => {
            const closed = task.status === "DONE" || task.status === "CANCELLED";
            const overdue = !closed && task.dueDate && isDeadlinePassed(task.dueDate, now);
            const running = timer?.taskId === task.id;
            return (
              <li key={task.id} className="sui-tasklist__row">
                <div className="sui-tasklist__main">
                  <span className="sui-tasklist__title">{task.title}</span>
                  <span className="sui-tasklist__meta">
                    {task.project ? (
                      <Link href={`/espace-equipe/projets/${task.project.id}`} className="sui-tasklist__project">
                        <FolderKanban size={14} strokeWidth={1.75} aria-hidden="true" />
                        {task.project.name}
                      </Link>
                    ) : null}
                    <span>Priorité {PRIORITY_LABEL[task.priority]?.toLowerCase() ?? "normale"}</span>
                    {task.dueDate ? (
                      <span className={overdue ? "sui-tasklist__late" : undefined}>
                        <CalendarClock size={14} strokeWidth={1.75} aria-hidden="true" />
                        {overdue ? "En retard · " : ""}
                        {formatDateOnly(task.dueDate)}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="sui-tasklist__actions">
                  <StatusPill tone={overdue ? "pink" : STATUS_TONE[task.status] ?? "plain"} label={TASK_STATUS[task.status] ?? task.status} />
                  <select
                    aria-label={`Statut de ${task.title}`}
                    className={`${selectClass} !w-auto`}
                    value={task.status}
                    disabled={busyId === task.id}
                    onChange={(event) => changeStatus(task, event.target.value)}
                  >
                    {STATUS_ORDER.map((status) => (
                      <option key={status} value={status}>{TASK_STATUS[status] ?? status}</option>
                    ))}
                  </select>
                  {canTime && !closed ? (
                    <button
                      type="button"
                      className="sui-btn"
                      onClick={() => start(task)}
                      disabled={running}
                      aria-label={running ? `Minuteur en cours sur ${task.title}` : `Démarrer le minuteur sur ${task.title}`}
                    >
                      <Play size={16} strokeWidth={1.75} aria-hidden="true" />
                      {running ? "En cours" : "Minuteur"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Pagination meta={tasks.meta} onPageChange={setPage} loading={tasks.loading} label="Pagination des tâches assignées" />
    </Panel>
  );
}
