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
import { REFERENCE_SCOPES } from '../src/common/references/reference.scopes.js';
import { hashPassword, passwordPolicyViolation } from '../src/common/security/password.js';
import { CounterService } from '../src/modules/counters/counter.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * DEVIS → FACTURE → PAIEMENT : parcours de bout en bout, sur la VRAIE base.
 *
 * Ce fichier ne simule rien. Il demarre l'application complete (`AppModule`),
 * configuree par le MEME `configureApp` que `main.ts`, connectee a la base
 * PostgreSQL reelle, et parle en HTTP. Chaque requete traverse donc reellement
 * `ThrottlerGuard`, `JwtAuthGuard`, `PermissionsGuard`, `ValidationPipe`, le
 * controleur, le service, Prisma, le filtre d'exceptions et l'intercepteur
 * d'enveloppe.
 *
 * POURQUOI CE TEST EXISTE, ALORS QUE LES REGLES SONT DEJA TESTEES EN UNITAIRE.
 * Les specs unitaires (`money.spec.ts`, `invoice-state.spec.ts`,
 * `quote-state.spec.ts`) verifient des FONCTIONS : un calcul, une table de
 * transitions. Elles ne peuvent pas verifier ce qui fait la valeur de ce module :
 *
 *  1. LE VERROU. Le plafond de paiement tient-il quand deux encaissements
 *     arrivent en meme temps ? Cela depend d'un `SELECT … FOR UPDATE` et du
 *     niveau d'isolation de PostgreSQL. Un faux Prisma repondrait toujours oui.
 *  2. LA CONTRAINTE D'UNICITE. L'acceptation d'un devis est idempotente parce que
 *     `Project.quoteId` est `@unique`. Seule une vraie base le dit.
 *  3. LE PERIMETRE CLIENT. « Un client ne doit jamais pouvoir modifier l'ID d'un
 *     autre client dans une requete pour acceder a ses donnees. » C'est une
 *     exigence explicite du client, elle se verifie avec DEUX comptes reels et
 *     deux dossiers reels, pas avec un mock qui rend la meme ligne a tout le
 *     monde.
 *  4. LE COMPTEUR. Deux documents ne doivent jamais partager une reference,
 *     meme sous concurrence, et la numerotation doit repartir a 0001 en changeant
 *     d'annee. L'increment atomique est une instruction SQL.
 *
 * DEPENDANCE ASSUMEE : une base joignable (`DATABASE_URL`). Le test cree ses
 * propres clients (`e2e-billing-…`), ses propres comptes (`e2e-billing-…`) et ses
 * propres pieces, puis les supprime dans `after()`. Il ne touche a AUCUNE donnee
 * existante — a une exception documentee pres : il consomme des numeros de
 * compteur, comme le ferait l'API en production, et il ne les rend pas. Une
 * sequence comptable peut sauter sans perdre sa validite ; en revanche, un test
 * qui remettrait les compteurs en arriere ferait collisionner les references
 * qu'un autre test vient de consommer.
 *
 * PRECONDITION D'EXECUTION (elle est remplie) : `AppModule` monte `QuotesModule`,
 * `InvoicesModule` et `PaymentsModule` — les trois importent `CountersModule`
 * pour la numerotation, donc `app.get(CounterService)` resout aussi. Ce fichier
 * ne monte PAS ces modules lui-meme, et c'est volontaire : il doit eprouver
 * l'application telle qu'elle est assemblee, pas une application de test montee a
 * la main. Le jour ou l'un des trois sort de `imports`, les routes de ce fichier
 * repondent 404 et le premier echec le dit sans ambiguite.
 *
 * ATTENTION AU LIMITEUR DE DEBIT : la route de connexion est plafonnee a 10
 * appels par minute et par adresse IP. Ce fichier ouvre DEUX sessions (un
 * administrateur et un compte client) et les reutilise ensuite. Ajouter des
 * connexions ici sans regarder ce compteur produirait des echecs a 429,
 * intermittents et difficiles a lire.
 *
 * LES `it` DE CE FICHIER SE SUIVENT, ILS NE SONT PAS INDEPENDANTS. `node:test`
 * execute les tests d'un meme `describe` dans l'ordre du fichier, et ce fichier
 * raconte UNE HISTOIRE : un brouillon, un envoi, une acceptation, une facture,
 * des encaissements, une annulation. Chaque etape laisse la base dans l'etat ou
 * l'etape suivante la prend — c'est le seul moyen d'eprouver une machine a etats
 * de bout en bout sans rejouer le parcours complet a chaque `it`. Les lancer
 * isolement, ou dans un ordre aleatoire, n'a donc pas de sens : ce n'est pas une
 * fragilite, c'est la nature d'un test de PARCOURS. Les tests qui, eux, doivent
 * etre independants de tout etat sont dans les specs unitaires.
 */

const PASSWORD = 'Falaise-Quartz-Vertige-58-Cobalt';

const ADMIN_EMAIL = 'e2e-billing-admin@comexa.example';
const PORTAL_EMAIL = 'e2e-billing-portal@comexa.example';

const CLIENT_A_REFERENCE = 'E2EBILA-2026-0001';
const CLIENT_B_REFERENCE = 'E2EBILB-2026-0001';

/**
 * LES JEUX DE MONTANTS SONT CHOISIS POUR ETRE EXACTS AU CENTIME, sans arrondi.
 * Un test qui n'est vrai qu'a condition d'arrondir au bon moment ne prouve pas
 * que le serveur calcule juste : il prouve qu'il arrondit comme le test.
 *
 * Devis A1 (apres modification) : 1 x 1 000,00 HT, TVA 20 % -> 1 200,00 TTC.
 * Le solde se lit donc directement : 400 encaisse, 800 dus.
 */
