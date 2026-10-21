/**
 * GUIDE DE DÉMARRAGE — tests du service, sans base de données.
 *
 * Le service est la seule pièce qui décide « cette étape est faite ». On le
 * teste donc avec un faux client Prisma, en vérifiant les trois comportements
 * qui comptent :
 *
 *  1. une étape d'ACTION n'est jamais validée sans preuve en base (409) ;
 *  2. une preuve satisfaite valide l'étape et l'enregistre dans la progression ;
 *  3. une étape invisible avec les droits du porteur est un 404, pas un succès.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GuideService } from '../src/modules/guide/guide.service.js';
import type { AuthenticatedUser } from '../src/common/auth/principal.js';

const ALL = [
  'task:read:personal',
  'task:write:personal',
  'task:read:assigned',
  'task:write:own',
  'time:read:own',
  'time:write:own',
  'prospect:read:any',
  'prospect:write:any',
  'quote:read:any',
  'quote:read:own',
  'project:read:any',
  'service:read:any',
  'user:read:any',
];

function member(permissions: string[] = ALL, roles: string[] = ['ADMIN']): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'membre@comexa.dz',
    firstName: 'Nadia',
    lastName: 'B.',
    roles: roles as unknown as AuthenticatedUser['roles'],
    clientId: null,
    mustChangePassword: false,
    permissions: new Set(permissions),
    rolePermissions: new Set(permissions),
  } as AuthenticatedUser;
}

interface FakeOptions {
  counts?: Record<string, number>;
  acknowledged?: string[];
}

function fakePrisma({ counts = {}, acknowledged = [] }: FakeOptions = {}) {
  const writes: { area: string; stepId: string }[] = [];
  const byArea = new Map<string, string[]>();
  for (const id of acknowledged) {
    const area = id.split(':')[0];
    byArea.set(area, [...(byArea.get(area) ?? []), id]);
  }
  const count = (model: string) => async () => counts[model] ?? 0;
  const client = {
    onboardingProgress: {
      findMany: async () => [...byArea.entries()].map(([area, ids]) => ({ completedChapterIds: ids, area })),
      upsert: async (args: {
        where: { userId_area: { area: string } };
        update: { completedChapterIds: { push: string } };
      }) => {
        writes.push({
          area: args.where.userId_area.area,
          stepId: args.update.completedChapterIds.push,
        });
        return {};
      },
    },
    task: { count: count('task') },
    timeEntry: { count: count('timeEntry') },
    prospect: { count: count('prospect') },
  };
  return { prisma: { prodClient: client } as unknown as never, writes };
}

async function rejects(promise: Promise<unknown>): Promise<{ code: string; status: number }> {
  try {
    await promise;
  } catch (error) {
    const typed = error as { code?: string; getStatus?: () => number };
    return { code: typed.code ?? 'INCONNU', status: typed.getStatus?.() ?? 0 };
  }
  throw new Error('la promesse aurait dû être rejetée');
}

test('les étapes visibles dépendent des droits de l’espace', async () => {
  const { prisma } = fakePrisma();
  const service = new GuideService(prisma);
  const overview = await service.overview(member());

  assert.ok(overview.total >= 6, `guide trop pauvre : ${overview.total} étapes`);
  assert.ok(overview.spaces.some((space) => space.id === 'personal'));
  // La preuve n'est pas partie au navigateur.
  const serialized = JSON.stringify(overview);
  assert.ok(!serialized.includes('minCount'), 'le détail des preuves ne doit pas sortir');
  assert.ok(!serialized.includes('answerId'), 'la bonne réponse ne doit pas sortir');
});

test('un guide vide pour un compte sans droit (aucune étape inventée)', async () => {
  const { prisma } = fakePrisma();
  const service = new GuideService(prisma);
  const overview = await service.overview(member([], ['CLIENT']));
  assert.equal(overview.total, 0);
  assert.equal(overview.nextStepId, null);
});

test('une étape d’action SANS preuve en base est refusée (409)', async () => {
  const { prisma, writes } = fakePrisma({ counts: { task: 0 } });
  const service = new GuideService(prisma);
  const error = await rejects(service.complete(member(), 'personal:premiere-tache'));
  assert.equal(error.code, 'GUIDE_ACTION_ATTENDUE');
  assert.equal(error.status, 409);
  assert.equal(writes.length, 0, 'rien ne doit être enregistré sans preuve');
});

test('une preuve satisfaite valide l’étape et l’enregistre', async () => {
  const { prisma, writes } = fakePrisma({ counts: { task: 2 } });
  const service = new GuideService(prisma);
  const result = await service.complete(member(), 'personal:premiere-tache');

  assert.equal(result.ok, true);
  assert.equal(result.stepId, 'personal:premiere-tache');
  assert.deepEqual(writes, [{ area: 'personal', stepId: 'personal:premiere-tache' }]);
  const step = result.overview.spaces
    .flatMap((space) => space.steps)
    .find((entry) => entry.id === 'personal:premiere-tache');
  assert.equal(step?.done, true);
});

test('le minuteur compte comme preuve de temps saisi', async () => {
  const { prisma } = fakePrisma({ counts: { timeEntry: 1 } });
  const service = new GuideService(prisma);
  const result = await service.complete(member(), 'personal:chronometrer');
  assert.equal(result.ok, true);
});

test('micro-question : mauvaise réponse = correction, pas de validation', async () => {
  const { prisma, writes } = fakePrisma();
  const service = new GuideService(prisma);
  const result = await service.complete(member(), 'personal:lire-temps', 'n-importe-quoi');

  assert.equal(result.ok, false);
  assert.ok(result.correction, 'la correction doit être renvoyée');
  assert.equal(writes.length, 0, 'une mauvaise réponse ne valide rien');
});

test('micro-question : réponse absente puis correcte', async () => {
  const { prisma, writes } = fakePrisma();
  const service = new GuideService(prisma);

  const missing = await rejects(service.complete(member(), 'personal:lire-temps'));
  assert.equal(missing.code, 'GUIDE_REPONSE_REQUISE');

  const result = await service.complete(member(), 'personal:lire-temps', 'temps');
  assert.equal(result.ok, true);
  assert.ok(result.explanation);
  assert.deepEqual(writes, [{ area: 'personal', stepId: 'personal:lire-temps' }]);
});

test('une étape d’un espace inaccessible est un 404, jamais un succès', async () => {
  const { prisma } = fakePrisma();
  const service = new GuideService(prisma);
  const client = member(['quote:read:own'], ['CLIENT']);
  const error = await rejects(service.complete(client, 'personal:premiere-tache'));
  assert.equal(error.code, 'GUIDE_STEP_NOT_FOUND');
  assert.equal(error.status, 404);
});

test('une visite déjà vue reste cochée après un rechargement', async () => {
  const { prisma } = fakePrisma({ acknowledged: ['personal:lire-temps'] });
  const service = new GuideService(prisma);
  const overview = await service.overview(member());
  const step = overview.spaces
    .flatMap((space) => space.steps)
    .find((entry) => entry.id === 'personal:lire-temps');
  assert.equal(step?.done, true);
});
