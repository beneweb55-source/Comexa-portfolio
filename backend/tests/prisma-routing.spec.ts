/**
 * ROUTAGE PRISMA « formation / production » — la règle ET le câblage.
 *
 * Incident 2026-10-21 : la règle pure (`clientForModel`) renvoyait les chaînes
 * 'production' | 'training' et le getter installé faisait
 * `clientForModel(...) ? clientFormation : original`. 'production' étant
 * truthy, TOUS les accès DB partaient vers la base de formation — connexion
 * impossible, compteur d'échecs jamais incrémenté, écritures hors de la base
 * de production. Les tests de l'époque couvraient la règle pure, jamais le
 * branchement : ils passaient au-dessus du bug.
 *
 * Ces tests couvrent donc les deux niveaux :
 *  1. la décision pure (`useTrainingClient`), qui retourne un BOOLÉEN ;
 *  2. les getters réellement installés sur une instance `PrismaService`
 *     (construction possible hors base : les delegates Prisma sont paresseux),
 *     dans chaque combinaison scope × disponibilité de TRAINING_DATABASE_URL.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MODEL_DELEGATE_NAMES,
  PrismaService,
  useTrainingClient,
} from '../src/prisma/prisma.service.js';
import { runInProductionScope, runInTrainingScope } from '../src/common/training/training-scope.js';

const FAKE_PROD_URL = 'postgresql://user:pass@localhost:5432/production_test';
const FAKE_TRAINING_URL = 'postgresql://user:pass@localhost:5432/training_test';

/** Exécute `fn` avec TRAINING_DATABASE_URL imposée (null = absente), puis restaure. */
function withTrainingUrl<T>(url: string | null, fn: (svc: PrismaService) => T): T {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousTrainingUrl = process.env.TRAINING_DATABASE_URL;
  process.env.DATABASE_URL = FAKE_PROD_URL;
  if (url === null) delete process.env.TRAINING_DATABASE_URL;
  else process.env.TRAINING_DATABASE_URL = url;
  try {
    return fn(new PrismaService());
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousTrainingUrl === undefined) delete process.env.TRAINING_DATABASE_URL;
    else process.env.TRAINING_DATABASE_URL = previousTrainingUrl;
  }
}

// ---------------------------------------------------------------------------
// 1. La règle pure
// ---------------------------------------------------------------------------

test('la décision est un booléen (un ternaire ne peut pas la prendre pour une chaîne truthy)', () => {
  assert.equal(typeof useTrainingClient('client', true), 'boolean');
  assert.equal(typeof useTrainingClient('client', false), 'boolean');
});

test('hors formation : rien ne va au client de formation', () => {
  assert.equal(useTrainingClient('client', false), false);
  assert.equal(useTrainingClient('quote', false), false);
  assert.equal(useTrainingClient('user', false), false);
});

test('en formation : les modèles métier vont à l\'entraînement', () => {
  assert.equal(useTrainingClient('client', true), true);
  assert.equal(useTrainingClient('quote', true), true);
  assert.equal(useTrainingClient('user', true), true);
  assert.equal(useTrainingClient('task', true), true);
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
      useTrainingClient(model, true),
      false,
      `le modèle ${model} doit rester en production même en formation`,
    );
  }
});

test('le choix ne dépend JAMAIS de la disponibilité du client (pas de repli muet)', () => {
  // La fonction ne reçoit même pas le client : en scope de formation, la
  // destination est l'entraînement, et l'absence de TRAINING_DATABASE_URL
  // doit échouer explicitement ailleurs, pas rediriger vers la production.
  assert.equal(useTrainingClient('client', true), true);
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

// ---------------------------------------------------------------------------
// 2. Le câblage réel (les getters installés sur l'instance)
// ---------------------------------------------------------------------------

test('câblage : SANS TRAINING_DATABASE_URL, la production répond (la prod ne dépend jamais de la formation)', () => {
  withTrainingUrl(null, (svc) => {
    // C'est l'accès de 2026-10-21 : `AuthService.login` touche `prisma.user`.
    // Avec le câblage fautif, cet accès levait « TRAINING_DATABASE_URL est
    // absente » et TOUTE l'API répondait 500.
    const userDelegate = runInProductionScope(() => svc.user);
    assert.ok(userDelegate, 'le delegate user doit être accessible en production');
    assert.ok(runInProductionScope(() => svc.refreshToken));
    // Hors de tout scope aussi (cron, scripts) : c'est du production.
    assert.ok(svc.client);
  });
});

test('câblage : le scope choisit le client — production et formation sont deux delegates distincts', () => {
  withTrainingUrl(FAKE_TRAINING_URL, (svc) => {
    const prodUser = runInProductionScope(() => svc.user);
    const trainingUser = runInTrainingScope(() => svc.user);
    assert.notEqual(
      prodUser,
      trainingUser,
      'user doit être servi par deux delegates différents selon le scope',
    );
  });
});

test('câblage : en formation, les modèles d\'identité restent sur le delegate de production', () => {
  withTrainingUrl(FAKE_TRAINING_URL, (svc) => {
    const prodToken = runInProductionScope(() => svc.refreshToken);
    const trainingToken = runInTrainingScope(() => svc.refreshToken);
    assert.equal(
      prodToken,
      trainingToken,
      'refreshToken doit rester le delegate de production même en formation',
    );
  });
});

test('câblage : en formation SANS TRAINING_DATABASE_URL, erreur explicite — jamais de repli vers la production', () => {
  withTrainingUrl(null, (svc) => {
    assert.throws(
      () => runInTrainingScope(() => svc.client),
      /TRAINING_DATABASE_URL est absente/,
      'un accès de formation sans base de formation doit échouer bruyamment',
    );
  });
});
