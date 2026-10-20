/*
 * DEVISES — codes, libellés, formatage et totaux.
 *
 * UN SEUL ENDROIT POUR TOUT L'ARGENT AFFICHÉ. Le dépôt formatait ses montants
 * avec `Intl.NumberFormat` directement dans `api.js` et laissait chaque écran
 * choisir sa devise ; les tableaux de bord additionnaient ensuite des dinars et
 * des euros dans un seul total, étiqueté avec la devise de la première ligne
 * rencontrée. Le chiffre affiché était donc faux — sans erreur, sans tiret,
 * juste un montant plausible dans la mauvaise monnaie.
 *
 * Trois règles, et tout le reste en découle :
 *
 *   1. ON N'ADDITIONNE JAMAIS DEUX DEVISES. Un total est toujours un couple
 *      (devise, montant). `sumByCurrency` regroupe, `amountsInScope` choisit.
 *
 *   2. LA DEVISE PAR DÉFAUT EST LE DINAR (`DZD`). C'est le marché principal et
 *      le défaut du schéma Prisma pour les devis, factures, projets et clients.
 *      L'euro reste une devise pleinement supportée, pas un cas particulier.
 *
 *   3. LE LIBELLÉ SUIT L'USAGE ALGÉRIEN : « DA », pas « DZD » ni « د.ج ». Les
 *      PDF du backend affichent déjà `1 200,00 DA` (voir `pdf.service.ts`) ;
 *      l'écran doit dire la même chose que la pièce imprimée.
 *
 * Le champ `currency` reste une chaîne libre de trois lettres en base : toute
 * devise inconnue est affichée telle quelle (`1 200,00 XAF`) au lieu de faire
 * échouer le rendu.
 */

/** Devise par défaut, alignée sur `@default("DZD")` du schéma Prisma. */
export const DEFAULT_CURRENCY = "DZD";

/** Portée « toutes les devises » : chaque montant est affiché séparément. */
export const ALL_CURRENCIES = "ALL";

/**
 * Devises proposées à la saisie d'un document commercial.
 *
 * L'ordre est celui de l'usage : le dinar d'abord, l'euro ensuite. Le libellé
 * porte le nom complet pour que « DA » ne se confonde pas avec une autre
 * abréviation ; `short` est la forme des pilules de filtre.
 */
export const CURRENCY_OPTIONS = [
  { code: "DZD", label: "DA · Dinar algérien", short: "DA" },
  { code: "EUR", label: "EUR · Euro", short: "EUR" },
];

/** Devises des tarifs publics : une de plus que les documents. */
export const CONTENT_CURRENCY_OPTIONS = [...CURRENCY_OPTIONS, { code: "USD", label: "USD · Dollar américain", short: "USD" }];

/** Toutes les devises connues, pour les libellés et le tri. */
const KNOWN_OPTIONS = [...CONTENT_CURRENCY_OPTIONS];

/** Ordre d'affichage : dinar, euro, dollar, puis alphabétique. */
const PREFERRED_ORDER = ["DZD", "EUR", "USD"];

/** Un code est trois lettres ; tout le reste retombe sur la devise par défaut. */
export function normalizeCurrency(code) {
  const value = String(code ?? "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : DEFAULT_CURRENCY;
}

/** Vrai pour un code de devise ou pour la portée « toutes les devises ». */
export function isCurrencyScope(value) {
  return value === ALL_CURRENCIES || /^[A-Z]{3}$/.test(String(value ?? ""));
}

/** Libellé complet d'une devise, sans plantage si le code est inconnu. */
export function currencyLabel(code, options = CURRENCY_OPTIONS) {
  const normalized = String(code ?? "").toUpperCase();
  const found = options.find((option) => option.code === normalized);
  return found ? found.label : normalized || "—";
}

/** Forme courte d'une devise, pour les pilules de filtre. */
export function currencyShortLabel(code) {
  const normalized = normalizeCurrency(code);
  return KNOWN_OPTIONS.find((option) => option.code === normalized)?.short ?? normalized;
}

/** Rang d'affichage stable : DZD, EUR, USD, puis alphabétique. */
export function currencyRank(code) {
  const index = PREFERRED_ORDER.indexOf(normalizeCurrency(code));
  return index === -1 ? PREFERRED_ORDER.length : index;
}

/**
 * Montant formaté dans SA devise, sans conversion.
 *
 * `DZD` est rendu « 1 250 000,00 DA » et non « 1 250 000,00 DZD » : c'est la
 * même écriture que sur les factures PDF. Les autres devises gardent le
 * formatage monétaire de `Intl` (`1 250,00 €`, `1 250,00 $US`).
 */
const DECIMAL_FR = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INTL_FORMATTERS = new Map();

export function formatMoney(amount, currency = DEFAULT_CURRENCY) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "—";

  const code = normalizeCurrency(currency);
  if (code === "DZD") return `${DECIMAL_FR.format(value)} DA`;

  let formatter = INTL_FORMATTERS.get(code);
  if (formatter === undefined) {
    try {
      formatter = new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: code,
        maximumFractionDigits: 2,
      });
    } catch {
      // Code inconnu de l'ICU : on garde le montant lisible, suffixé du code.
      formatter = null;
    }
    INTL_FORMATTERS.set(code, formatter);
  }

  return formatter ? formatter.format(value) : `${DECIMAL_FR.format(value)} ${code}`;
}

