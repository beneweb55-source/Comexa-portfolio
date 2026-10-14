/**
 * LES DEUX MONDES DE L'AUTHENTIFICATION, VERIFIES SANS BASE DE DONNEES.
 *
 * -----------------------------------------------------------------------------
 * POURQUOI CES TESTS PEUVENT SE PASSER DE POSTGRESQL
 * -----------------------------------------------------------------------------
 * `JwtAuthGuard` ne parle JAMAIS a la base : il depend de deux INTERFACES
 * (`AccessTokenVerifier`, `PrincipalLoader`) et, depuis les jetons
 * d'integration, d'une troisieme (`IntegrationPrincipalResolver`). Le commentaire
 * du garde le dit deja — « un test peut fournir un verificateur de complaisance
 * sans monter de module Nest » — et c'est exactement ce que fait ce fichier.
 *
 * Ce qui est donc prouve ici est le CHEMINEMENT, pas la donnee :
 *   - un `cxi_...` part vers le resolveur d'integration et jamais vers le
 *     verificateur JWT ;
 *   - un JWT part vers le verificateur et jamais vers le resolveur ;
 *   - l'absence de jeton, un jeton revoque et un module d'integration absent
 *     sont trois refus distincts, tous en 401 ;
 *   - la porte « mot de passe a changer » ferme tout pour un humain, et rien
 *     pour une machine ;
 *   - le garde de permissions refuse une action hors scope en 403.
 *
 * Ce qui n'est PAS prouve ici, et qui reste du ressort des specs e2e : que la
 * base renvoie vraiment ces lignes, et que le filtrage SQL par perimetre tient.
 * Un test d'aiguillage ne peut pas en repondre, et pretendre le contraire serait
 * la seule vraie faute de ce fichier.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Reflector } from '@nestjs/core';
import { AppException } from '../errors/app-error.js';
import {
  AllowPasswordChangeRequired,
  RequireAnyPermission,
  REQUEST_USER_KEY,
} from '../decorators/auth.decorators.js';
import { Public } from '../decorators/public.decorator.js';
import { AccessPolicy, type AuthenticatedUser } from '../auth/principal.js';
import { generateIntegrationToken } from '../auth/integration-token.js';
import { JwtAuthGuard, PermissionsGuard } from './access.guards.js';
import { IntegrationTokenService } from '../../modules/integrations/integration-token.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';

/** Le code HTTP porte par l'exception, seul temoin du refus cote appelant. */
function statut(error: unknown): number {
  assert.ok(error instanceof AppException, `exception metier attendue, recu : ${String(error)}`);
  return error.getStatus();
}

/** Le code d'erreur stable, celui que le frontend et n8n testent. */
function code(error: unknown): string {
  assert.ok(error instanceof AppException);
  return error.code;
}

/**
 * Un contexte d'execution minimal.
 *
 * VOLONTAIREMENT SANS `Test.createTestingModule` : monter Nest masquerait
 * l'aiguillage, qui est precisement l'objet du test. Le `Reflector`, lui, est le
 * VRAI — c'est lui qui lit les decorateurs poses sur les methodes ci-dessous, et
 * le remplacer reviendrait a tester un autre decorateur.
 */
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

/** Support des decorateurs : une classe, trois routes, trois situations. */
class Cible {
  @RequireAnyPermission('task:read:any')
  protegee() {
    return 'ok';
  }

  @Public()
  ouverte() {
    return 'ok';
  }

  @AllowPasswordChangeRequired()
  changementMotDePasse() {
    return 'ok';
  }
}

function requete(authorization?: string): Record<string, unknown> {
  return authorization ? { headers: { authorization } } : { headers: {} };
}

/** Un humain, tel que `PrincipalService.load` le rendrait. */
function humain(permissions: readonly string[], extra: Partial<AuthenticatedUser> = {}) {
  return {
    id: 'usr-1',
    email: 'lea@comexa.example',
    firstName: 'Lea',
    lastName: 'Marchetti',
    status: 'ACTIVE',
    clientId: null,
    mustChangePassword: false,
    roles: [],
    permissions: new Set(permissions),
    ...extra,
  } as unknown as AuthenticatedUser;
}

/** Une integration, telle que `IntegrationTokenService.resolve` la rendrait. */
function machine(scopes: readonly string[]) {
  return {
    id: 'svc-1',
    email: 'n8n-production@integrations.invalid',
    firstName: 'n8n-production',
    lastName: 'Integration',
    status: 'ACTIVE',
    clientId: null,
    mustChangePassword: false,
    roles: [],
    permissions: new Set(scopes),
    isIntegration: true,
  } as unknown as AuthenticatedUser;
}

