/**
 * GUIDE DE DÉMARRAGE — tests des règles pures.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *
 *  1. chaque étape d'ACTION porte une preuve bornée au membre (`{{userId}}`) :
 *     sans cela, un collègue pourrait « valider » l'étape à sa place ;
 *  2. aucune étape ne promet un écran qui n'existe pas (`href` d'espace) et
 *     aucun identifiant ne sort du format accepté par `onboarding_progress` ;
 *  3. la bonne réponse d'une micro-question ne quitte JAMAIS le serveur
 *     (`toStepView` ne transmet que la question et les options) ;
 *  4. une étape qu'on ne peut pas exécuter avec ses droits n'est pas affichée.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GUIDE_SPACE_ORDER,
  GUIDE_STEPS,
  PROOF_MODELS,
  findGuideStep,
  type GuideStepDefinition,
} from '../src/modules/guide/guide.catalog.js';
import {
  guideSpaces,
  isCorrectAnswer,
  permissionsFor,
  proofSatisfied,
  resolveProofWhere,
  toStepView,
  visibleSteps,
} from '../src/modules/guide/guide.rules.js';
import type { AuthenticatedUser } from '../src/common/auth/principal.js';

const CHAPTER_ID = /^[a-z0-9][a-z0-9:._-]{0,119}$/;

function user(overrides: Partial<AuthenticatedUser> & { permissions?: string[] }): AuthenticatedUser {
  const { permissions = [], rolePermissions, ...rest } = overrides as AuthenticatedUser & {
    permissions?: string[];
    rolePermissions?: ReadonlySet<string>;
  };
  return {
    id: 'user-1',
    email: 'membre@comexa.dz',
    firstName: 'Nadia',
    lastName: 'B.',
    roles: ['ADMIN'] as unknown as AuthenticatedUser['roles'],
    clientId: null,
    mustChangePassword: false,
    permissions: new Set(permissions),
    rolePermissions: rolePermissions ?? new Set(permissions),
    ...rest,
  } as AuthenticatedUser;
}

const ALL_PERMISSIONS = [
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
  'quote:accept:own',
  'project:read:any',
  'service:read:any',
  'user:read:any',
  'modificationrequest:read:own',
  'modificationrequest:write:own',
];

test('identifiants : uniques, préfixés par leur espace, acceptés par le stockage', () => {
  const ids = GUIDE_STEPS.map((step) => step.id);
  assert.equal(new Set(ids).size, ids.length, 'deux étapes partagent le même identifiant');
  for (const step of GUIDE_STEPS) {
    assert.match(step.id, CHAPTER_ID, `identifiant refusé par onboarding_progress : ${step.id}`);
    assert.ok(
      step.id.startsWith(`${step.space}:`),
      `l'identifiant ${step.id} doit commencer par « ${step.space}: »`,
    );
    assert.ok(GUIDE_SPACE_ORDER.includes(step.space), `espace inconnu : ${step.space}`);
    assert.ok(step.href.startsWith('/espace-'), `écran hors espace de travail : ${step.href}`);
    assert.ok(step.prompt.length < 160, `consigne trop longue (${step.prompt.length}) sur ${step.id}`);
    assert.ok(step.why.length < 160, `raison trop longue (${step.why.length}) sur ${step.id}`);
  }
});

test('une étape d’action porte TOUJOURS une preuve bornée au membre', () => {
  const actions = GUIDE_STEPS.filter((step) => step.kind === 'action');
  assert.ok(actions.length >= 3, 'le guide doit proposer de vrais gestes, pas seulement des visites');
  for (const step of actions) {
    assert.ok(step.proof, `l'étape d'action ${step.id} n'a aucune preuve`);
    assert.ok(PROOF_MODELS.has(step.proof!.model), `modèle de preuve inconnu : ${step.proof!.model}`);
    const serialized = JSON.stringify(step.proof!.where);
    assert.ok(
      serialized.includes('{{userId}}'),
      `la preuve de ${step.id} n'est pas bornée au membre : ${serialized}`,
    );
  }
});

test('une micro-question a une bonne réponse PARMI ses options', () => {
  for (const step of GUIDE_STEPS) {
    if (!step.recall) continue;
    const ids = step.recall.options.map((option) => option.id);
    assert.ok(step.recall.options.length >= 2, `question trop pauvre sur ${step.id}`);
    assert.equal(new Set(ids).size, ids.length, `options dupliquées sur ${step.id}`);
    assert.ok(ids.includes(step.recall.answerId), `la bonne réponse de ${step.id} n'est pas proposée`);
    assert.ok(step.recall.explanation.length > 20, `correction trop courte sur ${step.id}`);
  }
});

test('la bonne réponse ne quitte jamais le serveur', () => {
  const step = GUIDE_STEPS.find((entry) => entry.recall)!;
  const view = toStepView(step, false);
  const serialized = JSON.stringify(view);
  assert.ok(view.recall, 'la question doit être transmise');
  assert.equal(view.recall!.options.length, step.recall!.options.length);
  // On teste la FORME, pas le texte : un identifiant comme « temps » apparaît
  // légitimement dans un libellé (« Mon temps »). Ce qui ne doit jamais sortir,
  // c'est le champ `answerId` et la correction.
  assert.ok(!serialized.includes('answerId'), 'le champ answerId ne doit pas exister côté client');
  assert.ok(!serialized.includes('explanation'), 'la correction ne doit pas partir avant la réponse');
  assert.equal(view.proof, undefined, 'la preuve elle-même reste côté serveur');
});

test('substitution de preuve : seul {{userId}} est remplacé', () => {
  assert.deepEqual(resolveProofWhere({ ownerId: '{{userId}}', status: 'SENT' }, 'abc'), {
    ownerId: 'abc',
    status: 'SENT',
  });
  assert.deepEqual(
    resolveProofWhere({ userId: '{{userId}}', createdAt: { gte: '{{since}}' } }, 'abc'),
    { userId: 'abc', createdAt: { gte: '{{since}}' } },
  );
});

test('seuil de preuve : minCount par défaut à 1', () => {
  assert.equal(proofSatisfied({ model: 'task', where: {} }, 0), false);
  assert.equal(proofSatisfied({ model: 'task', where: {} }, 1), true);
  assert.equal(proofSatisfied({ model: 'task', where: {}, minCount: 2 }, 1), false);
  assert.equal(proofSatisfied({ model: 'task', where: {}, minCount: 2 }, 2), true);
});

test('correction d’une micro-question : stricte', () => {
  const step = GUIDE_STEPS.find((entry) => entry.recall)!;
  assert.equal(isCorrectAnswer(step.recall!, step.recall!.answerId), true);
  const wrong = step.recall!.options.find((option) => option.id !== step.recall!.answerId)!;
  assert.equal(isCorrectAnswer(step.recall!, wrong.id), false);
});

test('espaces du guide : un membre de l’équipe voit les siens, un client voit le sien', () => {
  const admin = user({ permissions: ALL_PERMISSIONS });
  const spaces = guideSpaces(admin);
  assert.ok(spaces.includes('personal'));
  assert.ok(spaces.includes('team'));
  assert.ok(spaces.includes('comexa'));

  const visitor = user({
    roles: ['CLIENT'] as unknown as AuthenticatedUser['roles'],
    permissions: ['quote:read:own', 'quote:accept:own'],
  });
  assert.deepEqual(guideSpaces(visitor), ['client']);
});

test('une étape inaccessible n’est pas affichée', () => {
  const narrow = user({
    roles: ['CLIENT'] as unknown as AuthenticatedUser['roles'],
    permissions: ['quote:read:own'],
  });
  const steps = visibleSteps(narrow, GUIDE_STEPS);
  assert.ok(steps.length > 0);
  for (const step of steps) {
    assert.equal(step.space, 'client');
    if (!step.anyPermissions) continue;
    const permissions = permissionsFor(narrow, step.space);
    assert.ok(step.anyPermissions.some((code) => permissions.has(code)));
  }
  // Un membre sans aucun droit n'obtient aucune étape d'action.
  const nobody = user({ permissions: [] });
  assert.equal(
    visibleSteps(nobody, GUIDE_STEPS).filter((step: GuideStepDefinition) => step.kind === 'action').length,
    0,
  );
});

test('recherche d’étape : identifiant inconnu → null', () => {
  assert.equal(findGuideStep('personal:premiere-tache')?.space, 'personal');
  assert.equal(findGuideStep('inexistant'), null);
});