const QUOTE_A1_LINES = [
  { title: 'Ligne initiale', quantity: 1, unitPrice: 1000 },
  { title: 'Ligne a retirer', quantity: 2, unitPrice: 250.5, discountPercent: 10 },
];

/** Devis A2 : sert au double accepte simultane. 1 x 500,00 HT, sans TVA. */
const QUOTE_A2_LINES = [{ title: 'Prestation express', quantity: 1, unitPrice: 500 }];

/** Devis B : 1 x 2 000,00 HT, TVA 20 % -> 2 400,00 TTC. */
const QUOTE_B_LINES = [{ title: 'Prestation client B', quantity: 1, unitPrice: 2000 }];

/** Forme de succes, telle que `TransformInterceptor` la produit. */
interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: { page?: number; perPage?: number; total?: number; totalPages?: number };
}

/** Forme d'echec, telle que `AllExceptionsFilter` la produit. */
interface ErrorBody {
  success: false;
  error: { code: string; message: string; details: unknown };
}

interface QuotePayload {
  id: string;
  reference: string;
  status: string;
  clientId: string | null;
  currency: string;
  subtotal: unknown;
  discountAmount: unknown;
  taxAmount: unknown;
  total: unknown;
  items: { id: string; position: number; title: string; lineTotal: unknown }[];
}

interface InvoicePayload {
  id: string;
  reference: string;
  status: string;
  clientId: string;
  quoteId: string | null;
  projectId: string | null;
  currency: string;
  subtotal: unknown;
  taxAmount: unknown;
  total: unknown;
  amountPaid: unknown;
  paidAt: string | null;
  items: { position: number; title: string; lineTotal: unknown }[];
  client: { id: string };
}

interface PaymentPayload {
  id: string;
  reference: string;
  amount: unknown;
  currency: string;
  method: string;
  status: string;
  invoiceId: string;
  invoice: { id: string; reference: string; clientId: string; status: string };
}

interface PaymentResultPayload {
  payment: PaymentPayload;
  invoice: { id: string; status: string; amountPaid: string; total: string; balance: string };
}

interface AcceptancePayload {
  quoteId: string;
  status: string;
  clientId: string;
  projectId: string;
}

function errorOf(response: request.Response): ErrorBody['error'] {
  const body = response.body as ErrorBody;
  assert.equal(body.success, false, "une reponse d'echec doit porter success: false");
  return body.error;
}

/**
 * Un montant tel que le serveur l'a envoye, ramene a deux decimales.
 *
 * Les colonnes monetaires sont des `Decimal` : `JSON.stringify` les serialise en
 * CHAINE, et `Decimal.toString()` retire les zeros inutiles (« 1200 » pour
 * 1200,00). Comparer les chaines brutes serait donc fragile pour une raison qui
 * n'a rien a voir avec l'arithmetique testee. On repasse par un nombre, ce qui
 * est sans danger sur les ordres de grandeur de ce fichier, et on compare des
 * centimes.
 */
