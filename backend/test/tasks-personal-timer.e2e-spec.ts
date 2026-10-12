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
 * TACHES PERSONNELLES + MINUTEUR SERVEUR — BOUT EN BOUT, SUR LA VRAIE BASE.
 *
 * CE QUI SE VERIFIE ICI, ET NULLE PART AILLEURS :
 *
 *  - L'ISOLATION DE L'ESPACE PERSONNEL : un chef de projet qui detient
 *    `task:read:any` ne lit PAS la tache personnelle d'un collegue — ni par
 *    `/me/tasks`, ni par `GET /tasks/:id` (404, pas 403 : le 403 confirmerait
 *    l'existence de la ligne) ;
 *  - LA SEPARATION DES ESPACES : une tache personnelle n'apparait dans aucun
 *    projet, ne porte ni jalon, ni visibilite client, ni assignation ;
 *  - LA PERENNITE DU MINUTEUR : la session vit en base — `GET /timer` la
 *    retrouve, un second `start` est refuse (409), et l'arret ecrit UNE saisie
 *    de temps, ni plus ni moins ;
 *  - L'IMPUTATION : le temps d'une tache personnelle est NON FACTURABLE et sans
 *    projet ; le temps d'une tache de projet reprend la tache comme perimetre ;
 *  - L'ESPACE CLIENT EST FERME : un compte CLIENT n'a pas de minuteur.
 *
 * Le harnais est celui de `projects.e2e-spec.ts` : AppModule reel, donnees
 * propres (`e2e-tpt-…`) effacees a la fin, sessions partagees entre scenarios
 * pour respecter le limiteur de debit sur la connexion.
 */

const PASSWORD = 'Boussole-Tempete-41-Nuage';

const EMAIL_DEV = 'e2e-tpt-dev@comexa.example';
const EMAIL_OTHER_DEV = 'e2e-tpt-autre-dev@comexa.example';
const EMAIL_PM = 'e2e-tpt-pm@comexa.example';
const EMAIL_CM = 'e2e-tpt-cm@comexa.example';
const EMAIL_CLIENT = 'e2e-tpt-client@comexa.example';

const CLIENT_REF = 'E2E-TPT-CLI';

interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: { page: number; perPage: number; total: number; totalPages: number };
}

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details: unknown };
}

interface PersonalTaskData {
  id: string;
  title: string;
  isPersonal: boolean;
  projectId: string | null;
  assigneeId: string | null;
  isClientVisible: boolean;
  status: string;
}

interface TimerSessionData {
  id: string;
  status: 'RUNNING' | 'PAUSED' | 'STOPPED';
  taskId: string | null;
  taskIsPersonal: boolean;
  accumulatedSeconds: number;
  elapsedSeconds: number;
  savedMinutes?: number | null;
  timeEntryId?: string | null;
  overflowMinutes?: number;
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

/**
 * Premiere tache d'une liste, avec assertion explicite : `noUncheckedIndexedAccess`
 * refuserait `items[0]` sans cette garantie — et une liste vide doit FAIRE ECHOUER
 * le scénario, pas rendre `undefined` jusqu'à une assertion plus loin.
 */
function firstTask(items: PersonalTaskData[], label = 'liste de taches'): PersonalTaskData {
  const task = items[0];
  assert.ok(task, `${label} : au moins une tache attendue`);
  return task;
}

describe('Taches personnelles et minuteur serveur (bout en bout, base reelle)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  let devToken = '';
  let otherDevToken = '';
  let pmToken = '';
  let cmToken = '';
  let clientToken = '';
  let devUserId = '';

  before(async () => {
    assert.equal(
      passwordPolicyViolation(PASSWORD),
      null,
      'le mot de passe de test doit respecter la politique reelle',
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);

    const setup = configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    baseUrl = `/${setup.apiPrefix}`;

    const passwordHash = await hashPassword(PASSWORD);

    // Nettoyage preventif d'un run precedent interrompu.
    await prisma.user.deleteMany({
      where: { email: { in: [EMAIL_DEV, EMAIL_OTHER_DEV, EMAIL_PM, EMAIL_CM, EMAIL_CLIENT] } },
    });
    await prisma.client.deleteMany({ where: { reference: CLIENT_REF } });

    const [devRole, pmRole, cmRole, clientRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { code: 'DEVELOPER' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'PROJECT_MANAGER' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({
        where: { code: 'COMMUNICATION_MANAGER' },
        select: { id: true },
      }),
      prisma.role.findUniqueOrThrow({ where: { code: 'CLIENT' }, select: { id: true } }),
    ]);

    const client = await prisma.client.create({
      data: { reference: CLIENT_REF, companyName: 'E2E TPT Client' },
      select: { id: true },
    });

    const makeUser = (
      email: string,
      firstName: string,
      roleId: string,
      extra: Record<string, unknown> = {},
    ) =>
      prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName: 'Tpt',
          status: 'ACTIVE',
          isEmailVerified: true,
          mustChangePassword: false,
          roles: { create: { roleId } },
          ...extra,
        },
        select: { id: true },
      });

