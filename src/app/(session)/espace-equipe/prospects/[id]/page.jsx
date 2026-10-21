"use client";

import { use, useState } from "react";
import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/api";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { PROSPECT_SOURCE, PROSPECT_STATUS, PROSPECT_STATUS_TONE } from "@/lib/commercial";
import { useAction, useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Field, Notice, Pagination, inputClass, primaryButton, secondaryButton, selectClass } from "@/components/workspace/ui";

/** Fiche d'un prospect : statut du pipeline, historique, puis conversion en client. */
export default function ProspectDetailPage({ params }) {
  const { id } = use(params);
  const { user } = useAuth();
  const canWriteProspect = can(user, "prospect:write:any") || can(user, "prospect:write:own");
  const canConvertProspect = can(user, "prospect:convert:any");
  const canCreateQuote = can(user, "quote:write:any");
  const canReadClients = can(user, "client:read:any");
  const [historyPage, setHistoryPage] = useState(1);
  const prospect = useListing(`/prospects/${id}`);
  const history = useListing(`/prospects/${id}/history?page=${historyPage}&perPage=50`);
  const action = useAction(() => Promise.all([prospect.reload(), history.reload()]));
  const [statusDraft, setStatusDraft] = useState(null);
  const [note, setNote] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [converted, setConverted] = useState(null);

  const data = prospect.items;
  if (prospect.items === null) {
    return (
      <div className="flex flex-col gap-6">
        {prospect.error ? <Notice>{prospect.error}</Notice> : <p className="text-[14px] text-[var(--comexa-ink-soft)]">Chargement…</p>}
      </div>
    );
  }

  const currentStatus = statusDraft ?? data.status;
  const isConverted = Boolean(data.convertedClientId);

  async function changeStatus() {
    if (currentStatus === "LOST" && lostReason.trim().length < 3) {
      action.setError("Indiquez le motif de la perte du prospect.");
      return;
    }
    const body = { status: currentStatus };
    if (note.trim()) body.note = note.trim();
    if (currentStatus === "LOST") body.lostReason = lostReason.trim();
    const result = await action.run(`status`, `/prospects/${id}/status`, { method: "POST", body }, "Statut mis à jour.");
    if (result) {
      setStatusDraft(null);
      setNote("");
      setLostReason("");
    }
  }

  async function convert() {
    setConverted(null);
    const response = await action.run(`convert`, `/prospects/${id}/convert`, { method: "POST" }, "Prospect converti en client.");
    if (response) setConverted(response.data ?? {});
  }

  return (
    <div className="flex flex-col gap-6">
      <nav className="text-[14px] text-[var(--comexa-ink-soft)]">
        <Link href="/espace-equipe/prospects" className="hover:underline">
          ← Retour aux prospects
        </Link>
      </nav>

      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}
      {converted ? (
        <Notice tone="success">
          Client créé.{" "}
          {canReadClients ? <Link href="/espace-equipe/clients" className="underline">Voir les clients</Link> : null}
        </Notice>
      ) : null}

      <Card
        title={data.companyName || `${data.contactFirstName} ${data.contactLastName}`}
        action={<Badge tone={PROSPECT_STATUS_TONE[data.status] ?? "neutral"}>{PROSPECT_STATUS[data.status] ?? data.status}</Badge>}
      >
        <dl className="grid gap-4 text-[14.5px] sm:grid-cols-2">
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Référence</dt>
            <dd>{data.reference}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Contact</dt>
            <dd>
              {data.contactFirstName} {data.contactLastName}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">E-mail</dt>
            <dd>{data.email}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Téléphone</dt>
            <dd>{data.phone || "—"}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Source</dt>
            <dd>{PROSPECT_SOURCE[data.source] ?? data.source}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Budget estimé</dt>
            <dd>{data.estimatedBudget ? formatMoney(data.estimatedBudget, DEFAULT_CURRENCY) : "—"}</dd>
          </div>
          {data.notes ? (
            <div className="sm:col-span-2">
              <dt className="text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">Notes</dt>
              <dd className="whitespace-pre-line">{data.notes}</dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          {canCreateQuote ? (
            <Link href={`/espace-equipe/devis/nouveau?prospectId=${id}`} className={primaryButton}>
              Créer un devis
            </Link>
          ) : null}
          {isConverted ? (
            <span className="self-center text-[14px] text-[var(--comexa-ink-soft)]">Ce prospect est déjà converti en client.</span>
          ) : canConvertProspect ? (
            <button type="button" onClick={convert} disabled={Boolean(action.busy)} className={secondaryButton} data-coach-id="prospect-convert-button">
              {action.busy === "convert" ? "Conversion…" : "Convertir en client"}
            </button>
          ) : null}
        </div>
      </Card>

      {canWriteProspect && !isConverted ? (
        <Card title="Changer le statut">
        <div className="grid gap-4 md:grid-cols-3">
          <Field id="status" label="Nouveau statut">
            <select id="status" className={selectClass} value={currentStatus} onChange={(event) => setStatusDraft(event.target.value)}>
              {Object.entries(PROSPECT_STATUS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="note" label="Note" hint="Visible dans l'historique.">
            <input id="note" className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} />
          </Field>
          {currentStatus === "LOST" ? (
            <Field id="lost" label="Motif de la perte *">
              <input id="lost" className={inputClass} value={lostReason} onChange={(event) => setLostReason(event.target.value)} maxLength={1000} />
            </Field>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={changeStatus} disabled={action.busy === "status" || currentStatus === data.status} className={primaryButton}>
            {action.busy === "status" ? "Enregistrement…" : "Mettre à jour le statut"}
          </button>
        </div>
        </Card>
      ) : null}

      <Card title="Historique">
        {history.error ? <Notice>{history.error}</Notice> : null}
        {history.items !== null && (history.items ?? []).length === 0 ? <Empty>Aucun changement enregistré.</Empty> : null}
        <ol className="flex flex-col gap-3">
          {(history.items ?? []).map((entry) => (
            <li key={entry.id} className="border-l-2 border-[var(--comexa-border-soft)] pl-4 text-[14px]">
              <p className="font-medium text-[var(--comexa-ink)]">
                {entry.fromStatus ? `${PROSPECT_STATUS[entry.fromStatus] ?? entry.fromStatus} → ` : ""}
                {PROSPECT_STATUS[entry.toStatus] ?? entry.toStatus ?? entry.action}
              </p>
              <p className="text-[var(--comexa-ink-soft)]">
                {formatDate(entry.createdAt)}
                {entry.note ? ` · ${entry.note}` : ""}
                {entry.lostReason ? ` · Motif : ${entry.lostReason}` : ""}
              </p>
            </li>
          ))}
        </ol>
        <Pagination meta={history.meta} onPageChange={setHistoryPage} loading={history.loading} />
      </Card>
    </div>
  );
}
