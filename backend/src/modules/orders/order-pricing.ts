/**
 * TARIFICATION DES COMMANDES — LOGIQUE PURE, SANS BASE DE DONNEES.
 *
 * Trois decisions metier sont figees ici, et chacune est testee :
 *
 *  1. LA DEVISE VIENT DU PAYS, JAMAIS DU NAVIGATEUR. Algerie → DZD ; tout autre
 *     pays valide → EUR ; pays absent → aucune devise (on ne devine pas).
 *
 *  2. AUCUNE CONVERSION. Un pack a un tarif par devise, defini a la main. Si le
 *     tarif de la devise du pays n'existe pas, on ne le calcule pas a partir de
 *     l'autre devise : la commande n'est pas proposee.
 *
 *  3. AUCUN MOYEN DE PAIEMENT PAR DEVISE = PAS DE COMMANDE EN LIGNE. Un visiteur
 *     sans moyen compatible est oriente vers une demande de projet, jamais refuse.
 */

import { PaymentMethod } from '../../generated/prisma/enums.js';

export const SUPPORTED_CURRENCIES = ['DZD', 'EUR'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const ALGERIA = 'DZ';

/** Normalise un code pays ISO 3166-1 alpha-2. `null` si la forme est invalide. */
export function normalizeCountry(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/**
 * Devise appliquee a un pays. `null` quand le pays est absent ou invalide : dans
 * ce cas on ne choisit arbitrairement aucune devise.
 */
export function currencyForCountry(country: string | null | undefined): SupportedCurrency | null {
  const code = normalizeCountry(country);
  if (code === null) return null;
  return code === ALGERIA ? 'DZD' : 'EUR';
}

export interface RateLike {
  readonly currency: string;
  readonly effectiveFrom: Date;
  readonly isActive: boolean;
}

/**
 * Tarif en vigueur pour une devise a un instant donne : le plus recent parmi les
 * tarifs actifs dont la date d'effet est passee.
 *
 * Les tarifs doivent arriver TRIES par `effectiveFrom` decroissant (puis
 * `createdAt` decroissant pour departager deux tarifs de meme date). La premiere
 * correspondance est alors la bonne, sans ambiguite.
 */
export function selectCurrentRate<T extends RateLike>(
  rates: readonly T[],
  currency: SupportedCurrency,
  now: Date,
): T | null {
  for (const rate of rates) {
    if (!rate.isActive) continue;
    if (rate.currency !== currency) continue;
    if (rate.effectiveFrom.getTime() > now.getTime()) continue;
    return rate;
  }
  return null;
}

export type PaymentMethodsByCurrency = Partial<Record<SupportedCurrency, readonly PaymentMethod[]>>;

/**
 * Lit une liste de moyens de paiement venant de l'environnement. Une valeur
 * inconnue fait echouer le demarrage : un moyen mal ecrit ne doit pas devenir
 * un moyen silencieusement absent, ni pire, un moyen qu'on croit disponible.
 */
export function parsePaymentMethodList(raw: string | undefined, label: string): PaymentMethod[] {
  if (raw === undefined || raw.trim() === '') return [];
  const known = new Set<string>(Object.values(PaymentMethod));
  const methods: PaymentMethod[] = [];
  for (const piece of raw.split(',')) {
    const value = piece.trim().toUpperCase();
    if (value === '') continue;
    if (!known.has(value)) {
      throw new Error(`${label} : moyen de paiement inconnu « ${piece.trim()} ».`);
    }
    const method = value as PaymentMethod;
    if (!methods.includes(method)) methods.push(method);
  }
  return methods;
}

export type OfferUnavailableReason =
  'COUNTRY_UNKNOWN' | 'NO_CURRENT_RATE' | 'NO_COMPATIBLE_PAYMENT_METHOD';

export type OrderOffer<T extends RateLike> =
  | {
      readonly kind: 'ORDER';
      readonly currency: SupportedCurrency;
      readonly rate: T;
      /** Premier moyen compatible configure pour la devise. */
      readonly paymentMethod: PaymentMethod;
    }
  | {
      readonly kind: 'PROJECT_REQUEST';
      readonly currency: SupportedCurrency | null;
      readonly reason: OfferUnavailableReason;
    };

export function resolveOrderOffer<T extends RateLike>(input: {
  readonly country: string | null | undefined;
  /** Tarifs du pack, tries par date d'effet decroissante. */
  readonly rates: readonly T[];
  readonly paymentMethods: PaymentMethodsByCurrency;
  readonly now: Date;
}): OrderOffer<T> {
  const currency = currencyForCountry(input.country);
  if (currency === null) {
    return { kind: 'PROJECT_REQUEST', currency: null, reason: 'COUNTRY_UNKNOWN' };
  }

  const rate = selectCurrentRate(input.rates, currency, input.now);
  if (rate === null) {
    return { kind: 'PROJECT_REQUEST', currency, reason: 'NO_CURRENT_RATE' };
  }

  const methods = input.paymentMethods[currency] ?? [];
  const paymentMethod = methods[0];
  if (paymentMethod === undefined) {
    return { kind: 'PROJECT_REQUEST', currency, reason: 'NO_COMPATIBLE_PAYMENT_METHOD' };
  }

  return { kind: 'ORDER', currency, rate, paymentMethod };
}
