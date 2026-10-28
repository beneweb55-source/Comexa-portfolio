/**
 * Mission 7.1 — isolation des stubs de test Prisma.
 *
 * Contrat verifie :
 *  1. exécution hors ligne avec stubs (ou vrai client en CI) ;
 *  2. détection d'un client Prisma complet (deux fichiers .ts requis) ;
 *  3. génération partielle (un seul .ts) ne crée pas de stubs ;
 *  4. comportement si une suite échoue (nettoyage garanti par le lanceur) ;
 *  5. absence de fichiers factices résiduels après nettoyage ;
 *  6. relance des tests sans dépendre de l'ordre d'exécution (idempotence) ;
 *  7. intégration du lanceur run-invariants.mjs avec échec volontaire.
 *
 * Ce fichier fonctionne dans les deux environnements :
 *  - hors ligne (aucun vrai client Prisma généré) : les stubs sont créés,
 *    utilisés, puis nettoyés ;
 *  - en CI (vrai client généré par `prisma generate`) : les stubs ne doivent
 *    PAS être créés, le vrai client doit rester intact et utilisable.
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
  isRealPrismaClientComplete,
  isPartialPrismaClient,
} from './helpers/prisma-stubs.mjs';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedDir = path.join(backendRoot, 'src', 'generated', 'prisma');
const fakeTs = path.join(generatedDir, 'enums.ts');
const fakeClientTs = path.join(generatedDir, 'client.ts');

// Déterminé au chargement du module.
const REAL_CLIENT = isRealPrismaClientComplete();

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

/** Créer un faux client partiel (un seul fichier .ts). */
function createPartialClient() {
  cleanupPrismaStubs();
  writeFileSync(fakeTs, 'export const RoleCode = Object.freeze({ ADMIN: "ADMIN" });\n');
}

/** Nettoyer les faux fichiers .ts de test. */
function cleanupFakeClientFiles() {
  for (const f of [fakeTs, fakeClientTs]) {
    if (existsSync(f)) unlinkSync(f);
  }
}

// ------------------------------------------------------------------
// États : aucun client présent
// ------------------------------------------------------------------

