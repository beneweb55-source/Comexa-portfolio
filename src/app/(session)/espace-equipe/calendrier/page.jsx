"use client";

import { useMemo, useState } from "react";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { format, getDay, parse, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale/fr";
import { formatDate } from "@/lib/api";
import { useListing } from "@/lib/use-listing";
import { Card, Empty, Notice } from "@/components/workspace/ui";

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date) => startOfWeek(date, { weekStartsOn: 0 }),
  getDay,
  locales: { fr },
});

const MESSAGES = {
  date: "Date", time: "Heure", event: "Élément", allDay: "Toute la journée", week: "Semaine", work_week: "Semaine",
  day: "Jour", month: "Mois", previous: "Précédent", next: "Suivant", yesterday: "Hier", tomorrow: "Demain", today: "Aujourd’hui",
  agenda: "Agenda", noEventsInRange: "Aucune échéance sur cette période.", showMore: (n) => `+ ${n} de plus`,
};

const TONE = { TODO: "#93c7f5", IN_PROGRESS: "#1e86e0", BLOCKED: "#f87171", IN_REVIEW: "#fbbf24", DONE: "#34d399", CANCELLED: "#8098b2", PROJECT: "#0b2545" };

/**
 * Calendrier de l'équipe : échéances de mes tâches et des projets.
 * Les réunions ne sont pas encore modélisées côté API : elles n'apparaissent pas ici.
 */
export default function CalendrierPage() {
  const tasks = useListing("/me/tasks?perPage=100");
  const projects = useListing("/projects?perPage=100");
  const [selected, setSelected] = useState(null);

  const events = useMemo(() => {
    const out = [];
    for (const task of tasks.items ?? []) {
      if (!task.dueDate) continue;
      const day = new Date(task.dueDate);
      out.push({ id: `t-${task.id}`, title: task.title, start: day, end: day, allDay: true, kind: "Tâche", status: task.status, detail: task.projectName ?? "" });
    }
    for (const project of projects.items ?? []) {
      if (!project.dueDate) continue;
      const day = new Date(project.dueDate);
      out.push({ id: `p-${project.id}`, title: `Projet : ${project.name}`, start: day, end: day, allDay: true, kind: "Projet", status: "PROJECT", detail: project.reference ?? "" });
    }
    return out;
  }, [tasks.items, projects.items]);

  const error = tasks.error ?? projects.error;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Card title="Échéances">
        {error ? <Notice>{error}</Notice> : null}
        <div className="calendar-cx mt-2 min-h-[620px]">
          <Calendar
            localizer={localizer}
            events={events}
            culture="fr"
            messages={MESSAGES}
            views={["month", "week", "agenda"]}
            defaultView="month"
            popup
            style={{ height: 620 }}
            onSelectEvent={(event) => setSelected(event)}
            eventPropGetter={(event) => ({
              style: {
                backgroundColor: TONE[event.status] ?? "#1e86e0",
                border: "none",
                borderRadius: 8,
                color: event.status === "TODO" || event.status === "CANCELLED" ? "#0b2545" : "#ffffff",
                fontSize: 12.5,
              },
            })}
          />
        </div>
      </Card>

      <Card title="Détail">
        {selected ? (
          <div className="flex flex-col gap-2 text-[14.5px]">
            <p className="cx-label">{selected.kind}</p>
            <p className="font-semibold text-[var(--comexa-ink)]">{selected.title}</p>
            <p className="text-[var(--comexa-ink-soft)]">{formatDate(selected.start)}</p>
            {selected.detail ? <p className="text-[var(--comexa-ink-muted)]">{selected.detail}</p> : null}
          </div>
        ) : (
          <Empty>Sélectionnez une échéance pour voir son détail.</Empty>
        )}
        <p className="cx-small mt-6">Réunions : non disponibles pour l’instant (aucun modèle de réunion dans l’API).</p>
      </Card>
    </div>
  );
}
