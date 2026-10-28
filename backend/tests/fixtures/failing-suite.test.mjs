/**
 * Fixture de test dédiée pour le test d'intégration du lanceur.
 *
 * Cette suite échoue volontairement et n'est PAS incluse dans la liste
 * DEFAULT_TEST_FILES de run-invariants.mjs. Elle est utilisée uniquement
 * par le test d'intégration "lanceur : échec volontaire détecté et nettoyé"
 * dans prisma-stubs-isolation.test.mjs.
 *
 * Elle permet de vérifier que :
 *  - le lanceur retourne un code de sortie non nul ;
 *  - le nettoyage des stubs est exécuté malgré l'échec ;
 *  - aucun stub résiduel ne subsiste.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

test('suite volontairement défaillante pour test du lanceur', () => {
  assert.fail('échec simulé par la fixture dédiée du lanceur');
});
