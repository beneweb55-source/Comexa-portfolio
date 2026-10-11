"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { format, getDay, parse, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale/fr";
import { formatDate, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useAllListing } from "@/lib/use-all-listing";
import { fetchAllPages } from "@/lib/pagination.mjs";
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
 * - Échéance dépassée et élément non clos : rouge, sans animation permanente.
 * - Clic : fenêtre de détail accessible, avec un lien vers le projet.
 * Les réunions ne sont pas modélisées côté API : elles n'apparaissent pas ici.
 */
export default function CalendrierPage() {
  const { user, request } = useAuth();
  // Qui voit toute l'équipe (task:read:any) : tâches de tous les projets, comme l'analytique.
  // Les autres ne voient que les tâches qui leur sont assignées.
  const seesAll = can(user, "task:read:any");
  const canReadProjects = can(user, "project:read:any") || can(user, "project:read:assigned") || can(user, "project:read:own");
  const loadTeamTasks = seesAll && canReadProjects;
  const ownTasks = useAllListing(loadTeamTasks ? null : "/me/tasks?perPage=100");
  const projects = useAllListing(canReadProjects ? "/projects?perPage=100" : null);
  const [teamTasks, setTeamTasks] = useState({ items: null, error: null, projectKey: null });
  const [selected, setSelected] = useState(null);
  const today = todayKey();

  const readableProjects = projects.items ?? EMPTY;
  const projectKey = JSON.stringify(readableProjects.map(({ id, name, reference }) => [id, name, reference]));
  useEffect(() => {
    if (!loadTeamTasks || projects.error || projects.loading || projects.items === null || readableProjects.length === 0) {
      return undefined;
    }

    const controller = new AbortController();
    async function loadTasks() {
      try {
        const allTasks = [];
        // Limite la concurrence entre projets sans omettre de pages ou de projets visibles.
        for (let index = 0; index < readableProjects.length; index += 8) {
          const batch = readableProjects.slice(index, index + 8);
          const lists = await Promise.all(batch.map(async (project) => {
            const { items } = await fetchAllPages(
              request,
              `/projects/${encodeURIComponent(project.id)}/tasks?perPage=100`,
              { signal: controller.signal },
            );
            return items.map((task) => ({
              ...task,
              projectId: project.id,
              project: { id: project.id, name: project.name, reference: project.reference },
            }));
          }));
          allTasks.push(...lists.flat());
        }
        if (!controller.signal.aborted) setTeamTasks({ items: allTasks, error: null, projectKey });
      } catch (caught) {
        if (!controller.signal.aborted) setTeamTasks({ items: null, error: messageOf(caught), projectKey });
      }
    }

    loadTasks();
    return () => controller.abort();
  }, [loadTeamTasks, projectKey, projects.error, projects.items, projects.loading, readableProjects, request]);

  const teamTasksAreCurrent = teamTasks.projectKey === projectKey;
  const projectListFailed = Boolean(projects.error && projects.items === null);
  const taskItems = useMemo(() => {
    if (!loadTeamTasks) return ownTasks.items ?? EMPTY;
    if (readableProjects.length === 0 || projectListFailed) return EMPTY;
    return teamTasksAreCurrent ? teamTasks.items ?? EMPTY : EMPTY;
  }, [loadTeamTasks, ownTasks.items, projectListFailed, readableProjects.length, teamTasks.items, teamTasksAreCurrent]);
  const teamTasksLoading = loadTeamTasks && !projects.error && (projects.loading || projects.items === null || (readableProjects.length > 0 && !teamTasksAreCurrent));
  const tasks = { items: taskItems, error: loadTeamTasks ? (teamTasksAreCurrent ? teamTasks.error : null) : ownTasks.error };
  const loading = projects.loading || (loadTeamTasks ? teamTasksLoading : ownTasks.loading);

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

  const closeDialog = useCallback(() => setSelected(null), []);
  const error = tasks.error ?? projects.error;
  const overdueCount = events.filter((e) => e.overdue).length;

  return (
    <div className="cx-workspace-calendar">
      <header className="cx-calendar__header">
        <div>
          <p className="cx-calendar__eyebrow">Agenda des échéances</p>
          <p className="cx-calendar__summary">{loading ? "Chargement des échéances…" : `${events.length} ${events.length === 1 ? "élément planifié" : "éléments planifiés"}`}</p>
        </div>
        <Legend overdueCount={overdueCount} />
      </header>

      {error ? <p role="alert" className="cx-calendar__error">{error}</p> : null}

      <div className="cx-calendar__panel">
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

      {selected ? <EventDialog event={selected} onClose={closeDialog} canOpenProject={canReadProjects} /> : null}
    </div>
  );
}

