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
import {
  ActivityType,
  BudgetRange,
  ClientStatus,
  ContactRequestStatus,
  LeadSource,
  LeadStatus,
  NotificationType,
} from '../src/generated/prisma/enums.js';
import { ClientsModule } from '../src/modules/clients/clients.module.js';
import { CounterService } from '../src/modules/counters/counter.service.js';
import { ProspectsModule } from '../src/modules/prospects/prospects.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * CRM — PROSPECTS, CLIENTS, CONTACTS : TEST DE BOUT EN BOUT, SUR LA VRAIE BASE.
 *
 * Ce fichier ne simule rien : il demarre l'application complete, configuree par
 * le MEME `configureApp` que `main.ts`, et parle en HTTP. Chaque requete traverse
 * donc `ThrottlerGuard`, `JwtAuthGuard`, `PermissionsGuard`, `ValidationPipe`,
 * le controleur, le service, Prisma, le filtre d'exceptions et l'intercepteur
 * d'enveloppe — dans cet ordre.
 *
 * POURQUOI PAS DE TEST UNITAIRE POUR CES PROPRIETES. Les trois invariants du
 * module ne vivent pas dans une fonction pure :
 *
 *  - « un client ne voit jamais le dossier d'un autre » se joue dans le `where`
 *    envoye a PostgreSQL. Un Prisma simule l'aurait toujours fait reussir, y
 *    compris quand l'identifiant du chemin ecrase le perimetre ;
 *  - « la conversion est idempotente par refus » se gagne sur un
 *    compare-and-swap, donc sur le comportement de READ COMMITTED : deux appels
 *    simultanes, un seul dossier client ;
 *  - « le temoin vit dans la transaction du fait » ne se prouve qu'en base.
 *
 * Les regles pures (table de transitions, composition du perimetre) sont, elles,
 * couvertes sans base par `lead-pipeline.spec.ts`, `prospect-scope.spec.ts` et
 * `client-scope.spec.ts`.
 *
 * -----------------------------------------------------------------------------
 * MONTAGE DES DEUX MODULES — ETAT REEL
 * -----------------------------------------------------------------------------
 * `ClientsModule` et `ProspectsModule` sont DESORMAIS montes par
 * `src/app.module.ts` : ils s'y suivent dans le tableau `imports`, avec le
 * commentaire du pipeline commercial (dossier « CRM — pipeline commercial et
 * dossiers clients »). Les routes sont donc bien servies par l'application telle
 * que `main.ts` la monte.
 *
 * CE BLOC A DIT LE CONTRAIRE, ET C'EST CORRIGE PLUTOT QUE LAISSE MENTIR. Il
 * annoncait que `app.module.ts` etait hors perimetre et que les deux modules ne
 * pouvaient pas y etre ajoutes ; c'etait vrai de la livraison qui a ecrit ce
 * fichier, ce ne l'est plus. Un lecteur qui s'y fiait croyait a des routes
 * inexistantes hors du test.
 *
 * Le test continue de les declarer LUI-MEME, en plus de `AppModule` :
 *
 *     imports: [AppModule, ClientsModule, ProspectsModule]
 *
 * Cette double declaration est desormais REDONDANTE et sans effet : Nest
 * dedoublonne les modules deja charges, un import en double n'instancie pas deux
 * services. Elle est conservee parce qu'elle rend ce fichier indifferent a
 * l'ordre d'arrivee des deux lignes dans `app.module.ts` — pas parce qu'elle
 * serait necessaire. La vraie application les monte.
 *
 * -----------------------------------------------------------------------------
 * LIMITEUR DE DEBIT ET SESSIONS PARTAGEES
 * -----------------------------------------------------------------------------
 * La connexion est plafonnee a 10 appels par minute et par adresse IP. Ce
 * fichier ouvre donc TROIS sessions (un commercial, un administrateur, un compte
 * de l'espace client) et les partage entre tous les scenarios : ajouter une
 * connexion ici, combine a `auth.e2e-spec.ts`, ferait sauter le plafond avec des
 * 429 intermittents et difficiles a lire.
 *
 * Le compte de l'espace client est rattache a son dossier PENDANT le test, apres
 * sa connexion : c'est volontaire, et cela prouve au passage que le porteur est
 * RELU EN BASE a chaque requete (`JwtAuthGuard` -> `PrincipalLoader`) au lieu
 * d'etre fige dans le jeton.
 *
 * -----------------------------------------------------------------------------
 * DONNEES CREEES ET NETTOYEES
 * -----------------------------------------------------------------------------
 * Tout ce que ce fichier cree porte le marqueur `E2E-CRM-...` (raison sociale des
 * prospects et des clients) ou une adresse `e2e-crm-...@comexa.example`. Le
 * nettoyage est fait DEUX fois : avant, pour effacer les restes d'un run
 * interrompu (sinon les comptages par recherche seraient faux), et apres, dans
 * l'ordre des cles etrangeres.
 *
 * Il ne touche a AUCUNE donnee existante. Il consomme en revanche quelques
 * numeros du compteur partage (`counters`), qui ne sont pas remis en arriere :
 * une sequence comptable avance, elle ne recule pas — c'est precisement ce qui la
 * rend unique.
 */

const PASSWORD = 'Mappemonde-Vertige-63-Silex';

const EMAIL_SALES = 'e2e-crm-sales@comexa.example';
const EMAIL_ADMIN = 'e2e-crm-admin@comexa.example';
const EMAIL_CLIENT = 'e2e-crm-client@comexa.example';
const EMAILS = [EMAIL_SALES, EMAIL_ADMIN, EMAIL_CLIENT];

/** Marqueur unique des lignes de ce fichier : sert au nettoyage ET aux comptages. */
const MARKER = 'E2E-CRM-Prospect';

const P1_NAME = `${MARKER} Alpha`;
const P2_NAME = `${MARKER} Beta`;
const P3_NAME = `${MARKER} Gamma`;
const OWN_CLIENT_NAME = `${MARKER} Dossier du porteur`;
const OTHER_CLIENT_NAME = `${MARKER} Dossier d'un autre`;

/**
 * Demandes de contact du scenario de conversion.
 *
 * Leur raison sociale commence par `MARKER` : le prospect qui nait de la
 * conversion en HERITE, donc le nettoyage par marqueur de ce fichier
 * (`startsWith(MARKER)`) le retrouve sans qu'aucune ligne ne soit citee.
 */
const REQUEST_COMPANY_ALPHA = `${MARKER} Demande Alpha`;
const REQUEST_COMPANY_BETA = `${MARKER} Demande Beta`;
const REQUEST_COMPANY_HANDLED = `${MARKER} Demande prise en charge`;
const REQUEST_EMAIL_ALPHA = 'e2e-crm-demande-alpha@comexa.example';
const REQUEST_EMAIL_BETA = 'e2e-crm-demande-beta@comexa.example';
const REQUEST_EMAIL_HANDLED = 'e2e-crm-demande-handled@comexa.example';

/**
 * Identifiant bien forme mais inexistant. `cuid()` a la forme d'une chaine
 * alphanumerique : un identifiant fantaisiste ferait echouer Prisma sur un
 * format, pas sur une absence, et le test ne prouverait plus ce qu'il annonce.
 */
const UNKNOWN_ID = 'clx0000000000000000000000';

const REFERENCE_PATTERN = /^[A-Z]{2,3}-\d{4}-\d{4,}$/;

interface PaginatedMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

/** Forme de succes, telle que `TransformInterceptor` la produit. */
interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: PaginatedMeta;
}

/** Forme d'echec, telle que `AllExceptionsFilter` la produit. */
interface ErrorBody {
  success: false;
  error: { code: string; message: string; details: unknown };
}

interface LoginData {
  accessToken: string;
  user: { id: string; email: string; roles: string[]; clientId: string | null };
}

interface ProspectData {
  id: string;
  reference: string;
  companyName: string | null;
  contactFirstName: string;
  contactLastName: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  website: string | null;
  source: LeadSource;
  budgetRange: BudgetRange;
  notes: string | null;
  status: LeadStatus;
  ownerId: string | null;
  lostReason: string | null;
  convertedClientId: string | null;
  convertedAt: string | null;
  deletedAt: string | null;
}

interface ClientData {
  id: string;
  reference: string;
  companyName: string;
  status: ClientStatus;
  accountManagerId: string | null;
  deletedAt: string | null;
}

interface ContactData {
  id: string;
  clientId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  isPrimary: boolean;
  deletedAt: string | null;
}

interface HistoryData {
  id: string;
  prospectId: string;
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus;
  note: string | null;
  changedById: string | null;
  changedBy: { id: string; firstName: string; lastName: string } | null;
}

interface ConversionData {
  prospect: ProspectData;
  client: ClientData;
}

