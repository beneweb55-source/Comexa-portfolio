"use client";

import { useState } from "react";
import { formatDate } from "@/lib/api";
import { useListing } from "@/lib/use-listing";
import { Card, Empty, Field, Notice, inputClass, primaryButton, secondaryButton, selectClass } from "@/components/workspace/ui";

const ENTITY_TYPES = ["User", "Role", "Quote", "Invoice", "Payment", "Project", "Client", "Prospect", "Setting", "Service", "Package", "Testimonial", "Partner", "Faq"];

/**
 * Journal d'audit : qui a fait quoi, sur quel objet, quand. Lecture seule.
 * Filtres côté serveur ; la période est saisie en dates (incluses).
 */
export default function JournalPage() {
  const [filters, setFilters] = useState({ action: "", entityType: "", from: "", to: "" });
  const [applied, setApplied] = useState(filters);

  const params = new URLSearchParams({ perPage: "50" });
  for (const [key, value] of Object.entries(applied)) if (value) params.set(key, value);
  const logs = useListing(`/audit-logs?${params.toString()}`);
  const forbidden = logs.errorStatus === 403;

  if (forbidden) {
    return (
      <Card title="Journal d'audit">
        <Notice tone="info">Cette rubrique est réservée aux administrateurs.</Notice>
      </Card>
    );
  }

  const items = logs.items ?? [];

  return (
    <Card title="Journal d'audit">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ ...filters, action: filters.action.trim(), entityType: filters.entityType.trim() });
        }}
        className="mb-6 flex flex-wrap items-end gap-3"
      >
        <Field id="audit-action" label="Action">
          <input id="audit-action" className={`${inputClass} !w-[200px]`} placeholder="ex. LOGIN_SUCCESS" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} />
        </Field>
        <Field id="audit-entity" label="Type d'objet">
          <select id="audit-entity" className={`${selectClass} !w-[180px]`} value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}>
            <option value="">Tous</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </Field>
        <Field id="audit-from" label="Du">
          <input id="audit-from" type="date" className={`${inputClass} !w-[170px]`} value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </Field>
        <Field id="audit-to" label="Au">
          <input id="audit-to" type="date" className={`${inputClass} !w-[170px]`} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </Field>
        <button type="submit" className={primaryButton}>Appliquer</button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => {
            const empty = { action: "", entityType: "", from: "", to: "" };
            setFilters(empty);
            setApplied(empty);
          }}
        >
          Réinitialiser
        </button>
      </form>

      {logs.error ? <Notice>{logs.error}</Notice> : null}
      {logs.items === null && !logs.error ? <p className="cx-small">Chargement…</p> : null}
      {logs.items !== null && items.length === 0 ? <Empty>Aucune entrée pour ces critères.</Empty> : null}

      {items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-[var(--comexa-border-soft)] text-[var(--comexa-ink-muted)]">
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">Auteur</th>
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 pr-4 font-medium">Objet</th>
                <th className="py-2 font-medium">Adresse</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id} className="border-b border-[var(--comexa-border-soft)] align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">{formatDate(entry.createdAt)}</td>
                  <td className="py-2 pr-4">{entry.actorEmail ?? "Système"}</td>
                  <td className="py-2 pr-4"><code className="text-[12.5px]">{entry.action}</code></td>
                  <td className="py-2 pr-4">{entry.entityType ? `${entry.entityType}` : "—"}</td>
                  <td className="py-2 text-[var(--comexa-ink-muted)]">{entry.ipAddress ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
