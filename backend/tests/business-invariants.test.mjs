/**
 * INVARIANTS METIER TRANSVERSAUX — scenarios reproductibles, sans base.
 *
 * Lancer : cd backend && node --import tsx --test tests/business-invariants.test.mjs
 *
 * Chaque test decrit un etat REELLEMENT observable avant correction :
 *  - `PATCH /me/goals/:id {status: ACHIEVED}` reussissait sans aucune tache ;
 *  - `?status=EXPIRED` ne renvoyait rien et un devis perime restait « Envoye » ;
 *  - un projet rouvert restait affiche a 100 % d'avancement ;
 *  - un jalon atteint emettait une notification `SYSTEM`.
 *
 * Les services sont instancies avec un faux Prisma : on teste la DECISION, pas
 * le SQL. Voir `helpers/prisma-stubs.mjs` pour le client genere hors ligne.
 */
import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePrismaStubs, schemaEnums } from './helpers/prisma-stubs.mjs';

preparePrismaStubs();
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (...parts) => path.join(backendRoot, 'src', ...parts);
const readSrc = (...parts) => readFileSync(src(...parts), 'utf8');

const { AccessPolicy } = await import('../src/common/auth/principal.ts');
const { GoalStatus, TaskStatus, QuoteStatus, ProjectStatus } = await import(
  '../src/generated/prisma/enums.js'
);
const goalRules = await import('../src/modules/goals/goal-rules.ts');
const { GoalsService } = await import('../src/modules/goals/goals.service.ts');
const { TasksService } = await import('../src/modules/tasks/tasks.service.ts');
const quoteState = await import('../src/modules/quotes/quote-state.ts');
const { QuotesService } = await import('../src/modules/quotes/quotes.service.ts');
const { ProjectsService } = await import('../src/modules/projects/projects.service.ts');
const { projectProgressFromTaskStatuses } = await import(
  '../src/modules/projects/project-progress.ts'
);

const ALL_PERMISSIONS = [
  'task:read:personal',
  'task:write:personal',
  'task:read:any',
  'task:write:any',
  'quote:read:any',
  'quote:write:any',
  'project:manage:status',
  'project:read:any',
];

const makeUser = (extra = {}) => ({
  id: 'u1',
  email: 'u1@comexa.test',
  firstName: 'Une',
  lastName: 'Personne',
  roles: [],
  clientId: null,
  mustChangePassword: false,
  permissions: new Set(ALL_PERMISSIONS),
  ...extra,
});
const policy = (extra) => new AccessPolicy(makeUser(extra));
const audit = { record: async () => {} };
const meta = { ipAddress: null, userAgent: null };
const rejectsWith = (promise, code) =>
  assert.rejects(promise, (error) => {
    assert.equal(error?.code, code, `attendu ${code}, recu ${error?.code}: ${error?.message}`);
    return true;
  });

// -----------------------------------------------------------------------------
// 1. OBJECTIFS — le cas signale : « atteint » sans aucune tache
// -----------------------------------------------------------------------------

