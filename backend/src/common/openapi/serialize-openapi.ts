import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * SERIALISATION DU DOCUMENT OpenAPI — EN UN SEUL ENDROIT.
 *
 * Le document est produit par `configureApp`, puis ecrit sur disque par
 * `scripts/export-openapi.ts`, vers `shared/api/openapi.json` — le contrat que
 * lit le frontend. La serialisation vit ici, et nulle part ailleurs : un
 * `JSON.stringify` recopie a deux endroits est precisement le genre de
 * duplication que ce depot refuse ailleurs (voir `shared/README.md`, qui
 * l'assume pour les types et l'encadre par une regle) : il n'y a pas de raison
 * d'en introduire une ici, ou l'eviter ne coute rien.
 *
 * LE SAUT DE LIGNE FINAL N'EST PAS COSMETIQUE. Sans lui, POSIX considere le
 * fichier comme une ligne incomplete, et `git diff` affiche « \ Pas de fin de
 * ligne » a chaque modification — un bruit qui revient dans chaque revue.
 *
 * CE FICHIER EST LIVRE DANS `dist/` SANS ETRE APPELE PAR L'APPLICATION, et c'est
 * assume. Il vit dans `src/` parce que c'est le seul dossier que
 * `tsconfig.export.json` et `tsconfig.build.json` ont en commun : un script ne
 * peut pas importer depuis `src/`, et un module de `src/` ne peut pas importer
 * depuis `scripts/`. Le deplacer casserait donc l'appelant. Le cout est de
 * quelques centaines d'octets dans un artefact de plusieurs megaoctets ;
 * l'alternative etait de dupliquer la serialisation, ce qui est precisement le
 * defaut que ce fichier existe pour eviter.
 */
export function serializeOpenApi(document: OpenAPIObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
