"use client";

import { useState } from "react";
import Link from "next/link";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { formatDate, formatMoney, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { PROSPECT_COLUMNS, PROSPECT_SOURCE, PROSPECT_STATUS, PROSPECT_STATUS_TONE, PROSPECT_TRANSITIONS } from "@/lib/commercial";
import { useAuth } from "@/lib/session";
import { Badge, Notice, selectClass } from "@/components/workspace/ui";

/**
 * Pipeline commercial en tableau Kanban.
 *
 * Glisser une fiche vers une colonne appelle `POST /prospects/:id/status` : c'est le
 * seul chemin qui écrit l'historique. Le menu « Étape » de chaque carte fait la même
 * chose au clavier. Les transitions interdites sont refusées AVANT l'appel, avec le
 * même message que le serveur ; si le serveur refuse quand même, la carte revient
 * à sa colonne d'origine.
 */
export default function ProspectBoard({ items, onChanged }) {
  const { user, request } = useAuth();
  const canWrite = can(user, "prospect:write:any") || can(user, "prospect:write:own");
  const [overrides, setOverrides] = useState({});
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [activeId, setActiveId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const all = items.map((prospect) => ({ ...prospect, status: overrides[prospect.id] ?? prospect.status }));
  const byColumn = Object.fromEntries(PROSPECT_COLUMNS.map((status) => [status, []]));
  for (const prospect of all) {
    if (byColumn[prospect.status]) byColumn[prospect.status].push(prospect);
  }
  const active = activeId ? all.find((prospect) => prospect.id === activeId) : null;

  async function move(prospect, target) {
    const from = prospect.status;
    if (from === target) return;
    setError(null);

    if (!(PROSPECT_TRANSITIONS[from] ?? []).includes(target)) {
      setError(`Transition interdite pour ${prospect.reference} : ${PROSPECT_STATUS[from]} → ${PROSPECT_STATUS[target]}.`);
      return;
    }

    setPending(prospect.id);
    setOverrides((current) => ({ ...current, [prospect.id]: target }));
    try {
      await request(`/prospects/${prospect.id}/status`, { method: "POST", body: { status: target } });
      if (onChanged) await onChanged();
    } catch (caught) {
      setError(`${prospect.reference} n’a pas pu être déplacé (${messageOf(caught)}). Étape restaurée : ${PROSPECT_STATUS[from]}.`);
    } finally {
      setOverrides((current) => {
        const next = { ...current };
        delete next[prospect.id];
        return next;
      });
      setPending(null);
    }
  }

  function onDragEnd(event) {
    setActiveId(null);
    const { active: dragged, over } = event;
    if (!over || !canWrite) return;
    const prospect = all.find((item) => item.id === dragged.id);
    if (prospect) move(prospect, over.id);
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Notice>{error}</Notice> : null}
      {!canWrite ? <p className="text-[13px] text-[var(--comexa-ink-soft)]">Lecture seule : vous ne pouvez pas changer l’étape des prospects.</p> : null}

      <DndContext sensors={sensors} onDragStart={(event) => setActiveId(event.active.id)} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" role="list" aria-label="Pipeline commercial">
          {PROSPECT_COLUMNS.map((status) => (
            <Column key={status} status={status} prospects={byColumn[status]} canWrite={canWrite} pendingId={pending} onMove={move} />
          ))}
        </div>
        <DragOverlay>{active ? <ProspectCard prospect={active} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({ status, prospects, canWrite, pendingId, onMove }) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !canWrite });
  return (
    <section
      ref={setNodeRef}
      role="listitem"
      aria-label={`${PROSPECT_STATUS[status]} (${prospects.length})`}
      className={`flex min-h-[220px] min-w-0 flex-col gap-3 rounded-2xl border p-3 transition ${
        isOver ? "border-[var(--comexa-accent)] bg-[var(--comexa-accent-soft)]" : "border-[var(--comexa-border-soft)] bg-[var(--comexa-surface-alt)]"
      }`}
    >
      <header className="flex items-center justify-between px-1">
        <h3 className="text-[13px] font-semibold text-[var(--comexa-ink)]">{PROSPECT_STATUS[status]}</h3>
        <span className="text-[12px] text-[var(--comexa-ink-muted)]">{prospects.length}</span>
      </header>
      {prospects.length === 0 ? <p className="px-1 text-[12.5px] text-[var(--comexa-ink-muted)]">Aucune fiche</p> : null}
      {prospects.map((prospect) => (
        <DraggableCard key={prospect.id} prospect={prospect} canWrite={canWrite} busy={pendingId === prospect.id} onMove={onMove} />
      ))}
    </section>
  );
}

function DraggableCard({ prospect, canWrite, busy, onMove }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: prospect.id,
    disabled: !canWrite || busy,
  });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className={`touch-none ${isDragging ? "opacity-40" : ""}`}>
      <ProspectCard prospect={prospect} canWrite={canWrite} busy={busy} onMove={onMove} />
    </div>
  );
}

function ProspectCard({ prospect, canWrite = false, busy = false, onMove, overlay = false }) {
  const targets = PROSPECT_TRANSITIONS[prospect.status] ?? [];
  const name = prospect.companyName || `${prospect.contactFirstName} ${prospect.contactLastName}`;
  return (
    <article
      className={`rounded-lg border border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)] p-3 text-[13px] shadow-sm ${overlay ? "shadow-lg" : ""} ${
        busy ? "opacity-60" : ""
      }`}
    >
      <p className="text-[11px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">
        {prospect.reference} · {formatDate(prospect.createdAt)}
      </p>
      <h4 className="mt-1 text-[14px] font-semibold text-[var(--comexa-ink)]">
        <Link href={`/espace-equipe/prospects/${prospect.id}`} className="hover:underline" onClick={(event) => event.stopPropagation()}>
          {name}
        </Link>
      </h4>
      <p className="mt-1 text-[12.5px] text-[var(--comexa-ink-soft)]">
        {prospect.contactFirstName} {prospect.contactLastName}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone={PROSPECT_STATUS_TONE[prospect.status] ?? "neutral"}>{PROSPECT_STATUS[prospect.status] ?? prospect.status}</Badge>
        <span className="text-[12px] text-[var(--comexa-ink-muted)]">{PROSPECT_SOURCE[prospect.source] ?? prospect.source}</span>
      </div>
      {prospect.estimatedBudget ? (
        <p className="mt-2 text-[12.5px] text-[var(--comexa-ink-soft)]">Budget estimé {formatMoney(prospect.estimatedBudget, "EUR")}</p>
      ) : null}

      {canWrite && !overlay && targets.length > 0 ? (
        <label className="mt-3 flex flex-col gap-1 text-[12px] text-[var(--comexa-ink-soft)]">
          Étape
          <select
            aria-label={`Changer l’étape de ${prospect.reference}`}
            className={`${selectClass} !h-8 !w-full min-w-0 text-[12.5px]`}
            value=""
            disabled={busy}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              if (event.target.value && onMove) onMove(prospect, event.target.value);
            }}
          >
            <option value="">Déplacer vers…</option>
            {targets.map((target) => (
              <option key={target} value={target}>
                {PROSPECT_STATUS[target]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </article>
  );
}
