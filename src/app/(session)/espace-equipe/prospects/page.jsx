"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/api";
import { PROSPECT_SOURCE, PROSPECT_STATUS, PROSPECT_STATUS_TONE } from "@/lib/commercial";
import { useAction, useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Field, Notice, inputClass, primaryButton, secondaryButton, selectClass } from "@/components/workspace/ui";

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

/** Pipeline commercial : prospects en cours, filtrables par statut, et création manuelle. */
export default function ProspectsPage() {
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_PROSPECT);
  const [formError, setFormError] = useState(null);

  const params = new URLSearchParams({ perPage: "50" });
  if (filter) params.set("status", filter);
  if (search.trim()) params.set("search", search.trim());
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
        title="Prospects"
        action={
          <button type="button" onClick={() => setCreating((open) => !open)} className={primaryButton}>
            {creating ? "Fermer" : "Nouveau prospect"}
          </button>
        }
      >
        {creating ? (
          <form onSubmit={create} noValidate className="mb-6 grid gap-4 rounded-lg border border-[var(--comexa-border-soft)] p-4 md:grid-cols-2">
            <Field id="p-company" label="Entreprise">
              <input id="p-company" className={inputClass} value={draft.companyName} onChange={update("companyName")} maxLength={200} />
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
              <input id="p-first" className={inputClass} value={draft.contactFirstName} onChange={update("contactFirstName")} maxLength={120} />
            </Field>
            <Field id="p-last" label="Nom du contact *">
              <input id="p-last" className={inputClass} value={draft.contactLastName} onChange={update("contactLastName")} maxLength={120} />
            </Field>
            <Field id="p-email" label="E-mail *">
              <input id="p-email" type="email" className={inputClass} value={draft.email} onChange={update("email")} maxLength={320} />
            </Field>
            <Field id="p-phone" label="Téléphone">
              <input id="p-phone" className={inputClass} value={draft.phone} onChange={update("phone")} maxLength={40} />
            </Field>
            <Field id="p-sector" label="Secteur">
              <input id="p-sector" className={inputClass} value={draft.sector} onChange={update("sector")} maxLength={120} />
            </Field>
            <Field id="p-notes" label="Notes internes">
              <input id="p-notes" className={inputClass} value={draft.notes} onChange={update("notes")} maxLength={5000} />
            </Field>
            {formError ? <Notice>{formError}</Notice> : null}
            <div className="md:col-span-2 flex justify-end gap-3">
              <button type="button" onClick={() => setCreating(false)} className={secondaryButton}>
                Annuler
              </button>
              <button type="submit" disabled={action.busy === "create"} className={primaryButton}>
                {action.busy === "create" ? "Enregistrement…" : "Créer le prospect"}
              </button>
            </div>
          </form>
        ) : null}

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[13px] text-[var(--comexa-ink-soft)]">
            Recherche
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Entreprise, contact, e-mail" className={`${inputClass} h-9 w-64 text-[13px]`} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-[var(--comexa-ink-soft)]">
            Statut
            <select value={filter} onChange={(event) => setFilter(event.target.value)} className={`${inputClass} h-9 w-auto text-[13px]`}>
              <option value="">Tous</option>
              {Object.entries(PROSPECT_STATUS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {prospects.items === null && !prospects.error ? <p className="text-[14px] text-[var(--comexa-ink-soft)]">Chargement…</p> : null}
        {prospects.items !== null && items.length === 0 ? <Empty>Aucun prospect pour ces critères.</Empty> : null}

        <ul className="flex flex-col gap-3">
          {items.map((prospect) => (
            <li key={prospect.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] p-4">
              <div className="min-w-0">
                <p className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">
                  {prospect.reference} · créé le {formatDate(prospect.createdAt)}
                </p>
                <h3 className="text-[16px] font-semibold text-[var(--comexa-ink)]">
                  <Link href={`/espace-equipe/prospects/${prospect.id}`} className="hover:underline">
                    {prospect.companyName || `${prospect.contactFirstName} ${prospect.contactLastName}`}
                  </Link>
                </h3>
                <p className="text-[13.5px] text-[var(--comexa-ink-soft)]">
                  {prospect.contactFirstName} {prospect.contactLastName} · {prospect.email}
                  {prospect.estimatedBudget ? ` · Budget estimé ${formatMoney(prospect.estimatedBudget, "EUR")}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-[var(--comexa-ink-soft)]">{PROSPECT_SOURCE[prospect.source] ?? prospect.source}</span>
                <Badge tone={PROSPECT_STATUS_TONE[prospect.status] ?? "neutral"}>{PROSPECT_STATUS[prospect.status] ?? prospect.status}</Badge>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
