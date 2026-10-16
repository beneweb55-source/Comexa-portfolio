"use client";

/**
 * CALENDRIER — Mon agenda (espace personnel) et Calendrier d'équipe.
 *
 * Une seule interface, deux périmètres, jamais mélangés :
 *  - ESPACE PERSONNEL : mes événements (`/me/calendar/events` : privés, partagés
 *    que j'organise ou auxquels je suis invité) et les échéances de MES tâches ;
 *  - ESPACE ÉQUIPE : les événements PARTAGÉS (`/calendar/events`), les
 *    échéances des projets et des tâches de l'équipe. Un événement privé n'y
 *    apparaît jamais, et on n'y crée que des événements partagés (règle
 *    appliquée aussi par le serveur).
 * Les échéances de tâches et de projets sont DÉRIVÉES de leur `dueDate` (seule
 * source de vérité), jamais recopiées.
 *
 * Plus intuitif : barre d'outils claire (aujourd'hui, précédent/suivant, vues),
 * mini-calendrier, liste « À venir », création par clic sur un créneau ou par
 * l'action principale de l'en-tête, glisser-déposer de ses propres événements,
 * raccourcis clavier (T aujourd'hui, N nouvel événement, ← → navigation).
 * Personnalisable : calques affichables et couleur de chaque calque, vue par
 * défaut, week-end, plage horaire — mémorisés par compte et par espace.
 * Données chargées pour la période affichée (plus de limite cachée à ±6 mois).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  getDay,
  isSameDay,
  isSameMonth,
  parse,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { fr } from "date-fns/locale/fr";
import {
  Bell,
  CalendarDays,
  CalendarPlus,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Eye,
  EyeOff,
  Flag,
  FolderKanban,
  Lock,
  MapPin,
  Settings2,
  Trash2,
  Users,
} from "lucide-react";
import { formatDateOnly, messageOf } from "@/lib/api";
import { isDeadlinePassed } from "@/lib/date-utils.mjs";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useAllListing } from "@/lib/use-all-listing";
import { fetchAllPages } from "@/lib/pagination.mjs";
import { Alert, Button } from "@/components/softui";
import Dialog from "@/components/softui/Dialog";
import { usePageAction } from "@/components/softui/Shell";

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales: { fr },
});

const DnDCalendar = withDragAndDrop(Calendar);

const MESSAGES = {
  date: "Date", time: "Heure", event: "Élément", allDay: "Journée", week: "Semaine", work_week: "Semaine ouvrée",
  day: "Jour", month: "Mois", previous: "Précédent", next: "Suivant", yesterday: "Hier", tomorrow: "Demain", today: "Aujourd’hui",
  agenda: "Agenda", noEventsInRange: "Rien de prévu sur cette période.", showMore: (n) => `+ ${n} de plus`,
};

const VIEWS = [
  { id: "month", label: "Mois" },
  { id: "week", label: "Semaine" },
  { id: "day", label: "Jour" },
  { id: "agenda", label: "Agenda" },
];

const TONES = ["green", "blue", "yellow", "lilac", "pink"];
const TONE_NAME = { green: "Vert", blue: "Bleu", yellow: "Jaune", lilac: "Lilas", pink: "Rose" };

const TASK_LABEL = { TODO: "À faire", IN_PROGRESS: "En cours", BLOCKED: "Bloquée", IN_REVIEW: "En revue", DONE: "Terminée", CANCELLED: "Annulée" };
const PROJECT_LABEL = { DRAFT: "Brouillon", PLANNED: "Planifié", IN_PROGRESS: "En cours", ON_HOLD: "En pause", IN_REVIEW: "En revue", COMPLETED: "Terminé", CANCELLED: "Annulé", ARCHIVED: "Archivé" };
const KIND_LABEL = { EVENT: "Rendez-vous", REMINDER: "Rappel", DEADLINE: "Échéance" };
const TASK_CLOSED = ["DONE", "CANCELLED"];
const PROJECT_CLOSED = ["COMPLETED", "CANCELLED", "ARCHIVED"];
const EMPTY = [];

/** Calques de chaque espace : id, libellé, couleur par défaut. */
const LAYERS = {
  personal: [
    { id: "events", label: "Mes rendez-vous", hint: "Événements privés", tone: "green" },
    { id: "shared", label: "Partagés avec l’équipe", hint: "Que j’organise ou où je suis invité", tone: "blue" },
    { id: "reminders", label: "Rappels et échéances", hint: "Posés dans mon agenda", tone: "yellow" },
    { id: "tasks", label: "Échéances de mes tâches", hint: "Privées et assignées", tone: "lilac" },
  ],
  team: [
    { id: "events", label: "Événements d’équipe", hint: "Événements partagés", tone: "blue" },
    { id: "projects", label: "Échéances des projets", hint: "Date de livraison prévue", tone: "yellow" },
    { id: "tasks", label: "Échéances des tâches", hint: "Tâches des projets", tone: "lilac" },
  ],
};

const DEFAULT_PREFS = { view: "month", weekends: true, dayStart: 8, dayEnd: 20, layers: {} };

/** Clé « AAAA-MM-JJ » d'une date ISO, sans décalage de fuseau. */
const dayKey = (iso) => String(iso).slice(0, 10);

