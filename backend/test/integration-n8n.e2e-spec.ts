// DOIT rester la premiere ligne : les decorateurs de Nest sont evalues au
// chargement des modules, et ils ont besoin de `Reflect.metadata` deja installe.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { passwordPolicyViolation, hashPassword } from '../src/common/security/password.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * L'API VUE PAR n8n — TEST DE BOUT EN BOUT, SUR LA VRAIE BASE.
 *
 * -----------------------------------------------------------------------------
 * LES DOUZE VERIFICATIONS, ET CE QU'ELLES ATTRAPENT
 * -----------------------------------------------------------------------------
 *   1. sans jeton                     -> 401, aucune route n'est ouverte par oubli
 *   2. jeton invalide                 -> 401, et pas une erreur de parsing
 *   3. jeton valide                   -> 200 sur `/api/v1` (l'alias des machines)
 *   4. action hors permission         -> 403, le jeton ne deborde pas
 *   5. ressource d'un autre membre    -> 404, et non 403 : un 403 la confirmerait
 *   6. creation de tache valide       -> 201
 *   7. mise a jour de tache           -> 200
 *   8. parametres invalides           -> 400, enveloppe d'erreur contractuelle
 *   9. pagination et filtres          -> plafond refuse, `meta` renseigne
 *  10. limitation de debit            -> 429 au-dela du plafond de la route
 *  11. revocation                     -> 401 des la requete suivante
 *  12. coherence OpenAPI              -> les routes existent, sans secret dedans
 *  13. rejeu d'une creation            -> meme reponse, et une seule tache
 *  14. cle rejouee avec un autre corps -> 422, jamais une reponse qui ment
 *
 * -----------------------------------------------------------------------------
 * POURQUOI CE FICHIER NE SIMULE RIEN
 * -----------------------------------------------------------------------------
 * Toute la surete de ce dossier tient a une ligne SQL : le perimetre (`any`,
 * `assigned`, `own`) est applique dans le `where`, pas apres coup dans le code.
 * Un service simule renverrait la ligne et laisserait croire que la protection
 * marche ; seule la base dit si le filtre tient. D'ou `AppModule` complet,
 * `configureApp` reel, et une vraie base PostgreSQL.
 *
 * PREALABLE : `prisma migrate deploy` doit avoir ete joue (la table
 * `integration_tokens` et les deux permissions d'integration viennent de la
 * migration). Sans elles, la creation de jeton echoue en 403 et le fichier
 * entier tombe — c'est le comportement attendu, pas une regression.
 *
 * IL CREE SES PROPRES DONNEES (`e2e-n8n-…`) ET LES SUPPRIME A LA FIN.
 */

const PASSWORD = 'Boussole-Tempete-41-Nuage';

const EMAIL_ADMIN = 'e2e-n8n-admin@comexa.example';
const EMAIL_MEMBRE = 'e2e-n8n-membre@comexa.example';

const REF_CLIENT = 'E2E-N8N-CLI';
const REF_PROJET = 'E2E-N8N-PRJ';

/** Les trois jetons du scenario : lecture seule, ecriture, portee etroite. */
const JETON_LECTURE = 'n8n-e2e-lecture';
const JETON_ECRITURE = 'n8n-e2e-ecriture';
const JETON_ETROIT = 'n8n-e2e-etroit';

interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: { page: number; perPage: number; total: number; totalPages: number };
}

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details: unknown };
}

/** Le corps d'erreur, tel que le filtre global le produit. */
function errorOf(response: request.Response): ErrorBody['error'] {
  return (response.body as ErrorBody).error;
}

let app: INestApplication;
let prisma: PrismaService;
let baseUrl = '';

let adminToken = '';
let jetonLecture = '';
let jetonEcriture = '';
let jetonEtroit = '';
let idJetonLecture = '';

let projectId = '';
let taskId = '';
let tacheDunAutre = '';
let membreId = '';
let adminId = '';

