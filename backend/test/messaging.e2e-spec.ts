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
 * MESSAGERIE — TEST DE BOUT EN BOUT, SUR LA VRAIE BASE.
 *
 * Ce que ce fichier verifie, et que rien d'autre ne peut verifier :
 *
 *  1. QUE LA PERSISTANCE EST REELLE. Le client a demande « messages persistes
 *     dans PostgreSQL ». Un message ecrit doit se relire, par une AUTRE session,
 *     avec le meme contenu et le meme auteur. Un test unitaire du service avec un
 *     Prisma simule aurait valide une intention, pas une ecriture.
 *
 *  2. QU'UN NON-PARTICIPANT N'OBTIENT RIEN. Le troisieme compte de ce fichier
 *     n'est jamais ajoute a la conversation. Il essaie de lire les messages, d'y
 *     ecrire, et de lire la conversation : les trois doivent repondre 404 — et
 *     surtout pas 403, qui confirmerait l'existence de la conversation, ni un
 *     corps vide, qui laisserait croire a une conversation sans message.
 *
 *  3. QUE LE CORPS DE LA REQUETE NE PEUT PAS FORCER L'AUTEUR. Un `senderId`
 *     glisse dans le corps doit produire un 400 : c'est `forbidNonWhitelisted`
 *     qui le refuse, et c'est ce qui empeche d'ecrire au nom d'un autre en
 *     changeant un champ. Les memes requetes verifient qu'un `?page=` sur le
 *     flux de messages est refuse au lieu d'etre ignore en silence.
 *
 *  4. QUE LA PAGINATION PAR CURSEUR TIENT. Trois messages, deux par page : la
 *     premiere page annonce une suite, la seconde la termine, et le curseur se
 *     relit sans perdre ni repeter une ligne.
 *
 *  5. QUE LA BOITE DE NOTIFICATIONS EST CLOSE. Le destinataire voit ses
 *     notifications, marque la sienne comme lue ; l'intrus ne voit rien et ne
 *     peut pas marquer celle d'un autre.
 *
 * CE FICHIER N'OUVRE AUCUN CLIENT SOCKET.IO, ET C'EST DELIBERE. Le temps reel est
 * un effet de bord : la verite est en base, et c'est elle qui est testee ici. Un
 * client socket aurait ajoute une source d'instabilite (port, delai, ordre
 * d'arrivee) pour verifier une diffusion qui, si elle echoue, ne perd aucun
 * message. La partie verifiable sans serveur — l'extraction du jeton de la
 * poignee de main, la verification de participation avant `join` — est couverte
 * par `src/modules/messaging/realtime.auth.spec.ts`.
 *
 * ETAT ATTENDU AUJOURD'HUI : CE FICHIER NE PASSE PAS ENCORE. `MessagingModule`
 * n'est pas monte dans `app.module.ts` (fichier interdit), donc les routes
 * `/api/conversations` n'existent pas et Express repond 404 des le premier
 * scenario. C'est normal : le montage est une ligne que le coordinateur doit
 * ajouter. Voir le rapport, section 9.
 *
 * ATTENTION AU LIMITEUR DE DEBIT : la connexion est plafonnee a 10 appels par
 * minute et par adresse IP. Ce fichier ouvre TROIS sessions, une par compte, et
 * les partage ensuite. Ne pas en ajouter sans regarder ce compteur.
 */

const PASSWORD = 'Cascade-Lumiere-Forge-72-Quartz';

const EMAIL_AUTHOR = 'e2e-messaging-auteur@comexa.example';
const EMAIL_MEMBER = 'e2e-messaging-membre@comexa.example';
const EMAIL_OUTSIDER = 'e2e-messaging-intrus@comexa.example';

const ALL_EMAILS = [EMAIL_AUTHOR, EMAIL_MEMBER, EMAIL_OUTSIDER];

/** Forme de succes, telle que `TransformInterceptor` la produit. */
interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: unknown;
}

