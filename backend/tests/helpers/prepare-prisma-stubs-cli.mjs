/**
 * Prépare les stubs Prisma HORS LIGNE avant les suites backend.
 *
 * `business-invariants.test.mjs` appelait déjà `preparePrismaStubs()` pendant
 * son import. Or `node --test` résout les imports statiques de TOUS les fichiers
 * avant d'exécuter le premier : `admin-policy.test.mjs` et les nouvelles suites
 * pouvaient donc échouer sur `src/generated/prisma/enums.js` absent selon
 * l'ordre des fichiers. Ce CLI déplace la préparation dans `pretest:invariants`,
 * avant toute résolution de test.
 *
 * Il ne fabrique AUCUNE déclaration TypeScript et ne touche pas au build Nest.
 * Si un vrai client Prisma généré existe, `preparePrismaStubs()` ne fait rien.
 */
import { preparePrismaStubs } from "./prisma-stubs.mjs";

preparePrismaStubs();
