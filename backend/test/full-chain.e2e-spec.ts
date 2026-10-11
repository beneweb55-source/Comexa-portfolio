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
 * LA CHAINE METIER COMPLETE, DE BOUT EN BOUT, SUR LA VRAIE BASE.
 *
 * Ce fichier est l'audit final demande par le cahier des charges. Il ne remplace
 * aucune spec existante : les specs unitaires verifient des FONCTIONS (un calcul
 * de TVA, une table de transitions), `billing.e2e-spec.ts` verifie le trio
 * devis/facture/paiement en profondeur. Ce fichier-ci verifie autre chose, et
 * c'est la seule chose qu'aucun autre ne verifie : QUE LA CHAINE TIENT DE BOUT EN
 * BOUT, dans l'ordre, a travers l'API HTTP reelle.
 *
 *     VISITEUR -> PROSPECT -> DEVIS -> ACCEPTATION -> CLIENT -> PROJET
 *              -> EQUIPE -> TACHES -> AVANCEMENT -> FACTURE -> PAIEMENT
 *              -> PROJET TERMINE
 *
 * LA REGLE DE CE FICHIER : CREER, PUIS RELIRE, PUIS CONSTATER.
 *
 * Un test qui se contente de verifier un code 201 ne prouve rien. Un 201 dit
 * « la requete a ete acceptee », pas « l'etat a change ». Chaque etape ecrit donc
 * par une route, puis RELIT par une autre route (souvent une autre : on ecrit par
 * `POST`, on relit par `GET`), et compare l'etat relu a l'etat attendu. Quand une
 * transition produit une piece (un client, un projet, une facture, un paiement),
 * la reference est relue et confrontee a `PREFIX-ANNEE-NNNN` : c'est ce qui prouve
 * que la table `Counter` est reellement traversee, et pas seulement que la colonne
 * `reference` est remplie.
 *
 * LES TESTS DE SECURITE SONT DANS LE MEME FICHIER, ET C'EST VOLONTAIRE.
 *
 * La chaine nominale ne vaut que si elle est etanche. Ce fichier monte donc DEUX
 * clients reels (A et B) avec deux dossiers reels, et verifie qu'un porteur client
 * ne peut pas atteindre les donnees de l'autre :
 *
 *  - par l'URL : echanger un identifiant doit repondre 404, JAMAIS 403. Un 403
 *    confirmerait l'existence de la ressource et permettrait de balayer des
 *    identifiants pour decouvrir quels dossiers sont actifs ;
 *  - par le CORPS : un champ non declare (`roleId`, ou tout autre nom absent du
 *    DTO) doit etre refuse en 400 `VALIDATION_FAILED` par `forbidNonWhitelisted`,
 *    donc AVANT d'atteindre le service. Un perimetre qui depend d'un `if` apres
 *    lecture est un perimetre qu'un champ oublie contourne. `clientId` figurait
 *    ici comme exemple de champ non declare : il ne l'est PLUS, et ce fichier a
 *    ete corrige en consequence (voir le test 14) ;
 *  - par la VISIBILITE : un document `INTERNAL` ne doit jamais remonter dans
 *    l'espace client, quelle que soit la permission detenue.
 *
 * POURQUOI LE CHANGEMENT DE MOT DE PASSE EST DANS LE PARCOURS.
 *
 * Un compte cree par un administrateur nait avec `mustChangePassword`. Tant qu'il
 * n'a pas change son mot de passe, TOUTES les routes lui repondent 403
 * `PASSWORD_CHANGE_REQUIRED` sauf `/auth/change-password`, `/auth/me`,
 * `/auth/logout` et `/auth/refresh`. Ce n'est pas un detour de test : c'est le
 * premier ecran d'un vrai utilisateur. Le parcours y passe donc, et verifie
 * qu'APRES le changement le MEME jeton ouvre ce qui etait ferme — sans reconnexion,
 * parce que le garde recharge le porteur depuis la base a chaque requete.
 *
 * DEPENDANCES ET PRECAUTIONS D'EXECUTION.
 *
 *  - Une base joignable (`DATABASE_URL`) et `AppModule` complet : ce fichier ne
 *    monte AUCUN module lui-meme. Il doit eprouver l'application telle qu'elle est
 *    assemblee, pas une application de test montee a la main. Le jour ou
 *    `QuotesModule`, `InvoicesModule`, `PaymentsModule`, `DocumentsModule` ou
 *    `ContentModule` sort de `imports`, les routes repondent 404 et le premier
 *    echec le dit sans ambiguite.
 *  - Le limiteur de debit : 120 requetes/minute/IP en global, et 10 connexions par
 *    minute sur `POST /auth/login`. Ce fichier ouvre QUATRE sessions (un
 *    administrateur, un compte fraichement cree, deux comptes de l'espace client)
 *    et les reutilise ensuite. Il tient sous les deux plafonds, mais ajouter des
 *    connexions ici sans regarder ce compteur produirait des 429 intermittents.
 *  - Les identifiants sont UNIQUES PAR EXECUTION (`RUN`, un horodatage) : deux
 *    executions successives ne peuvent pas se marcher dessus, et la spec est
 *    rejouable telle quelle. Le nettoyage porte sur les identifiants REELLEMENT
 *    crees.
 *
 * LES `it` DE CE FICHIER SE SUIVENT, ILS NE SONT PAS INDEPENDANTS. `node:test`
 * execute les tests d'un meme `describe` dans l'ordre du fichier, et ce fichier
 * raconte UNE histoire : une visite, un prospect, un devis, une acceptation, une
 * equipe, des taches, une facture, un paiement. Chaque etape laisse la base dans
 * l'etat ou l'etape suivante la prend — c'est la seule facon d'eprouver une chaine
 * de bout en bout sans rejouer tout le parcours a chaque `it`. Les tests qui
 * doivent, eux, etre independants de tout etat sont dans les specs unitaires.
 */

const PASSWORD = 'Boussole-Fractale-77-Zircon';

/**
 * Marqueur de namespace : tous les comptes crees par ce fichier commencent par
 * ce prefixe, ce qui rend une reprise de nettoyage possible sans toucher aux
 * donnees d'une autre suite.
 */
const MARKER = 'e2e-fullchain';

/**
 * Horodatage de l'execution. Il entre dans les adresses e-mail et dans les noms :
 * deux executions simultanees ne peuvent pas entrer en collision sur une
 * contrainte d'unicite, et une execution interrompue ne bloque pas la suivante.
 */
const RUN = Date.now();

/**
 * Age minimal d'un compte pour etre considere comme un reste abandonne.
 *
 * Cette suite dure environ deux minutes. Un compte de plus de trente minutes ne
 * peut donc pas appartenir a une execution vivante : c'est forcement le debris
 * d'une execution interrompue, et le balayage peut le retirer sans risque de
 * couper une execution voisine. Voir le commentaire du balayage dans `before`.
 */
const STALE_AFTER_MS = 30 * 60 * 1000;

const ADMIN_EMAIL = `${MARKER}-admin-${RUN}@comexa.example`;
const INVITED_EMAIL = `${MARKER}-invited-${RUN}@comexa.example`;
const PORTAL_A_EMAIL = `${MARKER}-portal-a-${RUN}@comexa.example`;
const PORTAL_B_EMAIL = `${MARKER}-portal-b-${RUN}@comexa.example`;
const DEVELOPER_EMAIL = `${MARKER}-dev-${RUN}@comexa.example`;
const VISITOR_EMAIL = `${MARKER}-visitor-${RUN}@comexa.example`;

const PROSPECT_COMPANY = `E2E Full Chain Prospect ${RUN}`;
const CLIENT_B_COMPANY = `E2E Full Chain Client B ${RUN}`;

/** Le nouveau mot de passe du compte invite : jamais le meme que l'initial. */
const INVITED_NEW_PASSWORD = 'Enclume-Safran-42-Torrent';

/**
 * Devis : 1 x 1 000,00 + 2 x 500,00 = 2 000,00 HT, TVA 20 % -> 2 400,00 TTC.
 *
 * Les montants sont choisis EXACTS au centime : un test qui ne serait vrai qu'a
 * condition d'arrondir au bon moment ne prouverait pas que le serveur calcule
 * juste, il prouverait qu'il arrondit comme le test. Ici le solde se lit
 * directement — 2 400 encaisses, 0 du.
 */
const CHAIN_LINES = [
  { title: 'Cadrage et maquettes', quantity: 1, unitPrice: 1000 },
  { title: 'Integration', quantity: 2, unitPrice: 500 },
];
const CHAIN_TOTAL = '2400.00';

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

interface ContactRequestPayload {
  id: string;
  reference: string;
  status: string;
  email: string;
  firstName: string;
  lastName: string;
}

interface ProspectPayload {
  id: string;
  reference: string;
  status: string;
  email: string;
  companyName: string | null;
  convertedClientId: string | null;
  convertedAt: string | null;
}

interface HistoryEntryPayload {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  createdAt: string;
}

interface QuotePayload {
  id: string;
  reference: string;
  status: string;
  clientId: string | null;
  prospectId: string | null;
  currency: string;
  subtotal: unknown;
  taxAmount: unknown;
  total: unknown;
  items: { id: string; position: number; title: string; lineTotal: unknown }[];
}

interface AcceptancePayload {
  quoteId: string;
  status: string;
  clientId: string;
  projectId: string;
  clientCreated: boolean;
}

interface ClientPayload {
  id: string;
  reference: string;
  companyName: string;
  status: string;
}

interface ProjectPayload {
  id: string;
  reference: string;
  name: string;
  status: string;
  progressPercent: number;
  completedAt: string | null;
  /**
   * Le projet porte son client en OBJET imbrique, pas en `clientId` plat.
   *
   * C'est une divergence de vocabulaire entre modules, et elle se paie ici :
   * factures et devis exposent `clientId`, les projets exposent `client.id`.
   * Ce fichier a d'abord cru a un `clientId` plat — le typage ne pouvait pas le
   * rattraper, puisque `dataOf<T>` est une assertion sur une reponse JSON, pas
   * une validation. Seule l'execution l'a dit.
   */
  client: { id: string; reference: string; companyName: string } | null;
}

interface MemberPayload {
  id: string;
  projectRole: string | null;
  allocationPercent: number | null;
  user: { id: string; email: string };
}

interface TaskPayload {
  id: string;
  title: string;
  status: string;
  isClientVisible: boolean;
  assigneeId: string | null;
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
}

interface PaymentPayload {
  id: string;
  reference: string;
  amount: unknown;
  currency: string;
  method: string;
  status: string;
  invoiceId: string;
}

interface PaymentResultPayload {
  payment: PaymentPayload;
  invoice: { id: string; status: string; amountPaid: string; total: string; balance: string };
}

interface DocumentPayload {
  id: string;
  name: string;
  mimeType: string;
  visibility: string;
  clientId: string | null;
  projectId: string | null;
}

interface UserViewPayload {
  id: string;
  email: string;
  status: string;
  mustChangePassword: boolean;
  clientId: string | null;
  roles: string[];
}

interface CreatedAccountPayload {
  user: UserViewPayload;
  temporaryPassword: string;
}

interface LoginPayload {
  accessToken: string;
}

function errorOf(response: request.Response): ErrorBody['error'] {
  const body = response.body as ErrorBody;
  assert.equal(body.success, false, "une reponse d'echec doit porter success: false");
  return body.error;
}

/**
 * Le contenu utile d'une reponse de succes.
 *
 * Les listes paginees sont APLATIES par `TransformInterceptor` : `data` est LE
 * TABLEAU et `meta` est a cote. Il n'y a jamais de `data.items` — un test qui
 * lirait `data.items` lirait `undefined` et ne le verrait pas.
 */
function dataOf<T>(response: request.Response): T {
  const body = response.body as SuccessBody<T>;
  assert.equal(body.success, true, `reponse d'echec inattendue : ${JSON.stringify(body)}`);
  return body.data;
}

function metaOf(response: request.Response): NonNullable<SuccessBody<unknown>['meta']> {
  const meta = (response.body as SuccessBody<unknown>).meta;
  assert.ok(meta, 'une liste paginee doit porter meta a cote de data');
  return meta;
}

/**
 * Un montant tel que le serveur l'a envoye, ramene a deux decimales.
 *
 * Les colonnes monetaires sont des `Decimal` : `JSON.stringify` les serialise en
 * CHAINE, et `Decimal.toString()` retire les zeros inutiles (« 2400 » pour
 * 2400,00). Comparer les chaines brutes serait fragile pour une raison qui n'a
 * rien a voir avec l'arithmetique testee.
 */
function amount(value: unknown): string {
  return Number(value).toFixed(2);
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * La forme d'une reference sequentielle : `PREFIX-ANNEE-NNNN`.
 *
 * C'est ce motif, et pas seulement « la colonne est remplie », qui prouve que la
 * table `Counter` est traversee : `NNNN` vient d'un compteur incremente
 * atomiquement, pas d'un `cuid` ni d'une date.
 */
function referencePattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}-\\d{4}-\\d{4}$`);
}

describe('Chaine metier complete : visiteur -> prospect -> devis -> client -> projet -> facture (bout en bout)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  let adminToken = '';
  let invitedToken = '';
  let portalAToken = '';
  let portalBToken = '';

  let adminRoleId = '';
  let developerUserId = '';

  let contactRequestId = '';
  let prospectId = '';
  let quoteId = '';
  let clientAId = '';
  let projectAId = '';
  let taskVisibleId = '';
  let taskInternalId = '';
  let invoiceId = '';

  let clientBId = '';
  let quoteBId = '';
  let projectBId = '';
  let invoiceBId = '';

  let documentInternalAId = '';
  let documentClientAId = '';
  let documentPublicAId = '';
  let documentInternalBId = '';

  // Tout ce que ce fichier cree, pour un nettoyage ordonne et verifiable.
  const createdUserIds: string[] = [];
  const createdClientIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdQuoteIds: string[] = [];
  const createdInvoiceIds: string[] = [];
  const createdDocumentIds: string[] = [];
  const createdProspectIds: string[] = [];
  const createdContactRequestIds: string[] = [];

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
    baseUrl = `/${setup.apiPrefix}`;

    const [adminRole, clientRole, developerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'CLIENT' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'DEVELOPER' }, select: { id: true } }),
    ]);

    adminRoleId = adminRole.id;

    // Reprise de nettoyage : une execution precedente interrompue a pu laisser
    // ses comptes. Le balayage est borne au prefixe de CE fichier.
    //
    // LE SEUIL D'AGE N'EST PAS UN DETAIL, ET IL A ETE PAYE.
    //
    // La premiere version coupait a `createdAt < new Date(RUN)`, en croyant que
    // « anterieur a mon demarrage » suffisait a exclure une execution vivante.
    // C'est faux : `RUN` est mon horodatage, et une AUTRE execution du meme
    // fichier demarree trente secondes plus tot a tous ses comptes anterieurs au
    // mien. Lancer deux fois cette spec en parallele — ce que fait mecaniquement
    // `npm run test:e2e`, qui ramasse tout `.e2e-build/test/**/*.e2e-spec.js` —
    // faisait donc que la seconde execution SUPPRIMAIT l'administrateur de la
    // premiere, en plein milieu de son parcours. Le symptome etait un 401
    // `TOKEN_INVALID` « Ce compte n'existe plus » a l'etape 11, sans aucun
    // rapport avec ce que l'etape 11 teste.
    //
    // Un delai de garde leve l'ambiguite : cette suite dure environ deux minutes,
    // donc un compte de plus de trente minutes ne peut appartenir a une execution
    // vivante. Ce qui est plus vieux est un reste abandonne, et part.
    await prisma.user.deleteMany({
      where: {
        email: { startsWith: `${MARKER}-` },
        createdAt: { lt: new Date(RUN - STALE_AFTER_MS) },
      },
    });

    const passwordHash = await hashPassword(PASSWORD);

    const [admin, developer] = await Promise.all([
      prisma.user.create({
        data: {
          email: ADMIN_EMAIL,
          passwordHash,
          firstName: 'Test',
          lastName: 'Full Chain Admin',
          status: 'ACTIVE',
          isEmailVerified: true,
          mustChangePassword: false,
          roles: { create: { roleId: adminRole.id } },
        },
        select: { id: true },
      }),
      // Le membre d'equipe. Il n'ouvre aucune session : `POST /projects/:id/members`
      // prend un identifiant d'utilisateur, pas un jeton. Le creer directement
      // evite une connexion supplementaire sur un quota qui n'en autorise que dix.
      prisma.user.create({
        data: {
          email: DEVELOPER_EMAIL,
          passwordHash,
          firstName: 'Test',
          lastName: 'Full Chain Dev',
          status: 'ACTIVE',
          isEmailVerified: true,
          mustChangePassword: false,
          roles: { create: { roleId: developerRole.id } },
        },
        select: { id: true },
      }),
    ]);

    adminRoleId = adminRole.id;
    developerUserId = developer.id;
    createdUserIds.push(admin.id, developer.id);

    // `clientRole` n'est pas utilise ici : les comptes de l'espace client sont
    // crees plus tard, une fois leur dossier client existant. La lecture est
    // faite maintenant pour echouer tot si le role CLIENT n'existe pas — c'est
    // une donnee de reference du produit, pas une donnee de test.
    assert.ok(clientRole.id, 'le role CLIENT doit exister');

    const adminLogin = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: ADMIN_EMAIL, password: PASSWORD });

    assert.equal(
      adminLogin.status,
      200,
      `connexion administrateur : ${adminLogin.status} ${JSON.stringify(adminLogin.body)}`,
    );
    adminToken = dataOf<LoginPayload>(adminLogin).accessToken;
  });

  after(async () => {
    if (!app) {
      return;
    }

    // ORDRE DE SUPPRESSION, impose par les cles etrangeres :
    //  - `Payment.invoice` et `InvoiceItem.invoice` sont en cascade, mais on les
    //    retire explicitement pour que le nettoyage reste lisible ;
    //  - `Invoice.quote` / `Invoice.project` sont en `SetNull`, donc les factures
    //    partent AVANT les projets et les devis ;
    //  - `Quote.client`, `Invoice.client` et `Project.client` sont en `Restrict` :
    //    les dossiers clients ne peuvent partir qu'en dernier ;
    //  - `User.client` est en `SetNull`, et `Notification.user` en cascade.
    await prisma.payment.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });

    await prisma.projectMember.deleteMany({ where: { projectId: { in: createdProjectIds } } });
    await prisma.task.deleteMany({ where: { projectId: { in: createdProjectIds } } });
    await prisma.milestone.deleteMany({ where: { projectId: { in: createdProjectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });

    await prisma.quoteItem.deleteMany({ where: { quoteId: { in: createdQuoteIds } } });
    await prisma.quote.deleteMany({ where: { id: { in: createdQuoteIds } } });

    await prisma.leadStatusHistory.deleteMany({
      where: { prospectId: { in: createdProspectIds } },
    });
    await prisma.prospect.deleteMany({ where: { id: { in: createdProspectIds } } });
    await prisma.contactRequest.deleteMany({ where: { id: { in: createdContactRequestIds } } });

    // Les objets de stockage sont retires plus haut, par la route `DELETE`
    // (c'est elle qui supprime le fichier ET la ligne). Cette ligne est le
    // filet : si un `it` a echoue avant ses `DELETE`, la ligne ne doit pas rester.
    await prisma.document.deleteMany({ where: { id: { in: createdDocumentIds } } });

    await prisma.activity.deleteMany({
      where: {
        OR: [
          { clientId: { in: createdClientIds } },
          { projectId: { in: createdProjectIds } },
          { actorId: { in: createdUserIds } },
        ],
      },
    });

    // Les journaux d'audit ne se suppriment pas en cascade : on les retire pour
    // ne pas laisser de bruit dans une base partagee.
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } });

    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });

    // VERIFICATION DU NETTOYAGE. C'est la seule trace que ce fichier laisse
    // derriere lui : la base est partagee avec d'autres suites, et une ligne
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
    assert.equal(
      await prisma.client.count({ where: { id: { in: createdClientIds } } }),
      0,
      'des dossiers clients de test sont restes en base',
    );

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 1. VISITEUR
  // ---------------------------------------------------------------------------

  it("1. VISITEUR : le formulaire public ecrit une demande, que l'agence relit avec sa reference", async () => {
    // La seule route PUBLIQUE qui ecrit en base, et elle ne demande aucun compte.
    // C'est le vrai point d'entree d'un visiteur, pas une commodite de test.
    const created = await request(app.getHttpServer())
      .post(`${baseUrl}/public/contact-requests`)
      .send({
        firstName: 'Camille',
        lastName: 'Visiteuse',
        email: VISITOR_EMAIL,
        companyName: `Visiteuse SARL ${RUN}`,
        subject: 'Demande de devis site vitrine',
        message: 'Bonjour, je souhaite un devis pour la refonte de notre site vitrine.',
        budgetRange: 'FROM_15K_TO_30K',
        source: 'site-vitrine',
      });

    assert.equal(
      created.status,
      201,
      `creation de la demande de contact : ${created.status} ${JSON.stringify(created.body)}`,
    );

    // LA REPONSE NE CONTIENT PAS LA REFERENCE, et c'est deliberé : elle est
    // sequentielle, et deux envois suffiraient a en deduire le volume annuel de
    // demandes de l'agence. La relecture ci-dessous est donc le SEUL moyen de
    // savoir ce qui a ete ecrit — ce qui rend cette etape reellement probante.
    const receipt = dataOf<{ received: true }>(created);
    assert.equal(receipt.received, true);

    const listed = await request(app.getHttpServer())
      .get(`${baseUrl}/contact-requests`)
      .query({ search: VISITOR_EMAIL })
      .set(auth(adminToken));

    assert.equal(listed.status, 200);

    // `data` EST le tableau : la pagination est aplatie par l'intercepteur, et
    // `data.items` vaudrait `undefined`. `meta` est a cote.
    const requests = dataOf<ContactRequestPayload[]>(listed);
    assert.ok(Array.isArray(requests), 'une liste paginee doit rendre un tableau dans data');
    assert.equal(
      metaOf(listed).total,
      1,
      "l'adresse du visiteur est unique par execution : la recherche doit rendre exactement une demande",
    );

    const found = requests.find((entry) => entry.email === VISITOR_EMAIL);
    assert.ok(found, "la demande du visiteur doit figurer dans la file de l'agence");

    contactRequestId = found.id;
    createdContactRequestIds.push(contactRequestId);

    assert.equal(found.status, 'NEW', "une demande qui vient d'arriver est NEW");
    assert.match(
      found.reference,
      referencePattern('CTR'),
      'la reference de la demande doit venir du compteur, au format CTR-ANNEE-NNNN',
    );
  });

  // ---------------------------------------------------------------------------
  // 2. PROSPECT
  // ---------------------------------------------------------------------------

  it('2. PROSPECT : creation depuis la demande, puis deplacement dans le pipeline, relu et historise', async () => {
    const created = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects`)
      .set(auth(adminToken))
      .send({
        companyName: PROSPECT_COMPANY,
        contactFirstName: 'Camille',
        contactLastName: 'Visiteuse',
        email: VISITOR_EMAIL,
        phone: '+33 5 56 00 00 09',
        sector: 'Commerce de proximite',
        source: 'CONTACT_FORM',
        estimatedBudget: 18000,
        notes: `Issue de la demande de contact ${contactRequestId}.`,
      });

    assert.equal(
      created.status,
      201,
      `creation du prospect : ${created.status} ${JSON.stringify(created.body)}`,
    );

    prospectId = dataOf<ProspectPayload>(created).id;
    createdProspectIds.push(prospectId);

    // RELIRE, et pas seulement croire le 201.
    const read = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${prospectId}`)
      .set(auth(adminToken));

    assert.equal(read.status, 200);
    const prospect = dataOf<ProspectPayload>(read);

    assert.equal(prospect.id, prospectId);
    assert.equal(
      prospect.status,
      'NEW',
      'un prospect nait NEW : le statut est un defaut du schema',
    );
    assert.equal(prospect.email, VISITOR_EMAIL);
    assert.match(
      prospect.reference,
      referencePattern('PRO'),
      'la reference du prospect doit venir du compteur, au format PRO-ANNEE-NNNN',
    );

    // TRANSITION D'ETAT : le pipeline ne se modifie que par cette route, parce
    // qu'elle ecrit `LeadStatusHistory` dans la meme transaction. Cette route
    // repond 200 et non 201 : elle modifie une fiche existante, elle n'en cree pas.
    const moved = await request(app.getHttpServer())
      .post(`${baseUrl}/prospects/${prospectId}/status`)
      .set(auth(adminToken))
      .send({ status: 'QUALIFIED', note: 'Budget et besoin confirmes par telephone.' });

    assert.equal(
      moved.status,
      200,
      `changement d'etape : ${moved.status} ${JSON.stringify(moved.body)}`,
    );

    // RELIRE L'ETAT, par une route differente de celle qui l'a ecrit.
    const reread = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${prospectId}`)
      .set(auth(adminToken));

    assert.equal(reread.status, 200);
    assert.equal(dataOf<ProspectPayload>(reread).status, 'QUALIFIED');

    // L'HISTORIQUE EST LA PREUVE DU PARCOURS : une fiche peut mentir sur son
    // statut, une ligne d'historique dit qui l'a deplacee et depuis ou.
    const history = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${prospectId}/history`)
      .set(auth(adminToken));

    assert.equal(history.status, 200);
    const entries = dataOf<HistoryEntryPayload[]>(history);
    assert.equal(entries.length, 2, 'la creation puis le passage en QUALIFIED : deux lignes');

    const last = entries[entries.length - 1];
    assert.ok(last, "l'historique doit se terminer par la derniere transition");
    assert.equal(last.toStatus, 'QUALIFIED');
    assert.equal(last.fromStatus, 'NEW');
  });

  // ---------------------------------------------------------------------------
  // 3. DEVIS
  // ---------------------------------------------------------------------------

  it('3. DEVIS : creation sur le prospect, envoi, et statut relu a chaque etape', async () => {
    const created = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes`)
      .set(auth(adminToken))
      .send({
        subject: `Refonte du site vitrine ${RUN}`,
        prospectId,
        currency: 'EUR',
        taxRate: 20,
        items: CHAIN_LINES,
      });

    assert.equal(
      created.status,
      201,
      `creation du devis : ${created.status} ${JSON.stringify(created.body)}`,
    );

    quoteId = dataOf<QuotePayload>(created).id;
    createdQuoteIds.push(quoteId);

    const read = await request(app.getHttpServer())
      .get(`${baseUrl}/quotes/${quoteId}`)
      .set(auth(adminToken));

    assert.equal(read.status, 200);
    const quote = dataOf<QuotePayload>(read);

    assert.equal(quote.status, 'DRAFT', 'un devis nait en brouillon');
    assert.equal(quote.prospectId, prospectId);
    assert.equal(
      quote.clientId,
      null,
      'avant acceptation, le devis vise un prospect, pas un client',
    );
    assert.match(
      quote.reference,
      referencePattern('DEV'),
      'la reference du devis doit venir du compteur, au format DEV-ANNEE-NNNN',
    );

    // LES TOTAUX SONT CALCULES PAR LE SERVEUR, a partir des lignes seules. Aucun
    // DTO de devis ne porte de montant : `forbidNonWhitelisted` refuserait `total`.
    assert.equal(amount(quote.subtotal), '2000.00');
    assert.equal(amount(quote.taxAmount), '400.00');
    assert.equal(amount(quote.total), CHAIN_TOTAL);
    assert.equal(quote.items.length, 2);

    // ENVOI : c'est cet etat qui fige le devis.
    const sent = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteId}/send`)
      .set(auth(adminToken))
      .send({});

    assert.equal(sent.status, 201, `envoi du devis : ${sent.status} ${JSON.stringify(sent.body)}`);

    const afterSend = await request(app.getHttpServer())
      .get(`${baseUrl}/quotes/${quoteId}`)
      .set(auth(adminToken));

    assert.equal(afterSend.status, 200);
    assert.equal(
      dataOf<QuotePayload>(afterSend).status,
      'SENT',
      "l'envoi doit avoir fait passer le devis de DRAFT a SENT, et la relecture le constate",
    );
  });

  // ---------------------------------------------------------------------------
  // 4. ACCEPTATION : c'est elle qui cree le client et le projet
  // ---------------------------------------------------------------------------

  it('4. ACCEPTATION : le devis accepte produit le dossier client ET le projet, tous deux relus', async () => {
    const accepted = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteId}/accept`)
      .set(auth(adminToken))
      .send({});

    assert.equal(
      accepted.status,
      201,
      `acceptation du devis : ${accepted.status} ${JSON.stringify(accepted.body)}`,
    );

    const acceptance = dataOf<AcceptancePayload>(accepted);
    clientAId = acceptance.clientId;
    projectAId = acceptance.projectId;
    createdClientIds.push(clientAId);
    createdProjectIds.push(projectAId);

    // Le prospect n'avait pas encore de dossier : c'est l'acceptation qui le cree.
    assert.equal(
      acceptance.clientCreated,
      true,
      "le prospect n'avait pas de dossier client : l'acceptation doit le creer",
    );
    assert.equal(acceptance.status, 'ACCEPTED');
    assert.ok(projectAId, "l'acceptation doit rendre l'identifiant du projet ouvert");
    assert.notEqual(
      projectAId,
      clientAId,
      "l'acceptation rend un projet ET un dossier : ce sont deux objets distincts",
    );

    // RELIRE LE DEVIS : il porte desormais le client.
    const quoteRead = await request(app.getHttpServer())
      .get(`${baseUrl}/quotes/${quoteId}`)
      .set(auth(adminToken));

    assert.equal(quoteRead.status, 200);
    const quote = dataOf<QuotePayload>(quoteRead);
    assert.equal(quote.status, 'ACCEPTED');
    assert.equal(quote.clientId, clientAId, 'le devis accepte porte le dossier client cree');

    // RELIRE LE PROSPECT : il est gagne, et il POINTE vers le dossier cree. C'est
    // ce lien qui rend la conversion verifiable dans les deux sens.
    const prospectRead = await request(app.getHttpServer())
      .get(`${baseUrl}/prospects/${prospectId}`)
      .set(auth(adminToken));

    assert.equal(prospectRead.status, 200);
    const prospect = dataOf<ProspectPayload>(prospectRead);
    assert.equal(prospect.status, 'WON');
    assert.equal(prospect.convertedClientId, clientAId);
    assert.ok(prospect.convertedAt, 'la date de conversion doit etre posee avec le lien');
  });

  // ---------------------------------------------------------------------------
  // 5. CLIENT
  // ---------------------------------------------------------------------------

  it("5. CLIENT : le dossier cree par l'acceptation est lisible et numerote", async () => {
    const read = await request(app.getHttpServer())
      .get(`${baseUrl}/clients/${clientAId}`)
      .set(auth(adminToken));

    assert.equal(read.status, 200, `lecture du dossier client : ${read.status}`);
    const client = dataOf<ClientPayload>(read);

    assert.equal(client.id, clientAId);
    assert.equal(client.status, 'ACTIVE');
    assert.equal(
      client.companyName,
      PROSPECT_COMPANY,
      'le dossier client reprend la raison sociale du prospect dont il est issu',
    );
    assert.match(
      client.reference,
      referencePattern('CLI'),
      'la reference du client doit venir du compteur, au format CLI-ANNEE-NNNN',
    );
  });

  // ---------------------------------------------------------------------------
  // 6. PROJET
  // ---------------------------------------------------------------------------

  it("6. PROJET : le projet ouvert par l'acceptation est rattache au bon client", async () => {
    const read = await request(app.getHttpServer())
      .get(`${baseUrl}/projects/${projectAId}`)
      .set(auth(adminToken));

    assert.equal(read.status, 200, `lecture du projet : ${read.status}`);
    const project = dataOf<ProjectPayload>(read);

    assert.equal(project.id, projectAId);
    assert.ok(project.client, 'un projet sans client ne serait rattache a personne');
    assert.equal(project.client.id, clientAId);
    assert.equal(
      project.client.companyName,
      PROSPECT_COMPANY,
      "le projet porte le dossier client ne de l'acceptation, pas un homonyme",
    );
    assert.equal(
      project.status,
      'PLANNED',
      'un projet ne nait pas en cours : il est PLANIFIE, et il faudra une transition pour le demarrer',
    );
    assert.match(
      project.reference,
      referencePattern('PRJ'),
      'la reference du projet doit venir du compteur, au format PRJ-ANNEE-NNNN',
    );
  });

  // ---------------------------------------------------------------------------
  // 7. EQUIPE
  // ---------------------------------------------------------------------------

  it('7. EQUIPE : un membre est ajoute au projet, puis retrouve dans la composition relue', async () => {
    const added = await request(app.getHttpServer())
      .post(`${baseUrl}/projects/${projectAId}/members`)
      .set(auth(adminToken))
      .send({ userId: developerUserId, projectRole: 'Developpeur front', allocationPercent: 60 });

    assert.equal(
      added.status,
      201,
      `ajout du membre : ${added.status} ${JSON.stringify(added.body)}`,
    );

    const listed = await request(app.getHttpServer())
      .get(`${baseUrl}/projects/${projectAId}/members`)
      .set(auth(adminToken));

    assert.equal(listed.status, 200);
    const members = dataOf<MemberPayload[]>(listed);
    assert.ok(Array.isArray(members));

    const member = members.find((entry) => entry.user.id === developerUserId);
    assert.ok(member, "le membre ajoute doit figurer dans l'equipe relue");
    assert.equal(member.projectRole, 'Developpeur front');
    assert.equal(member.allocationPercent, 60);
  });

  // ---------------------------------------------------------------------------
  // 8. TACHES
  // ---------------------------------------------------------------------------

  it('8. TACHES : deux taches creees, assignees, et menees a DONE avec relecture a chaque transition', async () => {
    const visible = await request(app.getHttpServer())
      .post(`${baseUrl}/projects/${projectAId}/tasks`)
      .set(auth(adminToken))
      .send({
        title: `Integrer la page d'accueil ${RUN}`,
        description: 'Tache visible par le client.',
        assigneeId: developerUserId,
        priority: 'HIGH',
        estimateMinutes: 480,
        isClientVisible: true,
      });

    assert.equal(
      visible.status,
      201,
      `creation de la tache visible : ${visible.status} ${JSON.stringify(visible.body)}`,
    );
    taskVisibleId = dataOf<TaskPayload>(visible).id;

    // Une tache INTERNE, creee sans `isClientVisible` : le defaut du schema est
    // FAUX, donc une tache interne le reste tant que personne ne la partage. Le
    // defaut inverse publierait un brouillon au premier oubli.
    const internal = await request(app.getHttpServer())
      .post(`${baseUrl}/projects/${projectAId}/tasks`)
      .set(auth(adminToken))
      .send({ title: `Recette interne ${RUN}`, priority: 'NORMAL' });

    assert.equal(internal.status, 201);
    taskInternalId = dataOf<TaskPayload>(internal).id;

    const listed = await request(app.getHttpServer())
      .get(`${baseUrl}/projects/${projectAId}/tasks`)
      .set(auth(adminToken));

    assert.equal(listed.status, 200);
    const tasks = dataOf<TaskPayload[]>(listed);
    assert.ok(Array.isArray(tasks), 'la liste des taches est paginee : data est le tableau');

    const visibleTask = tasks.find((task) => task.id === taskVisibleId);
    assert.ok(visibleTask, 'la tache visible doit figurer dans la liste relue');
    assert.equal(visibleTask.isClientVisible, true);
    assert.equal(visibleTask.assigneeId, developerUserId);
    assert.equal(visibleTask.status, 'TODO');

    const internalTask = tasks.find((task) => task.id === taskInternalId);
    assert.ok(internalTask, 'la tache interne doit figurer dans la liste interne');
    assert.equal(internalTask.isClientVisible, false);

    // TRANSITION DE TACHE : la route est dediee, parce qu'un changement de statut
    // ecrit une entree d'activite et notifie quelqu'un.
    const started = await request(app.getHttpServer())
      .patch(`${baseUrl}/tasks/${taskVisibleId}/status`)
      .set(auth(adminToken))
      .send({ status: 'IN_PROGRESS' });

    assert.equal(
      started.status,
      200,
      `passage en cours : ${started.status} ${JSON.stringify(started.body)}`,
    );

    const rereadStarted = await request(app.getHttpServer())
      .get(`${baseUrl}/tasks/${taskVisibleId}`)
      .set(auth(adminToken));

    assert.equal(rereadStarted.status, 200);
    assert.equal(dataOf<TaskPayload>(rereadStarted).status, 'IN_PROGRESS');

    const done = await request(app.getHttpServer())
      .patch(`${baseUrl}/tasks/${taskVisibleId}/status`)
      .set(auth(adminToken))
      .send({ status: 'DONE' });

    assert.equal(done.status, 200);

    const rereadDone = await request(app.getHttpServer())
      .get(`${baseUrl}/tasks/${taskVisibleId}`)
      .set(auth(adminToken));

    assert.equal(rereadDone.status, 200);
    assert.equal(dataOf<TaskPayload>(rereadDone).status, 'DONE');
  });

  // ---------------------------------------------------------------------------
  // 9. AVANCEMENT
  // ---------------------------------------------------------------------------

  it('9. AVANCEMENT : le projet demarre et declare son avancement, relu sur la fiche', async () => {
    const moved = await request(app.getHttpServer())
      .patch(`${baseUrl}/projects/${projectAId}/status`)
      .set(auth(adminToken))
      .send({ status: 'IN_PROGRESS', health: 'ON_TRACK', progressPercent: 40 });

    assert.equal(
      moved.status,
      200,
      `demarrage du projet : ${moved.status} ${JSON.stringify(moved.body)}`,
    );

    const reread = await request(app.getHttpServer())
      .get(`${baseUrl}/projects/${projectAId}`)
      .set(auth(adminToken));

    assert.equal(reread.status, 200);
    const project = dataOf<ProjectPayload>(reread);

    assert.equal(project.status, 'IN_PROGRESS');
    assert.equal(project.progressPercent, 40, "l'avancement declare doit etre celui relu");
    assert.equal(project.completedAt, null, "un projet en cours n'a pas de date de fin");
  });

  // ---------------------------------------------------------------------------
  // 10. FACTURE
  // ---------------------------------------------------------------------------

  it("10. FACTURE : la facture nait du devis accepte, ses lignes sont recopiees, et aucun montant n'est accepte en entree", async () => {
    const created = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteId}/invoice`)
      .set(auth(adminToken))
      .send({ notes: `Facture issue du devis accepte (execution ${RUN}).` });

    assert.equal(
      created.status,
      201,
      `creation de la facture : ${created.status} ${JSON.stringify(created.body)}`,
    );

    invoiceId = dataOf<InvoicePayload>(created).id;
    createdInvoiceIds.push(invoiceId);

    const read = await request(app.getHttpServer())
      .get(`${baseUrl}/invoices/${invoiceId}`)
      .set(auth(adminToken));

    assert.equal(read.status, 200);
    const invoice = dataOf<InvoicePayload>(read);

    assert.equal(
      invoice.status,
      'DRAFT',
      'une facture nait en brouillon : elle se relit avant envoi',
    );
    assert.equal(invoice.clientId, clientAId);
    assert.equal(invoice.quoteId, quoteId, 'la facture reste liee au devis dont elle est issue');
    assert.match(
      invoice.reference,
      referencePattern('FAC'),
      'la reference de la facture doit venir du compteur, au format FAC-ANNEE-NNNN',
    );

    // LES LIGNES SONT RECOPIEES, ET LES TOTAUX RECALCULES A PARTIR D'ELLES.
    assert.equal(invoice.items.length, 2);
    assert.equal(amount(invoice.total), CHAIN_TOTAL);
    assert.equal(amount(invoice.amountPaid), '0.00');
    assert.equal(invoice.paidAt, null);

    // LE CORPS DE CETTE ROUTE N'ACCEPTE AUCUN MONTANT. Un client qui enverrait
    // `total: 1` sur une facture de 2 400 doit etre refuse AVANT le service : le
    // champ n'existe pas dans le DTO, donc `forbidNonWhitelisted` le rejette.
    const withTotal = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteId}/invoice`)
      .set(auth(adminToken))
      .send({ total: 1 });

    assert.equal(
      withTotal.status,
      400,
      'un montant dans le corps de la creation de facture doit etre refuse',
    );
    assert.equal(errorOf(withTotal).code, 'VALIDATION_FAILED');
  });

  // ---------------------------------------------------------------------------
  // 11. PAIEMENT
  // ---------------------------------------------------------------------------

  it('11. PAIEMENT : la facture envoyee est encaissee, et le statut relu dit PAID', async () => {
    // Une facture en brouillon n'est pas payable : c'est l'envoi qui la rend
    // exigible. L'ordre des deux appels n'est pas une commodite, c'est la regle.
    const sent = await request(app.getHttpServer())
      .post(`${baseUrl}/invoices/${invoiceId}/send`)
      .set(auth(adminToken))
      .send({});

    assert.equal(
      sent.status,
      201,
      `envoi de la facture : ${sent.status} ${JSON.stringify(sent.body)}`,
    );

    const afterSend = await request(app.getHttpServer())
      .get(`${baseUrl}/invoices/${invoiceId}`)
      .set(auth(adminToken));

    assert.equal(afterSend.status, 200);
    assert.equal(dataOf<InvoicePayload>(afterSend).status, 'SENT');

    // ENCAISSEMENT DU SOLDE ENTIER. Le montant est le seul qu'un appelant
    // fournisse legitimement — et il est plafonne au solde, sous verrou.
    const paid = await request(app.getHttpServer())
      .post(`${baseUrl}/invoices/${invoiceId}/payments`)
      .set(auth(adminToken))
      .send({
        amount: 2400,
        method: 'BANK_TRANSFER',
        externalReference: `VIR-${RUN}`,
        notes: 'Solde de la facture.',
      });

    assert.equal(
      paid.status,
      201,
      `enregistrement du paiement : ${paid.status} ${JSON.stringify(paid.body)}`,
    );

    const result = dataOf<PaymentResultPayload>(paid);
    assert.match(
      result.payment.reference,
      referencePattern('PAY'),
      'la reference du paiement doit venir du compteur, au format PAY-ANNEE-NNNN',
    );
    assert.equal(amount(result.payment.amount), CHAIN_TOTAL);
    assert.equal(result.payment.invoiceId, invoiceId);
    assert.equal(result.payment.status, 'SUCCEEDED');

    // LE STATUT DE LA FACTURE EST DERIVE DE LA SOMME ENCAISSEE, pas pose a la
    // main : c'est la relecture qui le prouve.
    assert.equal(result.invoice.status, 'PAID');
    assert.equal(amount(result.invoice.amountPaid), CHAIN_TOTAL);
    assert.equal(result.invoice.balance, '0.00');

    const reread = await request(app.getHttpServer())
      .get(`${baseUrl}/invoices/${invoiceId}`)
      .set(auth(adminToken));

    assert.equal(reread.status, 200);
    const invoice = dataOf<InvoicePayload>(reread);
    assert.equal(invoice.status, 'PAID');
    assert.equal(amount(invoice.amountPaid), CHAIN_TOTAL);
    assert.ok(invoice.paidAt, 'une facture soldee porte sa date de reglement');

    // LE PAIEMENT SE RELIT PAR SA PROPRE ROUTE, elle aussi paginee.
    const payments = await request(app.getHttpServer())
      .get(`${baseUrl}/invoices/${invoiceId}/payments`)
      .set(auth(adminToken));

    assert.equal(payments.status, 200);
    const entries = dataOf<PaymentPayload[]>(payments);
    assert.ok(Array.isArray(entries), 'la liste des paiements est paginee : data est le tableau');
    assert.equal(metaOf(payments).total, 1);

    const entry = entries.find((payment) => payment.id === result.payment.id);
    assert.ok(entry, 'le paiement enregistre doit figurer dans la liste relue');
    assert.match(entry.reference, referencePattern('PAY'));
  });

  // ---------------------------------------------------------------------------
  // 12. PROJET TERMINE
  // ---------------------------------------------------------------------------

  it('12. PROJET TERMINE : le projet est clos, et la date de fin apparait avec le statut', async () => {
    const closed = await request(app.getHttpServer())
      .patch(`${baseUrl}/projects/${projectAId}/status`)
      .set(auth(adminToken))
      .send({ status: 'COMPLETED' });

    assert.equal(
      closed.status,
      200,
      `cloture du projet : ${closed.status} ${JSON.stringify(closed.body)}`,
    );

    const reread = await request(app.getHttpServer())
      .get(`${baseUrl}/projects/${projectAId}`)
      .set(auth(adminToken));

    assert.equal(reread.status, 200);
    const project = dataOf<ProjectPayload>(reread);

    assert.equal(project.status, 'COMPLETED');
    assert.ok(project.completedAt, 'un projet termine porte sa date de fin');
    assert.equal(
      project.progressPercent,
      100,
      'un projet termine est a 100 % par definition : laisser 40 contredirait le statut',
    );

    // La chaine est bouclee : devis accepte -> client -> projet -> facture
    // encaissee -> projet termine. La facture relue est bien celle du projet.
    const invoice = await request(app.getHttpServer())
      .get(`${baseUrl}/invoices/${invoiceId}`)
      .set(auth(adminToken));

    assert.equal(invoice.status, 200);
    assert.equal(
      dataOf<InvoicePayload>(invoice).projectId,
      projectAId,
      'la facture doit pointer le projet ne de la meme acceptation',
    );
  });

  // ---------------------------------------------------------------------------
  // 13. PREMIERE CONNEXION D'UN COMPTE CREE PAR L'AGENCE
  // ---------------------------------------------------------------------------

  it('13. PREMIER ACCES : un compte cree par un administrateur passe par le changement de mot de passe impose', async () => {
    const created = await request(app.getHttpServer())
      .post(`${baseUrl}/users`)
      .set(auth(adminToken))
      .send({
        email: INVITED_EMAIL,
        firstName: 'Ines',
        lastName: 'Invitee',
        roleCodes: ['CLIENT'],
      });

    assert.equal(
      created.status,
      201,
      `creation du compte : ${created.status} ${JSON.stringify(created.body)}`,
    );

    const account = dataOf<CreatedAccountPayload>(created);
    createdUserIds.push(account.user.id);

    assert.equal(account.user.mustChangePassword, true);
    assert.ok(account.temporaryPassword, "le mot de passe initial n'est rendu qu'ici");
    assert.deepEqual(account.user.roles, ['CLIENT']);

    const login = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: INVITED_EMAIL, password: account.temporaryPassword });

    assert.equal(login.status, 200, 'un compte neuf doit pouvoir ouvrir une session');
    invitedToken = dataOf<LoginPayload>(login).accessToken;

    // LE GARDE FERME TOUT le reste. On verifie sur une route METIER, pas sur une
    // route de session : c'est le parcours reel d'un utilisateur qui arrive.
    const blocked = await request(app.getHttpServer())
      .get(`${baseUrl}/projects`)
      .set(auth(invitedToken));

    assert.equal(blocked.status, 403, 'un compte au mot de passe initial ne doit rien ouvrir');
    assert.equal(errorOf(blocked).code, 'PASSWORD_CHANGE_REQUIRED');

    // `GET /auth/me` reste ouvert : c'est ce qui permet a l'interface d'afficher
    // l'ecran de changement de mot de passe sans deviner pourquoi tout est ferme.
    const me = await request(app.getHttpServer()).get(`${baseUrl}/auth/me`).set(auth(invitedToken));

    assert.equal(me.status, 200);

    const changed = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/change-password`)
      .set(auth(invitedToken))
      .send({
        currentPassword: account.temporaryPassword,
        newPassword: INVITED_NEW_PASSWORD,
        confirmPassword: INVITED_NEW_PASSWORD,
      });

    assert.equal(
      changed.status,
      200,
      `changement de mot de passe : ${changed.status} ${JSON.stringify(changed.body)}`,
    );

    // LE MEME JETON OUVRE DESORMAIS CE QUI ETAIT FERME, sans reconnexion : le
    // garde recharge le porteur depuis la base a chaque requete, donc la
    // revocation comme la levee sont immediates.
    const unblocked = await request(app.getHttpServer())
      .get(`${baseUrl}/projects`)
      .set(auth(invitedToken));

    assert.equal(
      unblocked.status,
      200,
      'apres le changement, le meme jeton doit ouvrir la route metier',
    );
    assert.ok(Array.isArray(dataOf<ProjectPayload[]>(unblocked)));
  });

  // ---------------------------------------------------------------------------
  // 14. PERIMETRE CLIENT : deux dossiers reels, et l'isolation entre eux
  // ---------------------------------------------------------------------------

  it("14. ISOLATION : le porteur client ne peut pas atteindre l'autre dossier, ni par l'URL ni par le corps", async () => {
    // --- Le dossier B, complet : client, devis accepte, projet, facture -------
    const clientBCreated = await request(app.getHttpServer())
      .post(`${baseUrl}/clients`)
      .set(auth(adminToken))
      .send({ companyName: CLIENT_B_COMPANY, sector: 'Industrie' });

    assert.equal(
      clientBCreated.status,
      201,
      `creation du dossier client B : ${clientBCreated.status} ${JSON.stringify(clientBCreated.body)}`,
    );
    clientBId = dataOf<ClientPayload>(clientBCreated).id;
    createdClientIds.push(clientBId);

    const quoteBCreated = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes`)
      .set(auth(adminToken))
      .send({
        subject: `Prestation client B ${RUN}`,
        clientId: clientBId,
        currency: 'EUR',
        taxRate: 20,
        items: [{ title: 'Prestation isolee', quantity: 1, unitPrice: 2000 }],
      });

    assert.equal(quoteBCreated.status, 201);
    quoteBId = dataOf<QuotePayload>(quoteBCreated).id;
    createdQuoteIds.push(quoteBId);

    const quoteBSent = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteBId}/send`)
      .set(auth(adminToken))
      .send({});
    assert.equal(quoteBSent.status, 201);

    const quoteBAccepted = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteBId}/accept`)
      .set(auth(adminToken))
      .send({});
    assert.equal(quoteBAccepted.status, 201);

    const acceptanceB = dataOf<AcceptancePayload>(quoteBAccepted);
    projectBId = acceptanceB.projectId;
    createdProjectIds.push(projectBId);
    assert.equal(
      acceptanceB.clientCreated,
      false,
      "le dossier B existait deja : l'acceptation ne doit pas en creer un second",
    );

    const invoiceBCreated = await request(app.getHttpServer())
      .post(`${baseUrl}/quotes/${quoteBId}/invoice`)
      .set(auth(adminToken))
      .send({});

    assert.equal(invoiceBCreated.status, 201);
    invoiceBId = dataOf<InvoicePayload>(invoiceBCreated).id;
    createdInvoiceIds.push(invoiceBId);

    // --- Les deux comptes de l'espace client --------------------------------
    //
    // ILS SONT CREES ICI, ET PAS PAR `POST /users` — MAIS PLUS POUR LA RAISON QUI
    // ETAIT ECRITE. Ce bloc affirmait que le DTO de creation ne portait AUCUN
    // `clientId` et que l'API ne savait donc pas rattacher un compte a un dossier,
    // « une route manquante ». C'est FAUX depuis que `clientId` figure sur
    // `CreateUserDto` : l'API sait le faire, et c'est le chemin normal, couvert
    // par `identity.e2e-spec.ts`.
    //
    // La raison qui subsiste est autre, et elle tient au MOT DE PASSE.
    // `POST /users` GENERE le mot de passe et impose son changement des la
    // premiere connexion (c'est le parcours 13, juste au-dessus). Or l'isolation
    // se verifie en se connectant REELLEMENT comme porteur A puis comme porteur B :
    // il faut donc un mot de passe connu et une session utilisable tout de suite.
    // Ecrire les deux comptes en base avec `hashPassword(PASSWORD)` rend cette
    // connexion immediate et deterministe, sans affaiblir ce qui est teste — ce
    // sont les MEMES lignes, avec le meme rattachement `clientId`, que celles
    // qu'aurait creees l'API.
    const clientRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'CLIENT' },
      select: { id: true },
    });
    const portalHash = await hashPassword(PASSWORD);

    const [portalA, portalB] = await Promise.all([
      prisma.user.create({
        data: {
          email: PORTAL_A_EMAIL,
          passwordHash: portalHash,
          firstName: 'Test',
          lastName: 'Portal A',
          status: 'ACTIVE',
          isEmailVerified: true,
          mustChangePassword: false,
          clientId: clientAId,
          roles: { create: { roleId: clientRole.id } },
        },
        select: { id: true },
      }),
      prisma.user.create({
        data: {
          email: PORTAL_B_EMAIL,
          passwordHash: portalHash,
          firstName: 'Test',
          lastName: 'Portal B',
          status: 'ACTIVE',
          isEmailVerified: true,
          mustChangePassword: false,
          clientId: clientBId,
          roles: { create: { roleId: clientRole.id } },
        },
        select: { id: true },
      }),
    ]);

    createdUserIds.push(portalA.id, portalB.id);

    const loginA = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: PORTAL_A_EMAIL, password: PASSWORD });
    const loginB = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: PORTAL_B_EMAIL, password: PASSWORD });

    assert.equal(loginA.status, 200, 'connexion du porteur A');
    assert.equal(loginB.status, 200, 'connexion du porteur B');
    portalAToken = dataOf<LoginPayload>(loginA).accessToken;
    portalBToken = dataOf<LoginPayload>(loginB).accessToken;

    // --- Ce que A PEUT lire : son propre dossier ----------------------------
    const ownClient = await request(app.getHttpServer())
      .get(`${baseUrl}/clients/${clientAId}`)
      .set(auth(portalAToken));

    assert.equal(ownClient.status, 200, 'le porteur A doit lire son propre dossier');
    assert.equal(dataOf<ClientPayload>(ownClient).id, clientAId);

    // --- Ce que A NE PEUT PAS atteindre : echanger l'identifiant dans l'URL --
    //
    // 404, ET JAMAIS 403. Un 403 confirmerait que la ressource existe, et
    // permettrait de balayer des identifiants pour decouvrir quels dossiers sont
    // actifs. Le perimetre est pose dans le `where`, donc la ligne est
    // introuvable — pas refusee apres avoir ete lue.
    const crossClient = await request(app.getHttpServer())
      .get(`${baseUrl}/clients/${clientBId}`)
      .set(auth(portalAToken));

    assert.equal(crossClient.status, 404, "le dossier de l'autre client doit etre introuvable");
    assert.equal(errorOf(crossClient).code, 'CLIENT_NOT_FOUND');

    const crossProject = await request(app.getHttpServer())
      .get(`${baseUrl}/projects/${projectBId}`)
      .set(auth(portalAToken));

    assert.equal(crossProject.status, 404);
    assert.equal(errorOf(crossProject).code, 'PROJECT_NOT_FOUND');

    const crossQuote = await request(app.getHttpServer())
      .get(`${baseUrl}/quotes/${quoteBId}`)
      .set(auth(portalAToken));

    assert.equal(crossQuote.status, 404);
    assert.equal(errorOf(crossQuote).code, 'QUOTE_NOT_FOUND');

    const crossInvoice = await request(app.getHttpServer())
      .get(`${baseUrl}/invoices/${invoiceBId}`)
      .set(auth(portalAToken));

    assert.equal(crossInvoice.status, 404);
    assert.equal(errorOf(crossInvoice).code, 'INVOICE_NOT_FOUND');

    // La route des paiements est fille de la facture : hors perimetre, la facture
    // est introuvable, donc ses paiements aussi.
    const crossPayments = await request(app.getHttpServer())
      .get(`${baseUrl}/invoices/${invoiceBId}/payments`)
      .set(auth(portalAToken));

    assert.equal(crossPayments.status, 404);
    assert.equal(errorOf(crossPayments).code, 'INVOICE_NOT_FOUND');

    // Une facture encore en brouillon n'a pas ete emise : meme le porteur qui en
    // est le client ne la voit pas (404, pas 200 ni 403).
    const draftForOwnerB = await request(app.getHttpServer())
      .get(`${baseUrl}/invoices/${invoiceBId}`)
      .set(auth(portalBToken));

    assert.equal(draftForOwnerB.status, 404, 'un brouillon ne doit pas etre visible du client');
    assert.equal(errorOf(draftForOwnerB).code, 'INVOICE_NOT_FOUND');

    // Une fois envoyee par l'equipe, la facture devient lisible par son client.
    const sentB = await request(app.getHttpServer())
      .post(`${baseUrl}/invoices/${invoiceBId}/send`)
      .set(auth(adminToken))
      .send({});
    assert.equal(sentB.status, 201, `envoi de la facture B : ${sentB.status}`);

    // Le porteur B, lui, atteint bien SES donnees : sans ce controle, les 404
    // ci-dessus seraient aussi vrais d'une base vide.
    const ownInvoiceB = await request(app.getHttpServer())
      .get(`${baseUrl}/invoices/${invoiceBId}`)
      .set(auth(portalBToken));

    assert.equal(
      ownInvoiceB.status,
      200,
      'le porteur B doit lire sa propre facture une fois envoyee',
    );
    assert.equal(dataOf<InvoicePayload>(ownInvoiceB).clientId, clientBId);

    // --- Ce que A NE PEUT PAS obtenir en le DEMANDANT : le filtre dans l'URL --
    //
    // `?clientId=` est un filtre INTERNE. Pour un porteur client, le perimetre
    // vient du COMPTE et le filtre est ignore : il ne peut pas elargir ce qu'il
    // voit, et il ne peut pas non plus le reduire pour autant.
    const filtered = await request(app.getHttpServer())
      .get(`${baseUrl}/quotes`)
      .query({ clientId: clientBId })
      .set(auth(portalAToken));

    assert.equal(filtered.status, 200);
    const visibleQuotes = dataOf<QuotePayload[]>(filtered);
    assert.ok(Array.isArray(visibleQuotes));

    for (const entry of visibleQuotes) {
      assert.equal(
        entry.clientId,
        clientAId,
        'un porteur client ne voit que les devis de SON dossier, quel que soit le filtre demande',
      );
    }
    assert.ok(
      !visibleQuotes.some((entry) => entry.id === quoteBId),
      'le devis de B ne doit jamais apparaitre dans la liste de A',
    );
    assert.ok(
      visibleQuotes.some((entry) => entry.id === quoteId),
      'le devis de A doit, lui, etre present',
    );

    // --- Ce qui est refuse AVANT le service : un champ non declare ----------
    //
    // `forbidNonWhitelisted` fait echouer la requete sur un champ inconnu du DTO.
    // C'est la deuxieme barriere : un champ glisse dans un corps ne peut pas etre
    // « ignore en silence » par un service distrait, il est refuse.
    //
    // `clientId` A CHANGE DE CAMP, ET CE TEST A SUIVI — IL ECHOUAIT.
    // Il servait ici d'exemple de champ non declare sur `POST /users`, avec un
    // 400 attendu. Ce n'est plus vrai : `clientId` est desormais DECLARE sur
    // `CreateUserDto`, parce que sans lui un compte CLIENT cree par l'API nait
    // sans perimetre et reste inutilisable (voir le commentaire de `CreateUserDto`,
    // et le bloc plus haut qui construit les deux comptes porteurs). L'assertion
    // demandait donc un refus que le code ne produit plus — et ne DOIT plus
    // produire. L'exemple est remplace par `roleId`, qui reste absent du DTO :
    // les roles s'attribuent par `roleCodes`, et un `roleId` glisse la est
    // exactement la meme tentative, refusee par la meme barriere.
    //
    // La couverture du rattachement `clientId` vit dans `identity.e2e-spec.ts`
    // (« cree un compte CLIENT rattache a son dossier, et lui ouvre CE dossier —
    // et lui seul », puis les refus 404 et 422), pas ici : ce fichier verifie la
    // chaine metier, pas l'administration des comptes.
    const injectedClient = await request(app.getHttpServer())
      .post(`${baseUrl}/clients`)
      .set(auth(adminToken))
      .send({ companyName: `Injection ${RUN}`, roleId: adminRoleId });

    assert.equal(injectedClient.status, 400);
    assert.equal(errorOf(injectedClient).code, 'VALIDATION_FAILED');

    const injectedUser = await request(app.getHttpServer())
      .post(`${baseUrl}/users`)
      .set(auth(adminToken))
      .send({
        email: `${MARKER}-inject-${RUN}@comexa.example`,
        firstName: 'Test',
        lastName: 'Injection',
        roleCodes: ['CLIENT'],
        roleId: adminRoleId,
      });

    assert.equal(
      injectedUser.status,
      400,
      'un champ non declare sur POST /users doit etre refuse, jamais ignore',
    );
    assert.equal(errorOf(injectedUser).code, 'VALIDATION_FAILED');
  });

  // ---------------------------------------------------------------------------
  // 15. DOCUMENTS : l'interne ne remonte jamais dans l'espace client
  // ---------------------------------------------------------------------------

  it('15. DOCUMENTS : la visibilite INTERNAL reste invisible au porteur client, et les taches internes lui sont fermees', async () => {
    const upload = async (
      name: string,
      visibility: string,
      clientId: string,
      projectId: string,
    ): Promise<string> => {
      const response = await request(app.getHttpServer())
        .post(`${baseUrl}/documents`)
        .set(auth(adminToken))
        .field('name', name)
        .field('category', 'OTHER')
        .field('visibility', visibility)
        .field('clientId', clientId)
        .field('projectId', projectId)
        .attach('file', Buffer.from(`Contenu du document ${name}.\n`, 'utf8'), 'note.txt');

      assert.equal(
        response.status,
        201,
        `depot du document ${name} : ${response.status} ${JSON.stringify(response.body)}`,
      );

      const document = dataOf<DocumentPayload>(response);
      assert.equal(document.name, name);
      assert.equal(document.visibility, visibility);
      createdDocumentIds.push(document.id);
      return document.id;
    };

    documentInternalAId = await upload(`Note interne A ${RUN}`, 'INTERNAL', clientAId, projectAId);
    documentClientAId = await upload(`Livrable client A ${RUN}`, 'CLIENT', clientAId, projectAId);
    documentPublicAId = await upload(
      `Plaquette publique A ${RUN}`,
      'PUBLIC',
      clientAId,
      projectAId,
    );
    documentInternalBId = await upload(`Note interne B ${RUN}`, 'INTERNAL', clientBId, projectBId);

    // --- Cote agence : les quatre documents sont la, y compris l'interne ----
    const adminList = await request(app.getHttpServer())
      .get(`${baseUrl}/documents`)
      .query({ projectId: projectAId })
      .set(auth(adminToken));

    assert.equal(adminList.status, 200);
    const adminDocuments = dataOf<DocumentPayload[]>(adminList);
    assert.deepEqual(
      adminDocuments.map((document) => document.id).sort(),
      [documentInternalAId, documentClientAId, documentPublicAId].sort(),
      "l'agence voit les trois documents du projet, interne compris",
    );

    // --- Cote client A : l'interne a disparu, et celui de B aussi -----------
    const clientList = await request(app.getHttpServer())
      .get(`${baseUrl}/documents`)
      .query({ projectId: projectAId })
      .set(auth(portalAToken));

    assert.equal(clientList.status, 200);
    const clientDocuments = dataOf<DocumentPayload[]>(clientList);

    assert.deepEqual(
      clientDocuments.map((document) => document.id).sort(),
      [documentClientAId, documentPublicAId].sort(),
      'le porteur client ne voit que les documents partageables de son dossier',
    );
    assert.ok(
      !clientDocuments.some((document) => document.visibility === 'INTERNAL'),
      "un document INTERNAL ne doit JAMAIS remonter dans l'espace client",
    );
    assert.ok(
      !clientDocuments.some((document) => document.id === documentInternalBId),
      'le document interne du dossier B ne doit pas non plus remonter',
    );

    // --- Lire l'interne par son identifiant : introuvable, pas interdit -----
    const internalRead = await request(app.getHttpServer())
      .get(`${baseUrl}/documents/${documentInternalAId}`)
      .set(auth(portalAToken));

    assert.equal(internalRead.status, 404);
    assert.equal(errorOf(internalRead).code, 'DOCUMENT_NOT_FOUND');

    const foreignRead = await request(app.getHttpServer())
      .get(`${baseUrl}/documents/${documentInternalBId}`)
      .set(auth(portalAToken));

    assert.equal(foreignRead.status, 404);
    assert.equal(errorOf(foreignRead).code, 'DOCUMENT_NOT_FOUND');

    // --- DEMANDER l'interne ne l'ouvre pas plus -----------------------------
    //
    // Le filtre de la requete CROISE les visibilites autorisees : il ne peut
    // jamais les elargir. La demande incoherente est refusee (403 FORBIDDEN)
    // plutot que servie comme une liste vide — un appelant qui demanderait
    // l'interne et recevrait `[]` croirait a une base vide.
    const askedInternal = await request(app.getHttpServer())
      .get(`${baseUrl}/documents`)
      .query({ visibility: 'INTERNAL' })
      .set(auth(portalAToken));

    assert.equal(askedInternal.status, 403);
    assert.equal(errorOf(askedInternal).code, 'FORBIDDEN');

    // --- Les taches internes sont fermees au client, structurellement ------
    //
    // Le role CLIENT ne detient AUCUNE permission `task:*` : le garde l'arrete
    // avant le service, et il n'existe donc aucun chemin par lequel une tache
    // interne pourrait sortir. La composition d'une equipe est fermee pour la
    // meme raison (`project:read:assigned` n'est pas au catalogue du client).
    const tasksForClient = await request(app.getHttpServer())
      .get(`${baseUrl}/projects/${projectAId}/tasks`)
      .set(auth(portalAToken));

    assert.equal(tasksForClient.status, 403);
    assert.equal(errorOf(tasksForClient).code, 'FORBIDDEN');

    const myTasksForClient = await request(app.getHttpServer())
      .get(`${baseUrl}/me/tasks`)
      .set(auth(portalAToken));

    assert.equal(myTasksForClient.status, 403);

    // --- Le client ne depose pas non plus dans la bibliotheque interne ------
    const clientUpload = await request(app.getHttpServer())
      .post(`${baseUrl}/documents`)
      .set(auth(portalAToken))
      .field('name', `Depot client ${RUN}`)
      .attach('file', Buffer.from('Contenu.\n', 'utf8'), 'note.txt');

    assert.equal(clientUpload.status, 403);

    // --- Nettoyage des objets de stockage, par la route qui les retire ------
    //
    // `DELETE /documents/:id` supprime l'objet ET la ligne. Le passer par l'API
    // plutot que par Prisma est deliberé : c'est le seul chemin qui ne laisse pas
    // de fichier orphelin dans le stockage.
    for (const documentId of [
      documentInternalAId,
      documentClientAId,
      documentPublicAId,
      documentInternalBId,
    ]) {
      const removed = await request(app.getHttpServer())
        .delete(`${baseUrl}/documents/${documentId}`)
        .set(auth(adminToken));

      assert.equal(removed.status, 200, `suppression du document ${documentId}`);
    }
  });
});
