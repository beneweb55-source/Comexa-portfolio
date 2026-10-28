/**
 * Mission 7 — isolation des stubs de test Prisma.
 *
 * Ces tests vérifient que le mécanisme de stubs hors ligne
 * (backend/tests/helpers/prisma-stubs.mjs) respecte le contrat :
 *
 *  1. exécution hors ligne avec stubs ;
 *  2. détection d'un client Prisma réel (aucun stub créé si présent) ;
 *  3. comportement si une suite échoue (nettoyage quand même) ;
 *  4. absence de fichiers factices résiduels après nettoyage ;
 *  5. relance des tests sans dépendre de l'ordre d'exécution (idempotence).
 *
 * Aucun vrai client Prisma n'est requis. Les stubs sont créés et supprimés
 * dans src/generated/prisma/ pendant le test, puis nettoyés en fin de suite.
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

test('hors ligne avec stubs : les stubs sont créés et utilisables', async () => {
  cleanupPrismaStubs();
  assert.equal(hasResidualStubs(), false, 'aucun résidu au départ');

  const result = preparePrismaStubs();
  assert.equal(result.generated, false, 'pas de vrai client généré');
  assert.equal(result.stubs, true, 'stubs créés');
  assert.equal(hasResidualStubs(), true, 'des stubs sont présents');

  // Les stubs sont importables et contiennent les valeurs attendues.
  const { RoleCode } = await import('../src/generated/prisma/enums.js');
  assert.equal(RoleCode.ADMIN, 'ADMIN');

  const { Prisma, PrismaClient } = await import('../src/generated/prisma/client.js');
  assert.equal(typeof Prisma.Decimal, 'function');
  assert.equal(typeof PrismaClient, 'function');
});

test('détection d’un client Prisma réel : les stubs ne sont pas créés si un vrai client est présent', () => {
  cleanupPrismaStubs();

  // Simuler un vrai client généré (fichier .ts dans le même répertoire).
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

test('comportement si une suite échoue : le nettoyage élimine quand même les stubs', async () => {
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
  cleanupPrismaStubs();
  preparePrismaStubs();
  assert.equal(hasResidualStubs(), true);

  cleanupPrismaStubs();
  assert.equal(hasResidualStubs(), false, 'nettoyage complet');
});

test('relance sans dépendre de l’ordre d’exécution : idempotent et robuste', () => {
  // Première préparation.
  const r1 = preparePrismaStubs();
  assert.equal(r1.stubs, true);
  assert.equal(hasResidualStubs(), true);

  // Deuxième préparation (idempotent : ne crée pas en double).
  const r2 = preparePrismaStubs();
  assert.equal(r2.stubs, true);
  assert.equal(hasResidualStubs(), true);

  // Nettoyage.
  cleanupPrismaStubs();
  assert.equal(hasResidualStubs(), false);

  // Troisième préparation après nettoyage.
  const r3 = preparePrismaStubs();
  assert.equal(r3.stubs, true);
  assert.equal(hasResidualStubs(), true);

  // Nettoyage final.
  cleanupPrismaStubs();
  assert.equal(hasResidualStubs(), false);
});
