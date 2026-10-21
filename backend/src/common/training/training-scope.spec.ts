/**
 * SCOPE DE FORMATION — tests du mécanisme de portée.
 *
 * Ce qui est vérifié ici est la FRONTIÈRE elle-même : un scope ne peut être
 * marqué que dans une continuation de requête, il route les décisions de base
 * de données, et les scopes de production et de formation s'imbriquent sans
 * fuite (le plus interne gagne).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  currentTrainingSessionId,
  isTrainingScope,
  markTrainingScope,
  runInProductionScope,
  runInTrainingScope,
  runWithRequestTrainingStore,
} from './training-scope.js';

test('hors requête, aucun scope de formation', () => {
  assert.equal(isTrainingScope(), false);
  assert.equal(currentTrainingSessionId(), null);
});

test('le middleware ouvre un magasin vierge : pas de formation par défaut', () => {
  runWithRequestTrainingStore(() => {
    assert.equal(isTrainingScope(), false);
  });
});

test('marquer le scope hors requête est un erreur de programmation, pas un silence', () => {
  assert.throws(() => markTrainingScope('session-1', 'user-1'), /middleware de scope/);
});

test('un jeton de formation marque le scope de la requête', () => {
  runWithRequestTrainingStore(() => {
    markTrainingScope('session-42', 'user-7');
    assert.equal(isTrainingScope(), true);
    assert.equal(currentTrainingSessionId(), 'session-42');
  });
});

test('runInTrainingScope bascule explicitement, runInProductionScope protège les écritures réelles', () => {
  runWithRequestTrainingStore(() => {
    markTrainingScope('session-1', 'user-1');
    assert.equal(isTrainingScope(), true);
    // Exemple réel : la progression pédagogique s'écrit en production même
    // depuis une requête de formation.
    runInProductionScope(() => {
      assert.equal(isTrainingScope(), false);
    });
    assert.equal(isTrainingScope(), true);
  });
});

test('le magasin est propre à chaque continuation (pas de fuite entre requêtes)', () => {
  runWithRequestTrainingStore(() => {
    markTrainingScope('session-a', 'user-a');
    assert.equal(isTrainingScope(), true);
  });
  // Requête suivante : aucun héritage.
  runWithRequestTrainingStore(() => {
    assert.equal(isTrainingScope(), false);
  });
});

test('runInTrainingScope enveloppe les amorçages hors requête', () => {
  runInTrainingScope(() => {
    assert.equal(isTrainingScope(), true);
    assert.equal(currentTrainingSessionId(), 'bootstrap');
  });
  assert.equal(isTrainingScope(), false);
});
