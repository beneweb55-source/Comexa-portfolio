import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException } from '../../common/errors/app-error.js';
import {
  DEFAULT_PRESET,
  MAX_PERIOD_DAYS,
  PERIOD_PRESETS,
  isPeriodPreset,
  resolvePeriod,
  serializePeriod,
  withinPeriod,
} from './report-period.js';

/**
 * Tests des BORNES DE PERIODE.
 *
 * `now` est toujours fourni : un test qui depend de la date du jour passe le 15
 * et echoue le 1er du mois suivant, ce qui est la pire des proprietes pour un
 * test de dates.
 */
const NOW = new Date(2026, 4, 15, 10, 30, 0, 0); // 15 mai 2026, 10h30 locales

/** Verifie le refus et le code d'erreur, qui est ce que lit le frontend. */
function assertRejects(run: () => unknown, code: string): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof AppException, `attendu AppException, recu ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

describe('resolvePeriod — bornes de periode', () => {
  it('applique le preset par defaut quand aucune borne n est fournie', () => {
    const bounds = resolvePeriod({}, NOW);
    const expected = resolvePeriod({ preset: DEFAULT_PRESET }, NOW);

    assert.deepEqual(bounds, expected);
    assert.equal(DEFAULT_PRESET, 'THIS_MONTH');
  });

  it('englobe la journee entiere, bornes inclusives', () => {
    const bounds = resolvePeriod({ preset: 'TODAY' }, NOW);

    assert.equal(bounds.start.getHours(), 0);
    assert.equal(bounds.start.getMinutes(), 0);
    assert.equal(bounds.start.getSeconds(), 0);
    assert.equal(bounds.start.getMilliseconds(), 0);

    assert.equal(bounds.end.getHours(), 23);
    assert.equal(bounds.end.getMinutes(), 59);
    assert.equal(bounds.end.getSeconds(), 59);
    assert.equal(bounds.end.getMilliseconds(), 999);
  });

  it('compte sept jours, aujourd hui compris, sur LAST_7_DAYS', () => {
    const bounds = resolvePeriod({ preset: 'LAST_7_DAYS' }, NOW);

    assert.equal(bounds.start.getDate(), 9); // 15 - 6
    assert.equal(bounds.start.getMonth(), 4);
    assert.equal(bounds.end.getDate(), 15);
  });

  it('couvre le mois calendaire complet sur THIS_MONTH', () => {
    const bounds = resolvePeriod({ preset: 'THIS_MONTH' }, NOW);

    assert.equal(bounds.start.getDate(), 1);
    assert.equal(bounds.start.getMonth(), 4);
    assert.equal(bounds.end.getDate(), 31); // mai compte 31 jours
    assert.equal(bounds.end.getMonth(), 4);
  });

  it('trouve le dernier jour de fevrier sans table de durees', () => {
    const fevrier = new Date(2028, 1, 10, 12, 0, 0, 0); // annee bissextile
    const bounds = resolvePeriod({ preset: 'THIS_MONTH' }, fevrier);

    assert.equal(bounds.end.getDate(), 29);
    assert.equal(bounds.end.getMonth(), 1);
  });

  it('bascule sur le mois precedent, annee comprise, sur LAST_MONTH', () => {
    const janvier = new Date(2026, 0, 20, 8, 0, 0, 0);
    const bounds = resolvePeriod({ preset: 'LAST_MONTH' }, janvier);

    assert.equal(bounds.start.getFullYear(), 2025);
    assert.equal(bounds.start.getMonth(), 11);
    assert.equal(bounds.start.getDate(), 1);
    assert.equal(bounds.end.getFullYear(), 2025);
    assert.equal(bounds.end.getMonth(), 11);
    assert.equal(bounds.end.getDate(), 31);
  });

  it('aligne le trimestre sur janvier, avril, juillet ou octobre', () => {
    const trimestre = resolvePeriod({ preset: 'THIS_QUARTER' }, NOW);

    assert.equal(trimestre.start.getMonth(), 3); // avril
    assert.equal(trimestre.start.getDate(), 1);
    assert.equal(trimestre.end.getMonth(), 5); // juin
    assert.equal(trimestre.end.getDate(), 30);
  });

  it('couvre l annee civile sur THIS_YEAR', () => {
    const bounds = resolvePeriod({ preset: 'THIS_YEAR' }, NOW);

    assert.equal(bounds.start.getFullYear(), 2026);
    assert.equal(bounds.start.getMonth(), 0);
    assert.equal(bounds.start.getDate(), 1);
    assert.equal(bounds.end.getFullYear(), 2026);
    assert.equal(bounds.end.getMonth(), 11);
    assert.equal(bounds.end.getDate(), 31);
  });

  it('produit une periode valide pour CHAQUE preset declare', () => {
    for (const preset of PERIOD_PRESETS) {
      const bounds = resolvePeriod({ preset }, NOW);

      assert.ok(bounds.start.getTime() <= bounds.end.getTime(), `${preset} : bornes inversees`);
      assert.ok(!Number.isNaN(bounds.start.getTime()), `${preset} : debut NaN`);
      assert.equal(bounds.start.getHours(), 0, `${preset} : le debut doit etre a minuit`);
    }
  });

  it('accepte une periode explicite ou la fin egale le debut', () => {
    const bound = new Date(2026, 4, 15, 12, 0, 0, 0);
    const bounds = resolvePeriod({ periodStart: bound, periodEnd: bound }, NOW);

    assert.equal(bounds.start.getTime(), bound.getTime());
    assert.equal(bounds.end.getTime(), bound.getTime());
  });
});

describe('resolvePeriod — periodes refusees', () => {
  it('refuse une fin anterieure au debut', () => {
    assertRejects(
      () =>
        resolvePeriod(
          { periodStart: new Date(2026, 5, 1), periodEnd: new Date(2026, 4, 1) },
          NOW,
        ),
      'REPORT_PERIOD_INVALID',
    );
  });

  it('refuse une periode explicite sans une de ses deux bornes', () => {
    assertRejects(() => resolvePeriod({ periodStart: new Date(2026, 4, 1) }, NOW), 'REPORT_PERIOD_INCOMPLETE');
    assertRejects(() => resolvePeriod({ periodEnd: new Date(2026, 4, 1) }, NOW), 'REPORT_PERIOD_INCOMPLETE');
  });

  it('refuse de melanger un preset et des bornes explicites', () => {
    // Arbitrer a la place de l'appelant produirait un rapport dont la periode
    // n'est pas celle demandee, sans le moindre message.
    assertRejects(
      () =>
        resolvePeriod(
          { preset: 'THIS_MONTH', periodStart: new Date(2026, 4, 1), periodEnd: new Date(2026, 4, 2) },
          NOW,
        ),
      'REPORT_PERIOD_AMBIGUOUS',
    );
  });

  it('refuse une date invalide plutot que de propager un NaN dans la requete', () => {
    assertRejects(
      () => resolvePeriod({ periodStart: new Date('pas-une-date'), periodEnd: new Date(2026, 4, 1) }, NOW),
      'REPORT_PERIOD_INVALID',
    );
  });

  it('refuse une periode plus large que le plafond', () => {
    const start = new Date(2000, 0, 1);
    const end = new Date(2000, 0, 1 + MAX_PERIOD_DAYS + 1);

    assertRejects(() => resolvePeriod({ periodStart: start, periodEnd: end }, NOW), 'REPORT_PERIOD_INVALID');
  });
});

describe('isPeriodPreset', () => {
  it('reconnait les presets declares et rejette le reste', () => {
    assert.equal(isPeriodPreset('THIS_MONTH'), true);
    for (const preset of PERIOD_PRESETS) {
      assert.equal(isPeriodPreset(preset), true);
    }
    assert.equal(isPeriodPreset('THIS_WEEK'), false);
    assert.equal(isPeriodPreset(''), false);
    assert.equal(isPeriodPreset(undefined), false);
    assert.equal(isPeriodPreset(42), false);
  });
});

describe('withinPeriod et serializePeriod', () => {
  it('traduit les bornes en filtre Prisma inclusif', () => {
    const bounds = resolvePeriod({ periodStart: new Date(2026, 4, 1), periodEnd: new Date(2026, 4, 31, 23, 59, 59, 999) }, NOW);
    const filter = withinPeriod(bounds);

    assert.equal(filter.gte.getTime(), bounds.start.getTime());
    assert.equal(filter.lte.getTime(), bounds.end.getTime());
  });

  it('expose les bornes en UTC et en heure locale', () => {
    const bounds = resolvePeriod({ preset: 'TODAY' }, NOW);
    const serialized = serializePeriod(bounds);

    assert.equal(serialized.periodStart, bounds.start.toISOString());
    assert.match(serialized.startLocal, /^2026-05-15T00:00:00[+-]\d{2}:\d{2}$/);
    assert.match(serialized.endLocal, /^2026-05-15T23:59:59[+-]\d{2}:\d{2}$/);
  });
});
