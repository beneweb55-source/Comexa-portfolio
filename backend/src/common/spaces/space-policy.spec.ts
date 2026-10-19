/**
 * ESPACES DE TRAVAIL — la politique, role par role, et son application par le
 * garde d'authentification.
 *
 * Les roles sont ceux du VRAI catalogue (`ROLE_PERMISSIONS`) : si une
 * permission est ajoutee a un role, ces tests disent immediatement dans quel
 * espace elle apparait.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Reflector } from '@nestjs/core';
import { ALL_PERMISSION_CODES, ROLE_PERMISSIONS } from '../auth/permissions.catalogue.js';
import type { AuthenticatedUser } from '../auth/principal.js';
import { AppException } from '../errors/app-error.js';
import { JwtAuthGuard } from '../guards/access.guards.js';
import { IgnoreSpace, REQUEST_USER_KEY } from '../decorators/auth.decorators.js';
import {
  COMEXA_ONLY,
  accessibleSpaces,
  canEnterSpace,
  effectivePermissions,
  spaceOfNotificationType,
  NOTIFICATION_TYPES_BY_SPACE,
} from './space-policy.js';

type Role = keyof typeof ROLE_PERMISSIONS;

function permissionsOf(role: Role): Set<string> {
  const granted = ROLE_PERMISSIONS[role];
  return new Set(granted === 'ALL' ? ALL_PERMISSION_CODES : granted);
}

function principal(role: Role, extra: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: `u-${role}`,
    email: `${role.toLowerCase()}@comexa.example`,
    firstName: role,
    lastName: 'Test',
    roles: [role as never],
    permissions: permissionsOf(role),
    clientId: role === 'CLIENT' ? 'c-1' : null,
    mustChangePassword: false,
    ...extra,
  };
}

describe('space-policy — acces aux espaces', () => {
  it("ouvre les trois espaces a l'administrateur", () => {
    assert.deepEqual(accessibleSpaces(principal('ADMIN')), ['personal', 'team', 'comexa']);
  });

  it('reserve Comexa Space aux roles qui administrent quelque chose', () => {
    assert.deepEqual(accessibleSpaces(principal('COMMUNICATION_MANAGER')), [
      'personal',
      'team',
      'comexa',
    ]);
    assert.deepEqual(accessibleSpaces(principal('PROJECT_MANAGER')), [
      'personal',
      'team',
      'comexa',
    ]);
    assert.deepEqual(accessibleSpaces(principal('SALES')), ['personal', 'team']);
    assert.deepEqual(accessibleSpaces(principal('DEVELOPER')), ['personal', 'team']);
    assert.deepEqual(accessibleSpaces(principal('SOCIAL_MEDIA_MANAGER')), ['personal', 'team']);
  });

  it('ouvre Comexa Space à un porteur qui ne détient que des droits financiers', () => {
    const financeReader = principal('SALES', {
      permissions: new Set(['currency:read:any', 'exchangerate:read:any']),
    });
    assert.deepEqual(accessibleSpaces(financeReader), ['comexa']);
  });

  it("n'ouvre aucun espace a un client ni a une machine", () => {
    assert.deepEqual(accessibleSpaces(principal('CLIENT')), []);
    assert.deepEqual(accessibleSpaces(principal('ADMIN', { isIntegration: true, roles: [] })), []);
  });
});

describe('space-policy — droits effectifs', () => {
  it('ne donne jamais un droit absent du catalogue', () => {
    const catalogue = new Set<string>(ALL_PERMISSION_CODES);
    for (const role of Object.keys(ROLE_PERMISSIONS) as Role[]) {
      for (const space of ['personal', 'team', 'comexa'] as const) {
        for (const code of effectivePermissions(space, permissionsOf(role))) {
          assert.ok(catalogue.has(code), `${role}/${space} : ${code} hors catalogue`);
        }
      }
    }
  });

  it('espace personnel : uniquement des portees « a moi », meme pour un administrateur', () => {
    const personal = effectivePermissions('personal', permissionsOf('ADMIN'));
    for (const code of personal) {
      assert.match(code, /:(own|assigned|personal)$/, `${code} n'est pas personnel`);
    }
    assert.ok(personal.has('task:read:assigned'), 'task:read:any devient « mes taches assignees »');
    assert.ok(personal.has('time:read:own'), 'time:read:any devient « mon temps »');
    assert.ok(!personal.has('invoice:read:any'));
    assert.ok(!personal.has('calendar:read:team'));
  });

  it("espace personnel : une retrogradation n'ajoute rien a qui n'avait pas le droit large", () => {
    const socialMedia = effectivePermissions('personal', permissionsOf('SOCIAL_MEDIA_MANAGER'));
    assert.ok(!socialMedia.has('time:write:any'));
    assert.ok(!socialMedia.has('dashboard:read:any'));
    const sales = effectivePermissions('personal', permissionsOf('SALES'));
    assert.ok(!sales.has('task:read:assigned'), "SALES n'a ni task:read:any ni task:read:assigned");
    assert.ok(sales.has('task:read:own'));
  });

  it("espace equipe : ni administration de l'organisation, ni donnees privees", () => {
    const team = effectivePermissions('team', permissionsOf('ADMIN'));
    for (const code of COMEXA_ONLY)
      assert.ok(!team.has(code), `${code} ne doit pas sortir en equipe`);
    assert.ok(!team.has('task:read:personal'));
    assert.ok(!team.has('calendar:read:own'));
    assert.ok(team.has('invoice:read:any'));
    assert.ok(team.has('user:read:any'), 'les selecteurs de membres restent utilisables');
  });

  it('Comexa Space : administration seulement, aucune donnee commerciale ni de production', () => {
    const comexa = effectivePermissions('comexa', permissionsOf('ADMIN'));
    assert.ok(comexa.has('user:manage:any'));
    assert.ok(comexa.has('integration:manage:any'));
    assert.ok(comexa.has('faq:write:any'));
    assert.ok(comexa.has('currency:read:any'));
    assert.ok(comexa.has('currency:manage:any'));
    assert.ok(comexa.has('exchangerate:read:any'));
    assert.ok(comexa.has('exchangerate:manage:any'));
    assert.ok(!comexa.has('invoice:read:any'));
    assert.ok(!comexa.has('task:read:any'));
    assert.ok(!comexa.has('telegram:link:any'), "reserve aux jetons d'integration");
  });

  it('un espace est toujours un sous-ensemble du role (hors retrogradations incluses)', () => {
    const downgrades = new Set([
      'task:read:assigned',
      'task:write:own',
      'time:read:own',
      'time:write:own',
      'dashboard:read:own',
      'project:read:assigned',
    ]);
    for (const role of Object.keys(ROLE_PERMISSIONS) as Role[]) {
      const granted = permissionsOf(role);
      for (const space of ['personal', 'team', 'comexa'] as const) {
        for (const code of effectivePermissions(space, granted)) {
          assert.ok(
            granted.has(code) || downgrades.has(code),
            `${role}/${space} : ${code} non detenu`,
          );
        }
      }
    }
  });

  it('range chaque notification dans un seul espace', () => {
    assert.equal(spaceOfNotificationType('TASK_ASSIGNED'), 'personal');
    assert.equal(spaceOfNotificationType('INVOICE_OVERDUE'), 'team');
    assert.equal(spaceOfNotificationType('SYSTEM'), 'comexa');
    const all = Object.values(NOTIFICATION_TYPES_BY_SPACE).flat();
    assert.equal(new Set(all).size, all.length, 'aucun type dans deux espaces');
  });
});

// -----------------------------------------------------------------------------
// Application par le garde
// -----------------------------------------------------------------------------

class Cible {
  route() {}
  @IgnoreSpace()
  routeHorsEspace() {}
}

function contexte(handler: unknown, request: Record<string, unknown>) {
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => Cible,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as never;
}

function garde(user: AuthenticatedUser) {
  return new JwtAuthGuard(
    new Reflector(),
    { verifyAccessToken: async () => ({ sub: user.id }) },
    { load: async () => user },
  );
}

async function requete(
  user: AuthenticatedUser,
  space: string | undefined,
  handler: unknown = Cible.prototype.route,
) {
  const request: Record<string, unknown> = {
    headers: {
      authorization: 'Bearer eyJ.fake.jwt',
      ...(space ? { 'x-comexa-space': space } : {}),
    },
  };
  await garde(user).canActivate(contexte(handler, request));
  return request[REQUEST_USER_KEY] as AuthenticatedUser;
}

describe('JwtAuthGuard — en-tete X-Comexa-Space', () => {
  it('sans en-tete : droits du role, aucun espace', async () => {
    const user = await requete(principal('ADMIN'), undefined);
    assert.equal(user.space, undefined);
    assert.ok(user.permissions.has('invoice:read:any'));
  });

  it("restreint les droits de la requete a l'espace annonce", async () => {
    const user = await requete(principal('ADMIN'), 'personal');
    assert.equal(user.space, 'personal');
    assert.ok(!user.permissions.has('invoice:read:any'));
    assert.ok(user.permissions.has('task:read:personal'));
    assert.ok(user.rolePermissions?.has('invoice:read:any'), 'les droits du role restent connus');
  });

  it('refuse un espace non accessible (403) et une valeur inconnue (400)', async () => {
    await assert.rejects(
      requete(principal('DEVELOPER'), 'comexa'),
      (error) =>
        error instanceof AppException &&
        error.code === 'SPACE_FORBIDDEN' &&
        error.getStatus() === 403,
    );
    await assert.rejects(
      requete(principal('ADMIN'), 'galaxie'),
      (error) =>
        error instanceof AppException &&
        error.code === 'SPACE_INVALID' &&
        error.getStatus() === 400,
    );
    await assert.rejects(
      requete(principal('CLIENT'), 'team'),
      (error) => error instanceof AppException && error.code === 'SPACE_FORBIDDEN',
    );
  });

  it('laisse intacte une route marquee @IgnoreSpace', async () => {
    const user = await requete(principal('ADMIN'), 'personal', Cible.prototype.routeHorsEspace);
    assert.equal(user.space, undefined);
    assert.ok(user.permissions.has('invoice:read:any'));
  });

  it('canEnterSpace et le garde disent la meme chose', () => {
    assert.equal(canEnterSpace('comexa', principal('SALES')), false);
    assert.equal(canEnterSpace('team', principal('SALES')), true);
  });
});
