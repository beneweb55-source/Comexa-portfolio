"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/api";
import { CONTACT_STATUS, CONTACT_STATUS_TONE } from "@/lib/commercial";
import { useAction, useListing } from "@/lib/use-listing";
import { can } from "@/lib/access";
import { Eye, MailX, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/session";
import { Badge, Card, Empty, Notice, Pagination, inputClass, primaryButton, secondaryButton } from "@/components/workspace/ui";
import { RecordActions } from "@/components/softui";

const FILTERS = ["", "NEW", "IN_REVIEW", "CONVERTED", "SPAM", "ARCHIVED"];
const EDITABLE_STATUSES = ["NEW", "IN_REVIEW", "SPAM", "ARCHIVED"];

/**
 * Demandes reçues par le formulaire du site. Une demande se traite ici : on la
 * met en étude, puis on la transforme en prospect (fiche créée dans le CRM).
 * La conversion est définitive : le serveur refuse de convertir deux fois.
 */
export default function ContactsEquipePage() {
  const { user } = useAuth();
  const canUpdateContacts = can(user, "contactrequest:write:any");
  const canConvertContacts = can(user, "contactrequest:convert:any");
  const canReadProspects = can(user, "prospect:read:any") || can(user, "prospect:read:own");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), perPage: "50" });
  if (filter) query.set("status", filter);
  const contacts = useListing(`/contact-requests?${query.toString()}`);
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
            <select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }} className={`${inputClass} h-10 w-auto text-[13px]`} aria-label="Filtrer les demandes de contact par statut">
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
                  <div className="flex items-center gap-2">
                    <Badge tone={CONTACT_STATUS_TONE[item.status] ?? "neutral"}>{CONTACT_STATUS[item.status] ?? item.status}</Badge>
                    <RecordActions
                      resource="/contact-requests"
                      id={item.id}
                      record={item}
                      entityLabel="demande de contact"
                      displayName={item.reference}
                      label={`Actions pour la demande ${item.reference}`}
                      canDelete={canUpdateContacts}
                      deleteWarning={`La demande ${item.reference} sera retirée de la file de traitement. Sa référence reste réservée.`}
                      extraActions={
                        canUpdateContacts && !isConverted
                          ? [
                              {
                                key: "review",
                                label: "Mettre à l’étude",
                                icon: Eye,
                                when: item.status !== "IN_REVIEW",
                                run: ({ request, id }) =>
                                  request(`/contact-requests/${id}`, { method: "PATCH", body: { status: "IN_REVIEW" } }),
                                success: "Demande mise à l’étude.",
                              },
                              {
                                key: "spam",
                                label: "Marquer comme indésirable",
                                icon: ShieldAlert,
                                tone: "danger",
                                when: item.status !== "SPAM",
                                run: ({ request, id }) =>
                                  request(`/contact-requests/${id}`, { method: "PATCH", body: { status: "SPAM" } }),
                                success: "Demande classée comme indésirable.",
                              },
                              {
                                key: "archive",
                                label: "Archiver la demande",
                                icon: MailX,
                                when: item.status !== "ARCHIVED",
                                run: ({ request, id }) =>
                                  request(`/contact-requests/${id}`, { method: "PATCH", body: { status: "ARCHIVED" } }),
                                success: "Demande archivée.",
                              },
                            ]
                          : []
                      }
                      onChanged={contacts.reload}
                    />
                  </div>
                </div>

                <p className="mt-3 whitespace-pre-line rounded-md bg-[var(--comexa-neutral-100)] p-3 text-[14px] leading-relaxed text-[var(--comexa-ink)]">
                  {item.message}
                </p>

                {isConverted ? (
                  <p className="mt-3 text-[13.5px] text-[var(--comexa-ink-soft)]">
                    Demande transformée en prospect le {formatDate(item.convertedAt)}.
                    {item.convertedProspectId && canReadProspects ? (
                      <>
                        {" "}
                        <Link href={`/espace-equipe/prospects/${item.convertedProspectId}`} className="text-[var(--comexa-accent-strong)] underline">
                          Voir le prospect
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : canUpdateContacts || canConvertContacts ? (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    {canUpdateContacts ? (
                      <>
                        <label className="flex flex-col gap-1 text-[13px] text-[var(--comexa-ink-soft)]">
                          Statut
                          <select
                            value={draft.status}
                            onChange={(event) => patchDraft(item, { status: event.target.value })}
                            className={`${inputClass} h-10 w-auto text-[13px]`}
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
                            className={`${inputClass} h-10 text-[13px]`}
                          />
                        </label>
                        <button type="button" onClick={() => save(item)} disabled={busy} className={secondaryButton}>
                          Enregistrer
                        </button>
                      </>
                    ) : item.notes ? (
                      <p className="w-full text-[13.5px] text-[var(--comexa-ink-soft)]"><strong>Note interne :</strong> {item.notes}</p>
                    ) : null}
                    {canConvertContacts ? (
                      <button type="button" onClick={() => convert(item)} disabled={busy} className={primaryButton}>
                        {busy && action.busy === `convert:${item.id}` ? "Conversion…" : "Transformer en prospect"}
                      </button>
                    ) : null}
                  </div>
                ) : item.notes ? (
                  <p className="mt-3 text-[13.5px] text-[var(--comexa-ink-soft)]"><strong>Note interne :</strong> {item.notes}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <Pagination meta={contacts.meta} onPageChange={setPage} loading={contacts.loading} />
      </Card>
    </div>
  );
}
