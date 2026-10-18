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
 * Présenté comme un COMPTE BANCAIRE : la carte pastel du solde principal
 * (badge « Solde disponible », montant en très grand, devise et date de mise à
 * jour), les autres devises en lignes compactes, puis un relevé des dernières
 * opérations.
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
 *
 * Habillage : design system « soft UI pastel dans une coque noire » — la carte
 * du solde principal reprend exactement la carte KPI du tableau de bord.
 */

/** Un mouvement de solde : son libellé, son signe, et le ton de son badge. */
const MOVEMENTS = {
  CREDIT: { label: "Crédit", tone: "success" },
  DEBIT: { label: "Débit", tone: "danger" },
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
      title="Mon solde"
      subtitle="Ce que Comexa vous doit, par devise — comme un compte bancaire."
      action={
        <button type="button" className={secondaryButton} onClick={load} disabled={loading}>
          <RefreshCw size={15} strokeWidth={1.9} className={loading ? "sui-spin" : ""} aria-hidden="true" /> Actualiser
        </button>
      }
    >
      {error ? <Notice>{error}</Notice> : null}

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[168px] w-full rounded-[28px]" />
          <Skeleton className="h-4 w-72" />
        </div>
      ) : null}

      {!loading && !error && soldes.length === 0 ? (
        <Empty icon={Landmark}>Aucun solde enregistré pour le moment.</Empty>
      ) : null}

      {!loading && principal ? (
        <div className="flex flex-col gap-4">
          {/* La carte pastel du solde principal : même gabarit que les cartes
              KPI du tableau de bord (rayon 28, badge, valeur en très grand). */}
          <article className="sui-kpi" style={{ "--tone-bg": "var(--blue)" }}>
            <div className="sui-kpi__top">
              <span className="sui-kpi__badge">Solde disponible</span>
              <span className="sui-kpi__deco" aria-hidden="true">
                <Landmark size={20} strokeWidth={1.75} />
              </span>
            </div>
            <p className="sui-kpi__value">{formatMoney(principal.currentBalance, principal.currency)}</p>
            <p className="sui-kpi__label">
              Compte n° •••• {accountSuffix(user?.id)} · {principal.currency}
              {principal.lastUpdatedAt ? ` · mis à jour le ${formatDate(principal.lastUpdatedAt)}` : " · aucun mouvement enregistré"}
            </p>
            <p className="sui-kpi__label">
              Titulaire : {titulaire || user?.email || "Membre Comexa"}
            </p>
          </article>

          {/* Autres devises : lignes compactes, comme une banque multi-devises. */}
          {autres.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {autres.map((solde) => (
                <li key={solde.id ?? solde.currency} className="sui-bank-mini">
                  <span className="sui-bank-mini__currency">
                    <span className="sui-bank-mini__dot" aria-hidden="true" />
                    {solde.currency}
                  </span>
                  <span className="sui-bank-mini__amount">{formatMoney(solde.currentBalance, solde.currency)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Relevé d'opérations : les derniers mouvements du compte. */}
      {!loading && mouvements.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="sui-section__head">
            <h4 className="sui-section__title">Relevé d’opérations</h4>
            <span className="sui-section__count">{mouvements.length}</span>
          </div>
          <ul className="sui-lines sui-lines--rows">
            {mouvements.map((transaction) => {
              const mouvement = MOVEMENTS[transaction.type] ?? {
                label: transaction.type ?? "Mouvement",
                tone: "neutral",
              };
              const amount = signedAmount(transaction);
              const positif = amount >= 0;
              return (
                <li key={transaction.id}>
                  <span className="sui-lines__icon" style={{ "--tone-bg": positif ? "var(--green)" : "var(--pink)" }} aria-hidden="true">
                    <Landmark size={15} strokeWidth={1.75} />
                  </span>
                  <span className="sui-lines__copy">
                    <strong>{transaction.description || mouvement.label}</strong>
                    <span>
                      {formatDate(transaction.createdAt)}
                      {transaction.reference ? ` · ${transaction.reference}` : ""}
                    </span>
                  </span>
                  <span className="sui-lines__end">
                    <Badge tone={mouvement.tone}>{mouvement.label}</Badge>
                    <span className={positif ? "sui-amount sui-amount--up" : "sui-amount sui-amount--down"}>
                      {positif ? "+" : "−"}
                      {formatMoney(Math.abs(amount), transaction.currency)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
