"use client";

/*
 * Sélecteur de tâche du minuteur : recherche + listes groupées.
 *
 * Les listes viennent de `GET /timer/tasks`, qui applique le MÊME filtre que le
 * démarrage côté serveur : rien n'est proposé qui serait refusé ensuite.
 *  - « Récents » : les dernières tâches chronométrées, encore ouvertes ;
 *  - « Mes tâches » : assignées à moi (et mes tâches personnelles, dans mon
 *    espace) ;
 *  - « Autres tâches de projet » : pour qui peut écrire toutes les tâches
 *    (chef de projet, administration) — y compris les tâches NON ASSIGNÉES,
 *    qui étaient jusqu'ici impossibles à chronométrer depuis l'écran.
 *
 * Clavier : ↑ ↓ pour parcourir, Entrée pour choisir, Échap pour vider.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarClock, Clock3, FolderKanban, History, Lock, Play, Search, User } from "lucide-react";
import { can } from "@/lib/access";
import { formatDateOnly } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { dueBucket } from "@/lib/task-status.mjs";
import { formatMinutes } from "@/lib/timer-format.mjs";

export default function TaskPicker({ onPick, excludeId = null, autoFocus = false, footer = null, compact = false }) {
  const { user } = useAuth();
  const canTeam = can(user, "task:write:any");
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = window.setTimeout(() => setSearch(query.trim()), 220);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const suffix = search ? `&search=${encodeURIComponent(search)}` : "";
  const mine = useListing(`/timer/tasks?scope=mine&perPage=50${suffix}`);
  const team = useListing(canTeam ? `/timer/tasks?scope=team&perPage=30${suffix}` : null);
  const recent = useListing(search ? null : "/timer/recent-tasks");

  const groups = useMemo(() => {
    const seen = new Set(excludeId ? [excludeId] : []);
    const take = (items) =>
      (items ?? []).filter((task) => {
        if (seen.has(task.id)) return false;
        seen.add(task.id);
        return true;
      });
    const list = [];
    const recentItems = take(search ? [] : recent.items).slice(0, 4);
    if (recentItems.length) list.push({ id: "recent", label: "Récents", icon: History, tasks: recentItems });
    const mineItems = take(mine.items);
    if (mineItems.length) list.push({ id: "mine", label: "Mes tâches", icon: User, tasks: mineItems });
    const teamItems = take(team.items);
    if (teamItems.length) list.push({ id: "team", label: "Autres tâches de projet", icon: FolderKanban, tasks: teamItems });
    return list;
  }, [excludeId, mine.items, recent.items, search, team.items]);

  const flat = useMemo(() => groups.flatMap((group) => group.tasks), [groups]);
  const loading = mine.items === null || (canTeam && team.items === null);
  const error = mine.error ?? team.error ?? null;
  const activeIndex = Math.min(active, Math.max(0, flat.length - 1));

  function onKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(flat.length - 1, activeIndex + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(0, activeIndex - 1));
    } else if (event.key === "Enter") {
      const task = flat[activeIndex];
      if (task) {
        event.preventDefault();
        onPick(task);
      }
    } else if (event.key === "Escape" && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    }
  }

  let index = -1;
  return (
    <div className={`sui-picker${compact ? " sui-picker--compact" : ""}`}>
      <label htmlFor={inputId} className="sr-only">Rechercher une tâche à chronométrer</label>
      <div className="sui-picker__search">
        <Search size={17} strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={flat[activeIndex] ? `${listId}-${flat[activeIndex].id}` : undefined}
          autoComplete="off"
          placeholder="Rechercher une tâche ou un projet…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="sui-picker__results" id={listId} role="listbox" aria-label="Tâches chronométrables">
        {error ? <p className="sui-picker__empty" role="alert">{error}</p> : null}
        {!error && loading && flat.length === 0 ? <p className="sui-picker__empty">Chargement des tâches…</p> : null}
        {!error && !loading && flat.length === 0 ? (
          <p className="sui-picker__empty">
            {search ? `Aucune tâche ouverte ne correspond à « ${search} ».` : "Aucune tâche ouverte à chronométrer pour le moment."}
          </p>
        ) : null}
        {groups.map((group) => (
          <div key={group.id} role="group" aria-label={group.label} className="sui-picker__group">
            <p className="sui-picker__group-label" aria-hidden="true">
              <group.icon size={13} strokeWidth={2} />
              {group.label}
            </p>
            {group.tasks.map((task) => {
              index += 1;
              const isActive = index === activeIndex;
              const due = task.dueDate ? dueBucket(task) : null;
              return (
                <div
                  key={task.id}
                  id={`${listId}-${task.id}`}
                  role="option"
                  aria-selected={isActive}
                  className={`sui-picker__option${isActive ? " is-active" : ""}`}
                  onMouseEnter={() => setActive(flat.indexOf(task))}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(task)}
                >
                  <span className="sui-picker__play" aria-hidden="true">
                    <Play size={14} strokeWidth={2} />
                  </span>
                  <span className="sui-picker__copy">
                    <span className="sui-picker__title">{task.title}</span>
                    <span className="sui-picker__meta">
                      {task.isPersonal ? (
                        <span className="sui-picker__chip">
                          <Lock size={12} strokeWidth={2} aria-hidden="true" /> Personnel
                        </span>
                      ) : task.project ? (
                        <span className="sui-picker__chip">
                          <FolderKanban size={12} strokeWidth={2} aria-hidden="true" /> {task.project.name}
                        </span>
                      ) : null}
                      {!task.isMine && !task.isPersonal ? (
                        <span className="sui-picker__chip is-soft">
                          {task.assignee ? `Assignée à ${[task.assignee.firstName, task.assignee.lastName].filter(Boolean).join(" ")}` : "Non assignée"}
                        </span>
                      ) : null}
                      {task.dueDate ? (
                        <span className={`sui-picker__chip${due === "overdue" ? " is-late" : due === "today" ? " is-today" : ""}`}>
                          <CalendarClock size={12} strokeWidth={2} aria-hidden="true" />
                          {due === "overdue" ? "En retard · " : due === "today" ? "Aujourd’hui · " : ""}
                          {formatDateOnly(task.dueDate)}
                        </span>
                      ) : null}
                      {task.estimateMinutes ? (
                        <span className="sui-picker__chip" title="Estimation">
                          <Clock3 size={12} strokeWidth={2} aria-hidden="true" />
                          {formatMinutes(task.estimateMinutes)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {footer}
    </div>
  );
}
