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
import { passwordPolicyViolation, hashPassword } from '../src/common/security/password.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * PARCOURS D'AUTHENTIFICATION — TEST DE BOUT EN BOUT, SUR LA VRAIE BASE.
 *
 * Ce fichier ne simule rien. Il demarre l'application complete (`AppModule`),
 * configuree par le MEME `configureApp` que `main.ts`, connectee a la base
 * PostgreSQL reelle, et parle en HTTP. Les requetes traversent donc reellement
 * la chaine complete : `ThrottlerGuard`, `JwtAuthGuard`, `PermissionsGuard`,
 * `ValidationPipe`, le controleur, le service, Prisma, le filtre d'exceptions et
 * l'intercepteur d'enveloppe.
 *
 * POURQUOI PAS DE TEST UNITAIRE ICI. Un test unitaire de `AuthService` avec un
 * Prisma simule aurait valide une intention, pas un comportement. Or les
 * proprietes les plus importantes de ce module ne vivent PAS dans le service :
 *
 *  - la rotation des refresh tokens depend d'une contrainte d'unicite et d'un
 *    compare-and-swap en base ; un faux Prisma l'aurait toujours fait reussir ;
 *  - l'obligation de changer un mot de passe initial est appliquee par un GARDE,
 *    pas par le service — la tester au niveau du service n'aurait rien prouve ;
 *  - le format du cookie (`HttpOnly`, `Path`) est pose par le controleur via
 *    Express, hors de portee d'un test unitaire.
 *
 * Ces trois points sont exactement ceux qui cassent en silence. Ils sont donc
 * verifies ici, contre la vraie base.
 *
 * DEPENDANCE ASSUMEE : ce test exige une base joignable (`DATABASE_URL`). C'est
 * le prix de l'exigence « le module fonctionne avec la vraie base ». Il cree ses
 * propres comptes (`e2e-auth-…`) et les supprime a la fin ; il ne touche a
 * aucune donnee existante.
 *
 * CE FICHIER EST COMPILE AVANT D'ETRE EXECUTE (`npm run test:e2e` lance
 * `tsc -p tsconfig.e2e.json`, puis `node --test` sur la sortie). Ce n'est pas un
 * choix de confort : `tsx` s'appuie sur esbuild, qui n'emet pas la metadonnee
 * `design:paramtypes` dont Nest a besoin pour l'injection par constructeur. Sous
 * `tsx`, ce test echouait des le demarrage avec
 * « Cannot read properties of undefined (reading 'get') » dans `MailService` —
 * Nest construisait le service sans lui passer `ConfigService`. Voir
 * `tsconfig.e2e.json`, qui documente la mesure.
 *
 * ATTENTION AU LIMITEUR DE DEBIT : la route de connexion est plafonnee a 10
 * appels par minute et par adresse IP (voir `@Throttle` sur le controleur), et
 * le garde global est desormais ACTIF. Ce fichier effectue volontairement peu de
 * connexions — les scenarios partagent leurs sessions au lieu d'en ouvrir une par
 * assertion. Ajouter des connexions sans regarder ce compteur produirait des
 * echecs a 429, intermittents et difficiles a lire.
 */

const PASSWORD = 'Cascade-Lumiere-Forge-72-Quartz';
const EMAIL_NORMAL = 'e2e-auth-normal@comexa.example';
const EMAIL_MUST_CHANGE = 'e2e-auth-must-change@comexa.example';
const EMAIL_UNKNOWN = 'e2e-auth-inexistant@comexa.example';

const REFRESH_COOKIE = 'refresh_token';

/** Forme de succes, telle que `TransformInterceptor` la produit. */
interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: unknown;
}

/** Forme d'echec, telle que `AllExceptionsFilter` la produit. */
interface ErrorBody {
  success: false;
  error: { code: string; message: string; details: unknown };
}

interface LoginData {
  accessToken: string;
  refreshTokenExpiresAt: string;
  user: {
    id: string;
    email: string;
    roles: string[];
    permissions: string[];
    clientId: string | null;
    mustChangePassword: boolean;
  };
}

