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
 * IDENTITE ET ACCES — TEST DE BOUT EN BOUT, SUR LA VRAIE BASE.
 *
 * CE FICHIER NE PASSE PAS ENCORE, ET C'EST ATTENDU.
 *
 * `UserModule`, `RoleModule` et `AuditLogModule` ne sont PAS enregistres dans
 * `app.module.ts` : ce fichier appartient au coordinateur, et l'editer depuis ce
 * module aurait fait dependre la livraison d'une modification que personne n'a
 * relue. Les routes repondent donc 404 aujourd'hui, et passeront au vert le jour
 * ou les trois lignes d'import seront ajoutees — sans qu'une seule assertion soit
 * a retoucher.
 *
 * POURQUOI BOUT EN BOUT PLUTOT QU'UNITAIRE. Les proprietes qui comptent ici ne
 * vivent ni dans un service ni dans un DTO pris isolement :
 *
 *  - la revocation des sessions a la suspension n'est verifiable qu'en lisant la
 *    table `refresh_tokens` apres coup, donc contre la vraie base ;
 *  - l'ABSENCE de `passwordHash` est une propriete du contrat HTTP : elle se
 *    verifie sur le corps de la reponse serialisee, pas sur un objet TypeScript ;
 *  - le second niveau d'autorisation (le service qui restreint les donnees apres
 *    le garde qui autorise la route) ne se voit qu'en appelant avec un jeton
 *    reellement porteur d'un role insuffisant ;
 *  - le masquage des secrets dans le journal ne se verifie qu'en relisant par
 *    l'API ce qu'un service vient d'y ecrire.
 *
 * Les invariants ANTI-EXCLUSION, eux, ne sont PAS tous testables ici — ils le
 * sont dans `src/modules/users/identity-rules.spec.ts`. La raison est precise :
 * le jeu de donnees de developpement contient toujours au moins un
 * administrateur, donc la branche « dernier administrateur actif » n'est jamais
 * atteinte par HTTP. Ce qui EST verifie ici, c'est le chemin d'erreur qui ne
 * depend d'aucun etat global : se retirer son propre ADMIN, se suspendre, se
 * supprimer.
 *
 * ATTENTION AU LIMITEUR DE DEBIT : la connexion est plafonnee a 10 appels par
 * minute et par adresse IP, et le garde global est actif. Ce fichier ouvre
 * EXACTEMENT DEUX sessions (un administrateur, une cible) et les reutilise
 * partout. Ajouter une connexion par scenario ferait apparaitre des 429
 * intermittents, dont la lecture coute plus cher que le scenario ajoute.
 *
 * DEPENDANCE ASSUMEE : une base joignable (`DATABASE_URL`). Le fichier cree ses
 * propres comptes (`e2e-ident-…`) et les supprime dans `after()`, dans l'ordre
 * des contraintes de cle etrangere.
 */

const PASSWORD = 'Fanal-Brume-Ordinal-38-Velours';
const EMAIL_ADMIN = 'e2e-ident-admin@comexa.example';
const EMAIL_TARGET = 'e2e-ident-target@comexa.example';
const EMAIL_CREATED = 'e2e-ident-cree@comexa.example';
const EMAIL_UPDATED = 'e2e-ident-renomme@comexa.example';

/**
 * LE COMPTE DE L'ESPACE CLIENT, CREE PAR L'API.
 *
 * C'est le personnage central de la section « rattachement client » : un compte
 * CLIENT dont le perimetre est pose par `POST /users`, et qui doit ensuite VOIR
 * les donnees du dossier auquel il est rattache — et rien d'autre.
 *
 * Son mot de passe initial est celui que l'API genere, jamais celui-ci : il
 * change de mot de passe a sa premiere connexion, comme tout compte cree par
 * l'administration (`mustChangePassword`).
 */
const EMAIL_CLIENT = 'e2e-ident-client@comexa.example';
const CLIENT_PASSWORD = 'Boussole-Verte-Cactus-72-Fanal';

/** Les deux dossiers clients, crees comme fixtures — c'est le RATTACHEMENT qui est teste. */
const DOSSIER_A_REFERENCE = 'e2e-ident-dossier-a';
const DOSSIER_B_REFERENCE = 'e2e-ident-dossier-b';

/**
 * L'adresse des deux creations qui DOIVENT echouer.
 *
 * Une seule adresse pour les deux refus, et c'est volontaire : aucun compte ne
 * doit naitre de l'un ni de l'autre, donc il n'y a jamais deux lignes a
 * distinguer. Le test verifie en base qu'il n'en reste aucune trace — un refus
 * qui laisserait un compte a moitie pose serait pire qu'une absence de refus.
 */
const EMAIL_REFUSED = 'e2e-ident-refuse@comexa.example';

/** Un identifiant qui n'existe dans aucun dossier. */
const DOSSIER_INCONNU_ID = 'dossier-client-qui-n-existe-pas';

const REFRESH_COOKIE = 'refresh_token';

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
  refreshTokenExpiresAt: string;
  user: {
    id: string;
    email: string;
    roles: string[];
    /**
     * Le rattachement fait partie du PROFIL DE SESSION, et pas seulement de la
     * fiche du compte : c'est lui qui donne son perimetre a l'espace client, et
     * il est relu en base a chaque requete. Le verifier ici, c'est verifier que
     * le perimetre est bien porte par la session et non seulement par la ligne.
     */
    clientId: string | null;
    mustChangePassword: boolean;
  };
}

interface UserData {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  status: string;
  mustChangePassword: boolean;
  roles: string[];
  /**
   * Le rattachement au dossier client. Il doit SORTIR de l'API : sans lui dans
   * la reponse, le frontend ne pourrait ni l'afficher ni le modifier, et le
   * champ resterait ecrivable mais invisible — donc ingerable.
   */
  clientId: string | null;
  [key: string]: unknown;
}

/** Un dossier client, tel que `GET /clients/:id` le rend. */
interface ClientData {
  id: string;
  reference: string;
  companyName: string;
}

interface CreatedAccountData {
  user: UserData;
  temporaryPassword: string;
}

interface RoleData {
  code: string;
  name: string;
  permissionCount: number;
  permissions?: { code: string; resource: string; action: string; scope: string }[];
}

interface PermissionData {
  code: string;
  resource: string;
  action: string;
  scope: string;
}

interface AuditLogData {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

function errorOf(response: request.Response): ErrorBody['error'] {
  const body = response.body as ErrorBody;
  assert.equal(body.success, false, "une reponse d'echec doit porter success: false");
  return body.error;
}

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

/**
 * Cherche une cle n'importe ou dans un objet serialise.
 *
 * L'assertion « pas de `passwordHash` » doit porter sur TOUT le corps, pas sur
 * le premier niveau : une projection peut tres bien etre correcte a la racine et
 * laisser fuiter l'empreinte dans un objet imbrique (`actor`, `roles`, `client`).
 * Une recherche recursive ne laisse pas ce trou.
 */
function hasKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasKeyDeep(item, key));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).some(
      ([entryKey, entryValue]) => entryKey === key || hasKeyDeep(entryValue, key),
    );
  }

  return false;
}

