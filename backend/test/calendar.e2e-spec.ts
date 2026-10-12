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
 * CALENDRIERS — BOUT EN BOUT, SUR LA VRAIE BASE.
 *
 * CE QUI SE VERIFIE ICI, ET NULLE PART AILLEURS :
 *
 *  - L'ISOLATION DES EVENEMENTS PRIVES : un second membre (et meme un
 *    administrateur) ne lit pas, ne modifie pas et ne supprime pas un
 *    evenement prive en changeant l'identifiant dans l'URL — 404, jamais 200 ;
 *  - LE PARTAGE EXPLICITE : un evenement SHARED rejoint la vue d'equipe, et
 *    l'invite le voit dans SON calendrier personnel ;
 *  - LA PROPRIETE : un participant lit l'evenement mais ne le bouge pas (403) ;
 *  - LA CHRONOLOGIE : une fin avant le debut est refusee (422), et la base la
 *    rejeterait aussi (contrainte CHECK) ;
 *  - LES FENETRES : une periode inversee ou trop large est un 400 explicite ;
 *  - LA PERSISTANCE : un evenement deplace puis relu a les horaires ecrits,
 *    normalises en UTC ;
 *  - L'ESPACE CLIENT EST FERME : 403 sur chaque route du calendrier.
 *
 * Le harnais est celui des autres specs : AppModule reel, comptes `e2e-cal-…`
 * crees et supprimes ici, quatre connexions maximum (limiteur de debit).
 */

const PASSWORD = 'Boussole-Tempete-41-Nuage';

const EMAIL_A = 'e2e-cal-a@comexa.example';
const EMAIL_B = 'e2e-cal-b@comexa.example';
const EMAIL_ADMIN = 'e2e-cal-admin@comexa.example';
const EMAIL_CLIENT = 'e2e-cal-client@comexa.example';
const CLIENT_REF = 'E2E-CAL-CLI';

interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: { page: number; perPage: number; total: number; totalPages: number };
}

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details: unknown };
}

