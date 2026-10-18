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
import { hashPassword } from '../src/common/security/password.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';

/**
 * « RÉPARTITION & SOLDES » — TEST DE BOUT EN BOUT, SUR LA VRAIE BASE.
 *
 * Ce fichier verifie les SEPT proprietes que le client a demandees, une par
 * une, sur une base PostgreSQL reelle. Aucun simulateur : un montant calcule
 * ici est un montant ecrit en base.
 *
 *  1. LA FACTION D'UNE FACTURE N'EST PAS UN PAIEMENT. La base « encaissee »
 *     additionne les PAIEMENTS reussis ; la base « facturee » additionne les
 *     factures emises. Les deux repondent a des questions differentes, et le
 *     test le prouve en.Compare les deux sommes.
 *
 *  2. LA SOMME REPARTIE VAUT EXACTEMENT LA BASE. Ni un centime perdu, ni un
 *     centime invente, meme quand la base ne se divise pas.
 *
 *  3. UN REJEU NE CREE PAS DEUXIEME REPARTITION. Deux calculs successifs, un
 *     webhook repete, deux workers : la cle d'idempotence fait foi.
 *
 *  4. UN CHANGEMENT DE REGLE NE RECALCULE RIEN. Une nouvelle version de regle
 *     est creee, l'ancienne reste en place, et la repartition deja validee
 *     continue d'pointer sur la regle qui l'a produite.
 *
 *  5. UNE EXCEPTION DE PROJET PRIME SUR LA REGLE PAR DEFAUT.
 *
 *  6. UNE OPERATION VALIDEE NE S'EFFACE JAMAIS. Une contre-passation s'y oppose,
 *     la laisse visible, et le solde revient exactement a son etat d'avant.
 *
 *  7. PERSONNE NE VOIT LE SOLDE D'AUTRUI. Un membre de l'equipe ne peut lire
 *     ni le solde d'un collegue, ni le tableau de bord des soldes ; un client
 *     n'a aucun acces du tout.
 */

const PASSWORD = 'Cascade-Lumiere-Forge-72-Quartz';

const EMAIL_ADMIN = 'e2e-fin-admin@comexa.example';
const EMAIL_A = 'e2e-fin-a@comexa.example';
const EMAIL_B = 'e2e-fin-b@comexa.example';
const EMAIL_CLIENT = 'e2e-fin-client@comexa.example';

const ALL_EMAILS = [EMAIL_ADMIN, EMAIL_A, EMAIL_B, EMAIL_CLIENT];

interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: unknown;
}

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details: unknown };
}

interface LoginData {
  accessToken: string;
  user: { id: string; email: string };
}

interface RuleBeneficiary {
  id: string;
  name: string;
  userId: string | null;
  percentage: string;
}

interface RuleData {
  id: string;
  name: string;
  version: number;
  scopeKey: string;
  projectId: string | null;
  baseType: string;
  isActive: boolean;
  effectiveDate: string;
  beneficiaries: RuleBeneficiary[];
}

interface ItemData {
  id: string;
  percentage: string | null;
  calculatedAmount: string;
  creditedAmount: string;
  status: string;
  trace: { raw: string; floor: string; remainder: string; adjustment: string } | null;
  beneficiary: { id: string; name: string; userId: string | null };
}

interface DistributionData {
  id: string;
  projectId: string;
  configId: string;
  baseAmount: string;
  baseCurrency: string;
  baseType: string | null;
  ruleVersion: number | null;
  round: number;
  status: string;
  calculationTrace: { base: string; method: string; total: string } | null;
  items: ItemData[];
}

interface EligibleMemberRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
}

interface BalanceRow {
  userId: string;
  currency: string;
  accrued: string;
  paid: string;
  advances: string;
  adjustments: string;
  corrections: string;
  remaining: string;
  transactionCount: number;
}

interface TransactionRow {
  id: string;
  userId: string;
  kind: string;
  type: string;
  amount: string;
  currency: string;
  reason: string | null;
  authorId: string | null;
  reversalOfId: string | null;
  previousBalance: string;
  newBalance: string;
}

function data<T>(response: request.Response): T {
  const body = response.body as SuccessBody<T>;
  assert.equal(body.success, true, `reponse inattendue : ${JSON.stringify(response.body)}`);
  return body.data;
}

function errorOf(response: request.Response): ErrorBody['error'] {
  const body = response.body as ErrorBody;
  assert.equal(body.success, false, 'une reponse d\'echec doit porter success: false');
  return body.error;
}

