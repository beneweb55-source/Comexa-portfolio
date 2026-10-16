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
  Clock3,
  ListTodo,
  NotebookPen,
  Pause,
  Play,
  Square,
  TriangleAlert,
} from "lucide-react";
import { formatDateOnly } from "@/lib/api";
import { can } from "@/lib/access";
import { isDeadlinePassed } from "@/lib/date-utils.mjs";
import { TASK_STATUS } from "@/lib/labels";
import { useAuth } from "@/lib/session";
import { useAllListing } from "@/lib/use-all-listing";
import { useListing } from "@/lib/use-listing";
import { formatElapsed, useTimer } from "@/lib/timer";
import { canReadOwnTasks, canUseTimer } from "@/lib/timer-access";
import { Alert, Button, KpiGrid, Panel, StatusPill, toneBackground } from "@/components/softui";
import { Empty } from "@/components/workspace/ui";

const OPEN = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"];
const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

const isoDay = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

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
  const { user } = useAuth();
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

  const tasks = useAllListing("/me/tasks?perPage=100", canTasks);
  const events = useListing(canCalendar ? `/me/calendar/events?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : null);
  const entries = useAllListing(`/time-entries?from=${weekStart}&to=${todayIso}&perPage=100`, canTime);
  const report = useListing(canReport ? `/daily-reports/mine?from=${todayIso}&to=${todayIso}` : null);

  const computed = useMemo(() => {
    const list = (tasks.items ?? []).filter((task) => OPEN.includes(task.status));
    const overdue = list.filter((task) => task.dueDate && isDeadlinePassed(task.dueDate, now));
    const dueToday = list.filter((task) => task.dueDate && String(task.dueDate).slice(0, 10) === todayIso);
    const focus = [...list]
      .sort((a, b) => {
        const lateA = a.dueDate && isDeadlinePassed(a.dueDate, now) ? 0 : 1;
        const lateB = b.dueDate && isDeadlinePassed(b.dueDate, now) ? 0 : 1;
        if (lateA !== lateB) return lateA - lateB;
        const dueA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const dueB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        if (dueA !== dueB) return dueA - dueB;
        return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
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
  const errors = [...new Set([tasks.error, events.error, entries.error, report.error].filter(Boolean))];

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
              <ul className="sui-lines">
                {computed.focus.map((task) => {
                  const late = task.dueDate && isDeadlinePassed(task.dueDate, now);
                  return (
                    <li key={task.id}>
                      <Link href="/espace-personnel/taches">
                        <span className="sui-lines__icon" style={{ "--tone-bg": toneBackground(late ? "pink" : task.isPersonal ? "yellow" : "blue") }} aria-hidden="true">
                          {late ? <TriangleAlert size={16} strokeWidth={1.75} /> : <CheckSquare size={16} strokeWidth={1.75} />}
                        </span>
                        <span className="sui-lines__copy">
                          <strong>{task.title}</strong>
                          <span>
                            {task.isPersonal ? "Tâche personnelle" : task.project?.name ?? "Projet"} · {TASK_STATUS[task.status] ?? task.status}
                          </span>
                        </span>
                        <span className={`sui-lines__end${late ? " sui-lines__end--late" : ""}`}>
                          {task.dueDate ? formatDateOnly(task.dueDate) : "Sans échéance"}
                        </span>
                      </Link>
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

      {canUseTimer(user) ? <TimerCard tasks={tasks} /> : null}
    </div>
  );
}

/** Minuteur de la journée : même contexte serveur que le dock. */
function TimerCard({ tasks }) {
  const { timer, elapsedSeconds, start, pause, resume, stop, saving, error } = useTimer();
  const list = (tasks.items ?? []).filter((task) => OPEN.includes(task.status)).slice(0, 6);
  return (
    <Panel title="Minuteur" action={<StatusPill tone={timer ? (timer.status === "PAUSED" ? "yellow" : "green") : "plain"} icon={Clock3} label={timer ? formatElapsed(elapsedSeconds) : "À l’arrêt"} />}>
      {timer ? (
        <>
          <p className="sui-card__desc">
            {timer.title}
            {timer.taskIsPersonal ? " · personnel" : ""} — {timer.status === "PAUSED" ? "en pause" : "enregistrement en cours"}
          </p>
          <div className="flex flex-wrap gap-2">
            {timer.status === "PAUSED" ? (
              <Button variant="dark" icon={Play} onClick={() => resume()} disabled={saving}>Reprendre</Button>
            ) : (
              <Button icon={Pause} onClick={() => pause()} disabled={saving}>Pause</Button>
            )}
            <Button variant="dark" icon={Square} onClick={() => stop()} disabled={saving}>
              {saving ? "Enregistrement…" : "Arrêter et enregistrer"}
            </Button>
          </div>
        </>
      ) : list.length ? (
        <ul className="sui-pills-list">
          {list.map((task) => (
            <li key={task.id}>
              <button type="button" className="sui-pill" onClick={() => start(task)}>
                <Play size={16} strokeWidth={1.75} aria-hidden="true" />
                {task.title}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sui-card__desc">Aucune tâche ouverte à chronométrer.</p>
      )}
      {error ? <Alert icon={CircleAlert}>{error}</Alert> : null}
    </Panel>
  );
}
