"use client";

import { useState } from "react";
import { formatDate } from "@/lib/api";
import { PROJECT_REQUEST_STATUS } from "@/lib/labels";
import { useAction, useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Notice, inputClass, primaryButton } from "@/components/workspace/ui";

const STATUS_FILTERS = ["", "NEW", "IN_REVIEW", "CONVERTED", "CLOSED"];

const SHORT_REASON = {
  COUNTRY_UNKNOWN: "Pays non déterminé",
  NO_CURRENT_RATE: "Pas de tarif en vigueur",
  NO_COMPATIBLE_PAYMENT_METHOD: "Pas de moyen de paiement",
};

/**
 * Demandes de projet deposees par les visiteurs et clients. Le motif indique
 * pourquoi la commande en ligne n'etait pas possible. La note interne n'est
 * visible que de l'equipe.
 */
export default function DemandesPage() {
  const [filter, setFilter] = useState("");
  const path = filter ? `/project-requests?perPage=50&status=${filter}` : "/project-requests?perPage=50";
  const requests = useListing(path);
  const action = useAction(requests.reload);
  const [drafts, setDrafts] = useState({});

  function draftOf(item) {
    return drafts[item.id] ?? { status: item.status, teamNote: item.teamNote ?? "" };
  }

  function updateDraft(item, patch) {
    setDrafts((current) => ({ ...current, [item.id]: { ...draftOf(item), ...patch } }));
  }

  function save(item) {
    const draft = draftOf(item);
    return action.run(
      `save:${item.id}`,
      `/project-requests/${item.id}`,
      { method: "PATCH", body: { status: draft.status, teamNote: draft.teamNote.trim() || undefined } },
      `Demande ${item.reference} mise à jour.`,
    );
  }

  const items = requests.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      {requests.error ? <Notice>{requests.error}</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}

      <Card
        title="Demandes de projet"
        action={
          <label className="flex items-center gap-2 text-[14px] text-[var(--comexa-ink-soft)]">
            Statut
            <select value={filter} onChange={(event) => setFilter(event.target.value)} className={`${inputClass} h-9 w-auto text-[13px]`}>
              <option value="">Toutes</option>
              {STATUS_FILTERS.slice(1).map((status) => (
                <option key={status} value={status}>
                  {PROJECT_REQUEST_STATUS[status]}
                </option>
              ))}
            </select>
          </label>
        }
      >
        {requests.items === null && !requests.error ? <p className="text-[14px] text-[var(--comexa-ink-soft)]">Chargement…</p> : null}
        {requests.items !== null && items.length === 0 ? <Empty>Aucune demande pour ce filtre.</Empty> : null}

        <ul className="flex flex-col gap-4">
          {items.map((item) => {
            const draft = draftOf(item);
            const busy = action.busy === `save:${item.id}`;
            return (
              <li key={item.id} className="rounded-lg border border-[var(--comexa-border-soft)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">{item.reference} · {formatDate(item.createdAt)}</p>
                    <h3 className="text-[16px] font-semibold text-[var(--comexa-ink)]">
                      {item.customer.firstName} {item.customer.lastName}
                    </h3>
                    <p className="text-[13.5px] text-[var(--comexa-ink-soft)]">
                      {item.customer.email}
                      {item.country ? ` · pays ${item.country}` : ""}
                    </p>
                    <p className="mt-1 text-[14px] text-[var(--comexa-ink)]">Pack : {item.packageName ?? "sur mesure"}</p>
                    {item.reason ? (
                      <p className="text-[13px] text-[var(--comexa-ink-muted)]">Motif : {SHORT_REASON[item.reason] ?? item.reason}</p>
                    ) : null}
                  </div>
                  <Badge tone="neutral">{PROJECT_REQUEST_STATUS[item.status] ?? item.status}</Badge>
                </div>

                {item.message ? (
                  <blockquote className="mt-3 rounded-md bg-[var(--comexa-neutral-50)] px-3 py-2 text-[14px] text-[var(--comexa-ink-soft)]">{item.message}</blockquote>
                ) : null}

                <div className="mt-4 grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-start">
                  <select
                    aria-label={`Statut de ${item.reference}`}
                    value={draft.status}
                    onChange={(event) => updateDraft(item, { status: event.target.value })}
                    className={`${inputClass} h-10 text-[14px]`}
                  >
                    {Object.entries(PROJECT_REQUEST_STATUS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    aria-label={`Note interne ${item.reference}`}
                    placeholder="Note interne (non visible du client)"
                    rows={2}
                    value={draft.teamNote}
                    onChange={(event) => updateDraft(item, { teamNote: event.target.value })}
                    className={`${inputClass} h-auto py-2 text-[14px]`}
                  />
                  <button type="button" onClick={() => save(item)} disabled={busy} className={`${primaryButton} h-10 px-4 text-[14px]`}>
                    {busy ? "Enregistrement…" : "Enregistrer"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