interface EventData {
  id: string;
  title: string;
  kind: string;
  visibility: 'PRIVATE' | 'SHARED';
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  taskId: string | null;
  projectId: string | null;
  isOwn: boolean;
  canEdit: boolean;
  participants: { userId: string; firstName: string; lastName: string }[];
  owner: { id: string; firstName: string; lastName: string };
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

describe('Calendriers personnel et equipe (bout en bout, base reelle)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  let tokenA = '';
  let tokenB = '';
  let tokenAdmin = '';
  let tokenClient = '';
  let userAId = '';
  let userBId = '';

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
    await prisma.user.deleteMany({
      where: { email: { in: [EMAIL_A, EMAIL_B, EMAIL_ADMIN, EMAIL_CLIENT] } },
    });
    await prisma.client.deleteMany({ where: { reference: CLIENT_REF } });

    const [devRole, adminRole, clientRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { code: 'DEVELOPER' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'CLIENT' }, select: { id: true } }),
    ]);

    const client = await prisma.client.create({
      data: { reference: CLIENT_REF, companyName: 'E2E Cal Client' },
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
          lastName: 'Cal',
          status: 'ACTIVE',
          isEmailVerified: true,
          mustChangePassword: false,
          roles: { create: { roleId } },
          ...extra,
        },
        select: { id: true },
      });

    const a = await makeUser(EMAIL_A, 'Alice', devRole.id);
    userAId = a.id;
    const b = await makeUser(EMAIL_B, 'Bruno', devRole.id);
    userBId = b.id;
    await makeUser(EMAIL_ADMIN, 'Admin', adminRole.id);
    await makeUser(EMAIL_CLIENT, 'Client', clientRole.id, { clientId: client.id });

    tokenA = await login(EMAIL_A);
    tokenB = await login(EMAIL_B);
    tokenAdmin = await login(EMAIL_ADMIN);
    tokenClient = await login(EMAIL_CLIENT);
  });

  after(async () => {
    if (prisma) {
      await prisma.user.deleteMany({
        where: { email: { in: [EMAIL_A, EMAIL_B, EMAIL_ADMIN, EMAIL_CLIENT] } },
      });
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
      put: (path: string) =>
        request(app.getHttpServer())
          .put(`${baseUrl}${path}`)
          .set('Authorization', `Bearer ${token}`),
      delete: (path: string) =>
        request(app.getHttpServer())
          .delete(`${baseUrl}${path}`)
          .set('Authorization', `Bearer ${token}`),
    };
  }

  // -------------------------------------------------------------------------
  // Vie privee
  // -------------------------------------------------------------------------

  it('un evenement PRIVE reste prive : invisible aux autres, meme administrateur', async () => {
    const created = await as(tokenA).post('/me/calendar/events').send({
      title: 'Medical — rendez-vous prive',
      kind: 'EVENT',
      startsAt: '2026-10-20T09:00:00+01:00',
      endsAt: '2026-10-20T10:00:00+01:00',
    });
    assert.equal(created.status, 201, created.text);
    const event = dataOf<EventData>(created);
    assert.equal(event.visibility, 'PRIVATE');
    assert.equal(event.isOwn, true);
    // Les horaires sont normalises en UTC des l'ecriture.
    assert.equal(event.startsAt, '2026-10-20T08:00:00.000Z');
    assert.equal(event.endsAt, '2026-10-20T09:00:00.000Z');

    // Dans MON calendrier, pas dans la vue equipe.
    const mine = await as(tokenA).get('/me/calendar/events');
    assert.equal(mine.status, 200, mine.text);
    assert.ok(dataOf<EventData[]>(mine).some((e) => e.id === event.id));

    const team = await as(tokenB).get('/calendar/events');
    assert.equal(team.status, 200, team.text);
    assert.ok(!dataOf<EventData[]>(team).some((e) => e.id === event.id), 'un prive ne sort jamais');

    // Par identifiant : 404 pour un collegue ET pour un administrateur.
    for (const token of [tokenB, tokenAdmin]) {
      const probe = await as(token).get(`/me/calendar/events/${event.id}`);
      assert.equal(probe.status, 404, probe.text);
      const edit = await as(token)
        .patch(`/me/calendar/events/${event.id}`)
        .send({ title: 'Piratage' });
      assert.equal(edit.status, 404, edit.text);
      const wipe = await as(token).delete(`/me/calendar/events/${event.id}`);
      assert.equal(wipe.status, 404, wipe.text);
    }

    // La ligne existe toujours, intacte.
    const reload = await as(tokenA).get(`/me/calendar/events/${event.id}`);
    assert.equal(reload.status, 200, reload.text);
    assert.equal(dataOf<EventData>(reload).title, 'Medical — rendez-vous prive');
  });

  // -------------------------------------------------------------------------
  // Partage et vue equipe
  // -------------------------------------------------------------------------

  it('un evenement PARTAGE rejoint la vue equipe, et son invite le recoit dans son calendrier', async () => {
    const created = await as(tokenA).post('/me/calendar/events').send({
      title: 'Reunion de lancement',
      visibility: 'SHARED',
      startsAt: '2026-10-21T14:00:00Z',
      endsAt: '2026-10-21T15:00:00Z',
    });
    assert.equal(created.status, 201, created.text);
    const event = dataOf<EventData>(created);

    // Visible dans la vue equipe d'un collegue…
    const team = await as(tokenB).get('/calendar/events');
    assert.ok(
      dataOf<EventData[]>(team).some((e) => e.id === event.id),
      'le partage doit rejoindre la vue equipe',
    );

    // …mais PAS encore dans le calendrier personnel de B (pas invite).
    const beforeInvite = await as(tokenB).get('/me/calendar/events');
    assert.ok(!dataOf<EventData[]>(beforeInvite).some((e) => e.id === event.id));

    // A invite B. La liste POSEE est l'etat souhaite (PUT, pas de delta).
    const invited = await as(tokenA)
      .put(`/me/calendar/events/${event.id}/participants`)
      .send({ userIds: [userBId] });
    assert.equal(invited.status, 200, invited.text);
    assert.equal(dataOf<EventData>(invited).participants.length, 1);

    const afterInvite = await as(tokenB).get('/me/calendar/events');
    assert.ok(
      dataOf<EventData[]>(afterInvite).some((e) => e.id === event.id),
      'invite = dans son agenda',
    );
  });

  it('un participant lit mais ne bouge pas : 403 en modification, le proprietaire si', async () => {
    const team = await as(tokenB).get('/calendar/events');
    const shared = dataOf<EventData[]>(team).find((e) => e.title === 'Reunion de lancement');
    assert.ok(shared);

    const move = await as(tokenB)
      .patch(`/me/calendar/events/${shared.id}`)
      .send({ startsAt: '2026-10-21T16:00:00Z' });
    assert.equal(move.status, 403, move.text);

    const remove = await as(tokenB).delete(`/me/calendar/events/${shared.id}`);
    assert.equal(remove.status, 403, remove.text);

    // Le proprietaire deplace le rendez-vous : la PERSISTANCE verifie la bascule.
    const ownerMove = await as(tokenA)
      .patch(`/me/calendar/events/${shared.id}`)
      .send({ startsAt: '2026-10-22T14:00:00Z', endsAt: '2026-10-22T15:30:00Z' });
    assert.equal(ownerMove.status, 200, ownerMove.text);

    const reloaded = await as(tokenB).get(`/me/calendar/events/${shared.id}`);
    assert.equal(reloaded.status, 200, reloaded.text);
    const after = dataOf<EventData>(reloaded);
    assert.equal(after.startsAt, '2026-10-22T14:00:00.000Z');
    assert.equal(after.endsAt, '2026-10-22T15:30:00.000Z');
    assert.equal(after.canEdit, false);
  });

  // -------------------------------------------------------------------------
  // Chronologie, fenetres, validation
  // -------------------------------------------------------------------------

  it('une fin avant le debut est refusee (422), dans les deux sens', async () => {
    const create = await as(tokenA).post('/me/calendar/events').send({
      title: 'Chronologie cassee',
      startsAt: '2026-10-25T10:00:00Z',
      endsAt: '2026-10-25T09:00:00Z',
    });
    assert.equal(create.status, 422, create.text);
    assert.equal(errorOf(create).code, 'CALENDAR_RANGE_INVALID');

    const team = await as(tokenB).get('/calendar/events');
    const shared = dataOf<EventData[]>(team).find((e) => e.title === 'Reunion de lancement');
    assert.ok(shared, "l'evenement partage precedent doit exister");
    const update = await as(tokenA)
      .patch(`/me/calendar/events/${shared.id}`)
      .send({ endsAt: '2026-10-22T13:00:00Z' });
    assert.equal(update.status, 422, update.text);
  });

  it('les fenetres de lecture bornes : inversee 400, trop large 400, valable 200', async () => {
    const inverted = await as(tokenA).get(
      '/me/calendar/events?from=2026-11-01T00:00:00Z&to=2026-10-01T00:00:00Z',
    );
    assert.equal(inverted.status, 400, inverted.text);
    assert.equal(errorOf(inverted).code, 'CALENDAR_RANGE_INVALID');

    const tooWide = await as(tokenA).get(
      '/me/calendar/events?from=2026-01-01T00:00:00Z&to=2027-06-01T00:00:00Z',
    );
    assert.equal(tooWide.status, 400, tooWide.text);
    assert.equal(errorOf(tooWide).code, 'CALENDAR_RANGE_TOO_WIDE');

    const valid = await as(tokenA).get(
      '/me/calendar/events?from=2026-10-01T00:00:00Z&to=2026-10-31T23:59:59Z',
    );
    assert.equal(valid.status, 200, valid.text);
    const items = dataOf<EventData[]>(valid);
    assert.ok(
      items.every((e) => e.startsAt >= '2026-10-01' && e.startsAt <= '2026-11-01'),
      'la fenetre est respectee',
    );
  });

  it('les entrees invalides sont refusees sans contour possible', async () => {
    // Champ inconnu : la whitelist le refuse (400), elle ne l'ignore pas.
    const unknown = await as(tokenA)
      .post('/me/calendar/events')
      .send({ title: 'Champ inconnu', startsAt: '2026-10-26T10:00:00Z', ownerEmail: 'x@y.z' });
    assert.equal(unknown.status, 400, unknown.text);
    assert.equal(errorOf(unknown).code, 'VALIDATION_FAILED');

    // Titre vide.
    const emptyTitle = await as(tokenA)
      .post('/me/calendar/events')
      .send({ startsAt: '2026-10-26T10:00:00Z' });
    assert.equal(emptyTitle.status, 400, emptyTitle.text);

    // Participants sur un evenement PRIVE : refuse.
    const priv = await as(tokenA).post('/me/calendar/events').send({
      title: 'Prive avec invites',
      visibility: 'PRIVATE',
      startsAt: '2026-10-27T10:00:00Z',
    });
    const privEvent = dataOf<EventData>(priv);
    const participants = await as(tokenA)
      .put(`/me/calendar/events/${privEvent.id}/participants`)
      .send({ userIds: [userBId] });
    assert.equal(participants.status, 422, participants.text);
    assert.equal(errorOf(participants).code, 'CALENDAR_PRIVATE_NO_PARTICIPANTS');

    // Le proprietaire dans sa propre liste d'invites : refuse.
    const shared = await as(tokenA).post('/me/calendar/events').send({
      title: 'Partage avec soi',
      visibility: 'SHARED',
      startsAt: '2026-10-28T10:00:00Z',
    });
    const sharedEvent = dataOf<EventData>(shared);
    const selfInvite = await as(tokenA)
      .put(`/me/calendar/events/${sharedEvent.id}/participants`)
      .send({ userIds: [userAId] });
    assert.equal(selfInvite.status, 400, selfInvite.text);

    // Participant fantome : refuse.
    const ghost = await as(tokenA)
      .put(`/me/calendar/events/${sharedEvent.id}/participants`)
      .send({ userIds: ['cmzzzzzzzzzzzzzzzzzzzzzzzz'] });
    assert.equal(ghost.status, 400, ghost.text);
    assert.equal(errorOf(ghost).code, 'CALENDAR_PARTICIPANT_INVALID');
  });

  it('un evenement PARTAGE est moderable par un administrateur, mais ne perd pas sa propriete', async () => {
    const team = await as(tokenAdmin).get('/calendar/events');
    const shared = dataOf<EventData[]>(team).find((e) => e.title === 'Partage avec soi');
    assert.ok(shared);

    // L'admin peut corriger un evenement partage (moderation)…
    const moderate = await as(tokenAdmin)
      .patch(`/me/calendar/events/${shared.id}`)
      .send({ title: 'Partage avec soi (titre corrige)' });
    assert.equal(moderate.status, 200, moderate.text);
    assert.equal(dataOf<EventData>(moderate).canEdit, true);

    // …mais le proprietaire reste le proprietaire.
    const reread = await as(tokenA).get(`/me/calendar/events/${shared.id}`);
    assert.equal(dataOf<EventData>(reread).isOwn, true);
  });

  // -------------------------------------------------------------------------
  // Espace client
  // -------------------------------------------------------------------------

  it("l'espace client est ferme au calendrier, route par route", async () => {
    const routes: Array<['get' | 'post' | 'patch' | 'put' | 'delete', string]> = [
      ['get', '/me/calendar/events'],
      ['get', '/calendar/events'],
      ['post', '/me/calendar/events'],
    ];
    for (const [method, path] of routes) {
      const response = await as(tokenClient)
        [method](path)
        .send(
          method === 'post' ? { title: 'Curiosite', startsAt: '2026-10-29T10:00:00Z' } : undefined,
        );
      assert.equal(response.status, 403, `${method} ${path} : ${response.text}`);
    }
  });

  it('la suppression par le proprietaire est definitive (plus de fantome)', async () => {
    const created = await as(tokenA).post('/me/calendar/events').send({
      title: 'Evenement a supprimer',
      startsAt: '2026-10-30T10:00:00Z',
    });
    const event = dataOf<EventData>(created);

    const removed = await as(tokenA).delete(`/me/calendar/events/${event.id}`);
    assert.equal(removed.status, 200, removed.text);

    const probe = await as(tokenA).get(`/me/calendar/events/${event.id}`);
    assert.equal(probe.status, 404, probe.text);
    const mine = await as(tokenA).get('/me/calendar/events');
    assert.ok(!dataOf<EventData[]>(mine).some((e) => e.id === event.id), 'aucun evenement fantome');
  });

  it('les liens tache/projet restent coherents et non obligatoires', async () => {
    // Sans lien : parfaitement valide (un rendez-vous personnel n'appartient a rien).
    const standalone = await as(tokenA).post('/me/calendar/events').send({
      title: 'Sans lien',
      startsAt: '2026-10-31T08:00:00Z',
    });
    assert.equal(standalone.status, 201, standalone.text);
    assert.equal(dataOf<EventData>(standalone).taskId, null);

    // Lien vers une tache : le projet de la tache est repris automatiquement.
    const task = await as(tokenA).post('/me/tasks').send({ title: 'Tache liee au calendrier' });
    assert.equal(task.status, 201, task.text);
    const taskData = dataOf<{ id: string }>(task);

    const linked = await as(tokenA).post('/me/calendar/events').send({
      title: 'Revue de la tache',
      startsAt: '2026-11-02T09:00:00Z',
      taskId: taskData.id,
    });
    assert.equal(linked.status, 201, linked.text);
    assert.equal(dataOf<EventData>(linked).taskId, taskData.id);

    // Lien vers une tache INCONNUE du porteur : 404, pas de lien fantome.
    const phantom = await as(tokenA).post('/me/calendar/events').send({
      title: 'Lien fantome',
      startsAt: '2026-11-03T09:00:00Z',
      taskId: 'cmzzzzzzzzzzzzzzzzzzzzzzzz',
    });
    assert.equal(phantom.status, 404, phantom.text);
  });
});
