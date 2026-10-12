"use client";

/**
 * CALENDRIER — PERSONNEL ET EQUIPE.
 *
 * Trois sources, une seule vue :
 *  1. mes EVENEMENTS (`/me/calendar/events`) — rendez-vous, rappels, echeances
 *     posees dans le calendrier, plus ceux ou je suis invite ;
 *  2. les EVENEMENTS PARTAGES (`/calendar/events`) quand la bascule « Vue
 *     equipe » est active ;
 *  3. les ECHEANCES DE TACHES ET DE PROJETS, derivees de `dueDate` — jamais
 *     recopiees en base (voir `CalendarService`), elles apparaissent ici a cote
 *     des evenements sans doublon possible.
 *
 * Vues jour / semaine / mois / agenda (react-big-calendar). Clic sur une case
 * vide : creation rapide. Clic sur un evenement : detail, edition, suppression.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { format, getDay, parse, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale/fr";
import { formatDateOnly, messageOf } from "@/lib/api";
import { isDeadlinePassed } from "@/lib/date-utils.mjs";
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
  agenda: "Agenda", noEventsInRange: "Aucun élément sur cette période.", showMore: (n) => `+ ${n} de plus`,
};

const TASK_LABEL = { TODO: "À faire", IN_PROGRESS: "En cours", BLOCKED: "Bloquée", IN_REVIEW: "En revue", DONE: "Terminée", CANCELLED: "Annulée" };
const PROJECT_LABEL = { DRAFT: "Brouillon", PLANNED: "Planifié", IN_PROGRESS: "En cours", ON_HOLD: "En pause", IN_REVIEW: "En revue", COMPLETED: "Terminé", CANCELLED: "Annulé", ARCHIVED: "Archivé" };
const KIND_LABEL = { EVENT: "Rendez-vous", REMINDER: "Rappel", DEADLINE: "Échéance" };
const EMPTY = [];
const TASK_CLOSED = ["DONE", "CANCELLED"];
const PROJECT_CLOSED = ["COMPLETED", "CANCELLED", "ARCHIVED"];

/** Clé « AAAA-MM-JJ » d'une date ISO, sans décalage de fuseau. */
const dayKey = (iso) => String(iso).slice(0, 10);

