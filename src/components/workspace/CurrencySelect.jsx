"use client";

/*
 * Sélecteur de devise — DA d'abord, parce que le marché principal est l'Algérie.
 *
 * POURQUOI UN COMPOSANT ET PAS TROIS `<select>` COPIÉS. Le champ `currency` est
 * une chaîne libre dans le schéma (`VarChar(3)`) : rien n'empêchait de taper
 * « eu », « Euros » ou « dinar », et la base acceptait tout. Les montants
 * partaient ensuite dans `Intl.NumberFormat` avec un code invalide, qui
 * renvoyait le repli « 1200.00 eu » — un affichage faux, sans erreur.
 *
 * La liste est donc FERMÉE. Deux listes, en fait, parce que deux règles
 * coexistent et les confondre serait une erreur :
 *
 *   - LES DOCUMENTS (devis, projet, supplément) : DA ou EUR. C'est un humain qui
 *     choisit, et il facture dans l'une des deux.
 *   - LES TARIFS PUBLICS (prix de départ des services) : DA, EUR ou USD. Le
 *     site vitrine annonce des prix et peut vouloir le dollar.
 *
 * Le libellé porte le nom complet de la devise pour que « DA » ne se confonde
 * pas avec une autre abréviation ; le code reste la valeur envoyée.
 */

import { selectClass } from "@/components/workspace/ui";

/** Devises d'un document commercial, dans l'ordre d'usage attendu. */
export const CURRENCY_OPTIONS = [
  { code: "DZD", label: "DA · Dinar algérien" },
  { code: "EUR", label: "EUR · Euro" },
];

/** Devises des tarifs publics : une de plus que les documents. */
export const CONTENT_CURRENCY_OPTIONS = [...CURRENCY_OPTIONS, { code: "USD", label: "USD · Dollar américain" }];

/** Devise par défaut : alignée sur `Project.currency` et `Quote.currency`. */
export const DEFAULT_CURRENCY = "DZD";

/** Libellé d'une devise, sans plantage si le code n'est pas dans la liste. */
export function currencyLabel(code, options = CURRENCY_OPTIONS) {
  const found = options.find((option) => option.code === code);
  return found ? found.label : (code || "—");
}

export default function CurrencySelect({
  id,
  value,
  onChange,
  className = "",
  disabled = false,
  name,
  options = CURRENCY_OPTIONS,
}) {
  return (
    <select
      id={id}
      name={name}
      className={`${selectClass} ${className}`.trim()}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      {options.map((option) => (
        <option key={option.code} value={option.code}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