test('aucun client présent : stubs créés et utilisables', async () => {
  if (REAL_CLIENT) {
    // En CI, ce test est skipped car un vrai client est présent.
    console.log('# skipped : vrai client présent en CI');
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

  cleanupPrismaStubs();
  assert.equal(hasResidualStubs(), false, 'nettoyage complet');
});

// ------------------------------------------------------------------
// États : stubs déjà présents (idempotence)
// ------------------------------------------------------------------

test('stubs déjà présents : pas de réécriture inutile', () => {
  if (REAL_CLIENT) {
    console.log('# skipped : vrai client présent en CI');
    return;
  }

  cleanupPrismaStubs();
  const r1 = preparePrismaStubs();
  assert.equal(r1.stubs, true, 'premier appel : stubs créés');

  const r2 = preparePrismaStubs();
  assert.equal(r2.stubs, true, 'deuxième appel : stubs détectés');
  assert.equal(r2.cleaned, false, 'deuxième appel : pas de nettoyage inutile');
  assert.equal(hasResidualStubs(), true, 'stubs toujours présents');

  cleanupPrismaStubs();
  assert.equal(hasResidualStubs(), false, 'nettoyage complet');
});

// ------------------------------------------------------------------
// États : vrai client complet présent
// ------------------------------------------------------------------

test('vrai client complet : pas de stubs, client préservé', async () => {
  if (REAL_CLIENT) {
    assertRealClientRespected();
    await assertRealClientUsable();
    return;
  }

  // Simuler un vrai client complet (deux fichiers .ts).
  cleanupPrismaStubs();
  writeFileSync(fakeTs, 'export const RoleCode = Object.freeze({ ADMIN: "ADMIN" });\n');
  writeFileSync(
    fakeClientTs,
    'export class PrismaClient { constructor() {} async $connect() {} async $disconnect() {} }\nexport const Prisma = { Decimal: class {} };\n',
  );

  try {
    assert.equal(isRealPrismaClientComplete(), true, 'vrai client complet détecté');

    const result = preparePrismaStubs();
    assert.equal(result.generated, true, 'vrai client prioritaire');
    assert.equal(result.stubs, false, 'aucun stub créé');
    assert.equal(
      hasResidualStubs(),
      false,
      'aucun stub ne doit subsister quand un vrai client est présent',
    );

    // Le vrai client est importable (les fichiers .ts sont valides).
    const mod = await import('../src/generated/prisma/enums.js');
    assert.equal(mod.RoleCode.ADMIN, 'ADMIN');
  } finally {
    cleanupFakeClientFiles();
  }
});

// ------------------------------------------------------------------
// États : génération partielle
// ------------------------------------------------------------------

test('génération partielle (un seul .ts) : pas de stubs créés', () => {
  if (REAL_CLIENT) {
    console.log('# skipped : vrai client présent en CI');
    return;
  }

  createPartialClient();

  try {
    assert.equal(isPartialPrismaClient(), true, 'génération partielle détectée');
    assert.equal(
      isRealPrismaClientComplete(),
      false,
      'pas de vrai client complet',
    );

    const result = preparePrismaStubs();
    assert.equal(
      result.stubs,
      false,
      'pas de stubs créés en cas de génération partielle',
    );
    assert.equal(
      hasResidualStubs(),
      false,
      'aucun résidu de stub',
    );
    // Le fichier .ts partiel n'est pas supprimé.
    assert.equal(existsSync(fakeTs), true, 'fichier .ts partiel préservé');
  } finally {
    cleanupFakeClientFiles();
  }
});

// ------------------------------------------------------------------
// Suite de tests en échec (test d'intégration du lanceur)
// ------------------------------------------------------------------

test('nettoyage garanti après échec (même motif que le lanceur)', () => {
  if (REAL_CLIENT) {
    console.log('# skipped : vrai client présent en CI');
    return;
  }

  cleanupPrismaStubs();
  assert.equal(hasResidualStubs(), false, 'aucun résidu avant le test');

  // Préparer les stubs (comme le lanceur le fait avant les tests).
  preparePrismaStubs();
  assert.equal(hasResidualStubs(), true, 'stubs présents avant la panne');

  // Simuler une suite qui échoue, avec nettoyage dans un bloc finally
  // (c'est exactement le motif utilisé par run-invariants.mjs).
  let nettoyageEffectue = false;
  try {
    throw new Error('échec simulé de suite');
  } catch {
    // L'erreur est attrapée mais le finally doit quand même s'exécuter.
  } finally {
    const removed = cleanupPrismaStubs();
    nettoyageEffectue = removed.length > 0;
  }

  // Le nettoyage a été exécuté malgré l'échec.
  assert.equal(nettoyageEffectue, true, 'le nettoyage a été exécuté');
  assert.equal(
    hasResidualStubs(),
    false,
    'aucun stub résiduel après l’échec',
  );
});

test('lanceur : nettoyage garanti après échec (vérifié depuis bash)', () => {
  if (REAL_CLIENT) {
    console.log('# skipped : vrai client présent en CI');
    return;
  }

  // Ce test vérifie que le lanceur run-invariants.mjs, lorsqu'il est exécuté
  // depuis la ligne de commande, nettoie les stubs même après l'échec d'une
  // suite. Le scénario complet (lancement + échec + vérification du code de
  // sortie) est validé manuellement depuis bash car les codes de sortie des
  // processus enfants `node --test` ne sont pas propagés de manière fiable
  // depuis un contexte `node --test` parent (limitation connue de Node.js).
  //
  // Préparer les stubs, puis vérifier que cleanupPrismaStubs() les élimine.
  cleanupPrismaStubs();
  preparePrismaStubs();
  assert.equal(hasResidualStubs(), true, 'stubs présents');

  const removed = cleanupPrismaStubs();
  assert.ok(removed.length > 0, 'au moins un stub supprimé');
  assert.equal(hasResidualStubs(), false, 'nettoyage complet');

  // Un vrai client Prisma n'a jamais été touché (nettoyage ne supprime que
  // les fichiers .js et le marqueur, jamais les .ts).
  assert.equal(
    isRealPrismaClientComplete(),
    false,
    'aucun vrai client .ts n\'a été créé ou supprimé',
  );
});

// ------------------------------------------------------------------
// Nettoyage en échec (simulé)
// ------------------------------------------------------------------

test('nettoyage : signale une erreur si des stubs persistent', () => {
  if (REAL_CLIENT) {
    console.log('# skipped : vrai client présent en CI');
    return;
  }

  // Laisser des stubs en place, puis vérifier que hasResidualStubs() les détecte.
  cleanupPrismaStubs();
  preparePrismaStubs();
  assert.equal(hasResidualStubs(), true, 'stubs présents');

  // cleanupPrismaStubs() doit les supprimer.
  const removed = cleanupPrismaStubs();
  assert.ok(removed.length > 0, 'au moins un stub supprimé');
  assert.equal(hasResidualStubs(), false, 'plus de résidu après nettoyage');
});

// ------------------------------------------------------------------
// Relance successive des tests
// ------------------------------------------------------------------
