import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  AccessPolicy,
  SCOPE_ANY,
  SCOPE_OWN,
  type AuthenticatedUser,
} from '../../common/auth/principal.js';
import { paginated, resolvePagination } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Paginated } from '../../common/interceptors/transform.interceptor.js';
import { generateStrongPassword, hashPassword } from '../../common/security/password.js';
// Import de VALEUR et non de type : `Prisma.TransactionIsolationLevel` est lu a
// l'execution pour nommer le niveau d'isolation. Seul `Prisma.TransactionClient`
// et les types d'entree sont des types.
import { Prisma } from '../../generated/prisma/client.js';
import { RoleCode, UserStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SessionMeta } from '../auth/session.js';
// Le perimetre des dossiers clients est celui du module clients, pas une copie :
// une seconde lecture de `policy.clientId` finirait par diverger de la premiere,
// et c'est exactement ce que ce fichier doit eviter. `clientPerimeter` refuse en
// plus le porteur qui ne detient pas `client:read:any` — la verification de
// droit vient donc avec le filtre, on ne peut pas en oublier une.
import { clientPerimeter, composeAnd } from '../clients/client-scope.js';
import type {
  CreateUserDto,
  ListUsersQueryDto,
  SetUserRolesDto,
  UpdateUserDto,
} from './dto/user.dto.js';
import {
  assertAdministratorRemains,
  assertClientScopeDetachedBeforeRoleChange,
  assertClientScopeRequiresClientRole,
  assertNotLastActiveAdministrator,
  assertNotSelfAccount,
  assertRolesKnown,
} from './identity-rules.js';
import { presentUser, USER_SELECT, type UserRow, type UserView } from './user.presenter.js';

/**
 * ADMINISTRATION DES COMPTES.
 *
 * TROIS REGLES GOUVERNENT CE FICHIER.
 *
 * 1. LE MOT DE PASSE GENERE NE SORT QU'UNE FOIS. Un compte cree par
 *    l'administration recoit un mot de passe tire au sort par le serveur, hache
 *    immediatement, et renvoye en clair dans la reponse de creation — sans quoi
 *    l'invitation ne sert a rien, personne ne connaitrait la valeur initiale. Il
 *    n'est ni journalise, ni restocke, ni relisible : aucun chemin de ce fichier
 *    ne peut le rendre a nouveau. Le porteur doit le changer a sa premiere
 *    connexion (`mustChangePassword`), ce qui ferme la fenetre pendant laquelle
 *    l'administrateur le connait aussi.
 *
 * 2. L'EMPREINTE NE SORT JAMAIS. Voir `user.presenter.ts` : la colonne n'est pas
 *    demandee a la base, et la reponse est construite champ par champ. Aucun
 *    `before`/`after` d'audit ne porte `passwordHash` non plus : ils sont ecrits
 *    ici, propriete par propriete, et la valeur n'y figure pas.
 *
 * 3. TOUTE OPERATION QUI PEUT RETIRER UN ADMINISTRATEUR ACTIF PASSE PAR LA MEME
 *    PORTE : `identity-rules.ts` pour la decision, et une transaction
 *    SERIALISABLE pour que la lecture du nombre d'administrateurs et l'ecriture
 *    ne puissent pas etre separees par une autre requete. Trois operations sont
 *    concernees — retirer le role ADMIN, suspendre un administrateur, supprimer
 *    un compte. Ce sont les seules qui peuvent aboutir a une agence sans
 *    personne pour gerer les comptes.
 *
 * 4. LE RATTACHEMENT CLIENT EST UNE DONNEE D'ACCES, PAS UN CHAMP DE PROFIL. Il
 *    decide du perimetre de l'espace client, donc des donnees que le compte voit
 *    et des notifications qu'il recoit (`audience.ts` filtre sur `clientId` sans
 *    regarder le role). Trois consequences dans ce fichier : le porteur doit
 *    pouvoir LIRE le dossier vise (`client:read:any`, via `clientPerimeter`) en
 *    plus de `user:write:any` / `user:manage:any` ; un compte ne peut porter un
 *    `clientId` que s'il a le role CLIENT ; et toute pose, modification ou
 *    retrait laisse une ligne d'audit nommee `USER_CLIENT_SCOPE_CHANGED`, en plus
 *    de l'entree generale de l'operation.
 */

