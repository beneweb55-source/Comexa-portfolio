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
 * PARCOURS PROJETS / TACHES / JALONS / TEMPS — BOUT EN BOUT, SUR LA VRAIE BASE.
 *
 * CE FICHIER N'EST PAS UNE LISTE DE ROUTES QUI REPONDENT. Ce qui se verifie ici,
 * ce sont les proprietes qui ne se lisent nulle part dans le code et qui cassent
 * en silence :
 *
 *  - UN COMPTE CLIENT NE LIT PAS LE PROJET D'UN AUTRE CLIENT, meme en changeant
 *    un identifiant dans l'URL, et meme en passant `?clientId=` dans la requete ;
 *  - UN COMPTE CLIENT NE VOIT AUCUNE TACHE, ni par la lecture, ni par la liste ;
 *  - UN DEVELOPPEUR NE MODIFIE PAS LA TACHE D'UN COLLEGUE, parce que la ligne
 *    n'est jamais chargee pour lui — pas parce qu'un `if` l'a refusee apres coup ;
 *  - L'INVARIANT DES SOUS-TACHES tient dans les DEUX SENS ;
 *  - LE PROJET D'UNE SAISIE DE TEMPS vient de la tache, jamais de la requete.
 *
 * Toutes dependent de la BASE : une contrainte d'unicite, un filtre `where`, une
 * transaction. Un service simule les aurait toutes rendues vraies, ce qui est
 * exactement le probleme.
 *
 * CE FICHIER ATTEND QUE LE MODULE SOIT MONTE DANS `app.module.ts`. Tant qu'il ne
 * l'est pas, toutes ces routes repondent 404 et les tests echouent en bloc : c'est
 * l'etat attendu de cette livraison, et non une regression.
 *
 * ATTENTION AU LIMITEUR DE DEBIT : la connexion est plafonnee a 10 appels par
 * minute et par adresse. Ce fichier ouvre CINQ sessions et les partage entre les
 * scenarios. Ajouter des connexions sans regarder ce compteur produirait des
 * echecs a 429, intermittents et penibles a lire.
 *
 * IL CREE SES PROPRES DONNEES (`e2e-prj-…`) ET LES SUPPRIME A LA FIN, dans
 * l'ordre des cles etrangeres. Aucune donnee existante n'est touchee.
 */

const PASSWORD = 'Boussole-Tempete-41-Nuage';

const EMAIL_PM = 'e2e-prj-manager@comexa.example';
const EMAIL_DEV = 'e2e-prj-dev@comexa.example';
const EMAIL_OTHER_DEV = 'e2e-prj-autre-dev@comexa.example';
const EMAIL_CLIENT_A = 'e2e-prj-client-a@comexa.example';
const EMAIL_CLIENT_B = 'e2e-prj-client-b@comexa.example';

const CLIENT_REF_A = 'E2E-PRJ-CLI-A';
const CLIENT_REF_B = 'E2E-PRJ-CLI-B';

/** Forme de succes, telle que `TransformInterceptor` la produit. */
interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: { page: number; perPage: number; total: number; totalPages: number };
}

/** Forme d'echec, telle que `AllExceptionsFilter` la produit. */
interface ErrorBody {
  success: false;
  error: { code: string; message: string; details: unknown };
}

interface ProjectData {
  id: string;
  reference: string;
  name: string;
  status: string;
  client: { id: string };
  manager: { id: string } | null;
}

/**
 * Une tache, telle que le DETAIL la rend.
 *
 * `project`, `reporterId` et `reporter` sont OPTIONNELS parce que cette interface
 * sert aussi aux listes : `/me/tasks` reste volontairement legere et ne les porte
 * pas. Le detail d'une tache, lui, les porte toujours — c'est ce que verifient
 * les scenarios plus bas, champ par champ.
 */
interface TaskData {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  projectId: string;
  parentTaskId: string | null;
  reporterId?: string | null;
  project?: { id: string; name: string };
  reporter?: { id: string; firstName: string; lastName: string; avatarKey: string | null } | null;
}

/** Un profil propose par le filtre « par personne ». */
interface TaskCreatorData {
  id: string;
  firstName: string;
  lastName: string;
  avatarKey: string | null;
  taskCount: number;
}

interface MilestoneData {
  id: string;
  title: string;
  status: string;
  reachedAt: string | null;
}

interface TimeEntryData {
  id: string;
  minutes: number;
  projectId: string;
  taskId: string | null;
  userId: string;
  spentOn: string;
}

/**
 * `TransformInterceptor` SORT `meta` DE `data`. Une liste paginee arrive donc
 * sous la forme `{ success, data: [...], meta }` : `data` est le TABLEAU, pas un
 * objet `{ items, meta }`. Lire `data.items` rendrait `undefined` partout, et les
 * assertions « la liste est vide » passeraient pour de mauvaises raisons.
 */
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

