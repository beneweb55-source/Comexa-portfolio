// DOIT rester la premiere ligne : les decorateurs de Nest sont evalues au
// chargement des modules, et ils ont besoin de `Reflect.metadata` deja installe.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { hashPassword, passwordPolicyViolation } from '../src/common/security/password.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * ASSIGNATION, MINUTEUR SUR LES TACHES DE PROJET, OBJECTIFS — BOUT EN BOUT.
 *
 * CE QUI SE VERIFIE ICI :
 *
 *  - L'ASSIGNATION MENE QUELQUE PART : on ne confie une tache qu'a un compte
 *    qui pourra la voir ET la faire avancer ; l'assigne la retrouve dans « mes
 *    taches », peut la cocher et la chronometrer, et il est prevenu ;
 *  - LE MINUTEUR SUR LES TACHES DE PROJET : le selecteur propose exactement ce
 *    que le demarrage accepte (une tache non assignee pour un chef de projet,
 *    rien d'autre que ses taches pour un developpeur) ; changer de tache garde
 *    le temps ; la note devient la description ; l'abandon n'ecrit rien ;
 *  - LES TACHES PERSONNELLES SE DECOCHENT (DONE -> TODO), les taches de projet
 *    gardent leur machine a etats stricte ;
 *  - LES OBJECTIFS sont prives, ne regroupent que « mes taches », et leur
 *    avancement se deduit des taches.
 */

const PASSWORD = 'Boussole-Tempete-41-Nuage';

const EMAIL_DEV = 'e2e-gta-dev@comexa.example';
const EMAIL_OTHER_DEV = 'e2e-gta-autre-dev@comexa.example';
const EMAIL_PM = 'e2e-gta-pm@comexa.example';
const EMAIL_CM = 'e2e-gta-cm@comexa.example';
const EMAIL_SALES = 'e2e-gta-sales@comexa.example';
const EMAIL_CLIENT = 'e2e-gta-client@comexa.example';
const ALL_EMAILS = [EMAIL_DEV, EMAIL_OTHER_DEV, EMAIL_PM, EMAIL_CM, EMAIL_SALES, EMAIL_CLIENT];

const CLIENT_REF = 'E2E-GTA-CLI';
const PROJECT_REF = 'E2E-GTA-PRJ';

interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: { page: number; perPage: number; total: number; totalPages: number };
}

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details: unknown };
}

interface TaskData {
  id: string;
  title: string;
  status: string;
  isPersonal: boolean;
  projectId: string | null;
  assigneeId: string | null;
  goal?: { id: string; title: string } | null;
}

interface TimerData {
  id: string;
  status: 'RUNNING' | 'PAUSED' | 'STOPPED';
  taskId: string | null;
  note: string | null;
  elapsedSeconds: number;
  accumulatedSeconds: number;
  task: { id: string; project: { id: string; name: string } | null } | null;
  timeEntryId?: string | null;
  savedMinutes?: number;
}

interface GoalData {
  id: string;
  title: string;
  status: 'ACTIVE' | 'ACHIEVED' | 'ARCHIVED';
  achievedAt: string | null;
  progress: { total: number; done: number; open: number; cancelled: number; percent: number };
  tasks: { id: string; status: string }[];
}

function dataOf<T>(response: request.Response): T {
  const body = response.body as SuccessBody<T>;
  assert.equal(body.success, true, `reponse attendue en succes, recu : ${response.text}`);
  return body.data;
}

function errorOf(response: request.Response): ErrorBody['error'] {
  const body = response.body as ErrorBody;
  assert.equal(body.success, false, "une reponse d'echec doit porter success: false");
  return body.error;
}