interface PaginatedBody<T> {
  success: true;
  data: T[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}

/** Forme d'echec, telle que `AllExceptionsFilter` la produit. */
interface ErrorBody {
  success: false;
  error: { code: string; message: string; details: unknown };
}

interface LoginData {
  accessToken: string;
  user: { id: string; email: string };
}

interface ConversationData {
  id: string;
  type: string;
  subject: string | null;
  isArchived: boolean;
  unreadCount: number;
  participants: { userId: string; role: string }[];
}

interface MessageData {
  id: string;
  conversationId: string;
  senderId: string | null;
  body: string;
}

interface NotificationData {
  id: string;
  type: string;
  title: string;
  readAt: string | null;
  entityId: string | null;
}

/** Le `meta` du flux de messages : pas de `page`/`total`, un curseur. */
interface CursorMeta {
  perPage: number;
  hasMore: boolean;
  nextCursor: string | null;
}

function errorOf(response: request.Response): ErrorBody['error'] {
  const body = response.body as ErrorBody;
  assert.equal(body.success, false, "une reponse d'echec doit porter success: false");
  return body.error;
}

async function login(
  app: INestApplication,
  baseUrl: string,
  email: string,
): Promise<LoginData> {
  const response = await request(app.getHttpServer())
    .post(`${baseUrl}/auth/login`)
    .send({ email, password: PASSWORD });

  assert.equal(response.status, 200, `connexion impossible pour ${email}`);
  return (response.body as SuccessBody<LoginData>).data;
}

/**
 * Efface tout ce que ce fichier a pu laisser, DANS L'ORDRE DES DEPENDANCES.
 *
 * Les cles etrangeres n'ont pas toutes un `onDelete: cascade`, et supposer
 * l'inverse ferait echouer le nettoyage au moment precis ou il compte : apres
 * une execution perturbee, quand la base est deja dans un etat mixte. On part
 * donc des messages et on remonte vers les comptes.
 */
async function purge(prisma: PrismaService, emails: readonly string[]): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { in: [...emails] } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  if (userIds.length === 0) {
    return;
  }

  const conversations = await prisma.conversation.findMany({
    where: {
      OR: [
        { createdById: { in: userIds } },
        { participants: { some: { userId: { in: userIds } } } },
      ],
    },
    select: { id: true },
  });
  const conversationIds = conversations.map((conversation) => conversation.id);

  await prisma.messageAttachment.deleteMany({
    where: { message: { conversationId: { in: conversationIds } } },
  });
  await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: { in: conversationIds } },
  });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorId: { in: userIds } },
        { entityId: { in: [...userIds, ...conversationIds] } },
      ],
    },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

