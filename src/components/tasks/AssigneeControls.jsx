"use client";

/*
 * Assignation d'une tâche de projet : qui la porte, et le moyen de la confier.
 *
 * Les personnes proposées viennent de `GET /projects/:id/tasks/assignees` :
 * exactement celles que le serveur acceptera (comptes actifs de l'équipe de
 * production, qui pourront voir ET faire avancer la tâche), membres du projet
 * en tête. L'écran ne propose donc jamais un choix refusé ensuite.
 */

import { ChevronDown, UserX } from "lucide-react";
import { assigneeNameOf } from "@/lib/tasks";
import { UserAvatar } from "@/components/workspace/UserAvatar";

const stop = (event) => event.stopPropagation();

/** « Inès M. » : assez pour reconnaître quelqu'un dans une colonne étroite. */
function shortNameOf(profile) {
  const first = profile?.firstName?.trim() ?? "";
  const last = profile?.lastName?.trim() ?? "";
  if (!first) return assigneeNameOf(profile);
  return last ? `${first} ${last[0].toLocaleUpperCase("fr-FR")}.` : first;
}

export function AssigneeChip({ profile, size = 22, prefix = null, short = false }) {
  if (!profile) {
    return (
      <span className="sui-assignee is-empty">
        <span className="sui-assignee__none" style={{ width: size, height: size }} aria-hidden="true">
          <UserX size={Math.round(size * 0.6)} strokeWidth={1.9} />
        </span>
        Non assignée
      </span>
    );
  }
  return (
    <span className="sui-assignee" title={short ? assigneeNameOf(profile) : undefined}>
      <UserAvatar profile={profile} size={size} />
      {prefix ? <span className="sr-only">{prefix}</span> : null}
      {short ? (
        <>
          <span aria-hidden="true">{shortNameOf(profile)}</span>
          <span className="sr-only">{assigneeNameOf(profile)}</span>
        </>
      ) : (
        assigneeNameOf(profile)
      )}
    </span>
  );
}

/**
 * Sélecteur natif (accessible, utilisable dans une carte déplaçable).
 *
 * `variant="chip"` : l'assigné s'affiche comme une pastille (photo + nom) qui
 * ouvre la liste au clic — un seul élément pour lire ET changer l'assignation,
 * au lieu d'un nom répété à côté d'une liste déroulante.
 */
export function AssigneeSelect({ task, people, onAssign, busy = false, id, label, variant = "select", short = false }) {
  const list = Array.isArray(people) ? people : [];
  const members = list.filter((person) => person.isMember);
  const others = list.filter((person) => !person.isMember);
  const current = task.assigneeId ?? "";
  const known = !current || list.some((person) => person.id === current);
  const name = (person) => `${assigneeNameOf(person)}${person.isMe ? " (moi)" : ""}`;

  const options = (
    <>
      <option value="">Non assignée</option>
      {!known ? <option value={current}>{assigneeNameOf(task.assignee)}</option> : null}
      {members.length ? (
        <optgroup label="Équipe du projet">
          {members.map((person) => (
            <option key={person.id} value={person.id}>
              {name(person)}
            </option>
          ))}
        </optgroup>
      ) : null}
      {others.length ? (
        <optgroup label="Autres membres (rejoindront le projet)">
          {others.map((person) => (
            <option key={person.id} value={person.id}>
              {name(person)}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  );
  const change = (event) => {
    const next = event.target.value || null;
    if (next !== (task.assigneeId ?? null)) onAssign(task, next);
  };

  if (variant === "chip") {
    return (
      <label className={`sui-assign-chip${busy ? " is-busy" : ""}`} onPointerDown={stop} onKeyDown={stop} title="Changer l’assignation">
        <AssigneeChip profile={task.assignee} short={short} />
        <ChevronDown size={14} strokeWidth={2} aria-hidden="true" className="sui-assign-chip__caret" />
        <select
          id={id}
          className="sui-assign-chip__select"
          aria-label={label ?? `Assignation de « ${task.title} » : ${assigneeNameOf(task.assignee)}. Changer`}
          value={current}
          disabled={busy || people === null}
          onChange={change}
        >
          {options}
        </select>
      </label>
    );
  }

  return (
    <label className="sui-assign" onPointerDown={stop} onKeyDown={stop}>
      <span className="sr-only">{label ?? `Assigner « ${task.title} »`}</span>
      <select
        id={id}
        value={current}
        disabled={busy || people === null}
        onChange={change}
      >
        {options}
      </select>
    </label>
  );
}