/** Le fuseau local, pour pré-remplir les champs datetime-local. */
function toLocalInput(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function CalendrierPage() {
  const { user, request } = useAuth();
  const seesAll = can(user, "task:read:any");
  const canReadProjects = can(user, "project:read:any") || can(user, "project:read:assigned") || can(user, "project:read:own");
  const canWriteCalendar = can(user, "calendar:write:own");
  const canReadTeam = can(user, "calendar:read:team");
  const loadTeamTasks = seesAll && canReadProjects;
  const ownTasks = useAllListing(loadTeamTasks ? null : "/me/tasks?perPage=100");
  const projects = useAllListing(canReadProjects ? "/projects?perPage=100" : null);
  const [teamTasks, setTeamTasks] = useState({ items: null, error: null, projectKey: null });
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [teamView, setTeamView] = useState(false);
  const [calendarItems, setCalendarItems] = useState({ items: null, error: null });
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  // --- Evenements du calendrier (personnel + invites, et equipe si active) ----
  useEffect(() => {
    const controller = new AbortController();
    async function loadEvents() {
      try {
        const { data: mine } = await request("/me/calendar/events", { signal: controller.signal });
        let all = Array.isArray(mine) ? mine : [];
        if (teamView && canReadTeam) {
          const { data: team } = await request("/calendar/events", { signal: controller.signal });
          const seen = new Set(all.map((event) => event.id));
          for (const event of Array.isArray(team) ? team : []) {
            if (!seen.has(event.id)) all = [...all, event];
          }
        }
        if (!controller.signal.aborted) setCalendarItems({ items: all, error: null });
      } catch (caught) {
        if (!controller.signal.aborted) setCalendarItems({ items: null, error: messageOf(caught) });
      }
    }
    loadEvents();
    return () => controller.abort();
  }, [request, teamView, canReadTeam, reloadKey]);

  const refreshEvents = useCallback(() => setReloadKey((key) => key + 1), []);

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
  const loading = projects.loading || (loadTeamTasks ? teamTasksLoading : ownTasks.loading) || calendarItems.items === null;

  const events = useMemo(() => {
    const out = [];
    // 1. Evenements du calendrier (persistance reelle, horaires UTC rendus en local).
    for (const event of calendarItems.items ?? []) {
      out.push({
        id: `e-${event.id}`,
        calendarId: event.id,
        title: event.title,
        start: new Date(event.startsAt),
        end: event.endsAt ? new Date(event.endsAt) : new Date(event.startsAt),
        allDay: event.allDay,
        kind: "calendar",
        calendarKind: event.kind,
        visibility: event.visibility,
        isOwn: event.isOwn,
        canEdit: event.canEdit,
        participants: event.participants,
        owner: event.owner,
        location: event.location,
        description: event.description,
        taskTitle: event.taskTitle,
        projectName: event.projectName,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      });
    }
    // 2. Echeances derivees (taches) — une seule source de verite : Task.dueDate.
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
        overdue: !closed && isDeadlinePassed(task.dueDate, now),
        closed,
        projectId: task.projectId,
        projectName: task.project?.name ?? "",
        reference: task.project?.reference ?? "",
        dueDate: task.dueDate,
      });
    }
    // 3. Echeances derivees (projets).
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
        overdue: !closed && isDeadlinePassed(project.dueDate, now),
        closed,
        projectId: project.id,
        projectName: project.name,
        reference: project.reference ?? "",
        dueDate: project.dueDate,
      });
    }
    return out;
  }, [calendarItems.items, taskItems, projects.items, now]);

  const closeDialog = useCallback(() => setSelected(null), []);
  const closeDraft = useCallback(() => setDraft(null), []);
  const error = tasks.error ?? projects.error ?? calendarItems.error;
  const overdueCount = events.filter((e) => e.overdue).length;

  return (
    <div className="cx-workspace-calendar">
      <header className="cx-calendar__header">
        <div>
          <p className="cx-calendar__eyebrow">Calendrier{teamView ? " · vue équipe" : " · vue personnelle"}</p>
          <p className="cx-calendar__summary">{loading ? "Chargement…" : `${events.length} ${events.length === 1 ? "élément planifié" : "éléments planifiés"}`}</p>
        </div>
        <div className="cx-calendar__tools">
          {canReadTeam ? (
            <button
              type="button"
              className={teamView ? "cx-calendar__toggle cx-calendar__toggle--on" : "cx-calendar__toggle"}
              aria-pressed={teamView}
              onClick={() => setTeamView((on) => !on)}
            >
              Vue équipe
            </button>
          ) : null}
          {canWriteCalendar ? (
            <button type="button" className="cx-calendar__create" onClick={() => setDraft({})}>
              + Nouvel événement
            </button>
          ) : null}
          <Legend overdueCount={overdueCount} />
        </div>
      </header>

      {error ? <p role="alert" className="cx-calendar__error">{error}</p> : null}

      <div className="cx-calendar__panel">
        <div className="h-[660px]">
          <Calendar
            localizer={localizer}
            events={events}
            culture="fr"
            messages={MESSAGES}
            views={["month", "week", "day", "agenda"]}
            defaultView="month"
            popup
            selectable={canWriteCalendar}
            style={{ height: "100%" }}
            onSelectEvent={(event) => setSelected(event)}
            onSelectSlot={(slot) => {
              if (!canWriteCalendar) return;
              setDraft({ startsAt: slot.start, endsAt: slot.end });
            }}
            eventPropGetter={(event) => ({
              className: event.overdue ? "cx-overdue" : undefined,
              style: eventStyle(event),
            })}
          />
        </div>
      </div>

      {selected ? (
        selected.kind === "calendar" ? (
          <CalendarEventDialog
            event={selected}
            request={request}
            onClose={closeDialog}
            onEdit={() => { setDraft({ ...selected }); closeDialog(); }}
            onChanged={() => { closeDialog(); refreshEvents(); }}
          />
        ) : (
          <EventDialog event={selected} onClose={closeDialog} canOpenProject={canReadProjects} />
        )
      ) : null}
      {draft ? (
        <CalendarEventForm
          draft={draft}
          request={request}
          onClose={closeDraft}
          onSaved={() => { closeDraft(); refreshEvents(); }}
        />
      ) : null}
    </div>
  );
}