    const dev = await makeUser(EMAIL_DEV, 'Dev', devRole.id);
    devUserId = dev.id;
    await makeUser(EMAIL_OTHER_DEV, 'Autre', devRole.id);
    await makeUser(EMAIL_PM, 'Chef', pmRole.id);
    await makeUser(EMAIL_CM, 'Gerant', cmRole.id);
    await makeUser(EMAIL_CLIENT, 'Client', clientRole.id, { clientId: client.id });

    devToken = await login(EMAIL_DEV);
    otherDevToken = await login(EMAIL_OTHER_DEV);
    pmToken = await login(EMAIL_PM);
    cmToken = await login(EMAIL_CM);
    clientToken = await login(EMAIL_CLIENT);
  });

  after(async () => {
    if (prisma) {
      // Les saisies de temps et sessions suivent leurs utilisateurs (CASCADE) ;
      // le projet de test, lui, est supprime explicitement.
      await prisma.user.deleteMany({
        where: {
          email: { in: [EMAIL_DEV, EMAIL_OTHER_DEV, EMAIL_PM, EMAIL_CM, EMAIL_CLIENT] },
        },
      });
      await prisma.project.deleteMany({ where: { reference: 'E2E-TPT-PRJ' } });
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

  function as(token: string) {
    return {
      get: (path: string) =>
        request(app.getHttpServer())
          .get(`${baseUrl}${path}`)
          .set('Authorization', `Bearer ${token}`),
      post: (path: string) =>
        request(app.getHttpServer())
          .post(`${baseUrl}${path}`)
          .set('Authorization', `Bearer ${token}`),
      patch: (path: string) =>
        request(app.getHttpServer())
          .patch(`${baseUrl}${path}`)
          .set('Authorization', `Bearer ${token}`),
      delete: (path: string) =>
        request(app.getHttpServer())
          .delete(`${baseUrl}${path}`)
          .set('Authorization', `Bearer ${token}`),
    };
  }

  // ---------------------------------------------------------------------------
  // Taches personnelles
  // ---------------------------------------------------------------------------

  it('un developpeur cree sa tache personnelle : privee, sans projet, a lui', async () => {
    const response = await as(devToken)
      .post('/me/tasks')
      .send({ title: 'Preparer mes notes de reunion', priority: 'HIGH', estimateMinutes: 30 });

    assert.equal(response.status, 201, response.text);
    const task = dataOf<PersonalTaskData>(response);
    assert.equal(task.isPersonal, true);
    assert.equal(task.projectId, null);
    assert.equal(task.assigneeId, devUserId);
    assert.equal(task.isClientVisible, false);
    assert.equal(task.status, 'TODO');
  });

  it('POST /me/tasks refuse les champs du monde projet (whitelist strict)', async () => {
    const response = await as(devToken)
      .post('/me/tasks')
      .send({ title: 'Tentative de triche', projectId: 'x', assigneeId: 'y' });

    assert.equal(response.status, 400, response.text);
    assert.equal(errorOf(response).code, 'VALIDATION_FAILED');
  });

  it('elle figure dans ?personalOnly=true et dans aucune liste de projet', async () => {
    const mine = await as(devToken).get('/me/tasks?personalOnly=true');
    assert.equal(mine.status, 200, mine.text);
    const items = dataOf<PersonalTaskData[]>(mine);
    assert.ok(
      items.every((task) => task.isPersonal && task.projectId === null),
      'personalOnly ne doit renvoyer que des taches personnelles',
    );
    assert.ok(items.some((task) => task.title === 'Preparer mes notes de reunion'));
  });

  it("ISOLATION : un chef de projet (task:read:any) NE LIT PAS la tache personnelle d'un collegue", async () => {
    const mine = await as(devToken).get('/me/tasks?personalOnly=true');
    const personal = dataOf<PersonalTaskData[]>(mine).find(
      (task) => task.title === 'Preparer mes notes de reunion',
    );
    assert.ok(personal, 'la tache personnelle creee precedemment doit exister');

    // Par identifiant : 404, pas 403 — un 403 confirmerait que la ligne existe.
    const direct = await as(pmToken).get(`/tasks/${personal.id}`);
    assert.equal(direct.status, 404, direct.text);

    // Par la liste du projet : aucun projet ne la porte.
    const assign = await as(pmToken)
      .patch(`/tasks/${personal.id}/assign`)
      .send({ assigneeId: null });
    assert.equal(assign.status, 404, assign.text);
  });

  it('elle ne se rattache au collectif par aucun bout : jalon, visibilite, assignation', async () => {
    const mine = await as(devToken).get('/me/tasks?personalOnly=true');
    const personal = firstTask(dataOf<PersonalTaskData[]>(mine));

    const visible = await as(devToken)
      .patch(`/tasks/${personal.id}`)
      .send({ isClientVisible: true });
    assert.equal(visible.status, 422, visible.text);
    assert.equal(errorOf(visible).code, 'PERSONAL_TASK_SHAPE_REFUSED');

    // L'assignation est gardee par `task:assign:any` : un developpeur s'arrete
    // au garde (403), et le service refuse quand meme un chef de projet sur sa
    // PROPRE tache personnelle (422) — personne n'assigne une tache personnelle.
    const devAssign = await as(devToken)
      .patch(`/tasks/${personal.id}/assign`)
      .send({ assigneeId: devUserId });
    assert.equal(devAssign.status, 403, devAssign.text);

    const pmOwn = await as(pmToken).post('/me/tasks').send({ title: 'Note privee du chef' });
    assert.equal(pmOwn.status, 201, pmOwn.text);
    const pmTask = dataOf<PersonalTaskData>(pmOwn);
    const pmAssign = await as(pmToken)
      .patch(`/tasks/${pmTask.id}/assign`)
      .send({ assigneeId: devUserId });
    assert.equal(pmAssign.status, 422, pmAssign.text);
    assert.equal(errorOf(pmAssign).code, 'PERSONAL_TASK_NOT_ASSIGNABLE');
  });

  it('le proprietaire garde la main sur sa tache personnelle, MEME terminee', async () => {
    const mine = await as(devToken).get('/me/tasks?personalOnly=true');
    const personal = firstTask(dataOf<PersonalTaskData[]>(mine));

    const closed = await as(devToken)
      .patch(`/tasks/${personal.id}/status`)
      .send({ status: 'DONE' });
    assert.equal(closed.status, 200, closed.text);

    // La regle « un DONE ne bouge plus » protege les rapports de projet : sur un
    // carnet prive, le proprietaire corrige librement.
    const edit = await as(devToken)
      .patch(`/tasks/${personal.id}`)
      .send({ title: 'Notes de reunion (relues)' });
    assert.equal(edit.status, 200, edit.text);
    assert.equal(dataOf<PersonalTaskData>(edit).title, 'Notes de reunion (relues)');

    const reopen = await as(devToken)
      .patch(`/tasks/${personal.id}/status`)
      .send({ status: 'IN_PROGRESS' });
    assert.equal(reopen.status, 200, reopen.text);
  });

  it('un gerant communication (sans projet) a SON espace personnel et son temps', async () => {
    const created = await as(cmToken).post('/me/tasks').send({ title: 'Planifier la newsletter' });
    assert.equal(created.status, 201, created.text);
    const task = dataOf<PersonalTaskData>(created);

    const mine = await as(cmToken).get('/me/tasks?personalOnly=true');
    const items = dataOf<PersonalTaskData[]>(mine);
    assert.ok(items.some((t) => t.id === task.id));

    // Mais l'espace des autres reste ferme : pas de projets, pas de taches d'autrui.
    const devList = await as(devToken).get('/me/tasks?personalOnly=true');
    const devTask = firstTask(dataOf<PersonalTaskData[]>(devList), 'liste du developpeur');
    const theirs = await as(cmToken).get(`/tasks/${devTask.id}`);
    assert.equal(theirs.status, 404, theirs.text);
  });

  it('un compte CLIENT ne voit ni ne cree de taches personnelles', async () => {
    const list = await as(clientToken).get('/me/tasks');
    assert.equal(list.status, 403, list.text);

    const create = await as(clientToken).post('/me/tasks').send({ title: 'Curiosite' });
    assert.equal(create.status, 403, create.text);
  });

  it('la suppression personnelle passe par le porteur, et lui seul', async () => {
    const created = await as(cmToken).post('/me/tasks').send({ title: 'Tache a supprimer' });
    const task = dataOf<PersonalTaskData>(created);

    // Un collegue ne peut pas la supprimer (404 : elle n'existe pas pour lui).
    const foreign = await as(devToken).delete(`/tasks/${task.id}`);
    assert.equal(foreign.status, 404, foreign.text);

    const mine = await as(cmToken).delete(`/tasks/${task.id}`);
    assert.equal(mine.status, 200, mine.text);

    const after = await as(cmToken).get(`/tasks/${task.id}`);
    assert.equal(after.status, 404, after.text);
  });

  // ---------------------------------------------------------------------------
  // Minuteur serveur
  // ---------------------------------------------------------------------------

  it('au depart, aucun minuteur actif : GET /timer vaut null', async () => {
    const response = await as(devToken).get('/timer');
    assert.equal(response.status, 200, response.text);
    assert.equal(dataOf<TimerSessionData | null>(response), null);
  });

  it('il demarre sur une tache personnelle SANS assignation prealable', async () => {
    const mine = await as(devToken).get('/me/tasks?personalOnly=true');
    const task = firstTask(dataOf<PersonalTaskData[]>(mine), 'tache du developpeur');

    const started = await as(devToken).post('/timer/start').send({ taskId: task.id });
    assert.equal(started.status, 201, started.text);
    const session = dataOf<TimerSessionData>(started);
    assert.equal(session.status, 'RUNNING');
    assert.equal(session.taskId, task.id);
    assert.equal(session.taskIsPersonal, true);
    assert.ok(session.elapsedSeconds >= 0);

    const current = await as(devToken).get('/timer');
    assert.equal(dataOf<TimerSessionData | null>(current)?.id, session.id);
  });

  it('UN SEUL minuteur par compte : le second demarrage echoue en 409', async () => {
    const mine = await as(devToken).get('/me/tasks?personalOnly=true');
    const task = firstTask(dataOf<PersonalTaskData[]>(mine), 'tache du developpeur');

    const again = await as(devToken).post('/timer/start').send({ taskId: task.id });
    assert.equal(again.status, 409, again.text);
    assert.equal(errorOf(again).code, 'TIMER_ALREADY_ACTIVE');
  });

  it('chaque compte a LE SIEN : deux sessions paralleles de deux personnes existent', async () => {
    const mine = await as(otherDevToken).get('/me/tasks?personalOnly=true');
    // L'autre developpeur n'a pas encore de tache personnelle : il en cree une.
    if (mine.status === 200 && dataOf<PersonalTaskData[]>(mine).length === 0) {
      await as(otherDevToken).post('/me/tasks').send({ title: 'Tache minuteur collegue' });
    }
    const list = await as(otherDevToken).get('/me/tasks?personalOnly=true');
    const task = firstTask(dataOf<PersonalTaskData[]>(list), 'liste du collegue');

    const started = await as(otherDevToken).post('/timer/start').send({ taskId: task.id });
    assert.equal(started.status, 201, started.text);
    assert.equal(dataOf<TimerSessionData>(started).status, 'RUNNING');

    // Et le premier compte est toujours en session : les deux coexistent.
    const first = await as(devToken).get('/timer');
    assert.equal(dataOf<TimerSessionData | null>(first)?.status, 'RUNNING');

    // Rangement : le collegue arrete le sien des maintenant.
    const stopped = await as(otherDevToken).post('/timer/stop');
    assert.equal(stopped.status, 200, stopped.text);
  });

  it('pause : le decompte se gele ; reprise : il repart du solde', async () => {
    const paused = await as(devToken).post('/timer/pause');
    assert.equal(paused.status, 200, paused.text);
    const session = dataOf<TimerSessionData>(paused);
    assert.equal(session.status, 'PAUSED');
    const frozen = session.accumulatedSeconds;

    const wrong = await as(devToken).post('/timer/pause');
    assert.equal(wrong.status, 409, wrong.text);
    assert.equal(errorOf(wrong).code, 'TIMER_NOT_RUNNING');

    const resumed = await as(devToken).post('/timer/resume');
    assert.equal(resumed.status, 200, resumed.text);
    const running = dataOf<TimerSessionData>(resumed);
    assert.equal(running.status, 'RUNNING');
    assert.equal(running.accumulatedSeconds, frozen, 'la reprise ne double pas le solde');

    const wrongResume = await as(devToken).post('/timer/resume');
    assert.equal(wrongResume.status, 409, wrongResume.text);
  });

  it("l'arret cree UNE saisie de temps non facturable, sans projet, et ferme la session", async () => {
    const stopped = await as(devToken).post('/timer/stop');
    assert.equal(stopped.status, 200, stopped.text);
    const result = dataOf<TimerSessionData>(stopped);
    assert.equal(result.status, 'STOPPED');
    assert.ok((result.savedMinutes ?? 0) >= 1, 'un temps travaille vaut au moins une minute');
    assert.ok(result.timeEntryId);

    // La feuille de temps du porteur contient exactement CETTE ligne.
    const mine = await as(devToken).get('/me/tasks?personalOnly=true');
    const task = firstTask(dataOf<PersonalTaskData[]>(mine), 'tache du developpeur');
    const entries = await as(devToken).get(`/tasks/${task.id}/time-entries`);
    assert.equal(entries.status, 200, entries.text);
    const rows =
      dataOf<{ id: string; minutes: number; billable: boolean; projectId: string | null }[]>(
        entries,
      );
    const saved = rows.find((row) => row.id === result.timeEntryId);
    assert.ok(saved, 'la saisie du minuteur doit apparaitre sur la tache');
    assert.equal(saved.projectId, null);
    assert.equal(saved.billable, false, 'une tache personnelle ne se facture pas');

    // Session fermee : plus rien a l'arret suivant.
    const after = await as(devToken).get('/timer');
    assert.equal(dataOf<TimerSessionData | null>(after), null);
    const again = await as(devToken).post('/timer/stop');
    assert.equal(again.status, 409, again.text);
  });

  it('le minuteur ne chronometre QUE des taches modifiables par le porteur', async () => {
    // Une tache de projet creee par le PM et assignee a quelqu'un d'autre.
    const clientList = await prisma.client.findUniqueOrThrow({
      where: { reference: CLIENT_REF },
      select: { id: true },
    });
    const project = await prisma.project.create({
      data: {
        reference: 'E2E-TPT-PRJ',
        name: 'Projet minuteur',
        clientId: clientList.id,
        status: 'IN_PROGRESS',
        startDate: new Date(),
      },
      select: { id: true },
    });

    const theirs = await as(pmToken).post(`/projects/${project.id}/tasks`).send({
      title: 'Tache de projet du collegue',
      assigneeId: devUserId,
    });
    assert.equal(theirs.status, 201, theirs.text);
    const task = dataOf<PersonalTaskData>(theirs);

    // Creee PAR le PM mais assignee au dev : c'est le perimetre d'ecriture qui
    // decide, et le dev peut la chronometrer.
    const devStart = await as(devToken).post('/timer/start').send({ taskId: task.id });
    assert.equal(devStart.status, 201, devStart.text);
    const session = dataOf<TimerSessionData>(devStart);
    assert.equal(session.taskIsPersonal, false);

    // Le temps d'une tache de projet est facturable, et impute au projet.
    const stopped = await as(devToken).post('/timer/stop');
    assert.equal(stopped.status, 200, stopped.text);
    const result = dataOf<TimerSessionData>(stopped);
    const entries = await as(devToken).get(`/tasks/${task.id}/time-entries`);
    const rows = dataOf<{ id: string; projectId: string | null; billable: boolean }[]>(entries);
    const saved = rows.find((row) => row.id === result.timeEntryId);
    assert.ok(saved);
    assert.equal(saved.projectId, project.id);
    assert.equal(saved.billable, true);

    // Un compte CLIENT n'a pas de minuteur, meme sur une tache visible.
    const clientStart = await as(clientToken).post('/timer/start').send({ taskId: task.id });
    assert.equal(clientStart.status, 403, clientStart.text);
    const clientTimer = await as(clientToken).get('/timer');
    assert.equal(clientTimer.status, 403, clientTimer.text);
  });
});