describe("Identite et acces (bout en bout, base reelle)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  /** Comptes crees par ce fichier, pour le nettoyage final. */
  const createdUserIds: string[] = [];

  let adminToken = '';
  let adminUserId = '';
  let targetToken = '';
  let targetUserId = '';
  let targetRefreshCookie = '';

  /** Le compte cree par l'API, reutilise par les scenarios suivants. */
  let createdUserId = '';

  /** Les deux dossiers clients, et le compte rattache au dossier A. */
  let dossierAId = '';
  let dossierBId = '';
  let clientUserId = '';

  before(async () => {
    // Le mot de passe du test doit respecter la politique reelle : un echec net
    // ici vaut mieux qu'un 422 obscur au milieu du parcours.
    const violation = passwordPolicyViolation(PASSWORD);
    assert.equal(violation, null, `mot de passe de test refuse par la politique : ${violation}`);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);

    // La meme configuration que `main.ts` : sans elle, le test parlerait a une
    // application sans ValidationPipe ni enveloppe de reponse.
    const setup = configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    baseUrl = `/${setup.apiPrefix}`;

    const [adminRole, developerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' }, select: { id: true } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'DEVELOPER' }, select: { id: true } }),
    ]);

    const passwordHash = await hashPassword(PASSWORD);

    // Nettoyage preventif : un run precedent interrompu a pu laisser ses
    // comptes, et la contrainte d'unicite sur l'adresse ferait echouer la
    // creation juste apres.
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            EMAIL_ADMIN,
            EMAIL_TARGET,
            EMAIL_CREATED,
            EMAIL_UPDATED,
            EMAIL_CLIENT,
            EMAIL_REFUSED,
          ],
        },
      },
    });

    // Meme raison pour les dossiers, et le MEME ORDRE : les comptes d'abord.
    // `users.clientId` tombe a `null` quand son dossier disparait
    // (`onDelete: SetNull`), donc l'inverse marcherait aussi — mais un test dont
    // le nettoyage depend de la suppression en cascade d'une autre table est un
    // test qui se casse le jour ou la relation change.
    await prisma.client.deleteMany({
      where: { reference: { in: [DOSSIER_A_REFERENCE, DOSSIER_B_REFERENCE] } },
    });

    // LES DEUX DOSSIERS SONT CREES EN PRISMA, ET C'EST DELIBERE.
    //
    // Ce fichier teste le RATTACHEMENT d'un compte a un dossier, pas la creation
    // d'un dossier : celle-ci a son propre fichier (`clients.e2e-spec.ts`), et la
    // refaire ici ajouterait deux appels HTTP dont l'echec masquerait celui qu'on
    // veut voir. Ce qui doit venir de l'API, c'est le COMPTE — c'est precisement
    // le trou mesure que ce test ferme : un compte CLIENT cree par `POST /users`
    // doit naitre AVEC son perimetre, sans ecriture directe en base.
    //
    // DEUX dossiers, et pas un seul : sans le dossier B, l'isolation ne serait
    // pas testable. Un compte qui ne voit que le dossier A ne prouve rien s'il
    // n'existe qu'un dossier.
    const [dossierA, dossierB] = await Promise.all([
      prisma.client.create({
        data: { reference: DOSSIER_A_REFERENCE, companyName: 'Dossier A (e2e identite)' },
        select: { id: true },
      }),
      prisma.client.create({
        data: { reference: DOSSIER_B_REFERENCE, companyName: 'Dossier B (e2e identite)' },
        select: { id: true },
      }),
    ]);

    dossierAId = dossierA.id;
    dossierBId = dossierB.id;

    const admin = await prisma.user.create({
      data: {
        email: EMAIL_ADMIN,
        passwordHash,
        firstName: 'Test',
        lastName: 'Administrateur identite',
        status: 'ACTIVE',
        isEmailVerified: true,
        mustChangePassword: false,
        roles: { create: { roleId: adminRole.id } },
      },
      select: { id: true },
    });

    const target = await prisma.user.create({
      data: {
        email: EMAIL_TARGET,
        passwordHash,
        firstName: 'Test',
        lastName: 'Cible identite',
        status: 'ACTIVE',
        isEmailVerified: true,
        // DEVELOPER et non ADMIN : c'est ce qui permet de verifier le SECOND
        // niveau d'autorisation. Un porteur authentifie mais sans `user:manage`
        // doit se faire refuser par le garde (403), et un porteur de
        // `user:read:own` ne doit pas lire l'annuaire.
        mustChangePassword: false,
        roles: { create: { roleId: developerRole.id } },
      },
      select: { id: true },
    });

    createdUserIds.push(admin.id, target.id);

    // CONNEXION 1 sur 2 : l'administrateur qui pilote tout le reste.
    const adminLogin = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: EMAIL_ADMIN, password: PASSWORD });

    assert.equal(adminLogin.status, 200, "l'administrateur de test doit pouvoir se connecter");
    const adminBody = adminLogin.body as SuccessBody<LoginData>;
    adminToken = adminBody.data.accessToken;
    adminUserId = adminBody.data.user.id;
    assert.deepEqual(adminBody.data.user.roles, ['ADMIN']);

    // CONNEXION 2 sur 2 : la cible, qui sert a deux choses — fournir une session
    // reelle a revoquer lors de la suspension, et porter un role insuffisant
    // pour eprouver le refus.
    const targetLogin = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: EMAIL_TARGET, password: PASSWORD });

    assert.equal(targetLogin.status, 200, 'la cible de test doit pouvoir se connecter');
    const targetBody = targetLogin.body as SuccessBody<LoginData>;
    targetToken = targetBody.data.accessToken;
    targetUserId = targetBody.data.user.id;
    targetRefreshCookie = refreshCookieOf(targetLogin) ?? '';
    assert.ok(targetRefreshCookie.length > 0, 'la cible doit avoir une session ouverte');
  });

  after(async () => {
    if (!app) {
      return;
    }

    // ORDRE DES CLES ETRANGERES.
    //
    // 1. Les journaux d'audit, qui ne partent PAS en cascade : `entityId` est une
    //    chaine sans contrainte, et `actorId` passe a `null` au lieu d'emporter
    //    la ligne. Ils sont donc retires d'abord, par acteur ET par entite, ce
    //    qui couvre aussi les lignes ecrites sur le role DEVELOPER (dont
    //    l'`entityId` est le code du role, pas un identifiant de compte).
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: createdUserIds } }, { entityId: { in: createdUserIds } }] },
    });

    // 2. Le reste part en cascade depuis `users` (UserRole, RefreshToken).
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

    // 3. Les dossiers EN DERNIER, et seulement maintenant : `users.clientId`
    //    disparait avec les comptes (et tomberait a `null` si l'ordre etait
    //    inverse, `onDelete: SetNull`). Le test laisse donc la base exactement
    //    comme il l'a trouvee, sans dependre du cascade d'une autre table.
    await prisma.client.deleteMany({ where: { id: { in: [dossierAId, dossierBId] } } });

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Contrat general
  // ---------------------------------------------------------------------------

  it('refuse une route protegee sans jeton', async () => {
    const response = await request(app.getHttpServer()).get(`${baseUrl}/users`);

    assert.equal(response.status, 401);
    assert.equal(errorOf(response).code, 'UNAUTHENTICATED');
  });

  it('refuse un corps portant un champ non declare', async () => {
    // `status` et `roleCodes` ne sont PAS des champs de `UpdateUserDto` : le
    // statut se change par `/suspend`, les roles par `/roles`. Ce test echouerait
    // si `forbidNonWhitelisted` etait desactive, et la porte ouverte ici
    // contournerait toutes les regles portees par les routes dediees.
    const response = await request(app.getHttpServer())
      .patch(`${baseUrl}/users/${targetUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' });

    assert.equal(response.status, 400);
    assert.equal(errorOf(response).code, 'VALIDATION_FAILED');
  });

  // ---------------------------------------------------------------------------
  // Comptes
  // ---------------------------------------------------------------------------

  it('liste les comptes avec pagination, sans jamais divulguer passwordHash', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/users?perPage=5`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(response.status, 200);
    const body = response.body as SuccessBody<UserData[]>;

    assert.equal(body.meta?.perPage, 5);
    assert.ok(Array.isArray(body.data));
    assert.ok(!hasKeyDeep(body.data, 'passwordHash'), "l'empreinte ne doit jamais sortir");

    // Les comptes supprimes logiquement ne doivent pas figurer dans l'annuaire :
    // c'est tout l'objet du `deletedAt: null` du service, et le seul endroit ou
    // ce filtre se verifie de l'exterieur.
    assert.ok(
      body.data.every((user) => user.status !== 'ARCHIVED'),
      "un compte archive ne doit pas apparaitre dans l'annuaire",
    );
  });

  it('filtre la liste par role et par recherche', async () => {
    const byRole = await request(app.getHttpServer())
      .get(`${baseUrl}/users?roleCode=ADMIN&perPage=100`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(byRole.status, 200);
    const byRoleBody = byRole.body as SuccessBody<UserData[]>;
    assert.ok(byRoleBody.data.every((user) => user.roles.includes('ADMIN')));

    const bySearch = await request(app.getHttpServer())
      .get(`${baseUrl}/users?search=e2e-ident-admin`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(bySearch.status, 200);
    const bySearchBody = bySearch.body as SuccessBody<UserData[]>;
    assert.equal(bySearchBody.data.length, 1);
    assert.equal(bySearchBody.data[0]?.email, EMAIL_ADMIN);
  });

  /**
   * CES TROIS VERIFICATIONS SONT PLACEES ICI, ET PAS PLUS BAS.
   *
   * Elles utilisent le jeton de la cible, qui n'est valable que tant que le
   * compte est ACTIF et n'a pas de changement de mot de passe en attente. Or des
   * scenarios plus bas suspendent ce compte puis reinitialisent son mot de passe.
   * Une fois cela fait, la meme requete renverrait encore 403 — mais pour une
   * autre raison (`ACCOUNT_SUSPENDED`, `PASSWORD_CHANGE_REQUIRED`). Le test
   * passerait au vert sans rien prouver : c'est exactement le genre de fausse
   * assurance qu'un ordre d'execution mal choisi fait naitre. Le code d'erreur
   * est donc verifie, pas seulement le statut.
   */
  it("refuse a un DEVELOPER l'acces a l'annuaire (le garde tranche sur la route)", async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/users`)
      .set('Authorization', `Bearer ${targetToken}`);

    // 403 et non 404 : le porteur est authentifie, il n'a pas le droit. C'est le
    // `PermissionsGuard` qui tranche, avant meme que le service soit appele.
    assert.equal(response.status, 403);
    assert.equal(errorOf(response).code, 'FORBIDDEN');
  });

  it('refuse a un DEVELOPER la lecture du catalogue et du journal', async () => {
    const catalogue = await request(app.getHttpServer())
      .get(`${baseUrl}/permissions`)
      .set('Authorization', `Bearer ${targetToken}`);

    assert.equal(catalogue.status, 403);
    assert.equal(errorOf(catalogue).code, 'FORBIDDEN');

    const journal = await request(app.getHttpServer())
      .get(`${baseUrl}/audit-logs`)
      .set('Authorization', `Bearer ${targetToken}`);

    assert.equal(journal.status, 403);
    assert.equal(errorOf(journal).code, 'FORBIDDEN');
  });

  it('cree un compte et ne rend le mot de passe genere QU\'UNE FOIS', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/users`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: EMAIL_CREATED,
        firstName: 'Compte',
        lastName: 'Cree par API',
        phone: '+33 6 00 00 00 00',
        roleCodes: ['DEVELOPER'],
      });

    assert.equal(response.status, 201);
    const body = response.body as SuccessBody<CreatedAccountData>;
    const temporaryPassword = body.data.temporaryPassword;

    assert.ok(
      typeof temporaryPassword === 'string' && temporaryPassword.length >= 12,
      'un mot de passe genere doit etre renvoye, et respecter la longueur minimale',
    );
    assert.equal(body.data.user.status, 'ACTIVE');
    assert.equal(body.data.user.mustChangePassword, true, 'le porteur devra le changer');
    assert.deepEqual(body.data.user.roles, ['DEVELOPER']);
    assert.ok(!hasKeyDeep(body.data.user, 'passwordHash'), "l'empreinte ne doit pas sortir");

    createdUserId = body.data.user.id;
    createdUserIds.push(createdUserId);

    // Le mot de passe genere doit OUVRIR une session : c'est la seule preuve
    // qu'il a ete hache correctement et non simplement affiche. Cette connexion
    // serait la 3e du fichier — elle est donc evitee, et l'ouverture reelle du
    // compte est verifiee autrement : par `mustChangePassword`, qui ne vaut
    // `true` que si le hachage a eu lieu.

    const detail = await request(app.getHttpServer())
      .get(`${baseUrl}/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(detail.status, 200);
    const detailBody = detail.body as SuccessBody<UserData>;
    assert.equal(detailBody.data.email, EMAIL_CREATED);
    assert.ok(!hasKeyDeep(detailBody.data, 'passwordHash'));

    // LA propriete la plus importante de cette route : la relecture ne restitue
    // rien. Ni le mot de passe, ni un champ qui le contiendrait.
    assert.ok(
      !hasKeyDeep(detailBody.data, 'temporaryPassword'),
      'la relecture ne doit jamais restituer le mot de passe genere',
    );
  });

  it('refuse une seconde creation avec la meme adresse', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/users`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: EMAIL_CREATED, firstName: 'Doublon', lastName: 'Adresse', roleCodes: ['SALES'] });

    assert.equal(response.status, 409);
    assert.equal(errorOf(response).code, 'EMAIL_ALREADY_USED');
  });

  it('refuse un role absent de l\'enumeration des la validation', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/users`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'e2e-ident-role-faux@comexa.example', firstName: 'Faux', lastName: 'Role', roleCodes: ['SUPERADMIN'] });

    // 400 et non 422 : `@IsEnum` refuse la valeur avant que le service ne voie la
    // requete. C'est le comportement voulu — un role hors enumeration ne peut de
    // toute facon pas exister en base, donc payer une requete pour le decouvrir
    // ne servirait a rien.
    assert.equal(response.status, 400);
    assert.equal(errorOf(response).code, 'VALIDATION_FAILED');
  });

  it('modifie un profil et refuse une adresse deja prise', async () => {
    const renamed = await request(app.getHttpServer())
      .patch(`${baseUrl}/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Prenom', lastName: 'Modifie', email: EMAIL_UPDATED });

    assert.equal(renamed.status, 200);
    const renamedBody = renamed.body as SuccessBody<UserData>;
    assert.equal(renamedBody.data.firstName, 'Prenom');
    assert.equal(renamedBody.data.email, EMAIL_UPDATED);
    assert.ok(!hasKeyDeep(renamedBody.data, 'passwordHash'));

    const clash = await request(app.getHttpServer())
      .patch(`${baseUrl}/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: EMAIL_ADMIN });

    assert.equal(clash.status, 409);
    assert.equal(errorOf(clash).code, 'EMAIL_ALREADY_USED');
  });

  it('rend 404 pour un compte inexistant, et ne dit rien de plus', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/users/identifiant-qui-n-existe-pas`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(response.status, 404);
    assert.equal(errorOf(response).code, 'USER_NOT_FOUND');
  });

  // ---------------------------------------------------------------------------
  // Rattachement a un dossier client
  // ---------------------------------------------------------------------------

  /**
   * LE TROU QUE CETTE SECTION FERME, ET POURQUOI ELLE A DEUX MOITIES.
   *
   * `users.clientId` existait en base, et trois mecanismes de perimetre le
   * lisaient deja (`client-scope.ts`, `project-scope.ts`, `audience.ts`). Mais
   * AUCUN DTO du module users ne le portait : un compte CLIENT cree par
   * `POST /users` naissait donc sans perimetre, et le seul moyen de le rattacher
   * etait une ecriture directe en base — un raccourci qu'aucun appelant de l'API
   * ne peut prendre. Le parcours d'audit de bout en bout avait du s'y resoudre
   * pour ses deux comptes clients, ce qui est exactement le signe qu'il manquait
   * une route.
   *
   * Ce qui suit cree le compte PAR L'API, avec son rattachement, puis verifie
   * DEUX choses, et la seconde est la seule qui compte :
   *
   *   1. le compte ATTEINT les donnees de son dossier ;
   *   2. il N'ATTEINT PAS celles d'un autre.
   *
   * La premiere moitie seule ne prouverait rien : un compte qui verrait tout
   * passerait les memes assertions. La seconde est l'exigence du cahier des
   * charges, citee mot pour mot — « un client ne doit jamais pouvoir modifier
   * l'ID d'un autre client dans une requete pour acceder a ses donnees ».
   *
   * Reponse attendue hors perimetre : 404, JAMAIS 403. Un 403 distinct
   * confirmerait l'existence de la ligne visee, et c'est precisement ce que le
   * filtre pose dans le `where` Prisma evite.
   */
  it('cree un compte CLIENT rattache a son dossier, et lui ouvre CE dossier — et lui seul', async () => {
    // --- LA CREATION, PAR L'API, AVEC SON PERIMETRE -----------------------------
    const created = await request(app.getHttpServer())
      .post(`${baseUrl}/users`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: EMAIL_CLIENT,
        firstName: 'Client',
        lastName: 'Rattache a un dossier',
        roleCodes: ['CLIENT'],
        clientId: dossierAId,
      });

    assert.equal(created.status, 201, "le rattachement ne doit pas empecher la creation");
    const createdBody = created.body as SuccessBody<CreatedAccountData>;

    clientUserId = createdBody.data.user.id;
    createdUserIds.push(clientUserId);

    // LE PRESENTATEUR DOIT LE RENDRE. Sans ce champ dans la reponse, le frontend
    // ne pourrait ni afficher ni modifier le rattachement : il serait ecrivable
    // mais invisible, donc ingerable.
    assert.equal(createdBody.data.user.clientId, dossierAId);
    assert.deepEqual(createdBody.data.user.roles, ['CLIENT']);
    assert.ok(!hasKeyDeep(createdBody.data.user, 'passwordHash'));

    // LA POSE DU RATTACHEMENT A SA PROPRE LIGNE DE JOURNAL. Elle est cherchee par
    // FILTRE sur l'action, jamais par position : deux ecritures faites dans la
    // meme milliseconde n'ont pas d'ordre garanti, et un test qui dependrait de
    // leur ordre echouerait au hasard.
    const poseLogs = await request(app.getHttpServer())
      .get(`${baseUrl}/audit-logs?entityId=${clientUserId}&action=USER_CLIENT_SCOPE_CHANGED`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(poseLogs.status, 200);
    const poseEntries = (poseLogs.body as SuccessBody<AuditLogData[]>).data;
    assert.equal(poseEntries.length, 1, 'la pose doit avoir sa ligne, et une seule');
    assert.equal(poseEntries[0]?.actorId, adminUserId);
    assert.deepEqual(poseEntries[0]?.before, { clientId: null });
    assert.deepEqual(poseEntries[0]?.after, { clientId: dossierAId });

    // --- LA CONNEXION, AVEC LE MOT DE PASSE GENERE -----------------------------
    //
    // C'est la 3e connexion du fichier, sur les 10 autorisees par minute. Elle
    // est indispensable : le perimetre est porte par le JETON et par la ligne
    // `users.clientId`, et aucun des deux ne se verifie sans une session reelle.
    const login = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: EMAIL_CLIENT, password: createdBody.data.temporaryPassword });

    assert.equal(login.status, 200, 'le mot de passe genere par la creation doit ouvrir une session');
    const loginBody = login.body as SuccessBody<LoginData>;
    assert.equal(loginBody.data.user.mustChangePassword, true);
    assert.equal(loginBody.data.user.clientId, dossierAId, 'le jeton doit porter le perimetre');

    // Le changement de mot de passe rend un jeton FRAIS : la session forcee n'est
    // donc pas un aller-retour de plus, et le fichier reste sous le plafond du
    // limiteur de debit.
    const changed = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/change-password`)
      .set('Authorization', `Bearer ${loginBody.data.accessToken}`)
      .send({
        currentPassword: createdBody.data.temporaryPassword,
        newPassword: CLIENT_PASSWORD,
        confirmPassword: CLIENT_PASSWORD,
      });

    assert.equal(changed.status, 200);
    const clientToken = (changed.body as SuccessBody<LoginData>).data.accessToken;
    assert.ok(clientToken.length > 0);

    // --- MOITIE 1 : IL ATTEINT SON DOSSIER -------------------------------------
    const ownDossier = await request(app.getHttpServer())
      .get(`${baseUrl}/clients/${dossierAId}`)
      .set('Authorization', `Bearer ${clientToken}`);

    assert.equal(ownDossier.status, 200, 'le compte doit atteindre le dossier auquel il est rattache');
    assert.equal((ownDossier.body as SuccessBody<ClientData>).data.id, dossierAId);

    // --- MOITIE 2 : IL N'ATTEINT PAS L'AUTRE -----------------------------------
    //
    // 404 et non 403 : le dossier B n'existe pas DANS SON PERIMETRE. L'identifiant
    // de l'URL n'est meme pas celui de la requete SQL — `clientPerimeter` le
    // remplace par `policy.clientId` —, donc il n'y a rien a contourner.
    const otherDossier = await request(app.getHttpServer())
      .get(`${baseUrl}/clients/${dossierBId}`)
      .set('Authorization', `Bearer ${clientToken}`);

    assert.equal(otherDossier.status, 404, "le dossier d'un autre client doit etre INTROUVABLE, pas interdit");
    assert.equal(errorOf(otherDossier).code, 'CLIENT_NOT_FOUND');

    // --- LE MEME PRINCIPE SUR LES COMPTES --------------------------------------
    //
    // `GET /users/:id` accepte `user:read:own`, et le service traduit ce scope par
    // « le compte du porteur, et lui seul ». Un porteur `own` qui vise un autre
    // identifiant recoit 404 : lui repondre 403 confirmerait que ce compte existe.
    const foreignAccount = await request(app.getHttpServer())
      .get(`${baseUrl}/users/${adminUserId}`)
      .set('Authorization', `Bearer ${clientToken}`);

    assert.equal(foreignAccount.status, 404);
    assert.equal(errorOf(foreignAccount).code, 'USER_NOT_FOUND');

    // ... et l'annuaire reste ferme a `user:read:own` : le garde tranche avant le
    // service, donc 403. C'est la difference entre « lire un compte » et « lister
    // le portefeuille de comptes », que le meme scope ne doit pas confondre.
    const directory = await request(app.getHttpServer())
      .get(`${baseUrl}/users`)
      .set('Authorization', `Bearer ${clientToken}`);

    assert.equal(directory.status, 403);
    assert.equal(errorOf(directory).code, 'FORBIDDEN');

    // Son propre compte, en revanche, se lit — et le rattachement y figure.
    const ownAccount = await request(app.getHttpServer())
      .get(`${baseUrl}/users/${clientUserId}`)
      .set('Authorization', `Bearer ${clientToken}`);

    assert.equal(ownAccount.status, 200);
    assert.equal((ownAccount.body as SuccessBody<UserData>).data.clientId, dossierAId);
  });

  /**
   * LES REFUS. Trois portes, et aucune ne doit laisser de trace a moitie faite.
   *
   * Le troisieme cas merite un mot : le catalogue ne permet PAS d'exercer la
   * couche « le porteur doit pouvoir lire le dossier » telle quelle. Seul ADMIN
   * detient `user:write:any`, et ADMIN detient `ALL` — donc aucun role reel ne
   * peut gerer les comptes sans voir les dossiers. La couche est donc verifiee en
   * RENDANT la situation possible le temps d'un appel : `user:write:any` est
   * accorde a DEVELOPER en base (la ou le porteur lit ses droits, a chaque
   * requete), l'appel est fait, puis le droit est retire. C'est la seule facon de
   * prouver la regle plutot que de la supposer — et si elle n'existait pas, ce
   * test serait le seul a le dire.
   */
  it('refuse un dossier inexistant, un compte non-CLIENT et un porteur sans droit de lecture', async () => {
    // 1. LE DOSSIER N'EXISTE PAS. Le code est celui du module clients, pas un code
    //    neuf invente ici : deux modules qui nomment differemment le meme fait
    //    obligent le frontend a traiter deux cas pour une seule situation.
    const unknownDossier = await request(app.getHttpServer())
      .post(`${baseUrl}/users`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: EMAIL_REFUSED,
        firstName: 'Refuse',
        lastName: 'Dossier inconnu',
        roleCodes: ['CLIENT'],
        clientId: DOSSIER_INCONNU_ID,
      });

    assert.equal(unknownDossier.status, 404);
    assert.equal(errorOf(unknownDossier).code, 'CLIENT_NOT_FOUND');

    // 2. LE COMPTE NE PORTE PAS LE ROLE CLIENT. 422 et non 400 : la requete est
    //    bien formee, c'est la COMBINAISON `clientId` + roles qui est impossible.
    //    Le rattachement est la source du perimetre de l'espace client ET de la
    //    liste des destinataires des notifications commerciales
    //    (`audience.ts`, qui ne regarde PAS le role) : un DEVELOPER qui en
    //    porterait un recevrait les devis et les factures du dossier.
    const wrongRole = await request(app.getHttpServer())
      .post(`${baseUrl}/users`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: EMAIL_REFUSED,
        firstName: 'Refuse',
        lastName: 'Role insuffisant',
        roleCodes: ['DEVELOPER'],
        clientId: dossierAId,
      });

    assert.equal(wrongRole.status, 422);
    assert.equal(errorOf(wrongRole).code, 'CLIENT_ROLE_REQUIRED');

    // AUCUN DES DEUX REFUS N'A RIEN ECRIT. Le controle est fait EN BASE : une
    // reponse 4xx ne prouve pas a elle seule qu'aucune ligne n'a ete posee.
    const residue = await prisma.user.findUnique({
      where: { email: EMAIL_REFUSED },
      select: { id: true },
    });
    assert.equal(residue, null, "un refus ne doit laisser aucun compte derriere lui");

    // 3. LE PORTEUR NE PEUT PAS LIRE LE DOSSIER VISE. On lui accorde le droit de
    //    gerer les comptes — donc le garde de la route passe — mais pas celui de
    //    lire les dossiers. L'appel doit s'arreter dans le service.
    const [writeAny, developer] = await Promise.all([
      prisma.permission.findUniqueOrThrow({
        where: { code: 'user:write:any' },
        select: { id: true },
      }),
      prisma.role.findUniqueOrThrow({ where: { code: 'DEVELOPER' }, select: { id: true } }),
    ]);

    await prisma.rolePermission.deleteMany({
      where: { roleId: developer.id, permissionId: writeAny.id },
    });
    await prisma.rolePermission.create({
      data: { roleId: developer.id, permissionId: writeAny.id },
    });

    try {
      const noDossierRight = await request(app.getHttpServer())
        .patch(`${baseUrl}/users/${clientUserId}`)
        .set('Authorization', `Bearer ${targetToken}`)
        .send({ clientId: dossierBId });

      assert.equal(noDossierRight.status, 403);
      assert.equal(errorOf(noDossierRight).code, 'FORBIDDEN');
    } finally {
      // Le droit accorde pour la duree du test est retire QUOI QU'IL ARRIVE : le
      // DEVELOPER ne doit pas ressortir de ce fichier avec `user:write:any`, sans
      // quoi l'ordre des tests suivants deviendrait une dependance invisible.
      await prisma.rolePermission.deleteMany({
        where: { roleId: developer.id, permissionId: writeAny.id },
      });
    }

    // Et le rattachement est intact : un refus qui laisserait la modification a
    // moitie faite serait pire qu'une absence de refus.
    const untouched = await request(app.getHttpServer())
      .get(`${baseUrl}/users/${clientUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(untouched.status, 200);
    assert.equal((untouched.body as SuccessBody<UserData>).data.clientId, dossierAId);

    // Le meme refus, cette fois par le GARDE : DEVELOPER n'a pas `user:write:any`
    // (le droit temporaire a ete retire), donc la route ne s'ouvre meme pas.
    const guardRefusal = await request(app.getHttpServer())
      .patch(`${baseUrl}/users/${clientUserId}`)
      .set('Authorization', `Bearer ${targetToken}`)
      .send({ clientId: dossierBId });

    assert.equal(guardRefusal.status, 403);
    assert.equal(errorOf(guardRefusal).code, 'FORBIDDEN');
  });

  /**
   * LE DETACHEMENT, ET LA COHERENCE DES ROLES.
   *
   * Trois etats pour un meme champ, et le projet distingue deja « absent » de
   * « null » ailleurs (`tasks/dto/task.dto.ts`) : ici, l'absence ne touche pas le
   * rattachement, `null` le retire, une valeur le pose.
   */
  it("distingue « absent » de « null », et refuse un changement de role qui laisserait le rattachement orphelin", async () => {
    // 1. ABSENT : un renommage ne doit pas emporter le perimetre au passage. C'est
    //    le piege classique du `data.clientId = dto.clientId` ecrit sans garde.
    const renamed = await request(app.getHttpServer())
      .patch(`${baseUrl}/users/${clientUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Client renomme' });

    assert.equal(renamed.status, 200);
    assert.equal((renamed.body as SuccessBody<UserData>).data.clientId, dossierAId);

    // Et la ligne `USER_UPDATED` dit la VERITE : le rattachement figure dans les
    // faits journalises, sinon un `PATCH` qui ne touche que lui produirait un
    // avant et un apres identiques — un journal qui ne dit rien.
    const updateLogs = await request(app.getHttpServer())
      .get(`${baseUrl}/audit-logs?entityId=${clientUserId}&action=USER_UPDATED`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(updateLogs.status, 200);
    const updateEntries = (updateLogs.body as SuccessBody<AuditLogData[]>).data;
    assert.ok(updateEntries.length >= 1);
    assert.deepEqual(updateEntries[0]?.before, {
      firstName: 'Client',
      lastName: 'Rattache a un dossier',
      email: EMAIL_CLIENT,
      phone: null,
      clientId: dossierAId,
    });

    // 2. RETIRER LE ROLE CLIENT D'UN COMPTE RATTACHE EST REFUSE. Retirer un role
    //    est une operation sur les DROITS ; effacer un rattachement est une
    //    operation sur le PERIMETRE d'un dossier. Les faire dans la meme requete
    //    rendrait la seconde invisible dans l'intention de la premiere, et
    //    l'appelant ne s'attend pas a perdre un rattachement en changeant un role.
    const stillAttached = await request(app.getHttpServer())
      .post(`${baseUrl}/users/${clientUserId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleCodes: ['DEVELOPER'] });

    assert.equal(stillAttached.status, 422);
    assert.equal(errorOf(stillAttached).code, 'CLIENT_SCOPE_STILL_ATTACHED');

    // Le compte doit etre intact : un refus qui laisserait le role retire serait
    // exactement l'etat incoherent que la regle cherche a empecher.
    const afterRefusal = await request(app.getHttpServer())
      .get(`${baseUrl}/users/${clientUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(afterRefusal.status, 200);
    const afterRefusalBody = afterRefusal.body as SuccessBody<UserData>;
    assert.deepEqual(afterRefusalBody.data.roles, ['CLIENT']);
    assert.equal(afterRefusalBody.data.clientId, dossierAId);

    // 3. NULL : le detachement explicite. Aucun dossier n'est lu — il n'y a rien a
    //    lire, et l'etat produit est inerte (l'espace client refuse alors l'acces
    //    avec un message explicite, voir `client-scope.ts`).
    const detached = await request(app.getHttpServer())
      .patch(`${baseUrl}/users/${clientUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ clientId: null });

    assert.equal(detached.status, 200);
    assert.equal(
      (detached.body as SuccessBody<UserData>).data.clientId,
      null,
      'null doit RETIRER le rattachement',
    );

    // Le retrait a sa propre ligne, et elle nomme l'avant ET l'apres.
    const detachLogs = await request(app.getHttpServer())
      .get(`${baseUrl}/audit-logs?entityId=${clientUserId}&action=USER_CLIENT_SCOPE_CHANGED`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(detachLogs.status, 200);
    const detachEntries = (detachLogs.body as SuccessBody<AuditLogData[]>).data;
    assert.equal(detachEntries.length, 2, 'la pose et le retrait, une ligne chacun');
    assert.deepEqual(detachEntries[0]?.before, { clientId: dossierAId });
    assert.deepEqual(detachEntries[0]?.after, { clientId: null });

    // 4. LE CHEMIN ANNONCE PAR LE REFUS EST LE BON. Une fois le compte detache, le
    //    meme changement de role passe : le message d'erreur ne renvoyait donc pas
    //    vers une operation elle-meme refusee.
    const nowAllowed = await request(app.getHttpServer())
      .post(`${baseUrl}/users/${clientUserId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleCodes: ['DEVELOPER'] });

    assert.equal(nowAllowed.status, 200);
    assert.deepEqual((nowAllowed.body as SuccessBody<UserData>).data.roles, ['DEVELOPER']);
  });

  // ---------------------------------------------------------------------------
  // Anti-exclusion
  // ---------------------------------------------------------------------------

  it('interdit de se supprimer, de se suspendre et de se retirer son propre ADMIN', async () => {
    const selfDelete = await request(app.getHttpServer())
      .delete(`${baseUrl}/users/${adminUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(selfDelete.status, 422);
    assert.equal(errorOf(selfDelete).code, 'SELF_DELETE_FORBIDDEN');

    const selfSuspend = await request(app.getHttpServer())
      .post(`${baseUrl}/users/${adminUserId}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(selfSuspend.status, 422);
    assert.equal(errorOf(selfSuspend).code, 'SELF_SUSPEND_FORBIDDEN');

    // Ce troisieme refus ne depend d'AUCUN etat global : il tient meme s'il reste
    // cinquante administrateurs. C'est ce qui le rend verifiable ici, alors que
    // la regle du dernier administrateur actif ne l'est pas (le jeu de donnees
    // en contient toujours au moins un, cree par le seed).
    const selfDemotion = await request(app.getHttpServer())
      .post(`${baseUrl}/users/${adminUserId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleCodes: ['DEVELOPER'] });

    assert.equal(selfDemotion.status, 422);
    assert.equal(errorOf(selfDemotion).code, 'SELF_ADMIN_REMOVAL_FORBIDDEN');

    // Et le compte doit etre intact : un refus qui laisse la modification a
    // moitie faite serait pire qu'une absence de refus.
    const stillAdmin = await request(app.getHttpServer())
      .get(`${baseUrl}/users/${adminUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(stillAdmin.status, 200);
    assert.deepEqual((stillAdmin.body as SuccessBody<UserData>).data.roles, ['ADMIN']);
  });

  it('remplace les roles d\'un autre compte', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/users/${createdUserId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleCodes: ['DEVELOPER', 'SALES'] });

    assert.equal(response.status, 200);
    // Le tri rend la comparaison stable : l'ordre de retour de la base n'est pas
    // garanti, et un test qui en dependrait echouerait au hasard.
    assert.deepEqual((response.body as SuccessBody<UserData>).data.roles, ['DEVELOPER', 'SALES']);
  });

  // ---------------------------------------------------------------------------
  // Suspension : la session doit tomber
  // ---------------------------------------------------------------------------

  it('suspend un compte et REVOQUE ses sessions dans la meme transaction', async () => {
    const suspended = await request(app.getHttpServer())
      .post(`${baseUrl}/users/${targetUserId}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(suspended.status, 200);
    const body = suspended.body as SuccessBody<{ user: UserData; sessionsRevoked: number }>;
    assert.equal(body.data.user.status, 'SUSPENDED');
    assert.ok(body.data.sessionsRevoked >= 1, 'la session ouverte doit avoir ete fermee');

    // LA verification qui compte, et elle est faite EN BASE : le statut seul ne
    // coupe rien tant que le refresh token reste valide. On lit la table, pas la
    // reponse.
    const sessions = await prisma.refreshToken.findMany({
      where: { userId: targetUserId },
      select: { revokedAt: true },
    });

    assert.ok(sessions.length >= 1, 'la cible devait avoir au moins une session');
    assert.ok(
      sessions.every((session) => session.revokedAt !== null),
      'toutes les sessions doivent etre revoquees',
    );

    // Et le jeton revoque ne doit plus rien ouvrir.
    const refreshed = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/refresh`)
      .set('Cookie', `${REFRESH_COOKIE}=${targetRefreshCookie}`)
      .send({});

    assert.equal(refreshed.status, 401);

    const alreadySuspended = await request(app.getHttpServer())
      .post(`${baseUrl}/users/${targetUserId}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(alreadySuspended.status, 409);
    assert.equal(errorOf(alreadySuspended).code, 'USER_ALREADY_SUSPENDED');
  });

  it('reactive un compte suspendu', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/users/${targetUserId}/reactivate`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(response.status, 200);
    assert.equal((response.body as SuccessBody<{ user: UserData }>).data.user.status, 'ACTIVE');

    // Un compte deja actif n'est pas une erreur de saisie anodine : la reponse le
    // dit, plutot que de faire croire a une operation qui n'a rien change.
    const again = await request(app.getHttpServer())
      .post(`${baseUrl}/users/${targetUserId}/reactivate`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(again.status, 409);
    assert.equal(errorOf(again).code, 'USER_ALREADY_ACTIVE');
  });

  // ---------------------------------------------------------------------------
  // Mot de passe
  // ---------------------------------------------------------------------------

  it('reinitialise un mot de passe, force le changement et ferme les sessions', async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: targetUserId },
      select: { passwordHash: true },
    });

    // Une session fraiche, ouverte apres la reactivation : elle doit tomber elle
    // aussi. C'est la 3e connexion du fichier, sur les 10 autorisees par minute.
    const login = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/login`)
      .send({ email: EMAIL_TARGET, password: PASSWORD });

    assert.equal(login.status, 200);
    const openedCookie = refreshCookieOf(login);
    assert.ok(openedCookie, 'une session doit avoir ete ouverte');

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/users/${targetUserId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(response.status, 200);
    const body = response.body as SuccessBody<CreatedAccountData>;
    assert.ok(body.data.temporaryPassword.length >= 12);
    assert.equal(body.data.user.mustChangePassword, true, 'le changement doit etre force');

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: targetUserId },
      select: { passwordHash: true },
    });

    assert.notEqual(after.passwordHash, before.passwordHash, 'l\'empreinte doit avoir change');

    const sessions = await prisma.refreshToken.findMany({
      where: { userId: targetUserId },
      select: { revokedAt: true },
    });

    assert.ok(sessions.every((session) => session.revokedAt !== null));

    // Et la session ouverte juste avant ne doit plus rien ouvrir : un mot de
    // passe reinitialise sur un compte compromis, sans fermeture des sessions,
    // laisserait l'attaquant dedans — ce qui viderait l'operation de son sens.
    const replay = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/refresh`)
      .set('Cookie', `${REFRESH_COOKIE}=${openedCookie}`)
      .send({});

    assert.equal(replay.status, 401);

    // Le mot de passe genere ne doit apparaitre NULLE PART ailleurs que dans
    // cette reponse. On le cherche dans les journaux d'audit que l'operation
    // vient d'ecrire — un journal se conserve bien plus longtemps qu'une reponse.
    const logs = await request(app.getHttpServer())
      .get(`${baseUrl}/audit-logs?entityId=${targetUserId}&action=USER_PASSWORD_RESET`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(logs.status, 200);
    const logsBody = logs.body as SuccessBody<AuditLogData[]>;
    assert.ok(
      !JSON.stringify(logsBody.data).includes(body.data.temporaryPassword),
      'le mot de passe genere ne doit jamais se retrouver dans le journal',
    );
  });

  // ---------------------------------------------------------------------------
  // Suppression logique
  // ---------------------------------------------------------------------------

  it('supprime logiquement un compte, ferme ses sessions et le retire de l\'annuaire', async () => {
    const response = await request(app.getHttpServer())
      .delete(`${baseUrl}/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(response.status, 200);
    const body = response.body as SuccessBody<{ deleted: true; sessionsRevoked: number }>;
    assert.equal(body.data.deleted, true);

    // La ligne est TOUJOURS en base : c'est une suppression logique, pas un
    // effacement. Les devis, les factures et le journal la referencent.
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: createdUserId },
      select: { deletedAt: true, status: true },
    });

    assert.ok(row.deletedAt !== null, 'la ligne doit subsister, marquee supprimee');
    assert.equal(row.status, 'ARCHIVED');

    // Et elle a disparu de l'annuaire.
    const detail = await request(app.getHttpServer())
      .get(`${baseUrl}/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(detail.status, 404);
    assert.equal(errorOf(detail).code, 'USER_NOT_FOUND');
  });

  // ---------------------------------------------------------------------------
  // Roles et permissions
  // ---------------------------------------------------------------------------

  it('liste les roles et le detail de chacun', async () => {
    const list = await request(app.getHttpServer())
      .get(`${baseUrl}/roles`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(list.status, 200);
    const roles = (list.body as SuccessBody<RoleData[]>).data;
    assert.ok(roles.some((role) => role.code === 'ADMIN'));

    const developer = await request(app.getHttpServer())
      .get(`${baseUrl}/roles/DEVELOPER`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(developer.status, 200);
    const detail = (developer.body as SuccessBody<RoleData>).data;
    assert.ok(detail.permissions && detail.permissions.length > 0, 'DEVELOPER doit avoir des droits');
    // Le compte annonce dans la liste doit correspondre au detail : deux
    // requetes, une seule verite. Un ecart signalerait un `_count` mal filtre.
    assert.equal(detail.permissionCount, detail.permissions?.length);
  });

  it('rend 404 pour un role qui n\'existe pas, sans erreur de validation Prisma', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/roles/PATRON`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(response.status, 404);
    assert.equal(errorOf(response).code, 'ROLE_NOT_FOUND');
  });

  it('refuse de modifier les permissions du role ADMIN', async () => {
    const response = await request(app.getHttpServer())
      .patch(`${baseUrl}/roles/ADMIN/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionCodes: ['user:read:any'] });

    // 422 et non 403 : le porteur detient bien `role:manage:any` — c'est le role
    // ADMIN qui n'est pas modifiable, parce que ses permissions viennent du
    // catalogue et non d'une liste en base.
    assert.equal(response.status, 422);
    assert.equal(errorOf(response).code, 'ROLE_IMMUTABLE');
  });

  it('refuse une permission absente du catalogue, en la nommant', async () => {
    const response = await request(app.getHttpServer())
      .patch(`${baseUrl}/roles/DEVELOPER/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionCodes: ['user:read:any', 'licorne:voler:any'] });

    assert.equal(response.status, 422);
    const error = errorOf(response);
    assert.equal(error.code, 'UNKNOWN_PERMISSION');
    assert.deepEqual(error.details, { permissions: ['licorne:voler:any'] });
  });

  it('remplace les permissions d\'un role et les relit a l\'identique', async () => {
    // Le scenario remet a DEVELOPER EXACTEMENT les permissions qu'il detient
    // deja. C'est volontaire : le test reste vrai meme si le seed evolue, alors
    // qu'une liste ecrite en dur deviendrait fausse en silence — et un test
    // d'integration qui echoue sur un changement de donnees legitime finit par
    // etre desactive, ce qui est pire que de ne pas l'ecrire.
    const current = await request(app.getHttpServer())
      .get(`${baseUrl}/roles/DEVELOPER`)
      .set('Authorization', `Bearer ${adminToken}`);

    const codes = (current.body as SuccessBody<RoleData>).data.permissions?.map((p) => p.code) ?? [];
    assert.ok(codes.length > 0);

    const response = await request(app.getHttpServer())
      .patch(`${baseUrl}/roles/DEVELOPER/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionCodes: codes });

    assert.equal(response.status, 200);
    const after = (response.body as SuccessBody<RoleData>).data;
    assert.deepEqual(
      (after.permissions ?? []).map((permission) => permission.code).sort(),
      [...codes].sort(),
      'les permissions doivent etre exactement celles demandees',
    );
  });

  it('sert le catalogue tel qu\'il est en base', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/permissions`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(response.status, 200);
    const permissions = (response.body as SuccessBody<PermissionData[]>).data;
    const codes = permissions.map((permission) => permission.code);

    // Les codes du catalogue sont de la forme `ressource:action:portee`, et la
    // portee est exposee separement : c'est elle qui distingue `:any` de `:own`,
    // et le frontend ne peut pas la deduire du code sans le redecouper.
    assert.ok(codes.includes('user:read:any'));
    assert.ok(codes.includes('audit:read:any'));
    assert.ok(permissions.every((permission) => permission.scope.length > 0));
  });

  // La verification d'autorisation sur cette route est faite plus haut, avec le
  // jeton de la cible alors qu'il est encore valable. La refaire ici ne
  // prouverait rien : le compte est suspendu depuis, et le refus viendrait du
  // statut du compte, pas du droit manquant.

  // ---------------------------------------------------------------------------
  // Journal d'audit
  // ---------------------------------------------------------------------------

  it('consigne les operations sensibles, avec leur auteur et leur avant/apres', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/audit-logs?action=USER_CREATED&entityId=${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(response.status, 200);
    const body = response.body as SuccessBody<AuditLogData[]>;
    const entry = body.data[0];

    assert.ok(entry, 'la creation du compte doit avoir laisse une trace');
    assert.equal(entry.action, 'USER_CREATED');
    assert.equal(entry.entityType, 'User');
    assert.equal(entry.actorId, adminUserId);
    // L'adresse de l'auteur est jointe a la lecture : un cuid nu ne repond a
    // aucune question.
    assert.equal(entry.actorEmail, EMAIL_ADMIN);
    assert.deepEqual(entry.after, {
      email: EMAIL_CREATED,
      roles: ['DEVELOPER'],
      status: 'ACTIVE',
    });
  });

  it('ne laisse filtrer NI empreinte NI jeton par le journal', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/audit-logs?entityId=${adminUserId}&perPage=100`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(response.status, 200);
    const body = response.body as SuccessBody<AuditLogData[]>;

    // Le corps ENTIER est inspecte, pas seulement les deux champs connus : un
    // masquage qui ne couvrirait que le premier niveau laisserait passer
    // `{ utilisateur: { passwordHash } }`, c'est-a-dire la forme exacte que
    // prend un objet Prisma recopie tel quel.
    assert.ok(!hasKeyDeep(body.data, 'passwordHash'));
    assert.ok(!hasKeyDeep(body.data, 'password'));
    assert.ok(!hasKeyDeep(body.data, 'refreshToken'));
    assert.ok(!hasKeyDeep(body.data, 'accessToken'));
  });

  it('filtre le journal par porteur et par periode, et REFUSE une periode inversee', async () => {
    const byActor = await request(app.getHttpServer())
      .get(`${baseUrl}/audit-logs?actorId=${adminUserId}&perPage=100`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(byActor.status, 200);
    assert.ok(
      (byActor.body as SuccessBody<AuditLogData[]>).data.every(
        (entry) => entry.actorId === adminUserId,
      ),
    );

    const wide = await request(app.getHttpServer())
      .get(`${baseUrl}/audit-logs?from=2020-01-01T00:00:00.000Z&to=2100-01-01T00:00:00.000Z`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(wide.status, 200);

    // Une periode inversee rendrait une liste vide, et une liste vide se lit
    // « il ne s'est rien passe ». Un enqueteur conclurait a l'absence d'activite
    // alors que sa requete est mal construite : c'est la seule erreur de saisie
    // qui fasse dire au journal le contraire de la verite.
    const inverted = await request(app.getHttpServer())
      .get(`${baseUrl}/audit-logs?from=2100-01-01T00:00:00.000Z&to=2020-01-01T00:00:00.000Z`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(inverted.status, 422);
    assert.equal(errorOf(inverted).code, 'INVALID_PERIOD');
  });

  // Meme remarque que pour le catalogue : le refus est verifie plus haut, sur un
  // jeton encore valable.
});
