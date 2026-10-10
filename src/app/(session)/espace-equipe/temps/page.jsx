"use client";

import { useState } from "react";
import { formatDate, messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { useAction, useListing } from "@/lib/use-listing";
import { formatValue } from "@/components/workspace/DataView";
import { Card, ConfirmDialog, Empty, Field, Notice, inputClass, primaryButton, secondaryButton, selectClass, textareaClass } from "@/components/workspace/ui";

/**
 * Feuille de temps : mes saisies (filtrables par période), correction, suppression,
 * et nouvelle saisie sur une de mes tâches. L'API borne déjà les lignes au périmètre du porteur.
 */
export default function TempsPage() {
  const [range, setRange] = useState({ from: "", to: "" });
  const [applied, setApplied] = useState({ from: "", to: "" });
  const params = new URLSearchParams({ perPage: "100" });
  if (applied.from) params.set("from", new Date(applied.from).toISOString());
  if (applied.to) params.set("to", new Date(`${applied.to}T23:59:59`).toISOString());
  const entries = useListing(`/time-entries?${params.toString()}`);
  const tasks = useListing("/me/tasks?perPage=100");
  const action = useAction(entries.reload);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const items = entries.items ?? [];
  const totalMinutes = items.reduce((sum, e) => sum + Number(e.minutes ?? 0), 0);

  async function remove() {
    const target = pendingDelete;
    await action.run(`delete:${target.id}`, `/time-entries/${target.id}`, { method: "DELETE" }, "Saisie supprimée.");
    setPendingDelete(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <NewEntry tasks={tasks} onSaved={entries.reload} />

      <Card title="Saisies">
        <form
          className="mb-5 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(range);
          }}
        >
          <Field id="time-from" label="Du">
            <input id="time-from" type="date" className={`${inputClass} !w-[170px]`} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </Field>
          <Field id="time-to" label="Au">
            <input id="time-to" type="date" className={`${inputClass} !w-[170px]`} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </Field>
          <button type="submit" className={secondaryButton}>Filtrer</button>
          <p className="ml-auto text-[14px] text-[var(--comexa-ink-soft)]">Total affiché : {formatValue("minutes", totalMinutes)}</p>
        </form>

        {action.error ? <Notice>{action.error}</Notice> : null}
        {action.success ? <Notice tone="success">{action.success}</Notice> : null}
        {entries.error ? <Notice>{entries.error}</Notice> : null}
        {entries.items === null && !entries.error ? <p className="cx-small">Chargement…</p> : null}
        {entries.items !== null && items.length === 0 ? <Empty>Aucune saisie sur cette période.</Empty> : null}

        {items.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {items.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-[var(--comexa-ink)]">
                    {formatValue("minutes", entry.minutes)} · {formatDate(entry.spentOn)}
                  </p>
                  <p className="text-[14px] text-[var(--comexa-ink-soft)]">{entry.description || "Sans description"}</p>
                  <p className="text-[12.5px] text-[var(--comexa-ink-muted)]">{entry.billable ? "Facturable" : "Non facturable"}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={secondaryButton} onClick={() => setEditing(entry)}>Modifier</button>
                  <button type="button" className={secondaryButton} onClick={() => setPendingDelete(entry)}>Supprimer</button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {editing ? (
        <EditEntry
          key={editing.id}
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await entries.reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Supprimer cette saisie ?"
        confirmLabel="Supprimer"
        tone="danger"
        busy={pendingDelete !== null && action.busy === `delete:${pendingDelete.id}`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={remove}
      >
        <p className="cx-small">{pendingDelete ? `${formatValue("minutes", pendingDelete.minutes)} du ${formatDate(pendingDelete.spentOn)} seront retirés de la feuille de temps.` : ""}</p>
      </ConfirmDialog>
    </div>
  );
}

function NewEntry({ tasks, onSaved }) {
  const { request } = useAuth();
  const [form, setForm] = useState({ taskId: "", minutes: "60", spentOn: new Date().toISOString().slice(0, 10), description: "", billable: true });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = tasks.items ?? [];

  async function submit(event) {
    event.preventDefault();
    setError(null);
    if (!form.taskId) {
      setError("Choisissez une tâche.");
      return;
    }
    setBusy(true);
    try {
      await request(`/tasks/${form.taskId}/time-entries`, {
        method: "POST",
        body: { minutes: Number(form.minutes), spentOn: new Date(`${form.spentOn}T12:00:00`).toISOString(), description: form.description.trim() || undefined, billable: form.billable },
      });
      setForm({ ...form, description: "" });
      await onSaved();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Saisir du temps">
      {tasks.error ? <Notice>{tasks.error}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
      {tasks.items !== null && list.length === 0 ? <Empty>Aucune tâche ne vous est assignée.</Empty> : null}
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field id="entry-task" label="Tâche">
            <select id="entry-task" className={selectClass} value={form.taskId} onChange={(e) => setForm({ ...form, taskId: e.target.value })}>
              <option value="">Choisir une tâche…</option>
              {list.map((task) => (
                <option key={task.id} value={task.id}>{task.title ?? task.name ?? task.id}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field id="entry-minutes" label="Durée (minutes)" hint="De 1 à 1 440 minutes.">
          <input id="entry-minutes" type="number" min="1" max="1440" className={inputClass} value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} />
        </Field>
        <Field id="entry-date" label="Jour">
          <input id="entry-date" type="date" className={inputClass} value={form.spentOn} onChange={(e) => setForm({ ...form, spentOn: e.target.value })} />
        </Field>
        <div className="md:col-span-2">
          <Field id="entry-description" label="Description">
            <textarea id="entry-description" rows={2} maxLength={500} className={textareaClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[14px] md:col-span-2">
          <input type="checkbox" checked={form.billable} onChange={(e) => setForm({ ...form, billable: e.target.checked })} />
          Facturable
        </label>
        <div className="md:col-span-2">
          <button type="submit" disabled={busy || list.length === 0} className={primaryButton}>{busy ? "Enregistrement…" : "Ajouter la saisie"}</button>
        </div>
      </form>
    </Card>
  );
}

function EditEntry({ entry, onClose, onSaved }) {
  const { request } = useAuth();
  const [form, setForm] = useState({
    minutes: String(entry.minutes ?? ""),
    spentOn: entry.spentOn ? new Date(entry.spentOn).toISOString().slice(0, 10) : "",
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
          spentOn: new Date(`${form.spentOn}T12:00:00`).toISOString(),
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
    <Card title="Corriger la saisie">
      {error ? <Notice>{error}</Notice> : null}
      <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
        <Field id="edit-minutes" label="Durée (minutes)">
          <input id="edit-minutes" type="number" min="1" max="1440" required className={inputClass} value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} />
        </Field>
        <Field id="edit-date" label="Jour">
          <input id="edit-date" type="date" required className={inputClass} value={form.spentOn} onChange={(e) => setForm({ ...form, spentOn: e.target.value })} />
        </Field>
        <div className="md:col-span-2">
          <Field id="edit-description" label="Description">
            <textarea id="edit-description" rows={2} maxLength={500} className={textareaClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[14px] md:col-span-2">
          <input type="checkbox" checked={form.billable} onChange={(e) => setForm({ ...form, billable: e.target.checked })} />
          Facturable
        </label>
        <div className="flex gap-3 md:col-span-2">
          <button type="submit" disabled={busy} className={primaryButton}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
          <button type="button" onClick={onClose} className={secondaryButton}>Annuler</button>
        </div>
      </form>
    </Card>
  );
}