/** Extrait la valeur du cookie de rafraichissement, ou `null` s'il est efface. */
function refreshCookieOf(response: request.Response): string | null {
  const raw = (response.headers as Record<string, unknown>)['set-cookie'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const found = list.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`));

  if (!found) {
    return null;
  }

  const value = found.split(';')[0]?.slice(REFRESH_COOKIE.length + 1) ?? '';
  return value.length > 0 ? value : null;
}

function errorOf(response: request.Response): ErrorBody['error'] {
  const body = response.body as ErrorBody;
  assert.equal(body.success, false, "une reponse d'echec doit porter success: false");
  return body.error;
}

describe("Parcours d'authentification (bout en bout, base reelle)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const createdUserIds: string[] = [];

  // Sessions partagees entre les scenarios : ouvrir une connexion par assertion
  // ferait sauter le plafond de 10 connexions par minute.
  let normalToken = '';
  let normalUserId = '';
  let normalRefreshCookie: string | null = null;
  let mustChangeToken = '';

  before(async () => {
    // Le mot de passe du test doit respecter la politique reelle. Si celle-ci
    // durcit un jour, on veut un echec net ici, pas un 422 obscur au milieu du
    // parcours.
    // `passwordPolicyViolation` renvoie `null` quand le mot de passe convient,
    // et une phrase explicative sinon.
    const violation = passwordPolicyViolation(PASSWORD);
    assert.equal(
      violation,
      null,
      `mot de passe de test refuse par la politique : ${violation}`,
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();

    // `nestjs-pino` s'installe tout seul comme journal de l'application. En
    // test, chaque requete produirait une ligne JSON de plusieurs centaines de
    // caracteres, qui noierait les echecs d'assertion — c'est-a-dire exactement
    // l'information qu'on vient chercher. Le journal est donc coupe ici ; il ne
    // l'est evidemment pas dans `main.ts`.
    app.useLogger(false);

    // LA ligne qui compte : la meme configuration que `main.ts`. Sans elle, le
    // test parlerait a une application sans ValidationPipe ni enveloppe.
    const setup = configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    baseUrl = `/${setup.apiPrefix}`;

    const [adminRole, developerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'DEVELOPER' }, select: { id: true } }),
    ]);

    const passwordHash = await hashPassword(PASSWORD);

    // Nettoyage preventif : un run precedent interrompu a pu laisser ses comptes.
    await prisma.user.deleteMany({
      where: { email: { in: [EMAIL_NORMAL, EMAIL_MUST_CHANGE] } },
    });

    const normal = await prisma.user.create({
      data: {
        email: EMAIL_NORMAL,
        passwordHash,
        firstName: 'Test',
        lastName: 'Bout en bout',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        roles: { create: { roleId: adminRole.id } },
      },
      select: { id: true },
    });

    const mustChange = await prisma.user.create({
      data: {
        email: EMAIL_MUST_CHANGE,
        passwordHash,
        firstName: 'Test',
        lastName: 'Mot de passe initial',
        status: 'ACTIVE',
        isEmailVerified: true,
        // Le cas qui declenche le garde : compte cree par un administrateur,
        // dont le porteur n'a jamais choisi son mot de passe.
        mustChangePassword: true,
        roles: { create: { roleId: developerRole.id } },
      },
      select: { id: true },
    });

    createdUserIds.push(normal.id, mustChange.id);
  });

  after(async () => {
    if (app) {
      // Les journaux d'audit ne se suppriment pas en cascade : on les retire
      // explicitement pour ne pas laisser de bruit dans la base partagee.
      await prisma.auditLog.deleteMany({
        where: { OR: [{ actorId: { in: createdUserIds } }, { entityId: { in: createdUserIds } }] },
      });
      // Le reste part en cascade (UserRole, RefreshToken, PasswordResetToken).
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await app.close();
    }
  });

  it("refuse une route protegee sans jeton, avec l'enveloppe d'erreur contractuelle", async () => {
    const response = await request(app.getHttpServer()).get(`${baseUrl}/auth/me`);

    assert.equal(response.status, 401);
    const error = errorOf(response);
    assert.equal(error.code, 'UNAUTHENTICATED');
    assert.equal(error.details, null);
  });

  it('rejette un corps qui contient un champ non declare (ValidationPipe reellement actif)', async () => {
    // Ce test echouerait si `configureApp` n'etait pas applique : sans lui, le
    // champ passerait et la route repondrait 401 avant meme de valider.
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: EMAIL_NORMAL, password: PASSWORD, roleId: 'escalade-de-privilege' });

    assert.equal(response.status, 400);
    assert.equal(errorOf(response).code, 'VALIDATION_FAILED');
  });

  it('connecte un compte, pose un cookie HttpOnly et ne divulgue pas le refresh token dans le corps', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: EMAIL_NORMAL, password: PASSWORD });

    assert.equal(response.status, 200);

    const body = response.body as SuccessBody<LoginData>;
    assert.equal(body.success, true);
    assert.ok(body.data.accessToken.length > 0, 'un access token doit etre emis');
    assert.equal(body.data.user.email, EMAIL_NORMAL);
    assert.deepEqual(body.data.user.roles, ['ADMIN']);

    // ADMIN vaut « toutes les permissions » dans le catalogue : le profil doit
    // en porter un nombre consequent, pas un tableau vide.
    assert.ok(
      body.data.user.permissions.length > 50,
      `ADMIN devrait porter tout le catalogue, recu : ${body.data.user.permissions.length}`,
    );

    // Le refresh token ne doit PAS etre dans le corps : un script injecte dans
    // la page le lirait, et repartirait avec trente jours d'acces.
    assert.equal(
      (body.data as unknown as Record<string, unknown>).refreshToken,
      undefined,
      'le refresh token ne doit jamais apparaitre dans le corps de la reponse',
    );

    const cookie = refreshCookieOf(response);
    assert.ok(cookie, 'un cookie de rafraichissement doit etre pose');
    assert.ok(cookie.length > 40, 'le cookie doit porter un jeton opaque, pas une valeur courte');

    const rawCookies = (response.headers as Record<string, unknown>)['set-cookie'];
    const cookieHeader = (Array.isArray(rawCookies) ? rawCookies : [rawCookies]).join('; ');
    assert.match(cookieHeader, /HttpOnly/i, 'le cookie doit etre HttpOnly');
    assert.match(
      cookieHeader,
      new RegExp(`Path=${baseUrl}/auth`, 'i'),
      'le cookie doit etre limite au chemin auth',
    );

    normalToken = body.data.accessToken;
    normalUserId = body.data.user.id;
    normalRefreshCookie = cookie;
  });

  it('rend le profil du porteur authentifie', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/auth/me`)
      .set('Authorization', `Bearer ${normalToken}`);

    assert.equal(response.status, 200);
    const body = response.body as SuccessBody<{ id: string; email: string }>;
    assert.equal(body.data.id, normalUserId);
    assert.equal(body.data.email, EMAIL_NORMAL);
  });

  it("ne permet pas de distinguer un compte inconnu d'un mot de passe faux", async () => {
    // LA propriete la plus facile a casser sans s'en rendre compte. Si les deux
    // reponses divergent (code, message), un attaquant enumere les comptes
    // inscrits en comparant les corps — sans meme mesurer le temps.
    const unknown = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: EMAIL_UNKNOWN, password: PASSWORD });

    const wrongPassword = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: EMAIL_NORMAL, password: 'Mauvais-Mot-De-Passe-99-Zinc' });

    assert.equal(unknown.status, 401);
    assert.equal(wrongPassword.status, 401);
    assert.deepEqual(
      errorOf(unknown),
      errorOf(wrongPassword),
      'compte inconnu et mot de passe faux doivent produire une reponse identique',
    );
    assert.equal(errorOf(unknown).code, 'INVALID_CREDENTIALS');
  });

  it("fait tourner le refresh token et invalide toute la famille si l'ancien est rejoue", async () => {
    const login = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: EMAIL_NORMAL, password: PASSWORD });

    assert.equal(login.status, 200);
    const first = refreshCookieOf(login);
    assert.ok(first, 'une session doit avoir ete ouverte');

    // 1. Le rafraichissement reussi doit rendre un jeton DIFFERENT. Un jeton
    //    identique signifierait que la rotation ne fait rien, et qu'un vol de
    //    cookie reste exploitable pendant toute la duree de vie du refresh token.
    const refreshed = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/refresh`)
      .set('Cookie', `${REFRESH_COOKIE}=${first}`)
      .send({});

    assert.equal(refreshed.status, 200);
    const second = refreshCookieOf(refreshed);
    assert.ok(second, 'un nouveau cookie doit etre pose');
    assert.notEqual(second, first, 'le refresh token doit avoir tourne');

    const refreshedBody = refreshed.body as SuccessBody<LoginData>;
    assert.ok(refreshedBody.data.accessToken.length > 0);

    // 2. Rejouer l'ancien jeton est le signal d'un vol : la famille entiere doit
    //    tomber. C'est volontairement severe — le cout d'un faux positif est une
    //    reconnexion, celui d'un faux negatif est un acces de trente jours.
    const replay = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/refresh`)
      .set('Cookie', `${REFRESH_COOKIE}=${first}`)
      .send({});

    assert.equal(replay.status, 401);
    assert.equal(errorOf(replay).code, 'REFRESH_TOKEN_REUSED');

    // 3. Et le jeton le plus recent, pourtant legitime, doit etre mort lui aussi.
    //    C'est ce point qui distingue une vraie detection d'un simple refus.
    const afterRevocation = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/refresh`)
      .set('Cookie', `${REFRESH_COOKIE}=${second}`)
      .send({});

    assert.equal(afterRevocation.status, 401);
    assert.equal(errorOf(afterRevocation).code, 'REFRESH_TOKEN_REUSED');
  });

  it("refuse un refresh token inconnu sans donner d'indice", async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/refresh`)
      .set('Cookie', `${REFRESH_COOKIE}=jeton-completement-invente-et-suffisamment-long-pour-passer`)
      .send({});

    assert.equal(response.status, 401);
    assert.equal(errorOf(response).code, 'TOKEN_INVALID');
  });

  it("empeche un compte a mot de passe initial d'acceder a autre chose qu'a la sortie", async () => {
    const login = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: EMAIL_MUST_CHANGE, password: PASSWORD });

    assert.equal(login.status, 200);
    const body = login.body as SuccessBody<LoginData>;
    assert.equal(body.data.user.mustChangePassword, true);
    mustChangeToken = body.data.accessToken;

    // Route fermee : la liste des sessions est refusee tant que le mot de passe
    // initial n'a pas ete change. C'est le SERVEUR qui tranche — masquer un
    // ecran cote frontend ne protegerait pas l'API appelee directement.
    const blocked = await request(app.getHttpServer())
      .get(`${baseUrl}/auth/sessions`)
      .set('Authorization', `Bearer ${mustChangeToken}`);

    assert.equal(blocked.status, 403);
    assert.equal(errorOf(blocked).code, 'PASSWORD_CHANGE_REQUIRED');

    // Route autorisee : le porteur doit pouvoir lire son profil, sinon le
    // frontend ne saurait meme pas quel ecran afficher — et surtout, il doit
    // pouvoir changer son mot de passe et se deconnecter.
    const allowed = await request(app.getHttpServer())
      .get(`${baseUrl}/auth/me`)
      .set('Authorization', `Bearer ${mustChangeToken}`);

    assert.equal(allowed.status, 200);
  });

  it("change le mot de passe initial puis deverrouille l'acces, sans fermer la session courante", async () => {
    const newPassword = 'Boussole-Tempete-41-Nuage';
    assert.equal(passwordPolicyViolation(newPassword), null);

    const changed = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/change-password`)
      .set('Authorization', `Bearer ${mustChangeToken}`)
      .send({ currentPassword: PASSWORD, newPassword, confirmPassword: newPassword });

    assert.equal(changed.status, 200);
    const body = changed.body as SuccessBody<LoginData>;
    assert.equal(body.data.user.mustChangePassword, false);

    // La session ouverte par le changement de mot de passe doit fonctionner
    // immediatement : jeter dehors l'utilisateur qui vient de securiser son
    // compte decouragerait precisement le geste qu'on veut encourager.
    const nowAllowed = await request(app.getHttpServer())
      .get(`${baseUrl}/auth/sessions`)
      .set('Authorization', `Bearer ${body.data.accessToken}`);

    assert.equal(nowAllowed.status, 200);

    // Le mot de passe initial ne doit plus ouvrir de session.
    const withOld = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: EMAIL_MUST_CHANGE, password: PASSWORD });

    assert.equal(withOld.status, 401);
    assert.equal(errorOf(withOld).code, 'INVALID_CREDENTIALS');
  });

  it('exige le mot de passe actuel pour en changer (un jeton vole ne doit pas verrouiller la victime)', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/change-password`)
      .set('Authorization', `Bearer ${normalToken}`)
      .send({
        currentPassword: 'Pas-Le-Bon-Mot-De-Passe-77-Cuivre',
        newPassword: 'Aiguille-Soleil-58-Rivage',
        confirmPassword: 'Aiguille-Soleil-58-Rivage',
      });

    assert.equal(response.status, 401);
    assert.equal(errorOf(response).code, 'INVALID_CREDENTIALS');
  });

  it('deconnecte et efface le cookie', async () => {
    assert.ok(normalRefreshCookie, 'une session doit etre ouverte pour ce scenario');

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/logout`)
      .set('Cookie', `${REFRESH_COOKIE}=${normalRefreshCookie}`)
      .send({});

    assert.equal(response.status, 200);
    assert.equal(refreshCookieOf(response), null, 'le cookie doit avoir ete efface');

    // Et le jeton revoque ne doit plus rien ouvrir.
    const afterLogout = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/refresh`)
      .set('Cookie', `${REFRESH_COOKIE}=${normalRefreshCookie}`)
      .send({});

    assert.equal(afterLogout.status, 401);
  });

  it('repond toujours la meme chose a une demande de reinitialisation, compte connu ou non', async () => {
    const known = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/forgot-password`)
      .send({ email: EMAIL_NORMAL });

    const unknown = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/forgot-password`)
      .send({ email: EMAIL_UNKNOWN });

    // Meme statut et meme corps : c'est la reponse constante qui empeche
    // d'enumerer les comptes par ce chemin.
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(known.body, unknown.body);
  });
});
