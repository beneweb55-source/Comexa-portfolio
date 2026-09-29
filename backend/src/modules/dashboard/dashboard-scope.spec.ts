import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException } from '../../common/errors/app-error.js';
import {
  clientSectionsFor,
  personalSectionsFor,
  resolvePerimeter,
  type PerimeterInput,
} from './dashboard-scope.js';

/**
 * Tests du PERIMETRE du tableau de bord.
 *
 * La propriete defendue ici est la seule qui compte vraiment : un porteur de
 * l'espace client ne peut pas obtenir la vue d'agence. On la teste donc dans sa
 * forme la plus hostile — un compte client a qui l'on aurait accorde, par
 * erreur, `dashboard:read:any`.
 */

function assertForbidden(run: () => unknown): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof AppException, `attendu AppException, recu ${String(error)}`);
    assert.equal(error.code, 'FORBIDDEN');
    return true;
  });
}

function input(overrides: Partial<PerimeterInput> = {}): PerimeterInput {
  return {
    isClient: false,
    clientId: null,
    hasAgencyScope: false,
    hasOwnScope: false,
    ...overrides,
  };
}

/**
 * Jeux de droits reels, recopies du catalogue.
 *
 * Les figer ici est volontaire : si le catalogue change, ce test tombe, et c'est
 * exactement ce qu'on veut savoir avant qu'un écran ne se vide en production.
 */
const CLIENT_PERMISSIONS = [
  'user:read:own',
  'client:read:own',
  'project:read:own',
  'milestone:read:any',
  'quote:read:own',
  'quote:accept:own',
  'invoice:read:own',
  'payment:read:own',
  'document:read:client',
  'conversation:read:own',
  'message:read:own',
  'notification:read:own',
  'notification:manage:own',
  'dashboard:read:own',
];

const DEVELOPER_PERMISSIONS = [
  'task:read:assigned',
  'task:write:own',
  'time:read:own',
  'time:write:own',
  'project:read:assigned',
  'notification:read:own',
  'dashboard:read:own',
];

describe('resolvePerimeter — quelle vue un porteur peut-il ouvrir', () => {
  it('donne la vue client a un porteur de l espace client', () => {
    assert.equal(resolvePerimeter(input({ isClient: true, clientId: 'cli_1', hasOwnScope: true })), 'client');
  });

  it('refuse la vue d agence a un client, MEME si la permission lui a ete accordee', () => {
    // Le cas hostile : une permission `dashboard:read:any` ajoutee par erreur au
    // role CLIENT. La regle « espace client d'abord » doit tenir.
    const perimeter = resolvePerimeter(
      input({ isClient: true, clientId: 'cli_1', hasAgencyScope: true, hasOwnScope: true }),
    );

    assert.equal(perimeter, 'client');
    assert.notEqual(perimeter, 'agency');
  });

  it('refuse un compte client sans fiche client, au lieu d elargir son perimetre', () => {
    // Donnee incoherente. Le repli naturel — « pas de clientId, donc on retombe
    // sur le perimetre suivant » — ouvrirait la vue d'agence a un client.
    assertForbidden(() => resolvePerimeter(input({ isClient: true, clientId: null, hasAgencyScope: true })));
    assertForbidden(() => resolvePerimeter(input({ isClient: true, clientId: null, hasOwnScope: true })));
    assertForbidden(() => resolvePerimeter(input({ isClient: true, clientId: '' })));
  });

  it('donne la vue d agence a un compte interne qui detient le scope', () => {
    assert.equal(resolvePerimeter(input({ hasAgencyScope: true })), 'agency');
  });

  it('retient la vue la plus large quand les deux scopes sont detenus', () => {
    assert.equal(resolvePerimeter(input({ hasAgencyScope: true, hasOwnScope: true })), 'agency');
  });

  it('retombe sur la vue personnelle quand seul le scope personnel est detenu', () => {
    assert.equal(resolvePerimeter(input({ hasOwnScope: true })), 'personal');
  });

  it('refuse un porteur sans aucun scope de tableau de bord', () => {
    assertForbidden(() => resolvePerimeter(input()));
  });

  it('ne traite pas un compte interne portant un clientId comme un client', () => {
    // Le role decide de l'espace, pas la donnee. Sinon un clientId renseigne sur
    // un compte interne le ferait basculer dans l'espace client.
    assert.equal(resolvePerimeter(input({ clientId: 'cli_1', hasAgencyScope: true })), 'agency');
  });
});

describe('personalSectionsFor — sections de la vue personnelle', () => {
  it('n ouvre aucune section interne a un porteur de l espace client', () => {
    const has = (code: string): boolean => CLIENT_PERMISSIONS.includes(code);

    assert.deepEqual(personalSectionsFor(has), {
      tasks: false,
      timeEntries: false,
      notifications: true,
    });
  });

  it('ouvre les taches et le temps a un membre de l equipe', () => {
    const has = (code: string): boolean => DEVELOPER_PERMISSIONS.includes(code);

    assert.deepEqual(personalSectionsFor(has), {
      tasks: true,
      timeEntries: true,
      notifications: true,
    });
  });

  it('n ouvre rien a un porteur sans droits', () => {
    assert.deepEqual(personalSectionsFor(() => false), {
      tasks: false,
      timeEntries: false,
      notifications: false,
    });
  });

  it('reconnait chacun des scopes de tache pris isolement', () => {
    for (const code of ['task:read:any', 'task:read:assigned', 'task:read:own']) {
      assert.equal(personalSectionsFor((candidate) => candidate === code).tasks, true, code);
    }
  });
});

describe('clientSectionsFor — sections de l espace client', () => {
  it('ouvre les cinq sections aux droits reels du role CLIENT', () => {
    const has = (code: string): boolean => CLIENT_PERMISSIONS.includes(code);

    assert.deepEqual(clientSectionsFor(has), {
      projects: true,
      invoices: true,
      quotes: true,
      documents: true,
      notifications: true,
    });
  });

  it('ferme les documents a un porteur qui n a que des droits internes', () => {
    // `document:read:own` ne suffit pas a ouvrir l'espace client : il faut le
    // scope client, qui est le seul a exiger la visibilite non INTERNAL.
    const has = (code: string): boolean => code === 'document:read:own';

    assert.equal(clientSectionsFor(has).documents, true);

    const interne = (code: string): boolean => code === 'project:read:assigned';
    assert.equal(clientSectionsFor(interne).documents, false);
    assert.equal(clientSectionsFor(interne).invoices, false);
  });

  it('n ouvre rien a un porteur sans droits', () => {
    assert.deepEqual(clientSectionsFor(() => false), {
      projects: false,
      invoices: false,
      quotes: false,
      documents: false,
      notifications: false,
    });
  });
});
