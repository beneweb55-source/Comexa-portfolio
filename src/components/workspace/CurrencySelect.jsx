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
 * LES OPTIONS VIENNENT DE `lib/currency.js` : les codes, les libellés et le
 * formatage des montants n'existent qu'à un seul endroit. Ajouter une devise
 * ici sans l'ajouter là-bas ferait réapparaître un affichage à deux vitesses.
 */

import { CURRENCY_OPTIONS, CONTENT_CURRENCY_OPTIONS, DEFAULT_CURRENCY } from "@/lib/currency";
import { selectClass } from "@/components/workspace/ui";

export { CURRENCY_OPTIONS, CONTENT_CURRENCY_OPTIONS, DEFAULT_CURRENCY, currencyLabel } from "@/lib/currency";

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
