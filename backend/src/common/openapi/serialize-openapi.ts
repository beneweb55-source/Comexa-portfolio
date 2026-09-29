import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * SERIALISATION DU DOCUMENT OpenAPI — EN UN SEUL ENDROIT, POUR DEUX APPELANTS.
 *
 * Le document est produit par `configureApp`, puis il est :
 *   - ecrit sur disque par `scripts/export-openapi.ts`, vers
 *     `shared/api/openapi.json` — le contrat que lit le frontend ;
 *   - relu depuis le disque et compare a sa version fraiche par
 *     `test/docs.e2e-spec.ts`, qui echoue si le fichier committe a pris du
 *     retard sur le code.
 *
 * Ces deux appelants DOIVENT produire exactement la meme chaine. Une difference
 * d'indentation, ou un saut de ligne final d'un seul cote, suffirait a faire
 * echouer la comparaison — pour une raison qui n'a rien a voir avec l'API, et
 * qui enverrait chercher une derive inexistante dans les DTO. Un
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
 * assume. Sa place est dictee par les deux configurations de compilation :
 * `tsconfig.export.json` et `tsconfig.e2e.json` incluent l'un et l'autre `src/`,
 * et c'est le seul dossier qui leur soit commun — un script ne peut pas importer
 * depuis `test/`, et une spec ne peut pas importer depuis `scripts/`. Le deplacer
 * casserait donc l'un des deux appelants. Le cout est de quelques centaines
 * d'octets dans un artefact de plusieurs megaoctets ; l'alternative etait de
 * dupliquer la serialisation, ce qui est precisement le defaut que ce fichier
 * existe pour eviter. Ne pas le « nettoyer » : `test/docs.e2e-spec.ts` en depend.
 */
export function serializeOpenApi(document: OpenAPIObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