function eventStyle(event) {
  if (event.overdue) {
    return { background: "linear-gradient(135deg,#b42318,#8f1d18)" };
  }
  if (event.closed) {
    return { background: "linear-gradient(135deg,#35475b,#263748)", color: "#d2deeb", textDecoration: "line-through" };
  }
  if (event.kind === "calendar") {
    return { background: "linear-gradient(135deg,#0f8a6a,#12755f)" };
  }
  if (event.kind === "project") {
    return { background: "linear-gradient(135deg,#117a98,#135da6)" };
  }
  return { background: "linear-gradient(135deg,#6642a3,#a83272)" };
}

function Legend({ overdueCount }) {
  const items = [
    { label: "Événement", swatch: "bg-[#159173]" },
    { label: "Projet", swatch: "bg-[#1688bd]" },
    { label: "Tâche", swatch: "bg-[#8060ba]" },
    { label: "En retard", swatch: "bg-[#c0271f]" },
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

/** Piege a focus + Escape, partage par les deux dialogues. */
function useDialogFocus(onClose) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previouslyFocused = document.activeElement;
    const getFocusable = () => Array.from(dialog.querySelectorAll('button:not([disabled]), a[href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'));
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
  return dialogRef;
}

function CalendarEventDialog({ event, request, onClose, onEdit, onChanged }) {
  const dialogRef = useDialogFocus(onClose);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await request(`/me/calendar/events/${encodeURIComponent(event.calendarId)}`, { method: "DELETE" });
      onChanged();
    } catch (caught) {
      setError(messageOf(caught));
      setBusy(false);
    }
  }

  return (
    <div className="cx-calendar__overlay" onClick={onClose} role="presentation">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="cal-dialog-title" onClick={(e) => e.stopPropagation()} className="cx-glass-modal" tabIndex={-1}>
        <div className="flex items-start gap-4">
          <GlowIcon tone="accent"><Icon name="calendar" /></GlowIcon>
          <div className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-[#71849a]">
              {KIND_LABEL[event.calendarKind] ?? "Événement"} · {event.visibility === "SHARED" ? "Partagé" : "Privé"}
            </p>
            <h3 id="cal-dialog-title" className="mt-1 text-[18px] font-semibold leading-snug text-[#152f4d]">{event.title}</h3>
          </div>
        </div>

        <dl className="cx-calendar__details">
          <div className="cx-calendar__detail">
            <dt className="text-[#152f4d]/50">Début</dt>
            <dd className="mt-1 font-medium text-[#152f4d]">{new Date(event.startsAt).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: event.allDay ? undefined : "short" })}</dd>
          </div>
          {event.endsAt ? (
            <div className="cx-calendar__detail">
              <dt className="text-[#152f4d]/50">Fin</dt>
              <dd className="mt-1 font-medium text-[#152f4d]">{new Date(event.endsAt).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: event.allDay ? undefined : "short" })}</dd>
            </div>
          ) : null}
          {event.location ? (
            <div className="cx-calendar__detail">
              <dt className="text-[#152f4d]/50">Lieu</dt>
              <dd className="mt-1 font-medium text-[#152f4d]">{event.location}</dd>
            </div>
          ) : null}
          {!event.isOwn ? (
            <div className="cx-calendar__detail">
              <dt className="text-[#152f4d]/50">Organisateur</dt>
              <dd className="mt-1 font-medium text-[#152f4d]">{event.owner.firstName} {event.owner.lastName}</dd>
            </div>
          ) : null}
          {event.participants?.length ? (
            <div className="cx-calendar__detail">
              <dt className="text-[#152f4d]/50">Participants</dt>
              <dd className="mt-1 font-medium text-[#152f4d]">{event.participants.map((p) => `${p.firstName} ${p.lastName}`).join(", ")}</dd>
            </div>
          ) : null}
        </dl>

        {event.description ? <p className="mt-4 text-[13px] leading-relaxed text-[#637991]">{event.description}</p> : null}
        {event.taskTitle ? <p className="mt-2 text-[13px] text-[#637991]">Tâche liée : {event.taskTitle}</p> : null}
        {event.projectName ? <p className="mt-1 text-[13px] text-[#637991]">Projet : {event.projectName}</p> : null}
        {error ? <p role="alert" className="cx-calendar__error mt-4">{error}</p> : null}

        <div className="cx-calendar__dialog-actions">
          <button type="button" onClick={onClose} className="cx-calendar__close">Fermer</button>
          {event.canEdit ? (
            <>
              <button type="button" onClick={remove} disabled={busy} className="cx-calendar__close">Supprimer</button>
              <button type="button" onClick={onEdit} className="cx-calendar__open-project">Modifier</button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CalendarEventForm({ draft, request, onClose, onSaved }) {
  const dialogRef = useDialogFocus(onClose);
  const isEdit = Boolean(draft.calendarId);
  const [title, setTitle] = useState(draft.title ?? "");
  const [kind, setKind] = useState(draft.calendarKind ?? "EVENT");
  const [visibility, setVisibility] = useState(draft.visibility ?? "PRIVATE");
  const [allDay, setAllDay] = useState(Boolean(draft.allDay));
  const [startsAt, setStartsAt] = useState(toLocalInput(draft.startsAt ?? new Date()));
  const [endsAt, setEndsAt] = useState(toLocalInput(draft.endsAt ?? ""));
  const [location, setLocation] = useState(draft.location ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save(formEvent) {
    formEvent.preventDefault();
    if (!title.trim()) {
      setError("Donnez un titre à cet événement.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        kind,
        visibility,
        allDay,
        startsAt: new Date(startsAt).toISOString(),
        ...(endsAt ? { endsAt: new Date(endsAt).toISOString() } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      };
      if (isEdit) {
        await request(`/me/calendar/events/${encodeURIComponent(draft.calendarId)}`, { method: "PATCH", body });
      } else {
        await request("/me/calendar/events", { method: "POST", body });
      }
      onSaved();
    } catch (caught) {
      setError(messageOf(caught));
      setBusy(false);
    }
  }

  return (
    <div className="cx-calendar__overlay" onClick={onClose} role="presentation">
      <form ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="cal-form-title" onClick={(e) => e.stopPropagation()} onSubmit={save} className="cx-glass-modal" tabIndex={-1}>
        <h3 id="cal-form-title" className="text-[18px] font-semibold text-[#152f4d]">{isEdit ? "Modifier l’événement" : "Nouvel événement"}</h3>

        <label className="cx-calendar__field">
          <span>Titre</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
        </label>

        <div className="cx-calendar__field-row">
          <label className="cx-calendar__field">
            <span>Type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="EVENT">Rendez-vous</option>
              <option value="REMINDER">Rappel</option>
              <option value="DEADLINE">Échéance</option>
            </select>
          </label>
          <label className="cx-calendar__field">
            <span>Visibilité</span>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="PRIVATE">Privé (moi seul)</option>
              <option value="SHARED">Partagé avec l’équipe</option>
            </select>
          </label>
        </div>

        <div className="cx-calendar__field-row">
          <label className="cx-calendar__field">
            <span>Début</span>
            <input type={allDay ? "date" : "datetime-local"} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
          </label>
          <label className="cx-calendar__field">
            <span>Fin {kind === "EVENT" ? "" : "(facultatif)"}</span>
            <input type={allDay ? "date" : "datetime-local"} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
        </div>

        <label className="cx-calendar__check">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          <span>Toute la journée</span>
        </label>

        <label className="cx-calendar__field">
          <span>Lieu (facultatif)</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} />
        </label>

        <label className="cx-calendar__field">
          <span>Notes (facultatif)</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={3} />
        </label>

        {error ? <p role="alert" className="cx-calendar__error">{error}</p> : null}

        <div className="cx-calendar__dialog-actions">
          <button type="button" onClick={onClose} className="cx-calendar__close">Annuler</button>
          <button type="submit" disabled={busy} className="cx-calendar__open-project">Enregistrer</button>
        </div>
      </form>
    </div>
  );
}

function EventDialog({ event, onClose, canOpenProject }) {
  const dialogRef = useDialogFocus(onClose);
  const isProject = event.kind === "project";

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
            <dd className="mt-1 font-medium text-[#152f4d]">{formatDateOnly(event.dueDate)}</dd>
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
