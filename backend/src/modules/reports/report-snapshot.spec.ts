import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  REPORT_SNAPSHOT_SCHEMA,
  buildReportSnapshot,
  readReportSnapshot,
  snapshotToJson,
  type ReportSnapshot,
  type RevenueResult,
} from './report-snapshot.js';

/**
 * Tests de l'INSTANTANE.
 *
 * L'enjeu de ce fichier n'est pas la mise en forme, c'est la RELECTURE. Un
 * instantane illisible doit ressortir en `null` et forcer l'appelant a le dire ;
 * s'il ressortait en zeros, un rapport casse passerait pour un trimestre sans
 * activite, et personne n'irait verifier.
 */

function sampleResult(): RevenueResult {
  return {
    type: 'REVENUE',
    periodStart: '2026-05-01T00:00:00.000Z',
    periodEnd: '2026-05-31T23:59:59.999Z',
    asOf: '2026-06-01T08:00:00.000Z',
    collected: {
      currency: 'EUR',
      total: '4200.00',
      count: 3,
      byCurrency: [{ currency: 'EUR', total: '4200.00', count: 3 }],
      byMethod: [{ method: 'TRANSFER', currency: 'EUR', total: '4200.00', count: 3 }],
    },
    billed: {
      currency: 'EUR',
      total: '10000.00',
      count: 5,
      byCurrency: [{ currency: 'EUR', total: '10000.00', count: 5 }],
    },
    collectionRate: 0.42,
  };
}

function sampleSnapshot(): ReportSnapshot {
  return buildReportSnapshot({
    request: { type: 'REVENUE', projectId: null, preset: 'LAST_MONTH' },
    result: sampleResult(),
    generatedAt: new Date('2026-06-01T08:00:00.000Z'),
  });
}

describe('buildReportSnapshot', () => {
  it('marque l instantane de son schema et de sa date de generation', () => {
    const snapshot = sampleSnapshot();

    assert.equal(snapshot.schema, REPORT_SNAPSHOT_SCHEMA);
    assert.equal(snapshot.generatedAt, '2026-06-01T08:00:00.000Z');
    assert.equal(snapshot.request.preset, 'LAST_MONTH');
  });
});

describe('readReportSnapshot — relecture apres stockage', () => {
  it('retrouve l instantane apres un aller-retour JSON', () => {
    const snapshot = sampleSnapshot();
    // Le trajet reel : la valeur passe en base `Json` puis en ressort.
    const stored = JSON.parse(JSON.stringify(snapshotToJson(snapshot))) as unknown;
    const reread = readReportSnapshot(stored);

    assert.notEqual(reread, null);
    assert.equal(reread?.schema, REPORT_SNAPSHOT_SCHEMA);
    assert.equal(reread?.generatedAt, snapshot.generatedAt);
    assert.deepEqual(reread?.request, snapshot.request);
    assert.deepEqual(reread?.result, snapshot.result);
  });

  it('conserve le montant en chaine, sans repasser par un flottant', () => {
    const stored = JSON.parse(JSON.stringify(snapshotToJson(sampleSnapshot()))) as unknown;
    const result = readReportSnapshot(stored)?.result;

    assert.equal(result?.type, 'REVENUE');
    assert.equal(result?.type === 'REVENUE' ? result.collected.total : null, '4200.00');
  });

  it('refuse — en renvoyant null — une valeur qui n est pas un instantane', () => {
    // `null` n'est pas une erreur : c'est une ligne sans resultat exploitable.
    // Le service doit alors le DIRE, jamais servir des zeros qui se liraient
    // comme « periode sans activite ».
    for (const value of [null, undefined, 0, '', 'comexa', [], [1, 2], true]) {
      assert.equal(readReportSnapshot(value), null, `accepte a tort ${JSON.stringify(value)}`);
    }
  });

  it('refuse un schema inconnu plutot que de deviner la forme', () => {
    const future = { ...sampleSnapshot(), schema: 'comexa.report.v2' };

    assert.equal(readReportSnapshot(future), null);
    assert.equal(readReportSnapshot({ ...sampleSnapshot(), schema: undefined }), null);
  });

  it('refuse un instantane ampute de sa date ou de ses sections', () => {
    const snapshot = sampleSnapshot();

    const { generatedAt: _dropped, ...sansDate } = snapshot;
    assert.equal(readReportSnapshot(sansDate), null);
    assert.equal(readReportSnapshot({ ...snapshot, generatedAt: 20260601 }), null);

    const { request: _sansRequest, ...sansRequest } = snapshot;
    assert.equal(readReportSnapshot(sansRequest), null);

    const { result: _sansResult, ...sansResult } = snapshot;
    assert.equal(readReportSnapshot(sansResult), null);

    assert.equal(readReportSnapshot({ ...snapshot, request: [] }), null);
    assert.equal(readReportSnapshot({ ...snapshot, result: 'REVENUE' }), null);
  });

  it('refuse une demande sans type, qui ne dirait pas ce qui a ete calcule', () => {
    assert.equal(readReportSnapshot({ ...sampleSnapshot(), request: { projectId: null } }), null);
  });

  it('ne transforme pas un projectId absent en une chaine quelconque', () => {
    const reread = readReportSnapshot({
      ...sampleSnapshot(),
      request: { type: 'TASKS', projectId: 42, preset: null },
    });

    assert.notEqual(reread, null);
    assert.equal(reread?.request.projectId, null);
    assert.equal(reread?.request.preset, null);
  });
});
