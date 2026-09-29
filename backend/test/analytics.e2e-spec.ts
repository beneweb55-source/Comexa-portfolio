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
 * RAPPORTS, TABLEAUX DE BORD ET PARAMETRES — BOUT EN BOUT, SUR LA VRAIE BASE.
 *
 * Ce fichier ne simule rien : il demarre l'application complete avec le MEME
 * `configureApp` que `main.ts`, et parle en HTTP. Les requetes traversent donc
 * reellement la chaine : ThrottlerGuard, JwtAuthGuard, PermissionsGuard,
 * ValidationPipe (whitelist + forbidNonWhitelisted), controleur, service, Prisma,
 * filtre d'exceptions et intercepteur d'enveloppe.
 *
 * LA PROPRIETE QUE CE FICHIER DEFEND, ET QUI JUSTIFIE SA LONGUEUR :
 *
 *   un porteur de l'espace client ne recoit QUE ses chiffres, et ne peut pas
 *   en designer d'autres.
 *
 * « Ne te limite pas a cacher des boutons cote frontend » et « un client ne doit
 * jamais pouvoir modifier l'ID d'un autre client dans une requete pour acceder a
 * ses donnees » : ces deux phrases se verifient ici et nulle part ailleurs. Le
 * test ne se contente pas de comparer des totaux — il cherche les donnees du
 * client B dans TOUT le corps de la reponse servie au client A, parce qu'un total
 * juste peut cacher une ligne de trop.
 *
 * COMMENT LES CHIFFRES RESTENT COMPARABLES ALORS QUE LA BASE EST PARTAGEE.
 * Toutes les assertions de montant portent sur des donnees filtrees par
 * `clientId`, donc exactes quel que soit le reste de la base. Pour les agregats
 * GLOBAUX — encaissements d'agence, rapport de revenus — la monnaie de test est
 * `XTS`, code ISO 4217 reserve aux tests, que personne d'autre n'utilise : le
 * total de cette devise est donc exactement le mien, meme dans une somme qui
 * couvre toute la base. Les autres totaux globaux ne sont jamais compares a une
 * constante : ils sont seulement verifies en FORME (une chaine a deux decimales,
 * un nombre, un tableau borne).
 *
 * ATTENTION AU LIMITEUR DE DEBIT : la connexion est plafonnee a 10 appels par
 * minute et par adresse IP. Ce fichier ouvre QUATRE sessions (deux clients, un
 * administrateur, un chef de projet) et les reutilise pour toutes les
 * assertions. En ajouter une cinquieme sans regarder ce compteur produirait des
 * echecs a 429, intermittents et difficiles a lire.
 *
 * CE FICHIER EST COMPILE AVANT D'ETRE EXECUTE (`npm run build:e2e`) : `tsx`
 * s'appuie sur esbuild, qui n'emet pas la metadonnee `design:paramtypes` dont
 * Nest a besoin pour l'injection par constructeur.
 *
 * PREREQUIS : ReportsModule, DashboardModule et SettingsModule montes dans
 * `app.module.ts`, sous le prefixe `/api`. Tant qu'ils ne le sont pas, ce fichier
 * echoue des le premier appel — c'est attendu, et c'est le signal que le montage
 * reste a faire.
 */

const PASSWORD = 'Analytique-Boussole-31-Rivage';

const EMAIL_CLIENT_A = 'e2e-analytics-client-a@comexa.example';
const EMAIL_CLIENT_B = 'e2e-analytics-client-b@comexa.example';
const EMAIL_ADMIN = 'e2e-analytics-admin@comexa.example';
const EMAIL_PM = 'e2e-analytics-pm@comexa.example';

/** Prefixe de toutes les references creees ici : le nettoyage s'y accroche. */
const REF_PREFIX = 'E2E-AN-';

/**
 * Devise de test : `XTS` est le code ISO 4217 reserve aux tests.
 *
 * C'est ce qui rend un agregat GLOBAL verifiable : le total de cette devise dans
 * la reponse est exactement le mien, meme si la base contient des milliers
 * d'autres lignes en euros.
 */
const TEST_CURRENCY = 'XTS';

/**
 * Annee de numerotation isolee.
 *
 * `@@unique([year, sequence])` interdit de reutiliser un couple existant : en
 * prenant une annee que les pieces reelles n'utilisent pas, ce test ne peut
 * entrer en collision avec aucune autre donnee.
 */
const TEST_YEAR = 2999;

const SETTING_PUBLIC_KEY = 'e2e_analytics.company_name';
const SETTING_PUBLIC_VALUE = 'Analytique SARL';
const SETTING_INTERNAL_KEY = 'e2e_analytics.api_token';
const SETTING_INTERNAL_VALUE = 'jeton-de-test-analytique';

const REPORT_TITLE = 'E2E analytique point mensuel';

const INTERNAL_DOCUMENT_NAME = 'Note interne Alpha';
const CLIENT_A_DOCUMENT_NAME = 'Contrat Alpha';
const CLIENT_A_TASK_TITLE = 'Cadrage analytique';

const DAY = 86_400_000;

/** UUID bien forme mais inexistant : passe la validation, echoue a la lecture. */
const UNKNOWN_PROJECT_ID = '00000000-0000-4000-8000-000000000000';

interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details: unknown };
}

interface LoginData {
  accessToken: string;
  user: {
    id: string;
    email: string;
    roles: string[];
    permissions: string[];
    clientId: string | null;
  };
}

interface CurrencyAmountView {
  currency: string;
  total: string;
  count: number;
}

interface AmountSectionView {
  currency: string;
  total: string;
  count: number;
  byCurrency: CurrencyAmountView[];
}

interface CollectedSectionView extends AmountSectionView {
  byMethod: { method: string; currency: string; total: string; count: number }[];
}

