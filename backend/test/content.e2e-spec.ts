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

/**
 * CONTENU PUBLIC ET CLOISONNEMENT DES DOCUMENTS — BOUT EN BOUT, SUR LA VRAIE BASE.
 *
 * Ce fichier ne simule rien : il demarre `AppModule`, configure par le MEME
 * `configureApp` que `main.ts`, et parle en HTTP. Les requetes traversent donc
 * la chaine complete — `ThrottlerGuard`, `JwtAuthGuard`, `PermissionsGuard`,
 * `ValidationPipe`, l'intercepteur d'enveloppe et le filtre d'exceptions.
 *
 * POURQUOI CES DEUX SUJETS ENSEMBLE. Ce sont les deux proprietes du module que
 * rien d'autre ne peut verifier :
 *
 *  1. CE QUI NE DOIT PAS SORTIR. Le contenu public est servi SANS jeton. Un
 *     brouillon, un element desactive, une suppression logique ou une
 *     publication planifiee qui remonteraient ne casseraient aucun test unitaire
 *     — le service rendrait fidelement des lignes, simplement les mauvaises. Il
 *     faut donc interroger la route reelle et regarder ce qui revient.
 *
 *  2. CE QUI NE DOIT PAS ETRE LU. Un porteur CLIENT ne doit jamais obtenir un
 *     document INTERNAL, meme en le demandant explicitement, meme en
 *     connaissant son identifiant. Cette regle vit dans le `where` du service et
 *     dans le croisement des visibilites — deux endroits qu'un test unitaire
 *     aurait simules au lieu de les traverser.
 *
 * TROIS COMPTES SONT CREES ICI : un administrateur, le porteur du dossier A, le
 * porteur du dossier B. Le troisieme existe pour prouver que le cloisonnement
 * separe deux CLIENTS entre eux, et pas seulement le client de l'agence.
 *
 * ATTENTION AU LIMITEUR DE DEBIT. La connexion est plafonnee a 10 appels par
 * minute et par adresse IP, et le formulaire de contact public a 5. Ce fichier
 * ouvre donc TROIS sessions, une par compte, et les partage entre les
 * assertions. Ajouter des connexions sans regarder ce compteur produirait des
 * echecs a 429, intermittents et penibles a lire.
 *
 * CE FICHIER EST COMPILE AVANT D'ETRE EXECUTE (`npm run test:e2e` lance
 * `nest build -p tsconfig.e2e.json`, puis `node --test` sur la sortie) : `tsx` s'appuie
 * sur esbuild, qui n'emet pas la metadonnee `design:paramtypes` dont Nest a
 * besoin pour l'injection par constructeur.
 *
 * ETAT : `ContentModule` et `DocumentsModule` SONT montes par `app.module.ts` —
 * ils s'y suivent dans le tableau `imports`. Ce bloc annoncait le contraire :
 * des 404 attendus sur ces routes, et un fichier « pas encore branche sur une
 * suite verte ». Le montage a eu lieu, la prediction n'a plus d'objet, et la
 * phrase est corrigee plutot que laissee mentir.
 */

const PASSWORD = 'Cascade-Lumiere-Forge-72-Quartz';

const EMAIL_ADMIN = 'e2e-content-admin@comexa.example';
const EMAIL_CLIENT_A = 'e2e-content-client-a@comexa.example';
const EMAIL_CLIENT_B = 'e2e-content-client-b@comexa.example';

const SERVICE_ACTIF = 'e2e-service-actif';
const SERVICE_INACTIF = 'e2e-service-inactif';
const SERVICE_SUPPRIME = 'e2e-service-supprime';
const PACK_ACTIF = 'e2e-pack-actif';
const PACK_INACTIF = 'e2e-pack-inactif';
const ETUDE_PUBLIEE = 'e2e-etude-publiee';
const ETUDE_BROUILLON = 'e2e-etude-brouillon';
const ETUDE_PLANIFIEE = 'e2e-etude-planifiee';

/** Toute colonne qui trahit l'etat interne d'un contenu. */
const COLONNES_INTERNES = ['deletedAt', 'isActive', 'isPublished', 'createdAt', 'updatedAt'];

