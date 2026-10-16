"use client";

/*
 * Feuille de temps — « Mon temps » (espace personnel) et « Suivi du temps »
 * (espace équipe). Même écran, deux usages :
 *
 *  - MON TEMPS : je chronomètre une tâche (minuteur), je complète ce que j'ai
 *    oublié (saisie manuelle), je relis mes sessions et j'exporte ;
 *  - SUIVI DU TEMPS : l'équipe relit la charge de chacun, filtre par facturation
 *    et corrige une saisie (l'écriture manuelle reste réservée à l'espace
 *    personnel — `canAddEntry`).
 *
 * Lecture de la page, de haut en bas : la période, les chiffres, le minuteur,
 * puis les saisies. Un seul écran de vérité : chaque chiffre vient de la MÊME
 * liste filtrée que le tableau, et le serveur borne les lignes au périmètre du
 * porteur (`time:read:own` / `time:read:any`).
 */

import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import {
  CalendarDays,
  CalendarRange,
  CircleAlert,
  Clock3,
  Download,
  ListChecks,
  Pencil,
  Plus,
  Timer,
  Trash2,
} from "lucide-react";
import TimerPanel from "@/components/timer/TimerPanel";
import TaskPicker from "@/components/timer/TaskPicker";
import Dialog from "@/components/softui/Dialog";
import { Alert, Button, FilterPills, IconButton, KpiGrid, Panel } from "@/components/softui";
import { usePageAction, useShellQuery } from "@/components/softui/Shell";
import { useOptionalTimer } from "@/lib/timer";
import { useAllListing } from "@/lib/use-all-listing";
import { useTimePreferences } from "@/lib/use-time-preferences";
import { timeRange, timeCsv } from "@/lib/time-workspace.mjs";
import {
  countLabel,
  dayOf,
  monthName,
  periodLabel,
  rangeLabelOf,
  shiftDay,
  summarizeSheet,
} from "@/lib/time-sheet.mjs";
import { WORKSPACE_UPDATED } from "@/lib/workspace-updates.mjs";
import { formatDateOnly, messageOf } from "@/lib/api";
import { formatMinutes } from "@/lib/timer-format.mjs";
import { localDateInputValue } from "@/lib/timer-utils.mjs";
import { useAuth } from "@/lib/session";
import { useAction } from "@/lib/use-listing";
import { can } from "@/lib/access";
import { canUseTimer } from "@/lib/timer-access";
import {
  Empty,
  Field,
  Notice,
  Pagination,
  inputClass,
  selectClass,
} from "@/components/workspace/ui";

/** Vingt saisies par page : le tableau reste court, les totaux restent complets. */
const PER_PAGE = 20;

function subscribeToLocalDate(callback) {
  const interval = setInterval(callback, 60_000);
  window.addEventListener("focus", callback);
  return () => {
    clearInterval(interval);
    window.removeEventListener("focus", callback);
  };
}

function getServerLocalDate() {
  return "";
}

function nameOf(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;
}