describe('JwtAuthGuard — l’aiguillage entre humains et machines', () => {
  it('le vrai service expose resolve et délègue le jeton cxi_ à resolvePrincipal', async () => {
    const token = generateIntegrationToken();
    const principal = machine(['task:read:any']);
    const service = new IntegrationTokenService({} as PrismaService, {} as AuditService);
    const received: string[] = [];
    service.resolvePrincipal = async (value) => {
      received.push(value);
      return principal;
    };
    const garde = new JwtAuthGuard(
      new Reflector(),
      {
        verifyAccessToken: async () => {
          throw new Error('JWT ne doit pas être appelé');
        },
      },
      {
        load: async () => {
          throw new Error('Principal humain ne doit pas être chargé');
        },
      },
      service,
    );
    const request = requete(`Bearer ${token}`);

    assert.equal(typeof service.resolve, 'function');
    assert.equal(await garde.canActivate(contexte(Cible.prototype.protegee, request)), true);
    assert.deepEqual(received, [token]);
    assert.equal(request[REQUEST_USER_KEY], principal);
  });

  it('resolve propage le refus métier sans le transformer en HTTP 500', async () => {
    const service = new IntegrationTokenService({} as PrismaService, {} as AuditService);
    const refusal = AppException.unauthenticated('INTEGRATION_TOKEN_REVOKED', 'Jeton révoqué.');
    service.resolvePrincipal = async () => {
      throw refusal;
    };

    await assert.rejects(
      () => service.resolve(generateIntegrationToken()),
      (error: unknown) => {
        assert.equal(error, refusal);
        assert.equal(statut(error), 401);
        return true;
      },
    );
  });

  it('sans jeton, une route protegee est refusee en 401', async () => {
    const garde = new JwtAuthGuard(
      new Reflector(),
      { verifyAccessToken: async () => ({ sub: 'x' }) },
      {
        load: async () => humain([]),
      },
    );

    await assert.rejects(
      () => garde.canActivate(contexte(Cible.prototype.protegee, requete())),
      (error: unknown) => {
        assert.equal(statut(error), 401);
        return true;
      },
    );
  });

  it('un jeton JWT invalide est refuse en 401', async () => {
    const garde = new JwtAuthGuard(
      new Reflector(),
      {
        verifyAccessToken: async () => {
          throw AppException.unauthenticated('TOKEN_INVALID', 'Jeton invalide.');
        },
      },
      { load: async () => humain([]) },
    );

    await assert.rejects(
      () => garde.canActivate(contexte(Cible.prototype.protegee, requete('Bearer eyJbidon'))),
      (error: unknown) => {
        assert.equal(statut(error), 401);
        assert.equal(code(error), 'TOKEN_INVALID');
        return true;
      },
    );
  });

  it('un jeton d’integration va au resolveur, et JAMAIS au verificateur JWT', async () => {
    let jwtAppele = false;
    const secret = generateIntegrationToken();
    const porteur = machine(['task:read:any']);

    const garde = new JwtAuthGuard(
      new Reflector(),
      {
        verifyAccessToken: async () => {
          jwtAppele = true;
          return { sub: 'jamais' };
        },
      },
      { load: async () => humain([]) },
      {
        resolve: async (jeton) => {
          assert.equal(jeton, secret, 'le secret doit arriver intact, sans le prefixe Bearer');
          return porteur;
        },
      },
    );

    const request = requete(`Bearer ${secret}`);
    assert.equal(await garde.canActivate(contexte(Cible.prototype.protegee, request)), true);
    assert.equal(jwtAppele, false, 'un jeton cxi_ ne doit pas passer par la verification JWT');
  });

  it('un jeton d’integration revoque est refuse en 401 des la requete suivante', async () => {
    const garde = new JwtAuthGuard(
      new Reflector(),
      { verifyAccessToken: async () => ({ sub: 'x' }) },
      { load: async () => humain([]) },
      {
        resolve: async () => {
          throw AppException.unauthenticated(
            'INTEGRATION_TOKEN_REVOKED',
            'Ce jeton a ete revoque.',
          );
        },
      },
    );

    await assert.rejects(
      () =>
        garde.canActivate(
          contexte(Cible.prototype.protegee, requete(`Bearer ${generateIntegrationToken()}`)),
        ),
      (error: unknown) => {
        assert.equal(statut(error), 401);
        assert.equal(code(error), 'INTEGRATION_TOKEN_REVOKED');
        return true;
      },
    );
  });

  it('sans module d’integration, un jeton cxi_ echoue proprement au lieu de partir en JWT', async () => {
    // Le resolveur est OPTIONNEL : un deploiment qui n'a pas active le module
    // doit continuer de tourner, et refuser nettement plutot que de laisser le
    // verificateur JWT produire une erreur qui parle d'autre chose.
    const garde = new JwtAuthGuard(
      new Reflector(),
      { verifyAccessToken: async () => ({ sub: 'x' }) },
      { load: async () => humain([]) },
    );

    await assert.rejects(
      () =>
        garde.canActivate(
          contexte(Cible.prototype.protegee, requete(`Bearer ${generateIntegrationToken()}`)),
        ),
      (error: unknown) => {
        assert.equal(statut(error), 401);
        assert.equal(code(error), 'INTEGRATION_DISABLED');
        return true;
      },
    );
  });

  it('le mot de passe a changer ferme tout pour un humain, et rien pour une machine', async () => {
    const chargeurHumain = {
      load: async () => humain(['task:read:any'], { mustChangePassword: true }),
    };
    const gardeHumain = new JwtAuthGuard(
      new Reflector(),
      { verifyAccessToken: async () => ({ sub: 'usr-1' }) },
      chargeurHumain,
    );

    await assert.rejects(
      () => gardeHumain.canActivate(contexte(Cible.prototype.protegee, requete('Bearer un-jwt'))),
      (error: unknown) => {
        assert.equal(statut(error), 403);
        assert.equal(code(error), 'PASSWORD_CHANGE_REQUIRED');
        return true;
      },
    );

    // La meme porte reste ouverte sur la route qui permet d'en sortir.
    assert.equal(
      await gardeHumain.canActivate(
        contexte(Cible.prototype.changementMotDePasse, requete('Bearer un-jwt')),
      ),
      true,
    );

    // Une machine n'a pas de mot de passe : le drapeau ne doit jamais la bloquer.
    const gardeMachine = new JwtAuthGuard(
      new Reflector(),
      { verifyAccessToken: async () => ({ sub: 'svc-1' }) },
      { load: async () => humain([]) },
      { resolve: async () => machine(['task:read:any']) },
    );

    assert.equal(
      await gardeMachine.canActivate(
        contexte(Cible.prototype.protegee, requete(`Bearer ${generateIntegrationToken()}`)),
      ),
      true,
    );
    assert.equal(new AccessPolicy(machine(['task:read:any'])).isIntegration(), true);
  });

  it('une route publique laisse passer l’absence de jeton ET un jeton invalide', async () => {
    const garde = new JwtAuthGuard(
      new Reflector(),
      {
        verifyAccessToken: async () => {
          throw AppException.unauthenticated('TOKEN_INVALID', 'Jeton invalide.');
        },
      },
      { load: async () => humain([]) },
    );

    assert.equal(await garde.canActivate(contexte(Cible.prototype.ouverte, requete())), true);
    assert.equal(
      await garde.canActivate(contexte(Cible.prototype.ouverte, requete('Bearer nimportequoi'))),
      true,
    );
  });
});

