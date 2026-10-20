"use client";

import { useMemo, useState } from "react";
import { Landmark, Plus, RefreshCw, RotateCcw, Wallet } from "lucide-react";
import { formatDate, formatMoney, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { useAllListing } from "@/lib/use-all-listing";
import {
  Badge,
  Card,
  Empty,
  Field,
  Notice,
  SkeletonList,
  inputClass,
  primaryButton,
  secondaryButton,
  textareaClass,
} from "@/components/workspace/ui";
import { OPERATION_KINDS, formatAmount, kindLabel } from "./shared";

/**
 * LES SOLDES DES MEMBRES — ce qui a été gagné, ce qui a été versé, ce qui
 * reste dû.
 *
 * DEUX LECTURES, UNE SEULE DONNÉE.
 *
 * L'administration voit le tableau de bord de TOUS les membres, avec des
 * filtres (membre, projet, période, devise, nature). Un membre voit SON
 * relevé, et rien d'autre. Les deux lectures viennent de la même source — le
 * serveur — et le serveur refuse de mélanger les deux.
 *
 * LE FILTRE NE TRONQUE JAMAIS LE SOLDE. Filtrer l'historique par projet
 * restreint les LIGNES affichées ; le solde affiché reste le solde réel du
 * membre. Un solde filtré serait un solde faux, et un solde faux dans une
 * page de paie est un problème, pas une commodité d'affichage.
 *
 * AUCUNE ÉCRITURE NE DISPARAÎT. Un versement erroné se CONTRE-PASSE : la
 * contre-passation s'oppose à lui, porte son motif, son auteur et sa date, et
 * l'opération d'origine reste visible dans l'historique.
 */

/** Le ton d'un badge selon la nature de l'opération. */
const KIND_TONE = {
  SHARE: "success",
  PAYMENT: "info",
  ADVANCE: "warning",
  ADJUSTMENT: "neutral",
  CORRECTION: "danger",
  REGULARIZATION: "info",
};

/** Le montant signé d'une opération, d'après son type. */
function signedAmount(transaction) {
  const amount = Number(transaction.amount);
  if (!Number.isFinite(amount)) return 0;
  return transaction.type === "DEBIT" ? -amount : amount;
}

export default function BalancesView() {
  const { request, user } = useAuth();
  const canReadAny = can(user, "balance:read:any");
  const canManage = can(user, "balance:manage:any");
  const canReadOwn = can(user, "balance:read:own");
  const canReadProjects = can(user, "project:read:any");

  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [filters, setFilters] = useState({
    userId: "",
    projectId: "",
    currency: "",
    kind: "",
    from: "",
    to: "",
  });

  const [form, setForm] = useState({
    userId: "",
    kind: "PAYMENT",
    amount: "",
    currency: "DZD",
    reason: "",
    occurredAt: "",
    reference: "",
    projectId: "",
  });
  const [formError, setFormError] = useState(null);

  // L'annuaire des membres ELIGIBLES : c'est le serveur qui dit qui peut
  // recevoir de l'argent (membre actif de l'équipe, pas un client). La liste
  // proposee et la regle appliquee viennent donc de la meme source.
  const directory = useListing(canReadAny || canManage ? "/balances/eligible-members" : null);
  const projectList = useAllListing(canReadProjects ? "/projects?perPage=100" : null);

  const members = directory.items ?? [];
  const projects = projectList.items ?? [];

  const query = useMemo(() => {
    const parts = [];
    if (filters.userId) parts.push(`userId=${encodeURIComponent(filters.userId)}`);
    if (filters.projectId) parts.push(`projectId=${encodeURIComponent(filters.projectId)}`);
    if (filters.currency) parts.push(`currency=${encodeURIComponent(filters.currency)}`);
    if (filters.kind) parts.push(`kind=${encodeURIComponent(filters.kind)}`);
    if (filters.from) parts.push(`from=${encodeURIComponent(filters.from)}`);
    if (filters.to) parts.push(`to=${encodeURIComponent(filters.to)}`);
    return parts.join("&");
  }, [filters]);

  // L'administration lit le tableau de bord de tous les membres ; un membre ne
  // lit que le sien. Les deux lectures viennent du serveur, qui refuse de
  // les melanger.
  const adminQuery = query ? `?${query}` : "";
  const ownQuery = filters.currency ? `?currency=${encodeURIComponent(filters.currency)}` : "";

  const overview = useListing(
    canReadAny ? `/balances/admin/overview${adminQuery}` : canReadOwn ? `/balances/me/summary${ownQuery}` : null,
  );
  const history = useListing(
    canReadAny
      ? `/balances/admin/transactions${adminQuery ? `${adminQuery}&` : "?"}perPage=50`
      : canReadOwn
        ? `/balances/me/transactions${ownQuery ? `${ownQuery}&` : "?"}perPage=50`
        : null,
  );

  const rows = overview.items ?? [];
  const operations = history.items ?? [];

  const load = () => {
    overview.reload();
    history.reload();
  };

  async function record(event) {
    event.preventDefault();
    setFormError(null);

    if (!form.userId) {
      setFormError("Choisissez le membre concerné.");
      return;
    }
    if (!String(form.amount).trim()) {
      setFormError("Indiquez le montant.");
      return;
    }
    if (form.reason.trim().length < 3) {
      setFormError("Le motif est obligatoire : une écriture financière sans motif n’est pas traçable.");
      return;
    }

    setBusy(true);
    try {
      const { data } = await request("/balances/operations", {
        method: "POST",
        body: {
          userId: form.userId,
          kind: form.kind,
          amount: String(form.amount).replace(",", "."),
          currency: form.currency.toUpperCase(),
          reason: form.reason.trim(),
          occurredAt: form.occurredAt ? new Date(form.occurredAt).toISOString() : undefined,
          reference: form.reference.trim() || undefined,
          projectId: form.projectId || undefined,
        },
      });
      setNotice(data?.message ?? "Opération enregistrée.");
      setForm((prev) => ({ ...prev, amount: "", reason: "", reference: "" }));
      setShowForm(false);
      load();
    } catch (caught) {
      setFormError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function reverse(operation) {
    const reason = window.prompt(
      `Contre-passer « ${operation.description || kindLabel(operation.kind)} » ?\n\nLe motif est obligatoire : l’opération d’origine reste visible, et cette écriture s’y oppose.`,
    );
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      const { data } = await request(`/balances/transactions/${operation.id}/reverse`, {
        method: "POST",
        body: { reason: reason.trim() },
      });
      setNotice(data?.message ?? "Opération contre-passée.");
      load();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!canReadAny && !canReadOwn) {
    return (
      <Notice tone="info">
        Les soldes sont reserved aux membres de l’équipe. Si vous pensez avoir accès à votre relevé, contactez
        l’administration.
      </Notice>
    );
  }

  const memberName = (id, fallback = null) => {
    const member = members.find((entry) => entry.id === id);
    if (member) return `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() || member.email;
    if (fallback) {
      const label = `${fallback.firstName ?? ""} ${fallback.lastName ?? ""}`.trim();
      if (label) return label;
      if (fallback.email) return fallback.email;
    }
    return id ? "—" : "";
  };

  return (
    <div className="flex flex-col gap-5">
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
      {overview.error ? <Notice>{overview.error}</Notice> : null}
      {history.error ? <Notice>{history.error}</Notice> : null}

      {canReadAny ? (
        <Card
          title="Filtres"
          subtitle="Les filtres portent sur l’historique. Le solde affiché reste le solde réel du membre, jamais une somme filtrée."
          action={
            <button type="button" className={secondaryButton} onClick={load} disabled={overview.loading}>
              <RefreshCw size={15} strokeWidth={1.9} className={overview.loading ? "sui-spin" : ""} aria-hidden="true" />
              Actualiser
            </button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Field id="filter-user" label="Membre">
              <select
                id="filter-user"
                className={inputClass}
                value={filters.userId}
                onChange={(event) => setFilters({ ...filters, userId: event.target.value })}
              >
                <option value="">Tous les membres</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {`${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() || member.email}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="filter-project" label="Projet">
              <select
                id="filter-project"
                className={inputClass}
                value={filters.projectId}
                onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}
              >
                <option value="">Tous les projets</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="filter-currency" label="Devise">
              <select
                id="filter-currency"
                className={inputClass}
                value={filters.currency}
                onChange={(event) => setFilters({ ...filters, currency: event.target.value })}
              >
                <option value="">Toutes les devises</option>
                <option value="DZD">DZD</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </select>
            </Field>

            <Field id="filter-kind" label="Nature d’opération">
              <select
                id="filter-kind"
                className={inputClass}
                value={filters.kind}
                onChange={(event) => setFilters({ ...filters, kind: event.target.value })}
              >
                <option value="">Toutes les natures</option>
                {OPERATION_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
                <option value="SHARE">Part de répartition</option>
              </select>
            </Field>

            <Field id="filter-from" label="Depuis">
              <input
                id="filter-from"
                type="date"
                className={inputClass}
                value={filters.from}
                onChange={(event) => setFilters({ ...filters, from: event.target.value })}
              />
            </Field>

            <Field id="filter-to" label="Jusqu’au">
              <input
                id="filter-to"
                type="date"
                className={inputClass}
                value={filters.to}
                onChange={(event) => setFilters({ ...filters, to: event.target.value })}
              />
            </Field>
          </div>
        </Card>
      ) : null}

      <Card
        title={canReadAny ? "Soldes des membres" : "Mon relevé"}
        subtitle={
          canReadAny
            ? "Part accumulée, versements, avances, ajustements et reste dû — par devise, sans conversion implicite."
            : "Ce que vous avez gagné, ce qui vous a été versé, et ce qui reste dû."
        }
        action={
          canManage ? (
            <button type="button" className={primaryButton} onClick={() => setShowForm((value) => !value)}>
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
              {showForm ? "Masquer le formulaire" : "Enregistrer une opération"}
            </button>
          ) : null
        }
      >
        {showForm && canManage ? (
          <form onSubmit={record} className="mb-5 flex flex-col gap-4 rounded-[18px] border border-[var(--line-soft)] bg-[var(--surface)] p-4">
            {formError ? <Notice>{formError}</Notice> : null}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Field id="op-user" label="Membre">
                <select
                  id="op-user"
                  className={inputClass}
                  value={form.userId}
                  onChange={(event) => setForm({ ...form, userId: event.target.value })}
                >
                  <option value="">Choisir un membre…</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {`${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() || member.email}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="op-kind" label="Nature" hint={OPERATION_KINDS.find((kind) => kind.value === form.kind)?.hint}>
                <select
                  id="op-kind"
                  className={inputClass}
                  value={form.kind}
                  onChange={(event) => setForm({ ...form, kind: event.target.value })}
                >
                  {OPERATION_KINDS.filter((kind) => kind.value !== "CORRECTION").map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="op-amount" label="Montant" hint="Positif ou négatif, selon la nature.">
                <input
                  id="op-amount"
                  className={inputClass}
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(event) => setForm({ ...form, amount: event.target.value })}
                  placeholder="50000"
                />
              </Field>

              <Field id="op-currency" label="Devise">
                <input
                  id="op-currency"
                  className={inputClass}
                  maxLength={3}
                  value={form.currency}
                  onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
                />
              </Field>

              <Field id="op-date" label="Date d’effet" hint="Facultative : par défaut, aujourd’hui.">
                <input
                  id="op-date"
                  type="date"
                  className={inputClass}
                  value={form.occurredAt}
                  onChange={(event) => setForm({ ...form, occurredAt: event.target.value })}
                />
              </Field>

              <Field id="op-reference" label="Référence" hint="Facultative.">
                <input
                  id="op-reference"
                  className={inputClass}
                  value={form.reference}
                  onChange={(event) => setForm({ ...form, reference: event.target.value })}
                  placeholder="VIR-2026-014"
                />
              </Field>
            </div>

            <Field id="op-reason" label="Motif" hint="Obligatoire : il explique l’écriture et la rend traçable.">
              <textarea
                id="op-reason"
                className={textareaClass}
                rows={2}
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
                placeholder="Virement de solde — octobre"
              />
            </Field>

            <div>
              <button type="submit" className={primaryButton} disabled={busy}>
                {busy ? "Enregistrement…" : "Enregistrer l’opération"}
              </button>
            </div>
          </form>
        ) : null}

        {overview.loading && overview.items === null ? (
          <SkeletonList rows={3} />
        ) : rows.length === 0 ? (
          <Empty icon={Wallet}>Aucun solde pour l’instant.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="sui-table" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th>Membre</th>
                  <th>Devise</th>
                  <th className="is-end">Part accumulée</th>
                  <th className="is-end">Versements</th>
                  <th className="is-end">Avances</th>
                  <th className="is-end">Ajustements</th>
                  <th className="is-end">Reste dû</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.userId}-${row.currency}`}>
                    <td>
                      <span className="sui-table__primary">
                        <strong>{canReadAny ? memberName(row.userId) : "Moi"}</strong>
                        <span>{row.transactionCount} opération(s)</span>
                      </span>
                    </td>
                    <td data-label="Devise">{row.currency}</td>
                    <td className="is-end" data-label="Part accumulée">{formatAmount(row.accrued)}</td>
                    <td className="is-end" data-label="Versements">{formatAmount(row.paid)}</td>
                    <td className="is-end" data-label="Avances">{formatAmount(row.advances)}</td>
                    <td className="is-end" data-label="Ajustements">{formatAmount(row.adjustments)}</td>
                    <td className="is-end" data-label="Reste dû">
                      <span className={Number(row.remaining) < 0 ? "sui-amount sui-amount--down" : "sui-amount sui-amount--up"}>
                        {formatAmount(row.remaining)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Historique des opérations"
        subtitle="Chaque écriture porte son auteur, sa date et son motif. Une opération validée se contre-passe, elle ne s’efface jamais."
      >
        {history.loading && history.items === null ? (
          <SkeletonList rows={4} />
        ) : operations.length === 0 ? (
          <Empty icon={Landmark}>Aucune opération enregistrée.</Empty>
        ) : (
          <ul className="sui-lines sui-lines--rows">
            {operations.map((operation) => {
              const amount = signedAmount(operation);
              const positif = amount >= 0;
              return (
                <li key={operation.id}>
                  <span
                    className="sui-lines__icon"
                    style={{ "--tone-bg": positif ? "var(--green)" : "var(--pink)" }}
                    aria-hidden="true"
                  >
                    <Landmark size={15} strokeWidth={1.75} />
                  </span>
                  <span className="sui-lines__copy">
                    <strong>{operation.description || kindLabel(operation.kind)}</strong>
                    <span>
                      {formatDate(operation.occurredAt ?? operation.createdAt)}
                      {operation.reference ? ` · ${operation.reference}` : ""}
                      {operation.reversalOfId ? " · contre-passation" : ""}
                      {operation.authorId
                        ? ` · par ${memberName(operation.authorId, operation.author)}`
                        : ""}
                    </span>
                  </span>
                  <span className="sui-lines__end">
                    <Badge tone={KIND_TONE[operation.kind] ?? "neutral"}>{kindLabel(operation.kind)}</Badge>
                    <span className={positif ? "sui-amount sui-amount--up" : "sui-amount sui-amount--down"}>
                      {positif ? "+" : "−"}
                      {formatMoney(Math.abs(amount), operation.currency)}
                    </span>
                    {canManage && !operation.reversalOfId ? (
                      <button
                        type="button"
                        className="sui-btn sui-btn--sm sui-btn--ghost"
                        onClick={() => reverse(operation)}
                        disabled={busy}
                      >
                        <RotateCcw size={13} strokeWidth={2} aria-hidden="true" /> Contre-passer
                      </button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
