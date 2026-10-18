"use client";

import { useCallback, useEffect, useState } from "react";
import { Landmark, RefreshCw } from "lucide-react";
import { formatDate, formatMoney, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { Badge, Card, Empty, Notice, Skeleton, secondaryButton } from "@/components/workspace/ui";

/**
 * SOLDE — ce que l'agence doit au membre, par devise.
 *
 * Présenté comme un COMPTE BANCAIRE : la carte bleue du solde principal
 * (carte à puce, numéro de compte masqué, titulaire), les autres devises en
 * minis cartes, puis un relevé des dernières opérations.
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

/** Derniers caractères d'un identifiant, pour le numéro de compte masqué. */
function accountSuffix(id) {
  const value = String(id ?? "");
  return (value.slice(-4) || "0000").toLocaleUpperCase("fr-FR");
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
        return request("/balances/me/transactions?perPage=8")
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

  // Carte principale : la devise DZD en priorité, sinon la première enregistrée.
  const principal = soldes.find((solde) => String(solde.currency).toLocaleUpperCase("fr-FR") === "DZD") ?? soldes[0] ?? null;
  const autres = soldes.filter((solde) => solde !== principal);
  const titulaire = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();

  return (
    <Card
      title="Mon compte"
      subtitle="Votre solde chez Comexa, comme un compte bancaire, par devise."
      action={
        <button type="button" className={secondaryButton} onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden="true" /> Actualiser
        </button>
      }
    >
      {error ? <Notice>{error}</Notice> : null}

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[188px] w-full rounded-[22px]" />
          <Skeleton className="h-4 w-72" />
        </div>
      ) : null}

      {!loading && !error && soldes.length === 0 ? (
        <Empty icon={Landmark}>Aucun solde enregistre pour le moment.</Empty>
      ) : null}

      {!loading && principal ? (
        <div className="flex flex-col gap-4">
          {/* La carte bleue : solde principal, carte à puce, titulaire. */}
          <div className="cx-bank">
            <div className="cx-bank__top">
              <div>
                <p className="cx-bank__label">Solde disponible</p>
                <p className="cx-bank__amount">{formatMoney(principal.currentBalance, principal.currency)}</p>
                <p className="cx-bank__meta">
                  {principal.currency}
                  {principal.lastUpdatedAt ? ` · Mis a jour le ${formatDate(principal.lastUpdatedAt)}` : " · Aucun mouvement enregistre"}
                </p>
              </div>
              <span className="cx-bank__brand">
                <Landmark size={18} strokeWidth={1.9} aria-hidden="true" />
                Comexa
              </span>
            </div>

            <div className="cx-bank__chiprow">
              <span className="cx-bank__chip" aria-hidden="true" />
              <span className="cx-bank__number" aria-label={`Compte numero **** ${accountSuffix(user?.id)}`}>
                •••• •••• •••• {accountSuffix(user?.id)}
              </span>
            </div>

            <div className="cx-bank__foot">
              <div>
                <p className="cx-bank__label">Titulaire</p>
                <p className="cx-bank__holder">{titulaire || user?.email || "Membre Comexa"}</p>
              </div>
              <div className="text-right">
                <p className="cx-bank__label">Devise</p>
                <p className="cx-bank__holder">{principal.currency}</p>
              </div>
            </div>
          </div>

          {/* Autres devises : minis cartes, comme une banque multi-devises. */}
          {autres.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {autres.map((solde) => (
                <li key={solde.id ?? solde.currency} className="cx-bank-mini">
                  <span className="cx-bank-mini__currency">
                    <span className="cx-bank-mini__dot" aria-hidden="true" />
                    {solde.currency}
                  </span>
                  <span className="cx-bank-mini__amount">{formatMoney(solde.currentBalance, solde.currency)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Relevé d'opérations : les derniers mouvements du compte. */}
      {!loading && mouvements.length > 0 ? (
        <div className="mt-6">
          <div className="flex items-baseline justify-between gap-3">
            <p className="cx-label">Relevé d’opérations</p>
            <p className="cx-small">Derniers mouvements</p>
          </div>
          <ul className="cx-statement mt-2">
            {mouvements.map((transaction) => {
              const mouvement = MOVEMENTS[transaction.type] ?? {
                label: transaction.type ?? "Mouvement",
                tone: "neutral",
              };
              const amount = signedAmount(transaction);
              const positif = amount >= 0;
              return (
                <li key={transaction.id} className="cx-statement__row">
                  <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <span className="cx-statement__date">{formatDate(transaction.createdAt)}</span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-[var(--comexa-ink)]">
                        {transaction.description || mouvement.label}
                      </p>
                      {transaction.reference ? (
                        <p className="cx-small font-mono text-[11.5px]">{transaction.reference}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={mouvement.tone}>{mouvement.label}</Badge>
                    <span
                      className={`cx-statement__amount ${positif ? "text-[var(--comexa-success)]" : "text-[var(--comexa-error)]"}`}
                    >
                      {positif ? "+" : "−"}
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
