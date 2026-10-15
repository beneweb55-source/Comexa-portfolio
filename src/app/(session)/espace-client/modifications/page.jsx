"use client";

import { useState } from "react";
import { formatDate, formatMoney, messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { MODIFICATION_STATUS, MODIFICATION_TONE, PRIORITY } from "@/lib/modifications";
import { Badge, Card, Empty, Field, Notice, Pagination, inputClass, primaryButton, selectClass, textareaClass } from "@/components/workspace/ui";

/**
 * Demandes de modification du client : déposer une demande sur un de ses projets,
 * suivre son état et lire la décision de l'agence (avec son motif).
 */
export default function ModificationsClientPage() {
  const [page, setPage] = useState(1);
  const [projectPage, setProjectPage] = useState(1);
  const requests = useListing(`/modification-requests?page=${page}&perPage=50`);
  const projects = useListing(`/projects?page=${projectPage}&perPage=50`);
  const [showForm, setShowForm] = useState(false);
  const items = requests.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Mes demandes de modification"
        action={
          <button type="button" className={primaryButton} onClick={() => setShowForm((v) => !v)} disabled={projects.loading || (projects.items ?? []).length === 0}>
            {showForm ? "Fermer" : "Nouvelle demande"}
          </button>
        }
      >
        {requests.error ? <Notice>{requests.error}</Notice> : null}
        {projects.error ? <Notice>{projects.error}</Notice> : null}
        {projects.items === null && !projects.error ? <p className="cx-small">Chargement des projets…</p> : null}
        {requests.items === null && !requests.error ? <p className="cx-small">Chargement…</p> : null}
        {requests.items !== null && items.length === 0 ? <Empty>Aucune demande pour le moment.</Empty> : null}

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
              {item.decisionNote ? <p className="mt-3 text-[14px]"><strong>Réponse de l’agence :</strong> {item.decisionNote}</p> : null}
              {item.extraCost ? <p className="text-[13.5px] text-[var(--comexa-ink-soft)]">Supplément proposé : {formatMoney(item.extraCost, item.extraCostCurrency ?? "DZD")}</p> : null}
            </li>
          ))}
        </ul>
        <Pagination meta={requests.meta} onPageChange={setPage} loading={requests.loading} />
      </Card>

      {showForm ? (
        <NewRequest
          projects={projects.items ?? []}
          projectsMeta={projects.meta}
          projectsLoading={projects.loading}
          onProjectPageChange={setProjectPage}
          onCreated={async () => { setShowForm(false); await requests.reload(); }}
        />
      ) : null}
    </div>
  );
}

function NewRequest({ projects, projectsMeta, projectsLoading, onProjectPageChange, onCreated }) {
  const { request } = useAuth();
  const [form, setForm] = useState({ projectId: projects[0]?.id ?? "", title: "", description: "", priority: "NORMAL" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function changeProjectPage(nextPage) {
    setForm((current) => ({ ...current, projectId: "" }));
    onProjectPageChange(nextPage);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request("/modification-requests", { method: "POST", body: { ...form, title: form.title.trim(), description: form.description.trim() } });
      await onCreated();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Nouvelle demande de modification">
      {error ? <Notice>{error}</Notice> : null}
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field id="mod-project" label="Projet">
            <select id="mod-project" required disabled={projectsLoading || projects.length === 0} className={selectClass} value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
              <option value="">Choisir un projet…</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name ?? project.reference}</option>
              ))}
            </select>
            <Pagination meta={projectsMeta} onPageChange={changeProjectPage} loading={projectsLoading} label="Pagination des projets accessibles" />
          </Field>
        </div>
        <Field id="mod-title" label="Titre" hint="Trois caractères minimum.">
          <input id="mod-title" required minLength={3} maxLength={160} className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field id="mod-priority" label="Priorité">
          <select id="mod-priority" className={selectClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {Object.entries(PRIORITY).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field id="mod-description" label="Description" hint="Dix caractères minimum : décrivez ce que vous souhaitez changer.">
            <textarea id="mod-description" required minLength={10} rows={4} maxLength={5000} className={textareaClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <button type="submit" disabled={busy || projectsLoading || !form.projectId} className={primaryButton}>{busy ? "Envoi…" : "Envoyer la demande"}</button>
        </div>
      </form>
    </Card>
  );
}
