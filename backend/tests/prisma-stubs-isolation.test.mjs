/**
 * Mission 7 — isolation des stubs de test Prisma.
 *
 * Ce fichier fonctionne dans les deux environnements :
 *  - hors ligne (aucun vrai client Prisma généré) : les stubs sont créés,
 *    utilisés, puis nettoyés ;
 *  - en CI (vrai client généré par `prisma generate`) : les stubs ne doivent
 *    PAS être créés, le vrai client doit rester intact et utilisable.
 *
 * Contrat vérifié :
 *  1. exécution hors ligne avec stubs (ou vrai client en CI) ;
 *  2. détection d'un client Prisma réel (aucun stub créé si présent) ;
 *  3. comportement si une suite échoue (nettoyage quand même, vrai client préservé) ;
 *  4. absence de fichiers factices résiduels après nettoyage ;
 *  5. relance des tests sans dépendre de l'ordre d'exécution (idempotence).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  preparePrismaStubs,
  cleanupPrismaStubs,
  hasResidualStubs,
  isRealPrismaClientPresent,
} from './helpers/prisma-stubs.mjs';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedDir = path.join(backendRoot, 'src', 'generated', 'prisma');
const fakeTs = path.join(generatedDir, 'enums.ts');

// Déterminé au chargement du module : pretest:invariants a déjà préparé
// l'environnement (stubs hors ligne, ou vrai client généré en CI).
const REAL_CLIENT = isRealPrismaClientPresent();

/** Vérifier que preparePrismaStubs() respecte le vrai client sans créer de stubs. */
function assertRealClientRespected() {
  const result = preparePrismaStubs();
  assert.equal(result.generated, true, 'vrai client prioritaire');
  assert.equal(result.stubs, false, 'aucun stub créé à la place du vrai client');
  assert.equal(
    hasResidualStubs(),
    false,
    'aucun stub ne doit subsister quand un vrai client est présent',
  );
}

/** Vérifier que le vrai client Prisma est importable et utilisable. */
async function assertRealClientUsable() {
  const { RoleCode } = await import('../src/generated/prisma/enums.js');
  assert.equal(RoleCode.ADMIN, 'ADMIN', 'vrai client utilisable (enums)');
  const { Prisma, PrismaClient } = await import('../src/generated/prisma/client.js');
  assert.equal(typeof Prisma.Decimal, 'function', 'vrai client utilisable (client)');
  assert.equal(typeof PrismaClient, 'function', 'vrai client utilisable (PrismaClient)');
}

test('stubs hors ligne ou vrai client en CI : une source d\'enums est toujours utilisable', async () => {
  if (REAL_CLIENT) {
    assertRealClientRespected();
    await assertRealClientUsable();
    return;
  }

  cleanupPrismaStubs();
  assert.equal(hasResidualStubs(), false, 'aucun résidu au départ');

  const result = preparePrismaStubs();
  assert.equal(result.generated, false, 'pas de vrai client généré');
  assert.equal(result.stubs, true, 'stubs créés');
  assert.equal(hasResidualStubs(), true, 'des stubs sont présents');

  const { RoleCode } = await import('../src/generated/prisma/enums.js');
  assert.equal(RoleCode.ADMIN, 'ADMIN');

  const { Prisma, PrismaClient } = await import('../src/generated/prisma/client.js');
  assert.equal(typeof Prisma.Decimal, 'function');
  assert.equal(typeof PrismaClient, 'function');
});

test('détection d’un client Prisma réel : les stubs ne sont pas créés si un vrai client est présent', () => {
  if (REAL_CLIENT) {
    assertRealClientRespected();
    return;
  }

  // Aucun vrai client : simuler un vrai client généré (fichier .ts), tester,
  // puis le supprimer pour restaurer l'état initial.
  writeFileSync(fakeTs, 'export const RoleCode = Object.freeze({ ADMIN: "ADMIN" });\n');

  try {
    assert.equal(isRealPrismaClientPresent(), true, 'vrai client détecté');

    const result = preparePrismaStubs();
    assert.equal(result.generated, true, 'vrai client prioritaire');
    assert.equal(result.stubs, false, 'aucun stub créé');
    assert.equal(
      hasResidualStubs(),
      false,
      'aucun stub ne doit subsister quand un vrai client est présent',
    );
  } finally {
    // Nettoyer le faux fichier .ts pour ne pas polluer l'environnement.
    if (existsSync(fakeTs)) unlinkSync(fakeTs);
  }
});

test('comportement si une suite échoue : le nettoyage élimine les stubs, préserve le vrai client', async () => {
  if (REAL_CLIENT) {
    // En CI : cleanupPrismaStubs() ne doit pas toucher au vrai client.
    cleanupPrismaStubs();
    assert.equal(isRealPrismaClientPresent(), true, 'vrai client préservé après nettoyage');
    assert.equal(hasResidualStubs(), false, 'aucun résidu de stub');
    return;
  }

  cleanupPrismaStubs();
  preparePrismaStubs();
  assert.equal(hasResidualStubs(), true, 'stubs présents avant la panne');

  // Simuler une suite qui échoue au milieu de son exécution.
  await assert.rejects(
    (async () => {
      throw new Error('échec simulé de suite');
    })(),
    /échec simulé/,
  );

  // Le nettoyage doit pouvoir être effectué malgré l'échec précédent.
  const removed = cleanupPrismaStubs();
  assert.ok(removed.length > 0, 'au moins un stub a été supprimé');
  assert.equal(hasResidualStubs(), false, 'plus de résidu après le nettoyage');
});

test('absence de fichiers factices résiduels après nettoyage', () => {
  if (REAL_CLIENT) {
    assert.equal(hasResidualStubs(), false, 'aucun résidu de stub en CI');
    cleanupPrismaStubs();
    assert.equal(
      isRealPrismaClientPresent(),
      true,
      'vrai client préservé par le nettoyage',
    );
    assert.equal(hasResidualStubs(), false, 'nettoyage complet des stubs');
    return;
  }

  cleanupPrismaStubs();
  preparePrismaStubs();
  assert.equal(hasResidualStubs(), true);

  cleanupPrismaStubs();
  assert.equal(hasResidualStubs(), false, 'nettoyage complet');
});

test('relance sans dépendre de l’ordre d’exécution : idempotent et robuste', () => {
  if (REAL_CLIENT) {
    // En CI : preparePrismaStubs() respecte le vrai client à chaque appel.
    const r1 = preparePrismaStubs();
    assert.equal(r1.generated, true, 'premier appel : vrai client');
    assert.equal(r1.stubs, false, 'premier appel : aucun stub');
    assert.equal(hasResidualStubs(), false, 'premier appel : aucun résidu');

    const r2 = preparePrismaStubs();
    assert.equal(r2.generated, true, 'deuxième appel : vrai client');
    assert.equal(r2.stubs, false, 'deuxième appel : aucun stub');
    assert.equal(hasResidualStubs(), false, 'deuxième appel : aucun résidu');
    return;
  }

  // Hors ligne : idempotence des stubs.
  const r1 = preparePrismaStubs();
  assert.equal(r1.stubs, true);
  assert.equal(hasResidualStubs(), true);

  const r2 = preparePrismaStubs();
  assert.equal(r2.stubs, true);
  assert.equal(hasResidualStubs(), true);

  cleanupPrismaStubs();
  assert.equal(hasResidualStubs(), false);

  const r3 = preparePrismaStubs();
  assert.equal(r3.stubs, true);
  assert.equal(hasResidualStubs(), true);

  cleanupPrismaStubs();
  assert.equal(hasResidualStubs(), false);
});