/**
 * Tout ce qui ressemble a un montant.
 *
 * C'est une assertion sur l'EXIGENCE DU CLIENT, mot pour mot : « Ne mets aucun
 * prix dans cette partie du backend. » Un test qui cherche les mots est plus
 * solide qu'une relecture : il echoue le jour ou quelqu'un ajoute un champ
 * `price` au modele et l'oublie dans le `select`, ce qui est exactement la
 * maniere dont un tarif reapparaitrait.
 */
const MOTIFS_DE_PRIX = /price|prix|amount|montant|tarif|cost|cout|rate|currency/i;

interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: { page: number; perPage: number; total: number; totalPages: number };
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

function errorOf(response: request.Response): ErrorBody['error'] {
  const body = response.body as ErrorBody;
  assert.equal(body.success, false, "une reponse d'echec doit porter success: false");
  return body.error;
}

function dataOf<T>(response: request.Response): T {
  const body = response.body as SuccessBody<T>;
  assert.equal(body.success, true, 'la reponse doit porter success: true');
  return body.data;
}

describe('Contenu public et cloisonnement des documents (bout en bout, base reelle)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  const createdUserIds: string[] = [];
  const createdClientIds: string[] = [];
  const createdServiceIds: string[] = [];
  const createdPackageIds: string[] = [];
  const createdCaseStudyIds: string[] = [];
  const createdTestimonialIds: string[] = [];
  const createdDocumentIds: string[] = [];
  const createdContactRequestIds: string[] = [];

  let adminToken = '';
  let clientAToken = '';
  let clientBToken = '';
  let documentInterneId = '';
  let documentClientAId = '';
  let documentClientBId = '';

  before(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);

    const setup = configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    baseUrl = `/${setup.apiPrefix}`;

    // Nettoyage preventif : un run precedent interrompu a pu laisser ses lignes.
    await nettoyerLesRestes(prisma);

    const passwordHash = await hashPassword(PASSWORD);

    // Les deux dossiers clients. `reference` est unique et obligatoire : ces
    // valeurs sont celles du test, elles ne collisionnent pas avec une
    // numerotation reelle.
    const clientA = await prisma.client.create({
      data: { reference: 'E2E-CLI-A', companyName: 'E2E Client A' },
      select: { id: true },
    });
    const clientB = await prisma.client.create({
      data: { reference: 'E2E-CLI-B', companyName: 'E2E Client B' },
      select: { id: true },
    });

    createdClientIds.push(clientA.id, clientB.id);

    const [adminRole, clientRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'CLIENT' }, select: { id: true } }),
    ]);

    const admin = await prisma.user.create({
      data: {
        email: EMAIL_ADMIN,
        passwordHash,
        firstName: 'Test',
        lastName: 'Contenu',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        roles: { create: { roleId: adminRole.id } },
      },
      select: { id: true },
    });

    const clientAUser = await prisma.user.create({
      data: {
        email: EMAIL_CLIENT_A,
        passwordHash,
        firstName: 'Test',
        lastName: 'Dossier A',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        // C'est ce rattachement qui donne son sens a `document:read:client` :
        // sans dossier, le service refuse la lecture plutot que de ne rien
        // filtrer.
        clientId: clientA.id,
        roles: { create: { roleId: clientRole.id } },
      },
      select: { id: true },
    });

    const clientBUser = await prisma.user.create({
      data: {
        email: EMAIL_CLIENT_B,
        passwordHash,
        firstName: 'Test',
        lastName: 'Dossier B',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        clientId: clientB.id,
        roles: { create: { roleId: clientRole.id } },
      },
      select: { id: true },
    });

    createdUserIds.push(admin.id, clientAUser.id, clientBUser.id);

    // Contenu public : chaque ligne existe pour prouver une exclusion.
    const [serviceActif, serviceInactif, serviceSupprime, pack, packInactif] = await Promise.all([
      prisma.service.create({
        data: {
          slug: SERVICE_ACTIF,
          title: 'Service actif',
          shortDescription: 'Visible sur le site.',
          features: ['Un point'],
          order: 1,
          isActive: true,
        },
        select: { id: true },
      }),
      prisma.service.create({
        data: {
          slug: SERVICE_INACTIF,
          title: 'Service inactif',
          shortDescription: 'Ne doit pas sortir.',
          isActive: false,
        },
        select: { id: true },
      }),
      prisma.service.create({
        data: {
          slug: SERVICE_SUPPRIME,
          title: 'Service supprime',
          shortDescription: 'Ne doit pas sortir non plus.',
          deletedAt: new Date(),
        },
        select: { id: true },
      }),
      prisma.package.create({
        data: {
          slug: PACK_ACTIF,
          name: 'Pack actif',
          tagline: 'Sans prix.',
          features: ['Ce que le pack comprend'],
          excludes: ['Ce qu il ne comprend pas'],
          isActive: true,
        },
        select: { id: true },
      }),
      // Le pack desactive. Il existe pour la meme raison que le service
      // inactif : SANS LUI, l'assertion « un pack inactif ne sort pas »
      // n'aurait rien a exclure, et le filtre `isActive` de la route publique
      // ne serait jamais exerce. Le seed ne suffit pas a ce role — il ne
      // publie que des packs actifs.
      prisma.package.create({
        data: {
          slug: PACK_INACTIF,
          name: 'Pack inactif',
          tagline: 'Hors ligne.',
          features: ['Un point'],
          isActive: false,
        },
        select: { id: true },
      }),
    ]);

    createdServiceIds.push(serviceActif.id, serviceInactif.id, serviceSupprime.id);
    createdPackageIds.push(pack.id, packInactif.id);

    const [etudePubliee, etudeBrouillon, etudePlanifiee] = await Promise.all([
      prisma.caseStudy.create({
        data: {
          slug: ETUDE_PUBLIEE,
          title: 'Etude publiee',
          excerpt: 'En ligne.',
          content: 'Contenu.',
          status: 'PUBLISHED',
          publishedAt: new Date(Date.now() - 86_400_000),
        },
        select: { id: true },
      }),
      prisma.caseStudy.create({
        data: {
          slug: ETUDE_BROUILLON,
          title: 'Etude brouillon',
          excerpt: 'Pas en ligne.',
          content: 'Contenu.',
          status: 'DRAFT',
        },
        select: { id: true },
      }),
      prisma.caseStudy.create({
        data: {
          slug: ETUDE_PLANIFIEE,
          title: 'Etude planifiee',
          excerpt: 'Publiee demain.',
          content: 'Contenu.',
          status: 'PUBLISHED',
          // Le cas qui se voit a l'oeil nu sur le site : une date d'avance.
          publishedAt: new Date(Date.now() + 86_400_000),
        },
        select: { id: true },
      }),
    ]);

    createdCaseStudyIds.push(etudePubliee.id, etudeBrouillon.id, etudePlanifiee.id);

    const [temoignagePublie, temoignageRetire] = await Promise.all([
      prisma.testimonial.create({
        data: { authorName: 'E2E Cliente A', quote: 'Tres bien.', isPublished: true, order: 1 },
        select: { id: true },
      }),
      prisma.testimonial.create({
        data: { authorName: 'E2E Cliente B', quote: 'Pas encore valide.', isPublished: false },
        select: { id: true },
      }),
    ]);

    createdTestimonialIds.push(temoignagePublie.id, temoignageRetire.id);

    // Trois documents, sans objet dans le stockage : les routes interrogees ici
    // ne lisent que la METADONNEE. La cle est inventee a dessein — c'est elle
    // qui ne doit jamais sortir dans une reponse.
    const [documentInterne, documentA, documentB] = await Promise.all([
      prisma.document.create({
        data: {
          name: 'Interne au dossier A',
          originalName: 'interne.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          storageKey: `documents/e2e/${SERVICE_ACTIF}-interne.pdf`,
          visibility: 'INTERNAL',
          clientId: clientA.id,
        },
        select: { id: true },
      }),
      prisma.document.create({
        data: {
          name: 'Partage avec le dossier A',
          originalName: 'partage.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          storageKey: `documents/e2e/${SERVICE_ACTIF}-partage.pdf`,
          visibility: 'CLIENT',
          clientId: clientA.id,
        },
        select: { id: true },
      }),
      prisma.document.create({
        data: {
          name: 'Partage avec le dossier B',
          originalName: 'b.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 4096,
          storageKey: `documents/e2e/${SERVICE_ACTIF}-b.pdf`,
          visibility: 'CLIENT',
          clientId: clientB.id,
        },
        select: { id: true },
      }),
    ]);

    documentInterneId = documentInterne.id;
    documentClientAId = documentA.id;
    documentClientBId = documentB.id;
    createdDocumentIds.push(documentInterne.id, documentA.id, documentB.id);

    // Les trois sessions, ouvertes UNE fois. Voir l'avertissement sur le
    // plafond de connexions en tete de fichier.
    adminToken = await connecter(app, baseUrl, EMAIL_ADMIN);
    clientAToken = await connecter(app, baseUrl, EMAIL_CLIENT_A);
    clientBToken = await connecter(app, baseUrl, EMAIL_CLIENT_B);

    // Verification prealable : si le role CLIENT perdait `document:read:client`,
    // toutes les assertions de cloisonnement echoueraient en 403 sans que la
    // cause soit lisible. On l'affirme ici, une fois.
    const profil = await request(app.getHttpServer())
      .get(`${baseUrl}/auth/me`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(200);

    const permissions = (profil.body as SuccessBody<{ permissions: string[] }>).data.permissions;
    assert.ok(
      permissions.includes('document:read:client'),
      'le role CLIENT doit porter document:read:client (catalogue ou permissions en base)',
    );
  });

  after(async () => {
    if (!app) return;

    // Ordre de suppression : les dependances d'abord. Les documents, demandes et
    // temoignages pointent vers les clients et les contenus ; l'inverse
    // laisserait des cles etrangeres orphelines.
    await nettoyerTout(prisma, {
      userIds: createdUserIds,
      clientIds: createdClientIds,
      documentIds: createdDocumentIds,
      contactRequestIds: createdContactRequestIds,
      testimonialIds: createdTestimonialIds,
      caseStudyIds: createdCaseStudyIds,
      serviceIds: createdServiceIds,
      packageIds: createdPackageIds,
    });

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Contenu public
  // ---------------------------------------------------------------------------

  it('sert le contenu actif sans jeton et ecarte ce qui ne l est pas', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/public/services`)
      .expect(200);

    const services = dataOf<Array<Record<string, unknown>>>(response);
    const slugs = services.map((service) => service.slug);

    assert.ok(slugs.includes(SERVICE_ACTIF), 'le service actif doit etre servi');
    assert.equal(slugs.includes(SERVICE_INACTIF), false, 'un service inactif ne doit pas sortir');
    assert.equal(
      slugs.includes(SERVICE_SUPPRIME),
      false,
      'un service supprime logiquement ne doit pas sortir',
    );
  });

  it('n expose aucune colonne interne sur le contenu public', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/public/services`)
      .expect(200);

    for (const service of dataOf<Array<Record<string, unknown>>>(response)) {
      for (const colonne of COLONNES_INTERNES) {
        assert.equal(
          Object.hasOwn(service, colonne),
          false,
          `la colonne interne ${colonne} ne doit pas sortir d'une route publique`,
        );
      }
    }
  });

  it('refuse le detail d un service qui n est pas public', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/public/services/${SERVICE_INACTIF}`)
      .expect(404);

    assert.equal(errorOf(response).code, 'SERVICE_NOT_FOUND');
  });

  it('ne sert ni le brouillon ni la publication planifiee', async () => {
    const liste = await request(app.getHttpServer())
      .get(`${baseUrl}/public/case-studies`)
      .expect(200);

    const slugs = dataOf<Array<Record<string, unknown>>>(liste).map((etude) => etude.slug);
    assert.ok(slugs.includes(ETUDE_PUBLIEE), "l'etude publiee doit etre servie");
    assert.equal(slugs.includes(ETUDE_BROUILLON), false, 'un brouillon ne doit pas sortir');
    assert.equal(
      slugs.includes(ETUDE_PLANIFIEE),
      false,
      'une publication datee dans le futur ne doit pas sortir',
    );

    const brouillon = await request(app.getHttpServer())
      .get(`${baseUrl}/public/case-studies/${ETUDE_BROUILLON}`)
      .expect(404);
    assert.equal(errorOf(brouillon).code, 'CASE_STUDY_NOT_FOUND');

    const planifiee = await request(app.getHttpServer())
      .get(`${baseUrl}/public/case-studies/${ETUDE_PLANIFIEE}`)
      .expect(404);
    assert.equal(errorOf(planifiee).code, 'CASE_STUDY_NOT_FOUND');
  });

  it('ne sert que les temoignages publies', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/public/testimonials`)
      .expect(200);

    const temoignages = dataOf<Array<Record<string, unknown>>>(response);

    // LA BASE EST PARTAGEE, ET C'EST ELLE QUI DECIDE. `prisma/seed.ts` publie
    // deja des temoignages fictifs : la reponse contient donc legitimement
    // d'autres lignes publiees que celles de ce fichier. Un comptage global
    // (`length === 1`) mesurerait le contenu du site, pas la regle — et il
    // deviendrait faux au premier temoignage ajoute par l'agence. On ramene
    // donc l'assertion aux DEUX fixtures du fichier, designees par leur
    // identifiant et non par leur rang : l'ordre servi (`order` croissant) ne
    // promet aucune position, `createdTestimonialIds[0]` est le publie et
    // `[1]` le retire (voir l'ordre du `push` dans le `before`).
    const publie = temoignages.find((temoignage) => temoignage.id === createdTestimonialIds[0]);
    assert.ok(publie, 'le temoignage publie par ce fichier doit etre servi');
    assert.equal(
      publie?.authorName,
      'E2E Cliente A',
      'la ligne servie est bien la fixture publiee, pas une autre',
    );

    // Le coeur du contrat, dit par l'identifiant de la ligne exclue et non par
    // un total : la fixture `isPublished: false` ne sort pas, quels que soient
    // les autres temoignages publies qui, eux, sortent a juste titre.
    assert.equal(
      temoignages.some((temoignage) => temoignage.id === createdTestimonialIds[1]),
      false,
      'un temoignage non publie ne doit pas sortir',
    );

    // Sur TOUTE ligne servie — celles du seed comprises, qui sont les plus
    // nombreuses : l'etat de publication ne regarde pas le visiteur.
    for (const temoignage of temoignages) {
      assert.equal(
        Object.hasOwn(temoignage, 'isPublished'),
        false,
        "l'etat de publication ne regarde pas le visiteur",
      );
    }
  });

  it('ne publie AUCUN montant sur les packs', async () => {
    const liste = await request(app.getHttpServer()).get(`${baseUrl}/public/packages`).expect(200);

    const packs = dataOf<Array<Record<string, unknown>>>(liste);

    // Meme raison que pour les temoignages : le seed sert trois packs actifs,
    // donc `length === 1` mesurerait le contenu du site. On interroge la liste
    // sur les fixtures du fichier, par leur slug.
    const pack = packs.find((candidat) => candidat.slug === PACK_ACTIF);
    assert.ok(pack, 'le pack actif de ce fichier doit etre servi');
    assert.equal(
      pack?.name,
      'Pack actif',
      'la ligne servie est bien la fixture du fichier, pas un pack du seed',
    );

    // Le coeur du contrat, dit par le slug de la ligne exclue et non par un
    // total : le pack desactive cree par ce fichier ne sort pas, alors que les
    // trois packs actifs du seed sortent a juste titre. C'est la seule
    // assertion du fichier qui exerce le filtre `isActive` des packs.
    assert.equal(
      packs.some((candidat) => candidat.slug === PACK_INACTIF),
      false,
      'un pack inactif ne doit pas sortir',
    );

    // L'exigence du client porte sur la reponse ENTIERE, pas sur la fixture :
    // c'est le seed, plus riche en champs, qu'un tarif oublie dans le `select`
    // trahirait en premier.
    verifierAucunPrix(packs, 'la liste publique des packs');

    const detail = await request(app.getHttpServer())
      .get(`${baseUrl}/public/packages/${PACK_ACTIF}`)
      .expect(200);
    verifierAucunPrix([dataOf<Record<string, unknown>>(detail)], 'le detail public du pack');
  });

  it('accepte une demande de contact sans jeton et ne renvoie pas sa reference', async () => {
    const email = 'e2e-demande-contact@comexa.example';

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/public/contact-requests`)
      .send({
        firstName: 'Visiteur',
        lastName: 'Anonyme',
        email,
        message: 'Bonjour, je souhaite un devis pour un site vitrine.',
        source: 'e2e',
        utmSource: 'e2e-test',
      })
      .expect(201);

    assert.deepEqual(dataOf<Record<string, unknown>>(response), { received: true });

    const demande = await prisma.contactRequest.findFirstOrThrow({
      where: { email },
      select: { id: true, reference: true, status: true, ipAddress: true, source: true },
    });

    createdContactRequestIds.push(demande.id);

    // La reference existe bien en base, au format attendu...
    assert.match(demande.reference, /^CTR-\d{4}-\d{4}$/, 'la reference doit suivre le format CTR');
    assert.equal(demande.status, 'NEW', "l'etat initial ne vient pas du corps de la requete");

    // ...et elle ne figure NULLE PART dans la reponse. Deux envois suffiraient
    // sinon a mesurer le volume annuel de demandes de l'agence.
    const corps = JSON.stringify(response.body);
    assert.equal(
      corps.includes(demande.reference),
      false,
      'la reference sequentielle ne doit pas apparaitre dans la reponse publique',
    );

    // Les traces techniques sont bien enregistrees par le serveur.
    assert.notEqual(
      demande.ipAddress,
      null,
      "l'adresse IP est lue sur la requete, pas dans le corps",
    );
  });

  it('refuse un corps de demande de contact qui tente de fixer son etat', async () => {
    // `forbidNonWhitelisted` : un champ non declare fait echouer la requete
    // plutot que d'etre ignore en silence.
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/public/contact-requests`)
      .send({
        firstName: 'Visiteur',
        lastName: 'Curieux',
        email: 'e2e-demande-refusee@comexa.example',
        message: 'Bonjour, je voudrais forcer mon statut de traitement.',
        status: 'CONVERTED',
      })
      .expect(400);

    assert.equal(response.body.success, false);

    const restee = await prisma.contactRequest.findFirst({
      where: { email: 'e2e-demande-refusee@comexa.example' },
      select: { id: true },
    });
    assert.equal(restee, null, 'aucune ligne ne doit etre ecrite quand le corps est refuse');
  });

  it('garde la file de traitement fermee sans jeton', async () => {
    await request(app.getHttpServer()).get(`${baseUrl}/contact-requests`).expect(401);
  });

  // ---------------------------------------------------------------------------
  // Cloisonnement des documents
  // ---------------------------------------------------------------------------

  it('ne sert a un client que les documents PARTAGEABLES de son dossier', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/documents`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(200);

    const documents = dataOf<Array<Record<string, unknown>>>(response);
    const ids = documents.map((document) => document.id);

    assert.deepEqual(
      ids,
      [documentClientAId],
      'le dossier A ne doit voir que son document partageable',
    );

    // La cle de stockage ne sort jamais, meme vers un porteur legitime : elle
    // decrit l'organisation interne du bucket.
    for (const document of documents) {
      assert.equal(
        Object.hasOwn(document, 'storageKey'),
        false,
        'la cle de stockage ne doit pas sortir dans une reponse',
      );
      assert.equal(Object.hasOwn(document, 'storageDriver'), false);
    }
  });

  it('renvoie 404, et non 403, sur un document interne du meme dossier', async () => {
    // 404 et non 403 : un 403 confirmerait que le document existe. Le client
    // n'a pas a apprendre ce qu'on lui cache.
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/documents/${documentInterneId}`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(404);

    assert.equal(errorOf(response).code, 'DOCUMENT_NOT_FOUND');
  });

  it('renvoie 404 sur le document d un AUTRE client', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/documents/${documentClientBId}`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(404);

    assert.equal(errorOf(response).code, 'DOCUMENT_NOT_FOUND');
  });

  it('cloisonne les deux dossiers clients entre eux, dans les deux sens', async () => {
    // Le sens inverse : sans cette assertion, une requete qui rendrait tous les
    // documents CLIENT de la base passerait le test precedent, puisque le
    // dossier B ne regarde que le document A.
    const liste = await request(app.getHttpServer())
      .get(`${baseUrl}/documents`)
      .set('Authorization', `Bearer ${clientBToken}`)
      .expect(200);

    const ids = dataOf<Array<{ id: string }>>(liste).map((document) => document.id);
    assert.deepEqual(ids, [documentClientBId], 'le dossier B ne doit voir que son propre document');

    await request(app.getHttpServer())
      .get(`${baseUrl}/documents/${documentClientAId}`)
      .set('Authorization', `Bearer ${clientBToken}`)
      .expect(404);
  });

  it('refuse a un client un filtre qui elargirait vers l interne', async () => {
    // Le filtre ne restreint que s'il est croise avec les visibilites
    // autorisees. `?visibility=INTERNAL` demande explicitement ce que le
    // porteur n'a pas le droit de lire : c'est un refus, pas un filtre vide.
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/documents`)
      .query({ visibility: 'INTERNAL' })
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(403);

    assert.equal(response.body.success, false);
  });

  it('sert le document interne a l agence, qui doit pouvoir le lire', async () => {
    // Sans cette assertion, les trois precedentes seraient satisfaites par une
    // route cassee pour tout le monde.
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/documents/${documentInterneId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    assert.equal(dataOf<{ id: string }>(response).id, documentInterneId);
  });

  it('exige un jeton sur les documents et sur l administration du contenu', async () => {
    await request(app.getHttpServer()).get(`${baseUrl}/documents`).expect(401);
    await request(app.getHttpServer()).get(`${baseUrl}/content/services`).expect(401);
  });

  it('refuse a un porteur CLIENT l administration du contenu', async () => {
    // Le catalogue ne donne aucune permission de contenu au role CLIENT. La
    // route de lecture publique est `@Public()` ; celle-ci, non.
    await request(app.getHttpServer())
      .get(`${baseUrl}/content/services`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .expect(403);
  });

  it('refuse a un client la decision d une demande de modification', async () => {
    // `decide:any` n'est porte par aucun role client. La route est fermee par le
    // garde, avant meme que le service ne verifie la portee.
    await request(app.getHttpServer())
      .patch(`${baseUrl}/modification-requests/inconnu`)
      .set('Authorization', `Bearer ${clientAToken}`)
      .set('Content-Type', 'application/json')
      .send({ status: 'APPROVED' })
      .expect(403);
  });
});