/** Creation d'un jeton par la route d'administration, avec l'adresse de l'admin. */
async function creerJeton(nom: string, scopes: string[]): Promise<{ id: string; secret: string }> {
  const response = await request(app.getHttpServer())
    .post(`${baseUrl}/integrations/tokens`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: nom, scopes, expiresInDays: 1 });

  assert.equal(
    response.status,
    201,
    `creation du jeton ${nom} attendue en 201, reponse ${response.status} : ${JSON.stringify(response.body)}`,
  );

  const body = response.body as SuccessBody<{ id: string; secret: string }>;
  assert.ok(body.data.secret?.startsWith('cxi_'), 'le secret doit etre rendu une fois, en clair');
  return { id: body.data.id, secret: body.data.secret };
}

before(async () => {
  const violation = passwordPolicyViolation(PASSWORD);
  assert.equal(violation, null, `mot de passe de test refuse par la politique : ${violation}`);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useLogger(false);
  const setup = configureApp(app);
  await app.init();

  prisma = app.get(PrismaService);
  baseUrl = `/${setup.apiPrefix}`;

  // --- Nettoyage preventif : un run interrompu a pu laisser ses donnees -------
  await prisma.integrationToken.deleteMany({
    where: { name: { in: [JETON_LECTURE, JETON_ECRITURE, JETON_ETROIT] } },
  });
  const projets: { id: string }[] = await prisma.project.findMany({
    where: { reference: REF_PROJET },
    select: { id: true },
  });
  await prisma.task.deleteMany({ where: { projectId: { in: projets.map((p) => p.id) } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: projets.map((p) => p.id) } } });
  await prisma.project.deleteMany({ where: { reference: REF_PROJET } });
  await prisma.client.deleteMany({ where: { reference: REF_CLIENT } });
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN, EMAIL_MEMBRE] } } });

  // --- Les deux humains -------------------------------------------------------
  const [roleAdmin, roleDev] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' }, select: { id: true } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'DEVELOPER' }, select: { id: true } }),
  ]);
  const passwordHash = await hashPassword(PASSWORD);

  const admin = await prisma.user.create({
    data: {
      email: EMAIL_ADMIN,
      passwordHash,
      firstName: 'N8n',
      lastName: 'Administrateur',
      status: 'ACTIVE',
      isEmailVerified: true,
      mustChangePassword: false,
      roles: { create: { roleId: roleAdmin.id } },
    },
    select: { id: true },
  });

  const membre = await prisma.user.create({
    data: {
      email: EMAIL_MEMBRE,
      passwordHash,
      firstName: 'N8n',
      lastName: 'Membre',
      status: 'ACTIVE',
      isEmailVerified: true,
      mustChangePassword: false,
      roles: { create: { roleId: roleDev.id } },
    },
    select: { id: true },
  });

  adminId = admin.id;
  membreId = membre.id;

  // --- Client, projet, et deux taches dont une n'appartient pas au porteur ----
  const client = await prisma.client.create({
    data: { reference: REF_CLIENT, companyName: 'Cliente e2e n8n', status: 'ACTIVE' },
    select: { id: true },
  });

  const projet = await prisma.project.create({
    data: {
      reference: REF_PROJET,
      name: 'Projet e2e n8n',
      clientId: client.id,
      status: 'ACTIVE',
      managerId: admin.id,
      createdById: admin.id,
    },
    select: { id: true },
  });
  projectId = projet.id;

  const tache = await prisma.task.create({
    data: {
      projectId: projet.id,
      title: 'Tache de l’equipe',
      status: 'TODO',
      priority: 'NORMAL',
      assigneeId: admin.id,
      reporterId: admin.id,
    },
    select: { id: true },
  });
  taskId = tache.id;

  // Celle-ci n'est ni assignee ni rapportee par le porteur du jeton etroit :
  // un `task:read:own` ne doit jamais la charger.
  const autre = await prisma.task.create({
    data: {
      projectId: projet.id,
      title: 'Tache d’un autre',
      status: 'DONE',
      priority: 'HIGH',
      assigneeId: membre.id,
      reporterId: membre.id,
    },
    select: { id: true },
  });
  tacheDunAutre = autre.id;

  // --- Le jeton de l'administrateur, par la porte d'entree habituelle --------
  const login = await request(app.getHttpServer())
    .post(`${baseUrl}/auth/login`)
    .send({ email: EMAIL_ADMIN, password: PASSWORD });

  assert.equal(login.status, 200, `connexion admin impossible : ${JSON.stringify(login.body)}`);
  adminToken = (login.body as SuccessBody<{ accessToken: string }>).data.accessToken;

  // --- Les trois jetons d'integration ---------------------------------------
  const lecture = await creerJeton(JETON_LECTURE, ['task:read:any', 'project:read:any']);
  jetonLecture = lecture.secret;
  idJetonLecture = lecture.id;

  jetonEcriture = (
    await creerJeton(JETON_ECRITURE, ['project:read:any', 'task:read:any', 'task:write:any'])
  ).secret;

  jetonEtroit = (await creerJeton(JETON_ETROIT, ['task:read:own'])).secret;
});

