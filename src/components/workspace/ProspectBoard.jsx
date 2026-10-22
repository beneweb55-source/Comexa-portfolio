"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { formatDate, formatMoney, messageOf } from "@/lib/api";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { can } from "@/lib/access";
import { PROSPECT_COLUMNS, PROSPECT_SOURCE, PROSPECT_STATUS, PROSPECT_STATUS_TONE, PROSPECT_TRANSITIONS } from "@/lib/commercial";
import { useAuth } from "@/lib/session";
import { Badge, Notice, selectClass } from "@/components/workspace/ui";
import { RecordActions } from "@/components/softui";

/**
 * Menu « Déplacer » : le panneau est rendu dans `document.body` (portail), donc il
 * passe au-dessus des colonnes et ne peut plus être rogné par leur `overflow`.
 * Les événements du portail sont arrêtés pour ne pas déclencher le glisser-déposer
 * ni la navigation de la carte parente.
 */
function MoveMenu({ label, targets, disabled, onPick }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector('[role="option"]')?.focus();
    const closeAndRestoreFocus = () => {
      setOpen(false);
      buttonRef.current?.focus();
    };
    const close = () => closeAndRestoreFocus();
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function toggle(event) {
    event.stopPropagation();
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.right - 200, width: 200 });
    }
    setOpen(!open);
  }

  function handleMenuKeyDown(event) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    const options = Array.from(menuRef.current?.querySelectorAll('[role="option"]') ?? []);
    if (!options.length) return;
    event.preventDefault();
    const currentIndex = options.indexOf(document.activeElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + delta + options.length) % options.length;
    options[nextIndex].focus();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        disabled={disabled || targets.length === 0}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={toggle}
        className="cx-prospect-move"
      >
        Déplacer
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="fixed inset-0 z-[998]" onClick={() => { setOpen(false); buttonRef.current?.focus(); }} />
              <ul
                ref={menuRef}
                id={menuId}
                role="listbox"
                aria-label={label}
                data-theme="team-glass"
                onKeyDown={handleMenuKeyDown}
                style={{ top: pos.top, left: Math.max(8, pos.left), width: pos.width }}
                className="cx-prospect-move__menu fixed z-[999]"
              >
                {targets.map((target) => (
                  <li key={target} role="none">
                    <button
                      type="button"
                      role="option"
                      aria-selected="false"
                      onClick={() => {
                        setOpen(false);
                        buttonRef.current?.focus();
                        onPick(target);
                      }}
                      className="cx-prospect-move__option"
                    >
                      {PROSPECT_STATUS[target]}
                    </button>
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/* Kanban clair partagé entre la page de prospection et le tableau de bord. */
const THEMES = {
  light: {
    column: (over) => (over ? "border-[var(--comexa-accent)] bg-[var(--comexa-accent-soft)]" : "border-[var(--comexa-border-soft)] bg-[var(--comexa-surface-alt)]"),
    title: "text-[var(--comexa-ink)]",
    muted: "text-[var(--comexa-ink-muted)]",
    soft: "text-[var(--comexa-ink-soft)]",
    card: "border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)] shadow-sm",
    name: "text-[var(--comexa-ink)]",
  },
};

/**
 * Pipeline commercial en tableau Kanban.
 *
 * Glisser une fiche vers une colonne appelle `POST /prospects/:id/status` : c'est le
 * seul chemin qui écrit l'historique. Le menu « Étape » de chaque carte fait la même
 * chose au clavier. Les transitions interdites sont refusées AVANT l'appel, avec le
 * même message que le serveur ; si le serveur refuse quand même, la carte revient
 * à sa colonne d'origine.
 */
export default function ProspectBoard({ items, onChanged, tone = "light" }) {
  const theme = THEMES[tone] ?? THEMES.light;
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
      {!canWrite ? <p className={`text-[13px] ${theme.soft}`}>Lecture seule : vous ne pouvez pas changer l’étape des prospects.</p> : null}

      <DndContext sensors={sensors} onDragStart={(event) => setActiveId(event.active.id)} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7" role="list" aria-label="Pipeline commercial">
          {PROSPECT_COLUMNS.map((status) => (
            <Column
              key={status}
              status={status}
              prospects={byColumn[status]}
              canWrite={canWrite}
              pendingId={pending}
              onMove={move}
              onChanged={onChanged}
              theme={theme}
            />
          ))}
        </div>
        <DragOverlay>{active ? <ProspectCard prospect={active} overlay theme={theme} /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({ status, prospects, canWrite, pendingId, onMove, onChanged, theme }) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !canWrite });
  return (
    <section
      ref={setNodeRef}
      role="listitem"
      aria-label={`${PROSPECT_STATUS[status]} (${prospects.length})`}
      className={`flex min-h-[220px] min-w-0 flex-col gap-3 rounded-2xl border p-3 transition ${theme.column(isOver)}`}
    >
      <header className="flex items-center justify-between px-1">
        <h3 className={`text-[13px] font-semibold ${theme.title}`}>{PROSPECT_STATUS[status]}</h3>
        <span className={`text-[12px] ${theme.muted}`}>{prospects.length}</span>
      </header>
      {prospects.length === 0 ? <p className={`px-1 text-[12.5px] ${theme.muted}`}>Aucune fiche</p> : null}
      {prospects.map((prospect) => (
        <DraggableCard
          key={prospect.id}
          prospect={prospect}
          canWrite={canWrite}
          busy={pendingId === prospect.id}
          onMove={onMove}
          onChanged={onChanged}
          theme={theme}
        />
      ))}
    </section>
  );
}

function DraggableCard({ prospect, canWrite, busy, onMove, onChanged, theme }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: prospect.id,
    disabled: !canWrite || busy,
  });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className={`touch-none ${isDragging ? "opacity-40" : ""}`}>
      <ProspectCard prospect={prospect} canWrite={canWrite} busy={busy} onMove={onMove} onChanged={onChanged} theme={theme} />
    </div>
  );
}