// -----------------------------------------------------------------------------
// Aides
// -----------------------------------------------------------------------------

/** Verifie qu'aucun champ ressemblant a un montant n'est expose. */
function verifierAucunPrix(objets: Array<Record<string, unknown>>, ou: string): void {
  assert.ok(objets.length > 0, `${ou} : le jeu de donnees ne doit pas etre vide`);

  for (const objet of objets) {
    for (const cle of Object.keys(objet)) {
      assert.equal(MOTIFS_DE_PRIX.test(cle), false, `${ou} expose un champ de tarif : ${cle}`);
    }
  }
}

/**
 * Ouvre une session et rend le jeton d'acces.
 *
 * On passe par la VRAIE route de connexion plutot que de signer un jeton a la
 * main : c'est le seul moyen d'obtenir un porteur dont les permissions sont
 * celles que la base accorde reellement au role. Un jeton fabrique en test
 * porterait les permissions qu'on a imaginees, et les assertions de
 * cloisonnement ne prouveraient plus rien sur le catalogue.
 */
async function connecter(app: INestApplication, baseUrl: string, email: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .post(`${baseUrl}/auth/login`)
    .send({ email, password: PASSWORD })
    .expect(200);

  return dataOf<LoginData>(response).accessToken;
}

interface NettoyageIds {
  userIds: readonly string[];
  clientIds: readonly string[];
  documentIds: readonly string[];
  contactRequestIds: readonly string[];
  testimonialIds: readonly string[];
  caseStudyIds: readonly string[];
  serviceIds: readonly string[];
  packageIds: readonly string[];
}

