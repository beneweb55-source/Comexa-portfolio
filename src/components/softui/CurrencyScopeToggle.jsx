"use client";

/*
 * SÉLECTEUR « DA / EUR / les deux ».
 *
 * Il ne convertit AUCUN montant : il choisit la ou les devises dont les totaux
 * sont additionnés et affichés. C'est la différence entre « voir mon chiffre
 * d'affaires en dinars » et « voir 1 200 000 DA + 8 400 € en même temps ».
 * Aucun total commun n'est fabriqué, puisque additionner deux monnaies ne
 * donnerait aucun nombre qui corresponde à quelque chose.
 *
 * La préférence est partagée par tous les écrans (voir
 * `lib/use-display-currency.js`) : la changer sur les factures change aussi le
 * tableau de bord.
 */

import { Coins } from "lucide-react";
import { Pill } from "./primitives";
import { useCurrencyScope } from "@/lib/use-display-currency";

export default function CurrencyScopeToggle({
  available = [],
  label = "Devise d’affichage",
  className = "",
  onScopeChange,
}) {
  const { scope, setScope, options } = useCurrencyScope(available);

  function choose(next) {
    setScope(next);
    onScopeChange?.(next);
  }

  return (
    <div className={`sui-scope ${className}`.trim()} role="group" aria-label={label}>
      <span className="sui-scope__label">
        <Coins size={15} strokeWidth={1.75} aria-hidden="true" />
        {label}
      </span>
      <ul className="sui-filters" role="list">
        {options.map((option) => (
          <li key={option.id}>
            <Pill active={scope === option.id} onClick={() => choose(option.id)}>
              {option.label}
            </Pill>
          </li>
        ))}
      </ul>
    </div>
  );
}