describe('PermissionsGuard — des droits par ressource, pas par statut', () => {
  const garde = new PermissionsGuard(new Reflector());

  it('une machine hors de son perimetre est refusee en 403', async () => {
    const request = { ...requete('Bearer cxi_...') };
    request['authenticatedUser'] = machine(['project:read:any']);

    // Le jeton lit les projets, pas les taches : le refus doit porter sur
    // l'operation demandee, et non sur le fait d'etre authentifie.
    assert.throws(
      () => garde.canActivate(contexte(Cible.prototype.protegee, request)),
      (error: unknown) => {
        assert.ok(error instanceof AppException);
        assert.equal(statut(error), 403);
        assert.equal(code(error), 'FORBIDDEN');
        // Le message nomme la permission manquante : c'est lui qui dit a l'integrateur
        // QUOI ajouter au jeton, la ou un « acces refuse » muet le laisserait
        // essayer des codes au hasard.
        assert.match(error.message, /task:read:any/);
        return true;
      },
    );
  });

  it('une machine dans son perimetre passe', () => {
    const request = { ...requete('Bearer cxi_...') };
    request['authenticatedUser'] = machine(['task:read:any']);

    assert.equal(garde.canActivate(contexte(Cible.prototype.protegee, request)), true);
  });

  it('sans porteur attache a la requete, le garde refuse au lieu de laisser passer', () => {
    // Cas impossible en principe (le garde d'authentification passe avant), mais
    // une incoherence entre les deux gardes ne doit jamais ouvrir un acces.
    assert.throws(
      () => garde.canActivate(contexte(Cible.prototype.protegee, requete('Bearer cxi_...'))),
      (error: unknown) => {
        assert.equal(statut(error), 401);
        return true;
      },
    );
  });
});