function ProspectCard({ prospect, canWrite = false, busy = false, onMove, onChanged, overlay = false, theme = THEMES.light }) {
  const { user } = useAuth();
  const canDelete = can(user, "prospect:delete:any");
  const targets = PROSPECT_TRANSITIONS[prospect.status] ?? [];
  const name = prospect.companyName || `${prospect.contactFirstName} ${prospect.contactLastName}`;
  return (
    <article
      className={`rounded-lg border p-3 text-[13px] ${theme.card} ${overlay ? "shadow-lg" : ""} ${
        busy ? "opacity-60" : ""
      }`}
    >
      <p className={`text-[11px] uppercase tracking-wide ${theme.muted}`}>
        {prospect.reference} · {formatDate(prospect.createdAt)}
      </p>
      <h4 className={`mt-1 text-[14px] font-semibold ${theme.name}`}>
        <Link href={`/espace-equipe/prospects/${prospect.id}`} className="hover:underline" onClick={(event) => event.stopPropagation()}>
          {name}
        </Link>
      </h4>
      <p className={`mt-1 text-[12.5px] ${theme.soft}`}>
        {prospect.contactFirstName} {prospect.contactLastName}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone={PROSPECT_STATUS_TONE[prospect.status] ?? "neutral"}>{PROSPECT_STATUS[prospect.status] ?? prospect.status}</Badge>
        <span className={`text-[12px] ${theme.muted}`}>{PROSPECT_SOURCE[prospect.source] ?? prospect.source}</span>
      </div>
      {prospect.estimatedBudget ? (
        <p className={`mt-2 text-[12.5px] ${theme.soft}`}>Budget estimé {formatMoney(prospect.estimatedBudget, DEFAULT_CURRENCY)}</p>
      ) : null}

      {!overlay ? (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className={`text-[12px] ${theme.soft}`}>Étape</span>
          <span className="flex items-center gap-1">
            {canWrite && targets.length > 0 ? (
              <MoveMenu
                label={`Déplacer ${prospect.reference} vers une autre étape`}
                targets={targets}
                disabled={busy}
                onPick={(target) => onMove && onMove(prospect, target)}
              />
            ) : null}
            <RecordActions
              resource="/prospects"
              id={prospect.id}
              record={prospect}
              entityLabel="prospect"
              displayName={name}
              label={`Actions pour le prospect ${prospect.reference}`}
              fields={[
                { name: "companyName", label: "Entreprise", nullable: true, maxLength: 200 },
                { name: "contactFirstName", label: "Prénom du contact", required: true, maxLength: 200 },
                { name: "contactLastName", label: "Nom du contact", required: true, maxLength: 200 },
                { name: "email", label: "E-mail", type: "email", required: true, maxLength: 320 },
              ]}
              canRename={canWrite}
              canDelete={canDelete}
              deleteWarning={`La fiche prospect ${prospect.reference} sera retirée du pipeline. Un prospect déjà converti en client ne peut pas être supprimé.`}
              href={`/espace-equipe/prospects/${prospect.id}`}
              align="end"
              onChanged={onChanged}
            />
          </span>
        </div>
      ) : null}
    </article>
  );
}