interface ClientDashboardView {
  asOf: string;
  client: { id: string; reference: string; companyName: string };
  sections: {
    projects: boolean;
    invoices: boolean;
    quotes: boolean;
    documents: boolean;
    notifications: boolean;
  };
  projects: {
    total: number;
    active: number;
    averageProgress: number;
    items: {
      id: string;
      reference: string;
      name: string;
      status: string;
      progressPercent: number;
    }[];
  } | null;
  milestones: { total: number; reached: number; overdue: number } | null;
  invoices: {
    open: AmountSectionView;
    overdue: AmountSectionView;
    paid: AmountSectionView;
    items: { id: string; reference: string; status: string; outstanding: string }[];
  } | null;
  quotes: { total: number; pending: number; accepted: number } | null;
  documents: { total: number; items: { id: string; name: string; visibility: string }[] } | null;
  notifications: { unread: number } | null;
}

interface AgencyDashboardView {
  asOf: string;
  period: { periodStart: string; periodEnd: string };
  prospects: { total: number; open: number; byStatus: { status: string; count: number }[] };
  projects: { total: number; active: number; averageProgress: number };
  tasks: { total: number; open: number; overdue: number };
  invoices: {
    open: AmountSectionView;
    overdue: AmountSectionView;
    issuedInPeriod: AmountSectionView;
  };
  collected: CollectedSectionView;
  collectionRate: number;
  upcoming: {
    tasks: { id: string; title: string; dueDate: string | null }[];
    invoices: { id: string; reference: string; outstanding: string }[];
  };
}

interface PersonalDashboardView {
  asOf: string;
  sections: { tasks: boolean; timeEntries: boolean; notifications: boolean };
  tasks: { total: number; open: number; overdue: number } | null;
  upcoming: { id: string; title: string; dueDate: string | null }[] | null;
  timeEntries: { todayMinutes: number; monthMinutes: number; monthEntries: number } | null;
  notifications: { unread: number; recent: unknown[] } | null;
}

interface ReportDetailView {
  id: string;
  type: string;
  title: string;
  status: string;
  format: string;
  periodStart: string | null;
  periodEnd: string | null;
  result: {
    collected?: CollectedSectionView;
    collectionRate?: number;
    billed?: AmountSectionView;
  } | null;
  snapshot: unknown;
}

interface SettingsListView {
  settings: { key: string; value: unknown; internal: boolean }[];
  total: number;
}

interface SettingsUpdateView {
  settings: { key: string; value: unknown }[];
  updated: string[];
  unchanged: string[];
}

function errorOf(response: request.Response): ErrorBody['error'] {
  const body = response.body as ErrorBody;
  assert.equal(body.success, false, "une reponse d'echec doit porter success: false");
  return body.error;
}

/** Le montant d'une devise dans une section, ou `undefined` si elle est absente. */
function amountOf(section: AmountSectionView, currency: string): CurrencyAmountView | undefined {
  return section.byCurrency.find((row) => row.currency === currency);
}

