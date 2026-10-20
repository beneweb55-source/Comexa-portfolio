"use client";

import { useState } from "react";
import { Calculator, CheckCircle2, History, PlayCircle, RefreshCw } from "lucide-react";
import { formatDate, formatMoney, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { useAllListing } from "@/lib/use-all-listing";
import {
  Badge,
  Card,
  Empty,
  Notice,
  SkeletonList,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/workspace/ui";
import { baseLabel, formatAmount, formatPercent } from "./shared";

/**
 * LE CALCUL D'UNE RÉPARTITION — la base, les parts, la trace.
 *
 * CE QUE CET ÉCRAN DOIT PROUVER, À CHAQUE PROJECTION :
 *
 *  - DE QUOI on répartit. Le budget, le facturé et l'encaissé sont affichés
 *    ENSEMBLE, parce que la confusion entre les deux est la source d'erreur
 *    la plus fréquente : une facture émise n'est pas de l'argent encaissé.
 *
 *  - AVEC QUELLE RÈGLE. Son nom, sa version, son périmètre. Une répartition
 *    calculée avec une règle périmée n'a pas le même sens qu'une autre.
 *
 *  - COMMENT le montant a été arrondi. Chaque part porte sa trace : le brut,
 *    le plancher au centime, le reste et l'ajustement. Une répartition que
 *    l'on ne sait pas justifier est une répartition que l'on ne peut pas
 *    faire confiance.
 *
 *  - CE QUI A DÉJÀ ÉTÉ FAIT. Chaque tour de répartition garde sa règle et son
 *    statut : un changement de règle ne réécrit pas le passé.
 */

const STATUS_TONE = {
  CALCULATED: "warning",
  APPLIED: "success",
  PENDING: "neutral",
  CANCELLED: "neutral",
};

export default function CalcView() {
  const { request, user } = useAuth();
  const canRead = can(user, "distribution:read:any") || can(user, "distribution:manage:any");
  const canManage = can(user, "distribution:manage:any");
  const canReadProjects = can(user, "project:read:any") || can(user, "project:read:assigned");

  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const projects = useAllListing(canReadProjects ? "/projects?perPage=100" : null);

  // Le projet retenu est le premier de la liste tant que l'utilisateur n'en
  // a pas choisi un autre.
  const projectList = projects.items ?? [];
  const selected = projectId || projectList[0]?.id || "";
  const project = projectList.find((entry) => entry.id === selected);

  const base = useListing(selected && canRead ? `/distributions/projects/${encodeURIComponent(selected)}/base` : null);
  const rounds = useListing(selected && canRead ? `/distributions/projects/${encodeURIComponent(selected)}` : null);

  async function calculate() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await request(
        `/distributions/projects/${encodeURIComponent(selected)}/calculate`,
        { method: "POST", body: {} },
      );
      const already = data?.status === "APPLIED" ? " (déjà calculée)" : "";
      setNotice(
        data?.message ??
          `Répartition calculée sur ${formatAmount(data?.baseAmount)} ${data?.baseCurrency ?? ""}${already}.`,
      );
      base.reload();
      rounds.reload();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function apply(distribution) {
    setBusy(true);
    setError(null);
    try {
      const { data } = await request(`/distributions/${distribution.id}/apply`, { method: "POST" });
      setNotice(data?.message ?? "Répartition appliquée : les soldes sont à jour.");
      base.reload();
      rounds.reload();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!canRead) {
    return (
      <Notice tone="info">
        Le calcul des répartitions est réservé à l’encadrement. Votre solde personnel reste visible dans
        l’onglet « Soldes ».
      </Notice>
    );
  }

  const details = base.items ?? null;
  const list = rounds.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
      {projects.error ? <Notice>{projects.error}</Notice> : null}
      {base.error ? <Notice>{base.error}</Notice> : null}
      {rounds.error ? <Notice>{rounds.error}</Notice> : null}

      <Card
        title="Projet à répartir"
        subtitle="La répartition se calcule sur une base précise : encaissé, facturé ou budget. L’écran montre les trois, pour qu’aucune confusion ne soit possible."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                base.reload();
                rounds.reload();
              }}
              disabled={!selected}
            >
              <RefreshCw size={15} strokeWidth={1.9} className={rounds.loading ? "sui-spin" : ""} aria-hidden="true" />
              Actualiser
            </button>
            {canManage ? (
              <button type="button" className={primaryButton} onClick={calculate} disabled={busy || !selected}>
                <PlayCircle size={15} strokeWidth={2} aria-hidden="true" />
                {busy ? "Calcul…" : "Calculer la répartition"}
              </button>
            ) : null}
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="sui-field__label" htmlFor="calc-project">
              Projet
            </label>
            <select
              id="calc-project"
              className={inputClass}
              value={selected}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">Choisir un projet…</option>
              {projectList.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>

          {details ? (
            <div className="grid grid-cols-3 gap-3">
              <Figure label="Budget" value={formatAmount(details.budget)} currency={details.currency} />
              <Figure label="Facturé" value={formatAmount(details.invoiced)} currency={details.currency} />
              <Figure
                label="Encaissé"
                value={formatAmount(details.collected)}
                currency={details.currency}
                tone="green"
              />
            </div>
          ) : null}
        </div>

        {details ? (
          <p className="mt-4 text-[12.5px] text-[var(--muted)]">
            {details.invoiceCount} facture(s) prise(s) en compte · {details.paymentCount} encaissement(s) réussi(s) ·
            devise {details.currency} — sans conversion automatique.
            {details.ruleName
              ? ` Règle applicable : ${details.ruleName} (version ${details.ruleVersion}${
                  details.ruleScope && details.ruleScope !== "global" ? ", exception de projet" : ", règle par défaut"
                }).`
              : " Aucune règle applicable : le calcul sera refusé."}
          </p>
        ) : null}
      </Card>

      <Card
        title="Tours de répartition"
        subtitle="Chaque tour garde la règle qui l’a produit, la base d’origine et la trace de l’arrondi. Une répartition appliquée n’est jamais réécrite."
      >
        {rounds.loading && rounds.items === null ? (
          <SkeletonList rows={3} />
        ) : list.length === 0 ? (
          <Empty icon={Calculator}>
            Aucune répartition calculée pour ce projet. Lancez un calcul pour en créer une.
          </Empty>
        ) : (
          <ul className="flex flex-col gap-4">
            {list.map((round) => (
              <RoundCard
                key={round.id}
                round={round}
                canManage={canManage}
                busy={busy}
                onApply={() => apply(round)}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Une figure : un montant, sa devise, un ton. */
function Figure({ label, value, currency, tone }) {
  return (
    <div
      className="rounded-[16px] border border-[var(--line-soft)] p-3"
      style={tone === "green" ? { background: "var(--green)" } : { background: "var(--surface)" }}
    >
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="sui-tabular mt-1 text-[15px] font-semibold text-[var(--ink)]">{value}</p>
      <p className="text-[11px] text-[var(--muted)]">{currency}</p>
    </div>
  );
}

/** La carte d'un tour : les parts, la trace, l'action d'application. */
function RoundCard({ round, canManage, busy, onApply }) {
  const trace = round.calculationTrace ?? null;
  const rows = round.items ?? [];
  const total = rows.reduce((sum, row) => sum + Number(row.calculatedAmount ?? 0), 0);

  return (
    <li className="rounded-[18px] border border-[var(--line-soft)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-tight text-[var(--ink)]">
            Tour {round.round} · {formatAmount(round.baseAmount)} {round.baseCurrency}
          </p>
          <p className="text-[12.5px] text-[var(--muted)]">
            {baseLabel(round.baseType)} · règle version {round.ruleVersion ?? "—"} · calculé le{" "}
            {formatDate(round.calculatedAt)}
            {round.appliedAt ? ` · appliqué le ${formatDate(round.appliedAt)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[round.status] ?? "neutral"}>
            {round.status === "APPLIED" ? "Appliquée" : round.status === "CALCULATED" ? "Calculée" : round.status}
          </Badge>
          {canManage && round.status === "CALCULATED" ? (
            <button type="button" className={primaryButton} onClick={onApply} disabled={busy}>
              <CheckCircle2 size={15} strokeWidth={2} aria-hidden="true" /> Appliquer
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="sui-table" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th>Bénéficiaire</th>
              <th className="is-end">%</th>
              <th className="is-end">Montant</th>
              <th className="is-end">Arrondi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const itemTrace = row.trace ?? null;
              return (
                <tr key={row.id}>
                  <td>
                    <span className="sui-table__primary">
                      <strong>{row.beneficiary?.name ?? "—"}</strong>
                      <span>
                        {row.beneficiary?.userId ? "Membre de l’équipe" : "Suivi seul (sans solde)"}
                      </span>
                    </span>
                  </td>
                  <td className="is-end" data-label="%">{formatPercent(row.percentage)}</td>
                  <td className="is-end" data-label="Montant">{formatAmount(row.calculatedAmount)}</td>
                  <td className="is-end" data-label="Arrondi">
                    {itemTrace ? (
                      <span
                        className="sui-tabular text-[12px] text-[var(--muted)]"
                        title={`Brut ${itemTrace.raw} · plancher ${itemTrace.floor} · reste ${itemTrace.remainder} · ajustement ${itemTrace.adjustment}`}
                      >
                        {itemTrace.adjustment && Number(itemTrace.adjustment) !== 0
                          ? `+${formatAmount(itemTrace.adjustment)}`
                          : "exact"}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td>
                <span className="sui-table__primary">
                  <strong>Total réparti</strong>
                  <span>{trace ? "Trace : plus grand reste, au centime" : ""}</span>
                </span>
              </td>
              <td className="is-end" data-label="%">100,00 %</td>
              <td className="is-end" data-label="Montant">{formatAmount(total)}</td>
              <td className="is-end" data-label="Arrondi">
                {trace ? (
                  <span className="sui-tabular text-[12px] text-[var(--muted)]">
                    {formatAmount(trace.total)} = base
                  </span>
                ) : null}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {trace ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-[var(--muted)]">
            <History size={13} strokeWidth={2} className="mr-1 inline" aria-hidden="true" />
            Voir la trace complète de l’arrondi
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-[12px] text-[var(--muted)]">
            {(trace.results ?? []).map((row) => (
              <li key={row.key} className="sui-tabular">
                {row.key} · brut {row.raw} · plancher {row.floor} · reste {row.remainder} · ajustement{" "}
                {row.adjustment} → {row.amount}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}