const goalRow = (status, achievedAt = null) => ({
  id: 'g1',
  ownerId: 'u1',
  title: 'Livrer la boutique',
  description: null,
  targetDate: null,
  color: 'blue',
  status,
  achievedAt,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

function goalsPrisma({ goal, links = [], existingLink = null }) {
  const calls = { update: [], deleteMany: [], created: 0, deleted: 0 };
  const tx = {
    goalTask: {
      findUnique: async () => existingLink,
      delete: async () => {
        calls.deleted += 1;
        return {};
      },
      create: async () => {
        calls.created += 1;
        return {};
      },
    },
  };
  return {
    calls,
    goal: {
      findFirst: async () => goal,
      update: async (args) => {
        calls.update.push(args);
        return { ...goal, ...args.data };
      },
    },
    goalTask: {
      findMany: async () => links,
      deleteMany: async (args) => {
        calls.deleteMany.push(args);
        return { count: 1 };
      },
    },
    task: { findFirst: async () => ({ id: 't1' }) },
    $transaction: async (fn) => fn(tx),
  };
}

test('objectif: PATCH ACHIEVED sans AUCUNE tache est refuse par l API (bug signale)', async () => {
  const prisma = goalsPrisma({ goal: goalRow(GoalStatus.ACTIVE), links: [] });
  const service = new GoalsService(prisma, audit);
  await rejectsWith(
    service.update('g1', { status: GoalStatus.ACHIEVED }, policy(), meta),
    'GOAL_NOT_COMPLETABLE',
  );
  assert.equal(prisma.calls.update.length, 0, 'aucune ecriture ne doit avoir lieu');
});

test('objectif: ACHIEVED refuse avec des taches ouvertes, ou toutes annulees', async () => {
  for (const [label, links] of [
    ['une tache ouverte', [{ goalId: 'g1', task: { status: TaskStatus.TODO } }]],
    ['une tache DONE + une ouverte', [
      { goalId: 'g1', task: { status: TaskStatus.DONE } },
      { goalId: 'g1', task: { status: TaskStatus.IN_PROGRESS } },
    ]],
    ['toutes annulees', [{ goalId: 'g1', task: { status: TaskStatus.CANCELLED } }]],
  ]) {
    const prisma = goalsPrisma({ goal: goalRow(GoalStatus.ACTIVE), links });
    await rejectsWith(
      new GoalsService(prisma, audit).update('g1', { status: GoalStatus.ACHIEVED }, policy(), meta),
      'GOAL_NOT_COMPLETABLE',
    );
    assert.equal(prisma.calls.update.length, 0, label);
  }
});

test('objectif: ACHIEVED accepte quand toutes les taches comptables sont DONE', async () => {
  const links = [
    { goalId: 'g1', task: { status: TaskStatus.DONE } },
    { goalId: 'g1', task: { status: TaskStatus.DONE } },
    { goalId: 'g1', task: { status: TaskStatus.CANCELLED } },
  ];
  const prisma = goalsPrisma({ goal: goalRow(GoalStatus.ACTIVE), links });
  const result = await new GoalsService(prisma, audit).update(
    'g1',
    { status: GoalStatus.ACHIEVED },
    policy(),
    meta,
  );
  assert.equal(result.status, GoalStatus.ACHIEVED);
  assert.equal(result.progress.percent, 100);
  assert.equal(result.progress.done, 2);
  assert.equal(result.needsReopen, false);
  assert.ok(result.achievedAt instanceof Date);
  assert.equal(prisma.calls.update.length, 1);
});

test('objectif: les donnees historiques incoherentes sont SIGNALEES, pas reecrites', async () => {
  // Un objectif declare atteint avant la correction, sans tache : le statut et
  // achievedAt restent lus tels quels, mais l API expose needsReopen.
  const prisma = goalsPrisma({
    goal: goalRow(GoalStatus.ACHIEVED, new Date('2025-05-01T00:00:00Z')),
    links: [],
  });
  const result = await new GoalsService(prisma, audit).getOne('g1', policy());
  assert.equal(result.status, GoalStatus.ACHIEVED);
  assert.equal(result.needsReopen, true);
  assert.equal(result.progress.percent, 0, 'on ne force plus un faux 100 %');
  assert.equal(prisma.calls.update.length, 0, 'aucune correction automatique en base');
});

test('objectif: un objectif ATTEINT ou ARCHIVE n accepte plus de nouvelle tache', async () => {
  for (const [status, code] of [
    [GoalStatus.ACHIEVED, 'GOAL_ACHIEVED'],
    [GoalStatus.ARCHIVED, 'GOAL_ARCHIVED'],
  ]) {
    const prisma = goalsPrisma({ goal: goalRow(status), links: [] });
    await rejectsWith(
      new GoalsService(prisma, audit).linkTask('g1', 't1', policy(), meta),
      code,
    );
  }
  const active = goalsPrisma({ goal: goalRow(GoalStatus.ACTIVE), links: [] });
  const result = await new GoalsService(active, audit).linkTask('g1', 't1', policy(), meta);
  assert.equal(result.status, GoalStatus.ACTIVE);
});

test('objectif: deplacer une tache DEPUIS un objectif ATTEINT est refuse', async () => {
  const prisma = goalsPrisma({
    goal: goalRow(GoalStatus.ACTIVE),
    links: [],
    existingLink: {
      goalId: 'autre-objectif',
      goal: { status: GoalStatus.ACHIEVED },
    },
  });
  await rejectsWith(
    new GoalsService(prisma, audit).linkTask('g1', 't1', policy(), meta),
    'GOAL_ACHIEVED_TASK_LOCKED',
  );
  assert.equal(prisma.calls.deleted, 0, 'la liaison historique reste intacte');
  assert.equal(prisma.calls.created, 0, 'aucune nouvelle liaison');
});

test('objectif: retirer une tache d un objectif ATTEINT est refuse', async () => {
  const prisma = goalsPrisma({ goal: goalRow(GoalStatus.ACHIEVED), links: [] });
  await rejectsWith(
    new GoalsService(prisma, audit).unlinkTask('g1', 't1', policy(), meta),
    'GOAL_ACHIEVED_TASK_LOCKED',
  );
  assert.equal(prisma.calls.deleteMany.length, 0);
});

test('regles pures: goalCanBeAchieved / goalAcceptsTasks / goalFreezesTasks', () => {
  const progress = (statuses) => goalRules.goalProgressOf(statuses);
  assert.equal(goalRules.goalCanBeAchieved(progress([])), false);
  assert.equal(goalRules.goalAchievementBlocker(progress([])), 'GOAL_NO_TASKS');
  assert.equal(goalRules.goalCanBeAchieved(progress([TaskStatus.CANCELLED])), false);
  assert.equal(
    goalRules.goalAchievementBlocker(progress([TaskStatus.CANCELLED])),
    'GOAL_NO_DONE_TASK',
  );
  assert.equal(
    goalRules.goalCanBeAchieved(progress([TaskStatus.DONE, TaskStatus.TODO])),
    false,
  );
  assert.equal(
    goalRules.goalAchievementBlocker(progress([TaskStatus.DONE, TaskStatus.TODO])),
    'GOAL_HAS_OPEN_TASKS',
  );
  assert.equal(
    goalRules.goalCanBeAchieved(progress([TaskStatus.DONE, TaskStatus.CANCELLED])),
    true,
  );
  assert.equal(goalRules.goalAcceptsTasks(GoalStatus.ACTIVE), true);
  assert.equal(goalRules.goalAcceptsTasks(GoalStatus.ACHIEVED), false);
  assert.equal(goalRules.goalAcceptsTasks(GoalStatus.ARCHIVED), false);
  assert.equal(goalRules.goalFreezesTasks(GoalStatus.ACHIEVED), true);
  assert.equal(goalRules.goalAcceptsTaskStatus(GoalStatus.ACHIEVED, TaskStatus.DONE), true);
  assert.equal(goalRules.goalAcceptsTaskStatus(GoalStatus.ACHIEVED, TaskStatus.TODO), false);
});

// -----------------------------------------------------------------------------
// 2. TACHES — la meme regle, appliquee via le module des taches
// -----------------------------------------------------------------------------

test('tache: creer une tache personnelle dans un objectif ATTEINT est refuse', async () => {
  const service = Object.create(TasksService.prototype);
  service.prisma = {
    goal: { findFirst: async () => ({ id: 'g1', status: GoalStatus.ACHIEVED }) },
  };
  await rejectsWith(service.requireOwnOpenGoal('g1', 'u1'), 'GOAL_ACHIEVED');
});

test('tache: rouvrir / detacher / supprimer une tache liee a un objectif ATTEINT', async () => {
  const service = Object.create(TasksService.prototype);
  service.prisma = {
    goalTask: {
      findFirst: async () => ({
        goal: { status: GoalStatus.ACHIEVED, title: 'Livrer', ownerId: 'u1' },
      }),
    },
  };
  await rejectsWith(
    service.assertAchievedGoalAllowsTask('t1', policy(), TaskStatus.TODO),
    'GOAL_ACHIEVED_TASK_LOCKED',
  );
  await rejectsWith(
    service.assertAchievedGoalAllowsTask('t1', policy(), null),
    'GOAL_ACHIEVED_TASK_LOCKED',
  );
  // Rester / redevenir DONE ne contredit pas l objectif atteint.
  await assert.doesNotReject(
    service.assertAchievedGoalAllowsTask('t1', policy(), TaskStatus.DONE),
  );
  // Un objectif d un autre proprietaire ne fuit pas son titre dans le message.
  service.prisma.goalTask.findFirst = async () => ({
    goal: { status: GoalStatus.ACHIEVED, title: 'PRIVE', ownerId: 'autre' },
  });
  await assert.rejects(
    service.assertAchievedGoalAllowsTask('t1', policy(), TaskStatus.TODO),
    (error) => {
      assert.equal(error.code, 'GOAL_ACHIEVED_TASK_LOCKED');
      assert.ok(!error.message.includes('PRIVE'), 'titre prive non divulgue');
      return true;
    },
  );
});

test('tache: aucune regle d objectif dupliquee cote module taches', () => {
  const source = readSrc('modules', 'tasks', 'tasks.service.ts');
  assert.match(source, /goalAcceptsTasks\(goal\.status\)/);
  assert.match(source, /goalAcceptsTaskStatus/);
  assert.match(source, /goalFreezesTasks/);
  // L ancien garde ne verifiait que ARCHIVED dans un `if ... throw`, ce qui
  // laissait passer ACHIEVED. La comparaison ARCHIVED ne sert plus qu'a choisir
  // un libelle, jamais a decider.
  assert.ok(
    !/if \(goal\.status === GoalStatus\.ARCHIVED\)\s*\{\s*throw/.test(source),
    'la regle ne doit plus etre codee en dur cote taches',
  );
});

// -----------------------------------------------------------------------------
// 3. DEVIS — EXPIRED n avait aucun ecrivain ; validite au jour pres
// -----------------------------------------------------------------------------

const day = (iso) => new Date(iso);

test('devis: un devis envoye perime est presente EXPIRED, mais un ACCEPTE reste ACCEPTE', () => {
  const validUntil = day('2026-10-01T00:00:00.000Z');
  const after = day('2026-10-05T10:00:00.000Z');
  assert.equal(
    quoteState.effectiveQuoteStatus(QuoteStatus.SENT, validUntil, after),
    QuoteStatus.EXPIRED,
  );
  assert.equal(
    quoteState.effectiveQuoteStatus(QuoteStatus.VIEWED, validUntil, after),
    QuoteStatus.EXPIRED,
  );
  for (const status of [
    QuoteStatus.DRAFT,
    QuoteStatus.ACCEPTED,
    QuoteStatus.REJECTED,
    QuoteStatus.CANCELLED,
    QuoteStatus.EXPIRED,
  ]) {
    assert.equal(
      quoteState.effectiveQuoteStatus(status, validUntil, after),
      status,
      `${status} ne doit pas etre reecrit par le calendrier`,
    );
  }
  assert.equal(
    quoteState.effectiveQuoteStatus(QuoteStatus.SENT, null, after),
    QuoteStatus.SENT,
  );
});

test('devis: le DERNIER jour de validite reste acceptant (regression du decalage UTC)', () => {
  // Avant correction : validUntil stocke a minuit UTC et compare a Date.now(),
  // donc expire des 00:00 UTC le jour MEME affiche « Valable jusqu'au 01/10 ».
  const validUntil = day('2026-10-01T00:00:00.000Z');
  assert.equal(quoteState.isQuoteExpired(validUntil, day('2026-10-01T00:00:01.000Z')), false);
  assert.equal(quoteState.isQuoteExpired(validUntil, day('2026-10-01T23:59:59.000Z')), false);
  assert.equal(quoteState.isQuoteExpired(validUntil, day('2026-10-02T00:00:00.000Z')), true);
  assert.equal(
    quoteState.quoteExpiredBefore(day('2026-10-02T13:45:00.000Z')).toISOString(),
    '2026-10-02T00:00:00.000Z',
  );
});

test('devis: withEffectiveQuoteStatus ne modifie pas la ligne lue en base', () => {
  const row = { id: 'q1', status: QuoteStatus.SENT, validUntil: day('2026-10-01T00:00:00Z') };
  const presented = quoteState.withEffectiveQuoteStatus(row, day('2026-10-05T00:00:00Z'));
  assert.equal(presented.status, QuoteStatus.EXPIRED);
  assert.equal(row.status, QuoteStatus.SENT);
  assert.notEqual(presented, row);
});

function quotesPrisma({ rows = [], quoteRow = null }) {
  const captured = { where: null, update: 0 };
  const tx = {
    quote: {
      findFirst: async () => quoteRow,
      update: async () => {
        captured.update += 1;
        return quoteRow;
      },
    },
  };
  return {
    captured,
    quote: {
      findMany: async ({ where }) => {
        captured.where = where;
        return rows;
      },
      count: async () => rows.length,
      findFirst: async () => quoteRow,
      update: async () => {
        captured.update += 1;
        return quoteRow;
      },
    },
    $transaction: async (ops) => (Array.isArray(ops) ? Promise.all(ops) : ops(tx)),
  };
}

test('devis: GET /quotes presente un statut coherent avec la date de validite', async () => {
  const expired = day('2026-10-01T00:00:00.000Z');
  const rows = [{ id: 'q1', status: QuoteStatus.SENT, validUntil: expired }];
  const prisma = quotesPrisma({ rows });
  const service = new QuotesService(prisma, {}, {}, {}, {}, {}, {}, {});
  const result = await service.list({}, policy());
  assert.equal(result.items[0].status, QuoteStatus.EXPIRED);
  assert.equal(rows[0].status, QuoteStatus.SENT, 'la ligne en base ne bouge pas');
});

test('devis: le filtre ?status=EXPIRED cible les memes lignes que le statut derive', async () => {
  const prisma = quotesPrisma({ rows: [] });
  const service = new QuotesService(prisma, {}, {}, {}, {}, {}, {}, {});
  await service.list({ status: QuoteStatus.EXPIRED }, policy());
  const clause = prisma.captured.where.AND[0].OR[1];
  assert.deepEqual(clause.status.in, [QuoteStatus.SENT, QuoteStatus.VIEWED]);
  assert.ok(clause.validUntil.lt instanceof Date);
});

test('devis: GET /quotes/:id applique aussi le statut derive', async () => {
  const row = { id: 'q1', status: QuoteStatus.VIEWED, validUntil: day('2026-10-01T00:00:00Z') };
  const service = new QuotesService(quotesPrisma({ quoteRow: row }), {}, {}, {}, {}, {}, {}, {});
  assert.equal((await service.getOne('q1', policy())).status, QuoteStatus.EXPIRED);
});

test('devis: markViewed ne repasse PAS un devis perime en VIEWED', async () => {
  const row = {
    id: 'q1',
    status: QuoteStatus.SENT,
    validUntil: day('2026-10-01T00:00:00.000Z'),
  };
  const prisma = quotesPrisma({ quoteRow: row });
  const service = new QuotesService(prisma, {}, {}, {}, {}, {}, {}, {});
  const client = policy({
    roles: ['CLIENT'],
    clientId: 'c1',
    permissions: new Set(['quote:read:own']),
  });
  const result = await service.markViewed('q1', client);
  assert.equal(result.status, QuoteStatus.EXPIRED);
  assert.equal(row.status, QuoteStatus.SENT, 'la ligne en base reste historique');
  assert.equal(prisma.captured.update, 0);
});

test('devis: envoyer un devis dont la validite est deja passee est refuse', async () => {
  const row = {
    id: 'q1',
    reference: 'DEV-1',
    status: QuoteStatus.DRAFT,
    clientId: 'c1',
    prospectId: null,
    total: { toFixed: () => '0.00' },
    currency: 'DZD',
    validUntil: day('2026-10-01T00:00:00Z'),
    prospect: { email: 'a@b.test' },
  };
  const prisma = quotesPrisma({ quoteRow: row });
  const service = new QuotesService(prisma, {}, {}, {}, {}, {}, {}, {});
  await rejectsWith(service.send('q1', policy(), meta), 'QUOTE_VALIDITY_PAST');
  assert.equal(prisma.captured.update, 0, 'le devis ne doit pas partir');
});

// -----------------------------------------------------------------------------
// 4. PROJETS — reouverture et avancement declare
// -----------------------------------------------------------------------------

test('projet: avancement recalcule depuis les taches (annulees exclues)', () => {
  assert.equal(projectProgressFromTaskStatuses([]), 0);
  assert.equal(projectProgressFromTaskStatuses(['CANCELLED']), 0);
  assert.equal(projectProgressFromTaskStatuses(['DONE', 'TODO']), 50);
  assert.equal(projectProgressFromTaskStatuses(['DONE', 'TODO', 'CANCELLED']), 50);
  assert.equal(projectProgressFromTaskStatuses(['DONE', 'DONE', 'TODO']), 67);
});

function projectsService({ statuses, beforeStatus = ProjectStatus.COMPLETED }) {
  const captured = { data: null, taskQuery: 0 };
  const tx = {
    project: {
      update: async ({ data }) => {
        captured.data = data;
        return {};
      },
    },
  };
  const service = Object.create(ProjectsService.prototype);
  service.prisma = {
    task: {
      findMany: async () => {
        captured.taskQuery += 1;
        return statuses.map((status) => ({ status }));
      },
    },
    $transaction: async (fn) => fn(tx),
  };
  service.access = {
    requireReadable: async () => ({
      status: beforeStatus,
      clientId: 'c1',
      managerId: null,
      name: 'Projet',
    }),
  };
  service.activity = { record: async () => {} };
  service.notifications = { notify: async () => {} };
  service.audit = { record: async () => {} };
  service.detailById = async () => ({ id: 'p1', progressPercent: captured.data.progressPercent });
  return { service, captured };
}

test('projet: reouvrir un projet termine ne laisse PAS son avancement a 100 %', async () => {
  const { service, captured } = projectsService({ statuses: ['DONE', 'TODO'] });
  const result = await service.changeStatus(
    'p1',
    { status: ProjectStatus.IN_PROGRESS },
    policy(),
    meta,
  );
  assert.equal(captured.data.progressPercent, 50);
  assert.equal(captured.data.completedAt, null);
  assert.equal(result.progressPercent, 50);
  assert.equal(captured.taskQuery, 1);
});

test('projet: une valeur explicite du DTO garde la priorite, la cloture impose 100', async () => {
  const explicit = projectsService({ statuses: ['DONE', 'TODO'] });
  await explicit.service.changeStatus(
    'p1',
    { status: ProjectStatus.IN_PROGRESS, progressPercent: 30 },
    policy(),
    meta,
  );
  assert.equal(explicit.captured.data.progressPercent, 30);
  assert.equal(explicit.captured.taskQuery, 0);

  const closing = projectsService({
    statuses: ['TODO'],
    beforeStatus: ProjectStatus.IN_PROGRESS,
  });
  await closing.service.changeStatus('p1', { status: ProjectStatus.COMPLETED }, policy(), meta);
  assert.equal(closing.captured.data.progressPercent, 100);
  assert.ok(closing.captured.data.completedAt instanceof Date);
});

// -----------------------------------------------------------------------------
// 5. NOTIFICATIONS — le type doit porter le sens de l evenement
// -----------------------------------------------------------------------------

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? walk(file) : file.endsWith('.ts') ? [file] : [];
  });
}

