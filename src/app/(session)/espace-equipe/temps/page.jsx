"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Clock3, Download, Plus, Search, CalendarDays } from "lucide-react";
import TimerPanel from "@/components/timer/TimerPanel";
import Dialog from "@/components/softui/Dialog";
import { useOptionalTimer } from "@/lib/timer";
import { useAllListing } from "@/lib/use-all-listing";
import { useTimePreferences } from "@/lib/use-time-preferences";
import { timeRange, summarizeTime, timeCsv } from "@/lib/time-workspace.mjs";
import { WORKSPACE_UPDATED } from "@/lib/workspace-updates.mjs";
import { formatDateOnly, messageOf } from "@/lib/api";
import { localDateInputValue } from "@/lib/timer-utils.mjs";
import { useAuth } from "@/lib/session";
import { useAction, useListing } from "@/lib/use-listing";
import { formatValue } from "@/components/workspace/DataView";
import { can } from "@/lib/access";
import { canUseTimer } from "@/lib/timer-access";
import {
  Card,
  ConfirmDialog,
  Empty,
  Field,
  Notice,
  Pagination,
  inputClass,
  primaryButton,
  secondaryButton,
  selectClass,
  textareaClass,
} from "@/components/workspace/ui";

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

/**
 * Feuille de temps : mes saisies (filtrables par période), correction, suppression,
 * et nouvelle saisie sur une de mes tâches. L'API borne déjà les lignes au périmètre du porteur.
 */