interface ContactRequestData {
  id: string;
  reference: string;
  status: ContactRequestStatus;
  handledById: string | null;
  handledAt: string | null;
  convertedProspectId: string | null;
  convertedAt: string | null;
  deletedAt: string | null;
}

/** Ce que rend `POST /contact-requests/:id/convert` : la piste, et la demande a jour. */
interface ConversionFromRequestData {
  prospect: ProspectData;
  contactRequest: ContactRequestData;
}

function errorOf(response: request.Response): ErrorBody['error'] {
  const body = response.body as ErrorBody;
  assert.equal(body.success, false, "une reponse d'echec doit porter success: false");
  return body.error;
}

/**
 * Premier element d'une liste, ou echec explicite.
 *
 * `noUncheckedIndexedAccess` est actif : `items[0]` est `T | undefined`, et le
 * compilateur a raison — une liste peut etre vide. Un `!` masquerait le cas, or
 * une page vide au milieu d'un scenario est exactement le symptome que ce test
 * doit rendre lisible.
 */
function first<T>(items: readonly T[], label: string): T {
  const value = items[0];
  if (value === undefined) {
    assert.fail(`${label} : la liste ne devrait pas etre vide`);
  }
  return value;
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

describe('CRM — prospects, clients, contacts (bout en bout, base reelle)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  let salesToken = '';
  let adminToken = '';
  let clientToken = '';
  let salesUserId = '';
  let adminUserId = '';
  let clientUserId = '';

  let ownClientId = '';
  let otherClientId = '';
  let ownClientReference = '';
  let otherContactId = '';

  const createdUserIds: string[] = [];
  const createdProspectIds: string[] = [];
  const createdClientIds: string[] = [];
  const createdContactRequestIds: string[] = [];

  /**
   * Supprime les lignes citees, DANS L'ORDRE DES CLES ETRANGERES.
   *
   * Les identifiants sont passes explicitement et non deduits d'une recherche :
   * le nettoyage apres coup doit viser exactement ce que le test a cree, et rien
   * de plus. Le nettoyage PREVENTIF, lui, cherche par marqueur et emprunte la
   * meme routine — une seule liste d'ordres a tenir a jour.
   */
  async function purge(target: {
    // Types mutables : `in:` de Prisma attend `string[]`, et un tableau `readonly`
    // ne lui suffit pas (le compilateur le refuse, a raison — l'ordre de
    // suppression est le seul contrat, pas l'immuabilite du tableau).
    prospectIds?: string[];
    clientIds?: string[];
    userIds?: string[];
    contactRequestIds?: string[];
  }): Promise<void> {
    const prospectIds = target.prospectIds ?? [];
    const clientIds = target.clientIds ?? [];
    const userIds = target.userIds ?? [];
    const contactRequestIds = target.contactRequestIds ?? [];

    if (
      prospectIds.length === 0 &&
      clientIds.length === 0 &&
      userIds.length === 0 &&
      contactRequestIds.length === 0
    ) {
      return;
    }

    const entityIds = [...prospectIds, ...clientIds, ...contactRequestIds];

    // 1. Les notifications et les activites d'abord : elles pointent vers les
    //    utilisateurs et les clients, et retirer ceux-ci les emporterait de
    //    toute facon — mais une cascade silencieuse laisse un doute sur ce qui a
    //    ete nettoye.
    await prisma.notification.deleteMany({
      where: {
        OR: [{ userId: { in: userIds } }, { entityId: { in: entityIds } }],
      },
    });
    await prisma.activity.deleteMany({
      where: {
        OR: [{ actorId: { in: userIds } }, { clientId: { in: clientIds } }],
      },
    });

    // 2. L'audit ne se supprime pas en cascade : on le retire explicitement.
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: userIds } },
          { entityId: { in: [...entityIds, ...userIds] } },
        ],
      },
    });

    // 3. Le journal d'etapes part en cascade avec son prospect ; on l'ecrit
    //    quand meme, pour la meme raison que ci-dessus.
    if (prospectIds.length > 0) {
      await prisma.leadStatusHistory.deleteMany({
        where: { prospectId: { in: [...prospectIds] } },
      });
    }

    if (clientIds.length > 0) {
      await prisma.contact.deleteMany({ where: { clientId: { in: [...clientIds] } } });
    }

    // 4. Les demandes de contact AVANT les prospects : `convertedProspectId`
    //    pointe vers une fiche, et la retirer en premier evite de dependre du
    //    `onDelete: SetNull` de cette colonne. Une demande convertie ne se
    //    supprime pas en cascade avec son prospect — elle lui SURVIT, c'est tout
    //    l'interet du lien.
    if (contactRequestIds.length > 0) {
      await prisma.contactRequest.deleteMany({ where: { id: { in: [...contactRequestIds] } } });
    }

    // 5. Les prospects AVANT les clients : `convertedClientId` pointe vers un
    //    client, et `onDelete: SetNull` effacerait le lien avant qu'on ne
    //    supprime la ligne qui le porte.
    if (prospectIds.length > 0) {
      await prisma.prospect.deleteMany({ where: { id: { in: [...prospectIds] } } });
    }

    // 6. Les utilisateurs avant les clients : un compte de l'espace client est
    //    rattache a un dossier, et le detruire en premier evite de dependre du
    //    `onDelete: SetNull` de cette colonne.
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
    }

    if (clientIds.length > 0) {
      await prisma.client.deleteMany({ where: { id: { in: [...clientIds] } } });
    }
  }

  /**
   * Une demande de contact PRE-EXISTANTE, ecrite directement en base.
   *
   * Le formulaire public est plafonne a 5 envois par minute et par adresse IP
   * (`content-public.controller.ts`). Le faire tourner pour chaque fixture ferait
   * sauter ce plafond des que la suite complete tourne : `content.e2e-spec.ts` en
   * depense deja deux, et le troisieme envoi de ce fichier passerait a la
   * sixieme requete — un 429 intermittent, dependant de l'ordre des fichiers.
   * Le seul scenario ou le passage par le formulaire est le SUJET du test
   * l'emprunte ; les autres ont besoin d'une demande, pas d'un envoi.
   *
   * La reference vient du COMPTEUR PARTAGE, comme celle du formulaire. Une
   * fixture dont la reference ne ressemblerait pas aux vraies ne prouverait rien
   * sur la numerotation, et une reference inventee a la main risquerait d'entrer
   * en collision avec un numero que le compteur distribuera plus tard.
   */
  async function createRequest(params: {
    email: string;
    companyName: string;
    subject?: string;
    message?: string;
  }): Promise<{ id: string; reference: string }> {
    const counters = app.get(CounterService);
    const reference = await counters.reference({ scope: 'CONTACT_REQUEST' });

    const created = await prisma.contactRequest.create({
      data: {
        reference,
        firstName: 'Visiteur',
        lastName: 'De Test',
        email: params.email,
        companyName: params.companyName,
        subject: params.subject ?? 'Demande de test',
        message: params.message ?? 'Message de test pour la conversion en prospect.',
      },
      select: { id: true, reference: true },
    });

    createdContactRequestIds.push(created.id);
    return created;
  }

  async function login(email: string): Promise<{ token: string; userId: string }> {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email, password: PASSWORD });

    assert.equal(
      response.status,
      200,
      `connexion de ${email} : ${response.status} ${JSON.stringify(response.body)}`,
    );

    const body = response.body as SuccessBody<LoginData>;
    return { token: body.data.accessToken, userId: body.data.user.id };
  }

  before(async () => {
    // Si la politique de mot de passe durcit, on veut l'apprendre ici et non par
    // un 422 obscur au milieu du parcours.
    const violation = passwordPolicyViolation(PASSWORD);
    assert.equal(violation, null, `mot de passe de test refuse : ${violation}`);

    const moduleRef = await Test.createTestingModule({
      // `AppModule` monte desormais la chaine complete, `ClientsModule` et
      // `ProspectsModule` compris : les deux modules metier declares ici sont
      // donc un doublon sans effet, que Nest dedoublonne. Ils restent pour que
      // ce fichier ne depende pas de l'ordre des lignes dans `app.module.ts`.
      // Voir l'en-tete du fichier.
      imports: [AppModule, ClientsModule, ProspectsModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useLogger(false);

    const setup = configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    baseUrl = `/${setup.apiPrefix}`;

    const [adminRole, salesRole, clientRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'SALES' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'CLIENT' }, select: { id: true } }),
    ]);

    // --- Nettoyage preventif -------------------------------------------------
    // Un run precedent interrompu laisserait des dossiers portant le marqueur, et
    // les comptages par recherche de ce fichier (`meta.total`) seraient faux :
    // un test qui depend d'un etat anterieur n'est pas un test.
    const leftoverProspects = await prisma.prospect.findMany({
      where: { companyName: { startsWith: MARKER } },
      select: { id: true },
    });
    const leftoverClients = await prisma.client.findMany({
      where: { companyName: { startsWith: MARKER } },
      select: { id: true },
    });
    const leftoverUsers = await prisma.user.findMany({
      where: { email: { in: EMAILS } },
      select: { id: true },
    });
    const leftoverRequests = await prisma.contactRequest.findMany({
      where: { companyName: { startsWith: MARKER } },
      select: { id: true },
    });

    await purge({
      prospectIds: leftoverProspects.map((row) => row.id),
      clientIds: leftoverClients.map((row) => row.id),
      userIds: leftoverUsers.map((row) => row.id),
      contactRequestIds: leftoverRequests.map((row) => row.id),
    });

    // --- Trois comptes, trois espaces ---------------------------------------
    const passwordHash = await hashPassword(PASSWORD);

    const sales = await prisma.user.create({
      data: {
        email: EMAIL_SALES,
        passwordHash,
        firstName: 'Test',
        lastName: 'Commercial',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        roles: { create: { roleId: salesRole.id } },
      },
      select: { id: true },
    });

    const admin = await prisma.user.create({
      data: {
        email: EMAIL_ADMIN,
        passwordHash,
        firstName: 'Test',
        lastName: 'Administrateur',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        roles: { create: { roleId: adminRole.id } },
      },
      select: { id: true },
    });

    // Le compte de l'espace client est cree SANS dossier : il sera rattache plus
    // bas, apres sa connexion. C'est ce qui prouve que ses droits sont relus a
    // chaque requete et non figes dans le jeton.
    const portal = await prisma.user.create({
      data: {
        email: EMAIL_CLIENT,
        passwordHash,
        firstName: 'Test',
        lastName: 'Portail',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        roles: { create: { roleId: clientRole.id } },
      },
      select: { id: true },
    });

    createdUserIds.push(sales.id, admin.id, portal.id);

    // --- Trois sessions, pas une de plus (10 connexions par minute) ----------
    const salesSession = await login(EMAIL_SALES);
    const adminSession = await login(EMAIL_ADMIN);
    const clientSession = await login(EMAIL_CLIENT);

    salesToken = salesSession.token;
    adminToken = adminSession.token;
    clientToken = clientSession.token;
    salesUserId = salesSession.userId;
    adminUserId = adminSession.userId;
    clientUserId = clientSession.userId;

    assert.equal(salesUserId, sales.id);
    assert.equal(adminUserId, admin.id);
    assert.equal(clientUserId, portal.id);

    // --- Les deux dossiers clients du scenario d'isolation -------------------
    const otherCreated = await request(app.getHttpServer())
      .post(`${baseUrl}/clients`)
      .set(bearer(salesToken))
      .send({ companyName: OTHER_CLIENT_NAME, sector: 'Test' });

    assert.equal(
      otherCreated.status,
      201,
      `creation du dossier tiers : ${otherCreated.status} ${JSON.stringify(otherCreated.body)}`,
    );

    const otherClient = (otherCreated.body as SuccessBody<ClientData>).data;
    otherClientId = otherClient.id;

    const ownCreated = await request(app.getHttpServer())
      .post(`${baseUrl}/clients`)
      .set(bearer(salesToken))
      .send({ companyName: OWN_CLIENT_NAME, sector: 'Test' });

    assert.equal(ownCreated.status, 201);

    const ownClient = (ownCreated.body as SuccessBody<ClientData>).data;
    ownClientId = ownClient.id;
    ownClientReference = ownClient.reference;

    createdClientIds.push(ownClient.id, otherClient.id);

    // Rattachement du compte portail a SON dossier — apres sa connexion.
    await prisma.user.update({
      where: { id: portal.id },
      data: { clientId: ownClient.id },
    });

    // Un interlocuteur de chaque cote, pour les scenarios de contacts.
    const otherContact = await request(app.getHttpServer())
      .post(`${baseUrl}/clients/${otherClient.id}/contacts`)
      .set(bearer(salesToken))
      .send({ firstName: 'Premier', lastName: 'Interlocuteur', isPrimary: true });

    assert.equal(otherContact.status, 201);
    otherContactId = (otherContact.body as SuccessBody<ContactData>).data.id;

    const ownContact = await request(app.getHttpServer())
      .post(`${baseUrl}/clients/${ownClient.id}/contacts`)
      .set(bearer(salesToken))
      .send({
        firstName: 'Titulaire',
        lastName: 'Du dossier',
        email: 'titulaire@dossier-e2e.example',
        isPrimary: true,
      });

    assert.equal(ownContact.status, 201);
  });

  after(async () => {
    if (!app) {
      return;
    }

    // Les dossiers nes d'une conversion ne sont pas traces individuellement par
    // les scenarios : ils sont retrouves par marqueur. Les oublier laisserait des
    // clients dans une base qui n'appartient pas a ce test.
    const trackedProspects = await prisma.prospect.findMany({
      where: { companyName: { startsWith: MARKER } },
      select: { id: true },
    });
    const trackedClients = await prisma.client.findMany({
      where: { companyName: { startsWith: MARKER } },
      select: { id: true },
    });
    const trackedRequests = await prisma.contactRequest.findMany({
      where: { companyName: { startsWith: MARKER } },
      select: { id: true },
    });

    await purge({
      prospectIds: [...createdProspectIds, ...trackedProspects.map((row) => row.id)],
      clientIds: [...createdClientIds, ...trackedClients.map((row) => row.id)],
      userIds: createdUserIds,
      contactRequestIds: [
        ...createdContactRequestIds,
        ...trackedRequests.map((row) => row.id),
      ],
    });

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AUTORISATION — le jeton, pas l'URL
  // ---------------------------------------------------------------------------

  it("refuse l'espace client sur le pipeline commercial, quel que soit l'identifiant vise", async () => {
    // Le role CLIENT ne detient AUCUN code `prospect:*` : la porte se ferme au
    // garde de permissions, avant meme le service. Le test fige ce fait, parce
    // qu'un code ajoute par erreur au catalogue dans six mois ouvrirait le
    // pipeline a tous les clients sans que rien ne le signale.
    const list = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects`)
      .set(bearer(clientToken));

    const read = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${UNKNOWN_ID}`)
      .set(bearer(clientToken));

    const create = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects`)
      .set(bearer(clientToken))
      .send({
        contactFirstName: 'Intrusion',
        contactLastName: 'Portail',
        email: 'intrusion@portail-e2e.example',
      });

    for (const response of [list, read, create]) {
      assert.equal(response.status, 403);
      assert.equal(errorOf(response).code, 'FORBIDDEN');
    }
  });

  it("n'ouvre pas la liste des dossiers clients a l'espace client", async () => {
    // `client:read:own` ouvre SON dossier, pas le portefeuille de l'agence.
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/clients`)
      .set(bearer(clientToken));

    assert.equal(response.status, 403);
    assert.equal(errorOf(response).code, 'FORBIDDEN');
  });

  it("LE TEST DE L'EXIGENCE : un client vise le dossier d'un autre et obtient un 404, jamais un 403", async () => {
    // EXIGENCE DU CAHIER DES CHARGES, citee mot pour mot :
    //   « Un client ne doit jamais pouvoir modifier l'ID d'un autre client dans
    //     une requete pour acceder a ses donnees. »
    //
    // Le porteur detient le dossier `own` ; il demande l'identifiant de `other`.
    // Le perimetre (`clientId` DU JETON) et l'identifiant demande sont composes
    // en `AND` dans le `where` : les deux doivent etre vrais, et une ligne ne
    // peut pas avoir deux identifiants. La reponse est donc 404 — la fiche
    // n'existe pas DANS SON PERIMETRE.
    //
    // Un 403 serait un echec de ce test : il confirmerait l'existence du dossier
    // d'un autre client, ce que l'exigence cherche precisement a empecher.
    const own = await request(app.getHttpServer())
      .get(`${baseUrl}/clients/${ownClientId}`)
      .set(bearer(clientToken));

    assert.equal(own.status, 200, 'le porteur doit lire SON dossier');
    const ownBody = own.body as SuccessBody<ClientData>;
    assert.equal(ownBody.data.id, ownClientId);
    assert.equal(ownBody.data.reference, ownClientReference);

    const other = await request(app.getHttpServer())
      .get(`${baseUrl}/clients/${otherClientId}`)
      .set(bearer(clientToken));

    assert.equal(other.status, 404, "viser un autre dossier ne doit pas repondre 403");
    assert.equal(errorOf(other).code, 'CLIENT_NOT_FOUND');

    // Et la modification du dossier d'un autre est refusee elle aussi — ici par
    // la porte, l'ecriture etant reservee a l'agence.
    const patch = await request(app.getHttpServer())
      .patch(`${baseUrl}/clients/${otherClientId}`)
      .set(bearer(clientToken))
      .send({ companyName: 'Dossier detourne' });

    assert.equal(patch.status, 403);
  });

  it("n'invente pas de perimetre quand le compte portail n'est rattache a aucun dossier", async () => {
    // Le cas qui decide de tout : sans `clientId`, le perimetre serait vide, et
    // le seul moyen de continuer serait de se rabattre sur l'identifiant de la
    // requete — exactement ce qu'il ne faut pas faire. On refuse.
    //
    // Le compte est detache PUIS rattache, et le meme jeton sert aux deux appels :
    // c'est aussi la preuve que le porteur est relu en base a chaque requete, et
    // non fige au moment de la connexion.
    await prisma.user.update({ where: { id: clientUserId }, data: { clientId: null } });

    try {
      const denied = await request(app.getHttpServer())
        .get(`${baseUrl}/clients/${ownClientId}`)
        .set(bearer(clientToken));

      assert.equal(denied.status, 403);
      assert.equal(errorOf(denied).code, 'FORBIDDEN');
    } finally {
      await prisma.user.update({
        where: { id: clientUserId },
        data: { clientId: ownClientId },
      });
    }

    const allowed = await request(app.getHttpServer())
      .get(`${baseUrl}/clients/${ownClientId}`)
      .set(bearer(clientToken));

    assert.equal(allowed.status, 200, 'le meme jeton doit fonctionner une fois le rattachement retabli');
  });

  it("circonscrit les contacts du portail a SON dossier", async () => {
    const mine = await request(app.getHttpServer())
      .get(`${baseUrl}/clients/${ownClientId}/contacts`)
      .set(bearer(clientToken));

    assert.equal(mine.status, 200);
    const mineBody = mine.body as SuccessBody<ContactData[]>;
    assert.equal(mineBody.meta?.total, 1);
    assert.equal(first(mineBody.data, 'contacts du porteur').clientId, ownClientId);

    // Vider l'URL et viser le dossier d'un autre : la page est VIDE. Pas de 404
    // ici — la route ne rend pas de fiche, elle rend une liste, et une liste
    // filtree sur un autre dossier ne contient rien. Aucune information ne
    // fuit : le porteur n'apprend pas si ce dossier existe.
    const others = await request(app.getHttpServer())
      .get(`${baseUrl}/clients/${otherClientId}/contacts`)
      .set(bearer(clientToken));

    assert.equal(others.status, 200);
    const othersBody = others.body as SuccessBody<ContactData[]>;
    assert.equal(othersBody.meta?.total, 0);
    assert.deepEqual(othersBody.data, []);

    // Et l'ecriture d'un contact est fermee : le role CLIENT ne detient pas
    // `contact:write:any`, et le service refuse l'ecriture sur le ROLE avant
    // meme de regarder les permissions.
    const write = await request(app.getHttpServer())
      .patch(`${baseUrl}/contacts/${otherContactId}`)
      .set(bearer(clientToken))
      .send({ firstName: 'Detourne' });

    assert.equal(write.status, 403);
  });

  // ---------------------------------------------------------------------------
  // PROSPECTS — creation, numerotation, journal
  // ---------------------------------------------------------------------------

  it('cree un prospect numerote, avec la premiere ligne de son journal', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects`)
      .set(bearer(salesToken))
      .send({
        companyName: P1_NAME,
        contactFirstName: 'Nadia',
        contactLastName: 'Lefranc',
        email: 'nadia.lefranc@e2e-crm.example',
        phone: '+33 5 56 00 00 02',
        jobTitle: 'Gerante',
        sector: 'Commerce de proximite',
      });

    assert.equal(
      response.status,
      201,
      `creation du prospect : ${response.status} ${JSON.stringify(response.body)}`,
    );

    const prospect = (response.body as SuccessBody<ProspectData>).data;
    createdProspectIds.push(prospect.id);

    // La reference est produite par le compteur partage, jamais par le module.
    assert.match(prospect.reference, REFERENCE_PATTERN);
    assert.ok(prospect.reference.startsWith('PRO-'), `prefixe attendu PRO- : ${prospect.reference}`);

    // Le statut initial vient du schema, et le DTO ne permet pas de le choisir.
    assert.equal(prospect.status, LeadStatus.NEW);
    assert.equal(prospect.ownerId, salesUserId, 'sans responsable demande, la fiche revient au porteur');
    assert.equal(prospect.convertedClientId, null);
    assert.equal(prospect.deletedAt, null);

    const history = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${prospect.id}/history`)
      .set(bearer(salesToken));

    assert.equal(history.status, 200);
    const page = history.body as SuccessBody<HistoryData[]>;
    assert.equal(page.meta?.total, 1, 'la creation ecrit exactement une ligne d historique');

    const entry = first(page.data, 'journal du prospect');
    assert.equal(entry.fromStatus, null, 'la creation n a pas de statut precedent');
    assert.equal(entry.toStatus, LeadStatus.NEW);
    assert.equal(entry.changedById, salesUserId);
    assert.equal(entry.changedBy?.id, salesUserId, 'l auteur est resolu dans la reponse');
  });

  it('consomme un numero different a chaque creation', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects`)
      .set(bearer(salesToken))
      .send({
        companyName: P2_NAME,
        contactFirstName: 'Marc',
        contactLastName: 'Dupuis',
        email: 'marc.dupuis@e2e-crm.example',
      });

    assert.equal(response.status, 201);
    const prospect = (response.body as SuccessBody<ProspectData>).data;
    createdProspectIds.push(prospect.id);

    assert.match(prospect.reference, REFERENCE_PATTERN);
    assert.notEqual(
      prospect.reference,
      first(createdProspectIds, 'prospects crees'),
      'deux creations ne doivent pas partager une reference',
    );

    // La fiche est relue par la route de lecture, pas seulement par la reponse
    // de creation : les deux chemins doivent servir la meme ligne.
    const read = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${prospect.id}`)
      .set(bearer(salesToken));

    assert.equal(read.status, 200);
    assert.equal((read.body as SuccessBody<ProspectData>).data.reference, prospect.reference);
  });

  it('refuse un champ non declare : le statut ne se choisit pas a la creation', async () => {
    // `forbidNonWhitelisted` est actif. Ce test echouerait si le test montait
    // l'application sans `configureApp` : le champ serait ignore et la fiche
    // creee en NEW, en silence.
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects`)
      .set(bearer(salesToken))
      .send({
        companyName: `${MARKER} Refuse`,
        contactFirstName: 'Sans',
        contactLastName: 'Statut',
        email: 'sans.statut@e2e-crm.example',
        status: LeadStatus.WON,
      });

    assert.equal(response.status, 400);
    assert.equal(errorOf(response).code, 'VALIDATION_FAILED');
  });

  it('refuse aussi le statut par PATCH : le journal doit rester la seule preuve du parcours', async () => {
    // Un second chemin capable de deplacer l'etape sans ecrire d'historique
    // viderait le journal de sa valeur. Le champ n'est pas dans le DTO : il est
    // refuse, pas absorbe.
    const target = second(createdProspectIds);

    const response = await request(app.getHttpServer())
      .patch(`${baseUrl}/prospects/${target}`)
      .set(bearer(salesToken))
      .send({ status: LeadStatus.WON });

    assert.equal(response.status, 400);
    assert.equal(errorOf(response).code, 'VALIDATION_FAILED');

    const history = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${target}/history`)
      .set(bearer(salesToken));

    assert.equal((history.body as SuccessBody<HistoryData[]>).meta?.total, 1);
  });

  it('refuse un responsable inconnu en 422, pas en 500', async () => {
    // `ownerId` est une cle etrangere : sans controle d'existence, la violation
    // de contrainte remonterait en 500 pour une simple faute de saisie.
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects`)
      .set(bearer(salesToken))
      .send({
        companyName: `${MARKER} Responsable inconnu`,
        contactFirstName: 'Fan',
        contactLastName: 'Tome',
        email: 'fantome@e2e-crm.example',
        ownerId: UNKNOWN_ID,
      });

    assert.equal(response.status, 422);
    assert.equal(errorOf(response).code, 'PROSPECT_OWNER_NOT_FOUND');
  });

  // ---------------------------------------------------------------------------
  // PIPELINE — transitions, historique, activite
  // ---------------------------------------------------------------------------

  it('refuse une transition non declaree sans rien ecrire', async () => {
    const target = second(createdProspectIds);

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects/${target}/status`)
      .set(bearer(salesToken))
      .send({ status: LeadStatus.PROPOSAL_SENT });

    assert.equal(response.status, 422);
    const error = errorOf(response);
    assert.equal(error.code, 'LEAD_STATUS_TRANSITION_INVALID');

    // Le detail donne les sorties autorisees : le frontend ne doit pas
    // redevinir la table de son cote, deux tables divergeraient au premier ajout.
    //
    // QUALIFIED figure parmi ces sorties, et ce n'est pas une tolerance : une
    // piste entrante peut arriver DEJA qualifiee. Le statut n'est ni un champ de
    // creation ni un champ de modification — un prospect nait toujours NEW (voir
    // `CreateProspectDto`) — donc la seule facon d'enregistrer une piste dont le
    // besoin est deja cadre est NEW -> QUALIFIED. `full-chain.e2e-spec.ts`
    // parcourt exactement ce chemin : le prospect issu de la demande de contact
    // du visiteur est qualifie en une etape, apres « budget et besoin confirmes
    // par telephone ». La prise de contact a eu lieu AVANT la fiche (le
    // formulaire, puis l'appel) ; exiger un passage par CONTACTED obligerait le
    // commercial a ecrire une ligne d'historique qui n'a pas eu lieu, or
    // l'historique est la preuve du parcours. La regle de la table est « on ne
    // saute pas la QUALIFICATION », pas « on ne peut pas y entrer directement » :
    // NEW -> PROPOSAL_SENT, lui, reste refuse — c'est l'objet de ce test.
    assert.deepEqual(error.details, {
      from: LeadStatus.NEW,
      to: LeadStatus.PROPOSAL_SENT,
      allowed: [LeadStatus.CONTACTED, LeadStatus.QUALIFIED, LeadStatus.LOST],
    });

    const read = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${target}`)
      .set(bearer(salesToken));

    assert.equal((read.body as SuccessBody<ProspectData>).data.status, LeadStatus.NEW);
  });

  it("deplace l'etape, ecrit l'historique ET l'activite dans la meme transaction", async () => {
    const target = second(createdProspectIds);

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects/${target}/status`)
      .set(bearer(salesToken))
      .send({ status: LeadStatus.CONTACTED, note: 'Premier echange telephonique.' });

    assert.equal(response.status, 200, 'un deplacement ne cree rien : il repond 200, pas 201');
    const moved = (response.body as SuccessBody<ProspectData>).data;
    assert.equal(moved.status, LeadStatus.CONTACTED);

    const history = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${target}/history`)
      .set(bearer(salesToken));

    const page = history.body as SuccessBody<HistoryData[]>;
    assert.equal(page.meta?.total, 2, 'le journal doit compter la creation et le deplacement');
    const last = page.data[1];
    assert.ok(last, 'la deuxieme ligne du journal doit exister');
    assert.equal(last.fromStatus, LeadStatus.NEW);
    assert.equal(last.toStatus, LeadStatus.CONTACTED);
    assert.equal(last.note, 'Premier echange telephonique.');
    assert.equal(last.changedById, salesUserId);

    // Le temoin vit dans la transaction du fait : il est donc en base des que la
    // reponse est rendue.
    const activity = await prisma.activity.findFirst({
      where: {
        type: ActivityType.STATUS_CHANGE,
        actorId: salesUserId,
        metadata: { path: ['prospectId'], equals: target },
      },
    });

    assert.ok(activity, 'le deplacement doit laisser une trace dans le fil');
    assert.equal(
      activity.isClientVisible,
      false,
      'le pipeline commercial est interne : aucun deplacement ne doit apparaitre au client',
    );
  });

  it('refuse de rejouer la meme etape, sans ajouter de ligne au journal', async () => {
    // Une ligne « CONTACTED -> CONTACTED » n'attesterait d'aucun changement :
    // exactement ce qu'un historique ne doit pas contenir.
    const target = second(createdProspectIds);

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects/${target}/status`)
      .set(bearer(salesToken))
      .send({ status: LeadStatus.CONTACTED });

    assert.equal(response.status, 422);
    assert.equal(errorOf(response).code, 'LEAD_STATUS_UNCHANGED');

    const history = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${target}/history`)
      .set(bearer(salesToken));

    assert.equal((history.body as SuccessBody<HistoryData[]>).meta?.total, 2);
  });

  it("ne retient la raison de la perte que vers LOST, et l'efface en repartant", async () => {
    const target = second(createdProspectIds);

    const lost = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects/${target}/status`)
      .set(bearer(salesToken))
      .send({ status: LeadStatus.LOST, lostReason: 'Budget reporte a l an prochain.' });

    assert.equal(lost.status, 200);
    assert.equal((lost.body as SuccessBody<ProspectData>).data.lostReason, 'Budget reporte a l an prochain.');

    // Quitter LOST doit effacer la raison : la fiche ne doit pas conserver une
    // perte passee comme si elle etait encore d'actualite.
    const resumed = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects/${target}/status`)
      .set(bearer(salesToken))
      .send({ status: LeadStatus.NEW, note: 'Le budget est debloque.' });

    assert.equal(resumed.status, 200);
    const body = (resumed.body as SuccessBody<ProspectData>).data;
    assert.equal(body.status, LeadStatus.NEW);
    assert.equal(body.lostReason, null, 'la raison de la perte appartient a l evenement, pas a la fiche');

    // Et une raison fournie vers une autre etape n'est pas retenue non plus.
    const moved = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects/${target}/status`)
      .set(bearer(salesToken))
      .send({ status: LeadStatus.CONTACTED, lostReason: 'Sans objet ici.' });

    assert.equal(moved.status, 200);
    assert.equal((moved.body as SuccessBody<ProspectData>).data.lostReason, null);
  });

  it('refuse un statut qui n existe pas, avant meme le service', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects/${second(createdProspectIds)}/status`)
      .set(bearer(salesToken))
      .send({ status: 'ARCHIVED' });

    assert.equal(response.status, 400);
    assert.equal(errorOf(response).code, 'VALIDATION_FAILED');
  });

  // ---------------------------------------------------------------------------
  // CONVERSION — le dossier client, et l'idempotence par refus
  // ---------------------------------------------------------------------------

  it('convertit un prospect : client, contact principal, historique, activite visible', async () => {
    const target = first(createdProspectIds, 'prospect converti');

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects/${target}/convert`)
      .set(bearer(salesToken));

    assert.equal(
      response.status,
      200,
      `conversion : ${response.status} ${JSON.stringify(response.body)}`,
    );

    const conversion = (response.body as SuccessBody<ConversionData>).data;
    const client = conversion.client;

    // Le prospect porte le lien, le statut et la date : la chaine
    // prospect -> client doit rester lisible depuis les deux bouts.
    assert.equal(conversion.prospect.id, target);
    assert.equal(conversion.prospect.status, LeadStatus.WON);
    assert.equal(conversion.prospect.convertedClientId, client.id);
    assert.ok(conversion.prospect.convertedAt, 'la date de conversion doit etre posee');

    // Le client neuf vient du compteur partage : prefixe CLI, jamais PRO.
    assert.match(client.reference, REFERENCE_PATTERN);
    assert.ok(client.reference.startsWith('CLI-'), `prefixe attendu CLI- : ${client.reference}`);
    assert.equal(client.companyName, P1_NAME);
    assert.equal(client.status, ClientStatus.ACTIVE);
    assert.equal(client.accountManagerId, salesUserId, 'le dossier revient au responsable du prospect');

    // L'interlocuteur du prospect devient le contact principal du dossier.
    const contacts = await request(app.getHttpServer())
      .get(`${baseUrl}/clients/${client.id}/contacts`)
      .set(bearer(salesToken));

    assert.equal(contacts.status, 200);
    const contactsBody = contacts.body as SuccessBody<ContactData[]>;
    assert.equal(contactsBody.meta?.total, 1);
    const contact = first(contactsBody.data, 'contacts du client converti');
    assert.equal(contact.isPrimary, true);
    assert.equal(contact.firstName, 'Nadia');
    assert.equal(contact.lastName, 'Lefranc');
    assert.equal(contact.email, 'nadia.lefranc@e2e-crm.example');

    // Le journal du prospect raconte la conversion.
    const history = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${target}/history`)
      .set(bearer(salesToken));

    const page = history.body as SuccessBody<HistoryData[]>;
    assert.equal(page.meta?.total, 2);
    const last = page.data[1];
    assert.ok(last, 'la ligne de conversion doit exister');
    assert.equal(last.fromStatus, LeadStatus.NEW);
    assert.equal(last.toStatus, LeadStatus.WON);
    assert.equal(last.note, 'Conversion en client.');

    // LA SEULE ENTREE VISIBLE DU MODULE, et elle l'est parce que le client vient
    // de naitre : son portail doit contenir une trace de son entree.
    const visible = await prisma.activity.findFirst({
      where: { clientId: client.id, isClientVisible: true },
    });

    assert.ok(visible, 'la conversion doit laisser une trace visible par le client');
    assert.equal(visible.type, ActivityType.MILESTONE_REACHED);

    // Rien d'autre du pipeline n'est visible.
    const hidden = await prisma.activity.count({
      where: { clientId: client.id, isClientVisible: false },
    });
    assert.equal(hidden, 0, 'aucune entree interne ne doit apparaitre sur le dossier client');

    // L'audit est ecrit hors transaction (best effort) mais avant la reponse.
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'PROSPECT_CONVERTED', entityId: target },
    });

    assert.ok(audit, 'la conversion doit etre auditee');
    assert.equal(audit.actorId, salesUserId);

    // L'auteur est le responsable : il ne se notifie pas lui-meme.
    //
    // La recherche porte sur LE CLIENT QUE CETTE CONVERSION VIENT DE CREER, et
    // non sur la boite entiere du commercial. C'est la notification que le
    // service ecrirait s'il notifiait l'auteur (`entityType: 'Client'`,
    // `entityId: client.id`, voir `prospects.service.ts`), donc exactement ce
    // que cette assertion doit interdire.
    //
    // Interroger la boite entiere rendrait le test dependant d'un etat PARTAGE :
    // la route publique `/public/contact-requests` notifie les porteurs ACTIVE
    // des roles ADMIN et SALES — jusqu'a vingt (`contact-request.service.ts`,
    // `notifyAgency`). Une execution concurrente qui depose une demande de
    // contact remplit donc legitimement la boite de ce commercial, et le test
    // echouerait sur une fixture qui ne lui appartient pas.
    const selfNotification = await prisma.notification.findFirst({
      where: { userId: salesUserId, entityId: client.id },
    });
    assert.equal(selfNotification, null, 'on ne notifie pas l auteur de sa propre action');
  });

  it('notifie le responsable quand ce n est pas l auteur de la conversion', async () => {
    const created = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects`)
      .set(bearer(salesToken))
      .send({
        companyName: P3_NAME,
        contactFirstName: 'Alice',
        contactLastName: 'Bernard',
        email: 'alice.bernard@e2e-crm.example',
        ownerId: adminUserId,
      });

    assert.equal(created.status, 201);
    const prospect = (created.body as SuccessBody<ProspectData>).data;
    createdProspectIds.push(prospect.id);
    assert.equal(prospect.ownerId, adminUserId);

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects/${prospect.id}/convert`)
      .set(bearer(salesToken));

    assert.equal(response.status, 200);
    const client = (response.body as SuccessBody<ConversionData>).data.client;

    const notification = await prisma.notification.findFirst({
      where: { userId: adminUserId, entityId: client.id },
    });

    assert.ok(notification, 'le responsable du prospect doit etre prevenu');
    assert.equal(notification.type, NotificationType.SYSTEM);
    assert.equal(notification.entityType, 'Client');
  });

  it('REFUSE une seconde conversion sans creer de second client (idempotence par refus)', async () => {
    const target = first(createdProspectIds, 'prospect converti');

    const firstRead = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${target}`)
      .set(bearer(salesToken));

    const clientId = (firstRead.body as SuccessBody<ProspectData>).data.convertedClientId;
    assert.ok(clientId, 'le prospect doit deja etre converti a ce stade');

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects/${target}/convert`)
      .set(bearer(salesToken));

    assert.equal(response.status, 409);
    assert.equal(errorOf(response).code, 'PROSPECT_ALREADY_CONVERTED');

    // LE CONTROLE QUI COMPTE : aucun second dossier n'a ete cree. Un 409 seul ne
    // prouverait rien — la garantie vient du compare-and-swap sur
    // `convertedClientId`, qui annule la transaction entiere de l'appel perdant,
    // donc le client qu'elle venait de creer.
    const search = await request(app.getHttpServer())
      .get(`${baseUrl}/clients?search=${encodeURIComponent(P1_NAME)}`)
      .set(bearer(salesToken));

    assert.equal(search.status, 200);
    const page = search.body as SuccessBody<ClientData[]>;
    assert.equal(page.meta?.total, 1, 'un seul dossier client doit exister pour ce prospect');

    const after = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${target}`)
      .set(bearer(salesToken));

    assert.equal((after.body as SuccessBody<ProspectData>).data.convertedClientId, clientId);
  });

  // ---------------------------------------------------------------------------
  // CONTACTS — l'interlocuteur principal, et les 404 francs
  // ---------------------------------------------------------------------------

  it('ne laisse qu un seul contact principal par dossier', async () => {
    const created = await request(app.getHttpServer())
      .post(`${baseUrl}/clients/${otherClientId}/contacts`)
      .set(bearer(salesToken))
      .send({ firstName: 'Seconde', lastName: 'Interlocutrice', isPrimary: true });

    assert.equal(created.status, 201);
    const newPrimary = (created.body as SuccessBody<ContactData>).data;
    assert.equal(newPrimary.isPrimary, true);

    const list = await request(app.getHttpServer())
      .get(`${baseUrl}/clients/${otherClientId}/contacts`)
      .set(bearer(salesToken));

    const page = list.body as SuccessBody<ContactData[]>;
    const primaries = page.data.filter((contact) => contact.isPrimary);
    assert.equal(primaries.length, 1, 'un dossier ne doit jamais avoir deux principaux');
    assert.equal(primaries[0]?.id, newPrimary.id);
    assert.equal(
      first(page.data, 'contacts du dossier tiers').id,
      newPrimary.id,
      'le principal doit etre servi en tete de liste',
    );

    // L'ancien principal a perdu son drapeau, sans etre supprime.
    const previous = page.data.find((contact) => contact.id === otherContactId);
    assert.ok(previous, 'le premier interlocuteur doit toujours exister');
    assert.equal(previous.isPrimary, false);
  });

  it('modifie puis supprime logiquement un contact', async () => {
    const renamed = await request(app.getHttpServer())
      .patch(`${baseUrl}/contacts/${otherContactId}`)
      .set(bearer(salesToken))
      .send({ jobTitle: 'Directeur des achats' });

    assert.equal(renamed.status, 200);
    const body = (renamed.body as SuccessBody<ContactData>).data;
    assert.equal(body.jobTitle, 'Directeur des achats');
    assert.equal(body.firstName, 'Premier', 'un champ absent ne doit pas etre efface');

    const removed = await request(app.getHttpServer())
      .delete(`${baseUrl}/contacts/${otherContactId}`)
      .set(bearer(salesToken));

    assert.equal(removed.status, 200);
    assert.deepEqual((removed.body as SuccessBody<{ deleted: true }>).data, { deleted: true });

    // Suppression LOGIQUE : la ligne reste, elle disparait des lectures.
    const afterDelete = await request(app.getHttpServer())
      .patch(`${baseUrl}/contacts/${otherContactId}`)
      .set(bearer(salesToken))
      .send({ firstName: 'Ressuscite' });

    assert.equal(afterDelete.status, 404);
    assert.equal(errorOf(afterDelete).code, 'CONTACT_NOT_FOUND');

    const list = await request(app.getHttpServer())
      .get(`${baseUrl}/clients/${otherClientId}/contacts`)
      .set(bearer(salesToken));

    const page = list.body as SuccessBody<ContactData[]>;
    assert.equal(
      page.data.some((contact) => contact.id === otherContactId),
      false,
      'un contact supprime ne doit plus apparaitre',
    );
  });

  it('repond 404 sur un dossier ou un contact inconnu, plutot qu une violation de contrainte', async () => {
    const onUnknownClient = await request(app.getHttpServer())
      .post(`${baseUrl}/clients/${UNKNOWN_ID}/contacts`)
      .set(bearer(salesToken))
      .send({ firstName: 'Sans', lastName: 'Dossier' });

    assert.equal(onUnknownClient.status, 404);
    assert.equal(errorOf(onUnknownClient).code, 'CLIENT_NOT_FOUND');

    const unknownContact = await request(app.getHttpServer())
      .patch(`${baseUrl}/contacts/${UNKNOWN_ID}`)
      .set(bearer(salesToken))
      .send({ firstName: 'Inconnu' });

    assert.equal(unknownContact.status, 404);
    assert.equal(errorOf(unknownContact).code, 'CONTACT_NOT_FOUND');

    const unknownClient = await request(app.getHttpServer())
      .get(`${baseUrl}/clients/${UNKNOWN_ID}`)
      .set(bearer(salesToken));

    assert.equal(unknownClient.status, 404);
    assert.equal(errorOf(unknownClient).code, 'CLIENT_NOT_FOUND');

    const unknownProspect = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${UNKNOWN_ID}`)
      .set(bearer(salesToken));

    assert.equal(unknownProspect.status, 404);
    assert.equal(errorOf(unknownProspect).code, 'PROSPECT_NOT_FOUND');
  });

  it('refuse un responsable de compte inconnu en 422, pas en 500', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/clients`)
      .set(bearer(salesToken))
      .send({ companyName: `${MARKER} Responsable client inconnu`, accountManagerId: UNKNOWN_ID });

    assert.equal(response.status, 422);
    assert.equal(errorOf(response).code, 'CLIENT_ACCOUNT_MANAGER_NOT_FOUND');
  });

  // ---------------------------------------------------------------------------
  // SUPPRESSION — logique, refusee si converti, reservee a l administration
  // ---------------------------------------------------------------------------

  it("refuse la suppression a un commercial : le catalogue ne donne `prospect:delete:any` qu'a l administrateur", async () => {
    const target = second(createdProspectIds);

    const response = await request(app.getHttpServer())
      .delete(`${baseUrl}/prospects/${target}`)
      .set(bearer(salesToken));

    assert.equal(response.status, 403);
    assert.equal(errorOf(response).code, 'FORBIDDEN');
  });

  it('supprime logiquement un prospect, et le retire des lectures', async () => {
    const target = second(createdProspectIds);

    const response = await request(app.getHttpServer())
      .delete(`${baseUrl}/prospects/${target}`)
      .set(bearer(adminToken));

    assert.equal(response.status, 200);
    assert.deepEqual((response.body as SuccessBody<{ deleted: true }>).data, { deleted: true });

    const read = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${target}`)
      .set(bearer(salesToken));

    assert.equal(read.status, 404, 'un prospect supprime ne doit plus etre lisible');

    const history = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${target}/history`)
      .set(bearer(salesToken));

    assert.equal(history.status, 404, "le journal d'un prospect supprime n'est plus servi");

    const search = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects?search=${encodeURIComponent(P2_NAME)}`)
      .set(bearer(salesToken));

    assert.equal((search.body as SuccessBody<ProspectData[]>).meta?.total, 0);

    // Suppression LOGIQUE : la ligne reste en base, marquee.
    const row = await prisma.prospect.findUnique({
      where: { id: target },
      select: { deletedAt: true },
    });

    assert.ok(row?.deletedAt, 'la ligne doit subsister, avec sa date de suppression');

    // Et supprimer une fiche deja supprimee n'est pas une seconde suppression.
    const again = await request(app.getHttpServer())
      .delete(`${baseUrl}/prospects/${target}`)
      .set(bearer(adminToken));

    assert.equal(again.status, 404);
  });

  it("refuse de supprimer un prospect converti : il est l'origine d'un dossier client", async () => {
    const target = first(createdProspectIds, 'prospect converti');

    const response = await request(app.getHttpServer())
      .delete(`${baseUrl}/prospects/${target}`)
      .set(bearer(adminToken));

    assert.equal(response.status, 409);
    assert.equal(errorOf(response).code, 'PROSPECT_CONVERTED_NOT_DELETABLE');
  });

  // ---------------------------------------------------------------------------
  // DEMANDE DE CONTACT -> PROSPECT — l'anneau VISITEUR -> PROSPECT
  //
  // La chaine exigee est : VISITEUR -> prise de contact -> PROSPECT -> ... Elle
  // etait ouverte a son premier anneau : rien ne convertissait une
  // `ContactRequest` en `Prospect`, et `contactrequest:convert:any` existait au
  // catalogue sans qu'aucune route ne le porte. Ces scenarios ferment l'anneau
  // par HTTP, sur la vraie base, et verifient qu'il ne peut pas se fermer deux
  // fois pour la meme demande.
  // ---------------------------------------------------------------------------

  it("convertit une demande de contact en prospect : le formulaire public ouvre enfin une piste", async () => {
    // 1. LE VISITEUR, sans jeton, remplit le formulaire public. C'est le seul
    //    envoi de ce fichier qui passe par la route publique : elle est quotaee,
    //    et les autres fixtures de ce scenario sont ecrites en base (voir
    //    `createRequest`).
    const submitted = await request(app.getHttpServer())
      .post(`${baseUrl}/public/contact-requests`)
      .send({
        firstName: 'Camille',
        lastName: 'Ferrand',
        email: REQUEST_EMAIL_ALPHA,
        phone: '+33 5 56 00 00 07',
        companyName: REQUEST_COMPANY_ALPHA,
        jobTitle: 'Directrice',
        website: 'https://atelier-e2e.example',
        subject: 'Refonte du site vitrine',
        message:
          'Bonjour, nous souhaitons refondre notre site vitrine et le rendre multilingue.',
        budgetRange: BudgetRange.FROM_15K_TO_30K,
        source: 'e2e-crm',
      });

    assert.equal(
      submitted.status,
      201,
      `formulaire public : ${submitted.status} ${JSON.stringify(submitted.body)}`,
    );

    // La reponse publique ne porte NI l'identifiant NI la reference (c'est
    // verifie par `content.e2e-spec.ts`). La demande est donc retrouvee EN BASE,
    // par son adresse : c'est aussi ce qui prouve que la conversion part d'une
    // ligne reellement ecrite par le formulaire, et non d'une fixture.
    const demande = await prisma.contactRequest.findFirstOrThrow({
      where: { email: REQUEST_EMAIL_ALPHA },
    });
    createdContactRequestIds.push(demande.id);

    assert.match(demande.reference, /^CTR-\d{4}-\d{4,}$/, 'reference CTR attendue');
    assert.equal(demande.status, ContactRequestStatus.NEW);
    assert.equal(demande.convertedProspectId, null);

    // 2. L'AGENCE CONVERTIT. La permission exigee est `contactrequest:convert:any`.
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/contact-requests/${demande.id}/convert`)
      .set(bearer(salesToken));

    assert.equal(
      response.status,
      200,
      `conversion : ${response.status} ${JSON.stringify(response.body)}`,
    );

    const data = (response.body as SuccessBody<ConversionFromRequestData>).data;
    const prospect = data.prospect;
    createdProspectIds.push(prospect.id);

    // 3. LA PISTE EXISTE, numerotee par le compteur partage, et marquee a sa
    //    source.
    assert.match(prospect.reference, /^PRO-\d{4}-\d{4,}$/, 'reference PRO- attendue');
    assert.equal(prospect.source, LeadSource.CONTACT_FORM);
    assert.equal(prospect.status, LeadStatus.NEW);
    assert.equal(prospect.convertedClientId, null, 'une piste n est pas un dossier client');

    // Les coordonnees sont celles de la demande, sans reinterpretation.
    assert.equal(prospect.companyName, REQUEST_COMPANY_ALPHA);
    assert.equal(prospect.contactFirstName, 'Camille');
    assert.equal(prospect.contactLastName, 'Ferrand');
    assert.equal(prospect.email, REQUEST_EMAIL_ALPHA);
    assert.equal(prospect.phone, '+33 5 56 00 00 07');
    assert.equal(prospect.jobTitle, 'Directrice');
    assert.equal(prospect.website, 'https://atelier-e2e.example');
    assert.equal(prospect.budgetRange, BudgetRange.FROM_15K_TO_30K);

    // Le message du visiteur suit la fiche : c'est ce que le commercial lira.
    assert.ok(prospect.notes?.includes(demande.reference), 'les notes citent la demande d origine');
    assert.ok(prospect.notes?.includes('Refonte du site vitrine'), 'le sujet suit');
    assert.ok(prospect.notes?.includes('multilingue'), 'le message suit');

    // 4. LA DEMANDE EST CONVERTIE, HORODATEE, ET RATTACHEE.
    assert.equal(data.contactRequest.status, ContactRequestStatus.CONVERTED);
    assert.equal(data.contactRequest.convertedProspectId, prospect.id);
    assert.ok(data.contactRequest.convertedAt, 'la date de conversion doit etre posee');

    // Personne n'avait ouvert la demande : l'auteur de la conversion en devient a
    // la fois le responsable et le premier traitant.
    assert.equal(prospect.ownerId, salesUserId, 'sans responsable, la piste revient a l auteur');
    assert.equal(data.contactRequest.handledById, salesUserId);
    assert.ok(data.contactRequest.handledAt, 'la premiere prise en charge est horodatee');

    // 5. LE LIEN SE LIT DANS LES DEUX SENS, par l'API.
    const fromRequest = await request(app.getHttpServer())
      .get(`${baseUrl}/contact-requests/${demande.id}`)
      .set(bearer(salesToken));

    assert.equal(fromRequest.status, 200);
    assert.equal(
      (fromRequest.body as SuccessBody<ContactRequestData>).data.convertedProspectId,
      prospect.id,
      'la demande doit pointer vers le prospect',
    );

    const fromProspect = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${prospect.id}`)
      .set(bearer(salesToken));

    assert.equal(fromProspect.status, 200);
    assert.equal(
      (fromProspect.body as SuccessBody<ProspectData>).data.reference,
      prospect.reference,
      'la fiche doit etre servie par la route de lecture du pipeline',
    );

    // Le sens prospect -> demande n'a pas de route dediee, et c'est normal : un
    // prospect peut naitre de plusieurs demandes. Il se verifie sur la relation
    // inverse `Prospect.contactReqs`, celle que le schema declare.
    const inverse = await prisma.prospect.findUniqueOrThrow({
      where: { id: prospect.id },
      select: { contactReqs: { select: { id: true } } },
    });

    assert.deepEqual(
      inverse.contactReqs.map((row) => row.id),
      [demande.id],
      'la fiche doit connaitre sa demande d origine',
    );

    // 6. LE JOURNAL D'ETAPES ET L'AUDIT.
    const history = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${prospect.id}/history`)
      .set(bearer(salesToken));

    assert.equal(history.status, 200);
    const page = history.body as SuccessBody<HistoryData[]>;
    assert.equal(page.meta?.total, 1, 'la conversion ecrit exactement une ligne de journal');

    const entry = first(page.data, 'journal du prospect issu de la demande');
    assert.equal(entry.fromStatus, null, 'une creation n a pas de statut precedent');
    assert.equal(entry.toStatus, LeadStatus.NEW);
    assert.equal(entry.changedById, salesUserId);
    assert.ok(entry.note?.includes(demande.reference), 'la ligne cite la demande d origine');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'CONTACT_REQUEST_CONVERTED', entityId: demande.id },
    });

    assert.ok(audit, 'la conversion doit etre auditee');
    assert.equal(audit.actorId, salesUserId);
    assert.equal(audit.entityType, 'ContactRequest');

    // 7. LE TEMOIN D'ACTIVITE. Il est INTERNE : il n'y a pas encore de client, et
    //    le pipeline commercial n'est pas le fil que le client lit.
    const activity = await prisma.activity.findFirst({
      where: {
        actorId: salesUserId,
        metadata: { path: ['contactRequestId'], equals: demande.id },
      },
    });

    assert.ok(activity, 'la conversion doit laisser une trace dans le fil');
    assert.equal(activity.isClientVisible, false);
    assert.equal(activity.clientId, null);
    assert.equal(activity.type, ActivityType.MILESTONE_REACHED);

    // 8. UNE SECONDE CONVERSION EST REFUSEE, ET NE CREE RIEN.
    const again = await request(app.getHttpServer())
      .post(`${baseUrl}/contact-requests/${demande.id}/convert`)
      .set(bearer(salesToken));

    assert.equal(again.status, 409, 'une demande deja convertie ne se convertit pas deux fois');
    assert.equal(errorOf(again).code, 'CONTACT_REQUEST_ALREADY_CONVERTED');

    // LE CONTROLE QUI COMPTE : aucun second prospect. Un 409 seul ne prouverait
    // rien — la garantie vient du compare-and-swap sur `convertedProspectId`, qui
    // annule la transaction entiere de l'appel perdant, donc la fiche qu'elle
    // venait de creer et le numero PRO- qu'elle venait de consommer.
    const search = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects?search=${encodeURIComponent(REQUEST_COMPANY_ALPHA)}`)
      .set(bearer(salesToken));

    assert.equal(search.status, 200);
    assert.equal(
      (search.body as SuccessBody<ProspectData[]>).meta?.total,
      1,
      'un seul prospect doit exister pour cette demande',
    );
  });

  it("n'ouvre la conversion ni a l'espace client, ni sans jeton", async () => {
    // Le role CLIENT ne detient aucun code `contactrequest:*` : la porte se ferme
    // au garde de permissions, avant le service — et le service la refermerait de
    // toute facon sur le ROLE (`assertInternalSpace`). Deux verrous, comme
    // partout dans ce module.
    const forbidden = await request(app.getHttpServer())
      .post(`${baseUrl}/contact-requests/${UNKNOWN_ID}/convert`)
      .set(bearer(clientToken));

    assert.equal(forbidden.status, 403);
    assert.equal(errorOf(forbidden).code, 'FORBIDDEN');

    const anonymous = await request(app.getHttpServer())
      .post(`${baseUrl}/contact-requests/${UNKNOWN_ID}/convert`);

    assert.equal(anonymous.status, 401);
  });

  it('repond 404 sur une demande inconnue ou retiree de la file, jamais 500', async () => {
    const unknown = await request(app.getHttpServer())
      .post(`${baseUrl}/contact-requests/${UNKNOWN_ID}/convert`)
      .set(bearer(salesToken));

    assert.equal(unknown.status, 404);
    assert.equal(errorOf(unknown).code, 'CONTACT_REQUEST_NOT_FOUND');

    // Une demande RETIREE de la file (suppression logique) ne se convertit pas :
    // la ligne existe encore en base, mais l'agence l'a explicitement ecartee, et
    // en faire une piste contredirait ce geste.
    const retired = await createRequest({
      email: REQUEST_EMAIL_BETA,
      companyName: REQUEST_COMPANY_BETA,
    });

    const removed = await request(app.getHttpServer())
      .delete(`${baseUrl}/contact-requests/${retired.id}`)
      .set(bearer(salesToken));

    assert.equal(removed.status, 200);

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/contact-requests/${retired.id}/convert`)
      .set(bearer(salesToken));

    assert.equal(response.status, 404);
    assert.equal(errorOf(response).code, 'CONTACT_REQUEST_NOT_FOUND');

    // Le refus n'a rien ecrit : la demande est toujours retiree, sans prospect.
    const row = await prisma.contactRequest.findUniqueOrThrow({
      where: { id: retired.id },
      select: { status: true, convertedProspectId: true, deletedAt: true },
    });

    assert.equal(row.convertedProspectId, null);
    assert.ok(row.deletedAt);
  });

  it("attribue la piste au traitant de la demande, et ne notifie pas l'auteur de sa propre action", async () => {
    const demande = await createRequest({
      email: REQUEST_EMAIL_HANDLED,
      companyName: REQUEST_COMPANY_HANDLED,
      subject: 'Audit de performance',
    });

    // L'administrateur ouvre la demande : `update` horodate la PREMIERE prise en
    // charge. C'est ce fait, deja en base, qui decide du responsable de la piste.
    const handled = await request(app.getHttpServer())
      .patch(`${baseUrl}/contact-requests/${demande.id}`)
      .set(bearer(adminToken))
      .send({ status: ContactRequestStatus.IN_REVIEW, notes: 'Prise en charge.' });

    assert.equal(handled.status, 200);
    assert.equal(
      (handled.body as SuccessBody<ContactRequestData>).data.handledById,
      adminUserId,
    );

    // C'est le COMMERCIAL qui convertit, pas le traitant.
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/contact-requests/${demande.id}/convert`)
      .set(bearer(salesToken));

    assert.equal(
      response.status,
      200,
      `conversion : ${response.status} ${JSON.stringify(response.body)}`,
    );

    const data = (response.body as SuccessBody<ConversionFromRequestData>).data;
    createdProspectIds.push(data.prospect.id);

    assert.equal(
      data.prospect.ownerId,
      adminUserId,
      'la piste revient a celui qui avait traite la demande',
    );
    // Le traitant d'origine n'est pas ecrase par celui qui convertit : « qui a
    // traite cette demande » doit garder sa reponse.
    assert.equal(data.contactRequest.handledById, adminUserId);

    // Le responsable est prevenu...
    const notification = await prisma.notification.findFirst({
      where: { userId: adminUserId, entityId: data.prospect.id },
    });

    assert.ok(notification, 'le responsable de la piste doit etre prevenu');
    assert.equal(notification.type, NotificationType.SYSTEM);
    assert.equal(notification.entityType, 'Prospect');

    // ...et l'AUTEUR de la conversion ne se notifie pas lui-meme : il vient de
    // lire le resultat de son propre appel.
    const selfNotification = await prisma.notification.findFirst({
      where: { userId: salesUserId, entityId: data.prospect.id },
    });

    assert.equal(selfNotification, null, 'on ne notifie pas l auteur de sa propre action');
  });
});

/**
 * Second identifiant cree, avec le meme controle que `first`.
 *
 * Les scenarios partagent l'ordre des creations : la deuxieme fiche est celle que
 * les transitions deplacent, puis que l'administrateur supprime a la fin.
 */
function second(ids: readonly string[]): string {
  const value = ids[1];
  if (value === undefined) {
    assert.fail('le second prospect devrait exister a ce stade du parcours');
  }
  return value;
}
