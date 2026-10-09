import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PaymentMethod } from '../../generated/prisma/enums.js';
import {
  currencyForCountry,
  normalizeCountry,
  parsePaymentMethodList,
  resolveOrderOffer,
  selectCurrentRate,
  type RateLike,
} from './order-pricing.js';

const NOW = new Date('2026-10-09T12:00:00Z');
const PAST = new Date('2026-01-01T00:00:00Z');
const FUTURE = new Date('2027-01-01T00:00:00Z');

function rate(
  id: string,
  currency: string,
  effectiveFrom: Date,
  isActive = true,
): RateLike & { id: string } {
  return { id, currency, effectiveFrom, isActive };
}

describe('devise selon le pays', () => {
  it('Algerie → DZD', () => {
    assert.equal(currencyForCountry('DZ'), 'DZD');
    assert.equal(currencyForCountry(' dz '), 'DZD');
  });

  it('tout autre pays valide → EUR (sans conversion)', () => {
    assert.equal(currencyForCountry('FR'), 'EUR');
    assert.equal(currencyForCountry('MA'), 'EUR');
    assert.equal(currencyForCountry('CA'), 'EUR');
  });

  it('pays absent ou invalide → aucune devise devinee', () => {
    assert.equal(currencyForCountry(null), null);
    assert.equal(currencyForCountry(undefined), null);
    assert.equal(currencyForCountry(''), null);
    assert.equal(currencyForCountry('FRA'), null);
    assert.equal(currencyForCountry('1Z'), null);
  });

  it('normalizeCountry refuse les formes non ISO', () => {
    assert.equal(normalizeCountry('dz'), 'DZ');
    assert.equal(normalizeCountry('D-Z'), null);
  });
});

describe('tarif en vigueur', () => {
  it("prend le tarif le plus recent dont la date d'effet est passee", () => {
    const rates = [
      rate('new', 'DZD', FUTURE),
      rate('current', 'DZD', PAST),
      rate('old', 'DZD', new Date('2025-01-01')),
    ];
    assert.equal(selectCurrentRate(rates, 'DZD', NOW)?.id, 'current');
  });

  it("ignore un tarif inactif, même s'il est le plus récent", () => {
    const rates = [
      rate('disabled', 'DZD', PAST, false),
      rate('older', 'DZD', new Date('2025-01-01')),
    ];
    assert.equal(selectCurrentRate(rates, 'DZD', NOW)?.id, 'older');
  });

  it("ne retourne jamais un tarif d'une autre devise (aucune conversion)", () => {
    const rates = [rate('eur', 'EUR', PAST)];
    assert.equal(selectCurrentRate(rates, 'DZD', NOW), null);
  });

  it("aucun tarif a venir n'est applique", () => {
    assert.equal(selectCurrentRate([rate('future', 'EUR', FUTURE)], 'EUR', NOW), null);
  });
});

describe('moyens de paiement configures', () => {
  it('liste vide ou absente → aucun moyen', () => {
    assert.deepEqual(parsePaymentMethodList(undefined, 'X'), []);
    assert.deepEqual(parsePaymentMethodList('  ', 'X'), []);
  });

  it('accepte une liste, sans doublon', () => {
    assert.deepEqual(parsePaymentMethodList('bank_transfer, CARD,BANK_TRANSFER', 'X'), [
      PaymentMethod.BANK_TRANSFER,
      PaymentMethod.CARD,
    ]);
  });

  it('refuse un moyen inconnu au demarrage', () => {
    assert.throws(
      () => parsePaymentMethodList('BITCOIN', 'PAYMENT_METHODS_EUR'),
      /moyen de paiement inconnu/,
    );
  });
});

describe('offre de commande', () => {
  const methods = {
    DZD: [PaymentMethod.BANK_TRANSFER],
    EUR: [] as PaymentMethod[],
  };

  it('Algerie avec tarif DZD et moyen compatible → commande en DZD', () => {
    const offer = resolveOrderOffer({
      country: 'DZ',
      rates: [rate('dzd', 'DZD', PAST), rate('eur', 'EUR', PAST)],
      paymentMethods: methods,
      now: NOW,
    });
    assert.equal(offer.kind, 'ORDER');
    if (offer.kind !== 'ORDER') return;
    assert.equal(offer.currency, 'DZD');
    assert.equal(offer.rate.id, 'dzd');
    assert.equal(offer.paymentMethod, PaymentMethod.BANK_TRANSFER);
  });

  it('Algerie sans tarif DZD ne bascule PAS sur le tarif EUR', () => {
    const offer = resolveOrderOffer({
      country: 'DZ',
      rates: [rate('eur', 'EUR', PAST)],
      paymentMethods: { DZD: [PaymentMethod.BANK_TRANSFER], EUR: [PaymentMethod.CARD] },
      now: NOW,
    });
    assert.deepEqual(offer, {
      kind: 'PROJECT_REQUEST',
      currency: 'DZD',
      reason: 'NO_CURRENT_RATE',
    });
  });

  it('pays international avec tarif EUR et moyen compatible → commande en EUR', () => {
    const offer = resolveOrderOffer({
      country: 'FR',
      rates: [rate('eur', 'EUR', PAST)],
      paymentMethods: { EUR: [PaymentMethod.CARD] },
      now: NOW,
    });
    assert.equal(offer.kind, 'ORDER');
    if (offer.kind !== 'ORDER') return;
    assert.equal(offer.currency, 'EUR');
    assert.equal(offer.paymentMethod, PaymentMethod.CARD);
  });

  it('pays international sans moyen de paiement configure → demande de projet, pas de commande', () => {
    const offer = resolveOrderOffer({
      country: 'FR',
      rates: [rate('eur', 'EUR', PAST)],
      paymentMethods: methods,
      now: NOW,
    });
    assert.deepEqual(offer, {
      kind: 'PROJECT_REQUEST',
      currency: 'EUR',
      reason: 'NO_COMPATIBLE_PAYMENT_METHOD',
    });
  });

  it('pays international sans tarif EUR → demande de projet, aucune devise choisie au hasard', () => {
    const offer = resolveOrderOffer({
      country: 'MA',
      rates: [rate('dzd', 'DZD', PAST)],
      paymentMethods: { EUR: [PaymentMethod.CARD] },
      now: NOW,
    });
    assert.deepEqual(offer, {
      kind: 'PROJECT_REQUEST',
      currency: 'EUR',
      reason: 'NO_CURRENT_RATE',
    });
  });

  it('pays absent → demande de projet, sans devise', () => {
    const offer = resolveOrderOffer({
      country: null,
      rates: [rate('eur', 'EUR', PAST)],
      paymentMethods: { EUR: [PaymentMethod.CARD] },
      now: NOW,
    });
    assert.deepEqual(offer, { kind: 'PROJECT_REQUEST', currency: null, reason: 'COUNTRY_UNKNOWN' });
  });
});
