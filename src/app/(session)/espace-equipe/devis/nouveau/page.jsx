"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatMoney, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { daysFromToday, lineTotal } from "@/lib/commercial";
import { useListing } from "@/lib/use-listing";
import { Card, Field, Notice, Pagination, inputClass, primaryButton, secondaryButton, textareaClass } from "@/components/workspace/ui";

const EMPTY_LINE = { title: "", description: "", quantity: "1", unitPrice: "", discountPercent: "0" };

function Form() {
  const router = useRouter();
  const { user, request } = useAuth();
  const canReadProspects = can(user, "prospect:read:any") || can(user, "prospect:read:own");
  const canReadClients = can(user, "client:read:any");
  const canReadClientDetails = canReadClients || can(user, "client:read:own");
  const searchParams = useSearchParams();
  const presetProspect = searchParams.get("prospectId") ?? "";
  const presetClient = searchParams.get("clientId") ?? "";

  const [prospectPage, setProspectPage] = useState(1);
  const [clientPage, setClientPage] = useState(1);
  const prospects = useListing(canReadProspects ? `/prospects?page=${prospectPage}&perPage=100` : null);
  const clients = useListing(canReadClients ? `/clients?page=${clientPage}&perPage=100` : null);
  const presetProspectDetails = useListing(canReadProspects && presetProspect ? `/prospects/${encodeURIComponent(presetProspect)}` : null);
  const presetClientDetails = useListing(canReadClientDetails && presetClient ? `/clients/${encodeURIComponent(presetClient)}` : null);

  const [recipient, setRecipient] = useState(presetClient ? `client:${presetClient}` : presetProspect ? `prospect:${presetProspect}` : "");
  const [header, setHeader] = useState({
    subject: "",
    issueDate: new Date().toISOString().slice(0, 10),
    validUntil: daysFromToday(30),
    currency: "EUR",
    taxRate: "20",
    notes: "",
    terms: "",
  });
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const totals = lines.reduce(
    (acc, line) => {
      const total = lineTotal(line);
      acc.subtotal += total;
      return acc;
    },
    { subtotal: 0 },
  );
  const taxRate = Number(header.taxRate) || 0;
  const taxAmount = Math.round(totals.subtotal * (taxRate / 100) * 100) / 100;

  function setHeaderField(field) {
    return (event) => setHeader((current) => ({ ...current, [field]: event.target.value }));
  }

  function setLine(index, field, value) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, [field]: value } : line)));
  }

  function validate() {
    if (!recipient) return "Choisissez le destinataire du devis (prospect ou client).";
    if (header.subject.trim().length < 3) return "Indiquez l'objet du devis (3 caractères minimum).";
    if (lines.length === 0) return "Ajoutez au moins une ligne.";
    for (const [index, line] of lines.entries()) {
      if (!line.title.trim()) return `La ligne ${index + 1} n'a pas d'intitulé.`;
      if (line.unitPrice === "" || Number(line.unitPrice) < 0) return `La ligne ${index + 1} doit avoir un prix unitaire positif.`;
    }
    return null;
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);

    const [kind, targetId] = recipient.split(":");
    const body = {
      subject: header.subject.trim(),
      issueDate: header.issueDate,
      validUntil: header.validUntil,
      currency: header.currency.trim().toUpperCase() || "EUR",
      taxRate: taxRate,
      notes: header.notes.trim() || undefined,
      terms: header.terms.trim() || undefined,
      items: lines.map((line) => ({
        title: line.title.trim(),
        description: line.description.trim() || undefined,
        quantity: Number(line.quantity) || 1,
        unitPrice: Number(line.unitPrice),
        discountPercent: Number(line.discountPercent) || 0,
      })),
    };
    if (kind === "client") body.clientId = targetId;
    else body.prospectId = targetId;

    try {
      const { data } = await request("/quotes", { method: "POST", body });
      router.push(`/espace-equipe/devis/${data.id}`);
    } catch (caught) {
      setError(messageOf(caught));
      setSaving(false);
    }
  }

  const recipientsLoading = prospects.items === null || clients.items === null;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <nav className="text-[14px] text-[var(--comexa-ink-soft)]">
        <Link href="/espace-equipe/devis" className="hover:underline">
          ← Retour aux devis
        </Link>
      </nav>

      {error ? <Notice>{error}</Notice> : null}
      {prospects.error || clients.error || presetProspectDetails.error || presetClientDetails.error ? (
        <Notice>{prospects.error || clients.error || presetProspectDetails.error || presetClientDetails.error}</Notice>
      ) : null}

      <Card title="Destinataire et en-tête">
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="recipient" label="Destinataire *">
            <select id="recipient" className={inputClass} value={recipient} onChange={(event) => setRecipient(event.target.value)} disabled={recipientsLoading}>
              <option value="">{recipientsLoading ? "Chargement…" : "Choisir…"}</option>
              {recipient.startsWith("client:") && clients.items !== null && !clients.items.some((client) => `client:${client.id}` === recipient) ? (
                <option value={recipient}>{presetClientDetails.items?.companyName || "Client présélectionné"}</option>
              ) : null}
              {recipient.startsWith("prospect:") && prospects.items !== null && !prospects.items.some((prospect) => `prospect:${prospect.id}` === recipient) ? (
                <option value={recipient}>
                  {presetProspectDetails.items?.companyName ||
                    `${presetProspectDetails.items?.contactFirstName ?? ""} ${presetProspectDetails.items?.contactLastName ?? ""}`.trim() ||
                    "Prospect présélectionné"}
                </option>
              ) : null}
              {(clients.items ?? []).length > 0 ? (
                <optgroup label="Clients">
                  {clients.items.map((client) => (
                    <option key={client.id} value={`client:${client.id}`}>
                      {client.companyName}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {(prospects.items ?? []).length > 0 ? (
                <optgroup label="Prospects">
                  {prospects.items.map((prospect) => (
                    <option key={prospect.id} value={`prospect:${prospect.id}`}>
                      {prospect.companyName || `${prospect.contactFirstName} ${prospect.contactLastName}`}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </Field>
          <Field id="subject" label="Objet *">
            <input id="subject" className={inputClass} value={header.subject} onChange={setHeaderField("subject")} maxLength={300} placeholder="Ex. Refonte du site vitrine" />
          </Field>
          <Field id="issue" label="Date d'émission">
            <input id="issue" type="date" className={inputClass} value={header.issueDate} onChange={setHeaderField("issueDate")} />
          </Field>
          <Field id="valid" label="Valable jusqu'au">
            <input id="valid" type="date" className={inputClass} value={header.validUntil} onChange={setHeaderField("validUntil")} />
          </Field>
          <Field id="currency" label="Devise">
            <input id="currency" className={inputClass} value={header.currency} onChange={setHeaderField("currency")} maxLength={3} />
          </Field>
          <Field id="tax" label="TVA (%)">
            <input id="tax" type="number" min="0" step="0.01" className={inputClass} value={header.taxRate} onChange={setHeaderField("taxRate")} />
          </Field>
        </div>
        {!canReadClients && !canReadProspects && !(canReadClientDetails && presetClient) ? (
          <div className="mt-4"><Notice>Votre rôle ne permet pas de consulter les destinataires nécessaires à la création d’un devis.</Notice></div>
        ) : null}
        <div className="grid gap-2 md:grid-cols-2">
          {canReadClients ? (
            <Pagination
              meta={clients.meta}
              label="Pagination des clients"
              loading={clients.loading}
              onPageChange={(nextPage) => {
                if (recipient.startsWith("client:")) setRecipient("");
                setClientPage(nextPage);
              }}
            />
          ) : null}
          {canReadProspects ? (
            <Pagination
              meta={prospects.meta}
              label="Pagination des prospects"
              loading={prospects.loading}
              onPageChange={(nextPage) => {
                if (recipient.startsWith("prospect:")) setRecipient("");
                setProspectPage(nextPage);
              }}
            />
          ) : null}
        </div>
      </Card>

      <Card title="Lignes du devis">
        <div className="flex flex-col gap-4">
          {lines.map((line, index) => (
            <div key={index} className="grid gap-3 rounded-lg border border-[var(--comexa-border-soft)] p-4 md:grid-cols-[2fr_3fr_80px_120px_90px_120px_auto] md:items-end">
              <Field id={`l-title-${index}`} label={`Intitulé ${index + 1} *`}>
                <input id={`l-title-${index}`} className={inputClass} value={line.title} onChange={(event) => setLine(index, "title", event.target.value)} maxLength={300} />
              </Field>
              <Field id={`l-desc-${index}`} label="Description">
                <input id={`l-desc-${index}`} className={inputClass} value={line.description} onChange={(event) => setLine(index, "description", event.target.value)} maxLength={2000} />
              </Field>
              <Field id={`l-qty-${index}`} label="Qté">
                <input id={`l-qty-${index}`} type="number" min="0" step="0.01" className={inputClass} value={line.quantity} onChange={(event) => setLine(index, "quantity", event.target.value)} />
              </Field>
              <Field id={`l-price-${index}`} label="Prix HT">
                <input id={`l-price-${index}`} type="number" min="0" step="0.01" className={inputClass} value={line.unitPrice} onChange={(event) => setLine(index, "unitPrice", event.target.value)} />
              </Field>
              <Field id={`l-disc-${index}`} label="Remise %">
                <input id={`l-disc-${index}`} type="number" min="0" max="100" step="0.01" className={inputClass} value={line.discountPercent} onChange={(event) => setLine(index, "discountPercent", event.target.value)} />
              </Field>
              <p className="self-center text-[14px] font-medium text-[var(--comexa-ink)]">{formatMoney(lineTotal(line), header.currency)}</p>
              <button
                type="button"
                onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                disabled={lines.length === 1}
                className={secondaryButton}
              >
                Retirer
              </button>
            </div>
          ))}
          <div>
            <button type="button" onClick={() => setLines((current) => [...current, { ...EMPTY_LINE }])} className={secondaryButton}>
              Ajouter une ligne
            </button>
          </div>
        </div>

        <dl className="mt-6 ml-auto grid max-w-[320px] grid-cols-2 gap-2 text-[14.5px]">
          <dt>Sous-total HT</dt>
          <dd className="text-right">{formatMoney(totals.subtotal, header.currency)}</dd>
          <dt>TVA ({taxRate} %)</dt>
          <dd className="text-right">{formatMoney(taxAmount, header.currency)}</dd>
          <dt className="font-semibold">Total TTC</dt>
          <dd className="text-right font-semibold">{formatMoney(totals.subtotal + taxAmount, header.currency)}</dd>
        </dl>
      </Card>

      <Card title="Mentions">
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="notes" label="Notes" hint="Visibles par le client.">
            <textarea id="notes" className={textareaClass} rows={3} value={header.notes} onChange={setHeaderField("notes")} maxLength={5000} />
          </Field>
          <Field id="terms" label="Conditions">
            <textarea id="terms" className={textareaClass} rows={3} value={header.terms} onChange={setHeaderField("terms")} maxLength={5000} />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end gap-3">
        <Link href="/espace-equipe/devis" className={secondaryButton}>
          Annuler
        </Link>
        <button type="submit" disabled={saving} className={primaryButton}>
          {saving ? "Création…" : "Créer le devis (brouillon)"}
        </button>
      </div>
    </form>
  );
}

export default function NouveauDevisPage() {
  return (
    <Suspense fallback={<p className="text-[14px] text-[var(--comexa-ink-soft)]">Chargement…</p>}>
      <Form />
    </Suspense>
  );
}
