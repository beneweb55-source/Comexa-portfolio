import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RoleCode } from '../../generated/prisma/enums.js';
import {
  assertAdministratorRemains,
  assertNotLastActiveAdministrator,
  assertNotSelfAccount,
  assertRoleIsMutable,
  assertRolesKnown,
  isKnownRoleCode,
  unknownCodes,
  type RoleChange,
} from './identity-rules.js';

/**
 * TESTS DES INVARIANTS D'IDENTITE.
 *
 * Ces regles ne sont PAS testables par HTTP de facon exhaustive : la base de
 * developpement contient toujours au moins un administrateur (le seed cree
 * `admin@comexa.example`), donc la branche « dernier administrateur » n'est
 * jamais atteinte en e2e. Elle est pourtant la seule qui protege contre la
 * panne qui coute une journee — une agence sans personne capable d'attribuer
 * des droits. Elle est donc verifiee ici, exhaustivement, sur des fonctions
 * pures : aucun Prisma a monter, aucun cas a provoquer en base.
 *
 * Le nombre d'administrateurs est un PARAMETRE de ces fonctions, pas une lecture
 * qu'elles feraient elles-memes. C'est ce qui permet d'ecrire le cas « il n'en
 * reste qu'un » en une ligne, alors qu'il demanderait de demonter la base pour
 * etre produit en integration.
 */

const ACTOR = 'user-actor';
const TARGET = 'user-target';

/** Un changement de roles, avec des valeurs par defaut plausibles. */
function change(overrides: Partial<RoleChange> = {}): RoleChange {
  return {
    actorId: ACTOR,
    targetId: TARGET,
    currentRoles: [RoleCode.DEVELOPER],
    nextRoles: [RoleCode.PROJECT_MANAGER],
    targetIsActive: true,
    activeAdminCount: 3,
    ...overrides,
  };
}

/** Verifie que la fonction leve bien une AppException portant ce code. */
function assertCode(code: string, details?: unknown): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof Error, 'une erreur est attendue');
    assert.equal((error as { code?: unknown }).code, code);
    if (details !== undefined) {
      assert.deepEqual((error as { details?: unknown }).details, details);
    }
    return true;
  };
}

describe('unknownCodes', () => {
  it('rend les codes absents de l\'ensemble connu', () => {
    assert.deepEqual(unknownCodes(['A', 'B', 'C'], ['A', 'C']), ['B']);
  });

  it('rend une liste vide quand tout est connu', () => {
    assert.deepEqual(unknownCodes(['A'], ['A', 'B']), []);
  });

  it('repete un code fautif demande deux fois, sans dedoublonner', () => {
    // Le doublon est conserve dans le RAPPORT. C'est voulu : la liste rendue
    // decrit ce qui a ete recu, pas ce qu'on en pense. Dedoublonner ici ferait
    // disparaitre l'information qu'un appelant a envoye deux fois la meme chose,
    // qui est justement le signe d'un client qui construit mal sa charge utile.
    assert.deepEqual(unknownCodes(['Z', 'A', 'Z'], ['A']), ['Z', 'Z']);
  });
});

describe('isKnownRoleCode', () => {
  it('reconnait les sept valeurs de l\'enumeration', () => {
    for (const code of Object.values(RoleCode)) {
      assert.equal(isKnownRoleCode(code), true, `${code} doit etre reconnu`);
    }
  });

  it('refuse une valeur inconnue, vide ou mal cassee', () => {
    // La casse compte : `admin` minuscule n'est pas une valeur de l'enumeration,
    // et Prisma leverait une erreur de validation si on la lui passait — donc un
    // 500 la ou on veut un 404.
    for (const value of ['SUPERADMIN', 'admin', '', 'ROOT', 'ADMIN ']) {
      assert.equal(isKnownRoleCode(value), false, `${value} ne doit pas etre reconnu`);
    }
  });
});

describe('assertNotSelfAccount', () => {
  it('laisse passer une operation sur un autre compte', () => {
    assert.doesNotThrow(() => assertNotSelfAccount(ACTOR, TARGET, 'DELETE'));
    assert.doesNotThrow(() => assertNotSelfAccount(ACTOR, TARGET, 'SUSPEND'));
  });

  it('refuse de se supprimer soi-meme', () => {
    assert.throws(() => assertNotSelfAccount(ACTOR, ACTOR, 'DELETE'), assertCode('SELF_DELETE_FORBIDDEN'));
  });

  it('refuse de se suspendre soi-meme', () => {
    // Le code est distinct de celui de la suppression : le frontend doit pouvoir
    // afficher deux messages differents, et l'un des deux est un geste qu'on
    // annule en cliquant sur « reactiver », l'autre non.
    assert.throws(() => assertNotSelfAccount(ACTOR, ACTOR, 'SUSPEND'), assertCode('SELF_SUSPEND_FORBIDDEN'));
  });
});

describe('assertRolesKnown', () => {
  it('laisse passer quand tous les codes existent en base', () => {
    assert.doesNotThrow(() => assertRolesKnown(['DEVELOPER', 'SALES'], ['DEVELOPER', 'SALES', 'ADMIN']));
  });

  it('laisse passer une liste vide', () => {
    // Retirer tous les roles est legitime : c'est ainsi qu'on coupe les droits
    // sans suspendre le compte.
    assert.doesNotThrow(() => assertRolesKnown([], ['DEVELOPER']));
  });

  it('refuse un code absent et le nomme dans les details', () => {
    assert.throws(
      () => assertRolesKnown(['DEVELOPER', 'SUPERADMIN'], ['DEVELOPER']),
      assertCode('UNKNOWN_ROLE', { roles: ['SUPERADMIN'] }),
    );
  });
});

