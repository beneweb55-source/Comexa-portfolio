"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate, formatMoney, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { Badge, Card, Empty, Notice, Skeleton } from "@/components/workspace/ui";

/**
 * SOLDE — ce que l'agence doit au membre, par devise.
 *
 * Le solde vit cote serveur (`/balances/me/all`) : il n'est jamais recalcule
 * dans le navigateur, qui ne fait qu'afficher la valeur renvoyee. Un solde
 * absent n'est pas un solde nul : la carte affiche alors qu'aucun solde n'a
 * encore ete enregistre, plutot que « 0,00 DZD » qui ferait croire a une
 * erreur de calcul.
 *
 * La carte n'apparait QUE pour un porteur qui detient `balance:read:own` : un
 * compte client n'a pas de solde, et la recharche ne doit pas laisser une
 * carte vide derriere elle.
 */

/** Un mouvement de solde : son libelle, son signe, et le ton de son badge. */
const MOVEMENTS = {
  CREDIT: { label: "Credit", tone: "success" },
  DEBIT: { label: "Debit", tone: "danger" },
  CORRECTION: { label: "Correction", tone: "warning" },
};

/**
 * Montant signe d'un mouvement.
 *
 * `CREDIT` ajoute, `DEBIT` retire, `CORRECTION` peut aller dans les deux sens :
 * c'est l'ecart entre l'ancien et le nouveau solde qui tranche, jamais le
 * type seul.
 */
function signedAmount(transaction) {
  const amount = Number(transaction.amount);
  if (!Number.isFinite(amount)) return 0;
  if (transaction.type === "CREDIT") return amount;
  if (transaction.type === "DEBIT") return -amount;
  const delta = Number(transaction.newBalance) - Number(transaction.previousBalance);
  if (Number.isFinite(delta) && delta !== 0) return delta;
  return -amount;
}

export default function BalancePanel() {
  const { request, user } = useAuth();
  // `balances === null` signifie « pas encore repondu » : l'etat de chargement
  // est celui de la donnee, pas un etat a part qui pourrait diverger d'elle.
  const [balances, setBalances] = useState(null);
  const [transactions, setTransactions] = useState(null);
  const [error, setError] = useState(null);

  const allowed = can(user, "balance:read:own");

  const load = useCallback(() => {
    if (!allowed) return;
    // Le solde d'abord : c'est l'information principale. L'historique ne
    // doit pas pouvoir masquer un solde lisible.
    request("/balances/me/all")
      .then(({ data: soldes }) => {
        setBalances(Array.isArray(soldes) ? soldes : []);
        return request("/balances/me/transactions?perPage=5")
          .then(({ data: mouvements }) => {
            setTransactions(Array.isArray(mouvements) ? mouvements : []);
          })
          .catch(() => {
            // L'historique est un bonus : son absence ne doit pas casser la carte.
            setTransactions([]);
          });
      })
      .catch((caught) => {
        setError(messageOf(caught));
        setBalances([]);
      });
  }, [allowed, request]);

  useEffect(() => {
    load();
  }, [load]);

  if (!allowed) return null;

  const loading = balances === null;
  const soldes = balances ?? [];
  const mouvements = transactions ?? [];

  return (
    <Card title="Mon solde" subtitle="Ce que Comexa vous doit, par devise.">
      {error ? <Notice>{error}</Notice> : null}

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      ) : null}

      {!loading && !error && soldes.length === 0 ? (
        <Empty>Aucun solde enregistre pour le moment.</Empty>
      ) : null}

      {!loading && soldes.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {soldes.map((solde) => (
            <li
              key={solde.id ?? solde.currency}
              className="rounded-2xl border border-[var(--comexa-border-soft)] bg-white/70 p-4"
            >
              <p className="cx-label">{solde.currency}</p>
              <p className="cx-h2 mt-1 text-[var(--comexa-ink)]">
                {formatMoney(solde.currentBalance, solde.currency)}
              </p>
              <p className="cx-small mt-1">
                {solde.lastUpdatedAt
                  ? `Mis a jour le ${formatDate(solde.lastUpdatedAt)}`
                  : "Aucun mouvement enregistre"}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && mouvements.length > 0 ? (
        <div className="mt-5">
          <p className="cx-label">Derniers mouvements</p>
          <ul className="mt-2 flex flex-col divide-y divide-[var(--comexa-border-soft)]">
            {mouvements.map((transaction) => {
              const mouvement = MOVEMENTS[transaction.type] ?? {
                label: transaction.type ?? "Mouvement",
                tone: "neutral",
              };
              const amount = signedAmount(transaction);
              const positif = amount >= 0;
              return (
                <li key={transaction.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] text-[var(--comexa-ink)]">
                      {transaction.description || mouvement.label}
                    </p>
                    <p className="cx-small">
                      {formatDate(transaction.createdAt)}
                      {transaction.reference ? ` · ${transaction.reference}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={mouvement.tone}>{mouvement.label}</Badge>
                    <span
                      className={`cx-tabular text-[14.5px] font-medium ${
                        positif ? "text-[var(--comexa-success)]" : "text-[var(--comexa-error)]"
                      }`}
                    >
                      {positif ? "+" : "-"}
                      {formatMoney(Math.abs(amount), transaction.currency)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
