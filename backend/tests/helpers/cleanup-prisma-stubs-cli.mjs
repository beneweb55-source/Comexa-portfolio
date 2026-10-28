/**
 * Nettoyer les stubs Prisma après les suites backend.
 *
 * Appelé par `posttest:invariants`, après l'exécution des tests, y compris
 * lorsqu'une suite a échoué. Garantit qu'aucun fichier factice ne subsiste
 * dans src/generated/prisma/ et qu'un lancement ultérieur du backend n'utilise
 * jamais accidentellement un client factice.
 *
 * Ne touche jamais à un vrai client généré (.ts).
 */
import { cleanupPrismaStubs, hasResidualStubs } from './prisma-stubs.mjs';

const removed = cleanupPrismaStubs();

if (removed.length) {
  console.log(`[prisma-stubs] nettoyage : ${removed.join(', ')} supprimés`);
} else if (hasResidualStubs()) {
  console.log('[prisma-stubs] aucun stub à supprimer (nettoyage déjà effectué)');
} else {
  console.log('[prisma-stubs] aucun stub résiduel');
}
