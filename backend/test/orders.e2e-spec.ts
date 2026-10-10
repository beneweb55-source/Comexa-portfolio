// DOIT rester la premiere ligne : les decorateurs de Nest sont evalues au
// chargement des modules, et ils ont besoin de `Reflect.metadata` deja installe.
import 'reflect-metadata';
import './support/e2e-payment-env.js';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { hashPassword } from '../src/common/security/password.js';
import { generateOpaqueToken, hashToken } from '../src/common/security/token-hash.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * PARCOURS INSCRIPTION -> VERIFICATION -> COMMANDE -> VALIDATION (base reelle).
 *
 * Configuration de paiement fixee par `./support/e2e-payment-env.ts` (DZD vide,
 * EUR = BANK_TRANSFER), independamment du `.env` local.
 */

const PASSWORD = 'Cascade-Lumiere-Forge-72-Quartz';
const EMAIL_DZ = 'e2e-orders-dz@comexa.example';
const EMAIL_FR = 'e2e-orders-fr@comexa.example';
const EMAIL_FR_2 = 'e2e-orders-fr2@comexa.example';
const EMAIL_SALES = 'e2e-orders-sales@comexa.example';
const EMAIL_DEV = 'e2e-orders-dev@comexa.example';
const ALL_EMAILS = [EMAIL_DZ, EMAIL_FR, EMAIL_FR_2, EMAIL_SALES, EMAIL_DEV];

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details: unknown };
}

function errorOf(response: request.Response): ErrorBody['error'] {
  const body = response.body as ErrorBody;
  assert.equal(body.success, false, "une reponse d'echec doit porter success: false");
  return body.error;
}

function dataOf<T>(response: request.Response): T {
  return (response.body as { data: T }).data;
}