describe('Rapports, tableaux de bord et parametres (bout en bout, base reelle)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  let clientAId = '';
  let clientBId = '';
  let projectA1Id = '';
  let invoiceAOpenId = '';
  let reportId = '';
  let adminUserId = '';

  const userIds: string[] = [];

  let clientAToken = '';
  let clientBToken = '';
  let adminToken = '';
  let pmToken = '';

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

    const [adminRole, pmRole, clientRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'PROJECT_MANAGER' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'CLIENT' }, select: { id: true } }),
    ]);

    const passwordHash = await hashPassword(PASSWORD);
    const now = new Date();

    // Nettoyage preventif : un run precedent interrompu a pu laisser ses lignes.
    // Les references, les adresses et les cles de parametre sont propres a ce
    // fichier, donc cette suppression ne peut pas atteindre la donnee d'un autre
    // test. Meme ordre que le nettoyage final, et pour la meme raison.
    await prisma.payment.deleteMany({ where: { reference: { startsWith: REF_PREFIX } } });
    await prisma.document.deleteMany({ where: { storageKey: { startsWith: REF_PREFIX } } });
    await prisma.task.deleteMany({ where: { project: { reference: { startsWith: REF_PREFIX } } } });
    await prisma.milestone.deleteMany({
      where: { project: { reference: { startsWith: REF_PREFIX } } },
    });
    await prisma.invoice.deleteMany({ where: { reference: { startsWith: REF_PREFIX } } });
    await prisma.quote.deleteMany({ where: { reference: { startsWith: REF_PREFIX } } });
    await prisma.report.deleteMany({ where: { title: REPORT_TITLE } });
    await prisma.project.deleteMany({ where: { reference: { startsWith: REF_PREFIX } } });
    await prisma.setting.deleteMany({
      where: { key: { in: [SETTING_PUBLIC_KEY, SETTING_INTERNAL_KEY] } },
    });
    // Seulement MES cles de parametre : un journal d'audit ne se nettoie pas par
    // type d'action, sinon ce test effacerait la trace de rapports produits par
    // d'autres — un journal qu'on peut effacer par un filtre n'est plus un
    // journal.
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [SETTING_PUBLIC_KEY, SETTING_INTERNAL_KEY] } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [EMAIL_CLIENT_A, EMAIL_CLIENT_B, EMAIL_ADMIN, EMAIL_PM] } },
    });
    await prisma.client.deleteMany({ where: { reference: { startsWith: REF_PREFIX } } });

    const clientA = await prisma.client.create({
      data: { reference: `${REF_PREFIX}CLI-A`, companyName: 'Analytique Alpha' },
      select: { id: true },
    });
    const clientB = await prisma.client.create({
      data: { reference: `${REF_PREFIX}CLI-B`, companyName: 'Analytique Beta' },
      select: { id: true },
    });
    clientAId = clientA.id;
    clientBId = clientB.id;

    const admin = await prisma.user.create({
      data: {
        email: EMAIL_ADMIN,
        passwordHash,
        firstName: 'Analytique',
        lastName: 'Administrateur',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        roles: { create: { roleId: adminRole.id } },
      },
      select: { id: true },
    });
    const pm = await prisma.user.create({
      data: {
        email: EMAIL_PM,
        passwordHash,
        firstName: 'Analytique',
        lastName: 'Chef de projet',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        roles: { create: { roleId: pmRole.id } },
      },
      select: { id: true },
    });
    const portalA = await prisma.user.create({
      data: {
        email: EMAIL_CLIENT_A,
        passwordHash,
        firstName: 'Portail',
        lastName: 'Alpha',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        // Le rattachement dont decoule TOUT le perimetre de l'espace client.
        clientId: clientA.id,
        roles: { create: { roleId: clientRole.id } },
      },
      select: { id: true },
    });
    const portalB = await prisma.user.create({
      data: {
        email: EMAIL_CLIENT_B,
        passwordHash,
        firstName: 'Portail',
        lastName: 'Beta',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        clientId: clientB.id,
        roles: { create: { roleId: clientRole.id } },
      },
      select: { id: true },
    });

    adminUserId = admin.id;
    userIds.push(admin.id, pm.id, portalA.id, portalB.id);

    // --- Projets : un actif, un termine — pour que « actif » ne soit pas « total ».
    const projectA1 = await prisma.project.create({
      data: {
        reference: `${REF_PREFIX}PRJ-A1`,
        name: 'Refonte portail Alpha',
        clientId: clientA.id,
        status: 'IN_PROGRESS',
        health: 'ON_TRACK',
        progressPercent: 40,
        currency: 'EUR',
        startDate: new Date(now.getTime() - 20 * DAY),
        dueDate: new Date(now.getTime() + 10 * DAY),
        managerId: pm.id,
        createdById: admin.id,
      },
      select: { id: true },
    });
    projectA1Id = projectA1.id;

    await prisma.project.create({
      data: {
        reference: `${REF_PREFIX}PRJ-A2`,
        name: 'Maintenance Alpha',
        clientId: clientA.id,
        status: 'COMPLETED',
        progressPercent: 100,
        completedAt: new Date(now.getTime() - 5 * DAY),
        createdById: admin.id,
      },
      select: { id: true },
    });

    await prisma.project.create({
      data: {
        reference: `${REF_PREFIX}PRJ-B1`,
        name: 'Application Beta',
        clientId: clientB.id,
        status: 'IN_PROGRESS',
        progressPercent: 10,
        createdById: admin.id,
      },
      select: { id: true },
    });

    // --- Jalon en retard, pour que « en retard » soit reellement teste.
    await prisma.milestone.create({
      data: {
        projectId: projectA1.id,
        title: 'Cadrage livre',
        status: 'PENDING',
        dueDate: new Date(now.getTime() - 3 * DAY),
      },
    });

    // --- Factures du client A : un encours, un deja regle, un en retard.
    const invoiceAOpen = await prisma.invoice.create({
      data: {
        reference: `${REF_PREFIX}INV-A1`,
        year: TEST_YEAR,
        sequence: 9101,
        clientId: clientA.id,
        projectId: projectA1.id,
        status: 'SENT',
        issueDate: now,
        dueDate: new Date(now.getTime() + 15 * DAY),
        currency: 'EUR',
        subtotal: '1000.00',
        total: '1000.00',
        amountPaid: '250.00',
        createdById: admin.id,
      },
      select: { id: true },
    });
    invoiceAOpenId = invoiceAOpen.id;

    await prisma.invoice.create({
      data: {
        reference: `${REF_PREFIX}INV-A2`,
        year: TEST_YEAR,
        sequence: 9102,
        clientId: clientA.id,
        status: 'PAID',
        issueDate: new Date(now.getTime() - 40 * DAY),
        dueDate: new Date(now.getTime() - 25 * DAY),
        paidAt: new Date(now.getTime() - 20 * DAY),
        currency: 'EUR',
        subtotal: '500.00',
        total: '500.00',
        amountPaid: '500.00',
        createdById: admin.id,
      },
      select: { id: true },
    });

    await prisma.invoice.create({
      data: {
        reference: `${REF_PREFIX}INV-A3`,
        year: TEST_YEAR,
        sequence: 9103,
        clientId: clientA.id,
        status: 'OVERDUE',
        issueDate: new Date(now.getTime() - 30 * DAY),
        dueDate: new Date(now.getTime() - 10 * DAY),
        currency: 'EUR',
        subtotal: '100.00',
        total: '100.00',
        amountPaid: '0.00',
        createdById: admin.id,
      },
      select: { id: true },
    });

    await prisma.invoice.create({
      data: {
        reference: `${REF_PREFIX}INV-B1`,
        year: TEST_YEAR,
        sequence: 9201,
        clientId: clientB.id,
        status: 'SENT',
        issueDate: now,
        dueDate: new Date(now.getTime() + 5 * DAY),
        currency: 'EUR',
        subtotal: '9999.00',
        total: '9999.00',
        amountPaid: '0.00',
        createdById: admin.id,
      },
      select: { id: true },
    });

    // --- Encaissement : la SEULE source du chiffre d'affaires.
    await prisma.payment.create({
      data: {
        reference: `${REF_PREFIX}PAY-A1`,
        invoiceId: invoiceAOpen.id,
        amount: '500.00',
        currency: TEST_CURRENCY,
        method: 'BANK_TRANSFER',
        status: 'SUCCEEDED',
        paidAt: now,
        receivedById: admin.id,
      },
    });

    // --- Devis
    await prisma.quote.create({
      data: {
        reference: `${REF_PREFIX}QUO-A1`,
        year: TEST_YEAR,
        sequence: 9101,
        clientId: clientA.id,
        subject: 'Devis refonte Alpha',
        status: 'SENT',
        issueDate: now,
        validUntil: new Date(now.getTime() + 30 * DAY),
        currency: 'EUR',
        subtotal: '12000.00',
        total: '12000.00',
        createdById: admin.id,
      },
    });

    // --- Documents : un visible, un INTERNE. Le second ne doit JAMAIS sortir.
    await prisma.document.create({
      data: {
        name: CLIENT_A_DOCUMENT_NAME,
        originalName: 'contrat-alpha.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        storageKey: `${REF_PREFIX}DOC-A1`,
        category: 'CONTRACT',
        visibility: 'CLIENT',
        clientId: clientA.id,
        projectId: projectA1.id,
        uploadedById: admin.id,
      },
    });

    await prisma.document.create({
      data: {
        name: INTERNAL_DOCUMENT_NAME,
        originalName: 'note-interne-alpha.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        storageKey: `${REF_PREFIX}DOC-A2`,
        category: 'OTHER',
        // Contrepartie en base de « un client ne voit jamais les documents
        // internes ». Le test la cherche dans la reponse servie au client.
        visibility: 'INTERNAL',
        clientId: clientA.id,
        projectId: projectA1.id,
        uploadedById: admin.id,
      },
    });

    await prisma.document.create({
      data: {
        name: 'Contrat Beta',
        originalName: 'contrat-beta.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 512,
        storageKey: `${REF_PREFIX}DOC-B1`,
        category: 'CONTRACT',
        visibility: 'CLIENT',
        clientId: clientB.id,
        uploadedById: admin.id,
      },
    });

    // --- Taches assignees a l'administrateur : ce compte est cree par ce test,
    //     donc la vue personnelle est verifiable au chiffre exact.
    await prisma.task.create({
      data: {
        projectId: projectA1.id,
        title: CLIENT_A_TASK_TITLE,
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        assigneeId: admin.id,
        reporterId: pm.id,
        dueDate: new Date(now.getTime() + 3 * DAY),
      },
    });

    await prisma.task.create({
      data: {
        projectId: projectA1.id,
        title: 'Reprise des donnees',
        status: 'TODO',
        priority: 'NORMAL',
        assigneeId: admin.id,
        dueDate: new Date(now.getTime() - 2 * DAY),
      },
    });

    // --- Sessions : QUATRE connexions, reutilisees ensuite. Voir l'entete.
    const login = async (email: string): Promise<LoginData> => {
      const response = await request(app.getHttpServer())
        .post(`${baseUrl}/auth/login`)
        .send({ email, password: PASSWORD });
      assert.equal(response.status, 200, `connexion impossible pour ${email}`);
      return (response.body as SuccessBody<LoginData>).data;
    };

    const sessionA = await login(EMAIL_CLIENT_A);
    const sessionB = await login(EMAIL_CLIENT_B);
    const sessionAdmin = await login(EMAIL_ADMIN);
    const sessionPm = await login(EMAIL_PM);

    clientAToken = sessionA.accessToken;
    clientBToken = sessionB.accessToken;
    adminToken = sessionAdmin.accessToken;
    pmToken = sessionPm.accessToken;

    // Preconditions du perimetre : si le jeton ne portait pas le rattachement
    // client, le refus viendrait du service et le test mesurerait autre chose que
    // ce qu'il croit mesurer.
    assert.equal(
      sessionA.user.clientId,
      clientAId,
      'le jeton du client A doit porter son clientId',
    );
    assert.equal(
      sessionB.user.clientId,
      clientBId,
      'le jeton du client B doit porter son clientId',
    );
    assert.ok(sessionA.user.permissions.includes('dashboard:read:own'));
    assert.ok(sessionAdmin.user.permissions.includes('dashboard:read:any'));
    assert.ok(sessionAdmin.user.permissions.includes('report:generate:any'));
    assert.ok(sessionAdmin.user.permissions.includes('setting:write:any'));
    assert.ok(
      sessionPm.user.permissions.includes('setting:read:any'),
      'le chef de projet doit pouvoir LIRE les parametres, sinon le scenario ne prouve rien',
    );
    assert.equal(
      sessionPm.user.permissions.includes('setting:write:any'),
      false,
      'le chef de projet ne doit PAS pouvoir ecrire les parametres',
    );
  });

  after(async () => {
    if (!app) {
      return;
    }

    // ORDRE IMPOSE PAR LES CLES ETRANGERES, et il n'est pas symetrique.
    //
    // Les pieces d'abord : elles dependent des projets, des factures et des
    // comptes. Puis les projets, que les comptes ont crees. Puis les comptes —
    // mais surtout AVANT les clients, parce qu'un compte portail porte un
    // `clientId` : supprimer la fiche client d'abord ferait echouer la
    // suppression des comptes, et le nettoyage laisserait tout en place en
    // silence. Le client vient donc en dernier.
    await prisma.payment.deleteMany({ where: { reference: { startsWith: REF_PREFIX } } });
    await prisma.document.deleteMany({ where: { storageKey: { startsWith: REF_PREFIX } } });
    await prisma.task.deleteMany({ where: { project: { reference: { startsWith: REF_PREFIX } } } });
    await prisma.milestone.deleteMany({
      where: { project: { reference: { startsWith: REF_PREFIX } } },
    });
    await prisma.invoice.deleteMany({ where: { reference: { startsWith: REF_PREFIX } } });
    await prisma.quote.deleteMany({ where: { reference: { startsWith: REF_PREFIX } } });
    await prisma.report.deleteMany({
      where: { OR: [{ generatedById: { in: userIds } }, { title: REPORT_TITLE }] },
    });
    await prisma.project.deleteMany({ where: { reference: { startsWith: REF_PREFIX } } });
    await prisma.setting.deleteMany({
      where: { key: { in: [SETTING_PUBLIC_KEY, SETTING_INTERNAL_KEY] } },
    });

    // Les journaux d'audit ne partent pas en cascade : on les retire avant les
    // comptes, sinon `actorId` passe a NULL et la ligne devient orpheline.
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: userIds } },
          { entityId: { in: [...userIds, SETTING_PUBLIC_KEY, SETTING_INTERNAL_KEY] } },
        ],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.deleteMany({ where: { reference: { startsWith: REF_PREFIX } } });

    await app.close();
  });

  it("refuse l'acces sans jeton, avec l'enveloppe d'erreur du socle", async () => {
    const response = await request(app.getHttpServer()).get(`${baseUrl}/dashboard`);

    assert.equal(response.status, 401);
    assert.equal(errorOf(response).code, 'UNAUTHENTICATED');
  });

  it("refuse la vue d'agence a un porteur de l'espace client", async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/dashboard`)
      .set('Authorization', `Bearer ${clientAToken}`);

    assert.equal(response.status, 403);
    assert.equal(errorOf(response).code, 'FORBIDDEN');
  });

  it("refuse qu'un client designe un autre client dans la requete", async () => {
    // LE test de la phrase du cahier des charges : « un client ne doit jamais
    // pouvoir modifier l'ID d'un autre client dans une requete pour acceder a ses
    // donnees ». Le `clientId` n'existe dans aucun DTO : la requete est refusee
    // par le garde de validation, avant le service.
    const asOtherClient = await request(app.getHttpServer())
      .get(`${baseUrl}/dashboard/client`)
      .query({ clientId: clientBId })
      .set('Authorization', `Bearer ${clientAToken}`);

    assert.equal(asOtherClient.status, 400);
    assert.equal(errorOf(asOtherClient).code, 'VALIDATION_FAILED');
    assert.match(
      JSON.stringify(errorOf(asOtherClient).details),
      /clientId/,
      "le refus doit nommer le parametre refuse, sinon personne ne comprend l'erreur",
    );

    // Meme chose sur la vue personnelle : le refus ne doit pas dependre de la
    // route, et celle-ci est pourtant OUVERTE au client (elle porte sa vue
    // personnelle). C'est donc bien le parametre qui est refuse, pas le porteur.
    const onPersonal = await request(app.getHttpServer())
      .get(`${baseUrl}/dashboard/me`)
      .query({ clientId: clientBId })
      .set('Authorization', `Bearer ${clientAToken}`);

    assert.equal(onPersonal.status, 400);
    assert.equal(errorOf(onPersonal).code, 'VALIDATION_FAILED');

    // Sur la liste des rapports le refus arrive plus tot, et c'est instructif :
    // les GARDES s'executent avant le `ValidationPipe`. Un client ne detient
    // aucune permission `report:*`, il est donc arrete par le droit avant que le
    // parametre ne soit examine. Peu importe lequel des deux mecanismes repond :
    // les deux ferment la porte, et c'est le resultat qui compte.
    const onReports = await request(app.getHttpServer())
      .get(`${baseUrl}/reports`)
      .query({ clientId: clientBId })
      .set('Authorization', `Bearer ${clientAToken}`);

    assert.equal(onReports.status, 403);
    assert.equal(errorOf(onReports).code, 'FORBIDDEN');
  });

  it('sert a chaque client SES chiffres, et rien de ceux des autres', async () => {
    const responseA = await request(app.getHttpServer())
      .get(`${baseUrl}/dashboard/client`)
      .set('Authorization', `Bearer ${clientAToken}`);

    assert.equal(responseA.status, 200);
    const bodyA = responseA.body as SuccessBody<ClientDashboardView>;
    assert.equal(bodyA.success, true);

    // Le perimetre vient du JETON, pas de la requete.
    assert.equal(bodyA.data.client.id, clientAId);
    assert.equal(bodyA.data.client.companyName, 'Analytique Alpha');
    assert.deepEqual(bodyA.data.sections, {
      projects: true,
      invoices: true,
      quotes: true,
      documents: true,
      notifications: true,
    });

    // Projets : deux au total, un seul actif — un projet termine reste au
    // portefeuille mais n'est plus « actif ».
    assert.ok(bodyA.data.projects, 'la section projets doit etre servie');
    assert.equal(bodyA.data.projects.total, 2);
    assert.equal(bodyA.data.projects.active, 1);
    assert.equal(bodyA.data.projects.averageProgress, 70);

    // Le detail ne doit pas seulement compter juste : il doit contenir SES
    // projets, et le `health` interne n'y a pas sa place — un client n'a pas a
    // lire « hors trajectoire » sur son propre dossier.
    const ownProject = bodyA.data.projects.items.find((item) => item.id === projectA1Id);
    assert.ok(ownProject, 'le projet du client A doit figurer dans sa liste');
    assert.equal(ownProject.progressPercent, 40);
    assert.equal(
      Object.keys(ownProject).includes('health'),
      false,
      'le signal de pilotage interne ne doit pas sortir dans l espace client',
    );

    // Encours : 1000 - 250 (partiellement payee) + 100 (en retard) = 850.
    assert.ok(bodyA.data.invoices, 'la section factures doit etre servie');
    assert.equal(bodyA.data.invoices.open.total, '850.00');
    assert.equal(bodyA.data.invoices.open.count, 2);
    assert.equal(amountOf(bodyA.data.invoices.open, 'EUR')?.total, '850.00');

    // En retard : seule l'echeance depassee, et c'est un sous-ensemble de l'encours.
    assert.equal(bodyA.data.invoices.overdue.total, '100.00');
    assert.equal(bodyA.data.invoices.overdue.count, 1);

    // Deja regle : le montant REELLEMENT paye, pas le montant facture.
    assert.equal(bodyA.data.invoices.paid.total, '500.00');
    assert.equal(bodyA.data.invoices.paid.count, 1);

    // Jalons : un seul, en retard.
    assert.ok(bodyA.data.milestones);
    assert.equal(bodyA.data.milestones.total, 1);
    assert.equal(bodyA.data.milestones.overdue, 1);
    assert.equal(bodyA.data.milestones.reached, 0);

    // Devis : un en attente de decision.
    assert.ok(bodyA.data.quotes);
    assert.equal(bodyA.data.quotes.total, 1);
    assert.equal(bodyA.data.quotes.pending, 1);

    // Documents : le visible seulement. L'interne existe, et ne doit pas sortir.
    assert.ok(bodyA.data.documents);
    assert.equal(bodyA.data.documents.total, 1);
    assert.equal(bodyA.data.documents.items.length, 1);
    assert.equal(bodyA.data.documents.items[0]?.name, CLIENT_A_DOCUMENT_NAME);
    assert.equal(bodyA.data.documents.items[0]?.visibility, 'CLIENT');

    // Et la recherche qui ne pardonne pas : AUCUNE donnee du client B, ou qu'elle
    // se cache dans la reponse.
    const serializedA = JSON.stringify(responseA.body);
    for (const forbidden of [clientBId, 'Analytique Beta', 'Application Beta', 'Contrat Beta']) {
      assert.equal(
        serializedA.includes(forbidden),
        false,
        `la reponse du client A ne doit pas contenir « ${forbidden} »`,
      );
    }
    assert.equal(
      serializedA.includes(INTERNAL_DOCUMENT_NAME),
      false,
      'un document INTERNAL ne doit jamais atteindre un client',
    );

    // --- Et symetriquement, le client B ne voit que les siens.
    const responseB = await request(app.getHttpServer())
      .get(`${baseUrl}/dashboard/client`)
      .set('Authorization', `Bearer ${clientBToken}`);

    assert.equal(responseB.status, 200);
    const bodyB = responseB.body as SuccessBody<ClientDashboardView>;
    assert.equal(bodyB.data.client.id, clientBId);
    assert.ok(bodyB.data.invoices);
    assert.equal(bodyB.data.invoices.open.total, '9999.00');
    assert.equal(bodyB.data.invoices.open.count, 1);
    assert.equal(bodyB.data.documents?.total, 1);

    const serializedB = JSON.stringify(responseB.body);
    for (const forbidden of [
      clientAId,
      'Analytique Alpha',
      'Refonte portail Alpha',
      'Contrat Alpha',
    ]) {
      assert.equal(
        serializedB.includes(forbidden),
        false,
        `la reponse du client B ne doit pas contenir « ${forbidden} »`,
      );
    }
  });

  it('donne a un client sa vue personnelle, sans lui ouvrir de section interne', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/dashboard/me`)
      .set('Authorization', `Bearer ${clientAToken}`);

    // La route doit etre OUVERTE a un client : elle porte sa vue personnelle.
    assert.equal(response.status, 200);

    const body = response.body as SuccessBody<PersonalDashboardView>;
    assert.deepEqual(body.data.sections, {
      tasks: false,
      timeEntries: false,
      notifications: true,
    });
    assert.equal(body.data.tasks, null, 'un client ne doit pas recevoir de taches internes');
    assert.equal(body.data.timeEntries, null);
    assert.equal(body.data.upcoming, null);
    assert.equal(body.data.notifications?.unread, 0);

    // Le controle qui compte : aucune donnee interne ne fuit par cette route.
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [CLIENT_A_TASK_TITLE, INTERNAL_DOCUMENT_NAME, 'Reprise des donnees']) {
      assert.equal(serialized.includes(forbidden), false, `« ${forbidden} » ne doit pas sortir`);
    }
  });

  it("sert la vue d'agence a un compte interne, encaissements compris", async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/dashboard`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(response.status, 200);
    const body = response.body as SuccessBody<AgencyDashboardView>;

    // Forme : ce sont des dates et des nombres, jamais `null` ni `NaN`.
    assert.ok(!Number.isNaN(Date.parse(body.data.asOf)));
    assert.ok(!Number.isNaN(Date.parse(body.data.period.periodStart)));
    assert.ok(!Number.isNaN(Date.parse(body.data.period.periodEnd)));
    assert.ok(Number.isInteger(body.data.projects.averageProgress));
    assert.ok(Array.isArray(body.data.prospects.byStatus));
    assert.match(body.data.invoices.open.total, /^\d+\.\d{2}$/);
    assert.match(body.data.collected.total, /^\d+\.\d{2}$/);
    assert.ok(body.data.collectionRate >= 0);

    // L'encaissement de la periode : la devise de test isole mon chiffre du reste
    // de la base, donc il est exact.
    assert.equal(amountOf(body.data.collected, TEST_CURRENCY)?.total, '500.00');
    assert.equal(amountOf(body.data.collected, TEST_CURRENCY)?.count, 1);

    // Le detail par moyen de paiement doit porter la meme somme que le total.
    const byMethod = body.data.collected.byMethod.find(
      (row) => row.currency === TEST_CURRENCY && row.method === 'BANK_TRANSFER',
    );
    assert.ok(byMethod, 'le detail par moyen de paiement doit contenir le virement de test');
    assert.equal(byMethod.total, '500.00');

    // Les listes d'echeances sont bornees : un tableau de bord n'est pas un export.
    assert.ok(body.data.upcoming.tasks.length <= 5);
    assert.ok(body.data.upcoming.invoices.length <= 5);
    assert.ok(body.data.upcoming.tasks.length >= 1, 'la tache a echeance proche doit remonter');

    // Periode invalide : refusee, jamais devinee.
    const invalid = await request(app.getHttpServer())
      .get(`${baseUrl}/dashboard`)
      .query({ preset: 'PAS_UNE_PERIODE' })
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(invalid.status, 400);
    assert.equal(errorOf(invalid).code, 'VALIDATION_FAILED');
  });

  it("sert la vue personnelle d'un membre de l'equipe, et seulement la sienne", async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/dashboard/me`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(response.status, 200);
    const body = response.body as SuccessBody<PersonalDashboardView>;

    assert.deepEqual(body.data.sections, {
      tasks: true,
      timeEntries: true,
      notifications: true,
    });

    // Le compte est cree par ce test : les compteurs sont donc exacts.
    assert.ok(body.data.tasks);
    assert.equal(body.data.tasks.total, 2);
    assert.equal(body.data.tasks.open, 2);
    assert.equal(body.data.tasks.overdue, 1);

    assert.ok(body.data.upcoming, 'la vue personnelle doit servir les echeances a venir');
    assert.equal(body.data.upcoming.length, 1);
    assert.equal(body.data.upcoming[0]?.title, CLIENT_A_TASK_TITLE);

    assert.ok(body.data.timeEntries);
    assert.equal(body.data.timeEntries.monthEntries, 0);
    assert.equal(body.data.timeEntries.monthMinutes, 0);

    assert.ok(body.data.notifications);
    assert.equal(body.data.notifications.unread, 0);
  });

  it('genere un rapport, l enregistre, et le fige a sa date', async () => {
    const generated = await request(app.getHttpServer())
      .post(`${baseUrl}/reports`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'REVENUE', preset: 'THIS_MONTH', title: REPORT_TITLE });

    assert.equal(generated.status, 201);
    const created = (generated.body as SuccessBody<ReportDetailView>).data;
    assert.equal(created.type, 'REVENUE');
    assert.equal(created.status, 'GENERATED');
    // Le document n'est jamais annonce comme un PDF : ce module ne produit pas de
    // fichier, et la ligne ne doit pas le laisser croire.
    assert.equal(created.format, 'JSON');
    assert.ok(created.periodStart);
    assert.ok(created.periodEnd);
    reportId = created.id;

    const detail = await request(app.getHttpServer())
      .get(`${baseUrl}/reports/${reportId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(detail.status, 200);
    const frozen = (detail.body as SuccessBody<ReportDetailView>).data;
    const firstResult = frozen.result;
    assert.ok(firstResult, 'un rapport genere doit porter son resultat');
    const firstCollected = firstResult.collected;
    assert.ok(firstCollected, 'le rapport de revenus doit porter les encaissements');
    assert.equal(amountOf(firstCollected, TEST_CURRENCY)?.total, '500.00');

    // --- LA propriete d'une piece datee : on modifie la donnee SOUS le rapport,
    //     et le rapport ne bouge pas. S'il se recalculait, il montrerait l'etat
    //     d'aujourd'hui sous une date passee sans que personne ne le voie.
    await prisma.payment.create({
      data: {
        reference: `${REF_PREFIX}PAY-A2`,
        invoiceId: invoiceAOpenId,
        amount: '500.00',
        currency: TEST_CURRENCY,
        method: 'BANK_TRANSFER',
        status: 'SUCCEEDED',
        paidAt: new Date(),
        receivedById: adminUserId,
      },
    });

    const after = await request(app.getHttpServer())
      .get(`${baseUrl}/reports/${reportId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(after.status, 200);
    const stillFrozen = (after.body as SuccessBody<ReportDetailView>).data;
    const secondCollected = stillFrozen.result?.collected;
    assert.ok(secondCollected);
    assert.equal(
      amountOf(secondCollected, TEST_CURRENCY)?.total,
      '500.00',
      'un rapport est un instantane : il ne doit pas suivre les donnees',
    );

    // Et il apparait dans la liste, sans qu'on suppose quoi que ce soit du total
    // global (d'autres modules en generent).
    const list = await request(app.getHttpServer())
      .get(`${baseUrl}/reports`)
      .query({ perPage: 100 })
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(list.status, 200);
    const listBody = list.body as SuccessBody<{ id: string }[]>;
    assert.ok(listBody.meta, 'une liste paginee doit porter ses meta');
    assert.ok(
      listBody.data.some((row) => row.id === reportId),
      'le rapport genere doit apparaitre dans la liste',
    );
    assert.ok(typeof listBody.meta.total === 'number' && listBody.meta.total >= 1);

    // --- Refus : un client ne genere pas de rapport.
    const asClient = await request(app.getHttpServer())
      .post(`${baseUrl}/reports`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .send({ type: 'REVENUE', preset: 'THIS_MONTH' });

    assert.equal(asClient.status, 403);
    assert.equal(errorOf(asClient).code, 'FORBIDDEN');

    // --- Refus : une periode incoherente, et un projet inconnu.
    const incoherent = await request(app.getHttpServer())
      .post(`${baseUrl}/reports`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'REVENUE', periodStart: '2026-09-30', periodEnd: '2026-09-01' });

    assert.ok(
      incoherent.status === 400 || incoherent.status === 422,
      `periode incoherente : statut attendu 400 ou 422, recu ${incoherent.status}`,
    );
    assert.match(errorOf(incoherent).code, /^REPORT_PERIOD_/);

    const unknownProject = await request(app.getHttpServer())
      .post(`${baseUrl}/reports`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'TASKS', preset: 'THIS_MONTH', projectId: UNKNOWN_PROJECT_ID });

    assert.equal(unknownProject.status, 404);
    assert.equal(errorOf(unknownProject).code, 'REPORT_PROJECT_NOT_FOUND');

    const badPreset = await request(app.getHttpServer())
      .post(`${baseUrl}/reports`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'REVENUE', preset: 'PAS_UNE_PERIODE' });

    assert.equal(badPreset.status, 400);
    assert.equal(errorOf(badPreset).code, 'VALIDATION_FAILED');
  });

  it("masque les parametres internes et n'en donne l'ecriture qu'a qui de droit", async () => {
    // --- Un client n'a rien a faire ici, ni en lecture ni en ecriture.
    const asClientRead = await request(app.getHttpServer())
      .get(`${baseUrl}/settings`)
      .set('Authorization', `Bearer ${clientAToken}`);

    assert.equal(asClientRead.status, 403);
    assert.equal(errorOf(asClientRead).code, 'FORBIDDEN');

    const asClientWrite = await request(app.getHttpServer())
      .patch(`${baseUrl}/settings`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .send({ settings: [{ key: SETTING_PUBLIC_KEY, value: 'Pirate SARL' }] });

    assert.equal(asClientWrite.status, 403);
    assert.equal(errorOf(asClientWrite).code, 'FORBIDDEN');

    // --- Un lecteur de parametres voit la configuration, pas les secrets.
    const asReader = await request(app.getHttpServer())
      .get(`${baseUrl}/settings`)
      .set('Authorization', `Bearer ${pmToken}`);

    assert.equal(asReader.status, 200);
    const readerView = (asReader.body as SuccessBody<SettingsListView>).data;
    assert.equal(
      readerView.settings.some((row) => row.key === SETTING_INTERNAL_KEY),
      false,
      'un lecteur ne doit pas voir passer une cle de parametre interne',
    );

    // Il peut le DEMANDER, mais il n'a pas le droit de l'obtenir : c'est la
    // deuxieme barriere, celle qui ne se contente pas de cacher un bouton.
    const readerAsking = await request(app.getHttpServer())
      .get(`${baseUrl}/settings`)
      .query({ includeInternal: true })
      .set('Authorization', `Bearer ${pmToken}`);

    assert.equal(readerAsking.status, 403);
    assert.equal(errorOf(readerAsking).code, 'FORBIDDEN');

    // --- L'administrateur ecrit les deux parametres, en une seule transaction.
    const written = await request(app.getHttpServer())
      .patch(`${baseUrl}/settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        settings: [
          { key: SETTING_PUBLIC_KEY, value: SETTING_PUBLIC_VALUE, description: 'Raison sociale' },
          { key: SETTING_INTERNAL_KEY, value: SETTING_INTERNAL_VALUE },
        ],
      });

    assert.equal(written.status, 200);
    const writtenBody = (written.body as SuccessBody<SettingsUpdateView>).data;
    assert.deepEqual(
      [...writtenBody.updated].sort(),
      [SETTING_INTERNAL_KEY, SETTING_PUBLIC_KEY].sort(),
    );
    assert.deepEqual(writtenBody.unchanged, []);

    // Rejouer le meme enregistrement ne doit rien changer, et surtout ne rien
    // journaliser : un historique gonfle d'ecritures sans effet ne se lit plus.
    const replayed = await request(app.getHttpServer())
      .patch(`${baseUrl}/settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        settings: [
          { key: SETTING_PUBLIC_KEY, value: SETTING_PUBLIC_VALUE },
          { key: SETTING_INTERNAL_KEY, value: SETTING_INTERNAL_VALUE },
        ],
      });

    assert.equal(replayed.status, 200);
    const replayedBody = (replayed.body as SuccessBody<SettingsUpdateView>).data;
    assert.deepEqual(replayedBody.updated, []);
    assert.equal(replayedBody.unchanged.length, 2);

    // --- Le detenteur du droit de modification voit les parametres internes.
    const adminView = await request(app.getHttpServer())
      .get(`${baseUrl}/settings`)
      .query({ includeInternal: true })
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(adminView.status, 200);
    const adminSettings = (adminView.body as SuccessBody<SettingsListView>).data.settings;
    const publicRow = adminSettings.find((row) => row.key === SETTING_PUBLIC_KEY);
    const internalRow = adminSettings.find((row) => row.key === SETTING_INTERNAL_KEY);

    assert.ok(publicRow, 'le parametre public doit etre servi');
    assert.equal(publicRow.value, SETTING_PUBLIC_VALUE);
    assert.equal(publicRow.internal, false);
    assert.ok(internalRow, 'le detenteur du droit de modification doit voir le parametre interne');
    assert.equal(internalRow.value, SETTING_INTERNAL_VALUE);
    assert.equal(internalRow.internal, true);

    // Sans le drapeau, meme un administrateur ne voit que le public : le masquage
    // est le comportement PAR DEFAUT, pas une option qu'on oublie.
    const adminDefault = await request(app.getHttpServer())
      .get(`${baseUrl}/settings`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(adminDefault.status, 200);
    assert.equal(
      (adminDefault.body as SuccessBody<SettingsListView>).data.settings.some(
        (row) => row.key === SETTING_INTERNAL_KEY,
      ),
      false,
    );

    // --- Cle invalide : refusee par le contrat, avant le service.
    const invalidKey = await request(app.getHttpServer())
      .patch(`${baseUrl}/settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ settings: [{ key: 'Company.Name', value: 'x' }] });

    assert.equal(invalidKey.status, 400);
    assert.equal(errorOf(invalidKey).code, 'VALIDATION_FAILED');

    // --- Le journal d'audit : la modification est imputable, mais la VALEUR d'un
    //     secret n'y entre jamais. Un journal lisible par tous les administrateurs
    //     et conserve pour toujours ne doit pas devenir le dernier endroit ou un
    //     secret traine en clair.
    const auditEntries = await prisma.auditLog.findMany({
      where: {
        action: 'SETTING_UPDATED',
        entityId: { in: [SETTING_PUBLIC_KEY, SETTING_INTERNAL_KEY] },
      },
      select: { entityId: true, actorId: true, after: true },
      orderBy: { createdAt: 'desc' },
    });

    assert.equal(auditEntries.length, 2, 'chaque parametre modifie doit laisser une trace');
    for (const entry of auditEntries) {
      assert.ok(
        userIds.includes(entry.actorId ?? ''),
        "l'auteur de la modification doit etre connu",
      );
    }

    const internalEntry = auditEntries.find((entry) => entry.entityId === SETTING_INTERNAL_KEY);
    const publicEntry = auditEntries.find((entry) => entry.entityId === SETTING_PUBLIC_KEY);
    assert.ok(internalEntry);
    assert.ok(publicEntry);

    assert.equal(
      JSON.stringify(internalEntry.after).includes(SETTING_INTERNAL_VALUE),
      false,
      "la valeur d'un parametre interne ne doit pas apparaitre dans le journal",
    );
    assert.equal(
      JSON.stringify(publicEntry.after).includes(SETTING_PUBLIC_VALUE),
      true,
      "la valeur d'un parametre ordinaire reste journalisee : c'est le but du journal",
    );
  });
});