/**
 * Supprime les lignes du test, dans l'ordre des dependances.
 *
 * DEUX PRECAUTIONS QUI NE SE VOIENT PAS.
 *
 * 1. LES NOTIFICATIONS PARTENT AILLEURS. `notifyAgency` previent tous les
 *    porteurs ADMIN et SALES de la base — des comptes reels, pas ceux de ce
 *    fichier. Leurs notifications pointent vers une demande qui va disparaitre :
 *    on les retire par entite, sinon la base partagee garde des avis de lead
 *    vers du vide.
 *
 * 2. ON NE TOUCHE PAS AU COMPTEUR. La tentation est de supprimer la ligne
 *    `Counter` du scope `CONTACT_REQUEST` pour rendre la base « comme avant ».
 *    C'est faux et c'est dangereux : remettre le compteur a zero ferait
 *    reattribuer un numero deja porte par une demande reelle, et la prochaine
 *    vraie demande echouerait sur la contrainte d'unicite de `reference`. Le
 *    compteur avance, c'est son seul etat legitime.
 */
async function nettoyerTout(prisma: PrismaService, ids: NettoyageIds): Promise<void> {
  await prisma.notification.deleteMany({
    where: { entityType: 'ContactRequest', entityId: { in: [...ids.contactRequestIds] } },
  });

  await prisma.document.deleteMany({ where: { id: { in: [...ids.documentIds] } } });
  await prisma.contactRequest.deleteMany({ where: { id: { in: [...ids.contactRequestIds] } } });
  await prisma.testimonial.deleteMany({ where: { id: { in: [...ids.testimonialIds] } } });
  await prisma.caseStudy.deleteMany({ where: { id: { in: [...ids.caseStudyIds] } } });
  await prisma.service.deleteMany({ where: { id: { in: [...ids.serviceIds] } } });
  await prisma.package.deleteMany({ where: { id: { in: [...ids.packageIds] } } });

  // Les journaux d'audit ne se suppriment pas en cascade, et chaque connexion de
  // ce fichier en a ecrit : on les retire explicitement.
  if (ids.userIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ actorId: { in: [...ids.userIds] } }, { entityId: { in: [...ids.userIds] } }],
      },
    });
  }

  // Le reste part en cascade (UserRole, RefreshToken, documents du client).
  await prisma.user.deleteMany({ where: { id: { in: [...ids.userIds] } } });
  await prisma.client.deleteMany({ where: { id: { in: [...ids.clientIds] } } });
}

