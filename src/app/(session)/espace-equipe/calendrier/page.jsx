"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { format, getDay, parse, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale/fr";
import { formatDate, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import MeshBackground from "@/components/dashboard/MeshBackground";
import { GlowIcon } from "@/components/dashboard/GlassCard";
import Icon from "@/components/dashboard/icons";

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales: { fr },
});

const MESSAGES = {
  date: "Date", time: "Heure", event: "Élément", allDay: "Toute la journée", week: "Semaine", work_week: "Semaine",
  day: "Jour", month: "Mois", previous: "Précédent", next: "Suivant", yesterday: "Hier", tomorrow: "Demain", today: "Aujourd’hui",
  agenda: "Agenda", noEventsInRange: "Aucune échéance sur cette période.", showMore: (n) => `+ ${n} de plus`,
};

const TASK_LABEL = { TODO: "À faire", IN_PROGRESS: "En cours", BLOCKED: "Bloquée", IN_REVIEW: "En revue", DONE: "Terminée", CANCELLED: "Annulée" };
const PROJECT_LABEL = { DRAFT: "Brouillon", PLANNED: "Planifié", IN_PROGRESS: "En cours", ON_HOLD: "En pause", IN_REVIEW: "En revue", COMPLETED: "Terminé", CANCELLED: "Annulé", ARCHIVED: "Archivé" };
const EMPTY = [];
const TASK_CLOSED = ["DONE", "CANCELLED"];
const PROJECT_CLOSED = ["COMPLETED", "CANCELLED", "ARCHIVED"];

/** Clé « AAAA-MM-JJ » d'une date ISO, sans décalage de fuseau. */
const dayKey = (iso) => String(iso).slice(0, 10);
const todayKey = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/**
 * Calendrier de l'équipe : échéances de mes tâches et des projets.
 * - Projets : pastille cyan lumineuse. Tâches : violet/rose.
 * - Échéance dépassée et élément non clos : rouge qui pulse.
 * - Clic : fenêtre de détail en verre, avec un lien vers le projet.
 * Les réunions ne sont pas modélisées côté API : elles n'apparaissent pas ici.
 */
