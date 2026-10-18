"use client";

import { useState } from "react";
import { formatDate, formatMoney, messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { useAction, useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Field, Notice, Pagination, inputClass, primaryButton, selectClass, textareaClass } from "@/components/workspace/ui";
import CurrencySelect, { DEFAULT_CURRENCY } from "@/components/workspace/CurrencySelect";
import { MODIFICATION_STATUS, MODIFICATION_TONE, PRIORITY } from "@/lib/modifications";

/**
 * Demandes de modification reçues des clients : lecture, décision (acceptée ou refusée),
 * estimation de temps et éventuel supplément. La décision est visible du client avec son motif.
 */
export default function ModificationsPage() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), perPage: "100" });
  if (status) query.set("status", status);
  const requests = useListing(`/modification-requests?${query.toString()}`);
  const action = useAction(requests.reload);
  const items = requests.items ?? [];

  return (
    <Card
      title="Demandes de modification"
      action={
        <Field id="mod-status" label="Statut">
          <select id="mod-status" className={`${selectClass} !w-[200px]`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Tous</option>
            {Object.entries(MODIFICATION_STATUS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
      }
    >
      {requests.error ? <Notice>{requests.error}</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}
      {requests.items === null && !requests.error ? <p className="cx-small">Chargement…</p> : null}
      {requests.items !== null && items.length === 0 ? <Empty>Aucune demande pour ces critères.</Empty> : null}

      <ul className="flex flex-col gap-4">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border border-[var(--comexa-border-soft)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15.5px] font-semibold text-[var(--comexa-ink)]">{item.title}</p>
                <p className="text-[12.5px] text-[var(--comexa-ink-muted)]">{item.reference} · déposée le {formatDate(item.createdAt)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone={MODIFICATION_TONE[item.status] ?? "neutral"}>{MODIFICATION_STATUS[item.status] ?? item.status}</Badge>
                <Badge>{PRIORITY[item.priority] ?? item.priority}</Badge>
              </div>
            </div>
            <p className="mt-3 whitespace-pre-line text-[14px] text-[var(--comexa-ink-soft)]">{item.description}</p>
            {item.decisionNote ? <p className="mt-3 text-[14px]"><strong>Décision :</strong> {item.decisionNote}</p> : null}
            {item.estimatedMinutes ? <p className="text-[13.5px] text-[var(--comexa-ink-soft)]">Estimation : {Math.round(item.estimatedMinutes / 60)} h</p> : null}
            {item.extraCost ? <p className="text-[13.5px] text-[var(--comexa-ink-soft)]">Supplément : {formatMoney(item.extraCost, item.extraCostCurrency ?? "DZD")}</p> : null}

            {item.status === "SUBMITTED" || item.status === "IN_PROGRESS" ? (
              <Decide item={item} action={action} onDone={requests.reload} />
            ) : null}
          </li>
        ))}
      </ul>
      <Pagination meta={requests.meta} onPageChange={setPage} loading={requests.loading} />
    </Card>
  );
}

function Decide({ item, action, onDone }) {
  const { request } = useAuth();
  const [form, setForm] = useState({ status: "APPROVED", decisionNote: "", estimatedHours: "", extraCost: "", extraCostCurrency: DEFAULT_CURRENCY });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request(`/modification-requests/${item.id}`, {
        method: "PATCH",
        body: {
          status: form.status,
          decisionNote: form.decisionNote.trim() || undefined,
          ...(form.estimatedHours ? { estimatedMinutes: Math.round(Number(form.estimatedHours) * 60) } : {}),
          ...(form.extraCost ? { extraCost: Number(form.extraCost), extraCostCurrency: form.extraCostCurrency } : {}),
        },
      });
      await onDone();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 rounded-lg bg-[var(--comexa-neutral-100)] p-4 md:grid-cols-2">
      {error ? <div className="md:col-span-2"><Notice>{error}</Notice></div> : null}
      <Field id={`dec-status-${item.id}`} label="Décision">
        <select id={`dec-status-${item.id}`} className={selectClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="APPROVED">Acceptée</option>
          <option value="REJECTED">Refusée</option>
        </select>
      </Field>
      <Field id={`dec-hours-${item.id}`} label="Estimation (heures)">
        <input id={`dec-hours-${item.id}`} type="number" min="0" step="0.5" className={inputClass} value={form.estimatedHours} onChange={(e) => setForm({ ...form, estimatedHours: e.target.value })} />
      </Field>
      <Field id={`dec-cost-${item.id}`} label="Supplément (facultatif)">
        <input id={`dec-cost-${item.id}`} type="number" min="0" step="0.01" className={inputClass} value={form.extraCost} onChange={(e) => setForm({ ...form, extraCost: e.target.value })} />
      </Field>
      <Field id={`dec-currency-${item.id}`} label="Devise du supplément">
        <CurrencySelect id={`dec-currency-${item.id}`} value={form.extraCostCurrency} onChange={(value) => setForm({ ...form, extraCostCurrency: value })} />
      </Field>
      <div className="md:col-span-2">
        <Field id={`dec-note-${item.id}`} label="Motif (affiché au client)">
          <textarea id={`dec-note-${item.id}`} rows={2} maxLength={2000} className={textareaClass} value={form.decisionNote} onChange={(e) => setForm({ ...form, decisionNote: e.target.value })} />
        </Field>
      </div>
      <div className="flex gap-3 md:col-span-2">
        <button type="submit" disabled={busy || action.busy !== null} className={primaryButton}>{busy ? "Enregistrement…" : "Enregistrer la décision"}</button>
      </div>
    </form>
  );
}