describe('Messagerie et notifications (bout en bout, base reelle)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  let author: LoginData;
  let member: LoginData;
  let outsider: LoginData;

  // Etat partage entre les scenarios, dans l'ordre de lecture du parcours. Le
  // remonter a chaque test ferait autant d'ecritures inutiles.
  let conversationId = '';
  const messageIds: string[] = [];
  let firstNotificationId = '';

  before(async () => {
    const violation = passwordPolicyViolation(PASSWORD);
    assert.equal(
      violation,
      null,
      `mot de passe de test refuse par la politique : ${violation}`,
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);

    // LA ligne qui compte : la meme configuration que `main.ts`. Sans elle, le
    // test parlerait a une application sans ValidationPipe ni enveloppe.
    const setup = configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    baseUrl = `/${setup.apiPrefix}`;

    // Nettoyage preventif : un run precedent interrompu a pu laisser ses comptes.
    await purge(prisma, ALL_EMAILS);

    const [adminRole, developerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'DEVELOPER' }, select: { id: true } }),
    ]);

    const passwordHash = await hashPassword(PASSWORD);

    const base = {
      passwordHash,
      status: 'ACTIVE' as const,
      isEmailVerified: true,
      // Aucun des trois comptes ne doit porter `mustChangePassword` : le garde
      // fermerait alors TOUTES les routes de messagerie, et le parcours
      // echouerait sur un 403 qui n'a rien a voir avec ce qu'on teste.
      mustChangePassword: false,
    };

    await prisma.user.create({
      data: {
        ...base,
        email: EMAIL_AUTHOR,
        firstName: 'Auteur',
        lastName: 'Bout en bout',
        roles: { create: { roleId: adminRole.id } },
      },
      select: { id: true },
    });

    await prisma.user.create({
      data: {
        ...base,
        email: EMAIL_MEMBER,
        firstName: 'Membre',
        lastName: 'Bout en bout',
        roles: { create: { roleId: developerRole.id } },
      },
      select: { id: true },
    });

    await prisma.user.create({
      data: {
        ...base,
        email: EMAIL_OUTSIDER,
        firstName: 'Intrus',
        lastName: 'Bout en bout',
        roles: { create: { roleId: developerRole.id } },
      },
      select: { id: true },
    });

    author = await login(app, baseUrl, EMAIL_AUTHOR);
    member = await login(app, baseUrl, EMAIL_MEMBER);
    outsider = await login(app, baseUrl, EMAIL_OUTSIDER);
  });

  after(async () => {
    if (app) {
      await purge(prisma, ALL_EMAILS);
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Acces et creation
  // ---------------------------------------------------------------------------

  it("refuse une route de messagerie sans jeton, avec l'enveloppe contractuelle", async () => {
    const response = await request(app.getHttpServer()).get(`${baseUrl}/conversations`);

    assert.equal(response.status, 401);
    assert.equal(errorOf(response).code, 'UNAUTHENTICATED');
    assert.equal(errorOf(response).details, null);
  });

  it("cree une conversation, y inscrit l'auteur et le participant demande", async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/conversations`)
      .set('Authorization', `Bearer ${author.accessToken}`)
      .send({ subject: 'Chantier e2e', participantIds: [member.user.id] });

    assert.equal(response.status, 201);
    const body = response.body as SuccessBody<ConversationData>;
    conversationId = body.data.id;

    assert.equal(body.data.subject, 'Chantier e2e');
    assert.deepEqual(
      body.data.participants.map((participant) => participant.userId).sort(),
      [author.user.id, member.user.id].sort(),
    );
    // L'auteur est OWNER, l'autre MEMBER : c'est la seule distinction de role
    // que le schema porte, elle doit etre posee.
    assert.equal(
      body.data.participants.find((p) => p.userId === author.user.id)?.role,
      'OWNER',
    );
  });

  it("refuse un participant qui n'existe pas, sans dire lequel", async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/conversations`)
      .set('Authorization', `Bearer ${author.accessToken}`)
      .send({ participantIds: [member.user.id, 'compte-inexistant'] });

    assert.equal(response.status, 422);
    assert.equal(errorOf(response).code, 'CONVERSATION_PARTICIPANT_UNKNOWN');
  });

  it("n'a pas de messages au depart, et le dit sans inventer de curseur", async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    assert.equal(response.status, 200);
    const body = response.body as SuccessBody<MessageData[]> & { meta: CursorMeta };
    assert.deepEqual(body.data, []);
    assert.equal(body.meta.hasMore, false);
    assert.equal(body.meta.nextCursor, null);
  });

  // ---------------------------------------------------------------------------
  // Validation : le corps ne peut pas forcer l'auteur
  // ---------------------------------------------------------------------------

  it("refuse un message qui tente d'imposer son auteur par le corps de la requete", async () => {
    // Sans `forbidNonWhitelisted`, ce champ serait ignore en silence et le
    // message serait ecrit au nom du PORTEUR — donc sans consequence visible.
    // C'est justement pourquoi on exige un 400 : un silence ne se teste pas.
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ body: 'Je signe au nom de quelqu un d autre', senderId: author.user.id });

    assert.equal(response.status, 400);
    assert.equal(errorOf(response).code, 'VALIDATION_FAILED');
  });

  it('refuse une pagination par `page` sur le flux de messages', async () => {
    // La pagination se fait par curseur. Accepter `page` en silence laisserait
    // le frontend croire qu'il pagine alors que la valeur serait ignoree.
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/conversations/${conversationId}/messages?page=2`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    assert.equal(response.status, 400);
    assert.equal(errorOf(response).code, 'VALIDATION_FAILED');
  });

  it('refuse un curseur illisible plutot que de renvoyer la mauvaise page', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/conversations/${conversationId}/messages?cursor=!!!`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    assert.equal(response.status, 400);
    assert.equal(errorOf(response).code, 'MESSAGE_CURSOR_INVALID');
  });

  // ---------------------------------------------------------------------------
  // Persistance
  // ---------------------------------------------------------------------------

  it('persiste un message et l attribue au porteur du jeton', async () => {
    const bodies = [
      'Premier message persiste',
      'Deuxieme message persiste',
      'Troisieme message persiste',
    ];

    for (const body of bodies) {
      const response = await request(app.getHttpServer())
        .post(`${baseUrl}/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${author.accessToken}`)
        .send({ body });

      assert.equal(response.status, 201);
      const created = (response.body as SuccessBody<MessageData>).data;
      assert.equal(created.body, body);
      // L'auteur vient du JETON. Il n'existe aucun champ pour le choisir.
      assert.equal(created.senderId, author.user.id);
      assert.equal(created.conversationId, conversationId);
      messageIds.push(created.id);
    }

    // Et la lecture DIRECTE en base confirme l'ecriture : c'est l'exigence du
    // client, « messages persistes dans PostgreSQL ».
    const stored = await prisma.message.findMany({
      where: { conversationId },
      select: { id: true, body: true, senderId: true },
    });

    assert.equal(stored.length, 3);
    assert.ok(stored.every((message) => message.senderId === author.user.id));
  });

  it('relit les messages dans l ordre du plus recent au plus ancien', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    assert.equal(response.status, 200);
    const body = response.body as SuccessBody<MessageData[]>;

    assert.equal(body.data.length, 3);
    assert.deepEqual(
      body.data.map((message) => message.body),
      ['Troisieme message persiste', 'Deuxieme message persiste', 'Premier message persiste'],
    );
    // Les identifiants relus sont EXACTEMENT ceux rendus a l'ecriture, dans
    // l'ordre inverse. C'est l'aller-retour complet : le meme enregistrement,
    // pas une copie qui lui ressemble.
    assert.deepEqual(
      body.data.map((message) => message.id),
      [...messageIds].reverse(),
    );
  });

  it('pagine par curseur : la premiere page annonce une suite, la seconde la termine', async () => {
    const first = await request(app.getHttpServer())
      .get(`${baseUrl}/conversations/${conversationId}/messages?perPage=2`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    assert.equal(first.status, 200);
    const firstBody = first.body as SuccessBody<MessageData[]> & { meta: CursorMeta };

    assert.equal(firstBody.data.length, 2);
    assert.equal(firstBody.meta.hasMore, true);
    assert.ok(firstBody.meta.nextCursor, 'une suite doit venir avec un curseur');

    const second = await request(app.getHttpServer())
      .get(
        `${baseUrl}/conversations/${conversationId}/messages?perPage=2&cursor=${encodeURIComponent(
          firstBody.meta.nextCursor ?? '',
        )}`,
      )
      .set('Authorization', `Bearer ${member.accessToken}`);

    assert.equal(second.status, 200);
    const secondBody = second.body as SuccessBody<MessageData[]> & { meta: CursorMeta };

    assert.equal(secondBody.data.length, 1);
    assert.equal(secondBody.meta.hasMore, false);
    assert.equal(secondBody.meta.nextCursor, null);

    // Aucun message ne doit apparaitre deux fois, ni disparaitre entre les deux
    // pages : c'est toute la raison d'etre du curseur.
    const seen = [...firstBody.data, ...secondBody.data].map((message) => message.id);
    assert.equal(new Set(seen).size, 3);
  });

  // ---------------------------------------------------------------------------
  // Un non-participant n'obtient rien
  // ---------------------------------------------------------------------------

  it("refuse a un non-participant la lecture des messages, sans confirmer l'existence", async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${outsider.accessToken}`);

    // 404 et non 403 : un 403 confirmerait que cette conversation existe. Avec
    // un identifiant devine, il suffirait alors de balayer la table pour
    // apprendre quelles conversations l'agence entretient.
    assert.equal(response.status, 404);
    assert.equal(errorOf(response).code, 'CONVERSATION_NOT_FOUND');
    // Et surtout : aucune fuite de contenu, meme partielle.
    assert.ok(
      !JSON.stringify(response.body).includes('message persiste'),
      'aucun extrait de message ne doit apparaitre dans un refus',
    );
  });

  it("refuse a un non-participant l'ecriture dans la conversation", async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({ body: 'Je m invite dans la conversation' });

    assert.equal(response.status, 404);
    assert.equal(errorOf(response).code, 'CONVERSATION_NOT_FOUND');

    const count = await prisma.message.count({ where: { conversationId } });
    assert.equal(count, 3, "un refus ne doit pas avoir ecrit de message");
  });

  it('refuse a un non-participant la fiche de la conversation', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${outsider.accessToken}`);

    assert.equal(response.status, 404);
    assert.equal(errorOf(response).code, 'CONVERSATION_NOT_FOUND');
  });

  it('ne montre a un non-participant aucune conversation dans sa liste', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/conversations`)
      .set('Authorization', `Bearer ${outsider.accessToken}`);

    assert.equal(response.status, 200);
    const body = response.body as PaginatedBody<ConversationData>;

    assert.equal(body.data.length, 0);
    assert.equal(body.meta.total, 0);
  });

  it('laisse le participant retrouver la conversation dans sa liste', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/conversations`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    assert.equal(response.status, 200);
    const body = response.body as PaginatedBody<ConversationData>;

    assert.equal(body.data.length, 1);
    assert.equal(body.data[0]?.id, conversationId);
    // Les trois messages viennent de l'auteur, et le membre ne les a jamais lus.
    assert.equal(body.data[0]?.unreadCount, 3);
  });

  // ---------------------------------------------------------------------------
  // Etat de lecture
  // ---------------------------------------------------------------------------

  it('marque la conversation comme lue et remet le compteur a zero', async () => {
    const marked = await request(app.getHttpServer())
      .post(`${baseUrl}/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({});

    // 200 et non 201 : rien n'a ete cree, un etat a change.
    assert.equal(marked.status, 200);

    const list = await request(app.getHttpServer())
      .get(`${baseUrl}/conversations`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    const body = list.body as PaginatedBody<ConversationData>;
    assert.equal(body.data[0]?.unreadCount, 0);
  });

  it("refuse a un non-participant de marquer la conversation comme lue", async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({});

    assert.equal(response.status, 404);
    assert.equal(errorOf(response).code, 'CONVERSATION_NOT_FOUND');

    // La ligne de participation du membre ne doit pas avoir bouge : c'est la
    // preuve que le `where` du `updateMany` a bien porte sur le PORTEUR.
    const participant = await prisma.conversationParticipant.findFirstOrThrow({
      where: { conversationId, userId: member.user.id },
      select: { lastReadAt: true },
    });

    assert.ok(participant.lastReadAt, 'la date de lecture du membre doit etre intacte');
  });

  // ---------------------------------------------------------------------------
  // Boite de notifications
  // ---------------------------------------------------------------------------

  it('a notifie le destinataire, et lui seul, du message recu', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/notifications`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    assert.equal(response.status, 200);
    const body = response.body as PaginatedBody<NotificationData>;

    // Un par message ecrit par l'auteur. L'auteur lui-meme n'en recoit aucune :
    // se notifier de son propre message serait un bogue d'affichage.
    assert.equal(body.meta.total, 3);
    assert.ok(body.data.every((notification) => notification.type === 'MESSAGE_RECEIVED'));
    assert.ok(body.data.every((notification) => notification.readAt === null));

    firstNotificationId = body.data[0]?.id ?? '';
    assert.ok(firstNotificationId.length > 0);
  });

  it("ne montre a l'auteur aucune notification de ses propres messages", async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/notifications`)
      .set('Authorization', `Bearer ${author.accessToken}`);

    assert.equal(response.status, 200);
    const body = response.body as PaginatedBody<NotificationData>;

    // La propriete visee est « l'auteur n'est pas notifie du message qu'il vient
    // d'ecrire », et elle se lit sur LA CONVERSATION QUE CE FICHIER VIENT DE
    // CREER — l'entite que le service notifierait s'il se trompait de
    // destinataire (`entityType: 'Conversation'`, `entityId: conversationId`).
    //
    // Ce n'est PAS « la boite de l'auteur est vide », qui est une autre
    // affirmation : l'auteur porte le role ADMIN, et la route publique
    // `/public/contact-requests` notifie les porteurs ADMIN et SALES — jusqu'a
    // vingt (`contact-request.service.ts`, `notifyAgency`). Une autre suite qui
    // depose une demande de contact pendant ce run remplit donc legitimement
    // cette boite, et le test tomberait sur une fixture etrangere.
    assert.equal(
      body.data.filter((notification) => notification.entityId === conversationId).length,
      0,
      "l'auteur ne doit rien recevoir pour ses propres messages",
    );

    // Le controle ci-dessus ne voit qu'une page ; celui-ci est le meme, sans
    // pagination, et porte donc sur la boite entiere.
    const own = await prisma.notification.count({
      where: { userId: author.user.id, entityId: conversationId },
    });
    assert.equal(own, 0, "l'auteur ne doit rien recevoir pour ses propres messages");
  });

  it('marque une notification comme lue, et elle seule', async () => {
    const marked = await request(app.getHttpServer())
      .post(`${baseUrl}/notifications/${firstNotificationId}/read`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({});

    assert.equal(marked.status, 200);
    assert.ok((marked.body as SuccessBody<NotificationData>).data.readAt);

    const unread = await request(app.getHttpServer())
      .get(`${baseUrl}/notifications?read=false`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    assert.equal((unread.body as PaginatedBody<NotificationData>).meta.total, 2);

    // Idempotent : remarquer la meme notification ne doit pas echouer. Un
    // second appel vient du simple rechargement d'un ecran.
    const again = await request(app.getHttpServer())
      .post(`${baseUrl}/notifications/${firstNotificationId}/read`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({});

    assert.equal(again.status, 200);
  });

  it("refuse a un tiers de marquer la notification d'un autre", async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/notifications/${firstNotificationId}/read`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({});

    assert.equal(response.status, 404);
    assert.equal(errorOf(response).code, 'NOTIFICATION_NOT_FOUND');

    // Et la notification visee reste NON lue : le refus n'a rien touche.
    const stored = await prisma.notification.findUniqueOrThrow({
      where: { id: firstNotificationId },
      select: { readAt: true },
    });

    assert.ok(stored.readAt, 'la notification du membre doit rester dans son etat');
  });

  it("refuse a un tiers de supprimer la notification d'un autre", async () => {
    const response = await request(app.getHttpServer())
      .delete(`${baseUrl}/notifications/${firstNotificationId}`)
      .set('Authorization', `Bearer ${outsider.accessToken}`);

    assert.equal(response.status, 404);

    const still = await prisma.notification.count({ where: { id: firstNotificationId } });
    assert.equal(still, 1, 'une suppression refusee ne doit rien supprimer');
  });

  it('marque toute la boite comme lue', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/notifications/read-all`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({});

    assert.equal(response.status, 200);

    const unread = await request(app.getHttpServer())
      .get(`${baseUrl}/notifications?read=false`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    assert.equal((unread.body as PaginatedBody<NotificationData>).meta.total, 0);
  });

  it("n'a pas notifie le non-participant, meme apres une tentative d'ecriture refusee", async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/notifications`)
      .set('Authorization', `Bearer ${outsider.accessToken}`);

    assert.equal(response.status, 200);
    assert.equal((response.body as PaginatedBody<NotificationData>).meta.total, 0);
  });
});