export default function TempsPage() {
  const { user, space } = useAuth();
  const canReadTime = can(user, "time:read:any") || can(user, "time:read:own");
  const canWriteTime =
    can(user, "time:write:any") || can(user, "time:write:own");
  // Une nouvelle saisie est MON temps : elle se fait dans l'espace personnel.
  // L'espace équipe consulte et corrige le temps de l'équipe.
  const canAddEntry = space !== "team" && canUseTimer(user);
  const { preferences } = useTimePreferences();
  const timer = useOptionalTimer();
  const [range, setRange] = useState({ from: "", to: "" });
  const [applied, setApplied] = useState(null);
  const [period, setPeriod] = useState(null);
  const [query, setQuery] = useState("");
  const [billing, setBilling] = useState("all");
  const [adding, setAdding] = useState(false);
  const [rangeError, setRangeError] = useState(null);
  const today = useSyncExternalStore(
    subscribeToLocalDate,
    localDateInputValue,
    getServerLocalDate,
  );
  const activePeriod = period ?? preferences.period;
  const activeRange =
    applied ??
    (today
      ? timeRange(activePeriod, new Date(`${today}T12:00:00`))
      : { from: "", to: "" });
  const [page, setPage] = useState(1);
  const [taskPage, setTaskPage] = useState(1);
  const params = new URLSearchParams();
  if (activeRange.from) params.set("from", activeRange.from);
  if (activeRange.to) params.set("to", activeRange.to);
  const entries = useAllListing(
    canReadTime && today ? `/time-entries?${params.toString()}` : null,
  );
  const tasks = useListing(
    canAddEntry && adding ? `/me/tasks?page=${taskPage}&perPage=100` : null,
  );
  const reloadEntries = entries.reload;
  const refreshSummary = timer?.refreshSummary;
  useEffect(() => {
    let timeout;
    const update = (event) => {
      if (!/time-entries|timer|agent-chat/.test(event.detail?.path ?? ""))
        return;
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
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const closeAdding = useCallback(() => setAdding(false), []);
  const closeEditing = useCallback(() => setEditing(null), []);
  const filtered = (entries.items ?? [])
    .filter((entry) => {
      const text = [
        entry.description,
        entry.task?.title,
        entry.project?.name,
        entry.user?.firstName,
        entry.user?.lastName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("fr");
      return (
        text.includes(query.trim().toLocaleLowerCase("fr")) &&
        (billing === "all" || entry.billable === (billing === "yes"))
      );
    })
    .sort((a, b) => String(b.spentOn).localeCompare(String(a.spentOn)));
  const summary = summarizeTime(filtered);
  const perPage = 20;
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / perPage)),
  );
  const items = filtered.slice(
    (currentPage - 1) * perPage,
    currentPage * perPage,
  );

  function choosePeriod(id) {
    setPeriod(id);
    setApplied(null);
    setRangeError(null);
    setPage(1);
    setRange(timeRange(id));
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

  return (
    <div className="cx-time cx-redesign">
      <section className="cx-redesign__hero cx-time__hero">
        <div>
          <span className="cx-redesign__eyebrow">
            {space === "team"
              ? "ÉQUIPE / FEUILLE DE TEMPS"
              : "MON ESPACE / MON TEMPS"}
          </span>
          <h2>Du temps bien investi.</h2>
          <p>
            {space === "team"
              ? "Suivez la charge de travail et retrouvez les contributions de votre équipe."
              : "Lancez le minuteur, retrouvez vos sessions et gardez une vue claire sur votre journée."}
          </p>
        </div>
        {canAddEntry ? (
          <button
            type="button"
            className={primaryButton}
            onClick={() => setAdding(true)}
          >
            <Plus size={17} />
            Saisir du temps
          </button>
        ) : null}
      </section>
      {canAddEntry && timer ? (
        <div className="cx-time__timer">
          <TimerPanel variant="card" />
        </div>
      ) : null}
      {canReadTime ? (
        <>
          <div className="cx-time__periods" aria-label="Période affichée">
            {[
              ["today", "Aujourd’hui"],
              ["week", "Cette semaine"],
              ["month", "Ce mois-ci"],
              ["all", "Tout l’historique"],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                aria-pressed={!applied && activePeriod === id}
                onClick={() => choosePeriod(id)}
              >
                {label}
              </button>
            ))}
            <span>
              <CalendarDays size={14} />
              {activeRange.from || activeRange.to
                ? `${activeRange.from ? formatDateOnly(activeRange.from) : "Début"} → ${activeRange.to ? formatDateOnly(activeRange.to) : "Aujourd’hui et après"}`
                : "Toutes les dates"}
            </span>
          </div>
          <div className="cx-time__stats" aria-busy={entries.loading}>
            <article>
              <span>
                <Clock3 size={16} />
                Temps enregistré
              </span>
              <strong>
                {entries.loading || entries.error
                  ? "—"
                  : formatValue("minutes", summary.total)}
              </strong>
              <small>Sur la période et les filtres sélectionnés</small>
            </article>
            <article>
              <span>Temps facturable</span>
              <strong>
                {entries.loading || entries.error
                  ? "—"
                  : formatValue("minutes", summary.billable)}
              </strong>
              <small>
                {entries.loading || entries.error
                  ? "Calcul indisponible"
                  : `${summary.total ? Math.round((summary.billable / summary.total) * 100) : 0} % du temps sélectionné`}
              </small>
            </article>
            <article>
              <span>Temps non facturable</span>
              <strong>
                {entries.loading || entries.error
                  ? "—"
                  : formatValue("minutes", summary.total - summary.billable)}
              </strong>
              <small>
                {entries.loading || entries.error
                  ? "Calcul indisponible"
                  : `${filtered.length} saisie(s) dans la sélection`}
              </small>
            </article>
          </div>
        </>
      ) : null}
      {canAddEntry && adding ? (
        <Dialog
          title="Ajouter une saisie"
          description="Un oubli de minuteur ? Enregistrez votre temps manuellement."
          onClose={closeAdding}
        >
          <NewEntry
            tasks={tasks}
            preferences={preferences}
            onTaskPageChange={setTaskPage}
            onSaved={async () => {
              await entries.reload();
              refreshSummary?.();
            }}
          />
        </Dialog>
      ) : null}

      {canReadTime ? (
        <Card
          title="Votre historique"
          subtitle="Les totaux et l’export incluent toutes les saisies correspondant aux filtres, pas seulement cette page."
          action={
            <button
              type="button"
              className={secondaryButton}
              disabled={entries.loading || !!entries.error || !filtered.length}
              onClick={exportCsv}
            >
              <Download size={15} />
              Exporter en CSV
            </button>
          }
        >
          <div className="cx-time__search">
            <label>
              <Search size={17} />
              <input
                aria-label="Rechercher une tâche, un projet, un membre ou une note"
                placeholder="Rechercher une tâche, un projet, une note…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <select
              aria-label="Filtrer le temps facturable"
              className={selectClass}
              value={billing}
              onChange={(e) => {
                setBilling(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Tout le temps</option>
              <option value="yes">Facturable</option>
              <option value="no">Non facturable</option>
            </select>
          </div>
          <details className="cx-time__dates">
            <summary>Choisir des dates précises</summary>
            <form
              className="mb-5 flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (range.from && range.to && range.from > range.to) {
                  setRangeError(
                    "La date de fin doit être postérieure ou égale au début.",
                  );
                  return;
                }
                setRangeError(null);
                setApplied(range);
                setPage(1);
              }}
            >
              <Field id="time-from" label="Du">
                <input
                  id="time-from"
                  type="date"
                  className={`${inputClass} !w-[170px]`}
                  value={range.from}
                  onChange={(e) => setRange({ ...range, from: e.target.value })}
                />
              </Field>
              <Field id="time-to" label="Au">
                <input
                  id="time-to"
                  type="date"
                  className={`${inputClass} !w-[170px]`}
                  value={range.to}
                  onChange={(e) => setRange({ ...range, to: e.target.value })}
                />
              </Field>
              <button type="submit" className={secondaryButton}>
                Filtrer
              </button>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => {
                  setRange({ from: "", to: "" });
                  choosePeriod("all");
                }}
              >
                Réinitialiser
              </button>
            </form>

            {rangeError ? <Notice>{rangeError}</Notice> : null}
          </details>
          {action.error ? <Notice>{action.error}</Notice> : null}
          {action.success ? (
            <Notice tone="success">{action.success}</Notice>
          ) : null}
          {entries.error ? (
            <Notice>
              {entries.error}{" "}
              <button type="button" onClick={entries.reload}>
                Réessayer
              </button>
            </Notice>
          ) : null}
          {entries.items === null && !entries.error ? (
            <p className="cx-small">Chargement…</p>
          ) : null}
          {!entries.loading && !entries.error && items.length === 0 ? (
            <Empty
              icon={Clock3}
              action={
                canAddEntry ? (
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() => setAdding(true)}
                  >
                    Ajouter une saisie
                  </button>
                ) : null
              }
            >
              Aucune saisie pour cette sélection. Essayez une autre période ou
              ajustez vos filtres.
            </Empty>
          ) : null}

          {items.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {items.map((entry) => {
                const canEditEntry =
                  can(user, "time:write:any") ||
                  (can(user, "time:write:own") && entry.userId === user?.id);
                return (
                  <li key={entry.id} className="cx-time__entry">
                    <div className="min-w-0 flex-1">
                      <p className="cx-time__task">
                        {entry.task?.title ?? "Session libre"}
                      </p>
                      <p className="cx-time__context">
                        {entry.project?.name ?? "Sans projet"}
                        {space === "team" && entry.user
                          ? ` · ${entry.user.firstName ?? ""} ${entry.user.lastName ?? ""}`
                          : ""}
                      </p>
                      <p className="text-[15px] font-semibold text-[var(--comexa-ink)]">
                        {formatValue("minutes", entry.minutes)} ·{" "}
                        {formatDateOnly(entry.spentOn)}
                      </p>
                      <p className="text-[14px] text-[var(--comexa-ink-soft)]">
                        {entry.description || "Sans description"}
                      </p>
                      <span
                        className={`cx-time__badge${entry.billable ? " is-billable" : ""}`}
                      >
                        {entry.billable ? "Facturable" : "Non facturable"}
                      </span>
                    </div>
                    {canEditEntry ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={secondaryButton}
                          onClick={() => setEditing(entry)}
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          className={secondaryButton}
                          onClick={() => {
                            action.setError(null);
                            setPendingDelete(entry);
                          }}
                        >
                          Supprimer
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <Pagination
            meta={{
              page: currentPage,
              perPage,
              total: filtered.length,
              totalPages: Math.ceil(filtered.length / perPage),
            }}
            onPageChange={setPage}
            loading={entries.loading}
          />
        </Card>
      ) : (
        <Card title="Feuille de temps">
          <Notice tone="warning">
            {canAddEntry
              ? "Votre rôle autorise la saisie, mais ne permet pas de consulter la feuille de temps."
              : canWriteTime
                ? "Votre rôle permet d’écrire du temps, mais ne donne pas accès aux tâches nécessaires pour proposer une saisie."
                : "Votre rôle ne permet pas de consulter la feuille de temps."}
          </Notice>
        </Card>
      )}

      {canReadTime && canWriteTime && editing ? (
        <Dialog title="Modifier la saisie" onClose={closeEditing}>
          <EditEntry
            key={editing.id}
            entry={editing}
            onClose={closeEditing}
            onSaved={async () => {
              setEditing(null);
              await entries.reload();
              refreshSummary?.();
            }}
          />
        </Dialog>
      ) : null}

      <ConfirmDialog
        open={canWriteTime && pendingDelete !== null}
        title="Supprimer cette saisie ?"
        confirmLabel="Supprimer"
        tone="danger"
        busy={
          pendingDelete !== null && action.busy === `delete:${pendingDelete.id}`
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={remove}
      >
        {action.error ? (
          <Notice>{action.error}</Notice>
        ) : (
          <p className="cx-small">
            {pendingDelete
              ? `${formatValue("minutes", pendingDelete.minutes)} du ${formatDateOnly(pendingDelete.spentOn)} seront retirés de la feuille de temps.`
              : ""}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

function NewEntry({ tasks, preferences, onTaskPageChange, onSaved }) {
  const { request } = useAuth();
  const today = useSyncExternalStore(
    subscribeToLocalDate,
    localDateInputValue,
    getServerLocalDate,
  );
  const [form, setForm] = useState({
    taskId: "",
    minutes: String(preferences.minutes),
    spentOn: "",
    description: "",
    billable: preferences.billable,
  });
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = tasks.items ?? [];

  function changeTaskPage(nextPage) {
    setForm((current) => ({ ...current, taskId: "" }));
    onTaskPageChange(nextPage);
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setSaved(null);
    if (!form.taskId) {
      setError("Choisissez une tâche.");
      return;
    }
    const spentOn = form.spentOn || today || localDateInputValue();
    if (!spentOn) {
      setError("Choisissez un jour pour cette saisie.");
      return;
    }
    setBusy(true);
    try {
      await request(`/tasks/${encodeURIComponent(form.taskId)}/time-entries`, {
        method: "POST",
        body: {
          minutes: Number(form.minutes),
          spentOn,
          description: form.description.trim() || undefined,
          billable: form.billable,
        },
      });
      setForm({ ...form, taskId: "", description: "" });
      setSaved("Saisie enregistrée.");
      await onSaved();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cx-time__form">
      {tasks.error ? <Notice>{tasks.error}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
      {saved ? <Notice tone="success">{saved}</Notice> : null}
      {tasks.items !== null && list.length === 0 ? (
        <Empty>Aucune tâche ne vous est assignée.</Empty>
      ) : null}
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field id="entry-task" label="Tâche">
              <select
                id="entry-task"
                required
                className={selectClass}
                value={form.taskId}
                onChange={(e) => setForm({ ...form, taskId: e.target.value })}
                disabled={tasks.loading || list.length === 0}
              >
                <option value="">Choisir une tâche…</option>
                {list.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title ?? task.name ?? task.id}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            id="entry-minutes"
            label="Durée (minutes)"
            hint="De 1 à 1 440 minutes."
          >
            <input
              id="entry-minutes"
              type="number"
              min="1"
              max="1440"
              required
              className={inputClass}
              value={form.minutes}
              onChange={(e) => setForm({ ...form, minutes: e.target.value })}
            />
            <div className="cx-time__durations">
              {[15, 30, 60, 120].map((minutes) => (
                <button
                  type="button"
                  key={minutes}
                  aria-pressed={Number(form.minutes) === minutes}
                  onClick={() => setForm({ ...form, minutes: String(minutes) })}
                >
                  {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
                </button>
              ))}
            </div>
          </Field>
          <Field id="entry-date" label="Jour">
            <input
              id="entry-date"
              type="date"
              required
              className={inputClass}
              value={form.spentOn || today}
              onChange={(e) => setForm({ ...form, spentOn: e.target.value })}
            />
          </Field>
          <div className="md:col-span-2">
            <Field id="entry-description" label="Description">
              <textarea
                id="entry-description"
                rows={2}
                maxLength={500}
                className={textareaClass}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[14px] md:col-span-2">
            <input
              type="checkbox"
              checked={form.billable}
              onChange={(e) => setForm({ ...form, billable: e.target.checked })}
            />
            Facturable
          </label>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={busy || list.length === 0}
              className={primaryButton}
            >
              {busy ? "Enregistrement…" : "Ajouter la saisie"}
            </button>
          </div>
        </fieldset>
      </form>
      <Pagination
        meta={tasks.meta}
        onPageChange={changeTaskPage}
        loading={tasks.loading}
      />
    </div>
  );
}

function EditEntry({ entry, onClose, onSaved }) {
  const { request } = useAuth();
  const [form, setForm] = useState({
    minutes: String(entry.minutes ?? ""),
    spentOn: entry.spentOn
      ? new Date(entry.spentOn).toISOString().slice(0, 10)
      : "",
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
    <div>
      {error ? <Notice>{error}</Notice> : null}
      <form onSubmit={save}>
        <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2">
          <Field id="edit-minutes" label="Durée (minutes)">
            <input
              id="edit-minutes"
              type="number"
              min="1"
              max="1440"
              required
              className={inputClass}
              value={form.minutes}
              onChange={(e) => setForm({ ...form, minutes: e.target.value })}
            />
          </Field>
          <Field id="edit-date" label="Jour">
            <input
              id="edit-date"
              type="date"
              required
              className={inputClass}
              value={form.spentOn}
              onChange={(e) => setForm({ ...form, spentOn: e.target.value })}
            />
          </Field>
          <div className="md:col-span-2">
            <Field id="edit-description" label="Description">
              <textarea
                id="edit-description"
                rows={2}
                maxLength={500}
                className={textareaClass}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[14px] md:col-span-2">
            <input
              type="checkbox"
              checked={form.billable}
              onChange={(e) => setForm({ ...form, billable: e.target.checked })}
            />
            Facturable
          </label>
          <div className="flex gap-3 md:col-span-2">
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" onClick={onClose} className={secondaryButton}>
              Annuler
            </button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
