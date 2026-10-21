"use client";

/*
 * AFFICHAGE D'UN TOTAL MULTI-DEVISES.
 *
 * `amounts` est une liste de couples (devise, montant) — jamais un nombre seul,
 * qui ne saurait plus dans quelle monnaie il est libellé. Selon la portée :
 *
 *   - « DZD » : une valeur, en dinars (0,00 DA s'il n'y a rien) ;
 *   - « EUR » : une valeur, en euros ;
 *   - « ALL » : chaque devise sur la même ligne, séparée par un point médian.
 *
 * Les montants ne sont jamais additionnés entre devises : c'est tout l'intérêt
 * de la liste. Le composant est volontairement sans état, pour être utilisable
 * aussi bien dans une carte KPI que dans un tableau de bord ou une synthèse.
 */

import { DEFAULT_CURRENCY, amountsInScope, formatMoney } from "@/lib/currency";

export default function CurrencyAmounts({ amounts, scope = DEFAULT_CURRENCY, empty = "—", className = "" }) {
  const list = amountsInScope(amounts, scope);

  if (list.length === 0) {
    return <span className={className}>{empty}</span>;
  }

  return (
    <span className={`sui-amounts ${className}`.trim()}>
      {list.map((amount, index) => (
        <span key={amount.currency} className="sui-amounts__item">
          {index > 0 ? (
            <span className="sui-amounts__sep" aria-hidden="true">
              ·
            </span>
          ) : null}
          {formatMoney(amount.total, amount.currency)}
        </span>
      ))}
    </span>
  );
}