/** Arrondi commercial au centime, pour ne pas trainer des flottants. */
function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

/** Déduplique et fusionne des couples (devise, montant), triés pour l'affichage. */
function normalizeAmounts(amounts) {
  const totals = new Map();
  for (const amount of amounts ?? []) {
    if (!amount) continue;
    const total = Number(amount.total ?? amount.amount);
    if (!Number.isFinite(total)) continue;
    const currency = normalizeCurrency(amount.currency);
    totals.set(currency, (totals.get(currency) ?? 0) + total);
  }

  return [...totals]
    // Un zéro n'est pas une devise utilisée : l'afficher en portée « toutes »
    // ajouterait « 0,00 € » à côté d'un vrai montant en dinars. Une portée
    // mono-devise, elle, rend quand même 0 pour la devise choisie.
    .filter(([, total]) => roundMoney(total) !== 0)
    .map(([currency, total]) => ({ currency, total: roundMoney(total) }))
    .sort((left, right) => currencyRank(left.currency) - currencyRank(right.currency) || left.currency.localeCompare(right.currency));
}

/**
 * Somme d'une liste de lignes, PAR DEVISE.
 *
 * Les lignes sont des objets quelconques : `amountOf` et `currencyOf` disent où
 * lire le montant et son code. Une devise absente retombe sur le dinar (défaut
 * du schéma), jamais sur l'euro.
 */
export function sumByCurrency(
  rows,
  {
    amountOf = (row) => row?.amount ?? row?.total,
    currencyOf = (row) => row?.currency,
  } = {},
) {
  const amounts = [];
  for (const row of rows ?? []) {
    amounts.push({ currency: currencyOf(row), total: amountOf(row) });
  }
  return normalizeAmounts(amounts);
}

/**
 * Montants retenus par la portée choisie.
 *
 *   - une devise précise : UN élément, à zéro si rien n'est libellé dedans ;
 *   - `ALL` : tous les montants non nuls, séparément.
 *
 * C'est ce qui rend « voir en DA », « voir en EUR » et « voir les deux »
 * possibles sans jamais mélanger les monnaies.
 */
export function amountsInScope(amounts, scope = DEFAULT_CURRENCY) {
  const list = normalizeAmounts(amounts);
  if (scope === ALL_CURRENCIES) return list;

  const code = normalizeCurrency(scope);
  const found = list.find((amount) => amount.currency === code);
  return [{ currency: code, total: found ? found.total : 0 }];
}

/** Sépare le montant principal des devises supplémentaires (affichage). */
export function splitAmounts(amounts, scope = DEFAULT_CURRENCY) {
  const list = amountsInScope(amounts, scope);
  if (scope === ALL_CURRENCIES) {
    const [primary, ...others] = list;
    return { primary: primary ?? null, others };
  }
  return { primary: list[0] ?? null, others: [] };
}

/**
 * Valeur principale + ligne secondaire, prêtes pour une carte KPI.
 *
 * En portée « les deux », le dinar occupe la grande ligne et l'euro (ou toute
 * autre devise) la ligne secondaire. En portée simple, la ligne secondaire est
 * nulle : le montant affiché est celui de la devise choisie, même s'il vaut 0.
 */
export function amountsPair(amounts, scope = DEFAULT_CURRENCY, empty = "—") {
  const { primary, others } = splitAmounts(amounts, scope);
  return {
    value: primary ? formatMoney(primary.total, primary.currency) : empty,
    secondary: others.length ? others.map((amount) => formatMoney(amount.total, amount.currency)).join(" · ") : null,
  };
}

/** Portées proposées par les pilules : DA, EUR (puis les devises vues), et les deux. */
export function currencyScopeOptions(available = [], selected = DEFAULT_CURRENCY) {
  const codes = new Set([DEFAULT_CURRENCY, "EUR"]);
  for (const code of available ?? []) codes.add(normalizeCurrency(code));
  if (selected !== ALL_CURRENCIES) codes.add(normalizeCurrency(selected));

  const ordered = [...codes].sort(
    (left, right) => currencyRank(left) - currencyRank(right) || left.localeCompare(right),
  );

  return [
    ...ordered.map((code) => ({ id: code, label: currencyShortLabel(code) })),
    { id: ALL_CURRENCIES, label: ordered.length > 2 ? "Toutes" : "Les deux" },
  ];
}
