"use client";

import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { PROSPECT_SOURCE } from "@/lib/commercial";
import { useAction, useListing } from "@/lib/use-listing";
import {
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
} from "@/components/workspace/ui";
import ProspectBoard from "@/components/workspace/ProspectBoard";
import { useShellQuery } from "@/components/softui/Shell";

const EMPTY_PROSPECT = {
  companyName: "",
  contactFirstName: "",
  contactLastName: "",
  email: "",
  phone: "",
  sector: "",
  source: "OTHER",
  notes: "",
};

export default function ProspectsPage() {
  const { user } = useAuth();
  const { query: shellQuery } = useShellQuery();
  const canCreateProspect = can(user, "prospect:write:any") || can(user, "prospect:write:own");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_PROSPECT);
  const [formError, setFormError] = useState(null);

  const effectiveSearch = (shellQuery || search).trim();
  const params = new URLSearchParams({ page: String(page), perPage: "100" });
  if (effectiveSearch) params.set("search", effectiveSearch);
  const prospects = useListing(`/prospects?${params.toString()}`);
  const action = useAction(prospects.reload);
  const items = prospects.items ?? [];

  function update(field) {
    return (event) => setDraft((current) => ({ ...current, [field]: event.target.value }));
  }

  async function create(event) {
    event.preventDefault();
    setFormError(null);
    if (draft.contactFirstName.trim().length < 2 || draft.contactLastName.trim().length < 2) {
      setFormError("Indiquez le prénom et le nom du contact (2 caractères minimum).");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
      setFormError("Indiquez une adresse e-mail valide.");
      return;
    }
    const body = Object.fromEntries(
      Object.entries({
        companyName: draft.companyName.trim(),
        contactFirstName: draft.contactFirstName.trim(),
        contactLastName: draft.contactLastName.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim(),
        sector: draft.sector.trim(),
        source: draft.source,
        notes: draft.notes.trim(),
      }).filter(([, value]) => value !== ""),
    );
    const result = await action.run(`create`, `/prospects`, { method: "POST", body }, "Prospect créé.");
    if (result) {
      setDraft(EMPTY_PROSPECT);
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {prospects.error ? <Notice>{prospects.error}</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}

      <Card
        title="Pipeline commercial (Prospects)"
        subtitle="Glissez une fiche d’une colonne à l’autre pour faire avancer l’étape commerciale."
        action={
          canCreateProspect ? (
            <button type="button" onClick={() => setCreating(true)} className={primaryButton} data-coach-id="prospects-create-button">
              <Plus size={15} /> Nouveau prospect
            </button>
          ) : null
        }
      >
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-[var(--comexa-ink-soft)]">
            Filtrer le pipeline
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Entreprise, contact, e-mail…"
              className={`${inputClass} h-10 w-[min(320px,72vw)] text-[13px]`}
            />
          </label>
        </div>

        {prospects.items === null && !prospects.error ? <SkeletonList rows={4} /> : null}
        {prospects.items !== null && items.length === 0 ? (
          <Empty
            icon={Sparkles}
            action={
              canCreateProspect ? (
                <button type="button" onClick={() => setCreating(true)} className={primaryButton} data-coach-id="prospects-create-button">
                  <Plus size={15} /> Créer le premier prospect
                </button>
              ) : null
            }
          >
            Aucun prospect pour ces critères.
          </Empty>
        ) : null}

        {items.length > 0 ? <ProspectBoard items={items} onChanged={prospects.reload} /> : null}
        <Pagination meta={prospects.meta} onPageChange={setPage} loading={prospects.loading} />
      </Card>

      <SideSheet
        open={creating && canCreateProspect}
        onClose={() => setCreating(false)}
        title="Nouveau prospect"
        subtitle="Enregistrez un contact qualifié dans le pipeline commercial."
      >
        <form onSubmit={create} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field id="p-company" label="Entreprise">
            <input id="p-company" data-coach-id="prospect-form-company" className={inputClass} value={draft.companyName} onChange={update("companyName")} maxLength={200} />
          </Field>
          <Field id="p-source" label="Source">
            <select id="p-source" className={selectClass} value={draft.source} onChange={update("source")}>
              {Object.entries(PROSPECT_SOURCE).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="p-first" label="Prénom du contact *">
            <input id="p-first" data-coach-id="prospect-form-first" className={inputClass} value={draft.contactFirstName} onChange={update("contactFirstName")} maxLength={120} />
          </Field>
          <Field id="p-last" label="Nom du contact *">
            <input id="p-last" data-coach-id="prospect-form-last" className={inputClass} value={draft.contactLastName} onChange={update("contactLastName")} maxLength={120} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="p-email" label="E-mail *">
              <input id="p-email" type="email" data-coach-id="prospect-form-email" className={inputClass} value={draft.email} onChange={update("email")} maxLength={320} />
            </Field>
          </div>
          <Field id="p-phone" label="Téléphone">
            <input id="p-phone" className={inputClass} value={draft.phone} onChange={update("phone")} maxLength={40} />
          </Field>
          <Field id="p-sector" label="Secteur">
            <input id="p-sector" className={inputClass} value={draft.sector} onChange={update("sector")} maxLength={120} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="p-notes" label="Notes internes">
              <input id="p-notes" className={inputClass} value={draft.notes} onChange={update("notes")} maxLength={5000} />
            </Field>
          </div>
          {formError ? <div className="sm:col-span-2"><Notice>{formError}</Notice></div> : null}
          <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
            <button type="button" onClick={() => setCreating(false)} className={secondaryButton}>
              Annuler
            </button>
            <button type="submit" disabled={action.busy === "create"} className={primaryButton} data-coach-id="prospect-form-submit">
              {action.busy === "create" ? "Enregistrement…" : "Créer le prospect"}
            </button>
          </div>
        </form>
      </SideSheet>
    </div>
  );
}
