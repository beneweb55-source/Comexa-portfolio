"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/api";
import { CONTACT_STATUS, CONTACT_STATUS_TONE } from "@/lib/commercial";
import { useAction, useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Notice, inputClass, primaryButton, secondaryButton } from "@/components/workspace/ui";

const FILTERS = ["", "NEW", "IN_REVIEW", "CONVERTED", "SPAM", "ARCHIVED"];
const EDITABLE_STATUSES = ["NEW", "IN_REVIEW", "SPAM", "ARCHIVED"];

/**
 * Demandes reçues par le formulaire du site. Une demande se traite ici : on la
 * met en étude, puis on la transforme en prospect (fiche créée dans le CRM).
 * La conversion est définitive : le serveur refuse de convertir deux fois.
 */
export default function ContactsEquipePage() {
  const [filter, setFilter] = useState("");
  const path = filter ? `/contact-requests?perPage=50&status=${filter}` : "/contact-requests?perPage=50";
  const contacts = useListing(path);
  const action = useAction(contacts.reload);
  const [drafts, setDrafts] = useState({});
  const [converted, setConverted] = useState(null);

  function draftOf(item) {
    return drafts[item.id] ?? { status: item.status, notes: item.notes ?? "" };
  }

  function patchDraft(item, patch) {
    setDrafts((current) => ({ ...current, [item.id]: { ...draftOf(item), ...patch } }));
  }

  function save(item) {
    const draft = draftOf(item);
    return action.run(
      `save:${item.id}`,
      `/contact-requests/${item.id}`,
      { method: "PATCH", body: { status: draft.status, notes: draft.notes.trim() || undefined } },
      `Demande ${item.reference} mise à jour.`,
    );
  }

  async function convert(item) {
    setConverted(null);
    const response = await action.run(
      `convert:${item.id}`,
      `/contact-requests/${item.id}/convert`,
      { method: "POST" },
      `Demande ${item.reference} transformée en prospect.`,
    );
    const prospect = response?.data;
    if (prospect?.id) setConverted({ reference: item.reference, prospectId: prospect.id, prospectRef: prospect.reference });
  }

  const items = contacts.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      {contacts.error ? <Notice>{contacts.error}</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}
      {converted ? (
        <Notice tone="success">
          Prospect {converted.prospectRef ?? ""} créé.{" "}
          <Link href={`/espace-equipe/prospects/${converted.prospectId}`} className="underline">
            Ouvrir la fiche
          </Link>
        </Notice>
      ) : null}

      <Card
        title="Demandes de contact"
        action={
          <label className="flex items-center gap-2 text-[14px] text-[var(--comexa-ink-soft)]">
            Statut
            <select value={filter} onChange={(event) => setFilter(event.target.value)} className={`${inputClass} h-9 w-auto text-[13px]`}>
              <option value="">Tous</option>
              {FILTERS.filter(Boolean).map((status) => (
                <option key={status} value={status}>
                  {CONTACT_STATUS[status]}
                </option>
              ))}
            </select>
          </label>
        }
      >
        {contacts.items === null && !contacts.error ? <p className="text-[14px] text-[var(--comexa-ink-soft)]">Chargement…</p> : null}
        {contacts.items !== null && items.length === 0 ? <Empty>Aucune demande pour ce filtre.</Empty> : null}

        <ul className="flex flex-col gap-4">
          {items.map((item) => {
            const draft = draftOf(item);
            const busy = action.busy?.endsWith(`:${item.id}`);
            const isConverted = item.status === "CONVERTED";
            return (
              <li key={item.id} className="rounded-lg border border-[var(--comexa-border-soft)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">
                      {item.reference} · {formatDate(item.createdAt)}
                    </p>
                    <h3 className="text-[16px] font-semibold text-[var(--comexa-ink)]">
                      {item.firstName} {item.lastName}
                      {item.companyName ? <span className="font-normal text-[var(--comexa-ink-soft)]"> · {item.companyName}</span> : null}
                    </h3>
                    <p className="text-[13.5px] text-[var(--comexa-ink-soft)]">
                      {item.email}
                      {item.phone ? ` · ${item.phone}` : ""}
                    </p>
                    <p className="mt-1 text-[13.5px] text-[var(--comexa-ink-soft)]">
                      Projet : {item.subject || "non précisé"} · Source : {item.source || "site"}
                      {item.utm?.campaign ? ` · Campagne : ${item.utm.campaign}` : ""}
                    </p>
                  </div>
                  <Badge tone={CONTACT_STATUS_TONE[item.status] ?? "neutral"}>{CONTACT_STATUS[item.status] ?? item.status}</Badge>
                </div>

                <p className="mt-3 whitespace-pre-line rounded-md bg-[var(--comexa-neutral-100)] p-3 text-[14px] leading-relaxed text-[var(--comexa-ink)]">
                  {item.message}
                </p>

                {isConverted ? (
                  <p className="mt-3 text-[13.5px] text-[var(--comexa-ink-soft)]">
                    Demande transformée en prospect le {formatDate(item.convertedAt)}.
                    {item.convertedProspectId ? (
                      <>
                        {" "}
                        <Link href={`/espace-equipe/prospects/${item.convertedProspectId}`} className="text-[var(--comexa-accent-strong)] underline">
                          Voir le prospect
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 text-[13px] text-[var(--comexa-ink-soft)]">
                      Statut
                      <select
                        value={draft.status}
                        onChange={(event) => patchDraft(item, { status: event.target.value })}
                        className={`${inputClass} h-9 w-auto text-[13px]`}
                      >
                        {EDITABLE_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {CONTACT_STATUS[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[13px] text-[var(--comexa-ink-soft)]">
                      Note interne
                      <input
                        value={draft.notes}
                        onChange={(event) => patchDraft(item, { notes: event.target.value })}
                        maxLength={5000}
                        className={`${inputClass} h-9 text-[13px]`}
                      />
                    </label>
                    <button type="button" onClick={() => save(item)} disabled={busy} className={secondaryButton}>
                      Enregistrer
                    </button>
                    <button type="button" onClick={() => convert(item)} disabled={busy} className={primaryButton}>
                      {busy && action.busy === `convert:${item.id}` ? "Conversion…" : "Transformer en prospect"}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