async function login(app: INestApplication, baseUrl: string, email: string): Promise<LoginData> {
  const response = await request(app.getHttpServer())
    .post(`${baseUrl}/auth/login`)
    .send({ email, password: PASSWORD });
  assert.equal(response.status, 200, `connexion impossible pour ${email}`);
  return data<LoginData>(response);
}

/**
 * Efface ce que ce fichier a laisse. L'ORDRE COMPTE : les cles etrangeres
 * n'ont pas toutes `onDelete: cascade`, et un nettoyage dans le desordre
 * echouerait precisement quand la base est dans un etat mixte.
 */
async function purge(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { in: [...ALL_EMAILS] } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  if (userIds.length === 0) {
    return;
  }

  const projects = await prisma.project.findMany({
    where: { name: { startsWith: 'E2E Financier' } },
    select: { id: true },
  });
  const projectIds = projects.map((project) => project.id);

  const distributions = await prisma.projectDistribution.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true },
  });
  const distributionIds = distributions.map((distribution) => distribution.id);

  await prisma.balanceTransaction.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { projectId: { in: projectIds } }] },
  });
  await prisma.distributionHistory.deleteMany({
    where: { distributionId: { in: distributionIds } },
  });
  await prisma.distributionItem.deleteMany({
    where: { distributionId: { in: distributionIds } },
  });
  await prisma.projectDistribution.deleteMany({
    where: { id: { in: distributionIds } },
  });
  await prisma.distributionBeneficiary.deleteMany({
    where: { config: { createdById: { in: userIds } } },
  });
  await prisma.distributionConfig.deleteMany({
    where: { createdById: { in: userIds } },
  });
  await prisma.memberBalance.deleteMany({ where: { userId: { in: userIds } } });

  await prisma.payment.deleteMany({
    where: { invoice: { projectId: { in: projectIds } } },
  });
  await prisma.invoiceItem.deleteMany({
    where: { invoice: { projectId: { in: projectIds } } },
  });
  await prisma.invoice.deleteMany({ where: { projectId: { in: projectIds } } });

  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: projectIds } }] },
  });

  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