after(async () => {
  if (!app) return;

  const ids = [adminId, membreId].filter(Boolean);

  await prisma.integrationToken.deleteMany({
    where: { name: { in: [JETON_LECTURE, JETON_ECRITURE, JETON_ETROIT] } },
  });
  // Les comptes techniques crees avec les jetons portent une adresse en
  // `.invalid` : les retrouver par leur rattachement plutot que par courriel.
  await prisma.user.deleteMany({
    where: { OR: [{ email: { endsWith: '@integrations.invalid' } }, { id: { in: ids } }] },
  });
  await prisma.task.deleteMany({ where: { projectId } });
  await prisma.projectMember.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { reference: REF_PROJET } });
  await prisma.client.deleteMany({ where: { reference: REF_CLIENT } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] },
  });

  await app.close();
});

describe('API n8n — les douze verifications', () => {
  let creeeParN8n = '';

  it('1. sans jeton, l’API refuse (401)', async () => {
    const response = await request(app.getHttpServer()).get(
      `${baseUrl}/v1/projects/${projectId}/tasks`,
    );

    assert.equal(response.status, 401);
    assert.equal(errorOf(response).code, 'UNAUTHENTICATED');
  });

  it('2. un jeton invalide est refuse (401), sans erreur de parsing', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/v1/projects/${projectId}/tasks`)
      .set('Authorization', 'Bearer cxi_ceci-nest-pas-un-jeton');

    assert.equal(response.status, 401);
    assert.equal(errorOf(response).code, 'INTEGRATION_TOKEN_INVALID');
  });

  it('3. un jeton valide ouvre `/api/v1`, alias de `/api`', async () => {
    const enV1 = await request(app.getHttpServer())
      .get(`${baseUrl}/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${jetonLecture}`);

    assert.equal(enV1.status, 200);
    const corps = enV1.body as SuccessBody<{ id: string }[]>;
    assert.equal(corps.success, true);
    assert.ok(Array.isArray(corps.data));
    assert.ok(
      corps.data.some((tache) => tache.id === taskId),
      'la tache du scenario doit apparaitre dans la liste',
    );
    assert.equal(corps.meta?.perPage, 20, 'la pagination par defaut doit etre annoncee');

    // Le meme controleur, sans le prefixe de version : les deux chemins doivent
    // rendre exactement la meme chose, sinon l’alias ment.
    const sansV1 = await request(app.getHttpServer())
      .get(`${baseUrl}/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${jetonLecture}`);

    assert.equal(sansV1.status, 200);
    assert.deepEqual(sansV1.body, enV1.body);
  });

  it('4. une action hors des droits du jeton est refusee (403)', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${jetonLecture}`)
      .send({ title: 'Tache ecrite par un jeton de lecture' });

    assert.equal(response.status, 403);
    assert.match(errorOf(response).message, /Droit insuffisant/);
  });

  it('5. la ressource d’un autre membre est introuvable (404), pas interdite', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/v1/tasks/${tacheDunAutre}`)
      .set('Authorization', `Bearer ${jetonEtroit}`);

    // 404 et non 403 : un 403 confirmerait que la tache existe. C'est la regle
    // de tout le depot, et elle vaut aussi pour les machines.
    assert.equal(response.status, 404);
    assert.equal(errorOf(response).code, 'TASK_NOT_FOUND');
  });

  it('6. une creation de tache valide rend 201', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${jetonEcriture}`)
      .send({ title: 'Tache creee par n8n', priority: 'HIGH' });

    assert.equal(response.status, 201);
    const corps = response.body as SuccessBody<{ id: string; title: string }>;
    assert.equal(corps.data.title, 'Tache creee par n8n');
    creeeParN8n = corps.data.id;
  });

  it('7. une mise a jour de tache rend 200', async () => {
    const response = await request(app.getHttpServer())
      .patch(`${baseUrl}/v1/tasks/${creeeParN8n}`)
      .set('Authorization', `Bearer ${jetonEcriture}`)
      .send({ title: 'Tache renommee par n8n' });

    assert.equal(response.status, 200);
    assert.equal(
      (response.body as SuccessBody<{ title: string }>).data.title,
      'Tache renommee par n8n',
    );
  });

  it('8. des parametres invalides ou manquants rendent 400', async () => {
    const sansTitre = await request(app.getHttpServer())
      .post(`${baseUrl}/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${jetonEcriture}`)
      .send({ priority: 'HIGH' });

    assert.equal(sansTitre.status, 400);
    assert.equal(errorOf(sansTitre).code, 'VALIDATION_FAILED');

    // Un champ invente est refuse, pas ignore : c'est la protection contre
    // l'escalade de privilege la plus ordinaire (glisser `roleId` dans un corps).
    const champEnTrop = await request(app.getHttpServer())
      .post(`${baseUrl}/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${jetonEcriture}`)
      .send({ title: 'Tache avec un champ en trop', reporterId: adminId });

    assert.equal(champEnTrop.status, 400);
    assert.equal(errorOf(champEnTrop).code, 'VALIDATION_FAILED');
  });

  it('9. la pagination est plafonnee, et les filtres sont appliques', async () => {
    const tropGrand = await request(app.getHttpServer())
      .get(`${baseUrl}/v1/projects/${projectId}/tasks?perPage=101`)
      .set('Authorization', `Bearer ${jetonLecture}`);

    // Le plafond n'est pas negocie : `perPage=100000` transformerait une liste
    // en export complet de la base.
    assert.equal(tropGrand.status, 400);

    const page = await request(app.getHttpServer())
      .get(`${baseUrl}/v1/projects/${projectId}/tasks?page=1&perPage=1`)
      .set('Authorization', `Bearer ${jetonLecture}`);

    assert.equal(page.status, 200);
    const corps = page.body as SuccessBody<unknown[]>;
    assert.equal(corps.data.length, 1);
    assert.equal(corps.meta?.perPage, 1);
    assert.equal(corps.meta?.page, 1);
    assert.ok(
      (corps.meta?.total ?? 0) >= 3,
      'le projet contient au moins les trois taches du scenario',
    );

    const filtree = await request(app.getHttpServer())
      .get(`${baseUrl}/v1/projects/${projectId}/tasks?status=DONE`)
      .set('Authorization', `Bearer ${jetonLecture}`);

    assert.equal(filtree.status, 200);
    const corpsFiltre = filtree.body as SuccessBody<{ status: string }[]>;
    assert.ok(corpsFiltre.data.length >= 1);
    for (const tache of corpsFiltre.data) {
      assert.equal(tache.status, 'DONE');
    }
  });

  it('10. le limiteur de debit repond 429 au-dela du plafond de la route', async () => {
    // `POST /auth/login` est plafonne a 10 appels par minute (voir le
    // `@Throttle` du controleur) : c'est la route que l'on peut saturer sans
    // polluer le jeu de donnees.
    let dernierStatut = 0;

    for (let essai = 0; essai < 12; essai += 1) {
      const response = await request(app.getHttpServer())
        .post(`${baseUrl}/auth/login`)
        .send({ email: EMAIL_ADMIN, password: PASSWORD });
      dernierStatut = response.status;
      if (dernierStatut === 429) break;
    }

    assert.equal(dernierStatut, 429, 'la douzieme tentative doit etre limitee');
  });

  it('11. un jeton revoque est refuse des la requete suivante (401)', async () => {
    const avant = await request(app.getHttpServer())
      .get(`${baseUrl}/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${jetonLecture}`);
    assert.equal(avant.status, 200);

    const revoque = await request(app.getHttpServer())
      .post(`${baseUrl}/integrations/tokens/${idJetonLecture}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(revoque.status, 200);

    const apres = await request(app.getHttpServer())
      .get(`${baseUrl}/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${jetonLecture}`);

    // Pas de cache : la revocation est immediate, sinon « revoquer » voudrait
    // dire « revoquer dans une minute », ce qui ne sert a rien face a une fuite.
    assert.equal(apres.status, 401);
    assert.equal(errorOf(apres).code, 'INTEGRATION_TOKEN_REVOKED');
  });

  it('13. rejouer une creation rend la MEME reponse, sans creer deux fois', async () => {
    const cle = 'e2e-n8n-creation-0001';

    const premier = await request(app.getHttpServer())
      .post(`${baseUrl}/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${jetonEcriture}`)
      .set('Idempotency-Key', cle)
      .send({ title: 'Tache idempotente' });

    assert.equal(premier.status, 201);
    assert.equal(premier.headers['idempotency-replayed'], undefined);

    // Le SECOND appel est celui qui compte : c'est le rejeu d'un noeud HTTP
    // apres un timeout, et il ne doit produire qu'une reponse deja rendue.
    const rejeu = await request(app.getHttpServer())
      .post(`${baseUrl}/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${jetonEcriture}`)
      .set('Idempotency-Key', cle)
      .send({ title: 'Tache idempotente' });

    assert.equal(rejeu.status, 201);
    assert.equal(rejeu.headers['idempotency-replayed'], 'true');
    assert.deepEqual(
      rejeu.body,
      premier.body,
      'la reponse doit etre identique, pas une copie approchante',
    );

    const combien = await prisma.task.count({
      where: { projectId, title: 'Tache idempotente', deletedAt: null },
    });
    assert.equal(combien, 1, 'une seule tache doit exister pour deux appels');
  });

  it('14. une cle rejouee avec un autre corps est refusee (422)', async () => {
    const cle = 'e2e-n8n-creation-0002';

    const premier = await request(app.getHttpServer())
      .post(`${baseUrl}/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${jetonEcriture}`)
      .set('Idempotency-Key', cle)
      .send({ title: 'Premier usage de la cle' });
    assert.equal(premier.status, 201);

    const detournee = await request(app.getHttpServer())
      .post(`${baseUrl}/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${jetonEcriture}`)
      .set('Idempotency-Key', cle)
      .send({ title: 'Deuxieme usage, autre titre' });

    // Rendre la premiere reponse au second appel serait mentir : le client
    // croirait avoir cree « Deuxieme usage » et n'aurait rien cree du tout.
    assert.equal(detournee.status, 422);
    assert.equal(errorOf(detournee).code, 'IDEMPOTENCY_KEY_REUSED');
  });

  it('15. une cle mal formee est refusee (400), sans rien creer', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${jetonEcriture}`)
      .set('Idempotency-Key', 'trop court')
      .send({ title: 'Avec une cle invalide' });

    assert.equal(response.status, 400);
    assert.equal(errorOf(response).code, 'IDEMPOTENCY_KEY_INVALID');

    const combien = await prisma.task.count({
      where: { projectId, title: 'Avec une cle invalide', deletedAt: null },
    });
    assert.equal(combien, 0);
  });

  it('12. le contrat OpenAPI decrit exactement les routes d’integration, sans secret', async () => {
    const chemin = resolve(process.cwd(), '../shared/api/openapi.json');
    const document = JSON.parse(readFileSync(chemin, 'utf8')) as {
      paths: Record<string, Record<string, { summary?: string }>>;
    };

    const attendues: readonly (readonly [string, string])[] = [
      ['/api/integrations/tokens', 'post'],
      ['/api/integrations/tokens', 'get'],
      ['/api/integrations/tokens/{id}/renew', 'post'],
      ['/api/integrations/tokens/{id}/revoke', 'post'],
      ['/api/integrations/tokens/{id}', 'delete'],
    ];

    for (const [path, methode] of attendues) {
      const operation = document.paths[path]?.[methode];
      assert.ok(operation, `l'operation ${methode.toUpperCase()} ${path} doit etre documentee`);
      assert.ok(
        operation.summary && operation.summary.length > 0,
        `${methode} ${path} sans resume`,
      );
    }

    // Aucun secret dans la documentation : un jeton ressemble a `cxi_` suivi de
    // quarante caracteres. Un exemple un peu trop realiste finirait copie dans
    // un workflow, et serait alors confondu avec une vraie cle.
    const brut = readFileSync(chemin, 'utf8');
    assert.equal(
      /cxi_[A-Za-z0-9_-]{20,}/.test(brut),
      false,
      'un jeton complet traine dans le contrat',
    );
  });
});