export default function CalendrierPage() {
  const { user, request } = useAuth();
  // Qui voit toute l'équipe (task:read:any) : tâches de tous les projets, comme l'analytique.
  // Les autres ne voient que les tâches qui leur sont assignées.
  const seesAll = can(user, "task:read:any");
  const ownTasks = useListing(seesAll ? null : "/me/tasks?perPage=100");
  const projects = useListing("/projects?perPage=100");
  const [teamTasks, setTeamTasks] = useState({ items: null, error: null });
  const [selected, setSelected] = useState(null);
  const today = todayKey();

  const projectIds = seesAll ? (projects.items ?? []).slice(0, 30).map((p) => p.id).join(",") : "";
  useEffect(() => {
    let cancelled = false;
    if (!projectIds) return undefined;
    Promise.all(projectIds.split(",").map((id) => request(`/projects/${id}/tasks?perPage=100`).then((r) => r.data ?? [])))
      .then((lists) => !cancelled && setTeamTasks({ items: lists.flat(), error: null }))
      .catch((caught) => !cancelled && setTeamTasks({ items: [], error: messageOf(caught) }));
    return () => {
      cancelled = true;
    };
  }, [projectIds, request]);

  const taskItems = useMemo(() => (seesAll ? teamTasks.items : ownTasks.items) ?? EMPTY, [seesAll, teamTasks.items, ownTasks.items]);
  const tasks = { items: taskItems, error: seesAll ? teamTasks.error : ownTasks.error };

  const events = useMemo(() => {
    const out = [];
    for (const task of taskItems) {
      if (!task.dueDate) continue;
      const day = new Date(`${dayKey(task.dueDate)}T12:00:00`);
      const closed = TASK_CLOSED.includes(task.status);
      out.push({
        id: `t-${task.id}`,
        title: task.title,
        start: day,
        end: day,
        allDay: true,
        kind: "task",
        status: task.status,
        statusLabel: TASK_LABEL[task.status] ?? task.status,
        overdue: !closed && dayKey(task.dueDate) < today,
        closed,
        projectId: task.projectId,
        projectName: task.project?.name ?? "",
        reference: task.project?.reference ?? "",
        dueDate: task.dueDate,
      });
    }
    for (const project of projects.items ?? []) {
      if (!project.dueDate) continue;
      const day = new Date(`${dayKey(project.dueDate)}T12:00:00`);
      const closed = PROJECT_CLOSED.includes(project.status);
      out.push({
        id: `p-${project.id}`,
        title: project.name,
        start: day,
        end: day,
        allDay: true,
        kind: "project",
        status: project.status,
        statusLabel: PROJECT_LABEL[project.status] ?? project.status,
        overdue: !closed && dayKey(project.dueDate) < today,
        closed,
        projectId: project.id,
        projectName: project.name,
        reference: project.reference ?? "",
        dueDate: project.dueDate,
      });
    }
    return out;
  }, [taskItems, projects.items, today]);

  // Fermer la fenêtre de détail avec Échap.
  useEffect(() => {
    if (!selected) return undefined;
    const onKey = (event) => event.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const error = tasks.error ?? projects.error;
  const overdueCount = events.filter((e) => e.overdue).length;

  return (
    <div className="calendar-glass relative isolate overflow-hidden rounded-[36px] bg-[#071a33] p-5 text-white md:p-8">
      <MeshBackground />
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12.5px] font-medium uppercase tracking-[0.18em] text-sky-300/80">Échéances</p>
          <h2 className="mt-2 bg-gradient-to-b from-white to-white/70 bg-clip-text text-[30px] font-semibold tracking-tight text-transparent">Calendrier de l’équipe</h2>
        </div>
        <Legend overdueCount={overdueCount} />
      </header>

      {error ? <p role="alert" className="mb-5 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-[14px] text-rose-100">{error}</p> : null}

      <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.3)] backdrop-blur-xl md:p-5">
        <div className="h-[660px]">
          <Calendar
            localizer={localizer}
            events={events}
            culture="fr"
            messages={MESSAGES}
            views={["month", "week", "agenda"]}
            defaultView="month"
            popup
            style={{ height: "100%" }}
            onSelectEvent={(event) => setSelected(event)}
            eventPropGetter={(event) => ({
              className: event.overdue ? "cx-overdue" : undefined,
              style: eventStyle(event),
            })}
          />
        </div>
      </div>

      {selected ? <EventDialog event={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function eventStyle(event) {
  if (event.overdue) {
    return { background: "linear-gradient(135deg,#f87171,#dc2626)", boxShadow: "0 0 16px -4px rgba(248,113,113,0.8)" };
  }
  if (event.closed) {
    return { background: "rgba(148,163,184,0.35)", color: "rgba(255,255,255,0.7)", textDecoration: "line-through" };
  }
  if (event.kind === "project") {
    return { background: "linear-gradient(135deg,#22d3ee,#1e86e0)", boxShadow: "0 0 18px -4px rgba(34,211,238,0.7)" };
  }
  return { background: "linear-gradient(135deg,#c084fc,#f472b6)", boxShadow: "0 0 18px -4px rgba(192,132,252,0.65)" };
}

function Legend({ overdueCount }) {
  const items = [
    { label: "Projet", swatch: "bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]" },
    { label: "Tâche", swatch: "bg-fuchsia-400 shadow-[0_0_10px_rgba(192,132,252,0.9)]" },
    { label: "En retard", swatch: "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.9)]" },
    { label: "Clos", swatch: "bg-slate-400/60" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-white/70">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${item.swatch}`} aria-hidden="true" />
          {item.label}
        </span>
      ))}
      {overdueCount ? <span className="rounded-full bg-red-500/15 px-3 py-1 text-red-200">{overdueCount} en retard</span> : null}
    </div>
  );
}

function EventDialog({ event, onClose }) {
  const isProject = event.kind === "project";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="cx-glass-modal w-full max-w-md rounded-[28px] p-6 text-white"
      >
        <div className="flex items-start gap-4">
          <GlowIcon tone={isProject ? "accent" : "violet"}><Icon name={isProject ? "folder" : "check"} /></GlowIcon>
          <div className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-white/55">{isProject ? "Projet" : "Tâche"}{event.reference ? ` · ${event.reference}` : ""}</p>
            <h3 id="event-dialog-title" className="mt-1 text-[18px] font-semibold leading-snug text-white">{event.title}</h3>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 text-[13.5px]">
          <div className="rounded-2xl bg-white/[0.05] p-3">
            <dt className="text-white/50">Échéance</dt>
            <dd className="mt-1 font-medium text-white">{formatDate(event.dueDate)}</dd>
          </div>
          <div className="rounded-2xl bg-white/[0.05] p-3">
            <dt className="text-white/50">Statut</dt>
            <dd className="mt-1 font-medium text-white">{event.statusLabel}</dd>
          </div>
        </dl>

        {event.overdue ? <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-[13px] text-red-100">Échéance dépassée, non clôturée.</p> : null}
        {!isProject && event.projectName ? <p className="mt-4 text-[13px] text-white/60">Projet : {event.projectName}</p> : null}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-full border border-white/15 px-4 py-2 text-[13px] text-white/80 hover:bg-white/10">Fermer</button>
          {event.projectId ? (
            <Link href={`/espace-equipe/projets/${event.projectId}`} className="rounded-full bg-sky-500/80 px-4 py-2 text-[13px] font-medium text-white shadow-[0_0_20px_-4px_rgba(56,189,248,0.8)] hover:bg-sky-400">
              Ouvrir le projet →
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