/**
 * Retrouve ce qu'un run precedent interrompu a pu laisser, puis le supprime.
 *
 * Tout est cherche par une VALEUR MARQUEE du test — l'email `e2e-…`, la
 * reference `E2E-CLI-…`, le prefixe de cle `documents/e2e/`, le slug `e2e-…`,
 * `source` qui commence par `e2e`. Aucune requete ici ne peut donc atteindre une
 * ligne reelle de la base partagee.
 */
async function nettoyerLesRestes(prisma: PrismaService): Promise<void> {
  const [users, clients, documents, demandes, temoignages, etudes, services, packs] =
    await Promise.all([
      prisma.user.findMany({
        where: { email: { in: [EMAIL_ADMIN, EMAIL_CLIENT_A, EMAIL_CLIENT_B] } },
        select: { id: true },
      }),
      prisma.client.findMany({
        where: { reference: { in: ['E2E-CLI-A', 'E2E-CLI-B'] } },
        select: { id: true },
      }),
      prisma.document.findMany({
        where: { storageKey: { startsWith: 'documents/e2e/' } },
        select: { id: true },
      }),
      prisma.contactRequest.findMany({
        where: { source: { startsWith: 'e2e' } },
        select: { id: true },
      }),
      prisma.testimonial.findMany({
        where: { authorName: { in: ['E2E Cliente A', 'E2E Cliente B'] } },
        select: { id: true },
      }),
      prisma.caseStudy.findMany({
        where: { slug: { in: [ETUDE_PUBLIEE, ETUDE_BROUILLON, ETUDE_PLANIFIEE] } },
        select: { id: true },
      }),
      prisma.service.findMany({
        where: { slug: { in: [SERVICE_ACTIF, SERVICE_INACTIF, SERVICE_SUPPRIME] } },
        select: { id: true },
      }),
      prisma.package.findMany({
        where: { slug: { in: [PACK_ACTIF, PACK_INACTIF] } },
        select: { id: true },
      }),
    ]);

  await nettoyerTout(prisma, {
    userIds: users.map((ligne) => ligne.id),
    clientIds: clients.map((ligne) => ligne.id),
    documentIds: documents.map((ligne) => ligne.id),
    contactRequestIds: demandes.map((ligne) => ligne.id),
    testimonialIds: temoignages.map((ligne) => ligne.id),
    caseStudyIds: etudes.map((ligne) => ligne.id),
    serviceIds: services.map((ligne) => ligne.id),
    packageIds: packs.map((ligne) => ligne.id),
  });
}