describe('Assignation, minuteur sur les taches de projet et objectifs (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  type Who = 'dev' | 'otherDev' | 'pm' | 'cm' | 'sales' | 'client';
  const tokens: Record<Who, string> = { dev: '', otherDev: '', pm: '', cm: '', sales: '', client: '' };
  const ids = {
    dev: '',
    otherDev: '',
    pm: '',
    cm: '',
    sales: '',
    client: '',
    assignedTask: '',
    otherDevTask: '',
    unassignedTask: '',
    goal: '',
    goalPersonalTask: '',
    secondGoal: '',
  };
  let projectId = '';

  before(async () => {
    assert.equal(passwordPolicyViolation(PASSWORD), null);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    const setup = configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    baseUrl = `/${setup.apiPrefix}`;

    await prisma.user.deleteMany({ where: { email: { in: ALL_EMAILS } } });
    await prisma.project.deleteMany({ where: { reference: PROJECT_REF } });
    await prisma.client.deleteMany({ where: { reference: CLIENT_REF } });

    const roleId = async (code: string) =>
      (await prisma.role.findUniqueOrThrow({ where: { code: code as never }, select: { id: true } })).id;
    const client = await prisma.client.create({
      data: { reference: CLIENT_REF, companyName: 'E2E GTA Client' },
      select: { id: true },
    });
    const passwordHash = await hashPassword(PASSWORD);
    const makeUser = async (key: Who, email: string, role: string, extra: Record<string, unknown> = {}) => {
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName: key,
          lastName: 'Gta',
          status: 'ACTIVE',
          isEmailVerified: true,
          mustChangePassword: false,
          roles: { create: { roleId: await roleId(role) } },
          ...extra,
        },
        select: { id: true },
      });
      ids[key] = user.id;
    };

    await makeUser('dev', EMAIL_DEV, 'DEVELOPER');
    await makeUser('otherDev', EMAIL_OTHER_DEV, 'DEVELOPER');
    await makeUser('pm', EMAIL_PM, 'PROJECT_MANAGER');
    await makeUser('cm', EMAIL_CM, 'COMMUNICATION_MANAGER');
    await makeUser('sales', EMAIL_SALES, 'SALES');
    await makeUser('client', EMAIL_CLIENT, 'CLIENT', { clientId: client.id });

    const project = await prisma.project.create({
      data: {
        reference: PROJECT_REF,
        name: 'Projet assignation',
        clientId: client.id,
        status: 'IN_PROGRESS',
        startDate: new Date(),
        managerId: ids.pm,
      },
      select: { id: true },
    });
    projectId = project.id;

    for (const [key, email] of [
      ['dev', EMAIL_DEV],
      ['otherDev', EMAIL_OTHER_DEV],
      ['pm', EMAIL_PM],
      ['cm', EMAIL_CM],
      ['sales', EMAIL_SALES],
      ['client', EMAIL_CLIENT],
    ] as const) {
      tokens[key] = await login(email);
    }
  });

  after(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { in: ALL_EMAILS } } });
      await prisma.project.deleteMany({ where: { reference: PROJECT_REF } });
      await prisma.client.deleteMany({ where: { reference: CLIENT_REF } });
    }
    if (app) await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email, password: PASSWORD });
    assert.equal(response.status, 200, `connexion de ${email} : ${response.text}`);
    return dataOf<{ accessToken: string }>(response).accessToken;
  }

  /** Requetes au nom de `who`, dans l'espace annonce (aucun = droits du role). */
  function as(who: Who, space?: 'personal' | 'team') {
    const withAuth = (req: request.Test) => {
      req.set('Authorization', `Bearer ${tokens[who]}`);
      if (space) req.set('X-Comexa-Space', space);
      return req;
    };
    const server = () => request(app.getHttpServer());
    return {
      get: (path: string) => withAuth(server().get(`${baseUrl}${path}`)),
      post: (path: string) => withAuth(server().post(`${baseUrl}${path}`)),
      put: (path: string) => withAuth(server().put(`${baseUrl}${path}`)),
      patch: (path: string) => withAuth(server().patch(`${baseUrl}${path}`)),
      delete: (path: string) => withAuth(server().delete(`${baseUrl}${path}`)),
    };
  }

  async function createProjectTask(title: string, assigneeId?: string): Promise<TaskData> {
    const response = await as('pm', 'team')
      .post(`/projects/${projectId}/tasks`)
      .send({ title, ...(assigneeId ? { assigneeId } : {}) });
    assert.equal(response.status, 201, response.text);
    return dataOf<TaskData>(response);
  }

  // ---------------------------------------------------------------------------
  // Assignation
  // ---------------------------------------------------------------------------

  it('les candidats a l’assignation sont ceux qui pourront travailler la tache', async () => {
    const response = await as('pm', 'team').get(`/projects/${projectId}/tasks/assignees`);
    assert.equal(response.status, 200, response.text);
    const people = dataOf<{ id: string; isMember: boolean; isMe: boolean }[]>(response).map((p) => p.id);
    assert.ok(people.includes(ids.dev), 'un developpeur est assignable');
    assert.ok(people.includes(ids.otherDev));
    assert.ok(people.includes(ids.pm), 'le chef de projet peut se confier une tache');
    assert.ok(!people.includes(ids.cm), 'un gerant communication ne voit aucune tache de projet');
    assert.ok(!people.includes(ids.sales), 'un commercial ne peut pas faire avancer une tache');
    assert.ok(!people.includes(ids.client), 'jamais un compte client');

    const dev = await as('dev', 'team').get(`/projects/${projectId}/tasks/assignees`);
    assert.equal(dev.status, 403, 'la liste est reservee a qui peut assigner');
  });

  it('le serveur refuse une assignation qui ne menerait nulle part', async () => {
    const task = await createProjectTask('Tache a distribuer');

    const toCm = await as('pm', 'team').patch(`/tasks/${task.id}/assign`).send({ assigneeId: ids.cm });
    assert.equal(toCm.status, 422, toCm.text);
    assert.equal(errorOf(toCm).code, 'TASK_ASSIGNEE_CANNOT_WORK_TASKS');

    const toSales = await as('pm', 'team').patch(`/tasks/${task.id}/assign`).send({ assigneeId: ids.sales });
    assert.equal(toSales.status, 422, toSales.text);
    assert.equal(errorOf(toSales).code, 'TASK_ASSIGNEE_CANNOT_WORK_TASKS');

    const toClient = await as('pm', 'team').patch(`/tasks/${task.id}/assign`).send({ assigneeId: ids.client });
    assert.equal(toClient.status, 422, toClient.text);
    assert.equal(errorOf(toClient).code, 'TASK_ASSIGNEE_IS_CLIENT');

    const atCreation = await as('pm', 'team')
      .post(`/projects/${projectId}/tasks`)
      .send({ title: 'Confiee au commercial', assigneeId: ids.sales });
    assert.equal(atCreation.status, 422, atCreation.text);
  });

  it('une tache non assignee se retrouve par ?unassignedOnly=true, puis se confie', async () => {
    const task = await createProjectTask('Maquette a confier');

    const open = await as('pm', 'team').get(`/projects/${projectId}/tasks?unassignedOnly=true&perPage=100`);
    assert.equal(open.status, 200, open.text);
    const unassigned = dataOf<TaskData[]>(open);
    assert.ok(unassigned.some((row) => row.id === task.id));
    assert.ok(unassigned.every((row) => row.assigneeId === null));

    const assigned = await as('pm', 'team').patch(`/tasks/${task.id}/assign`).send({ assigneeId: ids.dev });
    assert.equal(assigned.status, 200, assigned.text);
    ids.assignedTask = task.id;

    // L'assigne la retrouve dans SES taches, depuis son espace personnel…
    const mine = await as('dev', 'personal').get('/me/tasks?perPage=100');
    assert.ok(dataOf<TaskData[]>(mine).some((row) => row.id === task.id));

    // … il est prevenu, dans l'espace personnel (notification de SON travail)…
    const notifications = await as('dev', 'personal').get('/notifications?perPage=20');
    assert.equal(notifications.status, 200, notifications.text);
    const items = dataOf<{ type: string; link: string | null }[]>(notifications);
    assert.ok(
      items.some((n) => n.type === 'TASK_ASSIGNED' && n.link === `/taches/${task.id}`),
      'la notification TASK_ASSIGNED pointe vers la tache',
    );

    // … il a rejoint l'equipe du projet, et il peut la faire avancer.
    const people = dataOf<{ id: string; isMember: boolean }[]>(
      await as('pm', 'team').get(`/projects/${projectId}/tasks/assignees`),
    );
    assert.equal(people.find((p) => p.id === ids.dev)?.isMember, true);

    const progress = await as('dev', 'personal').patch(`/tasks/${task.id}/status`).send({ status: 'IN_PROGRESS' });
    assert.equal(progress.status, 200, progress.text);
  });

  it('reassigner deplace la tache d’un « mes taches » a l’autre', async () => {
    const task = await createProjectTask('Recette a reassigner', ids.dev);
    const moved = await as('pm', 'team').patch(`/tasks/${task.id}/assign`).send({ assigneeId: ids.otherDev });
    assert.equal(moved.status, 200, moved.text);

    const devList = dataOf<TaskData[]>(await as('dev', 'personal').get('/me/tasks?perPage=100'));
    assert.ok(!devList.some((row) => row.id === task.id), 'l’ancien assigne ne la voit plus');
    const otherList = dataOf<TaskData[]>(await as('otherDev', 'personal').get('/me/tasks?perPage=100'));
    assert.ok(otherList.some((row) => row.id === task.id), 'le nouvel assigne la voit');
    ids.otherDevTask = task.id;
  });

  // ---------------------------------------------------------------------------
  // Minuteur sur les taches de projet
  // ---------------------------------------------------------------------------

  it('le selecteur du chef de projet propose une tache de projet NON assignee', async () => {
    const task = await createProjectTask('Point technique sans assigne');
    ids.unassignedTask = task.id;

    const team = await as('pm', 'team').get('/timer/tasks?scope=team&perPage=100');
    assert.equal(team.status, 200, team.text);
    const rows = dataOf<{ id: string; isMine: boolean; project: { id: string } | null }[]>(team);
    const row = rows.find((candidate) => candidate.id === task.id);
    assert.ok(row, 'la tache non assignee doit etre chronometrable par le chef de projet');
    assert.equal(row.isMine, false);
    assert.equal(row.project?.id, projectId);

    const search = await as('pm', 'team').get(`/timer/tasks?search=${encodeURIComponent('point technique')}`);
    assert.ok(dataOf<{ id: string }[]>(search).some((candidate) => candidate.id === task.id));
  });

  it('le selecteur d’un developpeur ne propose QUE ses taches', async () => {
    const all = dataOf<{ id: string; isMine: boolean }[]>(
      await as('dev', 'personal').get('/timer/tasks?perPage=100'),
    );
    assert.ok(all.length > 0);
    assert.ok(all.every((row) => row.isMine), 'aucune tache d’un collegue');
    assert.ok(!all.some((row) => row.id === ids.otherDevTask));
    assert.ok(!all.some((row) => row.id === ids.unassignedTask));

    const team = dataOf<unknown[]>(await as('dev', 'team').get('/timer/tasks?scope=team'));
    assert.equal(team.length, 0, 'un developpeur n’a pas d’« autres taches » a chronometrer');
  });

  it('chef de projet : demarrer, noter, CHANGER de tache sans perdre le temps, terminer', async () => {
    const start = await as('pm', 'team').post('/timer/start').send({ taskId: ids.unassignedTask });
    assert.equal(start.status, 201, start.text);
    const session = dataOf<TimerData>(start);
    assert.equal(session.task?.project?.id, projectId, 'la session porte le projet de la tache');

    const pause = await as('pm', 'team').post('/timer/pause');
    assert.equal(pause.status, 200, pause.text);
    // On simule 20 minutes deja travaillees (solde des segments passes).
    await prisma.timerSession.update({ where: { id: session.id }, data: { accumulatedSeconds: 1200 } });

    const note = await as('pm', 'team').patch('/timer').send({ note: '  Revue des maquettes  ' });
    assert.equal(note.status, 200, note.text);
    assert.equal(dataOf<TimerData>(note).note, 'Revue des maquettes');

    const other = await createProjectTask('Tache finalement chronometree');
    const switched = await as('pm', 'team').patch('/timer').send({ taskId: other.id });
    assert.equal(switched.status, 200, switched.text);
    const afterSwitch = dataOf<TimerData>(switched);
    assert.equal(afterSwitch.taskId, other.id);
    assert.equal(afterSwitch.accumulatedSeconds, 1200, 'changer de tache garde le temps ecoule');

    const stop = await as('pm', 'team').post('/timer/stop').send({});
    assert.equal(stop.status, 200, stop.text);
    const stopped = dataOf<TimerData>(stop);
    assert.equal(stopped.savedMinutes, 20);

    const entry = await prisma.timeEntry.findUniqueOrThrow({
      where: { id: stopped.timeEntryId ?? '' },
      select: { taskId: true, projectId: true, billable: true, description: true, minutes: true },
    });
    assert.equal(entry.taskId, other.id, 'imputee a la tache finale');
    assert.equal(entry.projectId, projectId);
    assert.equal(entry.billable, true);
    assert.equal(entry.description, 'Revue des maquettes', 'la note devient la description');

    const audit = await prisma.auditLog.count({ where: { entityId: session.id, action: 'TIMER_UPDATED' } });
    assert.equal(audit, 1, 'le changement de tache est journalise (pas la note)');
  });

  it('la description donnee a l’arret l’emporte sur la note', async () => {
    await as('pm', 'team').post('/timer/start').send({ taskId: ids.unassignedTask, note: 'note initiale' });
    const stop = await as('pm', 'team').post('/timer/stop').send({ description: 'Atelier client termine' });
    assert.equal(stop.status, 200, stop.text);
    const entry = await prisma.timeEntry.findUniqueOrThrow({
      where: { id: dataOf<TimerData>(stop).timeEntryId ?? '' },
      select: { description: true },
    });
    assert.equal(entry.description, 'Atelier client termine');
  });

  it('un developpeur ne bascule pas son minuteur sur la tache d’un collegue', async () => {
    const start = await as('dev', 'personal').post('/timer/start').send({});
    assert.equal(start.status, 201, start.text);
    assert.equal(dataOf<TimerData>(start).taskId, null, 'demarrage rapide sans tache');

    const forbidden = await as('dev', 'personal').patch('/timer').send({ taskId: ids.otherDevTask });
    assert.equal(forbidden.status, 404, forbidden.text);

    // Il choisit ensuite SA tache : le temps sera facturable sur le projet.
    const pick = await as('dev', 'personal').patch('/timer').send({ taskId: ids.assignedTask });
    assert.equal(pick.status, 200, pick.text);
    const stop = await as('dev', 'personal').post('/timer/stop').send({});
    const entry = await prisma.timeEntry.findUniqueOrThrow({
      where: { id: dataOf<TimerData>(stop).timeEntryId ?? '' },
      select: { taskId: true, billable: true, projectId: true },
    });
    assert.equal(entry.taskId, ids.assignedTask);
    assert.equal(entry.billable, true);
    assert.equal(entry.projectId, projectId);
  });

  it('abandonner n’ecrit AUCUNE saisie et libere le minuteur', async () => {
    const before = await prisma.timeEntry.count({ where: { userId: ids.dev } });
    const start = await as('dev', 'personal').post('/timer/start').send({ taskId: ids.assignedTask });
    assert.equal(start.status, 201, start.text);

    const discard = await as('dev', 'personal').post('/timer/discard');
    assert.equal(discard.status, 200, discard.text);
    assert.equal(dataOf<{ discarded: boolean }>(discard).discarded, true);

    assert.equal(await prisma.timeEntry.count({ where: { userId: ids.dev } }), before);
    const current = await as('dev', 'personal').get('/timer');
    assert.equal(dataOf<TimerData | null>(current), null);

    const again = await as('dev', 'personal').post('/timer/discard');
    assert.equal(again.status, 409, 'rien a abandonner');
  });

  it('le resume du jour et les taches recentes refletent les saisies', async () => {
    const summary = await as('dev', 'personal').get('/timer/summary');
    assert.equal(summary.status, 200, summary.text);
    const data = dataOf<{ todayMinutes: number; weekMinutes: number; entries: unknown[] }>(summary);
    assert.ok(data.todayMinutes >= 1);
    assert.ok(data.weekMinutes >= data.todayMinutes);
    assert.ok(data.entries.length >= 1);

    const recent = dataOf<{ id: string }[]>(await as('dev', 'personal').get('/timer/recent-tasks'));
    assert.ok(recent.some((task) => task.id === ids.assignedTask));
  });

  // ---------------------------------------------------------------------------
  // Cases a cocher : transitions
  // ---------------------------------------------------------------------------

  it('une tache personnelle se coche ET se decoche (DONE -> TODO)', async () => {
    const created = await as('dev', 'personal').post('/me/tasks').send({ title: 'Relire mes notes' });
    assert.equal(created.status, 201, created.text);
    const task = dataOf<TaskData>(created);

    const done = await as('dev', 'personal').patch(`/tasks/${task.id}/status`).send({ status: 'DONE' });
    assert.equal(done.status, 200, done.text);
    const undone = await as('dev', 'personal').patch(`/tasks/${task.id}/status`).send({ status: 'TODO' });
    assert.equal(undone.status, 200, undone.text);
    assert.equal(dataOf<TaskData>(undone).status, 'TODO');
  });

  it('une tache de projet garde sa machine a etats (DONE -> TODO refuse)', async () => {
    const done = await as('dev', 'personal').patch(`/tasks/${ids.assignedTask}/status`).send({ status: 'DONE' });
    assert.equal(done.status, 200, done.text);
    const back = await as('dev', 'personal').patch(`/tasks/${ids.assignedTask}/status`).send({ status: 'TODO' });
    assert.equal(back.status, 422, back.text);
    assert.equal(errorOf(back).code, 'TASK_STATUS_TRANSITION_REFUSED');
    const reopen = await as('dev', 'personal')
      .patch(`/tasks/${ids.assignedTask}/status`)
      .send({ status: 'IN_PROGRESS' });
    assert.equal(reopen.status, 200, 'la reouverture passe par IN_PROGRESS');
  });

  // ---------------------------------------------------------------------------
  // Objectifs
  // ---------------------------------------------------------------------------

  it('un objectif regroupe des taches personnelles ET des taches de projet assignees', async () => {
    const created = await as('dev', 'personal')
      .post('/me/goals')
      .send({ title: 'Livrer la boutique', color: 'lilac', targetDate: '2026-12-15' });
    assert.equal(created.status, 201, created.text);
    const goal = dataOf<GoalData>(created);
    assert.equal(goal.progress.total, 0);
    ids.goal = goal.id;

    const personal = await as('dev', 'personal')
      .post('/me/tasks')
      .send({ title: 'Preparer la demo', goalId: goal.id });
    assert.equal(personal.status, 201, personal.text);
    ids.goalPersonalTask = dataOf<TaskData>(personal).id;

    const link = await as('dev', 'personal').put(`/me/goals/${goal.id}/tasks/${ids.assignedTask}`);
    assert.equal(link.status, 200, link.text);
    assert.equal(dataOf<GoalData>(link).progress.total, 2);

    const done = await as('dev', 'personal')
      .patch(`/tasks/${ids.goalPersonalTask}/status`)
      .send({ status: 'DONE' });
    assert.equal(done.status, 200, done.text);

    const read = dataOf<GoalData>(await as('dev', 'personal').get(`/me/goals/${goal.id}`));
    assert.equal(read.progress.done, 1);
    assert.equal(read.progress.percent, 50);

    const mine = dataOf<TaskData[]>(await as('dev', 'personal').get('/me/tasks?perPage=100'));
    assert.equal(mine.find((task) => task.id === ids.assignedTask)?.goal?.id, goal.id);
    assert.equal(mine.find((task) => task.id === ids.goalPersonalTask)?.goal?.id, goal.id);
  });

  it('un objectif est PRIVE : ni lecture, ni liaison par un collegue', async () => {
    const read = await as('pm', 'personal').get(`/me/goals/${ids.goal}`);
    assert.equal(read.status, 404, read.text);
    const link = await as('pm', 'personal').put(`/me/goals/${ids.goal}/tasks/${ids.unassignedTask}`);
    assert.equal(link.status, 404, link.text);
    const list = dataOf<GoalData[]>(await as('pm', 'personal').get('/me/goals'));
    assert.ok(!list.some((goal) => goal.id === ids.goal));

    // La liaison du developpeur ne sort pas non plus par la tache de projet.
    const pmTasks = dataOf<TaskData[]>(await as('pm', 'team').get(`/projects/${projectId}/tasks?perPage=100`));
    assert.ok(pmTasks.every((task) => !('goal' in task)), 'aucun objectif dans la liste du projet');
  });

  it('on ne rattache que « mes taches » ; et jamais depuis l’espace equipe', async () => {
    const theirs = await as('dev', 'personal').put(`/me/goals/${ids.goal}/tasks/${ids.otherDevTask}`);
    assert.equal(theirs.status, 404, theirs.text);
    assert.equal(errorOf(theirs).code, 'TASK_NOT_FOUND');

    const fromTeam = await as('dev', 'team').get('/me/goals');
    assert.equal(fromTeam.status, 403, 'les objectifs ne sortent pas de l’espace personnel');

    const client = await as('client').get('/me/goals');
    assert.equal(client.status, 403, client.text);
  });

  it('une tache change d’objectif (un objectif par tache et par personne)', async () => {
    const second = dataOf<GoalData>(
      await as('dev', 'personal').post('/me/goals').send({ title: 'Monter en competence' }),
    );
    const move = await as('dev', 'personal').put(`/me/goals/${second.id}/tasks/${ids.assignedTask}`);
    assert.equal(move.status, 200, move.text);
    assert.equal(dataOf<GoalData>(move).progress.total, 1);

    const first = dataOf<GoalData>(await as('dev', 'personal').get(`/me/goals/${ids.goal}`));
    assert.ok(!first.tasks.some((task) => task.id === ids.assignedTask), 'retiree du premier objectif');
    ids.secondGoal = second.id;
  });

  it('une tache reassignee sort de l’objectif de l’ancien assigne (sans rien effacer)', async () => {
    const reassign = await as('pm', 'team').patch(`/tasks/${ids.assignedTask}/assign`).send({ assigneeId: ids.otherDev });
    assert.equal(reassign.status, 200, reassign.text);
    const goal = dataOf<GoalData>(await as('dev', 'personal').get(`/me/goals/${ids.secondGoal}`));
    assert.equal(goal.progress.total, 0);

    const back = await as('pm', 'team').patch(`/tasks/${ids.assignedTask}/assign`).send({ assigneeId: ids.dev });
    assert.equal(back.status, 200, back.text);
    const again = dataOf<GoalData>(await as('dev', 'personal').get(`/me/goals/${ids.secondGoal}`));
    assert.equal(again.progress.total, 1, 'la liaison revient avec la tache');
  });

  it('statuts : atteint (date), archive (ferme aux ajouts), suppression sans perte de tache', async () => {
    const achieved = await as('dev', 'personal').patch(`/me/goals/${ids.goal}`).send({ status: 'ACHIEVED' });
    assert.equal(achieved.status, 200, achieved.text);
    assert.ok(dataOf<GoalData>(achieved).achievedAt, 'la date d’atteinte est posee');

    const reopened = await as('dev', 'personal').patch(`/me/goals/${ids.goal}`).send({ status: 'ACTIVE' });
    assert.equal(dataOf<GoalData>(reopened).achievedAt, null);

    const archived = await as('dev', 'personal').patch(`/me/goals/${ids.goal}`).send({ status: 'ARCHIVED' });
    assert.equal(archived.status, 200, archived.text);
    const refused = await as('dev', 'personal')
      .post('/me/tasks')
      .send({ title: 'Trop tard', goalId: ids.goal });
    assert.equal(refused.status, 422, refused.text);
    assert.equal(errorOf(refused).code, 'GOAL_ARCHIVED');

    const listed = dataOf<GoalData[]>(await as('dev', 'personal').get('/me/goals'));
    assert.ok(!listed.some((goal) => goal.id === ids.goal), 'l’archive est hors de la liste par defaut');
    const archive = dataOf<GoalData[]>(await as('dev', 'personal').get('/me/goals?status=ARCHIVED'));
    assert.ok(archive.some((goal) => goal.id === ids.goal));

    const removed = await as('dev', 'personal').delete(`/me/goals/${ids.goal}`);
    assert.equal(removed.status, 200, removed.text);
    const task = await as('dev', 'personal').get(`/tasks/${ids.goalPersonalTask}`);
    assert.equal(task.status, 200, 'la tache survit a son objectif');
  });

  it('valide les entrees : teinte de la charte, titre, champs inconnus', async () => {
    const color = await as('dev', 'personal').post('/me/goals').send({ title: 'Couleur', color: 'red' });
    assert.equal(color.status, 400, color.text);
    const short = await as('dev', 'personal').post('/me/goals').send({ title: 'x' });
    assert.equal(short.status, 400, short.text);
    const owner = await as('dev', 'personal').post('/me/goals').send({ title: 'Pour un autre', ownerId: ids.pm });
    assert.equal(owner.status, 400, 'ownerId n’est pas un champ accepte');
  });
});
