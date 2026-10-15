"use client";

import { useState } from "react";
import { Plus, Wrench } from "lucide-react";
import { formatDate, formatMoney, messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { MODIFICATION_STATUS, MODIFICATION_TONE, PRIORITY } from "@/lib/modifications";
import {
  Badge,
  Card,
  Empty,
  Field,
  Notice,
  Pagination,
  SideSheet,
  SkeletonList,
  inputClass,
  primaryButton,
  secondaryButton,
  selectClass,
  textareaClass,
} from "@/components/workspace/ui";

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
        subtitle="Déposez un ajustement souhaité sur un projet et suivez la réponse de l’équipe."
        action={
          <button
            type="button"
            className={primaryButton}
            onClick={() => setShowForm(true)}
            disabled={projects.loading || (projects.items ?? []).length === 0}
          >
            <Plus size={15} /> Nouvelle demande
          </button>
        }
      >
        {requests.error ? <Notice>{requests.error}</Notice> : null}
        {projects.error ? <Notice>{projects.error}</Notice> : null}
        {requests.items === null && !requests.error ? <SkeletonList rows={3} /> : null}
        {requests.items !== null && items.length === 0 ? (
          <Empty
            icon={Wrench}
            action={
              (projects.items ?? []).length > 0 ? (
                <button type="button" className={primaryButton} onClick={() => setShowForm(true)}>
                  <Plus size={15} /> Déposer une demande
                </button>
              ) : null
            }
          >
            Aucune demande de modification pour le moment.
          </Empty>
        ) : null}

        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id} className="rounded-2xl border border-[var(--comexa-border-soft)] bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15.5px] font-bold text-[var(--comexa-ink)]">{item.title}</p>
                  <p className="text-[12.5px] text-[var(--comexa-ink-muted)]">{item.reference} · déposée le {formatDate(item.createdAt)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={MODIFICATION_TONE[item.status] ?? "neutral"}>{MODIFICATION_STATUS[item.status] ?? item.status}</Badge>
                  <Badge>{PRIORITY[item.priority] ?? item.priority}</Badge>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-line text-[14px] text-[var(--comexa-ink-soft)]">{item.description}</p>
              {item.decisionNote ? (
                <p className="mt-3 rounded-xl border border-[var(--comexa-border)] bg-[var(--comexa-surface-alt)] px-3.5 py-2.5 text-[13.5px]">
                  <strong className="text-[var(--comexa-ink)]">Réponse de l’agence :</strong> {item.decisionNote}
                </p>
              ) : null}
              {item.extraCost ? (
                <p className="mt-2 text-[13.5px] font-semibold text-[var(--comexa-ink-soft)]">
                  Supplément proposé : {formatMoney(item.extraCost, item.extraCostCurrency ?? "DZD")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <Pagination meta={requests.meta} onPageChange={setPage} loading={requests.loading} />
      </Card>

      <SideSheet
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Nouvelle demande de modification"
        subtitle="Sélectionnez le projet concerné et décrivez l’ajustement attendu."
      >
        <NewRequest
          projects={projects.items ?? []}
          projectsMeta={projects.meta}
          projectsLoading={projects.loading}
          onProjectPageChange={setProjectPage}
          onCancel={() => setShowForm(false)}
          onCreated={async () => {
            setShowForm(false);
            await requests.reload();
          }}
        />
      </SideSheet>
    </div>
  );
}

function NewRequest({ projects, projectsMeta, projectsLoading, onProjectPageChange, onCancel, onCreated }) {
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
      await request("/modification-requests", {
        method: "POST",
        body: { ...form, title: form.title.trim(), description: form.description.trim() },
      });
      await onCreated();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error ? <Notice>{error}</Notice> : null}
      <Field id="mod-project" label="Projet">
        <select id="mod-project" required disabled={projectsLoading || projects.length === 0} className={selectClass} value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
          <option value="">Choisir un projet…</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name ?? project.reference}</option>
          ))}
        </select>
        <Pagination meta={projectsMeta} onPageChange={changeProjectPage} loading={projectsLoading} label="Pagination des projets accessibles" />
      </Field>
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
      <Field id="mod-description" label="Description" hint="Dix caractères minimum : décrivez ce que vous souhaitez changer.">
        <textarea id="mod-description" required minLength={10} rows={4} maxLength={5000} className={textareaClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className={secondaryButton}>Annuler</button>
        <button type="submit" disabled={busy || projectsLoading || !form.projectId} className={primaryButton}>{busy ? "Envoi…" : "Envoyer la demande"}</button>
      </div>
    </form>
  );
}