/** Jour calendaire LOCAL d'une échéance stockée à minuit UTC (jamais décalé). */
function localDay(iso) {
  const [y, m, d] = dayKey(iso).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function toLocalInput(date) {
  if (!date) return "";
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDateInput(date) {
  if (!date) return "";
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Période affichée (avec une marge), pour ne charger que ce qui est visible. */
function visibleRange(date, view) {
  if (view === "day") return { start: addDays(date, -1), end: addDays(date, 2) };
  if (view === "week") return { start: startOfWeek(date, { weekStartsOn: 1 }), end: addDays(endOfWeek(date, { weekStartsOn: 1 }), 1) };
  if (view === "agenda") return { start: addDays(date, -1), end: addDays(date, 31) };
  return { start: startOfWeek(startOfMonth(date), { weekStartsOn: 1 }), end: addDays(endOfWeek(endOfMonth(date), { weekStartsOn: 1 }), 1) };
}

function usePrefs(userId, space) {
  const key = userId ? `comexa:calendar:${userId}:${space}` : null;
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [loadedKey, setLoadedKey] = useState(null);
  if (key && loadedKey !== key && typeof window !== "undefined") {
    setLoadedKey(key);
    try {
      const raw = window.localStorage.getItem(key);
      setPrefs(raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS);
    } catch {
      setPrefs(DEFAULT_PREFS);
    }
  }
  const update = useCallback(
    (patch) => {
      setPrefs((current) => {
        const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
        if (key) {
          try {
            window.localStorage.setItem(key, JSON.stringify(next));
          } catch {
            // stockage indisponible : préférences valables pour la session
          }
        }
        return next;
      });
    },
    [key],
  );
  return [prefs, update];
}

function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const list = window.matchMedia("(max-width: 767px)");
    const update = () => setNarrow(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return narrow;
}

export default function CalendarWorkspace({ space = "personal" }) {
  const { user, request } = useAuth();
  const searchParams = useSearchParams();
  const isTeam = space === "team";
  const layersDef = LAYERS[space] ?? LAYERS.personal;
  const [prefs, setPrefs] = usePrefs(user?.id, space);
  const narrow = useIsNarrow();
  const [date, setDate] = useState(() => new Date());
  const [sessionView, setSessionView] = useState(null);
  const view = sessionView ?? (narrow ? "agenda" : prefs.view);
  const calendarView = view === "week" && !prefs.weekends ? "work_week" : view;
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(() => (searchParams?.get("nouveau") ? {} : null));
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [actionError, setActionError] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const canReadProjects = can(user, "project:read:any") || can(user, "project:read:assigned") || can(user, "project:read:own");
  const canWrite = can(user, "calendar:write:own");
  const canReadEvents = isTeam ? can(user, "calendar:read:team") : can(user, "calendar:read:own");
  const seesAllTasks = isTeam && can(user, "task:read:any") && can(user, "project:read:any");
  const canReadMyTasks = ["task:read:any", "task:read:assigned", "task:read:own", "task:read:personal"].some((code) => can(user, code));

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  /* --- Événements de la période affichée -------------------------------- */
  const range = useMemo(() => visibleRange(date, view), [date, view]);
  const rangeKey = `${range.start.toISOString()}|${range.end.toISOString()}`;
  const [calendarItems, setCalendarItems] = useState({ key: null, items: null, error: null });

  useEffect(() => {
    if (!canReadEvents) return undefined;
    const controller = new AbortController();
    const path = `${isTeam ? "/calendar/events" : "/me/calendar/events"}?from=${encodeURIComponent(range.start.toISOString())}&to=${encodeURIComponent(range.end.toISOString())}`;
    request(path, { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) setCalendarItems({ key: `${rangeKey}|${reloadKey}`, items: Array.isArray(data) ? data : [], error: null });
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setCalendarItems((current) => ({ ...current, key: `${rangeKey}|${reloadKey}`, error: messageOf(caught) }));
      });
    return () => controller.abort();
  }, [canReadEvents, isTeam, range.end, range.start, rangeKey, reloadKey, request]);

  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);

  /* --- Échéances : tâches et projets ------------------------------------- */
  const myTasks = useAllListing(!seesAllTasks && canReadMyTasks ? "/me/tasks?perPage=100" : null);
  const projects = useAllListing(isTeam && canReadProjects ? "/projects?perPage=100" : null);
  const [teamTasks, setTeamTasks] = useState({ items: null, error: null, projectKey: null });
  const projectItems = projects.items ?? EMPTY;
  const projectKey = JSON.stringify(projectItems.map(({ id }) => id));

  useEffect(() => {
    if (!seesAllTasks || projects.loading || projects.items === null || projects.error) return undefined;
    if (projectItems.length === 0) return undefined;
    const controller = new AbortController();
    (async () => {
      try {
        const all = [];
        for (let index = 0; index < projectItems.length; index += 8) {
          const batch = projectItems.slice(index, index + 8);
          const lists = await Promise.all(
            batch.map(async (project) => {
              const { items } = await fetchAllPages(request, `/projects/${encodeURIComponent(project.id)}/tasks?perPage=100`, { signal: controller.signal });
              return items.map((task) => ({ ...task, projectId: project.id, project: { id: project.id, name: project.name, reference: project.reference } }));
            }),
          );
          all.push(...lists.flat());
        }
        if (!controller.signal.aborted) setTeamTasks({ items: all, error: null, projectKey });
      } catch (caught) {
        if (!controller.signal.aborted) setTeamTasks({ items: null, error: messageOf(caught), projectKey });
      }
    })();
    return () => controller.abort();
  }, [projectItems, projectKey, projects.error, projects.items, projects.loading, request, seesAllTasks]);

  const taskItems = seesAllTasks
    ? teamTasks.projectKey === projectKey ? teamTasks.items ?? EMPTY : EMPTY
    : (myTasks.items ?? EMPTY).filter((task) => (isTeam ? !task.isPersonal : true));

  /* --- Calques ----------------------------------------------------------- */
  const layerState = useMemo(
    () =>
      Object.fromEntries(
        layersDef.map((layer) => [
          layer.id,
          { visible: prefs.layers?.[layer.id]?.visible ?? true, tone: prefs.layers?.[layer.id]?.tone ?? layer.tone },
        ]),
      ),
    [layersDef, prefs.layers],
  );

  const setLayer = (id, patch) =>
    setPrefs((current) => ({
      ...current,
      layers: { ...current.layers, [id]: { ...layerState[id], ...current.layers?.[id], ...patch } },
    }));

  /* --- Éléments affichés -------------------------------------------------- */
  const allEvents = useMemo(() => {
    const out = [];
    const items = calendarItems.items ?? EMPTY;
    for (const event of items) {
      const layer = isTeam
        ? "events"
        : event.kind && event.kind !== "EVENT"
          ? "reminders"
          : event.visibility === "SHARED"
            ? "shared"
            : "events";
      const start = event.allDay ? localDay(event.startsAt) : new Date(event.startsAt);
      const end = event.endsAt ? (event.allDay ? localDay(event.endsAt) : new Date(event.endsAt)) : start;
      out.push({
        id: `e-${event.id}`,
        calendarId: event.id,
        layer,
        title: event.title,
        start,
        end,
        allDay: Boolean(event.allDay),
        kind: "calendar",
        calendarKind: event.kind,
        visibility: event.visibility,
        isOwn: event.isOwn,
        canEdit: Boolean(event.canEdit),
        participants: event.participants ?? [],
        owner: event.owner,
        location: event.location,
        description: event.description,
        taskTitle: event.taskTitle,
        projectName: event.projectName,
        projectId: event.projectId ?? null,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      });
    }
    for (const task of taskItems) {
      if (!task.dueDate) continue;
      const day = localDay(task.dueDate);
      const closed = TASK_CLOSED.includes(task.status);
      out.push({
        id: `t-${task.id}`,
        layer: "tasks",
        title: task.title,
        start: day,
        end: day,
        allDay: true,
        kind: "task",
        isPersonal: Boolean(task.isPersonal),
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
    if (isTeam) {
      for (const project of projectItems) {
        if (!project.dueDate) continue;
        const day = localDay(project.dueDate);
        const closed = PROJECT_CLOSED.includes(project.status);
        out.push({
          id: `p-${project.id}`,
          layer: "projects",
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
    }
    return out;
  }, [calendarItems.items, isTeam, now, projectItems, taskItems]);

  const events = useMemo(() => allEvents.filter((event) => layerState[event.layer]?.visible !== false), [allEvents, layerState]);

  const upcoming = useMemo(
    () =>
      events
        .filter((event) => !event.closed && event.end.getTime() >= new Date(now).setHours(0, 0, 0, 0))
        .sort((a, b) => a.start - b.start)
        .slice(0, 6),
    [events, now],
  );
  const overdueCount = allEvents.filter((event) => event.overdue).length;

  const errors = [...new Set([calendarItems.error, myTasks.error, projects.error, teamTasks.projectKey === projectKey ? teamTasks.error : null].filter(Boolean))];
  const loading = (canReadEvents && calendarItems.items === null) || (isTeam && projects.loading);

  /* --- Navigation ---------------------------------------------------------- */
  const navigate = useCallback(
    (direction) => {
      setDate((current) => {
        if (direction === "today") return new Date();
        const step = direction === "next" ? 1 : -1;
        if (view === "month") return addMonths(current, step);
        if (view === "week") return addWeeks(current, step);
        if (view === "agenda") return addDays(current, 30 * step);
        return addDays(current, step);
      });
    },
    [view],
  );

  const changeView = useCallback(
    (next) => {
      setSessionView(next);
      if (!narrow) setPrefs({ view: next });
    },
    [narrow, setPrefs],
  );

  const openCreate = useCallback(
    (preset = {}) => {
      if (!canWrite) return;
      setActionError(null);
      setDraft(preset);
    },
    [canWrite],
  );

  const pageAction = useMemo(
    () => (canWrite ? { label: "Nouvel événement", icon: CalendarPlus, onClick: () => openCreate({}) } : null),
    [canWrite, openCreate],
  );
  usePageAction(pageAction);

  /* Raccourcis clavier : T, N, ← →. Ignorés pendant une saisie ou un dialogue. */
  const dialogOpen = Boolean(selected || draft || prefsOpen);
  useEffect(() => {
    function onKey(event) {
      if (dialogOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === "t") navigate("today");
      else if (key === "arrowleft") navigate("prev");
      else if (key === "arrowright") navigate("next");
      else if (key === "n" && canWrite) {
        event.preventDefault();
        openCreate({});
      } else return;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canWrite, dialogOpen, navigate, openCreate]);

  /* --- Glisser-déposer de ses propres événements --------------------------- */
  async function moveEvent({ event, start, end, isAllDay }) {
    if (event.kind !== "calendar" || !event.canEdit) return;
    setActionError(null);
    const allDay = Boolean(isAllDay ?? event.allDay);
    const body = allDay
      ? { allDay: true, startsAt: `${toDateInput(start)}T00:00:00.000Z`, ...(event.endsAt ? { endsAt: `${toDateInput(end)}T00:00:00.000Z` } : {}) }
      : { allDay: false, startsAt: new Date(start).toISOString(), ...(event.endsAt || !isSameDay(start, end) || end > start ? { endsAt: new Date(end).toISOString() } : {}) };
    // Affichage immédiat, puis relecture serveur (qui reste la référence).
    setCalendarItems((current) => ({
      ...current,
      items: (current.items ?? []).map((item) => (item.id === event.calendarId ? { ...item, ...body } : item)),
    }));
    try {
      await request(`/me/calendar/events/${encodeURIComponent(event.calendarId)}`, { method: "PATCH", body });
    } catch (caught) {
      setActionError(`« ${event.title} » n’a pas pu être déplacé : ${messageOf(caught)}`);
    } finally {
      refresh();
    }
  }

  const title = useMemo(() => {
    if (view === "day") return format(date, "EEEE d MMMM yyyy", { locale: fr });
    if (view === "week") {
      const start = startOfWeek(date, { weekStartsOn: 1 });
      const end = endOfWeek(date, { weekStartsOn: 1 });
      return isSameMonth(start, end)
        ? `${format(start, "d", { locale: fr })} – ${format(end, "d MMMM yyyy", { locale: fr })}`
        : `${format(start, "d MMM", { locale: fr })} – ${format(end, "d MMM yyyy", { locale: fr })}`;
    }
    if (view === "agenda") return `À partir du ${format(date, "d MMMM yyyy", { locale: fr })}`;
    return format(date, "MMMM yyyy", { locale: fr });
  }, [date, view]);

  const min = useMemo(() => new Date(1970, 0, 1, prefs.dayStart, 0), [prefs.dayStart]);
  const max = useMemo(() => new Date(1970, 0, 1, Math.max(prefs.dayStart + 1, prefs.dayEnd), 0), [prefs.dayEnd, prefs.dayStart]);

  return (
    <div className="sui-cal" data-space={space}>
      {errors.map((error) => (
        <Alert key={error} icon={CircleAlert}>{error}</Alert>
      ))}
      {actionError ? <Alert icon={CircleAlert}>{actionError}</Alert> : null}

      <div className="sui-cal__layout">
        <aside className="sui-cal__side" aria-label="Navigation du calendrier">
          <MiniMonth date={date} events={events} onPick={(day) => setDate(day)} />

          <section className="sui-cal__card" aria-labelledby="sui-cal-layers">
            <div className="sui-cal__card-head">
              <h2 id="sui-cal-layers" className="sui-cal__card-title">Calques</h2>
              {overdueCount ? <span className="sui-cal__late-count">{overdueCount} en retard</span> : null}
            </div>
            <ul className="sui-cal__layers">
              {layersDef.map((layer) => {
                const state = layerState[layer.id];
                return (
                  <li key={layer.id} className="sui-cal__layer">
                    <button
                      type="button"
                      className="sui-cal__layer-toggle"
                      aria-pressed={state.visible}
                      onClick={() => setLayer(layer.id, { visible: !state.visible })}
                    >
                      <span className="sui-cal__swatch" style={{ "--tone-bg": `var(--${state.tone})`, "--tone-fill": `var(--fill-${state.tone})` }} aria-hidden="true">
                        {state.visible ? <Eye size={13} strokeWidth={2} /> : <EyeOff size={13} strokeWidth={2} />}
                      </span>
                      <span className="sui-cal__layer-copy">
                        <span className="sui-cal__layer-label">{layer.label}</span>
                        <span className="sui-cal__layer-hint">{layer.hint}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="sui-cal__card sui-cal__upcoming" aria-labelledby="sui-cal-upcoming">
            <h2 id="sui-cal-upcoming" className="sui-cal__card-title">À venir</h2>
            {loading ? <p className="sui-card__desc">Chargement…</p> : null}
            {!loading && upcoming.length === 0 ? <p className="sui-card__desc">Rien de prévu sur la période affichée.</p> : null}
            <ul className="sui-cal__upcoming-list">
              {upcoming.map((event) => (
                <li key={event.id}>
                  <button type="button" className="sui-cal__upcoming-item" onClick={() => setSelected(event)}>
                    <span className="sui-cal__dot" style={{ "--tone-fill": `var(--fill-${event.overdue ? "pink" : layerState[event.layer]?.tone ?? "blue"})` }} aria-hidden="true" />
                    <span className="sui-cal__upcoming-copy">
                      <span className="sui-cal__upcoming-title">{event.title}</span>
                      <span className="sui-cal__upcoming-when">
                        {event.allDay
                          ? format(event.start, "EEE d MMM", { locale: fr })
                          : format(event.start, "EEE d MMM · HH:mm", { locale: fr })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <section className="sui-cal__main" aria-label={isTeam ? "Calendrier d’équipe" : "Mon agenda"}>
          <div className="sui-cal__toolbar">
            <div className="sui-cal__nav">
              <button type="button" className="sui-btn" onClick={() => navigate("today")} aria-keyshortcuts="T">
                Aujourd’hui
              </button>
              <button type="button" className="sui-iconbtn" aria-label="Période précédente" aria-keyshortcuts="ArrowLeft" onClick={() => navigate("prev")}>
                <ChevronLeft size={19} strokeWidth={1.75} aria-hidden="true" />
              </button>
              <button type="button" className="sui-iconbtn" aria-label="Période suivante" aria-keyshortcuts="ArrowRight" onClick={() => navigate("next")}>
                <ChevronRight size={19} strokeWidth={1.75} aria-hidden="true" />
              </button>
              <h2 className="sui-cal__title" aria-live="polite">{title}</h2>
            </div>
            <div className="sui-cal__tools">
              <div className="sui-seg sui-cal__views" role="group" aria-label="Vue du calendrier">
                {VIEWS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="sui-seg__tab"
                    aria-pressed={view === entry.id}
                    onClick={() => changeView(entry.id)}
                  >
                    {view === entry.id ? <span className="sui-seg__pill" aria-hidden="true" /> : null}
                    <span style={{ position: "relative" }}>{entry.label}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="sui-iconbtn" aria-label="Préférences du calendrier" aria-expanded={prefsOpen} onClick={() => setPrefsOpen(true)}>
                <Settings2 size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className={`sui-cal__grid sui-cal__grid--${view}`}>
            <DnDCalendar
              localizer={localizer}
              culture="fr"
              messages={MESSAGES}
              events={events}
              date={date}
              view={calendarView}
              onNavigate={(next) => setDate(next)}
              onView={(next) => changeView(next === "work_week" ? "week" : next)}
              views={["month", "week", "work_week", "day", "agenda"]}
              toolbar={false}
              popup
              selectable={canWrite}
              step={30}
              timeslots={2}
              min={min}
              max={max}
              scrollToTime={min}
              length={30}
              style={{ height: "100%" }}
              onSelectEvent={(event) => setSelected(event)}
              onSelectSlot={(slot) => openCreate({ startsAt: slot.start, endsAt: slot.end, allDay: slot.slots?.length === 1 && view === "month" ? false : undefined, fromSlot: true, slotView: view })}
              draggableAccessor={(event) => event.kind === "calendar" && event.canEdit}
              resizableAccessor={(event) => event.kind === "calendar" && event.canEdit && !event.allDay}
              onEventDrop={moveEvent}
              onEventResize={moveEvent}
              eventPropGetter={(event) => ({
                className: [
                  "sui-cal__event",
                  event.overdue ? "is-overdue" : "",
                  event.closed ? "is-closed" : "",
                  event.kind === "calendar" && event.canEdit ? "is-editable" : "",
                ].filter(Boolean).join(" "),
                style: {
                  "--tone-bg": `var(--${event.overdue ? "pink" : layerState[event.layer]?.tone ?? "blue"})`,
                  "--tone-fill": `var(--fill-${event.overdue ? "pink" : layerState[event.layer]?.tone ?? "blue"})`,
                },
              })}
              dayPropGetter={(day) => ({ className: [0, 6].includes(day.getDay()) ? "sui-cal__weekend" : undefined })}
              components={{ event: EventChip, agenda: { event: AgendaEvent } }}
            />
          </div>
          <p className="sui-cal__hint">
            {canWrite ? "Cliquez sur un créneau pour ajouter un événement. " : ""}
            {canWrite ? "Glissez vos propres événements pour les déplacer. " : ""}
            Raccourcis : <kbd className="sui-kbd">T</kbd> aujourd’hui · <kbd className="sui-kbd">←</kbd> <kbd className="sui-kbd">→</kbd> naviguer
            {canWrite ? <> · <kbd className="sui-kbd">N</kbd> nouvel événement</> : null}
          </p>
        </section>
      </div>

      {selected ? (
        <EventDetails
          event={selected}
          isTeam={isTeam}
          canOpenProject={canReadProjects}
          request={request}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setDraft({ ...selected });
            setSelected(null);
          }}
          onChanged={() => {
            setSelected(null);
            refresh();
          }}
        />
      ) : null}

      {draft ? (
        <EventForm
          draft={draft}
          isTeam={isTeam}
          request={request}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            refresh();
          }}
        />
      ) : null}

      {prefsOpen ? (
        <Dialog title="Préférences du calendrier" icon={Settings2} tone="lilac" description="Enregistrées pour votre compte, dans cet espace." onClose={() => setPrefsOpen(false)}
          footer={<Button variant="dark" onClick={() => setPrefsOpen(false)}>Terminé</Button>}>
          <div className="sui-form">
            <label className="sui-field">
              <span className="sui-field__label">Vue par défaut</span>
              <select className="sui-input" value={prefs.view} onChange={(event) => { setPrefs({ view: event.target.value }); setSessionView(event.target.value); }}>
                {VIEWS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </label>
            <label className="sui-check">
              <input type="checkbox" checked={prefs.weekends} onChange={(event) => setPrefs({ weekends: event.target.checked })} />
              <span>Afficher le samedi et le dimanche dans la vue Semaine</span>
            </label>
            <div className="sui-field-row">
              <label className="sui-field">
                <span className="sui-field__label">Début de journée</span>
                <select className="sui-input" value={prefs.dayStart} onChange={(event) => setPrefs({ dayStart: Number(event.target.value) })}>
                  {Array.from({ length: 13 }, (_, h) => h).map((h) => <option key={h} value={h}>{`${pad(h)}:00`}</option>)}
                </select>
              </label>
              <label className="sui-field">
                <span className="sui-field__label">Fin de journée</span>
                <select className="sui-input" value={prefs.dayEnd} onChange={(event) => setPrefs({ dayEnd: Number(event.target.value) })}>
                  {Array.from({ length: 12 }, (_, i) => i + 13).map((h) => <option key={h} value={h}>{h === 24 ? "24:00" : `${pad(h)}:00`}</option>)}
                </select>
              </label>
            </div>
            <fieldset className="sui-fieldset">
              <legend className="sui-field__label">Couleur des calques</legend>
              {layersDef.map((layer) => (
                <div key={layer.id} className="sui-cal__tone-row">
                  <span>{layer.label}</span>
                  <div className="sui-cal__tones" role="radiogroup" aria-label={`Couleur de « ${layer.label} »`}>
                    {TONES.map((tone) => (
                      <button
                        key={tone}
                        type="button"
                        role="radio"
                        aria-checked={layerState[layer.id].tone === tone}
                        aria-label={TONE_NAME[tone]}
                        title={TONE_NAME[tone]}
                        className="sui-cal__tone"
                        style={{ "--tone-bg": `var(--${tone})`, "--tone-fill": `var(--fill-${tone})` }}
                        onClick={() => setLayer(layer.id, { tone })}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
            <Button onClick={() => { setPrefs(DEFAULT_PREFS); setSessionView(null); }}>Rétablir les réglages par défaut</Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Rendu des éléments                                                          */
/* -------------------------------------------------------------------------- */

/** Pictogramme d'un élément (composant statique : aucune création au rendu). */
function EventIcon({ event, size = 14, strokeWidth = 1.75 }) {
  const props = { size, strokeWidth, "aria-hidden": "true" };
  if (event.kind === "project") return <FolderKanban {...props} />;
  if (event.kind === "task") return <CheckSquare {...props} />;
  if (event.calendarKind === "REMINDER") return <Bell {...props} />;
  if (event.calendarKind === "DEADLINE") return <Flag {...props} />;
  return <CalendarDays {...props} />;
}

function EventChip({ event }) {
  return (
    <span className="sui-cal__chip" title={event.title}>
      <EventIcon event={event} size={12} strokeWidth={2} />
      <span className="sui-cal__chip-text">{event.title}</span>
      {event.visibility === "PRIVATE" ? <Lock size={11} strokeWidth={2} aria-label="Privé" /> : null}
    </span>
  );
}

function AgendaEvent({ event }) {
  return (
    <span className="sui-cal__agenda-item">
      <EventIcon event={event} />
      <strong>{event.title}</strong>
      <span className="sui-cal__agenda-meta">
        {event.kind === "calendar" ? KIND_LABEL[event.calendarKind] ?? "Événement" : event.kind === "project" ? "Échéance de projet" : "Échéance de tâche"}
        {event.overdue ? " · en retard" : ""}
        {event.location ? ` · ${event.location}` : ""}
      </span>
    </span>
  );
}

/** Mini-calendrier du mois : un point sous les jours qui ont des éléments. */
function MiniMonth({ date, events, onPick }) {
  const [cursor, setCursor] = useState(() => startOfMonth(date));
  const [lastDate, setLastDate] = useState(date);
  if (!isSameDay(lastDate, date)) {
    setLastDate(date);
    if (!isSameMonth(cursor, date)) setCursor(startOfMonth(date));
  }
  const days = [];
  const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
  for (let i = 0; i < 42; i += 1) days.push(addDays(start, i));
  const busy = new Set(events.map((event) => format(event.start, "yyyy-MM-dd")));
  const today = new Date();
  return (
    <section className="sui-cal__card sui-cal__mini" aria-label="Mini-calendrier">
      <div className="sui-cal__mini-head">
        <button type="button" className="sui-iconbtn sui-iconbtn--sm" aria-label="Mois précédent" onClick={() => setCursor((c) => addMonths(c, -1))}>
          <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <span className="sui-cal__mini-title">{format(cursor, "MMMM yyyy", { locale: fr })}</span>
        <button type="button" className="sui-iconbtn sui-iconbtn--sm" aria-label="Mois suivant" onClick={() => setCursor((c) => addMonths(c, 1))}>
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div className="sui-cal__mini-grid" role="grid">
        {["L", "M", "M", "J", "V", "S", "D"].map((letter, index) => (
          <span key={`${letter}-${index}`} className="sui-cal__mini-dow" role="columnheader" aria-hidden="true">{letter}</span>
        ))}
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const classes = [
            "sui-cal__mini-day",
            isSameMonth(day, cursor) ? "" : "is-outside",
            isSameDay(day, today) ? "is-today" : "",
            isSameDay(day, date) ? "is-selected" : "",
          ].filter(Boolean).join(" ");
          return (
            <button key={key} type="button" className={classes} onClick={() => onPick(day)} aria-label={format(day, "EEEE d MMMM yyyy", { locale: fr })} aria-current={isSameDay(day, date) ? "date" : undefined}>
              {format(day, "d")}
              {busy.has(key) ? <span className="sui-cal__mini-dot" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Dialogues                                                                   */
/* -------------------------------------------------------------------------- */

function whenLabel(event) {
  if (event.kind !== "calendar") return formatDateOnly(event.dueDate);
  const startOpts = event.allDay ? { dateStyle: "full" } : { dateStyle: "full", timeStyle: "short" };
  const start = new Date(event.start).toLocaleString("fr-FR", startOpts);
  if (!event.endsAt) return start;
  const end = new Date(event.end);
  if (event.allDay) return isSameDay(event.start, end) ? start : `${start} → ${end.toLocaleString("fr-FR", { dateStyle: "full" })}`;
  return isSameDay(event.start, end)
    ? `${start} → ${end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
    : `${start} → ${end.toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })}`;
}

function EventDetails({ event, isTeam, canOpenProject, request, onClose, onEdit, onChanged }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const isCalendar = event.kind === "calendar";
  const eyebrow = isCalendar
    ? `${KIND_LABEL[event.calendarKind] ?? "Événement"} · ${event.visibility === "SHARED" ? "Partagé avec l’équipe" : "Privé"}`
    : `${event.kind === "project" ? "Échéance de projet" : event.isPersonal ? "Tâche personnelle" : "Échéance de tâche"}${event.reference ? ` · ${event.reference}` : ""}`;

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

  const projectHref = event.projectId ? `/espace-equipe/projets/${event.projectId}` : null;

  return (
    <Dialog
      title={event.title}
      eyebrow={eyebrow}
      iconNode={<EventIcon event={event} size={20} />}
      tone={event.overdue ? "pink" : isCalendar ? (event.visibility === "SHARED" ? "blue" : "green") : event.kind === "project" ? "yellow" : "lilac"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Fermer</Button>
          {isCalendar && event.canEdit ? (
            confirming ? (
              <>
                <Button icon={Trash2} onClick={remove} disabled={busy}>{busy ? "Suppression…" : "Confirmer la suppression"}</Button>
                <Button onClick={() => setConfirming(false)}>Annuler</Button>
              </>
            ) : (
              <>
                <Button icon={Trash2} onClick={() => setConfirming(true)}>Supprimer</Button>
                <Button variant="dark" onClick={onEdit}>Modifier</Button>
              </>
            )
          ) : null}
          {!isCalendar && projectHref && canOpenProject && (isTeam || !event.isPersonal) ? (
            <Button variant="dark" href={projectHref} icon={FolderKanban}>Ouvrir le projet</Button>
          ) : null}
          {!isCalendar && event.isPersonal ? (
            <Button variant="dark" href="/espace-personnel/taches" icon={CheckSquare}>Mes tâches</Button>
          ) : null}
        </>
      }
    >
      <dl className="sui-cal__details">
        <div>
          <dt><Clock3 size={14} strokeWidth={1.75} aria-hidden="true" /> {isCalendar ? "Quand" : "Échéance"}</dt>
          <dd>{whenLabel(event)}</dd>
        </div>
        {!isCalendar ? (
          <div>
            <dt>Statut</dt>
            <dd>{event.statusLabel}</dd>
          </div>
        ) : null}
        {event.location ? (
          <div>
            <dt><MapPin size={14} strokeWidth={1.75} aria-hidden="true" /> Lieu</dt>
            <dd>{event.location}</dd>
          </div>
        ) : null}
        {isCalendar && !event.isOwn && event.owner ? (
          <div>
            <dt>Organisé par</dt>
            <dd>{event.owner.firstName} {event.owner.lastName}</dd>
          </div>
        ) : null}
        {event.participants?.length ? (
          <div>
            <dt><Users size={14} strokeWidth={1.75} aria-hidden="true" /> Participants</dt>
            <dd>{event.participants.map((p) => `${p.firstName} ${p.lastName}`).join(", ")}</dd>
          </div>
        ) : null}
        {!isCalendar && event.projectName && event.kind === "task" ? (
          <div>
            <dt>Projet</dt>
            <dd>{event.projectName}</dd>
          </div>
        ) : null}
      </dl>
      {event.description ? <p className="sui-cal__description">{event.description}</p> : null}
      {event.taskTitle ? <p className="sui-card__desc">Tâche liée : {event.taskTitle}</p> : null}
      {event.projectName && isCalendar ? <p className="sui-card__desc">Projet : {event.projectName}</p> : null}
      {event.overdue ? <Alert tone="warning" icon={CircleAlert}>Échéance dépassée, élément non clôturé.</Alert> : null}
      {error ? <Alert icon={CircleAlert}>{error}</Alert> : null}
    </Dialog>
  );
}

const DURATIONS = [
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 h" },
  { minutes: 90, label: "1 h 30" },
  { minutes: 120, label: "2 h" },
];

function EventForm({ draft, isTeam, request, onClose, onSaved }) {
  const isEdit = Boolean(draft.calendarId);
  const initialStart = draft.startsAt ? new Date(draft.start ?? draft.startsAt) : roundToNextHalfHour(new Date());
  const slotIsDay = draft.fromSlot && draft.slotView === "month";
  const initialAllDay = isEdit ? Boolean(draft.allDay) : Boolean(slotIsDay && false);
  const initialEnd = draft.endsAt
    ? new Date(draft.end ?? draft.endsAt)
    : new Date(initialStart.getTime() + 60 * 60 * 1000);

  const [title, setTitle] = useState(draft.title ?? "");
  const [kind, setKind] = useState(draft.calendarKind ?? "EVENT");
  const [visibility, setVisibility] = useState(isTeam ? "SHARED" : (draft.visibility ?? "PRIVATE"));
  const [allDay, setAllDay] = useState(initialAllDay);
  const [startsAt, setStartsAt] = useState(slotIsDay && !isEdit ? `${toDateInput(initialStart)}T09:00` : toLocalInput(initialStart));
  const [endsAt, setEndsAt] = useState(
    isEdit ? (draft.endsAt ? toLocalInput(initialEnd) : "") : slotIsDay ? `${toDateInput(initialStart)}T10:00` : toLocalInput(initialEnd),
  );
  const [startDay, setStartDay] = useState(toDateInput(initialStart));
  const [endDay, setEndDay] = useState(draft.endsAt ? toDateInput(initialEnd) : "");
  const [location, setLocation] = useState(draft.location ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef(null);

  function applyDuration(minutes) {
    const start = new Date(startsAt);
    if (Number.isNaN(start.getTime())) return;
    setEndsAt(toLocalInput(new Date(start.getTime() + minutes * 60_000)));
  }

  async function save(formEvent) {
    formEvent.preventDefault();
    if (!title.trim()) {
      setError("Donnez un titre à cet événement.");
      titleRef.current?.focus();
      return;
    }
    let body;
    if (allDay) {
      if (!startDay) {
        setError("Choisissez le jour de l’événement.");
        return;
      }
      if (endDay && endDay < startDay) {
        setError("La fin doit être le même jour ou après le début.");
        return;
      }
      body = { allDay: true, startsAt: `${startDay}T00:00:00.000Z`, ...(endDay ? { endsAt: `${endDay}T00:00:00.000Z` } : isEdit ? { endsAt: null } : {}) };
    } else {
      const start = new Date(startsAt);
      const end = endsAt ? new Date(endsAt) : null;
      if (Number.isNaN(start.getTime())) {
        setError("Indiquez une date et une heure de début valides.");
        return;
      }
      if (kind === "EVENT" && !end) {
        setError("Un rendez-vous a une heure de fin.");
        return;
      }
      if (end && end <= start) {
        setError("L’heure de fin doit suivre l’heure de début.");
        return;
      }
      body = { allDay: false, startsAt: start.toISOString(), ...(end ? { endsAt: end.toISOString() } : isEdit ? { endsAt: null } : {}) };
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        ...body,
        title: title.trim(),
        kind,
        visibility: isTeam ? "SHARED" : visibility,
        ...(location.trim() ? { location: location.trim() } : isEdit ? { location: null } : {}),
        ...(description.trim() ? { description: description.trim() } : isEdit ? { description: null } : {}),
      };
      if (isEdit) {
        await request(`/me/calendar/events/${encodeURIComponent(draft.calendarId)}`, { method: "PATCH", body: payload });
      } else {
        await request("/me/calendar/events", { method: "POST", body: payload });
      }
      onSaved();
    } catch (caught) {
      setError(messageOf(caught));
      setBusy(false);
    }
  }

  return (
    <Dialog
      as="form"
      onSubmit={save}
      title={isEdit ? "Modifier l’événement" : isTeam ? "Nouvel événement d’équipe" : "Ajouter à mon agenda"}
      description={isTeam ? "Visible par toute l’équipe dans le calendrier partagé." : "Privé par défaut : vous seul le voyez, sauf si vous le partagez."}
      icon={CalendarPlus}
      tone={isTeam ? "blue" : "green"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <button type="submit" className="sui-btn sui-btn--dark" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </>
      }
    >
      <div className="sui-form">
        <label className="sui-field">
          <span className="sui-field__label">Titre</span>
          <input ref={titleRef} data-autofocus className="sui-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={isTeam ? "Ex. Point hebdo de production" : "Ex. Appel avec Maison Vasseur"} required />
        </label>

        <div className="sui-field">
          <span className="sui-field__label" id="cal-kind-label">Type</span>
          <div className="sui-seg sui-seg--inline" role="radiogroup" aria-labelledby="cal-kind-label">
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={kind === value} className="sui-seg__tab" onClick={() => setKind(value)}>
                {kind === value ? <span className="sui-seg__pill" aria-hidden="true" /> : null}
                <span style={{ position: "relative" }}>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="sui-check">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          <span>Toute la journée</span>
        </label>

        {allDay ? (
          <div className="sui-field-row">
            <label className="sui-field">
              <span className="sui-field__label">Jour</span>
              <input type="date" className="sui-input" value={startDay} onChange={(e) => setStartDay(e.target.value)} required />
            </label>
            <label className="sui-field">
              <span className="sui-field__label">Jusqu’au (facultatif)</span>
              <input type="date" className="sui-input" value={endDay} min={startDay} onChange={(e) => setEndDay(e.target.value)} />
            </label>
          </div>
        ) : (
          <>
            <div className="sui-field-row">
              <label className="sui-field">
                <span className="sui-field__label">Début</span>
                <input type="datetime-local" className="sui-input" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
              </label>
              <label className="sui-field">
                <span className="sui-field__label">Fin {kind === "EVENT" ? "" : "(facultatif)"}</span>
                <input type="datetime-local" className="sui-input" value={endsAt} min={startsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </label>
            </div>
            <div className="sui-chips" role="group" aria-label="Durée rapide">
              {DURATIONS.map((duration) => (
                <button key={duration.minutes} type="button" className="sui-pill" onClick={() => applyDuration(duration.minutes)}>
                  {duration.label}
                </button>
              ))}
            </div>
          </>
        )}

        {isTeam ? (
          <p className="sui-form__note">
            <Users size={15} strokeWidth={1.75} aria-hidden="true" /> Partagé avec l’équipe. Les événements privés se créent dans votre espace personnel.
          </p>
        ) : (
          <div className="sui-field">
            <span className="sui-field__label" id="cal-visibility-label">Visibilité</span>
            <div className="sui-seg sui-seg--inline" role="radiogroup" aria-labelledby="cal-visibility-label">
              {[["PRIVATE", "Privé (moi seul)"], ["SHARED", "Partagé avec l’équipe"]].map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={visibility === value} className="sui-seg__tab" onClick={() => setVisibility(value)}>
                  {visibility === value ? <span className="sui-seg__pill" aria-hidden="true" /> : null}
                  <span style={{ position: "relative" }}>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="sui-field">
          <span className="sui-field__label">Lieu (facultatif)</span>
          <input className="sui-input" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} placeholder="Ex. Salle Atlas, visio…" />
        </label>

        <label className="sui-field">
          <span className="sui-field__label">Notes (facultatif)</span>
          <textarea className="sui-input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={3} />
        </label>

        {error ? <Alert icon={CircleAlert}>{error}</Alert> : null}
        {isEdit && draft.projectName ? (
          <p className="sui-card__desc">
            Lié au projet {draft.projectName}.{" "}
            {draft.projectId ? <Link href={`/espace-equipe/projets/${draft.projectId}`}>Ouvrir le projet</Link> : null}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function roundToNextHalfHour(date) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const minutes = d.getMinutes();
  d.setMinutes(minutes < 30 ? 30 : 60);
  return d;
}
