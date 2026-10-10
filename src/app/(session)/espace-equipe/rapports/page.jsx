"use client";

import { useState } from "react";
import { formatDate, messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { useAction, useListing } from "@/lib/use-listing";
import { useObject } from "@/lib/use-object";
import { DataView } from "@/components/workspace/DataView";
import { Badge, Card, Empty, Field, Notice, inputClass, primaryButton, selectClass } from "@/components/workspace/ui";

const REPORT_TYPES = {
  COMMERCIAL_PIPELINE: "Pipeline commercial",
  REVENUE: "Chiffre d’affaires",
  OUTSTANDING_INVOICES: "Factures impayées",
  TASKS: "Tâches",
  TIME_SPENT: "Temps passé",
  PROJECT_PROGRESS: "Avancement des projets",
  ACTIVITY: "Journal d’activité",
};

const PRESETS = {
  TODAY: "Aujourd’hui",
  LAST_7_DAYS: "7 derniers jours",
  LAST_30_DAYS: "30 derniers jours",
  THIS_MONTH: "Ce mois-ci",
  LAST_MONTH: "Mois dernier",
  THIS_QUARTER: "Ce trimestre",
  THIS_YEAR: "Cette année",
  LAST_YEAR: "L’année dernière",
};

const STATUS_LABEL = { PENDING: "En cours", GENERATED: "Généré", FAILED: "Échec" };
const STATUS_TONE = { GENERATED: "success", PENDING: "info", FAILED: "danger" };

/**
 * Rapports : générer un rapport sur une période prédéfinie, consulter le dernier résultat.
 * Le résultat est figé à la date de génération (il ne se recalcule pas).
 */
export default function RapportsPage() {
  const reports = useListing("/reports?perPage=50");
  const [selectedId, setSelectedId] = useState(null);
  const detail = useObject(selectedId ? `/reports/${selectedId}` : null, Boolean(selectedId));
  const items = reports.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Generate onCreated={async (created) => {
        await reports.reload();
        if (created?.id) setSelectedId(created.id);
      }} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <Card title="Rapports générés">
          {reports.error ? <Notice>{reports.error}</Notice> : null}
          {reports.items === null && !reports.error ? <p className="cx-small">Chargement…</p> : null}
          {reports.items !== null && items.length === 0 ? <Empty>Aucun rapport pour le moment.</Empty> : null}
          <ul className="flex flex-col gap-2">
            {items.map((report) => (
              <li key={report.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(report.id)}
                  aria-current={selectedId === report.id ? "true" : undefined}
                  className={`w-full rounded-lg border p-3 text-left ${selectedId === report.id ? "border-[var(--comexa-ink)] bg-[var(--comexa-neutral-100)]" : "border-[var(--comexa-border-soft)] hover:bg-[var(--comexa-neutral-100)]"}`}
                >
                  <span className="block text-[14.5px] font-semibold text-[var(--comexa-ink)]">{report.title || REPORT_TYPES[report.type] || report.type}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--comexa-ink-muted)]">
                    {formatDate(report.createdAt)}
                    <Badge tone={STATUS_TONE[report.status] ?? "neutral"}>{STATUS_LABEL[report.status] ?? report.status}</Badge>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={detail.data?.title || (selectedId ? "Résultat" : "Résultat du rapport")}>
          {!selectedId ? <Empty>Sélectionnez un rapport pour voir son résultat.</Empty> : null}
          {detail.error ? <Notice>{detail.error}</Notice> : null}
          {selectedId && detail.loading && !detail.data ? <p className="cx-small">Chargement…</p> : null}
          {detail.data ? (
            <div className="flex flex-col gap-6">
              <p className="cx-small">
                {REPORT_TYPES[detail.data.type] ?? detail.data.type}
                {detail.data.generatedByName ? ` · par ${detail.data.generatedByName}` : ""}
                {detail.data.completedAt ? ` · généré le ${formatDate(detail.data.completedAt)}` : ""}
              </p>
              {detail.data.error ? <Notice>{detail.data.error}</Notice> : null}
              {detail.data.result ? <DataView value={detail.data.result} /> : <Empty>{detail.data.status === "PENDING" ? "Rapport en cours de génération." : "Pas de résultat disponible."}</Empty>}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

function Generate({ onCreated }) {
  const { request } = useAuth();
  const [form, setForm] = useState({ type: "REVENUE", preset: "LAST_30_DAYS", title: "" });
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { data } = await request("/reports", {
        method: "POST",
        body: { type: form.type, preset: form.preset, ...(form.title.trim() ? { title: form.title.trim() } : {}) },
      });
      setSuccess("Rapport généré.");
      await onCreated(data);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Générer un rapport">
      {error ? <Notice>{error}</Notice> : null}
      {success ? <Notice tone="success">{success}</Notice> : null}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <Field id="report-type" label="Type">
          <select id="report-type" className={`${selectClass} !w-[240px]`} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {Object.entries(REPORT_TYPES).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field id="report-preset" label="Période">
          <select id="report-preset" className={`${selectClass} !w-[200px]`} value={form.preset} onChange={(e) => setForm({ ...form, preset: e.target.value })}>
            {Object.entries(PRESETS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field id="report-title" label="Titre (facultatif)">
          <input id="report-title" className={`${inputClass} !w-[220px]`} minLength={3} maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <button type="submit" disabled={busy} className={primaryButton}>{busy ? "Génération…" : "Générer"}</button>
      </form>
    </Card>
  );
}