describe('assertRoleIsMutable', () => {
  it('refuse toute modification du role ADMIN', () => {
    assert.throws(() => assertRoleIsMutable(RoleCode.ADMIN), assertCode('ROLE_IMMUTABLE'));
  });

  it('accepte les six autres roles', () => {
    for (const code of Object.values(RoleCode)) {
      if (code === RoleCode.ADMIN) {
        continue;
      }
      assert.doesNotThrow(() => assertRoleIsMutable(code), `${code} doit etre modifiable`);
    }
  });
});

describe('assertAdministratorRemains', () => {
  it('laisse passer un changement qui ne touche pas ADMIN', () => {
    assert.doesNotThrow(() =>
      assertAdministratorRemains(
        change({ currentRoles: [RoleCode.DEVELOPER], nextRoles: [RoleCode.SALES] }),
      ),
    );
  });

  it('laisse passer un changement qui CONSERVE ADMIN', () => {
    assert.doesNotThrow(() =>
      assertAdministratorRemains(
        change({ currentRoles: [RoleCode.ADMIN], nextRoles: [RoleCode.ADMIN, RoleCode.SALES] }),
      ),
    );
  });

  it('laisse passer l\'AJOUT de ADMIN', () => {
    assert.doesNotThrow(() =>
      assertAdministratorRemains(
        change({ currentRoles: [RoleCode.DEVELOPER], nextRoles: [RoleCode.DEVELOPER, RoleCode.ADMIN] }),
      ),
    );
  });

  it('refuse de se retirer son propre ADMIN, meme s\'il en reste cinq', () => {
    // La regle 1 passe AVANT celle du dernier administrateur : se demettre
    // soi-meme reste interdit quel que soit leur nombre.
    assert.throws(
      () =>
        assertAdministratorRemains(
          change({
            actorId: ACTOR,
            targetId: ACTOR,
            currentRoles: [RoleCode.ADMIN],
            nextRoles: [],
            activeAdminCount: 6,
          }),
        ),
      assertCode('SELF_ADMIN_REMOVAL_FORBIDDEN'),
    );
  });

  it('donne la priorite a la regle du soi-meme quand il est aussi le dernier', () => {
    // Les deux regles s'appliqueraient. C'est la premiere qui sort, et le
    // message qu'elle porte est le bon : se demettre soi-meme se corrige en
    // demandant a un collegue, alors qu'il ne reste personne.
    assert.throws(
      () =>
        assertAdministratorRemains(
          change({
            actorId: ACTOR,
            targetId: ACTOR,
            currentRoles: [RoleCode.ADMIN],
            nextRoles: [RoleCode.SALES],
            activeAdminCount: 1,
          }),
        ),
      assertCode('SELF_ADMIN_REMOVAL_FORBIDDEN'),
    );
  });

  it('refuse de retirer ADMIN au dernier administrateur actif', () => {
    assert.throws(
      () =>
        assertAdministratorRemains(
          change({
            currentRoles: [RoleCode.ADMIN],
            nextRoles: [RoleCode.SALES],
            targetIsActive: true,
            activeAdminCount: 1,
          }),
        ),
      assertCode('LAST_ADMIN_PROTECTED', { activeAdminCount: 1 }),
    );
  });

  it('accepte quand il reste un autre administrateur actif', () => {
    assert.doesNotThrow(() =>
      assertAdministratorRemains(
        change({
          currentRoles: [RoleCode.ADMIN],
          nextRoles: [],
          targetIsActive: true,
          activeAdminCount: 2,
        }),
      ),
    );
  });

  it('accepte de retirer ADMIN a un compte SUSPENDU qui est le dernier a le porter', () => {
    // Un compte suspendu ne compte pas parmi les administrateurs actifs : lui
    // retirer le role ne reduit pas leur nombre, et le refus n'aurait aucun
    // fondement. C'est le cas qui distingue « dernier a porter ADMIN » de
    // « dernier administrateur ACTIF », et cette nuance se perdrait dans un test
    // HTTP ou le compte vise serait toujours actif.
    assert.doesNotThrow(() =>
      assertAdministratorRemains(
        change({
          currentRoles: [RoleCode.ADMIN],
          nextRoles: [],
          targetIsActive: false,
          activeAdminCount: 1,
        }),
      ),
    );
  });

  it('refuse aussi quand le compte vise n\'a plus aucun role', () => {
    assert.throws(
      () =>
        assertAdministratorRemains(
          change({
            currentRoles: [RoleCode.ADMIN, RoleCode.SALES],
            nextRoles: [],
            targetIsActive: true,
            activeAdminCount: 1,
          }),
        ),
      assertCode('LAST_ADMIN_PROTECTED'),
    );
  });
});

describe('assertNotLastActiveAdministrator', () => {
  it('laisse passer quand la cible n\'est pas un administrateur actif', () => {
    assert.doesNotThrow(() =>
      assertNotLastActiveAdministrator(false, 1, 'message qui ne doit jamais sortir'),
    );
  });

  it('laisse passer quand plusieurs administrateurs actifs subsistent', () => {
    assert.doesNotThrow(() => assertNotLastActiveAdministrator(true, 2, 'message'));
  });

  it('refuse le dernier administrateur actif et publie le compte', () => {
    // `activeAdminCount` est dans les details : le frontend peut alors expliquer
    // la situation (« il ne reste qu\'un administrateur actif ») sans avoir a la
    // deduire d\'un message traduit.
    assert.throws(() => assertNotLastActiveAdministrator(true, 1, 'message'), assertCode('LAST_ADMIN_PROTECTED', {
      activeAdminCount: 1,
    }));
  });
});