function amount(value: unknown): string {
  return Number(value).toFixed(2);
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

describe('Devis, factures et paiements (bout en bout, base reelle)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let counters: CounterService;
  let baseUrl: string;

  let adminToken = '';
  let portalToken = '';

  let clientAId = '';
  let clientBId = '';

  // Pieces creees par ce fichier, pour un nettoyage ordonne.
  let quoteA1Id = '';
  let quoteA2Id = '';
  let quoteBId = '';
  let invoiceA1Id = '';
  let invoiceBId = '';
  let projectA1Id = '';

  const createdUserIds: string[] = [];
  const createdQuoteIds: string[] = [];
  const createdInvoiceIds: string[] = [];

  before(async () => {
    const violation = passwordPolicyViolation(PASSWORD);
    assert.equal(violation, null, `mot de passe de test refuse par la politique : ${violation}`);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();

    // `nestjs-pino` noierait les echecs d'assertion sous des lignes JSON.
    app.useLogger(false);

    // LA ligne qui compte : la meme configuration que `main.ts`.
    const setup = configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    counters = app.get(CounterService);
    baseUrl = `/${setup.apiPrefix}`;

    const [adminRole, clientRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'CLIENT' }, select: { id: true } }),
    ]);

    const passwordHash = await hashPassword(PASSWORD);

    // Nettoyage preventif : un run precedent interrompu a pu laisser ses pieces.
    // L'ORDRE y est le meme que dans `after()`, et pour la meme raison :
    // `Quote.client`, `Project.client` et `Invoice.client` sont en `Restrict`, donc
    // un dossier client ne part pas tant qu'une piece le reference.
    const staleClients = await prisma.client.findMany({
      where: { reference: { in: [CLIENT_A_REFERENCE, CLIENT_B_REFERENCE] } },
      select: { id: true },
    });

    if (staleClients.length > 0) {
      const stale = { in: staleClients.map((client) => client.id) };

      await prisma.payment.deleteMany({ where: { invoice: { clientId: stale } } });
      await prisma.invoiceItem.deleteMany({ where: { invoice: { clientId: stale } } });
      await prisma.invoice.deleteMany({ where: { clientId: stale } });
      await prisma.project.deleteMany({ where: { clientId: stale } });
      await prisma.quoteItem.deleteMany({ where: { quote: { clientId: stale } } });
      await prisma.quote.deleteMany({ where: { clientId: stale } });
      await prisma.activity.deleteMany({ where: { clientId: stale } });
      await prisma.client.deleteMany({ where: { id: stale } });
    }

    const staleUsers = await prisma.user.findMany({
      where: { email: { in: [ADMIN_EMAIL, PORTAL_EMAIL] } },
      select: { id: true },
    });

    if (staleUsers.length > 0) {
      const staleUserIds = staleUsers.map((user) => user.id);

      await prisma.auditLog.deleteMany({ where: { actorId: { in: staleUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: staleUserIds } } });
    }

    const [clientA, clientB] = await Promise.all([
      prisma.client.create({
        data: { reference: CLIENT_A_REFERENCE, companyName: 'E2E Billing Client A' },
        select: { id: true },
      }),
      prisma.client.create({
        data: { reference: CLIENT_B_REFERENCE, companyName: 'E2E Billing Client B' },
        select: { id: true },
      }),
    ]);

    clientAId = clientA.id;
    clientBId = clientB.id;

    const [admin, portal] = await Promise.all([
      prisma.user.create({
        data: {
          email: ADMIN_EMAIL,
          passwordHash,
          firstName: 'Test',
          lastName: 'Billing Admin',
          status: 'ACTIVE',
          isEmailVerified: true,
          mustChangePassword: false,
          roles: { create: { roleId: adminRole.id } },
        },
        select: { id: true },
      }),
      // LE COMPTE DE L'ESPACE CLIENT, rattache au dossier A. C'est lui qui porte
      // le perimetre `own` : `policy.clientId` vient de ce rattachement, jamais
      // d'un identifiant de requete.
      prisma.user.create({
        data: {
          email: PORTAL_EMAIL,
          passwordHash,
          firstName: 'Test',
          lastName: 'Billing Portal',
          status: 'ACTIVE',
          isEmailVerified: true,
          mustChangePassword: false,
          clientId: clientAId,
          roles: { create: { roleId: clientRole.id } },
        },
        select: { id: true },
      }),
    ]);

    createdUserIds.push(admin.id, portal.id);

    const adminLogin = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: ADMIN_EMAIL, password: PASSWORD });

    assert.equal(adminLogin.status, 200, 'la connexion administrateur doit reussir');
    adminToken = (adminLogin.body as SuccessBody<{ accessToken: string }>).data.accessToken;

    const portalLogin = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: PORTAL_EMAIL, password: PASSWORD });

    assert.equal(portalLogin.status, 200, 'la connexion du compte client doit reussir');
    portalToken = (portalLogin.body as SuccessBody<{ accessToken: string }>).data.accessToken;

    // ---------------------------------------------------------------------
    // Fixtures des pieces : le devis de A1 et la facture de B.
    // ---------------------------------------------------------------------
    const a1 = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes`)
      .set(auth(adminToken))
      .send({
        subject: 'Refonte du site',
        clientId: clientAId,
        taxRate: 20,
        // Le devis est en EUROS : la facture qui en naîtra doit l'être aussi,
        // sans que la devise soit ressaisie. C'est le sens du test.
        currency: 'EUR',
        items: QUOTE_A1_LINES,
      });

    assert.equal(a1.status, 201, `creation du devis A1 : ${a1.status} ${JSON.stringify(a1.body)}`);
    quoteA1Id = (a1.body as SuccessBody<QuotePayload>).data.id;

    const a2 = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes`)
      .set(auth(adminToken))
      .send({
        subject: 'Prestation express',
        clientId: clientAId,
        taxRate: 0,
        items: QUOTE_A2_LINES,
      });

    assert.equal(a2.status, 201);
    quoteA2Id = (a2.body as SuccessBody<QuotePayload>).data.id;

    createdQuoteIds.push(quoteA1Id, quoteA2Id);

    // ---------------------------------------------------------------------
    // Devis de B, mene jusqu'a la facture ENVOYEE : c'est la piece que le
    // compte client A ne doit jamais pouvoir atteindre.
    // ---------------------------------------------------------------------
    const quoteB = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes`)
      .set(auth(adminToken))
      .send({
        subject: 'Prestation client B',
        clientId: clientBId,
        taxRate: 20,
        items: QUOTE_B_LINES,
      });

    assert.equal(quoteB.status, 201);
    quoteBId = (quoteB.body as SuccessBody<QuotePayload>).data.id;
    createdQuoteIds.push(quoteBId);

    const sentB = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteBId}/send`)
      .set(auth(adminToken))
      .send({});

    assert.equal(sentB.status, 201);

    const acceptedB = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteBId}/accept`)
      .set(auth(adminToken))
      .send({});

    assert.equal(acceptedB.status, 201);

    const invoiceB = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteBId}/invoice`)
      .set(auth(adminToken))
      .send({});

    assert.equal(invoiceB.status, 201);
    invoiceBId = (invoiceB.body as SuccessBody<InvoicePayload>).data.id;
    createdInvoiceIds.push(invoiceBId);

    const sentInvoiceB = await request(app.getHttpServer())
      .post(`${baseUrl}/invoices/${invoiceBId}/send`)
      .set(auth(adminToken))
      .send({});

    assert.equal(sentInvoiceB.status, 201);
  });

  after(async () => {
    if (!app) {
      return;
    }

    // ORDRE DE SUPPRESSION, impose par les cles etrangeres :
    //  - `Payment.invoice` et `InvoiceItem.invoice` sont en cascade, mais on les
    //    retire explicitement pour que le nettoyage reste lisible ;
    //  - `Invoice.quote` / `Invoice.project` sont en `SetNull`, donc les factures
    //    partent AVANT les projets, qui partent avant les devis ;
    //  - `Quote.client` et `Project.client` sont en `Restrict` : les dossiers
    //    clients ne peuvent partir qu'en dernier ;
    //  - `User.client` est en `SetNull`, et `Notification.user` en cascade.
    const clients = { in: [clientAId, clientBId] };

    await prisma.payment.deleteMany({ where: { invoice: { clientId: clients } } });
    await prisma.invoiceItem.deleteMany({ where: { invoice: { clientId: clients } } });
    await prisma.invoice.deleteMany({ where: { clientId: clients } });
    await prisma.project.deleteMany({ where: { clientId: clients } });
    await prisma.quoteItem.deleteMany({ where: { quote: { clientId: clients } } });
    await prisma.quote.deleteMany({ where: { clientId: clients } });

    await prisma.activity.deleteMany({
      where: { OR: [{ clientId: clients }, { actorId: { in: createdUserIds } }] },
    });

    // Les journaux d'audit ne se suppriment pas en cascade : on les retire pour
    // ne pas laisser de bruit dans la base partagee.
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } });

    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.client.deleteMany({ where: { id: clients } });

    // VERIFICATION DU NETTOYAGE. C'est la seule trace que ce fichier laisse
    // derriere lui : la base est partagee avec les autres suites, et une ligne
    // oubliee ferait echouer un AUTRE agent, plus tard, pour une raison qu'il ne
    // pourrait pas expliquer. Le controle porte sur les identifiants reellement
    // crees, pas sur un compte global : d'autres suites travaillent en parallele.
    assert.equal(
      await prisma.invoice.count({ where: { id: { in: createdInvoiceIds } } }),
      0,
      'des factures de test sont restees en base',
    );
    assert.equal(
      await prisma.quote.count({ where: { id: { in: createdQuoteIds } } }),
      0,
      'des devis de test sont restes en base',
    );
    assert.equal(
      await prisma.user.count({ where: { id: { in: createdUserIds } } }),
      0,
      'des comptes de test sont restes en base',
    );

    // Les compteurs de l'annee 2027/2028, ouverts par le seul test de bascule
    // d'annee. Ceux de l'annee courante RESTENT : ils ont ete consommes comme en
    // production, et les remettre en arriere ferait collisionner une reference
    // qu'un autre test (ou le seed) viendrait de poser. La suppression est
    // restreinte a MES portees : d'autres suites partagent cette base, et leurs
    // compteurs d'annees futures ne me regardent pas.
    await prisma.counter.deleteMany({
      where: {
        year: { in: [2027, 2028] },
        scope: {
          in: [
            REFERENCE_SCOPES.INVOICE,
            REFERENCE_SCOPES.PROJECT,
            REFERENCE_SCOPES.QUOTE,
            REFERENCE_SCOPES.PAYMENT,
          ],
        },
      },
    });

    await app.close();
  });

  it('refuse un devis sans ligne, et refuse un montant total dans le corps', async () => {
    // Deux refus, et le second est la regle la plus importante du module.
    const withoutLines = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes`)
      .set(auth(adminToken))
      .send({ subject: 'Devis vide', clientId: clientAId, items: [] });

    assert.equal(withoutLines.status, 400);
    assert.equal(errorOf(withoutLines).code, 'VALIDATION_FAILED');

    // UN TOTAL ENVOYE PAR LE CLIENT N'EST JAMAIS CRU, et le champ n'existe meme
    // pas dans le DTO : `forbidNonWhitelisted` le refuse au lieu de l'ignorer.
    const withTotal = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes`)
      .set(auth(adminToken))
      .send({
        subject: 'Devis a un euro',
        clientId: clientAId,
        total: 1,
        items: [{ title: 'Prestation', unitPrice: 40000 }],
      });

    assert.equal(withTotal.status, 400);
    assert.equal(errorOf(withTotal).code, 'VALIDATION_FAILED');
  });

  it('calcule les totaux du devis cote serveur, a partir des lignes seules', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/quotes/${quoteA1Id}`)
      .set(auth(adminToken));

    assert.equal(response.status, 200);
    const quote = (response.body as SuccessBody<QuotePayload>).data;

    assert.equal(quote.status, 'DRAFT');
    assert.match(quote.reference, /^DEV-\d{4}-\d{4,}$/);
    assert.equal(quote.clientId, clientAId);

    // 1 x 1 000,00 + 2 x 250,50 = 1 501,00 ; remise 10 % de 501,00 = 50,10 ;
    // net 1 450,90 ; TVA 20 % = 290,18 ; total 1 741,08. Calcules a la main, et
    // verifies au centime.
    assert.equal(amount(quote.subtotal), '1501.00');
    assert.equal(amount(quote.discountAmount), '50.10');
    assert.equal(amount(quote.taxAmount), '290.18');
    assert.equal(amount(quote.total), '1741.08');

    // L'INVARIANT : le total est la somme des totaux de lignes, plus la TVA.
    const lines = quote.items.map((item) => Number(item.lineTotal));
    const sumOfLines = lines.reduce((sum, value) => sum + value, 0);

    assert.equal(lines.length, 2);
    assert.equal(amount(sumOfLines), '1450.90');
    assert.equal(
      amount(Number(quote.total)),
      amount(Number(quote.subtotal) - Number(quote.discountAmount) + Number(quote.taxAmount)),
    );
    assert.equal(amount(sumOfLines), amount(Number(quote.subtotal) - Number(quote.discountAmount)));
    assert.deepEqual(
      quote.items.map((item) => item.position),
      [1, 2],
    );
  });

  it("refuse d'accepter un devis jamais envoye", async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteA1Id}/accept`)
      .set(auth(adminToken))
      .send({});

    // 409 et non 403 : le droit existe, c'est l'etat de la piece qui interdit.
    assert.equal(response.status, 409);
    assert.equal(errorOf(response).code, 'QUOTE_NOT_SENT');
  });

  it('reecrit un brouillon, puis le fige des l envoi', async () => {
    // Le remplacement complet des lignes doit RECALCULER les totaux : garder
    // l'ancien total avec de nouvelles lignes produirait un document faux, et
    // c'est exactement l'erreur qu'une mise a jour partielle fait naitre.
    const patched = await request(app.getHttpServer())
      .patch(`${baseUrl}/quotes/${quoteA1Id}`)
      .set(auth(adminToken))
      .send({ items: [{ title: 'Refonte du site', quantity: 1, unitPrice: 1000 }] });

    assert.equal(patched.status, 200);
    const quote = (patched.body as SuccessBody<QuotePayload>).data;

    assert.equal(amount(quote.subtotal), '1000.00');
    assert.equal(amount(quote.discountAmount), '0.00');
    assert.equal(amount(quote.taxAmount), '200.00');
    assert.equal(amount(quote.total), '1200.00');
    assert.equal(quote.items.length, 1);

    const sent = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteA1Id}/send`)
      .set(auth(adminToken))
      .send({});

    assert.equal(sent.status, 201);
    assert.equal((sent.body as SuccessBody<QuotePayload>).data.status, 'SENT');

    // Un renvoi redaterait un document que le client a peut-etre deja recu.
    const resent = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteA1Id}/send`)
      .set(auth(adminToken))
      .send({});

    assert.equal(resent.status, 409);
    assert.equal(errorOf(resent).code, 'QUOTE_NOT_SENDABLE');

    // Le devis est envoye : il ne se reecrit plus. C'est la regle qui fait
    // qu'un accord porte sur ce qui a ete signe.
    const rewrite = await request(app.getHttpServer())
      .patch(`${baseUrl}/quotes/${quoteA1Id}`)
      .set(auth(adminToken))
      .send({ subject: 'Autre chose' });

    assert.equal(rewrite.status, 409);
    assert.equal(errorOf(rewrite).code, 'QUOTE_NOT_EDITABLE');
  });

  it('accepte le devis : le projet nait avec quoteId, et une seconde acceptation est refusee', async () => {
    const accepted = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteA1Id}/accept`)
      .set(auth(adminToken))
      .send({});

    assert.equal(accepted.status, 201);
    const acceptance = (accepted.body as SuccessBody<AcceptancePayload>).data;

    assert.equal(acceptance.status, 'ACCEPTED');
    assert.equal(acceptance.clientId, clientAId);
    assert.ok(acceptance.projectId.length > 0, 'un projet doit naitre de l acceptation');
    projectA1Id = acceptance.projectId;

    // Le projet porte bien le devis, et son budget est COPIE du total.
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectA1Id },
      select: { reference: true, quoteId: true, budget: true, status: true, clientId: true },
    });

    assert.equal(project.quoteId, quoteA1Id);
    assert.equal(project.clientId, clientAId);
    assert.equal(project.status, 'PLANNED');
    assert.match(project.reference, /^PRJ-\d{4}-\d{4,}$/);
    assert.equal(amount(project.budget), '1200.00');

    // LE DOUBLE ACCEPTE, version sequentielle : la machine a etats le refuse
    // avant meme d'atteindre la contrainte d'unicite.
    const second = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteA1Id}/accept`)
      .set(auth(adminToken))
      .send({});

    assert.equal(second.status, 409);
    assert.equal(errorOf(second).code, 'QUOTE_ALREADY_ACCEPTED');

    // Et il n'y a QU'UN projet pour ce devis.
    const projectCount = await prisma.project.count({ where: { quoteId: quoteA1Id } });
    assert.equal(projectCount, 1);
  });

  it("refuse de facturer un devis qui n'est pas accepte", async () => {
    const sent = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteA2Id}/send`)
      .set(auth(adminToken))
      .send({});

    assert.equal(sent.status, 201);

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteA2Id}/invoice`)
      .set(auth(adminToken))
      .send({});

    assert.equal(response.status, 409);
    assert.equal(errorOf(response).code, 'QUOTE_NOT_INVOICEABLE');
  });

  it('ne fait naitre QU UN projet quand deux acceptations partent en meme temps', async () => {
    // LE test que le double accepte sequentiel ne peut pas faire. Ici, les deux
    // transactions lisent le devis AVANT que l'une des deux ne le passe en
    // `ACCEPTED` : la machine a etats les laisse donc toutes les deux passer, et
    // c'est la contrainte `@unique` sur `Project.quoteId` qui tranche.
    //
    // Sans elle, deux projets naitraient du meme devis — deux references, deux
    // lignes de suivi, deux fois le meme travail. C'est la difference entre un
    // `findFirst` avant creation (qui laisse passer les deux) et une contrainte
    // en base (qui n'en laisse passer qu'une).
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`${baseUrl}/quotes/${quoteA2Id}/accept`)
        .set(auth(adminToken))
        .send({}),
      request(app.getHttpServer())
        .post(`${baseUrl}/quotes/${quoteA2Id}/accept`)
        .set(auth(adminToken))
        .send({}),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);

    assert.deepEqual(statuses, [201, 409], `recu : ${JSON.stringify(statuses)}`);

    const failing = first.status === 409 ? first : second;
    assert.equal(errorOf(failing).code, 'QUOTE_ALREADY_ACCEPTED');

    // Les deux refus possibles — celui de la machine a etats et celui de la
    // contrainte — portent le MEME code, et c'est voulu : le frontend n'a qu'un
    // cas a traiter. Ce qui compte ici est le compte de projets.
    const projectCount = await prisma.project.count({ where: { quoteId: quoteA2Id } });
    assert.equal(projectCount, 1, 'un devis accepte ne doit produire qu un seul projet');
  });

  it('genere la facture du devis accepte en COPIANT ses lignes, sans montant ressaisi', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteA1Id}/invoice`)
      .set(auth(adminToken))
      .send({});

    assert.equal(response.status, 201);
    const invoice = (response.body as SuccessBody<InvoicePayload>).data;

    invoiceA1Id = invoice.id;
    createdInvoiceIds.push(invoiceA1Id);

    assert.equal(invoice.status, 'DRAFT');
    assert.match(invoice.reference, /^FAC-\d{4}-\d{4,}$/);
    assert.equal(invoice.quoteId, quoteA1Id);
    // La facture se rattache au projet ne de l'acceptation : c'est ce lien qui
    // permet le suivi financier du projet.
    assert.equal(invoice.projectId, projectA1Id);
    assert.equal(invoice.currency, 'EUR');

    // Les LIGNES sont celles du devis, au centime pres : aucun montant n'a ete
    // ressaisi, et le total n'est pas repris de l'enonce — il est recalcule.
    assert.equal(invoice.items.length, 1);
    assert.equal(invoice.items[0]?.title, 'Refonte du site');
    assert.equal(amount(invoice.items[0]?.lineTotal), '1000.00');
    assert.equal(amount(invoice.subtotal), '1000.00');
    assert.equal(amount(invoice.taxAmount), '200.00');
    assert.equal(amount(invoice.total), '1200.00');

    // Et DEUX factures du meme devis portent DEUX references : la numerotation
    // ne doit jamais rendre deux fois la meme chaine.
    const second = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteA1Id}/invoice`)
      .set(auth(adminToken))
      .send({});

    assert.equal(second.status, 201);
    const secondInvoice = (second.body as SuccessBody<InvoicePayload>).data;
    createdInvoiceIds.push(secondInvoice.id);

    assert.notEqual(secondInvoice.reference, invoice.reference);
    assert.match(secondInvoice.reference, /^FAC-\d{4}-\d{4,}$/);
  });

  it("n'encaisse rien sur un brouillon de facture", async () => {
    const draft = await request(app.getHttpServer())
      .post(`${baseUrl}/invoices/${invoiceA1Id}/payments`)
      .set(auth(adminToken))
      .send({ amount: 100, method: 'BANK_TRANSFER' });

    // Le client n'a jamais recu ce document : encaisser dessus ferait entrer de
    // l'argent sur une piece qui n'existe pas pour lui.
    assert.equal(draft.status, 409);
    assert.equal(errorOf(draft).code, 'INVOICE_NOT_PAYABLE');
  });

  it('envoie la facture, puis encaisse : solde, statut et reference de paiement', async () => {
    const sent = await request(app.getHttpServer())
      .post(`${baseUrl}/invoices/${invoiceA1Id}/send`)
      .set(auth(adminToken))
      .send({});

    assert.equal(sent.status, 201);
    assert.equal((sent.body as SuccessBody<InvoicePayload>).data.status, 'SENT');

    // Devise dans le corps : le champ n'existe pas dans le DTO. Un paiement se
    // fait dans la devise de sa facture, sinon il faudrait un taux de change.
    const withCurrency = await request(app.getHttpServer())
      .post(`${baseUrl}/invoices/${invoiceA1Id}/payments`)
      .set(auth(adminToken))
      .send({ amount: 100, method: 'BANK_TRANSFER', currency: 'USD' });

    assert.equal(withCurrency.status, 400);
    assert.equal(errorOf(withCurrency).code, 'VALIDATION_FAILED');

    const partial = await request(app.getHttpServer())
      .post(`${baseUrl}/invoices/${invoiceA1Id}/payments`)
      .set(auth(adminToken))
      .send({ amount: 400, method: 'BANK_TRANSFER', externalReference: 'VIR-E2E-0001' });

    assert.equal(partial.status, 201);
    const result = (partial.body as SuccessBody<PaymentResultPayload>).data;

    assert.match(result.payment.reference, /^PAY-\d{4}-\d{4,}$/);
    // Un encaissement SAISI est un encaissement CONSTATe : il nait reussi.
    assert.equal(result.payment.status, 'SUCCEEDED');
    assert.equal(result.payment.currency, 'EUR');
    assert.equal(result.payment.invoiceId, invoiceA1Id);
    assert.equal(amount(result.payment.amount), '400.00');

    // Le statut de la facture est RECALCULE, pas incremente.
    assert.equal(result.invoice.status, 'PARTIALLY_PAID');
    assert.equal(result.invoice.amountPaid, '400.00');
    assert.equal(result.invoice.total, '1200.00');
    assert.equal(result.invoice.balance, '800.00');
  });

  it('refuse un encaissement superieur au solde, en publiant le solde', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/invoices/${invoiceA1Id}/payments`)
      .set(auth(adminToken))
      .send({ amount: 800.01, method: 'CARD' });

    assert.equal(response.status, 422);
    const error = errorOf(response);
    assert.equal(error.code, 'PAYMENT_EXCEEDS_BALANCE');

    // Le frontend doit pouvoir afficher « il reste 800,00 a payer » sans
    // recharger la facture : les deux chiffres sont dans le refus.
    const details = error.details as { balance: string; amount: string };
    assert.equal(details.balance, '800.00');
    assert.equal(details.amount, '800.01');
  });

  it('solde la facture, puis REDESCEND le statut quand un encaissement est annule', async () => {
    const final = await request(app.getHttpServer())
      .post(`${baseUrl}/invoices/${invoiceA1Id}/payments`)
      .set(auth(adminToken))
      .send({ amount: 800, method: 'BANK_TRANSFER' });

    assert.equal(final.status, 201);
    const paid = (final.body as SuccessBody<PaymentResultPayload>).data;

    assert.equal(paid.invoice.status, 'PAID');
    assert.equal(paid.invoice.balance, '0.00');
    assert.equal(paid.invoice.amountPaid, '1200.00');

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceA1Id },
      select: { status: true, paidAt: true, amountPaid: true },
    });

    assert.equal(invoice.status, 'PAID');
    assert.ok(invoice.paidAt, 'une facture soldee porte une date d encaissement');

    // Une facture encaissee ne s'annule plus : la correction passe par un avoir.
    const cancelled = await request(app.getHttpServer())
      .post(`${baseUrl}/invoices/${invoiceA1Id}/cancel`)
      .set(auth(adminToken))
      .send({});

    assert.equal(cancelled.status, 409);
    assert.equal(errorOf(cancelled).code, 'INVOICE_NOT_CANCELLABLE');

    // On annule le DERNIER encaissement : la facture redevient partiellement
    // payee. C'est ici que se verifie, de bout en bout, que le statut se DERIVE
    // de la somme au lieu de ne jamais redescendre.
    const removed = await request(app.getHttpServer())
      .delete(`${baseUrl}/payments/${paid.payment.id}`)
      .set(auth(adminToken));

    assert.equal(removed.status, 200);

    const afterRemoval = await request(app.getHttpServer())
      .get(`${baseUrl}/invoices/${invoiceA1Id}`)
      .set(auth(adminToken));

    const backDown = (afterRemoval.body as SuccessBody<InvoicePayload>).data;

    assert.equal(backDown.status, 'PARTIALLY_PAID');
    assert.equal(amount(backDown.amountPaid), '400.00');
    assert.equal(backDown.paidAt, null, 'la date d encaissement doit avoir ete effacee');

    // Deuxieme annulation du meme paiement : la ligne est invisible, donc 404.
    const again = await request(app.getHttpServer())
      .delete(`${baseUrl}/payments/${paid.payment.id}`)
      .set(auth(adminToken));

    assert.equal(again.status, 404);

    // Et une facture non brouillon ne se supprime pas.
    const deleted = await request(app.getHttpServer())
      .delete(`${baseUrl}/invoices/${invoiceA1Id}`)
      .set(auth(adminToken));

    assert.equal(deleted.status, 409);
    assert.equal(errorOf(deleted).code, 'INVOICE_NOT_DELETABLE');
  });

  it("ne laisse pas un compte client atteindre le dossier d'un autre client", async () => {
    // L'EXIGENCE EXPLICITE DU CLIENT, mot pour mot : « Un client ne doit jamais
    // pouvoir modifier l'ID d'un autre client dans une requete pour acceder a ses
    // donnees. » Ce test attaque les trois chemins possibles, avec un compte
    // reellement rattache au dossier A.
    //
    // Un encaissement est d'abord pose sur la facture de B, pour que le test ne
    // soit pas vide au sens propre : il y a bien quelque chose a ne pas voir.
    const paymentOnB = await request(app.getHttpServer())
      .post(`${baseUrl}/invoices/${invoiceBId}/payments`)
      .set(auth(adminToken))
      .send({ amount: 1000, method: 'BANK_TRANSFER' });

    assert.equal(paymentOnB.status, 201);
    const paymentB = (paymentOnB.body as SuccessBody<PaymentResultPayload>).data;

    // 1. L'identifiant dans l'URL. La facture de B existe, elle est envoyee, elle
    //    porte un paiement — et elle est INVISIBLE : 404, jamais 403.
    const foreignInvoice = await request(app.getHttpServer())
      .get(`${baseUrl}/invoices/${invoiceBId}`)
      .set(auth(portalToken));

    assert.equal(foreignInvoice.status, 404);
    assert.equal(errorOf(foreignInvoice).code, 'INVOICE_NOT_FOUND');

    const foreignPayments = await request(app.getHttpServer())
      .get(`${baseUrl}/invoices/${invoiceBId}/payments`)
      .set(auth(portalToken));

    assert.equal(foreignPayments.status, 404);

    // 2. L'identifiant dans la CHAINE DE REQUETE. `?clientId=` est un filtre
    //    interne : pour un porteur `own`, le perimetre vient du COMPTE et le
    //    parametre est sans effet. La liste rendue est celle de A, et elle ne
    //    contient aucune piece de B.
    const requestedOther = await request(app.getHttpServer())
      .get(`${baseUrl}/invoices?clientId=${clientBId}`)
      .set(auth(portalToken));

    assert.equal(requestedOther.status, 200);
    const list = (requestedOther.body as SuccessBody<InvoicePayload[]>).data;

    assert.ok(
      list.length > 0,
      'le compte client doit voir SES factures — sinon ce test ne prouve rien',
    );
    for (const item of list) {
      assert.equal(item.clientId, clientAId, 'une facture hors perimetre a fuite dans la liste');
      assert.notEqual(item.id, invoiceBId);
    }

    // 3. Les PAIEMENTS : un paiement n'a pas de `clientId` a lui, il appartient
    //    au dossier de sa facture. Le filtre est donc une relation, et il tient.
    const payments = await request(app.getHttpServer())
      .get(`${baseUrl}/payments`)
      .set(auth(portalToken));

    assert.equal(payments.status, 200);
    const paymentList = (payments.body as SuccessBody<PaymentPayload[]>).data;

    assert.ok(paymentList.length > 0, 'le compte client doit voir SES encaissements');
    for (const item of paymentList) {
      assert.equal(
        item.invoice.clientId,
        clientAId,
        'un paiement hors perimetre a fuite dans la liste',
      );
      assert.notEqual(item.id, paymentB.payment.id);
    }

    // Le paiement de B par son identifiant : invisible aussi.
    const foreignPayment = await request(app.getHttpServer())
      .get(`${baseUrl}/payments/${paymentB.payment.id}`)
      .set(auth(portalToken));

    assert.equal(foreignPayment.status, 404);
    assert.equal(errorOf(foreignPayment).code, 'PAYMENT_NOT_FOUND');

    // 4. Et le devis de B, sur la meme mecanique.
    const foreignQuote = await request(app.getHttpServer())
      .get(`${baseUrl}/quotes/${quoteBId}`)
      .set(auth(portalToken));

    assert.equal(foreignQuote.status, 404);
    assert.equal(errorOf(foreignQuote).code, 'QUOTE_NOT_FOUND');

    // 5. Un compte client ne DECLARE pas de paiement : le catalogue ne porte pas
    //    de `payment:write:own`, donc le garde le refuse avant meme le service.
    const cannotPay = await request(app.getHttpServer())
      .post(`${baseUrl}/invoices/${invoiceA1Id}/payments`)
      .set(auth(portalToken))
      .send({ amount: 10, method: 'CASH' });

    assert.equal(cannotPay.status, 403);
    assert.equal(errorOf(cannotPay).code, 'FORBIDDEN');
  });

  it('annule une facture non encaissee et laisse la place a une nouvelle', async () => {
    // On annule l'encaissement restant : la facture repasse en SENT, donc
    // annulable. Une facture annulee ne bouge plus.
    const payments = await request(app.getHttpServer())
      .get(`${baseUrl}/invoices/${invoiceA1Id}/payments`)
      .set(auth(adminToken));

    assert.equal(payments.status, 200);
    const list = (payments.body as SuccessBody<PaymentPayload[]>).data;
    assert.equal(list.length, 1, 'il doit rester un encaissement a annuler');

    const remaining = list[0];
    assert.ok(remaining);

    const removed = await request(app.getHttpServer())
      .delete(`${baseUrl}/payments/${remaining.id}`)
      .set(auth(adminToken));

    assert.equal(removed.status, 200);

    const readBack = await request(app.getHttpServer())
      .get(`${baseUrl}/invoices/${invoiceA1Id}`)
      .set(auth(adminToken));

    const afterAll = (readBack.body as SuccessBody<InvoicePayload>).data;

    // Plus rien d'encaisse : la facture revient a son etat d'avant paiement.
    assert.equal(afterAll.status, 'SENT');
    assert.equal(amount(afterAll.amountPaid), '0.00');

    const cancelled = await request(app.getHttpServer())
      .post(`${baseUrl}/invoices/${invoiceA1Id}/cancel`)
      .set(auth(adminToken))
      .send({});

    assert.equal(cancelled.status, 201);
    assert.equal((cancelled.body as SuccessBody<InvoicePayload>).data.status, 'CANCELLED');

    // Une piece annulee ne se paie plus.
    const payCancelled = await request(app.getHttpServer())
      .post(`${baseUrl}/invoices/${invoiceA1Id}/payments`)
      .set(auth(adminToken))
      .send({ amount: 1, method: 'CASH' });

    assert.equal(payCancelled.status, 409);
    assert.equal(errorOf(payCancelled).code, 'INVOICE_NOT_PAYABLE');
  });

  it('ne rend JAMAIS deux fois la meme reference, meme sous concurrence', async () => {
    // Dix reservations simultanees sur la meme portee. C'est l'instruction
    // `UPDATE … SET value = value + 1` qui repond : le moteur incremente et
    // renvoie, sans fenetre entre la lecture et l'ecriture. Une lecture suivie
    // d'une ecriture donnerait ici plusieurs fois le meme numero, donc deux
    // paiements portant la meme reference — et la contrainte `@unique` les
    // refuserait plus tard, au pire endroit possible.
    const references = await Promise.all(
      Array.from({ length: 10 }, () => counters.reference({ scope: REFERENCE_SCOPES.PAYMENT })),
    );

    assert.equal(
      new Set(references).size,
      references.length,
      `collision : ${references.join(', ')}`,
    );

    for (const reference of references) {
      assert.match(reference, /^PAY-\d{4}-\d{4,}$/);
    }

    // Et les lignes de compteur existent bien en base, une par annee.
    const counter = await prisma.counter.findUnique({
      where: {
        scope_year: { scope: REFERENCE_SCOPES.PAYMENT, year: new Date().getFullYear() },
      },
      select: { value: true },
    });

    assert.ok(counter, 'la reservation doit avoir cree la ligne de compteur');
    assert.ok(
      counter.value >= references.length,
      'le compteur doit avoir avance de tous les numeros',
    );
  });

  it("repart a 0001 en changeant d'annee, sans toucher a l'annee en cours", async () => {
    // La portee est `(scope, year)` : changer d'annee, c'est changer de compteur.
    // Si l'annee n'etait pas dans la cle, le 1er janvier produirait
    // `FAC-2027-0042` — une reference dont la sequence appartient a l'annee
    // precedente, illisible pour un comptable.
    await prisma.counter.deleteMany({
      where: {
        year: { in: [2027, 2028] },
        scope: {
          in: [
            REFERENCE_SCOPES.INVOICE,
            REFERENCE_SCOPES.PROJECT,
            REFERENCE_SCOPES.QUOTE,
            REFERENCE_SCOPES.PAYMENT,
          ],
        },
      },
    });

    const first2027 = await counters.reference({ scope: REFERENCE_SCOPES.INVOICE, year: 2027 });
    const second2027 = await counters.reference({ scope: REFERENCE_SCOPES.INVOICE, year: 2027 });
    const first2028 = await counters.reference({ scope: REFERENCE_SCOPES.INVOICE, year: 2028 });

    assert.equal(first2027, 'FAC-2027-0001');
    assert.equal(second2027, 'FAC-2027-0002');
    // L'annee suivante repart de zero, independamment de la precedente.
    assert.equal(first2028, 'FAC-2028-0001');

    // Et un projet ouvert en 2027 ne consomme pas le compteur des factures.
    const project2027 = await counters.reference({ scope: REFERENCE_SCOPES.PROJECT, year: 2027 });
    assert.equal(project2027, 'PRJ-2027-0001');
  });
});