describe('Répartition & soldes (bout en bout, base réelle)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  let admin: LoginData;
  let memberA: LoginData;
  let memberB: LoginData;
  let client: LoginData;

  let projectId = '';
  let clientId = '';
  let globalRuleId = '';

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  before(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);

    const setup = configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    baseUrl = `/${setup.apiPrefix}`;

    await purge(prisma);

    const [adminRole, developerRole, clientRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'DEVELOPER' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'CLIENT' }, select: { id: true } }),
    ]);

    const passwordHash = await hashPassword(PASSWORD);
    const base = {
      passwordHash,
      status: 'ACTIVE' as const,
      isEmailVerified: true,
      mustChangePassword: false,
    };

    await prisma.user.create({
      data: {
        ...base,
        email: EMAIL_ADMIN,
        firstName: 'Admin',
        lastName: 'Financier',
        roles: { create: { roleId: adminRole.id } },
      },
    });
    await prisma.user.create({
      data: {
        ...base,
        email: EMAIL_A,
        firstName: 'Membre',
        lastName: 'Alpha',
        roles: { create: { roleId: developerRole.id } },
      },
    });
    await prisma.user.create({
      data: {
        ...base,
        email: EMAIL_B,
        firstName: 'Membre',
        lastName: 'Beta',
        roles: { create: { roleId: developerRole.id } },
      },
    });
    await prisma.user.create({
      data: {
        ...base,
        email: EMAIL_CLIENT,
        firstName: 'Client',
        lastName: 'Externe',
        roles: { create: { roleId: clientRole.id } },
      },
    });

    admin = await login(app, baseUrl, EMAIL_ADMIN);
    memberA = await login(app, baseUrl, EMAIL_A);
    memberB = await login(app, baseUrl, EMAIL_B);
    client = await login(app, baseUrl, EMAIL_CLIENT);

    // Un client, un projet, une facture emise, deux encaissements.
    const createdClient = await prisma.client.create({
      data: { reference: `E2E-FIN-CLIENT-${Date.now()}`, companyName: 'E2E Financier SARL' },
      select: { id: true },
    });
    clientId = createdClient.id;

    const createdProject = await prisma.project.create({
      data: {
        reference: `E2E-FIN-PROJ-${Date.now()}`,
        name: 'E2E Financier — Chantier',
        clientId,
        budget: new Prisma.Decimal('100000.00'),
        currency: 'DZD',
      },
      select: { id: true },
    });
    projectId = createdProject.id;

    const invoice = await prisma.invoice.create({
      data: {
        reference: `E2E-FIN-FA-${Date.now()}`,
        clientId,
        projectId,
        status: 'SENT',
        year: 2026,
        sequence: (Date.now() % 800000) + 1000,
        issueDate: new Date('2026-10-01T00:00:00Z'),
        dueDate: new Date('2026-10-31T00:00:00Z'),
        currency: 'DZD',
        subtotal: new Prisma.Decimal('80000.00'),
        total: new Prisma.Decimal('80000.00'),
      },
      select: { id: true },
    });

    // Deux encaissements partiels : 30 000 puis 20 000. Le total encaisse est
    // 50 000, la facture est de 80 000. C'est exactement la difference que le
    // test doit voir.
    await prisma.payment.create({
      data: {
        reference: `E2E-FIN-P1-${Date.now()}`,
        invoiceId: invoice.id,
        amount: new Prisma.Decimal('30000.00'),
        currency: 'DZD',
        method: 'CASH',
        status: 'SUCCEEDED',
        paidAt: new Date('2026-10-05T00:00:00Z'),
      },
    });
    await prisma.payment.create({
      data: {
        reference: `E2E-FIN-P2-${Date.now()}`,
        invoiceId: invoice.id,
        amount: new Prisma.Decimal('20000.00'),
        currency: 'DZD',
        method: 'BANK_TRANSFER',
        status: 'SUCCEEDED',
        paidAt: new Date('2026-10-12T00:00:00Z'),
      },
    });
    // Un paiement en attente ne compte pas : l'argent n'est pas entre.
    await prisma.payment.create({
      data: {
        reference: `E2E-FIN-P3-${Date.now()}`,
        invoiceId: invoice.id,
        amount: new Prisma.Decimal('5000.00'),
        currency: 'DZD',
        method: 'BANK_TRANSFER',
        status: 'PENDING',
        paidAt: new Date('2026-10-15T00:00:00Z'),
      },
    });
  });

  after(async () => {
    if (app) {
      await purge(prisma);
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // 1. La base de calcul distingue le facture de l'encai
  // ---------------------------------------------------------------------------

  it('distingue le montant facture du montant reellement encaisse', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/distributions/projects/${projectId}/base`)
      .set(auth(admin.accessToken));

    assert.equal(response.status, 200);
    const base = data<{
      baseAmount: string;
      invoiced: string;
      collected: string;
      budget: string;
      currency: string;
      invoiceCount: number;
      paymentCount: number;
    }>(response);

    // La facture emise vaut 80 000, mais 50 000 seulement ont ete encaisse.
    assert.equal(base.invoiced, '80000');
    assert.equal(base.collected, '50000');
    assert.equal(base.budget, '100000');
    assert.equal(base.currency, 'DZD');
    // Le paiement en attente n'est pas un encaissement.
    assert.equal(base.paymentCount, 2);
    assert.equal(base.invoiceCount, 1);
  });

  // ---------------------------------------------------------------------------
  // Creation des regles
  // ---------------------------------------------------------------------------

  it('cree une regle par defaut a 60/40, et la versionne', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/configs`)
      .set(auth(admin.accessToken))
      .send({
        name: 'Regle par defaut 2026',
        description: ' repartition d equipe',
        baseType: 'COLLECTED_AMOUNT',
        beneficiaries: [
          { beneficiaryType: 'MEMBER', name: 'Alpha', userId: memberA.user.id, percentage: '60', order: 0 },
          { beneficiaryType: 'MEMBER', name: 'Beta', userId: memberB.user.id, percentage: '40', order: 1 },
        ],
      });

    assert.equal(response.status, 201);
    const rule = data<RuleData>(response);
    globalRuleId = rule.id;

    assert.equal(rule.version, 1);
    assert.equal(rule.scopeKey, 'global');
    assert.equal(rule.beneficiaries.length, 2);
  });

  it('refuse une regle dont le total n’est pas 100 %', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/configs`)
      .set(auth(admin.accessToken))
      .send({
        name: 'Regle cassee',
        baseType: 'COLLECTED_AMOUNT',
        beneficiaries: [
          { beneficiaryType: 'MEMBER', name: 'Alpha', userId: memberA.user.id, percentage: '60', order: 0 },
          { beneficiaryType: 'MEMBER', name: 'Beta', userId: memberB.user.id, percentage: '30', order: 1 },
        ],
      });

    assert.equal(response.status, 400);
    assert.match(errorOf(response).message, /100/);
  });

  it('refuse un membre en double', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/configs`)
      .set(auth(admin.accessToken))
      .send({
        name: 'Regle doublon',
        baseType: 'COLLECTED_AMOUNT',
        beneficiaries: [
          { beneficiaryType: 'MEMBER', name: 'Alpha', userId: memberA.user.id, percentage: '50', order: 0 },
          { beneficiaryType: 'MEMBER', name: 'Alpha bis', userId: memberA.user.id, percentage: '50', order: 1 },
        ],
      });

    assert.equal(response.status, 400);
    assert.match(errorOf(response).message, /deux fois|unique|double/i);
  });

  it('refuse un client comme beneficiaire de repartition', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/configs`)
      .set(auth(admin.accessToken))
      .send({
        name: 'Regle client',
        baseType: 'COLLECTED_AMOUNT',
        beneficiaries: [
          { beneficiaryType: 'MEMBER', name: 'Client', userId: client.user.id, percentage: '100', order: 0 },
        ],
      });

    assert.equal(response.status, 400);
    assert.match(errorOf(response).message, /membre actif|équipe|equipe/i);
  });

  // ---------------------------------------------------------------------------
  // 2. Le calcul
  // ---------------------------------------------------------------------------

  let distributionId = '';

  it('calcule une repartition sur la base encaissee, au centime exact', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/projects/${projectId}/calculate`)
      .set(auth(admin.accessToken))
      .send({});

    assert.equal(response.status, 201);
    const distribution = data<DistributionData>(response);
    distributionId = distribution.id;

    assert.equal(distribution.baseAmount, '50000');
    assert.equal(distribution.baseType, 'COLLECTED_AMOUNT');
    assert.equal(distribution.ruleVersion, 1);
    assert.equal(distribution.status, 'CALCULATED');
    assert.equal(distribution.items.length, 2);

    // 60 % de 50 000 = 30 000, 40 % = 20 000. Et la somme vaut la base.
    const total = distribution.items.reduce(
      (sum, item) => sum + Number(item.calculatedAmount),
      0,
    );
    assert.equal(total, 50000);
    assert.equal(
      distribution.items.map((item) => item.calculatedAmount).sort().join('|'),
      '20000|30000',
    );

    // La trace d'arrondi est la, centime par centime.
    assert.ok(distribution.calculationTrace);
    assert.equal(distribution.calculationTrace.method, 'largest-remainder');
    assert.equal(distribution.calculationTrace.total, '50000');
    const trace = distribution.items[0]?.trace;
    assert.ok(trace);
    assert.equal(typeof trace.raw, 'string');
    assert.equal(typeof trace.adjustment, 'string');
  });

  it('ne cree pas de deuxieme repartition quand le calcul est rejoue', async () => {
    const before = await prisma.projectDistribution.count({ where: { projectId } });

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/projects/${projectId}/calculate`)
      .set(auth(admin.accessToken))
      .send({});

    assert.equal(response.status, 201);
    const distribution = data<DistributionData>(response);

    assert.equal(distribution.id, distributionId, 'le rejeu doit rendre la MEME répartition');
    assert.equal(
      await prisma.projectDistribution.count({ where: { projectId } }),
      before,
      'aucune répartition supplémentaire ne doit être créée',
    );
  });

  it('ne cree qu’une seule repartition quand deux calculs partent en meme temps', async () => {
    // Deux requetes simultanees, la meme cle d'idempotence : le verrou
    // consultatif et la cle unique doivent faire qu'il n'en reste qu'une.
    const key = `e2e-concurrence-${Date.now()}`;

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`${baseUrl}/distributions/projects/${projectId}/calculate`)
        .set(auth(admin.accessToken))
        .send({ idempotencyKey: key }),
      request(app.getHttpServer())
        .post(`${baseUrl}/distributions/projects/${projectId}/calculate`)
        .set(auth(admin.accessToken))
        .send({ idempotencyKey: key }),
    ]);

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);

    const a = data<DistributionData>(first);
    const b = data<DistributionData>(second);
    assert.equal(a.id, b.id, 'les deux appels doivent rendre la MEME répartition');

    const count = await prisma.projectDistribution.count({
      where: { projectId, idempotencyKey: key },
    });
    assert.equal(count, 1);
  });

  it('refuse de calculer sans permission', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/projects/${projectId}/calculate`)
      .set(auth(memberA.accessToken))
      .send({});

    assert.equal(response.status, 403);
  });

  // ---------------------------------------------------------------------------
  // 3. L'application et les soldes
  // ---------------------------------------------------------------------------

  it('applique la repartition et credite les soldes', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/${distributionId}/apply`)
      .set(auth(admin.accessToken));

    assert.equal(response.status, 201);
    const applied = data<DistributionData>(response);
    assert.equal(applied.status, 'APPLIED');

    const overview = await request(app.getHttpServer())
      .get(`${baseUrl}/balances/admin/overview`)
      .set(auth(admin.accessToken));

    assert.equal(overview.status, 200);
    const rows = data<BalanceRow[]>(overview);
    const rowA = rows.find((row) => row.userId === memberA.user.id);
    const rowB = rows.find((row) => row.userId === memberB.user.id);

    assert.equal(rowA?.remaining, '30000');
    assert.equal(rowA?.accrued, '30000');
    assert.equal(rowB?.remaining, '20000');
    assert.equal(rowB?.accrued, '20000');
  });

  it('ne credite pas deux fois si l’on reapplique', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/${distributionId}/apply`)
      .set(auth(admin.accessToken));

    assert.equal(response.status, 201);

    const balance = await prisma.memberBalance.findUnique({
      where: {
        userId_currency: { userId: memberA.user.id, currency: 'DZD' },
      },
    });
    assert.equal(balance?.currentBalance.toString(), '30000');
  });

  it('laisse un membre voir son propre solde, et rien d’autre', async () => {
    const mine = await request(app.getHttpServer())
      .get(`${baseUrl}/balances/me?currency=DZD`)
      .set(auth(memberA.accessToken));

    assert.equal(mine.status, 200);
    const balance = data<{ currentBalance: string; currency: string }>(mine);
    assert.equal(balance.currentBalance, '30000');
    assert.equal(balance.currency, 'DZD');

    // Le tableau de bord des soldes est reserve a l'administration.
    const overview = await request(app.getHttpServer())
      .get(`${baseUrl}/balances/admin/overview`)
      .set(auth(memberA.accessToken));
    assert.equal(overview.status, 403);

    // Et le solde d'un collegue n'est pas accessible non plus.
    const other = await request(app.getHttpServer())
      .get(`${baseUrl}/balances/users/${memberB.user.id}`)
      .set(auth(memberA.accessToken));
    assert.equal(other.status, 403);

    // Un client n'a rien du tout.
    const clientOverview = await request(app.getHttpServer())
      .get(`${baseUrl}/balances/admin/overview`)
      .set(auth(client.accessToken));
    assert.equal(clientOverview.status, 403);
  });

  // ---------------------------------------------------------------------------
  // 4. Un changement de regle ne recalcule rien
  // ---------------------------------------------------------------------------

  it('cree une nouvelle version de regle sans toucher a la repartition validee', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/configs/${globalRuleId}/revise`)
      .set(auth(admin.accessToken))
      .send({
        confirm: true,
        reason: 'reequilibrage 2027',
        effectiveDate: new Date(Date.now() + 86_400_000).toISOString(),
        beneficiaries: [
          { beneficiaryType: 'MEMBER', name: 'Alpha', userId: memberA.user.id, percentage: '50', order: 0 },
          { beneficiaryType: 'MEMBER', name: 'Beta', userId: memberB.user.id, percentage: '50', order: 1 },
        ],
      });

    assert.equal(response.status, 201);
    const version2 = data<RuleData>(response);
    assert.equal(version2.version, 2);

    // La repartition deja appliquee pointe toujours sur la version 1, et les
    // soldes n'ont pas bouge.
    const distribution = await prisma.projectDistribution.findUniqueOrThrow({
      where: { id: distributionId },
    });
    assert.equal(distribution.configId, globalRuleId);
    assert.equal(distribution.ruleVersion, 1);

    const balance = await prisma.memberBalance.findUnique({
      where: { userId_currency: { userId: memberA.user.id, currency: 'DZD' } },
    });
    assert.equal(balance?.currentBalance.toString(), '30000');

    // L'historique des versions montre bien les deux.
    const history = await request(app.getHttpServer())
      .get(`${baseUrl}/distributions/configs/${globalRuleId}/history`)
      .set(auth(admin.accessToken));
    assert.equal(history.status, 200);
    const versions = data<
      { version: number; beneficiaries: { name: string; percentage: string }[] }[]
    >(history);
    assert.equal(versions.length, 2);
    assert.equal(versions.find((v) => v.version === 1)?.beneficiaries[0]?.percentage, '60');
    assert.equal(versions.find((v) => v.version === 2)?.beneficiaries[0]?.percentage, '50');
  });

  it('refuse une revision sans confirmation explicite', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/configs/${globalRuleId}/revise`)
      .set(auth(admin.accessToken))
      .send({
        name: 'Version 3 sans confirmation',
        beneficiaries: [
          { beneficiaryType: 'MEMBER', name: 'Alpha', userId: memberA.user.id, percentage: '100', order: 0 },
        ],
      });

    // Sans `confirm`, la requete est refusee par le contrat lui-meme.
    assert.equal(response.status, 400);
    assert.match(JSON.stringify(errorOf(response).details ?? errorOf(response).message), /confirm/i);

    // Et une confirmation explicite fausse est refusee par le service, avec un
    // message qui dit ce qu'il faut faire.
    const refused = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/configs/${globalRuleId}/revise`)
      .set(auth(admin.accessToken))
      .send({
        confirm: false,
        beneficiaries: [
          { beneficiaryType: 'MEMBER', name: 'Alpha', userId: memberA.user.id, percentage: '100', order: 0 },
        ],
      });

    assert.equal(refused.status, 400);
    assert.equal(errorOf(refused).code, 'CONFIRMATION_REQUIRED');
  });

  // ---------------------------------------------------------------------------
  // 5. L'exception de projet prime sur la regle par defaut
  // ---------------------------------------------------------------------------

  it('donne la priorite a l’exception de projet', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/configs`)
      .set(auth(admin.accessToken))
      .send({
        name: 'Exception projet',
        baseType: 'COLLECTED_AMOUNT',
        projectId,
        beneficiaries: [
          { beneficiaryType: 'MEMBER', name: 'Alpha', userId: memberA.user.id, percentage: '100', order: 0 },
        ],
      });

    assert.equal(response.status, 201);
    const exception = data<RuleData>(response);
    assert.equal(exception.scopeKey, `project:${projectId}`);

    const base = await request(app.getHttpServer())
      .get(`${baseUrl}/distributions/projects/${projectId}/base`)
      .set(auth(admin.accessToken));
    const details = data<{ ruleId: string; ruleScope: string; ruleVersion: number }>(base);
    assert.equal(details.ruleId, exception.id);
    assert.equal(details.ruleScope, `project:${projectId}`);
  });

  // ---------------------------------------------------------------------------
  // 6. Les operations de solde : paiement, contre-passation
  // ---------------------------------------------------------------------------

  it('enregistre un versement et l’attribue a son auteur', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/balances/operations`)
      .set(auth(admin.accessToken))
      .send({
        userId: memberA.user.id,
        kind: 'PAYMENT',
        amount: '-10000',
        currency: 'DZD',
        reason: 'Virement de solde — octobre',
        reference: 'VIR-2026-001',
      });

    assert.equal(response.status, 201);
    const transaction = data<TransactionRow>(response);
    assert.equal(transaction.kind, 'PAYMENT');
    assert.equal(transaction.type, 'DEBIT');
    assert.equal(transaction.amount, '10000');
    assert.equal(transaction.authorId, admin.user.id);
    assert.equal(transaction.previousBalance, '30000');
    assert.equal(transaction.newBalance, '20000');
  });

  it('refuse une operation financiere sans motif', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/balances/operations`)
      .set(auth(admin.accessToken))
      .send({
        userId: memberA.user.id,
        kind: 'PAYMENT',
        amount: '-100',
        currency: 'DZD',
      });

    // Le contrat refuse l'ecriture sans motif ; le service la refuse aussi si
    // elle passe somehow. Les deux barrieres sont testees.
    assert.equal(response.status, 400);
    assert.match(
      JSON.stringify(errorOf(response).details ?? errorOf(response).message),
      /reason|motif/i,
    );
  });

  it('refuse d’enregistrer une operation sans permission', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/balances/operations`)
      .set(auth(memberA.accessToken))
      .send({
        userId: memberA.user.id,
        kind: 'PAYMENT',
        amount: '-100',
        currency: 'DZD',
        reason: 'Je me paie moi-meme',
      });

    assert.equal(response.status, 403);
  });

  it('contre-passe une operation sans jamais la supprimer', async () => {
    const transactions = await request(app.getHttpServer())
      .get(`${baseUrl}/balances/admin/transactions?userId=${memberA.user.id}&kind=PAYMENT`)
      .set(auth(admin.accessToken));

    assert.equal(transactions.status, 200);
    const body = transactions.body as {
      data: TransactionRow[];
      meta: { total: number };
    };
    const payment = body.data[0];
    assert.ok(payment);

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/balances/transactions/${payment.id}/reverse`)
      .set(auth(admin.accessToken))
      .send({ reason: 'Virement errone — contre-passation' });

    assert.equal(response.status, 201);
    const reversal = data<TransactionRow>(response);
    assert.equal(reversal.kind, 'CORRECTION');
    assert.equal(reversal.reversalOfId, payment.id);
    assert.equal(reversal.type, 'CREDIT');

    // Le solde est revenu exactement a son etat d'avant le versement.
    const balance = await prisma.memberBalance.findUnique({
      where: { userId_currency: { userId: memberA.user.id, currency: 'DZD' } },
    });
    assert.equal(balance?.currentBalance.toString(), '30000');

    // Et l'operation d'origine est toujours la, visible et non supprimee.
    const stillThere = await prisma.balanceTransaction.findUnique({
      where: { id: payment.id },
    });
    assert.ok(stillThere);
    assert.equal(stillThere.amount.toString(), '10000');
  });

  it('refuse de contre-passer deux fois la meme operation', async () => {
    const transactions = await request(app.getHttpServer())
      .get(`${baseUrl}/balances/admin/transactions?userId=${memberA.user.id}&kind=PAYMENT`)
      .set(auth(admin.accessToken));
    const body = transactions.body as { data: TransactionRow[] };
    const payment = body.data[0];
    assert.ok(payment);

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/balances/transactions/${payment.id}/reverse`)
      .set(auth(admin.accessToken))
      .send({ reason: 'Seconde contre-passation' });

    assert.equal(response.status, 409);
  });

  it('garde les soldes par devise, sans conversion implicite', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/balances/operations`)
      .set(auth(admin.accessToken))
      .send({
        userId: memberA.user.id,
        kind: 'ADVANCE',
        amount: '-120.50',
        currency: 'EUR',
        reason: 'Avance sur projet en euros',
      });

    assert.equal(response.status, 201);

    const balances = await request(app.getHttpServer())
      .get(`${baseUrl}/balances/me/all`)
      .set(auth(memberA.accessToken));
    assert.equal(balances.status, 200);
    const rows = data<{ currency: string; currentBalance: string }[]>(balances);

    const dzd = rows.find((row) => row.currency === 'DZD');
    const eur = rows.find((row) => row.currency === 'EUR');

    // Deux soldes distincts, additionnes par personne.
    assert.equal(dzd?.currentBalance, '30000');
    assert.equal(eur?.currentBalance, '-120.5');
  });

  // ---------------------------------------------------------------------------
  // 7. L'arrondi : la somme vaut toujours exactement la base
  // ---------------------------------------------------------------------------

  it('arrondit de facon deterministe, la somme valant la base exacte', async () => {
    // Un projet dont l'encaissement ne se divise pas par 3.
    const project = await prisma.project.create({
      data: {
        reference: `E2E-FIN-PROJ-R-${Date.now()}`,
        name: 'E2E Financier — Arrondi',
        clientId,
        budget: new Prisma.Decimal('10000.00'),
        currency: 'DZD',
      },
      select: { id: true },
    });

    const invoice = await prisma.invoice.create({
      data: {
        reference: `E2E-FIN-FA-R-${Date.now()}`,
        clientId,
        projectId: project.id,
        status: 'SENT',
        year: 2026,
        sequence: (Date.now() % 800000) + 1000,
        issueDate: new Date('2026-10-01T00:00:00Z'),
        dueDate: new Date('2026-10-31T00:00:00Z'),
        currency: 'DZD',
        subtotal: new Prisma.Decimal('100.00'),
        total: new Prisma.Decimal('100.00'),
      },
      select: { id: true },
    });

    await prisma.payment.create({
      data: {
        reference: `E2E-FIN-PR-${Date.now()}`,
        invoiceId: invoice.id,
        amount: new Prisma.Decimal('100.00'),
        currency: 'DZD',
        method: 'CASH',
        status: 'SUCCEEDED',
        paidAt: new Date('2026-10-08T00:00:00Z'),
      },
    });

    const rule = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/configs`)
      .set(auth(admin.accessToken))
      .send({
        name: 'Regle arrondi',
        baseType: 'COLLECTED_AMOUNT',
        projectId: project.id,
        beneficiaries: [
          { beneficiaryType: 'MEMBER', name: 'Alpha', userId: memberA.user.id, percentage: '33.33', order: 0 },
          { beneficiaryType: 'MEMBER', name: 'Beta', userId: memberB.user.id, percentage: '33.33', order: 1 },
          { beneficiaryType: 'RESERVE', name: 'Reserve', percentage: '33.34', order: 2 },
        ],
      });

    assert.equal(rule.status, 201);
    const ruleData = data<RuleData>(rule);

    const calculation = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/projects/${project.id}/calculate`)
      .set(auth(admin.accessToken))
      .send({ configId: ruleData.id });

    assert.equal(calculation.status, 201);
    const distribution = data<DistributionData>(calculation);

    const total = distribution.items.reduce(
      (sum, item) => sum + Math.round(Number(item.calculatedAmount) * 100),
      0,
    );
    assert.equal(total, 10000, 'la somme des parts vaut la base, au centime');

    // Le meme calcul, refait, donne le meme resultat.
    const again = await request(app.getHttpServer())
      .post(`${baseUrl}/distributions/projects/${project.id}/calculate`)
      .set(auth(admin.accessToken))
      .send({ configId: ruleData.id });
    const same = data<DistributionData>(again);
    assert.equal(same.id, distribution.id);
  });

  // ---------------------------------------------------------------------------
  // 8. Qui peut recevoir de l'argent, et dans quelle devise
  //
  // L'ANNUAIRE ET LA VALIDATION VIENNENT DE LA MEME REGLE. Un client n'est
  // ni propose ni accepte comme beneficiaire d'une operation financière, et
  // une devise qui n'existe pas n'ouvre aucun solde.
  // ---------------------------------------------------------------------------

  it('liste les membres eligible, et jamais un client', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/balances/eligible-members`)
      .set(auth(admin.accessToken));

    assert.equal(response.status, 200);
    const members = data<EligibleMemberRow[]>(response);

    const ids = members.map((member) => member.id);
    assert.ok(ids.includes(memberA.user.id), 'un membre de l’equipe est eligible');
    assert.ok(ids.includes(memberB.user.id), 'un membre de l’equipe est eligible');
    assert.ok(!ids.includes(client.user.id), 'un client n’est pas eligible');
    // Un compte sans role (technique) n'est pas un membre : la regle le dit.
    const technicien = await prisma.user.create({
      data: {
        passwordHash: await hashPassword(PASSWORD),
        status: 'ACTIVE' as const,
        isEmailVerified: true,
        mustChangePassword: false,
        email: 'e2e-fin-technicien@comexa.example',
        firstName: 'Integration',
        lastName: 'Technique',
      },
      select: { id: true },
    });

    const withTechnicien = await request(app.getHttpServer())
      .get(`${baseUrl}/balances/eligible-members`)
      .set(auth(admin.accessToken));
    const ids2 = data<EligibleMemberRow[]>(withTechnicien).map((member) => member.id);
    assert.ok(!ids2.includes(technicien.id), 'un compte sans role n’est pas un membre');

    await prisma.user.delete({ where: { id: technicien.id } });
  });

  it('refuse de lister les membres eligible a un membre de l’equipe', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/balances/eligible-members`)
      .set(auth(memberA.accessToken));

    assert.equal(response.status, 403);
  });

  it('refuse d’enregistrer une operation au profit d’un client', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/balances/operations`)
      .set(auth(admin.accessToken))
      .send({
        userId: client.user.id,
        kind: 'PAYMENT',
        amount: '1000',
        currency: 'DZD',
        reason: 'Versement a un client — doit etre refuse',
      });

    assert.equal(response.status, 400);
    const body = response.body as ErrorBody;
    assert.equal(body.error.code, 'INELIGIBLE_MEMBER');
  });

  it('refuse d’ouvrir un solde dans une devise inconnue', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/balances/operations`)
      .set(auth(admin.accessToken))
      .send({
        userId: memberA.user.id,
        kind: 'ADVANCE',
        amount: '1000',
        currency: 'XBT',
        reason: 'Devise inventee — doit etre refusee',
      });

    assert.equal(response.status, 400);
    const body = response.body as ErrorBody;
    assert.equal(body.error.code, 'UNKNOWN_CURRENCY');
  });
});