test('notifications: un jalon atteint emet MILESTONE_REACHED, pas SYSTEM', () => {
  const source = readSrc('modules', 'milestones', 'milestones.service.ts');
  assert.match(source, /type: NotificationType\.MILESTONE_REACHED/);
  const block = source.slice(source.indexOf('Jalon atteint :') - 400, source.indexOf('Jalon atteint :'));
  assert.ok(!/type: NotificationType\.SYSTEM/.test(block));
});

function emittedNotificationTypes() {
  const declared = new Set(schemaEnums().NotificationType);
  const used = new Set();
  for (const file of walk(src('modules'))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/NotificationType\.([A-Z_]+)/g)) used.add(match[1]);
    // Certains producteurs ecrivent le type en litteral (message.service.ts).
    // Les autres `type: 'MAJUSCULE'` du code (type de ressource partagee,
    // etc.) ne sont PAS des notifications : on les ignore.
    for (const match of source.matchAll(/type:\s*'([A-Z_]+)'/g)) {
      if (declared.has(match[1])) used.add(match[1]);
    }
  }
  return used;
}

test('notifications: tous les types emis existent dans le schema Prisma', () => {
  const declared = new Set(schemaEnums().NotificationType);
  const used = emittedNotificationTypes();
  assert.ok(used.size > 0);
  for (const type of used) {
    assert.ok(declared.has(type), `type de notification inconnu du schema : ${type}`);
  }
});

test('notifications: les types sans producteur sont inventories, pas annonces', () => {
  // Dette connue, volontairement NON CORRIGEE ici : ajouter un rappeleur
  // d'echeance de tache ou un evenement de partage de document est une
  // FONCTIONNALITE (roadmap), pas une correction d'incoherence. Ces types sont
  // declares et mappe cote UI, donc aucun producteur n'annonce une action
  // impossible — mais le filtre correspondant restera vide tant qu'ils dorment.
  // Le test echouera si un producteur apparait sans que la liste soit mise a
  // jour : c'est le signal qu'il faut brancher l'ecran de son cote.
  const dead = schemaEnums().NotificationType.filter(
    (type) => !emittedNotificationTypes().has(type),
  );
  assert.deepEqual(dead, ['TASK_DUE_SOON', 'DOCUMENT_SHARED']);
});