export default function TempsPage() {
  const { user, space } = useAuth();
  const canReadTime = can(user, "time:read:any") || can(user, "time:read:own");
  const canWriteTime = can(user, "time:write:any") || can(user, "time:write:own");
  // Une nouvelle saisie est MON temps : elle se fait dans l'espace personnel.
  // L'espace équipe consulte et corrige le temps de l'équipe.
  const canAddEntry = space !== "team" && canUseTimer(user);
  const isTeam = space === "team";
  const { preferences } = useTimePreferences();
  const timer = useOptionalTimer();
  const { query } = useShellQuery();

  const [range, setRange] = useState({ from: "", to: "" });
  const [applied, setApplied] = useState(null);
  const [period, setPeriod] = useState(null);
  const [billing, setBilling] = useState("all");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeError, setRangeError] = useState(null);
  const [page, setPage] = useState(1);

  const today = useSyncExternalStore(subscribeToLocalDate, localDateInputValue, getServerLocalDate);
  const now = today ? new Date(`${today}T12:00:00`) : new Date();
  const activePeriod = period ?? preferences.period;
  const activeRange =
    applied ?? (today ? timeRange(activePeriod, now) : { from: "", to: "" });

  const params = new URLSearchParams();
  if (activeRange.from) params.set("from", activeRange.from);
  if (activeRange.to) params.set("to", activeRange.to);
  const entries = useAllListing(canReadTime && today ? `/time-entries?${params.toString()}` : null);

  const reloadEntries = entries.reload;
  const refreshSummary = timer?.refreshSummary;
  useEffect(() => {
    let timeout;
    const update = (event) => {
      if (!/time-entries|timer|agent-chat/.test(event.detail?.path ?? "")) return;
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        reloadEntries();
        refreshSummary?.();
      }, 150);
    };
    window.addEventListener(WORKSPACE_UPDATED, update);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener(WORKSPACE_UPDATED, update);
    };
  }, [reloadEntries, refreshSummary]);

  const action = useAction(entries.reload);
  const closeAdding = useCallback(() => setAdding(false), []);
  const deleting = pendingDelete !== null && action.busy === `delete:${pendingDelete.id}`;

  /* Suppression : une confirmation explicite, puis le rechargement de la liste. */
  async function remove() {
    const target = pendingDelete;
    if (!target) return;
    const result = await action.run(
      `delete:${target.id}`,
      `/time-entries/${target.id}`,
      { method: "DELETE" },
      "Saisie supprimée.",
    );
    if (result !== null) setPendingDelete(null);
  }

  /* Les saisies de la période, filtrées par le texte (recherche de la coque) et
     par la facturation. Du plus récent au plus ancien, à jour près. */
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("fr");
    return (entries.items ?? [])
      .filter((entry) => (billing === "all" ? true : entry.billable === (billing === "yes")))
      .filter((entry) =>
        needle
          ? [entry.description, entry.task?.title, entry.project?.name, nameOf(entry.user)]
              .filter(Boolean)
              .join(" ")
              .toLocaleLowerCase("fr")
              .includes(needle)
          : true,
      )
      .sort((a, b) => dayOf(b).localeCompare(dayOf(a)) || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  }, [entries.items, billing, query]);

  const summary = summarizeSheet(filtered, today);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / PER_PAGE)));
  const items = filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  /* À l'arrêt (ou en cours), la période affichée est celle de la barre ; avec
     des dates choisies à la main, la pastille le dit explicitement. */
  const periodBadge = applied ? "Dates choisies" : periodLabel(activePeriod, now);
  const rangeLabel = rangeLabelOf(activeRange, formatDateOnly);

  /* L'action principale de la coque ouvre la saisie : elle est déclarée ici,
     jamais dupliquée dans la page. */
  const pageAction = useMemo(
    () => (canAddEntry ? { label: "Saisir du temps", icon: Plus, onClick: () => setAdding(true) } : null),
    [canAddEntry],
  );
  usePageAction(pageAction);

  function choosePeriod(id) {
    setPeriod(id);
    setApplied(null);
    setRangeError(null);
    setRange(timeRange(id, now));
    setPage(1);
  }

  function openRange() {
    setRange({
      from: applied?.from || activeRange.from || "",
      to: applied?.to || activeRange.to || "",
    });
    setRangeError(null);
    setRangeOpen(true);
  }

  function applyRange(event) {
    event.preventDefault();
    if (range.from && range.to && range.from > range.to) {
      setRangeError("La date de fin doit être postérieure ou égale au début.");
      return;
    }
    setRangeError(null);
    setApplied(range);
    setPage(1);
    setRangeOpen(false);
  }

  function exportCsv() {
    const url = URL.createObjectURL(
      new Blob([timeCsv(filtered)], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `comexa-temps-${today}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* Chiffres de la période : tous calculés sur LA MÊME liste filtrée que le
     tableau, donc jamais en désaccord avec les lignes affichées. */
  const running = Boolean(timer?.timer);
  const figuresLoading = entries.loading || Boolean(entries.error);
  const kpis = [
    {
      id: "today",
      tone: "green",
      value: figuresLoading ? "—" : formatMinutes(summary.todayMinutes),
      label: isTeam ? "Temps saisi aujourd’hui par l’équipe" : "Temps saisi aujourd’hui",
      badge: running ? "Minuteur en cours" : undefined,
      deco: running,
      decoIcon: Timer,
    },
    {
      id: "period",
      tone: "blue",
      value: figuresLoading ? "—" : formatMinutes(summary.total),
      label: isTeam ? "Total de l’équipe sur la période" : "Total sur la période affichée",
      badge: periodBadge,
    },
    {
      id: "billable",
      tone: "lilac",
      value: figuresLoading ? "—" : formatMinutes(summary.billable),
      label: "Temps facturable",
      badge: figuresLoading ? undefined : `${summary.billableRatio} % du total`,
    },
    {
      id: "other",
      tone: "yellow",
      value: figuresLoading ? "—" : formatMinutes(summary.unbillable),
      label: "Temps non facturable",
      badge: figuresLoading
        ? undefined
        : `${countLabel(summary.count, "saisie", "saisies")}${
            summary.days ? ` · ${countLabel(summary.days, "jour", "jours")}` : ""
          }`,
    },
  ];

  return (
    <div className="cx-time">
      {/* 1. Période affichée : elle commande les chiffres ET le tableau. */}
      {canReadTime ? (
        <div className="cx-time__bar">
          <FilterPills
            label="Période affichée"
            value={applied ? "" : activePeriod}
            onChange={choosePeriod}
            items={[
              { id: "today", label: "Aujourd’hui" },
              { id: "week", label: "Cette semaine" },
              { id: "month", label: monthName(now) },
              { id: "all", label: "Tout l’historique" },
            ]}
          />
          <div className="cx-time__bar-end">
            <span className="cx-time__range" title={rangeLabel}>
              <CalendarDays size={15} strokeWidth={1.75} aria-hidden="true" />
              <span className="cx-time__range-text">{rangeLabel}</span>
            </span>
            <Button icon={CalendarRange} onClick={openRange}>
              Dates précises
            </Button>
            <Button
              icon={Download}
              onClick={exportCsv}
              disabled={entries.loading || Boolean(entries.error) || filtered.length === 0}
            >
              Exporter en CSV
            </Button>
          </div>
        </div>
      ) : null}

      {/* 2. Les chiffres de la période, tous issus de la même liste filtrée. */}
      {canReadTime ? <KpiGrid items={kpis} label="Chiffres de la période affichée" /> : null}

      {/* 3. Le minuteur : le geste principal de la page, expliqué en une ligne. */}
      {canAddEntry && timer ? (
        <section className="sui-panel sui-timer-card cx-time__timer" aria-label="Minuteur">
          <p className="cx-time__hint">
            <Clock3 size={15} strokeWidth={2} aria-hidden="true" />
            <span>
              <strong>Chronométrez une tâche.</strong> Le temps écoulé est enregistré quand vous
              arrêtez, et rejoint aussitôt la liste ci-dessous.
            </span>
          </p>
          <TimerPanel variant="card" />
        </section>
      ) : null}

      {/* 4. Les saisies : lecture, filtres, correction, export. */}
      <Panel className="cx-time__sheet">
        <header className="cx-time__sheet-head">
          <div className="cx-time__sheet-titles">
            <h2 className="sui-section__title">
              <ListChecks size={18} strokeWidth={1.75} aria-hidden="true" />
              {isTeam ? "Saisies de l’équipe" : "Mes saisies"}
            </h2>
            <p className="sui-card__desc">
              {isTeam
                ? "Chaque ligne est une session déclarée par un membre. Corrigez la durée, le jour ou la description ; les totaux suivent."
                : "Chaque ligne est une session : le minuteur l’a chronométrée, ou vous l’avez saisie à la main. Les totaux et l’export couvrent toute la période, pas seulement cette page."}
            </p>
          </div>
          {canReadTime ? (
            <label className="cx-time__billing">
              <span className="sr-only">Filtrer par facturation</span>
              <select
                className={selectClass}
                value={billing}
                onChange={(event) => {
                  setBilling(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Tout le temps</option>
                <option value="yes">Facturable</option>
                <option value="no">Non facturable</option>
              </select>
            </label>
          ) : null}
        </header>

        {!canReadTime ? (
          <Alert tone="warning" icon={CircleAlert}>
            {canAddEntry
              ? "Votre rôle autorise la saisie, mais pas la lecture de la feuille de temps."
              : canWriteTime
                ? "Votre rôle permet d’écrire du temps, mais ne donne pas accès aux tâches nécessaires pour proposer une saisie."
                : "Votre rôle ne permet pas de consulter la feuille de temps."}
          </Alert>
        ) : null}

        {canReadTime ? (
          <>
            {action.error ? <Alert icon={CircleAlert}>{action.error}</Alert> : null}
            {action.success ? <Alert tone="success">{action.success}</Alert> : null}
            {entries.error ? (
              <Alert icon={CircleAlert}>
                {entries.error}{" "}
                <button type="button" className="cx-time__retry" onClick={entries.reload}>
                  Réessayer
                </button>
              </Alert>
            ) : null}
            {entries.items === null && !entries.error ? <LoadingRows /> : null}

            {!entries.loading && !entries.error && filtered.length === 0 ? (
              <Empty
                icon={Clock3}
                action={
                  canAddEntry ? (
                    <Button variant="dark" icon={Plus} onClick={() => setAdding(true)}>
                      Saisir du temps
                    </Button>
                  ) : null
                }
              >
                {query.trim()
                  ? `Aucune saisie ne correspond à « ${query.trim()} » sur cette période.`
                  : billing !== "all"
                    ? "Aucune saisie de ce type sur la période : essayez « Tout le temps »."
                    : canAddEntry
                      ? "Rien de saisi sur cette période. Lancez le minuteur sur une tâche, ou enregistrez un temps déjà passé."
                      : "Aucune saisie sur cette période."}
              </Empty>
            ) : null}

            {items.length > 0 ? (
              <ul className="cx-time__rows">
                {items.map((entry) => {
                  const canEditEntry =
                    can(user, "time:write:any") ||
                    (can(user, "time:write:own") && entry.userId === user?.id);
                  const member = entry.user && (isTeam || entry.userId !== user?.id) ? nameOf(entry.user) : null;
                  const day = dayOf(entry);
                  return (
                    <li key={entry.id} className="cx-time__row">
                      <div className="cx-time__row-main">
                        <p className="cx-time__row-title">{entry.task?.title ?? "Temps sans tâche"}</p>
                        <p className="cx-time__row-meta">
                          {[entry.project?.name ?? "Sans projet", member, day ? formatDateOnly(day) : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {entry.description ? (
                          <p className="cx-time__row-note">{entry.description}</p>
                        ) : null}
                      </div>
                      <span className={`cx-time__tag cx-time__tag--${entry.billable ? "billable" : "plain"}`}>
                        {entry.billable ? "Facturable" : "Non facturable"}
                      </span>
                      <span className="cx-time__row-minutes">{formatMinutes(entry.minutes)}</span>
                      {canEditEntry ? (
                        <span className="cx-time__row-actions">
                          <IconButton
                            size="sm"
                            tone="ghost"
                            icon={Pencil}
                            label={`Modifier la saisie du ${formatDateOnly(day)}`}
                            onClick={() => setEditing(entry)}
                          />
                          <IconButton
                            size="sm"
                            tone="ghost"
                            icon={Trash2}
                            className="cx-time__remove"
                            label={`Supprimer la saisie du ${formatDateOnly(day)}`}
                            onClick={() => {
                              action.setError(null);
                              setPendingDelete(entry);
                            }}
                          />
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            <Pagination
              meta={{ page: currentPage, perPage: PER_PAGE, total: filtered.length, totalPages: Math.ceil(filtered.length / PER_PAGE) }}
              onPageChange={setPage}
              loading={entries.loading}
              label="Pagination des saisies"
            />
          </>
        ) : null}
      </Panel>

      {/* 5. Boîtes de dialogue : saisie, correction, confirmation. */}
      {canAddEntry && adding ? (
        <Dialog
          title="Saisir du temps"
          eyebrow="Nouvelle entrée"
          icon={Plus}
          tone="green"
          description="Un oubli de minuteur ? Choisissez la tâche, la durée et le jour : la saisie rejoint votre feuille de temps."
          onClose={closeAdding}
        >
          <NewEntry
            defaultMinutes={preferences.minutes}
            defaultBillable={preferences.billable}
            today={today}
            onSaved={async () => {
              await entries.reload();
              refreshSummary?.();
            }}
          />
        </Dialog>
      ) : null}

      {rangeOpen ? (
        <Dialog
          title="Dates précises"
          eyebrow="Période affichée"
          icon={CalendarRange}
          tone="blue"
          description="Choisissez le premier et le dernier jour à afficher. Les chiffres et l’export suivent cette période."
          onClose={() => setRangeOpen(false)}
        >
          <form className="cx-time__range-form" onSubmit={applyRange}>
            <div className="cx-time__range-fields">
              <Field id="time-from" label="Du">
                <input
                  id="time-from"
                  type="date"
                  className={inputClass}
                  value={range.from}
                  onChange={(event) => setRange({ ...range, from: event.target.value })}
                />
              </Field>
              <Field id="time-to" label="Au">
                <input
                  id="time-to"
                  type="date"
                  className={inputClass}
                  value={range.to}
                  onChange={(event) => setRange({ ...range, to: event.target.value })}
                />
              </Field>
            </div>
            {rangeError ? <Notice>{rangeError}</Notice> : null}
            <div className="cx-time__range-presets">
              {[
                ["7 jours", shiftDay(today, -6), today],
                ["30 jours", shiftDay(today, -29), today],
                ["Ce mois", `${today.slice(0, 7)}-01`, today],
              ]
                .filter(([, from]) => /^\d{4}-\d{2}-\d{2}$/.test(from ?? ""))
                .map(([label, from, to]) => (
                  <button
                    key={label}
                    type="button"
                    className={`cx-time__preset${range.from === from && range.to === to ? " is-active" : ""}`}
                    aria-pressed={range.from === from && range.to === to}
                    onClick={() => setRange({ from, to })}
                  >
                    {label}
                  </button>
                ))}
            </div>
            <div className="cx-time__range-actions">
              <Button
                onClick={() => {
                  setApplied({ from: "", to: "" });
                  setPeriod("all");
                  setRange({ from: "", to: "" });
                  setPage(1);
                  setRangeOpen(false);
                }}
              >
                Tout l’historique
              </Button>
              <Button type="submit" variant="dark">
                Afficher cette période
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {canWriteTime && editing ? (
        <Dialog
          title="Modifier la saisie"
          eyebrow="Correction"
          icon={Pencil}
          tone="yellow"
          description="La durée, le jour et la description sont modifiables ; les totaux se recalculent."
          onClose={() => setEditing(null)}
        >
          <EditEntry
            key={editing.id}
            entry={editing}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await entries.reload();
              refreshSummary?.();
            }}
          />
        </Dialog>
      ) : null}

      {canWriteTime && pendingDelete ? (
        <Dialog
          title="Supprimer cette saisie ?"
          eyebrow="Suppression"
          icon={Trash2}
          tone="pink"
          description="La saisie disparaît de la feuille de temps et des totaux. Cette action est définitive."
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              {/* Le focus va à « Annuler » : on ne met pas une suppression sous
                  la touche Entrée par défaut. */}
              <Button onClick={() => setPendingDelete(null)} disabled={deleting} data-autofocus>
                Annuler
              </Button>
              <Button variant="dark" className="cx-time__danger" onClick={remove} disabled={deleting}>
                {deleting ? "Suppression…" : "Supprimer"}
              </Button>
            </>
          }
        >
          {action.error ? (
            <Notice>{action.error}</Notice>
          ) : (
            <p className="cx-time__confirm">
              <strong>{formatMinutes(pendingDelete.minutes)}</strong> du{" "}
              {formatDateOnly(dayOf(pendingDelete))} seront retirés :{" "}
              {pendingDelete.task?.title ?? "temps sans tâche"}.
            </p>
          )}
        </Dialog>
      ) : null}
    </div>
  );
}

/** Squelette du tableau : mêmes lignes, sans contenu — l'attente ne saute pas. */
function LoadingRows({ rows = 4 }) {
  return (
    <div className="cx-time__loading" role="status" aria-label="Chargement des saisies">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="cx-time__loading-row">
          <span className="cx-time__ghost cx-time__ghost--title" aria-hidden="true" />
          <span className="cx-time__ghost cx-time__ghost--meta" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Saisie manuelle : choisir la tâche, puis la durée                            */
/* -------------------------------------------------------------------------- */

function NewEntry({ defaultMinutes, defaultBillable, today, onSaved }) {
  const { request } = useAuth();
  const [task, setTask] = useState(null);
  const [form, setForm] = useState({
    minutes: String(defaultMinutes ?? 60),
    spentOn: "",
    description: "",
    billable: defaultBillable !== false,
  });
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy || !task) return;
    setError(null);
    setSaved(null);
    const spentOn = form.spentOn || today || localDateInputValue();
    if (!spentOn) {
      setError("Choisissez un jour pour cette saisie.");
      return;
    }
    const minutes = Number(form.minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      setError("Indiquez une durée entre 1 et 1 440 minutes.");
      return;
    }
    setBusy(true);
    try {
      await request(`/tasks/${encodeURIComponent(task.id)}/time-entries`, {
        method: "POST",
        body: {
          minutes,
          spentOn,
          description: form.description.trim() || undefined,
          billable: form.billable,
        },
      });
      setSaved(`${formatMinutes(minutes)} enregistrées sur « ${task.title} ».`);
      setTask(null);
      setForm((current) => ({ ...current, description: "" }));
      await onSaved();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cx-time__form">
      {error ? <Notice>{error}</Notice> : null}
      {saved ? <Notice tone="success">{saved}</Notice> : null}

      {task ? (
        <form onSubmit={submit} className="cx-time__entry-form">
          <div className="cx-time__chosen">
            <span className="cx-time__chosen-label">Tâche choisie</span>
            <span className="cx-time__chosen-title">{task.title}</span>
            <button type="button" className="cx-time__link" onClick={() => setTask(null)}>
              Changer de tâche
            </button>
          </div>

          <fieldset disabled={busy} className="cx-time__fields">
            <Field id="entry-minutes" label="Durée" hint="En minutes, de 1 à 1 440.">
              <input
                id="entry-minutes"
                type="number"
                min="1"
                max="1440"
                required
                className={inputClass}
                value={form.minutes}
                onChange={(event) => setForm({ ...form, minutes: event.target.value })}
              />
              <span className="cx-time__presets">
                {[15, 30, 60, 120, 240].map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    className={`cx-time__preset${Number(form.minutes) === minutes ? " is-active" : ""}`}
                    aria-pressed={Number(form.minutes) === minutes}
                    onClick={() => setForm({ ...form, minutes: String(minutes) })}
                  >
                    {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
                  </button>
                ))}
              </span>
            </Field>

            <Field id="entry-date" label="Jour">
              <input
                id="entry-date"
                type="date"
                required
                max={today || undefined}
                className={inputClass}
                value={form.spentOn || today}
                onChange={(event) => setForm({ ...form, spentOn: event.target.value })}
              />
            </Field>

            <div className="cx-time__wide">
              <Field id="entry-description" label="Description" hint="Facultatif — ce que vous avez fait concrètement.">
                <textarea
                  id="entry-description"
                  rows={2}
                  maxLength={500}
                  className={inputClass}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </Field>
            </div>
          </fieldset>

          <label className="cx-time__check">
            <input
              type="checkbox"
              checked={form.billable}
              onChange={(event) => setForm({ ...form, billable: event.target.checked })}
            />
            <span>
              Facturable
              <small>Ce temps sera repris dans la facturation du client.</small>
            </span>
          </label>

          <div className="cx-time__form-actions">
            <Button type="submit" variant="dark" disabled={busy}>
              {busy ? "Enregistrement…" : "Ajouter la saisie"}
            </Button>
            <span className="cx-time__form-note">La saisie apparaît aussitôt dans la liste.</span>
          </div>
        </form>
      ) : (
        <div className="cx-time__pick">
          <p className="cx-time__pick-hint">
            <CircleAlert size={15} strokeWidth={1.9} aria-hidden="true" />
            Choisissez la tâche sur laquelle vous avez travaillé — la durée se saisit ensuite.
          </p>
          <TaskPicker autoFocus onPick={setTask} compact />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Correction d'une saisie existante                                            */
/* -------------------------------------------------------------------------- */

function EditEntry({ entry, onClose, onSaved }) {
  const { request } = useAuth();
  const id = useId();
  const [form, setForm] = useState({
    minutes: String(entry.minutes ?? ""),
    spentOn: dayOf(entry),
    description: entry.description ?? "",
    billable: Boolean(entry.billable),
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request(`/time-entries/${entry.id}`, {
        method: "PATCH",
        body: {
          minutes: Number(form.minutes),
          spentOn: form.spentOn,
          description: form.description.trim() || null,
          billable: form.billable,
        },
      });
      await onSaved();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="cx-time__entry-form" onSubmit={save}>
      {error ? <Notice>{error}</Notice> : null}
      <p className="cx-time__chosen cx-time__chosen--static">
        <span className="cx-time__chosen-label">Tâche</span>
        <span className="cx-time__chosen-title">{entry.task?.title ?? "Temps sans tâche"}</span>
        <span className="cx-time__chosen-meta">
          {entry.project?.name ?? "Sans projet"} · {formatDateOnly(dayOf(entry))}
        </span>
      </p>

      <fieldset disabled={busy} className="cx-time__fields">
        <Field id={`${id}-minutes`} label="Durée" hint="En minutes, de 1 à 1 440.">
          <input
            id={`${id}-minutes`}
            type="number"
            min="1"
            max="1440"
            required
            className={inputClass}
            value={form.minutes}
            onChange={(event) => setForm({ ...form, minutes: event.target.value })}
          />
          <span className="cx-time__presets">
            {[15, 30, 60, 120, 240].map((minutes) => (
              <button
                key={minutes}
                type="button"
                className={`cx-time__preset${Number(form.minutes) === minutes ? " is-active" : ""}`}
                aria-pressed={Number(form.minutes) === minutes}
                onClick={() => setForm({ ...form, minutes: String(minutes) })}
              >
                {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
              </button>
            ))}
          </span>
        </Field>
        <Field id={`${id}-date`} label="Jour">
          <input
            id={`${id}-date`}
            type="date"
            required
            className={inputClass}
            value={form.spentOn}
            onChange={(event) => setForm({ ...form, spentOn: event.target.value })}
          />
        </Field>
        <div className="cx-time__wide">
          <Field id={`${id}-description`} label="Description">
            <textarea
              id={`${id}-description`}
              rows={2}
              maxLength={500}
              className={inputClass}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
        </div>
      </fieldset>

      <label className="cx-time__check">
        <input
          type="checkbox"
          checked={form.billable}
          onChange={(event) => setForm({ ...form, billable: event.target.checked })}
        />
        <span>
          Facturable
          <small>Ce temps sera repris dans la facturation du client.</small>
        </span>
      </label>

      <div className="cx-time__form-actions">
        <Button type="submit" variant="dark" disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
