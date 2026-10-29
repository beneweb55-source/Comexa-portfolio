/**
 * Validation autonome du lanceur run-invariants.mjs.
 *
 * Ce script s'exécute HORS du contexte `node --test` (directement avec `node`)
 * afin de pouvoir vérifier de manière fiable le code de sortie du lanceur
 * lorsque la suite de test enfant échoue.
 *
 * Scénarios testés :
 *  1. Suite défaillante : le lanceur retourne un code de sortie non nul et
 *     nettoie les stubs malgré l'échec.
 *  2. Suite réussie : le lanceur retourne 0 et nettoie les stubs.
 *  3. Vrai client Prisma présent : le lanceur ne crée pas de stubs et ne
 *     touche pas aux fichiers .ts du vrai client.
 *
 * Usage : node tests/helpers/validate-launcher.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const backendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const generatedDir = path.join(backendRoot, 'src', 'generated', 'prisma');
const launcher = path.join(backendRoot, 'tests', 'helpers', 'run-invariants.mjs');
const failingFixture = path.join(
  backendRoot,
  'tests',
  'fixtures',
  'failing-suite.test.mjs',
);
const okFixture = path.join(backendRoot, 'tests', 'client-isolation.test.mjs');

let failures = 0;

/** Exécuter une commande et retourner { code, stdout, stderr }. */
function run(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      stdio: 'pipe',
      cwd: backendRoot,
      env: { ...process.env, NODE_OPTIONS: undefined },
      ...opts,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) =>
      resolve({ code: code ?? 1, stdout, stderr }),
    );
  });
}

/** Vérifier qu'aucun stub ne subsiste. */
function assertNoStubs(label) {
  const stubs = ['enums.js', 'client.js', '.prisma-stubs-marker'].map((f) =>
    path.join(generatedDir, f),
  );
  const remaining = stubs.filter((f) => existsSync(f));
  if (remaining.length > 0) {
    console.error(`  ✗ ${label} : stubs résiduels : ${remaining.join(', ')}`);
    failures += 1;
  } else {
    console.log(`  ✓ ${label} : aucun stub résiduel`);
  }
}

/** Vérifier qu'aucun vrai client .ts n'a été créé/supprimé. */
function assertNoRealClientFiles(label) {
  const tsFiles = ['enums.ts', 'client.ts'].map((f) =>
    path.join(generatedDir, f),
  );
  const present = tsFiles.filter((f) => existsSync(f));
  if (present.length > 0) {
    console.error(
      `  ✗ ${label} : fichiers .ts présents (vrai client affecté) : ${present.join(', ')}`,
    );
    failures += 1;
  } else {
    console.log(`  ✓ ${label} : aucun fichier .ts du vrai client`);
  }
}

async function main() {
  console.log('=== Validation autonome du lanceur run-invariants.mjs ===\n');

  // ------------------------------------------------------------------
  // Scénario 1 : suite défaillante
  // ------------------------------------------------------------------
  console.log('1. Suite défaillante (failing-suite.test.mjs) :');

  // S'assurer qu'aucun stub n'est présent au départ.
  mkdirSync(generatedDir, { recursive: true });
  for (const f of ['enums.js', 'client.js', '.prisma-stubs-marker']) {
    const p = path.join(generatedDir, f);
    if (existsSync(p)) unlinkSync(p);
  }

  const result1 = await run([launcher, failingFixture]);
  console.log(`     code de sortie : ${result1.code}`);
  console.log(`     sortie : ${result1.stdout.trim().slice(0, 120)}...`);

  if (result1.code === 0) {
    console.error(
      '  ✗ ÉCHEC : le code de sortie devrait être non nul pour une suite défaillante',
    );
    failures += 1;
  } else {
    console.log(`  ✓ code de sortie non nul (${result1.code}) : échec détecté`);
  }

  assertNoStubs('après suite défaillante');
  assertNoRealClientFiles('après suite défaillante');

  // ------------------------------------------------------------------
  // Scénario 2 : suite réussie
  // ------------------------------------------------------------------
  console.log('\n2. Suite réussie (client-isolation.test.mjs) :');

  const result2 = await run([launcher, okFixture]);
  console.log(`     code de sortie : ${result2.code}`);

  if (result2.code !== 0) {
    console.error(
      `  ✗ ÉCHEC : le code de sortie devrait être 0 pour une suite réussie, reçu ${result2.code}`,
    );
    console.error(`     sortie : ${result2.stdout.trim().slice(0, 200)}`);
    failures += 1;
  } else {
    console.log('  ✓ code de sortie 0 : succès');
  }

  assertNoStubs('après suite réussie');
  assertNoRealClientFiles('après suite réussie');

  // ------------------------------------------------------------------
  // Scénario 3 : aucun client, stubs créés puis nettoyés
  // ------------------------------------------------------------------
  console.log('\n3. Aucun client : stubs créés, utilisés, nettoyés :');

  const result3 = await run([launcher]);
  console.log(`     code de sortie : ${result3.code}`);

  if (result3.code !== 0) {
    console.error(
      `  ✗ ÉCHEC : le code de sortie devrait être 0, reçu ${result3.code}`,
    );
    failures += 1;
  } else {
    console.log('  ✓ code de sortie 0');
  }

  assertNoStubs('après exécution complète');
  assertNoRealClientFiles('après exécution complète');

  // ------------------------------------------------------------------
  // Résultat
  // ------------------------------------------------------------------
  console.log(`\n=== Résultat : ${failures === 0 ? 'SUCCÈS' : failures + ' ÉCHEC(S)'} ===`);

  process.exitCode = failures > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(`Erreur fatale : ${error.message}`);
  process.exitCode = 1;
});