function eventStyle(event) {
  if (event.overdue) {
    return { background: "linear-gradient(135deg,#b42318,#8f1d18)" };
  }
  if (event.closed) {
    return { background: "#e5eaf0", color: "#526980", textDecoration: "line-through" };
  }
  if (event.kind === "project") {
    return { background: "linear-gradient(135deg,#117a98,#135da6)" };
  }
  return { background: "linear-gradient(135deg,#6642a3,#a83272)" };
}

function Legend({ overdueCount }) {
  const items = [
    { label: "Projet", swatch: "bg-[#1688bd]" },
    { label: "Tâche", swatch: "bg-[#8060ba]" },
    { label: "En retard", swatch: "bg-[#c0271f]" },
    { label: "Clos", swatch: "bg-slate-400" },
  ];
  return (
    <div className="cx-calendar__legend">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${item.swatch}`} aria-hidden="true" />
          {item.label}
        </span>
      ))}
      {overdueCount ? <span className="cx-calendar__overdue-count">{overdueCount} en retard</span> : null}
    </div>
  );
}

function EventDialog({ event, onClose, canOpenProject }) {
  const dialogRef = useRef(null);
  const isProject = event.kind === "project";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const previouslyFocused = document.activeElement;
    const getFocusable = () => Array.from(dialog.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
    (getFocusable()[0] ?? dialog).focus();

    function trapFocus(keyEvent) {
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        onClose();
        return;
      }
      if (keyEvent.key !== "Tab") return;

      const focusable = getFocusable();
      if (!focusable.length) {
        keyEvent.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (keyEvent.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        keyEvent.preventDefault();
        last.focus();
      } else if (!keyEvent.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        keyEvent.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", trapFocus);
    return () => {
      window.removeEventListener("keydown", trapFocus);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="cx-calendar__overlay" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="cx-glass-modal"
        tabIndex={-1}
      >
        <div className="flex items-start gap-4">
          <GlowIcon tone={isProject ? "accent" : "violet"}><Icon name={isProject ? "folder" : "check"} /></GlowIcon>
          <div className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-[#71849a]">{isProject ? "Projet" : "Tâche"}{event.reference ? ` · ${event.reference}` : ""}</p>
            <h3 id="event-dialog-title" className="mt-1 text-[18px] font-semibold leading-snug text-[#152f4d]">{event.title}</h3>
          </div>
        </div>

        <dl className="cx-calendar__details">
          <div className="cx-calendar__detail">
            <dt className="text-[#152f4d]/50">Échéance</dt>
            <dd className="mt-1 font-medium text-[#152f4d]">{formatDate(event.dueDate)}</dd>
          </div>
          <div className="cx-calendar__detail">
            <dt className="text-[#152f4d]/50">Statut</dt>
            <dd className="mt-1 font-medium text-[#152f4d]">{event.statusLabel}</dd>
          </div>
        </dl>

        {event.overdue ? <p className="cx-calendar__late">Échéance dépassée, non clôturée.</p> : null}
        {!isProject && event.projectName ? <p className="mt-4 text-[13px] text-[#637991]">Projet : {event.projectName}</p> : null}

        <div className="cx-calendar__dialog-actions">
          <button type="button" onClick={onClose} className="cx-calendar__close">Fermer</button>
          {event.projectId && canOpenProject ? (
            <Link href={`/espace-equipe/projets/${event.projectId}`} className="cx-calendar__open-project">
              Ouvrir le projet →
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