describe('Projets, taches, jalons et temps (bout en bout, base reelle)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  const createdUserIds: string[] = [];
  const createdClientIds: string[] = [];
  const createdProjectIds: string[] = [];

  let pmToken = '';
  let devToken = '';
  let otherDevToken = '';
  let clientAToken = '';

  let pmUserId = '';
  let devUserId = '';
  let otherDevUserId = '';
  let clientAId = '';
  let clientBId = '';

  let projectAId = '';
  let projectBId = '';

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
      where: {
        email: { in: [EMAIL_PM, EMAIL_DEV, EMAIL_OTHER_DEV, EMAIL_CLIENT_A, EMAIL_CLIENT_B] },
      },
    });
    await prisma.client.deleteMany({ where: { reference: { in: [CLIENT_REF_A, CLIENT_REF_B] } } });

    const [pmRole, devRole, clientRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { code: 'PROJECT_MANAGER' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'DEVELOPER' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'CLIENT' }, select: { id: true } }),
    ]);

    // DEUX DOSSIERS CLIENTS DISTINCTS. C'est la seule facon de verifier qu'un
    // client ne lit pas les projets d'un autre : avec un seul dossier, le test
    // passerait meme si le perimetre etait absent.
    const clientA = await prisma.client.create({
      data: { reference: CLIENT_REF_A, companyName: 'E2E Prj Client A' },
      select: { id: true },
    });
    const clientB = await prisma.client.create({
      data: { reference: CLIENT_REF_B, companyName: 'E2E Prj Client B' },
      select: { id: true },
    });
    clientAId = clientA.id;
    clientBId = clientB.id;
    createdClientIds.push(clientA.id, clientB.id);

    const pm = await prisma.user.create({
      data: {
        email: EMAIL_PM,
        passwordHash,
        firstName: 'Chef',
        lastName: 'De Projet',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        roles: { create: { roleId: pmRole.id } },
      },
      select: { id: true },
    });

    const dev = await prisma.user.create({
      data: {
        email: EMAIL_DEV,
        passwordHash,
        firstName: 'Developpeur',
        lastName: 'Assigne',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        roles: { create: { roleId: devRole.id } },
      },
      select: { id: true },
    });

    const otherDev = await prisma.user.create({
      data: {
        email: EMAIL_OTHER_DEV,
        passwordHash,
        firstName: 'Developpeur',
        lastName: 'Collegue',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        roles: { create: { roleId: devRole.id } },
      },
      select: { id: true },
    });

    // Un compte client par dossier : c'est `User.clientId` qui alimente
    // `policy.clientId`, donc le perimetre. Le rattachement vient de la BASE.
    const clientAUser = await prisma.user.create({
      data: {
        email: EMAIL_CLIENT_A,
        passwordHash,
        firstName: 'Contact',
        lastName: 'Client A',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        clientId: clientA.id,
        roles: { create: { roleId: clientRole.id } },
      },
      select: { id: true },
    });

    const clientBUser = await prisma.user.create({
      data: {
        email: EMAIL_CLIENT_B,
        passwordHash,
        firstName: 'Contact',
        lastName: 'Client B',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        clientId: clientB.id,
        roles: { create: { roleId: clientRole.id } },
      },
      select: { id: true },
    });

    pmUserId = pm.id;
    devUserId = dev.id;
    otherDevUserId = otherDev.id;

    createdUserIds.push(pm.id, dev.id, otherDev.id, clientAUser.id, clientBUser.id);

    // CINQ CONNEXIONS, ET PAS UNE DE PLUS : le plafond est de 10 par minute. Le
    // jeton du client B n'est pas garde : le seul scenario qui le concerne
    // constate qu'il ne voit rien de plus.
    pmToken = await login(EMAIL_PM);
    devToken = await login(EMAIL_DEV);
    otherDevToken = await login(EMAIL_OTHER_DEV);
    clientAToken = await login(EMAIL_CLIENT_A);
    await login(EMAIL_CLIENT_B);
  });

  after(async () => {
    if (!app) {
      return;
    }

    // ORDRE DES CLES ETRANGERES. L'audit ne part pas en cascade : on le retire
    // explicitement, par acteur ET par entite. Les projets emportent taches,
    // jalons, saisies, membres et activites ; les comptes emportent leurs roles
    // et leurs notifications.
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ actorId: { in: createdUserIds } }, { entityId: { in: createdProjectIds } }],
      },
    });
    await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    // `Project.clientId` est en `Restrict` : les projets doivent etre partis.
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });

    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email, password: PASSWORD });

    assert.equal(response.status, 200, `connexion de ${email} : ${response.text}`);
    return dataOf<{ accessToken: string }>(response).accessToken;
  }

  /** Un appel authentifie, avec le jeton du role voulu. */
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

  /**
   * Cree une tache assignee au developpeur et rend la ligne.
   *
   * Chaque scenario de temps ouvre SA tache plutot que de piocher dans
   * `/me/tasks` : l'ordre de cette liste depend de `dueDate`, de la priorite puis
   * de la date de creation, et un scenario qui ferme une tache modifierait
   * silencieusement le resultat du suivant.
   */
  async function tacheAssigneeAuDev(titre: string): Promise<TaskData> {
    const response = await as(pmToken)
      .post(`/projects/${projectAId}/tasks`)
      .send({ title: titre, assigneeId: devUserId });

    assert.equal(response.status, 201, response.text);
    const task = dataOf<TaskData>(response);
    assert.equal(task.assigneeId, devUserId);
    return task;
  }

  // ---------------------------------------------------------------------------
  // Mise en place : deux projets, un par dossier client
  // ---------------------------------------------------------------------------

  it('cree un projet, lui donne une reference numerotee et inscrit son responsable dans l’equipe', async () => {
    const response = await as(pmToken).post('/projects').send({
      name: 'Refonte du site vitrine',
      description: 'Projet de test bout en bout.',
      clientId: clientAId,
      managerId: pmUserId,
      priority: 'HIGH',
    });

    assert.equal(response.status, 201, response.text);
    const project = dataOf<ProjectData>(response);
    createdProjectIds.push(project.id);
    projectAId = project.id;

    // LE COMPTEUR PARTAGE A ECRIT LA REFERENCE. On verifie la FORME, pas un
    // numero precis, qui depend de ce que la base contient deja.
    assert.match(
      project.reference,
      /^PRJ-\d{4}-\d{4}$/,
      `reference inattendue : ${project.reference}`,
    );
    assert.equal(project.status, 'DRAFT');
    assert.equal(project.client.id, clientAId);
    assert.equal(project.manager?.id, pmUserId);

    // Le responsable doit etre membre de l'equipe : sans cela il ne verrait pas
    // son propre projet s'il n'avait que `project:read:assigned`.
    const members = await as(pmToken).get(`/projects/${project.id}/members`);
    assert.equal(members.status, 200, members.text);

    // Cette route rend un TABLEAU, pas une page : pas de `meta` ici.
    const equipe = dataOf<{ user: { id: string } }[]>(members);
    assert.ok(
      equipe.some((member) => member.user.id === pmUserId),
      "le responsable doit figurer dans l'equipe",
    );
  });

  it('cree un second projet rattache a l’AUTRE dossier client', async () => {
    const response = await as(pmToken)
      .post('/projects')
      .send({ name: 'Application mobile', clientId: clientBId, managerId: pmUserId });

    assert.equal(response.status, 201, response.text);
    projectBId = dataOf<ProjectData>(response).id;
    createdProjectIds.push(projectBId);
  });

  it('refuse un corps qui contient un champ non declare, statut compris', async () => {
    // `status` n'est pas dans `CreateProjectDto` : un projet nait DRAFT. Ce test
    // prouve que `forbidNonWhitelisted` est reellement actif sur ces routes et
    // qu'on ne peut pas se donner un statut des la creation.
    const response = await as(pmToken)
      .post('/projects')
      .send({ name: 'Projet escalade', clientId: clientAId, status: 'COMPLETED' });

    assert.equal(response.status, 400, response.text);
    assert.equal(errorOf(response).code, 'VALIDATION_FAILED');
  });

  // ---------------------------------------------------------------------------
  // Perimetre du compte client
  // ---------------------------------------------------------------------------

  it('ne montre a un compte client que les projets de SON dossier', async () => {
    const seen = await as(clientAToken).get('/projects');
    assert.equal(seen.status, 200, seen.text);

    const ids = dataOf<ProjectData[]>(seen).map((project) => project.id);
    assert.ok(ids.includes(projectAId), 'le client A doit voir son projet');
    assert.ok(!ids.includes(projectBId), 'le client A ne doit PAS voir le projet du client B');
  });

  it('repond 404, et non 403, sur le projet d’un autre client', async () => {
    // 404 et non 403 : un 403 confirmerait que l'identifiant correspond a un
    // projet existant. Le refus ne doit pas etre une fuite d'information.
    const response = await as(clientAToken).get(`/projects/${projectBId}`);
    assert.equal(response.status, 404, response.text);
    assert.equal(errorOf(response).code, 'PROJECT_NOT_FOUND');
  });

  it('ne peut pas elargir son perimetre avec ?clientId= dans la requete', async () => {
    // LE SCENARIO DU BRIEF. `clientId` est a la fois un filtre de recherche et,
    // pour un compte client, le perimetre. S'ils etaient combines dans un meme
    // objet, `?clientId=<autre>` ecraserait le perimetre. Ils sont combines en
    // `AND`, donc la reponse est vide.
    const response = await as(clientAToken).get(`/projects?clientId=${clientBId}`);

    assert.equal(response.status, 200, response.text);
    assert.deepEqual(
      dataOf<ProjectData[]>(response),
      [],
      'le filtre de recherche ne doit pas elargir le perimetre',
    );
  });

  it('interdit au compte client de lire les taches, meme de son propre projet', async () => {
    // « Le client ne doit pas voir les taches internes », et la verification est
    // SERVEUR : le role CLIENT ne detient aucune permission `task:*`.
    const response = await as(clientAToken).get(`/projects/${projectAId}/tasks`);
    assert.equal(response.status, 403, response.text);
  });

  it('interdit au compte client de lire le temps saisi', async () => {
    const response = await as(clientAToken).get('/time-entries');
    assert.equal(response.status, 403, response.text);
  });

  it('interdit au compte client de modifier le statut d’un projet, meme le sien', async () => {
    const response = await as(clientAToken)
      .patch(`/projects/${projectAId}/status`)
      .send({ status: 'IN_PROGRESS' });

    assert.equal(response.status, 403, response.text);
  });

  // ---------------------------------------------------------------------------
  // Taches : lecture, ecriture, assignation
  // ---------------------------------------------------------------------------

  it('cree une tache assignee a un developpeur et l’ajoute a l’equipe du projet', async () => {
    const task = await tacheAssigneeAuDev('Integrer la maquette');
    assert.equal(task.status, 'TODO');
    assert.equal(task.projectId, projectAId);

    const members = await as(pmToken).get(`/projects/${projectAId}/members`);
    const equipe = dataOf<{ user: { id: string } }[]>(members);
    assert.ok(
      equipe.some((member) => member.user.id === devUserId),
      "l'assigne doit rejoindre l'equipe du projet",
    );
  });

  it('montre a un developpeur SES taches, et pas celles des autres', async () => {
    const mine = await as(devToken).get('/me/tasks');
    assert.equal(mine.status, 200, mine.text);

    const miennes = dataOf<TaskData[]>(mine);
    assert.ok(miennes.length > 0, 'le developpeur doit voir au moins sa tache');

    // `/me/tasks` ne renvoie pas `assigneeId` (la liste est volontairement
    // legere) : la propriete se verifie donc par l'ENSEMBLE. Le collegue, qui
    // detient le meme role et le meme scope `assigned`, ne doit voir AUCUNE des
    // lignes que le porteur voit.
    const ids = new Set(miennes.map((task) => task.id));

    const collegue = await as(otherDevToken).get('/me/tasks');
    assert.equal(collegue.status, 200, collegue.text);

    for (const task of dataOf<TaskData[]>(collegue)) {
      assert.equal(ids.has(task.id), false, `le collegue ne doit pas voir ${task.id}`);
    }
  });

  it('repond 404 a un developpeur qui tente de modifier la tache d’un collegue', async () => {
    const creee = await as(pmToken)
      .post(`/projects/${projectAId}/tasks`)
      .send({ title: 'Tache du collegue', assigneeId: otherDevUserId });

    assert.equal(creee.status, 201, creee.text);
    const task = dataOf<TaskData>(creee);

    // 404 : la ligne n'est PAS chargee pour lui. Ce n'est pas un `if` qui la
    // refuse apres lecture, c'est le `where` qui l'exclut.
    const renommage = await as(devToken).patch(`/tasks/${task.id}`).send({ title: 'Detournement' });
    assert.equal(renommage.status, 404, renommage.text);
    assert.equal(errorOf(renommage).code, 'TASK_NOT_FOUND');

    // Le changement de statut passe par la MEME exclusion.
    const statut = await as(devToken).patch(`/tasks/${task.id}/status`).send({ status: 'DONE' });
    assert.equal(statut.status, 404, statut.text);

    // Et la ligne est intacte : la tentative n'a rien ecrit.
    const verif = await as(pmToken).get(`/tasks/${task.id}`);
    assert.equal(verif.status, 200, verif.text);
    assert.equal(dataOf<TaskData>(verif).title, 'Tache du collegue');
  });

  it('refuse a un developpeur la suppression d’un projet, meme le sien', async () => {
    const response = await as(devToken).delete(`/projects/${projectAId}`);
    assert.equal(response.status, 403, response.text);
  });

  it('n’autorise pas un developpeur a assigner une tache a quelqu’un d’autre', async () => {
    // `task:assign:any` est absent du role DEVELOPER : le garde refuse la ROUTE,
    // avant meme que le service ne voie l'identifiant.
    const tache = await as(pmToken)
      .post(`/projects/${projectAId}/tasks`)
      .send({ title: 'Tache a reassigner', assigneeId: devUserId });
    const task = dataOf<TaskData>(tache);

    const response = await as(devToken)
      .patch(`/tasks/${task.id}/assign`)
      .send({ assigneeId: otherDevUserId });

    assert.equal(response.status, 403, response.text);
  });

  // ---------------------------------------------------------------------------
  // Taches : projet, createur et filtre par personne
  // ---------------------------------------------------------------------------

  it('rend le projet et le profil du createur de chaque tache, quel que soit son auteur', async () => {
    // Le responsable ouvre le projet : il doit y voir TOUTES ses taches, celles
    // des autres comprises. Les deux auteurs ci-dessous le prouvent.
    const parLeResponsable = dataOf<TaskData>(
      await as(pmToken).post(`/projects/${projectAId}/tasks`).send({ title: 'Cadrage valide' }),
    );
    const parLeDev = dataOf<TaskData>(
      await as(devToken)
        .post(`/projects/${projectAId}/tasks`)
        .send({ title: 'Correctif d’affichage' }),
    );

    // LE CREATEUR VIENT DU JETON. `reporterId` n'existe pas dans le corps de la
    // requete : le dev signe sa tache, et ne peut pas signer celle d'un autre.
    assert.equal(parLeDev.reporter?.id, devUserId);
    assert.equal(parLeResponsable.reporter?.id, pmUserId);
    assert.equal(parLeDev.project?.id, projectAId);
    assert.ok(parLeDev.project?.name, 'le nom du projet accompagne la tache');

    const response = await as(pmToken).get(`/projects/${projectAId}/tasks?perPage=100`);
    assert.equal(response.status, 200, response.text);
    const taches = dataOf<TaskData[]>(response);

    const ids = new Set(taches.map((tache) => tache.id));
    assert.ok(ids.has(parLeDev.id), 'la liste n’est pas restreinte au createur courant');
    assert.ok(ids.has(parLeResponsable.id));

    for (const tache of taches) {
      assert.equal(tache.project?.id, projectAId, 'aucune tache d’un autre projet ne doit sortir');
      assert.ok(tache.reporter?.id, `la tache ${tache.id} doit porter le profil de son createur`);
      assert.ok(tache.reporter?.firstName, 'le prenom du createur est rendu');
      assert.ok(tache.reporter?.lastName, 'le nom du createur est rendu');
    }
  });

  it('filtre par createur avec ?reporterId=, sans jamais sortir du projet courant', async () => {
    const parLeDev = dataOf<TaskData>(
      await as(devToken)
        .post(`/projects/${projectAId}/tasks`)
        .send({ title: 'Tache signee par le dev' }),
    );
    const parLeResponsable = dataOf<TaskData>(
      await as(pmToken)
        .post(`/projects/${projectAId}/tasks`)
        .send({ title: 'Tache signee par le responsable' }),
    );
    // Le responsable a AUSSI des taches dans le projet B : elles ne doivent pas
    // remonter quand on interroge le projet A avec son identifiant.
    const dansLeProjetB = dataOf<TaskData>(
      await as(pmToken)
        .post(`/projects/${projectBId}/tasks`)
        .send({ title: 'Tache du responsable ailleurs' }),
    );

    const response = await as(pmToken).get(
      `/projects/${projectAId}/tasks?perPage=100&reporterId=${devUserId}`,
    );
    assert.equal(response.status, 200, response.text);
    const taches = dataOf<TaskData[]>(response);

    assert.ok(
      taches.some((tache) => tache.id === parLeDev.id),
      'la tache du createur demande doit sortir',
    );
    assert.equal(
      taches.some((tache) => tache.id === parLeResponsable.id),
      false,
      'les taches d’un autre createur sont exclues',
    );

    for (const tache of taches) {
      assert.equal(tache.reporterId, devUserId, 'seules les taches de ce createur');
      assert.equal(tache.projectId, projectAId, 'et seulement dans le projet interroge');
    }

    // ET LE FILTRE NE FAIT PAS SORTIR DU PROJET : les taches du meme createur
    // rangees dans le projet B restent invisibles ici.
    const parLeResponsableDansA = await as(pmToken).get(
      `/projects/${projectAId}/tasks?perPage=100&reporterId=${pmUserId}`,
    );
    const tachesDeA = dataOf<TaskData[]>(parLeResponsableDansA);
    assert.equal(
      tachesDeA.some((tache) => tache.id === dansLeProjetB.id),
      false,
      'le filtre ne peut pas elargir la liste a un autre projet',
    );
    for (const tache of tachesDeA) {
      assert.equal(tache.projectId, projectAId);
    }
  });

  it('rend une liste vide quand le profil filtre n’a cree aucune tache dans le projet', async () => {
    // `otherDev` est ASSIGNE a une tache de ce projet, mais n’en a cree aucune :
    // le filtre porte sur le CREATEUR (identifiant unique du compte), pas sur
    // l'assigne, et la reponse est vide sans etre une erreur.
    const assignee = dataOf<TaskData>(
      await as(pmToken)
        .post(`/projects/${projectAId}/tasks`)
        .send({ title: 'Tache confiee a un collegue', assigneeId: otherDevUserId }),
    );
    assert.equal(assignee.reporterId, pmUserId, 'c’est le responsable qui a cree la tache');

    const response = await as(pmToken).get(
      `/projects/${projectAId}/tasks?perPage=100&reporterId=${otherDevUserId}`,
    );
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(dataOf<TaskData[]>(response), []);
  });

  it('propose les profils qui ont cree des taches, et jamais un profil sans tache', async () => {
    const response = await as(pmToken).get(`/projects/${projectAId}/tasks/creators`);
    assert.equal(response.status, 200, response.text);
    const profils = dataOf<TaskCreatorData[]>(response);

    assert.ok(
      profils.some((profil) => profil.id === devUserId),
      'le dev a cree une tache dans ce projet',
    );
    assert.ok(profils.some((profil) => profil.id === pmUserId));

    for (const profil of profils) {
      assert.ok(profil.taskCount > 0, `le profil ${profil.id} est propose sans aucune tache`);
      assert.equal(typeof profil.firstName, 'string', 'le prenom est rendu');
      assert.equal(typeof profil.lastName, 'string', 'le nom est rendu');
      assert.equal('passwordHash' in profil, false, 'aucune colonne de compte ne sort par ici');
    }
  });

  it('limite les profils proposes au perimetre de lecture du porteur', async () => {
    // Le dev ne lit que les taches qui lui sont assignees : le filtre ne doit donc
    // pas lui apprendre, par la liste des profils, qui travaille sur le projet.
    const visibles = dataOf<TaskData[]>(
      await as(devToken).get(`/projects/${projectAId}/tasks?perPage=100`),
    );
    const createursVisibles = new Set(visibles.map((tache) => tache.reporterId));

    const profils = dataOf<TaskCreatorData[]>(
      await as(devToken).get(`/projects/${projectAId}/tasks/creators`),
    );

    for (const profil of profils) {
      assert.ok(
        createursVisibles.has(profil.id),
        `le profil ${profil.id} n’a aucune tache visible par ce porteur`,
      );
    }
  });

  it('rend une liste vide, sans erreur, sur un projet qui n’a aucune tache', async () => {
    const projet = dataOf<ProjectData>(
      await as(pmToken)
        .post('/projects')
        .send({ name: 'Projet sans tache', clientId: clientAId, managerId: pmUserId }),
    );
    createdProjectIds.push(projet.id);

    const taches = await as(pmToken).get(`/projects/${projet.id}/tasks`);
    assert.equal(taches.status, 200, taches.text);
    assert.deepEqual(dataOf<TaskData[]>(taches), []);

    const profils = await as(pmToken).get(`/projects/${projet.id}/tasks/creators`);
    assert.equal(profils.status, 200, profils.text);
    assert.deepEqual(dataOf<TaskCreatorData[]>(profils), []);
  });

  // ---------------------------------------------------------------------------
  // Invariant des sous-taches
  // ---------------------------------------------------------------------------

  it('refuse de fermer un parent dont des sous-taches sont encore ouvertes, puis l’autorise', async () => {
    const parent = dataOf<TaskData>(
      await as(pmToken).post(`/projects/${projectAId}/tasks`).send({ title: 'Lot principal' }),
    );
    const enfant = dataOf<TaskData>(
      await as(pmToken)
        .post(`/projects/${projectAId}/tasks`)
        .send({ title: 'Sous-lot', parentTaskId: parent.id, assigneeId: devUserId }),
    );

    assert.equal(enfant.parentTaskId, parent.id);

    // 1. Fermer le parent est REFUSE. `DONE` sur un parent est une affirmation
    //    (« le travail est fini ») ; si un enfant reste ouvert, elle est fausse,
    //    et cette faussete gonfle l'avancement affiche au client.
    const refuse = await as(pmToken).patch(`/tasks/${parent.id}/status`).send({ status: 'DONE' });
    assert.equal(refuse.status, 422, refuse.text);
    assert.equal(errorOf(refuse).code, 'TASK_HAS_OPEN_SUBTASKS');

    // 2. On ferme l'enfant...
    const enfantFerme = await as(devToken)
      .patch(`/tasks/${enfant.id}/status`)
      .send({ status: 'DONE' });
    assert.equal(enfantFerme.status, 200, enfantFerme.text);
    assert.equal(dataOf<TaskData>(enfantFerme).status, 'DONE');

    // 3. ...et le parent se ferme alors normalement.
    const accepte = await as(pmToken).patch(`/tasks/${parent.id}/status`).send({ status: 'DONE' });
    assert.equal(accepte.status, 200, accepte.text);
    assert.equal(dataOf<TaskData>(accepte).status, 'DONE');
  });

  it('refuse d’accrocher une sous-tache a un parent deja clos', async () => {
    // Le SECOND VOLET de l'invariant. Sans lui, un parent `DONE` redeviendrait un
    // parent a enfants ouverts une seconde apres avoir ete clos.
    const parent = dataOf<TaskData>(
      await as(pmToken).post(`/projects/${projectAId}/tasks`).send({ title: 'Lot clos' }),
    );
    await as(pmToken).patch(`/tasks/${parent.id}/status`).send({ status: 'DONE' });

    const response = await as(pmToken)
      .post(`/projects/${projectAId}/tasks`)
      .send({ title: 'Enfant trop tard', parentTaskId: parent.id });

    assert.equal(response.status, 422, response.text);
    assert.equal(errorOf(response).code, 'TASK_PARENT_CLOSED');
  });

  it('refuse une sous-tache dont le parent appartient a un autre projet', async () => {
    const parent = dataOf<TaskData>(
      await as(pmToken).post(`/projects/${projectBId}/tasks`).send({ title: 'Tache du projet B' }),
    );

    const response = await as(pmToken)
      .post(`/projects/${projectAId}/tasks`)
      .send({ title: 'Rattachement interdit', parentTaskId: parent.id });

    assert.equal(response.status, 422, response.text);
    assert.equal(errorOf(response).code, 'TASK_PARENT_NOT_FOUND');
  });

  // ---------------------------------------------------------------------------
  // Temps saisi
  // ---------------------------------------------------------------------------

  it('accepte une saisie de temps sur SA tache et la range dans le projet de la tache', async () => {
    const task = await tacheAssigneeAuDev('Tache pour le temps');

    const response = await as(devToken)
      .post(`/tasks/${task.id}/time-entries`)
      .send({ minutes: 90, description: 'Integration de la maquette' });

    assert.equal(response.status, 201, response.text);
    const entry = dataOf<TimeEntryData>(response);

    // LE PROJET VIENT DE LA TACHE. Il n'est pas dans le corps de la requete, donc
    // il ne peut pas etre falsifie.
    assert.equal(entry.projectId, projectAId);
    assert.equal(entry.taskId, task.id);
    assert.equal(entry.userId, devUserId);
    assert.equal(entry.minutes, 90);

    // Le jour est ramene a minuit UTC : la colonne stocke une JOURNEE, pas un
    // instant, sinon deux saisies du meme jour ne se regrouperaient jamais.
    assert.match(entry.spentOn, /T00:00:00\.000Z$/);
  });

  it('refuse au developpeur de saisir du temps sur la tache d’un collegue', async () => {
    const creee = await as(pmToken)
      .post(`/projects/${projectAId}/tasks`)
      .send({ title: 'Travail d’un autre', assigneeId: otherDevUserId });

    assert.equal(creee.status, 201, creee.text);
    const task = dataOf<TaskData>(creee);

    const response = await as(devToken)
      .post(`/tasks/${task.id}/time-entries`)
      .send({ minutes: 60 });

    assert.equal(response.status, 404, response.text);
    assert.equal(errorOf(response).code, 'TASK_NOT_FOUND');
  });

  it('refuse une journee de travail dans le futur', async () => {
    const task = await tacheAssigneeAuDev('Tache pour le futur');

    const response = await as(devToken)
      .post(`/tasks/${task.id}/time-entries`)
      .send({ minutes: 60, spentOn: '2099-01-01T00:00:00.000Z' });

    assert.equal(response.status, 422, response.text);
    assert.equal(errorOf(response).code, 'TIME_ENTRY_FUTURE_DAY');
  });

  it('refuse une duree superieure a une journee', async () => {
    const task = await tacheAssigneeAuDev('Tache pour la duree');

    const response = await as(devToken)
      .post(`/tasks/${task.id}/time-entries`)
      .send({ minutes: 2000 });

    assert.equal(response.status, 400, response.text);
    assert.equal(errorOf(response).code, 'VALIDATION_FAILED');
  });

  it('refuse a un developpeur de saisir du temps pour un collegue', async () => {
    // `time:write:own` ne permet pas de designer quelqu'un d'autre. Le service
    // REFUSE, il n'ignore pas le champ en silence : une saisie rangee sous le nom
    // du porteur alors qu'il visait un collegue serait un mensonge silencieux.
    const task = await tacheAssigneeAuDev('Tache pour autrui');

    const response = await as(devToken)
      .post(`/tasks/${task.id}/time-entries`)
      .send({ minutes: 60, userId: otherDevUserId });

    assert.equal(response.status, 403, response.text);
  });

  it('ne rend a un developpeur que SES saisies dans la feuille de temps', async () => {
    const response = await as(devToken).get('/time-entries');
    assert.equal(response.status, 200, response.text);

    const items = dataOf<TimeEntryData[]>(response);
    assert.ok(items.length > 0, 'le developpeur doit voir ses propres saisies');
    for (const entry of items) {
      assert.equal(entry.userId, devUserId, 'time:read:own ne doit rendre que ses lignes');
    }

    // Et `?userId=` ne doit pas elargir ce perimetre : filtre et perimetre sont
    // combines en `AND`, jamais etales dans le meme objet.
    const elargi = await as(devToken).get(`/time-entries?userId=${otherDevUserId}`);
    assert.equal(elargi.status, 200, elargi.text);
    assert.deepEqual(dataOf<TimeEntryData[]>(elargi), []);
  });

  // ---------------------------------------------------------------------------
  // Jalons
  // ---------------------------------------------------------------------------

  it('cree un jalon, le declare atteint, puis refuse de le supprimer', async () => {
    const created = await as(pmToken)
      .post(`/projects/${projectAId}/milestones`)
      .send({ title: 'Livraison de la maquette', dueDate: '2026-10-15T00:00:00.000Z' });

    assert.equal(created.status, 201, created.text);
    const milestone = dataOf<MilestoneData>(created);
    assert.equal(milestone.status, 'PENDING');
    assert.equal(milestone.reachedAt, null);

    const reached = await as(pmToken)
      .patch(`/milestones/${milestone.id}`)
      .send({ status: 'REACHED' });

    assert.equal(reached.status, 200, reached.text);
    const after = dataOf<MilestoneData>(reached);
    assert.equal(after.status, 'REACHED');
    // `reachedAt` est la raison d'etre du statut : c'est un FAIT date.
    assert.ok(after.reachedAt, 'atteindre un jalon doit le dater');

    // Un jalon atteint est un fait annonce au client : on ne l'efface pas.
    const refused = await as(pmToken).delete(`/milestones/${milestone.id}`);
    assert.equal(refused.status, 422, refused.text);
    assert.equal(errorOf(refused).code, 'MILESTONE_REACHED_NOT_DELETABLE');
  });

  it('laisse un compte client lire la frise de son projet, mais pas la modifier', async () => {
    // `milestone:read:any` est detenu par le role CLIENT : la frise est faite
    // pour lui. C'est le PERIMETRE DU PROJET qui decide quels jalons existent.
    const read = await as(clientAToken).get(`/projects/${projectAId}/milestones`);
    assert.equal(read.status, 200, read.text);
    assert.ok(dataOf<MilestoneData[]>(read).length > 0);

    const write = await as(clientAToken)
      .post(`/projects/${projectAId}/milestones`)
      .send({ title: 'Jalon du client' });
    assert.equal(write.status, 403, write.text);
  });

  it('ne rend AUCUN jalon d’un projet hors perimetre, et jamais par une 403', async () => {
    // La frise d'un projet etranger n'est pas « interdite », elle est VIDE : le
    // perimetre du projet est compose dans le `where`, donc la ligne n'existe pas
    // pour ce porteur. Une liste vide ne confirme pas l'existence du projet.
    const response = await as(clientAToken).get(`/projects/${projectBId}/milestones`);

    assert.equal(response.status, 200, response.text);
    assert.deepEqual(dataOf<MilestoneData[]>(response), []);
  });

  // ---------------------------------------------------------------------------
  // Statut de projet et permission dediee
  // ---------------------------------------------------------------------------

  it('n’accepte pas le statut par le PATCH general : il a sa propre permission', async () => {
    // `status` est volontairement absent de `UpdateProjectDto` pour que
    // `project:manage:status` ne puisse pas etre contourne par un
    // `project:write:any`.
    const response = await as(pmToken)
      .patch(`/projects/${projectAId}`)
      .send({ status: 'COMPLETED' });

    assert.equal(response.status, 400, response.text);
    assert.equal(errorOf(response).code, 'VALIDATION_FAILED');
  });

  it('refuse une transition de statut qui n’existe pas', async () => {
    const response = await as(pmToken)
      .patch(`/projects/${projectAId}/status`)
      .send({ status: 'COMPLETED' });

    // DRAFT -> COMPLETED est un raccourci qui ferait disparaitre tout le suivi.
    assert.equal(response.status, 422, response.text);
    assert.equal(errorOf(response).code, 'PROJECT_STATUS_TRANSITION_REFUSED');
  });
});
