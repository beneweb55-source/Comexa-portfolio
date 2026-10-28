/**
 * Préparer les stubs Prisma HORS LIGNE avant les suites backend.
 *
 * Appelé par `pretest:invariants`, avant toute résolution de test.
 *
 * - Si un vrai client Prisma généré est présent (fichiers .ts dans
 *   src/generated/prisma/), aucun stub n'est créé et les éventuels anciens
 *   stubs sont supprimés : le vrai client est prioritaire.
 * - Sinon, les stubs .js sont créés dans src/generated/prisma/ pour que les
 *   tests puissent s'exécuter hors ligne.
 *
 * Il ne fabrique aucune déclaration TypeScript et ne touche pas au build Nest.
 * Idempotent.
 */
import { preparePrismaStubs } from './prisma-stubs.mjs';

const result = preparePrismaStubs();

if (result.generated) {
  console.log(
    '[prisma-stubs] vrai client Prisma détecté — stubs non créés' +
      (result.cleaned ? ' ; anciens stubs supprimés' : ''),
  );
} else {
  console.log('[prisma-stubs] stubs créés pour les tests hors ligne');
}