describe('Commandes et verification e-mail (bout en bout, base reelle)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  /** Une requete fraiche a chaque appel, sur le serveur de test. */
  const http = () => request(app.getHttpServer());
  const created: {
    userIds: string[];
    orderIds: string[];
    projectIds: string[];
    rateIds: string[];
  } = {
    userIds: [],
    orderIds: [],
    projectIds: [],
    rateIds: [],
  };
  let packageId = '';
  const tokens: Record<string, string> = {};

  /** Inscription + jeton de verification pose directement en base (le courriel n'est pas lisible en test). */
  async function registerAndVerify(email: string, country: string): Promise<string> {
    const res = await http().post('/api/auth/register').send({
      firstName: 'Test',
      lastName: 'Commande',
      email,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      country,
    });
    assert.equal(res.status, 202);

    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    created.userIds.push(user.id);

    const raw = generateOpaqueToken();
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const verified = await http().post('/api/auth/verify-email').send({ token: raw });
    assert.equal(verified.status, 200);
    return raw;
  }

  /**
   * Jeton d'acces, mis en cache par compte : le limiteur de la route de connexion
   * ne doit pas faire echouer le test lui-meme.
   */
  const sessions = new Map<string, string>();
  async function login(email: string): Promise<string> {
    const cached = sessions.get(email);
    if (cached) return cached;
    const res = await http().post('/api/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const token = dataOf<{ accessToken: string }>(res).accessToken;
    sessions.set(email, token);
    return token;
  }

  before(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    // Nettoyage preventif d'un run precedent interrompu.
    const stale = await prisma.user.findMany({
      where: { email: { in: ALL_EMAILS } },
      select: { id: true },
    });
    const staleIds = stale.map((u) => u.id);
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: staleIds } }, { entityId: { in: staleIds } }] },
    });
    await prisma.order.deleteMany({ where: { userId: { in: staleIds } } });
    await prisma.projectRequest.deleteMany({ where: { userId: { in: staleIds } } });
    await prisma.user.deleteMany({ where: { id: { in: staleIds } } });

    const pack = await prisma.package.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    assert.ok(pack, 'le seed doit fournir au moins un pack');
    packageId = pack.id;

    // Un tarif EUR actif, date passee. Le tarif DZD n'existe pas : c'est le cas testé.
    const rate = await prisma.packageRate.create({
      data: {
        packageId,
        currency: 'EUR',
        amount: '1500.00',
        effectiveFrom: new Date('2025-01-01'),
      },
    });
    created.rateIds.push(rate.id);

    // Un tarif DZD existe aussi : le compte algerien doit echouer faute de MOYEN de
    // paiement (PAYMENT_METHODS_DZD vide), pas faute de tarif.
    const rateDzd = await prisma.packageRate.create({
      data: {
        packageId,
        currency: 'DZD',
        amount: '50000.00',
        effectiveFrom: new Date('2025-01-01'),
      },
    });
    created.rateIds.push(rateDzd.id);

    // Un membre de l'equipe commerciale et un developpeur, pour les scenarios de refus.
    const salesRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'SALES' },
      select: { id: true },
    });
    const devRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'DEVELOPER' },
      select: { id: true },
    });
    const passwordHash = await hashPassword(PASSWORD);
    const sales = await prisma.user.create({
      data: {
        email: EMAIL_SALES,
        passwordHash,
        firstName: 'Vente',
        lastName: 'Test',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        roles: { create: { roleId: salesRole.id } },
      },
    });
    const dev = await prisma.user.create({
      data: {
        email: EMAIL_DEV,
        passwordHash,
        firstName: 'Dev',
        lastName: 'Test',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        roles: { create: { roleId: devRole.id } },
      },
    });
    created.userIds.push(sales.id, dev.id);
  });

  after(async () => {
    if (!app) return;
    // Ordre impose par les cles etrangeres (Restrict) : commandes, puis activites
    // et projets, puis comptes, puis dossiers clients et tarifs. `app.close()` est
    // dans le `finally` : un nettoyage en echec ne doit pas laisser le processus
    // de test bloque sur des connexions ouvertes.
    try {
      const ids = created.userIds;
      const users = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { clientId: true },
      });
      const clientIds = users.map((u) => u.clientId).filter((c): c is string => c !== null);

      await prisma.order.deleteMany({
        where: {
          OR: [
            { id: { in: created.orderIds } },
            { userId: { in: ids } },
            { clientId: { in: clientIds } },
          ],
        },
      });
      await prisma.activity.deleteMany({
        where: { OR: [{ projectId: { in: created.projectIds } }, { clientId: { in: clientIds } }] },
      });
      await prisma.project.deleteMany({ where: { id: { in: created.projectIds } } });
      await prisma.auditLog.deleteMany({
        where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] },
      });
      await prisma.projectRequest.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
      await prisma.packageRate.deleteMany({ where: { id: { in: created.rateIds } } });
    } finally {
      await app.close();
    }
  });

  it("l'inscription repond la meme chose pour une adresse nouvelle ou deja connue", async () => {
    const first = await http().post('/api/auth/register').send({
      firstName: 'Ana',
      lastName: 'Doublon',
      email: EMAIL_FR_2,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      country: 'FR',
    });
    const again = await http().post('/api/auth/register').send({
      firstName: 'Ana',
      lastName: 'Doublon',
      email: EMAIL_FR_2,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      country: 'FR',
    });
    assert.equal(first.status, 202);
    assert.equal(again.status, 202);
    assert.deepEqual(first.body, again.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_FR_2 } });
    created.userIds.push(user.id);
    assert.equal(user.status, 'INVITED');
    assert.equal(user.clientId, null, "pas d'espace client avant commande");
  });

  it('refuse la connexion tant que le compte n est pas verifie, avec ACCOUNT_INVITED', async () => {
    const res = await http()
      .post('/api/auth/login')
      .send({ email: EMAIL_FR_2, password: PASSWORD });
    assert.equal(res.status, 403);
    assert.equal(errorOf(res).code, 'ACCOUNT_INVITED');
  });

  it('un mauvais mot de passe reste une erreur d identifiants, meme pour un compte non verifie', async () => {
    const res = await http()
      .post('/api/auth/login')
      .send({ email: EMAIL_FR_2, password: 'mauvais-mot-de-passe-xyz' });
    assert.equal(res.status, 401);
  });

  it('active le compte avec le lien, refuse la reutilisation du meme lien', async () => {
    tokens[EMAIL_FR] = await registerAndVerify(EMAIL_FR, 'FR');
    const reused = await http().post('/api/auth/verify-email').send({ token: tokens[EMAIL_FR] });
    assert.equal(reused.status, 400);
    assert.equal(errorOf(reused).code, 'TOKEN_INVALID');
  });

  it("n'offre pas d'espace client avant commande : la liste des commandes est vide, pas refusee", async () => {
    const token = await login(EMAIL_FR);
    const res = await http().get('/api/orders').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
    assert.equal(res.body.meta.total, 0);
  });

  it('un compte algerien ne peut pas commander tant que PAYMENT_METHODS_DZD est vide : demande de projet proposee', async () => {
    await registerAndVerify(EMAIL_DZ, 'DZ');
    const token = await login(EMAIL_DZ);
    const res = await http()
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ packageId });
    assert.equal(res.status, 422);
    const error = errorOf(res);
    assert.equal(error.code, 'ORDER_UNAVAILABLE');
    assert.deepEqual(error.details, {
      alternative: 'PROJECT_REQUEST',
      reason: 'NO_COMPATIBLE_PAYMENT_METHOD',
      currency: 'DZD',
    });
    const dz = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_DZ } });
    assert.equal(dz.clientId, null, 'une commande refusee ne cree aucun dossier client');
  });

  it('refuse que le client impose une devise ou un montant dans la commande', async () => {
    const token = await login(EMAIL_FR);
    const res = await http()
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ packageId, currency: 'DZD', amount: 1 });
    assert.equal(res.status, 400);
    assert.equal(errorOf(res).code, 'VALIDATION_FAILED');
  });

  it('commander active l espace client, en EUR pour un compte etranger, au tarif du serveur', async () => {
    const token = await login(EMAIL_FR);
    const res = await http()
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ packageId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const order = dataOf<{
      id: string;
      currency: string;
      amount: string;
      status: string;
      paymentStatus: string;
      clientId: string;
    }>(res);
    created.orderIds.push(order.id);
    assert.equal(order.currency, 'EUR');
    assert.equal(Number(order.amount), 1500, 'le montant vient du tarif EUR, pas du client');
    assert.equal(order.status, 'ORDERED');
    assert.equal(
      order.paymentStatus,
      'UNPAID',
      'le paiement reste en attente tant que l equipe ne l a pas enregistre',
    );

    const fr = await prisma.user.findUniqueOrThrow({
      where: { email: EMAIL_FR },
      include: { roles: { include: { role: true } } },
    });
    assert.ok(fr.clientId, 'le dossier client est cree a la commande');
    assert.ok(
      fr.roles.some((r) => r.role.code === 'CLIENT'),
      'le role CLIENT est attribue',
    );
  });

  it('refuse une seconde commande ouverte pour le meme pack', async () => {
    const token = await login(EMAIL_FR);
    const res = await http()
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ packageId });
    assert.equal(res.status, 409);
    assert.equal(errorOf(res).code, 'ORDER_ALREADY_OPEN');
  });

  it('un client ne voit pas la commande d un autre client (404, pas 403)', async () => {
    // Le second client verifie son adresse (jeton pose en base, sans nouvelle inscription),
    // puis commande lui-meme : il a alors son dossier et le role CLIENT.
    const fr2 = await prisma.user.findUniqueOrThrow({
      where: { email: EMAIL_FR_2 },
      select: { id: true },
    });
    const raw = generateOpaqueToken();
    await prisma.emailVerificationToken.create({
      data: {
        userId: fr2.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    assert.equal((await http().post('/api/auth/verify-email').send({ token: raw })).status, 200);
    const token = await login(EMAIL_FR_2);
    const own = await http()
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ packageId });
    assert.equal(own.status, 201, JSON.stringify(own.body));
    created.orderIds.push(dataOf<{ id: string }>(own).id);

    const otherOrderId = created.orderIds[0];
    assert.ok(otherOrderId);
    const res = await http()
      .get(`/api/orders/${otherOrderId}`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 404);
  });

  it('un collaborateur sans role CLIENT ne peut pas commander', async () => {
    const token = await login(EMAIL_DEV);
    const res = await http()
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ packageId });
    assert.equal(res.status, 403);
  });

  it("l'equipe voit la commande ; aucun projet avant validation", async () => {
    const token = await login(EMAIL_SALES);
    const orderId = created.orderIds[0];
    assert.ok(orderId);
    const res = await http().get(`/api/orders/${orderId}`).set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    const order = dataOf<{ status: string; project: unknown }>(res);
    assert.equal(order.status, 'ORDERED');
    assert.equal(order.project, null, 'aucun projet avant validation');
  });

  it('un developpeur est refuse sur la validation et sur la gestion des tarifs', async () => {
    const token = await login(EMAIL_DEV);
    const orderId = created.orderIds[0];
    const validate = await http()
      .post(`/api/orders/${orderId}/validate`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(validate.status, 403);
    const rate = await http()
      .post(`/api/content/packages/${packageId}/rates`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currency: 'EUR', amount: 999, effectiveFrom: '2026-01-01' });
    assert.equal(rate.status, 403);
  });

  it("la validation par l'equipe cree le projet, puis le demarrage le passe en cours", async () => {
    const token = await login(EMAIL_SALES);
    const orderId = created.orderIds[0];
    assert.ok(orderId);

    const validated = await http()
      .post(`/api/orders/${orderId}/validate`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(validated.status, 200, JSON.stringify(validated.body));
    const order = dataOf<{ status: string; project: { id: string; status: string } | null }>(
      validated,
    );
    assert.equal(order.status, 'IN_PREPARATION');
    assert.ok(order.project, 'le projet est cree a la validation');
    created.projectIds.push(order.project.id);

    const again = await http()
      .post(`/api/orders/${orderId}/validate`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(again.status, 409);
    assert.equal(errorOf(again).code, 'ORDER_INVALID_STATE');

    const started = await http()
      .post(`/api/orders/${orderId}/start`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(started.status, 200);
    assert.equal(dataOf<{ status: string }>(started).status, 'IN_PROGRESS');
    const project = await prisma.project.findUniqueOrThrow({ where: { id: order.project.id } });
    assert.equal(project.status, 'IN_PROGRESS');
  });

  it("l'encaissement est enregistre par l'equipe seulement, et le client voit son projet lie", async () => {
    const teamToken = await login(EMAIL_SALES);
    const orderId = created.orderIds[0];
    assert.ok(orderId);

    const paid = await http()
      .patch(`/api/orders/${orderId}/payment`)
      .set('Authorization', `Bearer ${teamToken}`)
      .send({ paymentStatus: 'PAID', note: 'Virement recu' });
    assert.equal(paid.status, 200);
    assert.equal(dataOf<{ paymentStatus: string }>(paid).paymentStatus, 'PAID');

    const clientToken = await login(EMAIL_FR);
    const asClient = await http()
      .patch(`/api/orders/${orderId}/payment`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ paymentStatus: 'PAID' });
    assert.equal(asClient.status, 403, 'le client ne declare jamais son propre paiement');

    const mine = await http()
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${clientToken}`);
    assert.equal(mine.status, 200);
    assert.ok(
      dataOf<{ project: unknown }>(mine).project,
      'le client voit le projet issu de sa commande',
    );
  });

  it("l'aperçu d'offre donne le prix serveur pour un compte etranger, et le motif pour un compte algerien", async () => {
    const fr = await http()
      .get(`/api/orders/offer?packageId=${packageId}`)
      .set('Authorization', `Bearer ${await login(EMAIL_FR)}`);
    assert.equal(fr.status, 200);
    const frOffer = dataOf<{ kind: string; currency: string; amount: string }>(fr);
    assert.equal(frOffer.kind, 'ORDER');
    assert.equal(frOffer.currency, 'EUR');
    assert.equal(frOffer.amount, '1500.00');

    const dz = await http()
      .get(`/api/orders/offer?packageId=${packageId}`)
      .set('Authorization', `Bearer ${await login(EMAIL_DZ)}`);
    assert.equal(dz.status, 200);
    const dzOffer = dataOf<{ kind: string; reason: string }>(dz);
    assert.equal(dzOffer.kind, 'PROJECT_REQUEST');
    assert.equal(dzOffer.reason, 'NO_COMPATIBLE_PAYMENT_METHOD');
  });

  it('la reponse client ne contient ni identifiant interne ni tarif, la reponse equipe garde le client', async () => {
    const token = await login(EMAIL_FR);
    const orderId = created.orderIds[0];
    assert.ok(orderId);
    const mine = await http().get(`/api/orders/${orderId}`).set('Authorization', `Bearer ${token}`);
    const view = dataOf<Record<string, unknown>>(mine);
    for (const forbidden of ['userId', 'rateId', 'clientId', 'packageId', 'country', 'customer']) {
      assert.equal(forbidden in view, false, `la vue client ne doit pas exposer ${forbidden}`);
    }
    const team = await http()
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${await login(EMAIL_SALES)}`);
    const teamView = dataOf<{ customer: { email: string }; clientId: string }>(team);
    assert.equal(teamView.customer.email, EMAIL_FR);
    assert.ok(teamView.clientId);
  });

  it('un compte algerien enregistre une demande de projet ; la demande en double est refusee', async () => {
    const token = await login(EMAIL_DZ);
    const first = await http()
      .post('/api/project-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ packageId, message: 'Je souhaite un site vitrine pour mon atelier.' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const request = dataOf<{ reference: string; reason: string; status: string }>(first);
    assert.match(request.reference, /^DEM-/);
    assert.equal(request.reason, 'NO_COMPATIBLE_PAYMENT_METHOD');
    assert.equal(request.status, 'NEW');

    const again = await http()
      .post('/api/project-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ packageId });
    assert.equal(again.status, 409);
    assert.equal(errorOf(again).code, 'PROJECT_REQUEST_ALREADY_OPEN');

    const mine = await http()
      .get('/api/project-requests/mine')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(mine.status, 200);
    assert.ok(
      (mine.body as { data: Array<{ reference: string }> }).data.some(
        (r) => r.reference === request.reference,
      ),
      'la demande apparait dans la liste de son auteur',
    );
  });

  it("l'equipe voit la demande avec le client, la traite, et une demande close ne se rouvre pas", async () => {
    const team = await login(EMAIL_SALES);
    const list = await http().get('/api/project-requests').set('Authorization', `Bearer ${team}`);
    assert.equal(list.status, 200);
    const items = (list.body as { data: Array<{ id: string; customer: { email: string } }> }).data;
    const mine = items.find((r) => r.customer.email === EMAIL_DZ);
    assert.ok(mine, "la demande d'un client apparait dans la liste equipe");

    const updated = await http()
      .patch(`/api/project-requests/${mine.id}`)
      .set('Authorization', `Bearer ${team}`)
      .send({ status: 'IN_REVIEW', teamNote: 'Rappeler le client mardi.' });
    assert.equal(updated.status, 200);
    assert.equal(dataOf<{ status: string }>(updated).status, 'IN_REVIEW');

    const closed = await http()
      .patch(`/api/project-requests/${mine.id}`)
      .set('Authorization', `Bearer ${team}`)
      .send({ status: 'CLOSED' });
    assert.equal(closed.status, 200);
    const reopened = await http()
      .patch(`/api/project-requests/${mine.id}`)
      .set('Authorization', `Bearer ${team}`)
      .send({ status: 'IN_REVIEW' });
    assert.equal(reopened.status, 409);

    // La note interne n'apparait jamais dans la vue du client.
    const clientView = await http()
      .get('/api/project-requests/mine')
      .set('Authorization', `Bearer ${await login(EMAIL_DZ)}`);
    assert.equal(JSON.stringify(clientView.body).includes('Rappeler le client'), false);
  });

  it("un developpeur ne voit pas les demandes de projet de l'equipe", async () => {
    const res = await http()
      .get('/api/project-requests')
      .set('Authorization', `Bearer ${await login(EMAIL_DEV)}`);
    assert.equal(res.status, 403);
  });
});
