"use client";

/*
 * MA JOURNÉE — tableau de bord de l'espace personnel.
 *
 * Uniquement des données du membre connecté, lues dans l'espace personnel (le
 * serveur borne chaque requête à la portée « à moi », même pour un
 * administrateur) :
 *   - mes tâches (privées et assignées) : `GET /me/tasks` ;
 *   - mon agenda des 7 prochains jours : `GET /me/calendar/events` ;
 *   - mon temps de la semaine : `GET /time-entries` ;
 *   - mon rapport du jour : `GET /daily-reports/mine` ;
 *   - le minuteur (contexte serveur partagé).
 * Aucun chiffre d'agence, aucune donnée d'un collègue.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  CheckSquare,
  CircleAlert,
  ListTodo,
  NotebookPen,
  Target,
} from "lucide-react";
import { formatDateOnly, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { TASK_STATUS } from "@/lib/labels";
import { useAuth } from "@/lib/session";
import { useAllListing } from "@/lib/use-all-listing";
import { useListing } from "@/lib/use-listing";
import { goalProgressOf, goalTone } from "@/lib/goals.mjs";
import { compareTasks, dueBucket, dueDayOf, isOverdue, localDay } from "@/lib/task-status.mjs";
import { canReadOwnTasks, canUseTimer } from "@/lib/timer-access";
import { Alert, Button, KpiGrid, Panel, toneBackground } from "@/components/softui";
import { Empty } from "@/components/workspace/ui";
import TaskCheck from "@/components/tasks/TaskCheck";
import TaskTimerButton from "@/components/timer/TaskTimerButton";
import TimerPanel from "@/components/timer/TimerPanel";
import { GoalCountdown, GoalRing } from "@/components/goals/GoalParts";

const OPEN = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"];

const isoDay = (date) => localDay(date);

function hours(minutes) {
  const value = Number(minutes) || 0;
  const h = Math.floor(value / 60);
  const m = value % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

function plural(count, one, many) {
  return `${count} ${count > 1 ? many : one}`;
}

export default function PersonalDashboard() {
  const { user, request } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const today = useMemo(() => new Date(now), [now]);
  const todayIso = isoDay(today);
  const weekStart = useMemo(() => {
    const d = new Date(now);
    const offset = (d.getDay() + 6) % 7; // lundi
    d.setDate(d.getDate() - offset);
    return isoDay(d);
  }, [now]);
  const range = useMemo(() => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { from: start.toISOString(), to: end.toISOString() };
  }, [now]);

  const canTasks = canReadOwnTasks(user);
  const canCalendar = can(user, "calendar:read:own");
  const canTime = can(user, "time:read:own");
  const canReport = can(user, "time:write:own");
  const canGoals = can(user, "task:read:personal");
  const canWriteProject = can(user, "task:write:any") || can(user, "task:write:own");
  const canWritePersonal = can(user, "task:write:personal");
  const [statusError, setStatusError] = useState(null);
  const [busyTask, setBusyTask] = useState(null);

  const tasks = useAllListing("/me/tasks?perPage=100", canTasks);
  const events = useListing(canCalendar ? `/me/calendar/events?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : null);
  const entries = useAllListing(`/time-entries?from=${weekStart}&to=${todayIso}&perPage=100`, canTime);
  const report = useListing(canReport ? `/daily-reports/mine?from=${todayIso}&to=${todayIso}` : null);
  const goals = useListing(canGoals ? "/me/goals?status=ACTIVE" : null);

  /** Case cochée sur « Ma journée » : même geste, mêmes règles que « Mes tâches ». */
  async function changeStatus(task, status) {
    setStatusError(null);
    setBusyTask(task.id);
    try {
      await request(`/tasks/${task.id}/status`, { method: "PATCH", body: { status } });
      await Promise.all([tasks.reload(), canGoals ? goals.reload() : null]);
    } catch (caught) {
      setStatusError(`« ${task.title} » : ${messageOf(caught)}`);
    } finally {
      setBusyTask(null);
    }
  }

  const computed = useMemo(() => {
    const list = (tasks.items ?? []).filter((task) => OPEN.includes(task.status));
    // Retard et échéance du jour AU JOUR PRÈS (comme « Mes tâches ») : une
    // tâche due aujourd'hui n'est pas « en retard » dès midi.
    const overdue = list.filter((task) => isOverdue(task, now));
    const dueToday = list.filter((task) => dueDayOf(task.dueDate) === todayIso);
    const focus = [...list]
      .sort((a, b) => {
        const lateA = isOverdue(a, now) ? 0 : 1;
        const lateB = isOverdue(b, now) ? 0 : 1;
        if (lateA !== lateB) return lateA - lateB;
        return compareTasks(a, b);
      })
      .slice(0, 6);
    const weekMinutes = (entries.items ?? []).reduce((sum, entry) => sum + (Number(entry.minutes) || 0), 0);
    const todayMinutes = (entries.items ?? [])
      .filter((entry) => String(entry.spentOn).slice(0, 10) === todayIso)
      .reduce((sum, entry) => sum + (Number(entry.minutes) || 0), 0);
    const agenda = (Array.isArray(events.items) ? events.items : [])
      .slice()
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    const todayEvents = agenda.filter((event) => isoDay(new Date(event.startsAt)) === todayIso);
    return { open: list.length, overdue, dueToday, focus, weekMinutes, todayMinutes, agenda, todayEvents };
  }, [entries.items, events.items, now, tasks.items, todayIso]);

  const reportWritten = (report.items ?? []).length > 0;
  const errors = [...new Set([tasks.error, events.error, entries.error, report.error, statusError].filter(Boolean))];
  const goalList = (Array.isArray(goals.items) ? goals.items : []).slice(0, 4);

  const kpis = [
    canTasks
      ? {
          id: "open",
          tone: "yellow",
          badge: computed.dueToday.length ? `${plural(computed.dueToday.length, "échéance", "échéances")} aujourd’hui` : "Aucune échéance aujourd’hui",
          value: tasks.items === null ? "…" : String(computed.open),
          label: computed.open > 1 ? "Tâches ouvertes" : "Tâche ouverte",
          href: "/espace-personnel/taches",
        }
      : null,
    canTasks
      ? {
          id: "late",
          tone: computed.overdue.length ? "pink" : "green",
          badge: computed.overdue.length ? "À rattraper" : "À jour",
          value: tasks.items === null ? "…" : String(computed.overdue.length),
          label: computed.overdue.length > 1 ? "Tâches en retard" : "Tâche en retard",
          href: "/espace-personnel/taches",
        }
      : null,
    canTime
      ? {
          id: "time",
          tone: "green",
          badge: `Aujourd’hui : ${hours(computed.todayMinutes)}`,
          value: entries.items === null ? "…" : hours(computed.weekMinutes),
          label: "Temps saisi cette semaine",
          href: "/espace-personnel/temps",
        }
      : null,
    canCalendar
      ? {
          id: "agenda",
          tone: "blue",
          badge: computed.agenda.length ? `${plural(computed.agenda.length, "élément", "éléments")} sur 7 jours` : "Agenda libre",
          value: events.items === null ? "…" : String(computed.todayEvents.length),
          label: computed.todayEvents.length > 1 ? "Rendez-vous aujourd’hui" : "Rendez-vous aujourd’hui",
          href: "/espace-personnel/calendrier",
        }
      : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      {errors.length ? (
        <div className="flex flex-col gap-2">
          {errors.map((error) => (
            <Alert key={error} icon={CircleAlert}>{error}</Alert>
          ))}
        </div>
      ) : null}

      {kpis.length ? (
        <KpiGrid
          label="Ma journée en chiffres"
          items={kpis.map((kpi) => ({
            ...kpi,
            value: (
              <Link href={kpi.href} className="sui-kpi__link">
                {kpi.value}
              </Link>
            ),
          }))}
        />
      ) : null}

      {canReport ? (
        <div className={`sui-banner${reportWritten ? " sui-banner--done" : ""}`} role="status">
          <NotebookPen size={18} strokeWidth={1.75} aria-hidden="true" />
          <span>
            {report.items === null
              ? "Vérification de votre rapport du jour…"
              : reportWritten
                ? "Votre rapport du jour est rédigé. Vous pouvez encore le compléter avant la fin de la journée."
                : "Votre rapport du jour n’est pas encore rédigé."}
          </span>
          <Button href="/espace-personnel/rapports-journaliers" variant={reportWritten ? "ghost" : "dark"} icon={NotebookPen}>
            {reportWritten ? "Relire mon rapport" : "Rédiger mon rapport"}
          </Button>
        </div>
      ) : null}

      <div className="sui-split">
        {canTasks ? (
          <Panel
            title="À traiter en priorité"
            action={
              <Button href="/espace-personnel/taches" icon={ListTodo}>
                Toutes mes tâches
              </Button>
            }
          >
            {tasks.items === null && !tasks.error ? <p className="sui-card__desc">Chargement de vos tâches…</p> : null}
            {tasks.items !== null && computed.focus.length === 0 ? (
              <Empty icon={CheckSquare}>Rien d’ouvert : profitez-en pour planifier la suite.</Empty>
            ) : null}
            {computed.focus.length ? (
              <ul className="sui-lines sui-lines--tasks">
                {computed.focus.map((task) => {
                  const bucket = dueBucket(task, now);
                  const late = bucket === "overdue";
                  const writable = task.isPersonal ? canWritePersonal : canWriteProject;
                  return (
                    <li key={task.id} className="sui-lines__task">
                      <TaskCheck
                        task={task}
                        busy={busyTask === task.id}
                        lockedReason={writable ? null : "Votre rôle ne permet pas de modifier cette tâche de projet."}
                        onToggle={(next) => changeStatus(task, next)}
                      />
                      <Link href={`/espace-personnel/taches?tache=${encodeURIComponent(task.id)}`}>
                        <span className="sui-lines__copy">
                          <strong>{task.title}</strong>
                          <span>
                            {task.isPersonal ? "Tâche personnelle" : task.project?.name ?? "Projet"} · {TASK_STATUS[task.status] ?? task.status}
                            {task.goal ? ` · ${task.goal.title}` : ""}
                          </span>
                        </span>
                        <span className={`sui-lines__end${late ? " sui-lines__end--late" : ""}`}>
                          {task.dueDate ? `${late ? "En retard · " : bucket === "today" ? "Aujourd’hui · " : ""}${formatDateOnly(task.dueDate)}` : "Sans échéance"}
                        </span>
                      </Link>
                      {writable ? <TaskTimerButton task={task} size="sm" /> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </Panel>
        ) : null}

        {canCalendar ? (
          <Panel
            title="Mon agenda — 7 prochains jours"
            action={
              <Button href="/espace-personnel/calendrier?nouveau=1" icon={CalendarPlus}>
                Ajouter
              </Button>
            }
          >
            {events.items === null && !events.error ? <p className="sui-card__desc">Chargement de votre agenda…</p> : null}
            {events.items !== null && computed.agenda.length === 0 ? (
              <Empty icon={CalendarDays}>Aucun rendez-vous ni rappel sur les 7 prochains jours.</Empty>
            ) : null}
            {computed.agenda.length ? (
              <ul className="sui-lines">
                {computed.agenda.slice(0, 6).map((event) => (
                  <li key={event.id}>
                    <Link href="/espace-personnel/calendrier">
                      <span className="sui-lines__icon" style={{ "--tone-bg": toneBackground(event.visibility === "SHARED" ? "blue" : "green") }} aria-hidden="true">
                        <CalendarDays size={16} strokeWidth={1.75} />
                      </span>
                      <span className="sui-lines__copy">
                        <strong>{event.title}</strong>
                        <span>{event.visibility === "SHARED" ? "Partagé avec l’équipe" : "Privé"}{event.location ? ` · ${event.location}` : ""}</span>
                      </span>
                      <span className="sui-lines__end">
                        {new Date(event.startsAt).toLocaleString("fr-FR", event.allDay ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
        ) : null}
      </div>

      <div className={`sui-split${canGoals ? "" : " sui-split--single"}`}>
        {canUseTimer(user) ? (
          <section className="sui-panel sui-timer-card" aria-label="Minuteur">
            <TimerPanel variant="card" />
          </section>
        ) : null}

        {canGoals ? (
          <Panel
            title="Mes objectifs"
            action={
              <Button href="/espace-personnel/taches" icon={Target}>
                Gérer
              </Button>
            }
          >
            {goals.items === null && !goals.error ? <p className="sui-card__desc">Chargement de vos objectifs…</p> : null}
            {goals.error ? <Alert icon={CircleAlert}>{goals.error}</Alert> : null}
            {goals.items !== null && goalList.length === 0 && !goals.error ? (
              <Empty icon={Target}>
                Aucun objectif en cours. Dans « Mes tâches », fixez-vous un objectif et regroupez les tâches qui y mènent.
              </Empty>
            ) : null}
            {goalList.length ? (
              <ul className="sui-goalmini">
                {goalList.map((goal) => {
                  const progress = goal.progress ?? goalProgressOf((goal.tasks ?? []).map((task) => task.status));
                  const countable = progress.total - progress.cancelled;
                  return (
                    <li key={goal.id}>
                      <Link href="/espace-personnel/taches" className="sui-goalmini__item" style={{ "--tone-bg": `var(--${goalTone(goal.color)})` }}>
                        <GoalRing percent={progress.percent} tone={goal.color} size={44} stroke={5} />
                        <span className="sui-goalmini__copy">
                          <strong>{goal.title}</strong>
                          <span>{countable ? `${progress.done}/${countable} tâches terminées` : "Aucune tâche pour l’instant"}</span>
                        </span>
                        <GoalCountdown targetDate={goal.targetDate} now={now} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
