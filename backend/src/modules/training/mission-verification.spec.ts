/**
 * VÉRIFICATION DES MISSIONS — tests du moteur de critères.
 *
 * La règle d'or testée : la réussite se décide sur le DÉCOMPTE réel des lignes
 * d'exercice. Un critère non satisfait ne passe jamais, un modèle inconnu
 * n'est jamais absorbé silencieusement (une réussite fictive serait pire
 * qu'une erreur).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  criterionMet,
  evaluateCriteria,
  resolveWhere,
  type VerificationDb,
} from './mission-verification.js';
import type { MissionCriterion } from './missions.js';

test('resolveWhere substitue {{userId}} et {{now}} en profondeur', () => {
  const now = new Date('2026-10-21T09:00:00Z');
  const resolved = resolveWhere(
    {
      assigneeId: '{{userId}}',
      nested: { ownerId: '{{userId}}', createdAt: { gte: '{{now}}' } },
      literal: 'reste tel quel',
    },
    'user-9',
    now,
  );
  assert.equal(resolved.assigneeId, 'user-9');
  assert.deepEqual(resolved.nested, { ownerId: 'user-9', createdAt: { gte: now } });
  assert.equal(resolved.literal, 'reste tel quel');
});

test('criterionMet : minCount par défaut 1, expectCount exact', () => {
  const base: MissionCriterion = { id: 'c', description: '', model: 'client', where: {} };
  assert.equal(criterionMet({ ...base, minCount: 2 }, 1), false);
  assert.equal(criterionMet({ ...base, minCount: 2 }, 2), true);
  assert.equal(criterionMet({ ...base }, 1), true);
  assert.equal(criterionMet({ ...base }, 0), false);
  assert.equal(criterionMet({ ...base, expectCount: 1 }, 2), false);
  assert.equal(criterionMet({ ...base, expectCount: 1 }, 1), true);
});

function fakeDb(counts: Record<string, number>): VerificationDb {
  const db: VerificationDb = {};
  for (const [model, count] of Object.entries(counts)) {
    db[model] = {
      async count() {
        return count;
      },
    };
  }
  return db;
}

test('evaluateCriteria rend un rapport complet et refuse un critère manquant', async () => {
  const criteria: MissionCriterion[] = [
    { id: 'a', description: 'A', model: 'client', where: {}, minCount: 1 },
    { id: 'b', description: 'B', model: 'task', where: {}, minCount: 1 },
  ];

  const both = await evaluateCriteria(fakeDb({ client: 1, task: 2 }), criteria, 'user-1');
  assert.equal(both.ok, true);
  assert.deepEqual(
    both.results.map((r) => [r.id, r.met, r.count]),
    [
      ['a', true, 1],
      ['b', true, 2],
    ],
  );

  const missing = await evaluateCriteria(fakeDb({ client: 1, task: 0 }), criteria, 'user-1');
  assert.equal(missing.ok, false);
  assert.equal(missing.results[1]?.met, false);
});

test('un modèle inconnu est une erreur programmeur, jamais un succès', async () => {
  const criteria: MissionCriterion[] = [
    { id: 'x', description: 'X', model: 'modèle-inventé', where: {}, minCount: 1 },
  ];
  await assert.rejects(
    () => evaluateCriteria(fakeDb({}), criteria, 'user-1'),
    /modèle « modèle-inventé » n'existe pas/,
  );
});

test('le where reçu par le modèle contient bien les substitutions (appel réel du décompte)', async () => {
  let seenWhere: Record<string, unknown> | null = null;
  const db: VerificationDb = {
    task: {
      async count(args) {
        seenWhere = args.where;
        return 1;
      },
    },
  };
  const criteria: MissionCriterion[] = [
    { id: 't', description: '', model: 'task', where: { assigneeId: '{{userId}}' }, minCount: 1 },
  ];
  await evaluateCriteria(db, criteria, 'user-77');
  assert.deepEqual(seenWhere, { assigneeId: 'user-77' });
});
