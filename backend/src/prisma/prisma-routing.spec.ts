/**
 * ROUTAGE PRISMA « formation / production » — tests de la règle pure.
 *
 * La garantie testée : en scope de formation, chaque modèle va vers la base
 * d'entraînement, SAUF les modèles d'identité et de progression qui restent en
 * production ; hors scope, tout va en production. `clientForModel` est la
 * décision elle-même, isolée de tout pool de connexions.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MODEL_DELEGATE_NAMES, clientForModel } from './prisma.service.js';

test('hors formation : tout en production', () => {
  assert.equal(clientForModel('client', false), 'production');
  assert.equal(clientForModel('quote', false), 'production');
});

test('en formation : les modèles métier vont à l\'entraînement', () => {
  assert.equal(clientForModel('client', true), 'training');
  assert.equal(clientForModel('quote', true), 'training');
  assert.equal(clientForModel('user', true), 'training');
  assert.equal(clientForModel('task', true), 'training');
});

test('en formation : identité et progression restent en production', () => {
  for (const model of [
    'refreshToken',
    'emailVerificationToken',
    'passwordResetToken',
    'integrationToken',
    'trainingSession',
    'trainingMissionProgress',
    'trainingAttempt',
  ]) {
    assert.equal(
      clientForModel(model, true),
      'production',
      `le modèle ${model} doit rester en production même en formation`,
    );
  }
});

test('le choix ne dépend JAMAIS de la disponibilité du client (pas de repli muet)', () => {
  // La fonction ne reçoit même pas le client : en scope de formation, la
  // destination est l'entraînement, et l'absence de TRAINING_DATABASE_URL
  // doit échouer explicitement ailleurs, pas rediriger vers la production.
  assert.equal(clientForModel('client', true), 'training');
});

test('la liste des delegates couvre les modèles du schéma (noms camelCase)', () => {
  assert.ok(MODEL_DELEGATE_NAMES.includes('client'));
  assert.ok(MODEL_DELEGATE_NAMES.includes('trainingMissionProgress'));
  assert.ok(MODEL_DELEGATE_NAMES.includes('quoteItem'));
  // Un delegate camelCase commence par une minuscule.
  for (const name of MODEL_DELEGATE_NAMES) {
    assert.equal(name[0], name[0]?.toLowerCase(), `delegate inattendu : ${name}`);
  }
});
