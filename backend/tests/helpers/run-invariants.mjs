/**
 * Lanceur de la suite d'invariants backend avec nettoyage garanti des stubs Prisma.
 *
 * Ce script remplace l'appel direct a `node --test` pour s'assurer que :
 *  1. preparePrismaStubs() est appele avant les tests ;
 *  2. cleanupPrismaStubs() est appele dans un bloc finally, quel que soit le
 *    resultat des tests (succes, echec, interruption par signal) ;
 *  3. le code de sortie reel de la suite est restitue (un echec de test ne
 *    est jamais masque par un nettoyage reussi) ;
 *  4. les suites sont executees SEQUENTIELLEMENT (un fichier a la fois) pour
 *    eliminer les courses sur backend/src/generated/prisma/ ;
 *  5. si le nettoyage echoue, l'erreur est signalee sans masquer l'echec des
 *    tests.
 *
 * Usage :
 *  - node tests/helpers/run-invariants.mjs
 *      (execute toutes les suites d'invariants)
 *  - node tests/helpers/run-invariants.mjs tests/une-suite.test.mjs
 *      (execute uniquement les fichiers specifiés)
 *
 * Le code de sortie est :
 *  - 0 si toutes les suites reussissent et le nettoyage reussit ;
 *  - le premier code de sortie non nul d'une suite si des tests echouent ;
 *  - 1 si le nettoyage echoue (et aucune suite n'a echoue) ;
 *  - le code de sortie de la suite si une suite et un nettoyage echouent.
 */

import { preparePrismaStubs, cleanupPrismaStubs, hasResidualStubs } from './prisma-stubs.mjs';
import { spawn } from 'node:child_process';

const DEFAULT_TEST_FILES = [
  'tests/business-invariants.test.mjs',
  'tests/client-isolation.test.mjs',
  'tests/admin-policy.test.mjs',
  'tests/notification-routing.test.mjs',
  'tests/prisma-stubs-isolation.test.mjs',
];

const TEST_FILES = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : DEFAULT_TEST_FILES;

/** Exécuter un fichier de test comme processus enfant, attendre sa fin. */
function runTestFile(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--test', file], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (error) => {
      console.error(`[run-invariants] Erreur lors du lancement de ${file}: ${error.message}`);
      resolve(1);
    });
  });
}

let firstTestFailure = 0;
let cleanupError = null;

try {
  // Preparer l'environnement (stubs ou detection du vrai client).
  preparePrismaStubs();

  // Executer les suites SEQUENTIELLEMENT pour eliminer les courses
  // sur src/generated/prisma/.
  for (const file of TEST_FILES) {
    const code = await runTestFile(file);
    if (code !== 0 && firstTestFailure === 0) {
      firstTestFailure = code;
      // On continue d'executer les suites restantes pour laisser le
      // lanceur arriver au bloc finally et garantir le nettoyage.
    }
  }
} catch (error) {
  console.error(`[run-invariants] Erreur inattendue : ${error.message}`);
  firstTestFailure = firstTestFailure || 1;
} finally {
  // Nettoyage GARANTI : execute meme si les tests echouent ou sont interrompus.
  try {
    const removed = cleanupPrismaStubs();
    if (hasResidualStubs()) {
      console.error(
        '[run-invariants] ERREUR : des stubs residuels persistent apres nettoyage',
      );
      cleanupError = new Error('stubs residuels apres nettoyage');
    } else if (removed.length > 0) {
      console.log(`[run-invariants] nettoyage : ${removed.join(', ')} supprimes`);
    } else {
      console.log('[run-invariants] aucun stub residuel');
    }
  } catch (error) {
    console.error(`[run-invariants] Erreur lors du nettoyage : ${error.message}`);
    cleanupError = error;
  }
}

// Restituer le code de sortie reel : echec des tests avant echec de nettoyage.
if (firstTestFailure !== 0) {
  process.exitCode = firstTestFailure;
} else if (cleanupError !== null) {
  process.exitCode = 1;
}
