import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_RANGE_DAYS, assertChronology, resolveRange } from './calendar.service.js';

/**
 * REGLES PURES DU CALENDRIER — testees sans base ni conteneur.
 *
 * Ce sont les deux garde-fous qui protegent la lecture et l'ecriture des
 * horaires : une fenetre de vue bornee et coherent, et une chronologie
 * evenementielle non inversee. Toute regression ici deplacerait des
 * rendez-vous ou vidierait une vue sans message.
 */
describe('fenetre de lecture du calendrier', () => {
  it('par defaut couvre six mois autour du jour', () => {
    const range = resolveRange({});
    const dayMs = 24 * 60 * 60 * 1000;
    const spanDays = (range.to.getTime() - range.from.getTime()) / dayMs;
    assert.ok(spanDays > 350 && spanDays <= MAX_RANGE_DAYS, `fenetre de ${spanDays} jours`);
  });

  it('accepte une fenetre explicite et la respecte', () => {
    const range = resolveRange({ from: '2026-10-01T00:00:00Z', to: '2026-10-31T23:59:59Z' });
    assert.equal(range.from.toISOString(), '2026-10-01T00:00:00.000Z');
    assert.equal(range.to.toISOString(), '2026-10-31T23:59:59.000Z');
  });

  it('refuse une fenetre inversee (from apres to)', () => {
    assert.throws(
      () => resolveRange({ from: '2026-11-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }),
      (caught: { code?: string }) => caught.code === 'CALENDAR_RANGE_INVALID',
    );
  });

  it(`refuse une fenetre plus large que ${MAX_RANGE_DAYS} jours`, () => {
    assert.throws(
      () => resolveRange({ from: '2026-01-01T00:00:00Z', to: '2027-06-01T00:00:00Z' }),
      (caught: { code?: string }) => caught.code === 'CALENDAR_RANGE_TOO_WIDE',
    );
  });

  it('refuse une date illisible', () => {
    assert.throws(
      () => resolveRange({ from: 'pas-une-date' }),
      (caught: { code?: string }) => caught.code === 'CALENDAR_RANGE_INVALID',
    );
  });
});

describe('chronologie des evenements', () => {
  it('accepte un evenement ponctuel (pas de fin)', () => {
    assert.doesNotThrow(() => assertChronology(new Date('2026-10-15T10:00:00Z'), null));
  });

  it('accepte une fin egale au debut', () => {
    const at = new Date('2026-10-15T10:00:00Z');
    assert.doesNotThrow(() => assertChronology(at, at));
  });

  it('refuse une fin avant le debut', () => {
    assert.throws(
      () => assertChronology(new Date('2026-10-15T10:00:00Z'), new Date('2026-10-15T09:00:00Z')),
      (caught: { code?: string }) => caught.code === 'CALENDAR_RANGE_INVALID',
    );
  });
});