/** Un compte utilisable par l'API, avec le mot de passe initial en clair. */
export interface CreatedAccount {
  readonly user: UserView;
  /**
   * En clair, et seulement dans cette reponse. Voir la regle 1 ci-dessus.
   */
  readonly temporaryPassword: string;
}

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------

  /**
   * Liste paginee des comptes.
   *
   * Le `where` porte DEUX choses : le perimetre de lecture et l'exclusion des
   * comptes supprimes. Le perimetre est verifie ici, dans le service, et pas
   * seulement par le decorateur de la route : `requireScope` refuse un porteur
   * qui ne detiendrait que `user:read:own`, meme si la route venait a accepter
   * les deux codes. Le garde autorise la ROUTE, le service restreint les
   * DONNEES — les deux sont necessaires, aucun ne suffit.
   */
  async list(query: ListUsersQueryDto, actor: AuthenticatedUser): Promise<Paginated<UserView>> {
    new AccessPolicy(actor).requireScope('user', 'read', [SCOPE_ANY]);

    const pagination = resolvePagination(query);
    const search = query.search?.trim();

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.roleCode ? { roles: { some: { role: { code: query.roleCode } } } } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // Une seule transaction pour la page ET le total : lus separement, ils
    // peuvent decrire deux etats differents, et le frontend afficherait alors
    // « 3 pages » pour une liste qui n'en a plus que deux.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        // Ordre alphabetique : dans un annuaire d'administration, on cherche une
        // personne, pas la derniere inscrite.
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginated(rows.map(presentUser), total, pagination);
  }

  /**
   * Le profil d'un compte, dans le perimetre du porteur.
   *
   * `user:read:own` ouvre CETTE route et pas la liste : « consulter son propre
   * compte » n'autorise pas a parcourir l'annuaire. Le perimetre est applique
   * ici, dans le service, apres le garde qui a autorise l'appel — les deux
   * niveaux sont necessaires, aucun ne suffit.
   *
   * UN COMPTE HORS PERIMETRE EST INTROUVABLE (404 `USER_NOT_FOUND`), PAS INTERDIT
   * (403). Un 403 distinct confirmerait au passage l'existence du compte vise, et
   * c'est exactement ce que l'exigence du cahier des charges interdit. Le code
   * d'erreur est celui d'un identifiant qui ne correspond a rien : les deux
   * situations sont indiscernables de l'exterieur.
   *
   * La comparaison porte sur l'IDENTIFIANT DE L'URL, avant toute lecture : il n'y
   * a donc aucun chemin ou une ligne serait chargee puis ecartee apres coup.
   */
  async getById(id: string, actor: AuthenticatedUser): Promise<UserView> {
    return presentUser(await this.requireReadableUser(id, new AccessPolicy(actor)));
  }

  // ---------------------------------------------------------------------------
  // Creation
  // ---------------------------------------------------------------------------

  /**
   * Cree un compte et rend son mot de passe initial UNE SEULE FOIS.
   *
   * Le statut pose est ACTIVE, et non INVITED, malgre l'existence de ce statut
   * dans le schema. Un compte INVITED est refuse par `PrincipalService` : son
   * porteur ne peut meme pas se connecter pour changer son mot de passe. Le mot
   * de passe renvoye ici ne servirait donc a rien. C'est `mustChangePassword`
   * qui joue le role de l'invitation : on peut entrer, et on ne peut rien faire
   * d'autre que choisir son mot de passe.
   */
  async create(
    dto: CreateUserDto,
    actor: AuthenticatedUser,
    meta: SessionMeta,
  ): Promise<CreatedAccount> {
    const policy = new AccessPolicy(actor);
    policy.requireScope('user', 'manage', [SCOPE_ANY]);

    const email = normaliseEmail(dto.email);
    const roleCodes = uniqueCodes(dto.roleCodes);

    const roles = await this.prisma.role.findMany({
      where: { code: { in: roleCodes } },
      select: { id: true, code: true },
    });
    assertRolesKnown(roleCodes, roles.map((role) => role.code));

    // Le rattachement est resolu AVANT toute ecriture : dossier lu, role
    // verifie, droit du porteur controle. Une creation refusee ne doit pas
    // laisser un compte a moitie pose — ni un mot de passe hache pour rien.
    const clientId = await this.resolveClientScope(dto.clientId, roleCodes, policy);

    // L'unicite est verifiee AVANT de hacher. Hacher d'abord ferait payer un
    // argon2id — 19 Mio et quelques dizaines de millisecondes — pour decouvrir
    // ensuite que l'adresse est prise.
    await this.assertEmailAvailable(email);

    const temporaryPassword = generateStrongPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    const created = await this.withEmailConflict(() =>
      this.prisma.$transaction((tx) =>
        tx.user.create({
          data: {
            email,
            passwordHash,
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            phone: dto.phone?.trim() ?? null,
            status: UserStatus.ACTIVE,
            mustChangePassword: true,
            clientId,
            // `assignedById` : le schema le porte pour repondre un jour a « qui a
            // donne ce role a cette personne ». Le renseigner coute une colonne,
            // ne pas le renseigner rend la question sans reponse.
            roles: {
              create: roles.map((role) => ({ roleId: role.id, assignedById: actor.id })),
            },
          },
          select: USER_SELECT,
        }),
      ),
    );

    await this.audit.record({
      actorId: actor.id,
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: created.id,
      // La ligne de journal nomme les faits utiles et RIEN du secret. Le mot de
      // passe genere n'apparait pas ici — un journal se consulte, s'exporte et
      // se conserve bien plus longtemps qu'une reponse HTTP.
      after: { email, roles: roleCodes, status: UserStatus.ACTIVE },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    // La pose du rattachement a sa propre ligne, meme quand elle accompagne une
    // creation : c'est une donnee d'ACCES, et « qui a rattache ce compte, et
    // quand ? » doit se repondre par un filtre sur une action, pas en relisant
    // le JSON de chaque creation de compte.
    if (clientId !== null) {
      await this.recordClientScopeChange(actor.id, created.id, null, clientId, meta);
    }

    return { user: presentUser(created), temporaryPassword };
  }

  // ---------------------------------------------------------------------------
  // Modification
  // ---------------------------------------------------------------------------

  async update(
    id: string,
    dto: UpdateUserDto,
    actor: AuthenticatedUser,
    meta: SessionMeta,
  ): Promise<UserView> {
    const policy = new AccessPolicy(actor);
    policy.requireScope('user', 'write', [SCOPE_ANY]);

    const before = await this.requireUser(id);

    // `UserUncheckedUpdateInput` et non `UserUpdateInput` : `clientId` est une
    // cle etrangere SCALAIRE, et Prisma ne l'expose que sur la variante
    // « unchecked » — l'autre passe par `client: { connect }` / `{ disconnect }`.
    // Le reste des champs ecrits ici (nom, prenom, e-mail, telephone) existe sur
    // les deux, donc rien d'autre ne change.
    const data: Prisma.UserUncheckedUpdateInput = {};

    if (dto.firstName !== undefined) {
      data.firstName = dto.firstName.trim();
    }
    if (dto.lastName !== undefined) {
      data.lastName = dto.lastName.trim();
    }
    if (dto.phone !== undefined) {
      // Une chaine vide efface le numero : sans cela, le frontend n'aurait
      // aucun moyen de retirer une valeur, seulement de la remplacer.
      const phone = dto.phone.trim();
      data.phone = phone.length > 0 ? phone : null;
    }
    if (dto.email !== undefined) {
      const email = normaliseEmail(dto.email);
      if (email !== before.email) {
        await this.assertEmailAvailable(email, id);
        data.email = email;
      }
    }

    // LE RATTACHEMENT CLIENT — trois etats, distingues ici et non dans le DTO.
    //
    // `undefined` = champ ABSENT : on n'y touche pas. Un PATCH qui renomme une
    // personne ne doit pas effacer son perimetre au passage, ce que ferait un
    // `data.clientId = dto.clientId` ecrit sans garde.
    //
    // `null` = RETRAIT explicite. Aucune lecture de dossier n'est faite : il n'y
    // a rien a lire, et l'etat produit est inerte (l'espace client refuse alors
    // l'acces avec un message explicite, voir `client-scope.ts`).
    //
    // Une valeur = RATTACHEMENT, apres les trois verifications de
    // `resolveClientScope`. Elle n'est ecrite que si elle DIFFERE de la valeur en
    // base : reposer le meme identifiant n'est pas une modification, et une ligne
    // de journal annoncant un changement qui n'en est pas un est pire que pas de
    // ligne du tout.
    let clientScopeChanged = false;

    if (dto.clientId !== undefined && dto.clientId !== before.clientId) {
      data.clientId =
        dto.clientId === null
          ? null
          : await this.resolveClientScope(dto.clientId, roleCodesOf(before), policy);
      clientScopeChanged = true;
    }

    // Rien a changer : on ne fait ni ecriture ni ligne de journal. Un
    // `updatedAt` qui bouge sans modification rendrait les pistes d'audit
    // trompeuses.
    if (Object.keys(data).length === 0) {
      return presentUser(before);
    }

    const updated = await this.withEmailConflict(() =>
      this.prisma.user.update({ where: { id }, data, select: USER_SELECT }),
    );

    await this.audit.record({
      actorId: actor.id,
      action: 'USER_UPDATED',
      entityType: 'User',
      entityId: id,
      before: profileFacts(before),
      after: profileFacts(updated),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    if (clientScopeChanged) {
      await this.recordClientScopeChange(actor.id, id, before.clientId, updated.clientId, meta);
    }

    return presentUser(updated);
  }

  // ---------------------------------------------------------------------------
  // Suppression, suspension, reactivation
  // ---------------------------------------------------------------------------

  /**
   * Suppression LOGIQUE, et revocation des sessions.
   *
   * Le schema porte `deletedAt` : la ligne doit rester, parce que les devis, les
   * factures et le journal d'audit la referencent. L'effacer casserait l'histoire
   * de l'agence pour faire disparaitre un nom.
   *
   * `status` passe aussi a ARCHIVED. Ce n'est pas redondant : `deletedAt` est ce
   * que lit `PrincipalService` pour refuser l'acces, mais toute requete qui
   * filtrerait sur `status` seul — « les comptes actifs », dans n'importe quel
   * module ecrit plus tard — verrait encore ce compte. Deux marqueurs valent
   * mieux qu'un, sur une operation qu'on ne defait pas.
   */
  async remove(
    id: string,
    actor: AuthenticatedUser,
    meta: SessionMeta,
  ): Promise<{ deleted: true; sessionsRevoked: number }> {
    new AccessPolicy(actor).requireScope('user', 'manage', [SCOPE_ANY]);
    assertNotSelfAccount(actor.id, id, 'DELETE');

    const result = await this.serializable(async (tx) => {
      const target = await requireUserIn(tx, id);

      await assertAdministratorCanLoseAccess(tx, target);

      const revoked = await revokeSessions(tx, id);

      await tx.user.update({
        where: { id },
        data: { deletedAt: new Date(), status: UserStatus.ARCHIVED },
      });

      return { target, revoked };
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'USER_DELETED',
      entityType: 'User',
      entityId: id,
      before: { email: result.target.email, status: result.target.status },
      after: { deleted: true, sessionsRevoked: result.revoked },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { deleted: true, sessionsRevoked: result.revoked };
  }

  /**
   * Suspend le compte ET ferme ses sessions, dans la MEME transaction.
   *
   * C'est le point qui ne se voit pas a la lecture : `status` seul ne coupe
   * rien. `PrincipalService` recharge le porteur a chaque requete, donc un
   * compte suspendu cesse d'agir immediatement — mais uniquement parce qu'il est
   * relu EN BASE. Ses refresh tokens, eux, resteraient valides trente jours, et
   * le jour ou un jeton d'acces est emis sans repasser par cette lecture, la
   * suspension ne vaudrait plus rien. On ferme donc les deux ensemble : si la
   * revocation echoue, le statut n'est pas ecrit non plus.
   */
  async suspend(
    id: string,
    actor: AuthenticatedUser,
    meta: SessionMeta,
  ): Promise<{ user: UserView; sessionsRevoked: number }> {
    new AccessPolicy(actor).requireScope('user', 'manage', [SCOPE_ANY]);
    assertNotSelfAccount(actor.id, id, 'SUSPEND');

    const result = await this.serializable(async (tx) => {
      const target = await requireUserIn(tx, id);

      if (target.status === UserStatus.SUSPENDED) {
        throw AppException.conflict('USER_ALREADY_SUSPENDED', 'Ce compte est deja suspendu.');
      }

      await assertAdministratorCanLoseAccess(tx, target);

      const revoked = await revokeSessions(tx, id);

      await tx.user.update({ where: { id }, data: { status: UserStatus.SUSPENDED } });

      return { target, revoked };
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'USER_SUSPENDED',
      entityType: 'User',
      entityId: id,
      before: { email: result.target.email, status: result.target.status },
      after: { status: UserStatus.SUSPENDED, sessionsRevoked: result.revoked },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { user: presentUser(await this.requireUser(id)), sessionsRevoked: result.revoked };
  }

  /**
   * Remet le compte en service.
   *
   * Les sessions fermees a la suspension le restent : le porteur se reconnecte.
   * Les rouvrir demanderait de ressusciter des refresh tokens qui ont ete
   * revoques deliberement — exactement ce qu'un vol de jeton attendrait.
   */
  async reactivate(
    id: string,
    actor: AuthenticatedUser,
    meta: SessionMeta,
  ): Promise<{ user: UserView }> {
    new AccessPolicy(actor).requireScope('user', 'manage', [SCOPE_ANY]);

    const before = await this.requireUser(id);

    // Un compte supprime n'arrive jamais ici : `requireUser` filtre
    // `deletedAt: null` et rend un 404. Une suppression logique ne se defait
    // donc pas par cette route, ce qui est voulu — reactiver demanderait de
    // reprendre aussi le statut, les roles et les sessions.
    if (before.status === UserStatus.ACTIVE) {
      throw AppException.conflict('USER_ALREADY_ACTIVE', 'Ce compte est deja actif.');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.ACTIVE },
      select: USER_SELECT,
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'USER_REACTIVATED',
      entityType: 'User',
      entityId: id,
      before: { status: before.status },
      after: { status: UserStatus.ACTIVE },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { user: presentUser(updated) };
  }

  // ---------------------------------------------------------------------------
  // Roles
  // ---------------------------------------------------------------------------

  /**
   * Remplace l'ensemble des roles d'un compte.
   *
   * Les roles sont REMPLACES, pas ajoutes : c'est le seul contrat qui permette
   * de repondre a « quels sont les droits de cette personne ? » sans avoir a
   * relire l'historique. Un ajout seul obligerait a retirer separement, et un
   * retrait oublie laisserait un droit que personne ne voit plus.
   *
   * Aucune session n'est revoquee ici : le porteur est relu en base a chaque
   * requete, donc un role retire cesse d'agir immediatement sans fermer sa
   * session. Le jeter dehors serait une punition, pas une mesure de securite.
   *
   * UN COMPTE RATTACHE A UN DOSSIER CLIENT NE PEUT PAS PERDRE LE ROLE CLIENT.
   * Le refus vient de `assertClientScopeDetachedBeforeRoleChange` : effacer le
   * rattachement est une decision sur le PERIMETRE d'un dossier, pas sur les
   * droits, et elle ne doit pas se produire par effet de bord d'un changement de
   * roles. Le chemin explicite est `PATCH /users/:id` avec `clientId: null`.
   */
  async setRoles(
    id: string,
    dto: SetUserRolesDto,
    actor: AuthenticatedUser,
    meta: SessionMeta,
  ): Promise<UserView> {
    new AccessPolicy(actor).requireScope('user', 'manage', [SCOPE_ANY]);

    const nextCodes = uniqueCodes(dto.roleCodes);

    const result = await this.serializable(async (tx) => {
      const target = await requireUserIn(tx, id);

      const roles = await tx.role.findMany({
        where: { code: { in: nextCodes } },
        select: { id: true, code: true },
      });
      assertRolesKnown(nextCodes, roles.map((role) => role.code));

      await assertAdministratorRemains({
        actorId: actor.id,
        targetId: id,
        currentRoles: target.roles.map((userRole) => userRole.role.code),
        nextRoles: nextCodes,
        targetIsActive: target.status === UserStatus.ACTIVE,
        activeAdminCount: await activeAdministratorCount(tx),
      });

      // Le rattachement client ne survit pas a la perte du role CLIENT : un
      // compte rattache et sans ce role recevrait les notifications du dossier
      // sans jamais pouvoir en lire une ligne, et le perimetre pose en base
      // designerait un porteur qui n'est pas un client. On refuse plutot que de
      // detacher en silence : voir `assertClientScopeDetachedBeforeRoleChange`.
      assertClientScopeDetachedBeforeRoleChange(target.clientId, nextCodes);

      await tx.userRole.deleteMany({ where: { userId: id } });

      if (roles.length > 0) {
        await tx.userRole.createMany({
          data: roles.map((role) => ({ userId: id, roleId: role.id, assignedById: actor.id })),
        });
      }

      return { previousRoles: target.roles.map((userRole) => userRole.role.code).sort() };
    });

    const updated = await this.requireUser(id);

    await this.audit.record({
      actorId: actor.id,
      action: 'USER_ROLES_CHANGED',
      entityType: 'User',
      entityId: id,
      before: { roles: result.previousRoles },
      after: { roles: [...updated.roles.map((userRole) => userRole.role.code)].sort() },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return presentUser(updated);
  }

  // ---------------------------------------------------------------------------
  // Mot de passe
  // ---------------------------------------------------------------------------

  /**
   * Reinitialise le mot de passe d'un compte tiers.
   *
   * L'administrateur ne CHOISIT pas le mot de passe, il en declenche un nouveau.
   * S'il le choisissait, il connaitrait un secret durable d'un compte qui n'est
   * pas le sien — et rien ne l'obligerait a le communiquer par un canal sur.
   *
   * `mustChangePassword` est repose : le mot de passe genere a circule par la
   * reponse HTTP, donc par un ecran, un historique de requete ou un terminal. Il
   * doit cesser d'etre valable des la premiere connexion.
   *
   * Les sessions tombent dans la meme transaction : reinitialiser le mot de
   * passe d'un compte compromis sans fermer les sessions laisserait l'attaquant
   * dedans, ce qui vide l'operation de son sens.
   */
  async resetPassword(
    id: string,
    actor: AuthenticatedUser,
    meta: SessionMeta,
  ): Promise<CreatedAccount> {
    new AccessPolicy(actor).requireScope('user', 'manage', [SCOPE_ANY]);

    const temporaryPassword = generateStrongPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    const result = await this.prisma.$transaction(async (tx) => {
      const target = await requireUserIn(tx, id);

      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
          // Un mot de passe neuf rend caducs le verrouillage et le compteur
          // d'echecs : les laisser en place ferait echouer la connexion
          // suivante pour une raison qui n'existe plus.
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });

      const revoked = await revokeSessions(tx, id);

      return { target, revoked };
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'USER_PASSWORD_RESET',
      entityType: 'User',
      entityId: id,
      // Le mot de passe n'est evidemment pas journalise ; l'action elle-meme est
      // la trace, avec son auteur et son heure.
      before: { email: result.target.email },
      after: { sessionsRevoked: result.revoked },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { user: presentUser(await this.requireUser(id)), temporaryPassword };
  }

  // ---------------------------------------------------------------------------
  // Outils internes
  // ---------------------------------------------------------------------------

  /** Le compte, ou un 404. Les comptes supprimes sont introuvables. */
  private async requireUser(id: string): Promise<UserRow> {
    return requireUserIn(this.prisma, id);
  }

  /**
   * Le compte, ou un 404 — DANS LE PERIMETRE DU PORTEUR.
   *
   * `widestScope` et non `requireScope('user','read',[SCOPE_ANY])` : la route
   * accepte `user:read:own`, donc le service doit dire ce que « own » designe
   * pour CETTE ressource — ici, le compte du porteur lui-meme. Un porteur qui ne
   * detient ni `any` ni `own` est refuse en 403 : il n'a aucun droit de lecture,
   * ce n'est pas un probleme de perimetre.
   */
  private async requireReadableUser(id: string, policy: AccessPolicy): Promise<UserRow> {
    const scope = policy.requireScope('user', 'read', [SCOPE_ANY, SCOPE_OWN]);

    if (scope === SCOPE_OWN && id !== policy.userId) {
      throw AppException.notFound('USER_NOT_FOUND', 'Ce compte est introuvable.');
    }

    return this.requireUser(id);
  }

  /**
   * Le dossier client a rattacher, ou un refus explique. `null` quand aucun
   * rattachement n'est demande.
   *
   * TROIS VERIFICATIONS, DANS CET ORDRE, ET L'ORDRE COMPTE.
   *
   *  1. LE DROIT. `clientPerimeter` exige `client:read:any` et refuse en 403
   *     sinon. Le rattachement n'est pas un champ d'identite ordinaire : il
   *     ouvre un dossier, donc le porteur doit pouvoir le LIRE, en plus du
   *     `user:write:any` / `user:manage:any` que la route exige deja. Aucun role
   *     du catalogue ne detient aujourd'hui l'un sans l'autre — seul ADMIN a
   *     `user:write:any`, et ADMIN a `ALL` — mais la regle est VERIFIEE, pas
   *     supposee : le jour ou un role commercial pourra gerer les comptes, il ne
   *     pourra pas les rattacher aux dossiers qu'il ne voit pas.
   *
   *  2. LA COHERENCE AVEC LE ROLE. Un fait du payload, donc verifie avant
   *     d'interroger la base : payer une requete pour un refus deja certain
   *     n'apporte rien, et l'ordre rend le refus plus rapide a diagnostiquer.
   *
   *  3. L'EXISTENCE. Le dossier est lu avec `deletedAt: null` DANS la requete,
   *     jamais dans un test apres coup : un dossier supprime logiquement est
   *     alors introuvable pour tous les appelants a la fois. Le code d'erreur est
   *     celui du module clients, pas un code neuf — `CLIENT_NOT_FOUND`, 404.
   */
  private async resolveClientScope(
    requested: string | null | undefined,
    roles: readonly string[],
    policy: AccessPolicy,
  ): Promise<string | null> {
    if (requested === undefined || requested === null) {
      return null;
    }

    const perimeter = clientPerimeter(policy, 'client', 'read');

    assertClientScopeRequiresClientRole(requested, roles);

    const dossier = await this.prisma.client.findFirst({
      where: { deletedAt: null, AND: composeAnd(perimeter, { id: requested }) },
      select: { id: true },
    });

    if (!dossier) {
      throw AppException.notFound('CLIENT_NOT_FOUND', "Ce dossier client n'existe pas.");
    }

    return requested;
  }

  /**
   * La trace du rattachement.
   *
   * Une action a part, et pas seulement un `before`/`after` de plus dans
   * `USER_UPDATED` : le journal doit repondre a « qui a rattache ce compte a ce
   * dossier, et quand ? » par un filtre sur une action, sans obliger a relire le
   * JSON de toutes les modifications de profil pour y retrouver une valeur.
   *
   * Les faits journalises sont l'identifiant du dossier AVANT et APRES. Jamais
   * autre chose : un journal se conserve et s'exporte bien plus longtemps que la
   * ligne qu'il decrit.
   */
  private async recordClientScopeChange(
    actorId: string,
    userId: string,
    before: string | null,
    after: string | null,
    meta: SessionMeta,
  ): Promise<void> {
    await this.audit.record({
      actorId,
      action: 'USER_CLIENT_SCOPE_CHANGED',
      entityType: 'User',
      entityId: userId,
      before: { clientId: before },
      after: { clientId: after },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  /**
   * Verifie que l'adresse est libre.
   *
   * La recherche NE FILTRE PAS `deletedAt` : la contrainte d'unicite de
   * PostgreSQL porte sur toute la table, comptes supprimes compris. Ne regarder
   * que les comptes vivants laisserait passer la verification, puis l'insertion
   * echouerait sur un conflit brut (P2002) — un message technique la ou on
   * pouvait expliquer la situation.
   */
  private async assertEmailAvailable(email: string, excludeUserId?: string): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: { email, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
      select: { id: true },
    });

    if (existing) {
      throw AppException.conflict(
        'EMAIL_ALREADY_USED',
        'Cette adresse e-mail est deja utilisee par un autre compte.',
      );
    }
  }

  /**
   * Traduit une violation d'unicite d'adresse en refus explique.
   *
   * La verification faite avant l'ecriture ne suffit pas : entre le `findFirst`
   * et l'`INSERT`, une autre requete peut creer le meme compte. La contrainte
   * d'unicite de PostgreSQL, elle, ne laisse rien passer — et fait remonter un
   * `P2002` que le filtre d'exceptions traduirait en `CONFLICT` generique.
   *
   * Le conflit est donc rattrape ici pour rendre le code que le frontend sait
   * afficher (`EMAIL_ALREADY_USED`), le meme que celui de la verification
   * preventive. Sans cela, la meme situation — adresse deja prise — produirait
   * deux codes differents selon qu'une autre requete s'est glissee ou non, et le
   * frontend en afficherait un message flou une fois sur mille.
   */
  private async withEmailConflict<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2002')) {
        throw AppException.conflict(
          'EMAIL_ALREADY_USED',
          'Cette adresse e-mail est deja utilisee par un autre compte.',
        );
      }
      throw error;
    }
  }

  /**
   * Transaction SERIALISABLE, pour les operations qui comptent les
   * administrateurs actifs puis ecrivent.
   *
   * En lecture commitee — le defaut de PostgreSQL — deux requetes simultanees
   * qui retirent ADMIN a deux administrateurs differents lisent toutes les deux
   * « il en reste deux » et aboutissent toutes les deux. L'agence se retrouve
   * sans administrateur, exactement ce que la regle doit empecher. Serializable
   * fait echouer l'une des deux.
   *
   * `P2034` est traduit en 409 plutot que laisse remonter : le filtre
   * d'exceptions rangerait sinon ce conflit d'ecriture parmi les erreurs
   * d'infrastructure (503), alors que la requete est parfaitement valide — il
   * faut simplement la rejouer.
   */
  private async serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2034')) {
        throw AppException.conflict(
          'CONCURRENT_MODIFICATION',
          'Une autre modification de ce compte est en cours. Reessayez.',
        );
      }
      throw error;
    }
  }
}

// -----------------------------------------------------------------------------
// Fonctions pures
// -----------------------------------------------------------------------------

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Retire les doublons d'une liste de roles : `create` sur un doublon echoue. */
function uniqueCodes(codes: readonly RoleCode[]): RoleCode[] {
  return [...new Set(codes)];
}

/**
 * Reconnait une erreur Prisma par son code, sans importer la classe.
 *
 * Meme raison que dans `AllExceptionsFilter` : le nom de la classe d'erreur
 * depend de la version du client genere, la forme du code non. Si la
 * reconnaissance echouait un jour, le seul effet serait un 503 au lieu d'un 409
 * — jamais un passage silencieux.
 */
function isPrismaErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}

/**
 * Les faits d'un profil qui meritent une trace. Jamais l'empreinte.
 *
 * `clientId` en fait partie, et pas seulement par exhaustivite : sans lui, un
 * `PATCH` qui ne change QUE le rattachement ecrirait une ligne `USER_UPDATED`
 * dont le `before` et le `after` seraient IDENTIQUES. Une piste d'audit qui
 * annonce une modification en montrant deux etats egaux est pire qu'une absence
 * de ligne : elle fait douter de toutes les autres.
 */
function profileFacts(row: UserRow): Record<string, unknown> {
  return {
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    clientId: row.clientId,
  };
}

/** Les codes de role d'une ligne de compte. */
function roleCodesOf(row: UserRow): string[] {
  return row.roles.map((userRole) => userRole.role.code);
}

/**
 * Le compte vise, ou un 404.
 *
 * `deletedAt: null` est dans la requete, pas dans un test apres coup : il
 * n'existe alors aucun chemin ou l'oubli est possible, et un compte supprime est
 * introuvable pour toutes les operations a la fois.
 */
async function requireUserIn(
  db: Prisma.TransactionClient | PrismaService,
  id: string,
): Promise<UserRow> {
  const row = await db.user.findFirst({ where: { id, deletedAt: null }, select: USER_SELECT });

  if (!row) {
    throw AppException.notFound('USER_NOT_FOUND', 'Ce compte est introuvable.');
  }

  return row;
}

/** Nombre de comptes ACTIFS portant le role ADMIN. */
function activeAdministratorCount(
  db: Prisma.TransactionClient | PrismaService,
): Promise<number> {
  return db.user.count({
    where: {
      deletedAt: null,
      status: UserStatus.ACTIVE,
      roles: { some: { role: { code: RoleCode.ADMIN } } },
    },
  });
}

/** Ferme toutes les sessions ouvertes d'un compte. Rend le nombre ferme. */
async function revokeSessions(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  const { count } = await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return count;
}

/**
 * Applique la regle du dernier administrateur a une operation qui RETIRE l'acces
 * sans toucher aux roles (suspension, suppression).
 */
async function assertAdministratorCanLoseAccess(
  tx: Prisma.TransactionClient,
  target: UserRow,
): Promise<void> {
  assertNotLastActiveAdministrator(
    target.status === UserStatus.ACTIVE && hasRole(target, RoleCode.ADMIN),
    await activeAdministratorCount(tx),
    "Ce compte est le dernier administrateur actif : lui retirer l'acces laisserait l'agence " +
      'sans personne pour gerer les comptes.',
  );
}

function hasRole(row: UserRow, role: RoleCode): boolean {
  return row.roles.some((userRole) => userRole.role.code === role);
}
