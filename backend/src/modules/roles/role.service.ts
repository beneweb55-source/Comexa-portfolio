import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AccessPolicy, SCOPE_ANY, type AuthenticatedUser } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { RoleCode } from '../../generated/prisma/enums.js';
import type { SessionMeta } from '../auth/session.js';
import { assertRoleIsMutable, isKnownRoleCode, unknownCodes } from '../users/identity-rules.js';
import type { ReplaceRolePermissionsDto } from './dto/role.dto.js';
import {
  PERMISSION_SELECT,
  presentPermission,
  presentRoleDetail,
  presentRoles,
  ROLE_DETAIL_SELECT,
  ROLE_SELECT,
  type PermissionView,
  type RoleDetailView,
  type RoleView,
} from './role.presenter.js';

/**
 * ROLES ET CATALOGUE DE PERMISSIONS.
 *
 * DEUX RESSOURCES, UN SEUL SERVICE, ET C'EST VOULU.
 *
 * Les permissions ne se modifient pas : elles viennent du catalogue, posees par
 * le seed, et l'API ne les expose qu'en LECTURE. La seule ecriture possible
 * consiste a dire quels codes un role detient — c'est-a-dire a ecrire dans
 * `role_permissions`, une table qui appartient aux roles. Un
 * `PermissionController` monte sur un `PermissionService` distinct n'aurait donc
 * aucun comportement propre : il rendrait la lecture du catalogue, et c'est tout.
 * Le service des roles le fait deja, avec le meme besoin d'autorisation.
 *
 * CE QUI N'EST PAS ICI : la creation d'un role. Le code d'un role est une VALEUR
 * D'ENUMERATION (`RoleCode`), present dans le schema Prisma, lu par les
 * decorateurs et par `AccessPolicy`. Un role invente a chaud n'aurait pas de
 * valeur dans cet enum et ne pourrait donc jamais etre attribue sans redeployer.
 * En creer un par l'API donnerait l'illusion d'une possibilite qui s'arrete au
 * premier redemarrage. Le sujet est signale dans le rapport final, pas contourne
 * ici.
 */
@Injectable()
export class RoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------

  /**
   * Les sept roles, avec le nombre de permissions de chacun.
   *
   * Pas de pagination : sept lignes. Paginer ici obligerait le frontend a
   * enchainer les pages pour construire une liste deroulante, alors que la
   * totalite tient dans une reponse.
   */
  async list(actor: AuthenticatedUser): Promise<RoleView[]> {
    new AccessPolicy(actor).requireScope('role', 'read', [SCOPE_ANY]);

    const rows = await this.prisma.role.findMany({
      select: ROLE_SELECT,
      // ADMIN en tete : c'est le role qu'on verifie en premier quand on se
      // demande qui peut faire quoi. Les autres suivent par libelle.
      orderBy: [{ code: 'asc' }],
    });

    return presentRoles(rows);
  }

  /**
   * Un role et ses permissions.
   *
   * Le code est d'abord confronte a l'enumeration. Sans ce controle, `GET
   * /roles/NIMPORTEQUOI` partirait tel quel dans la requete Prisma, qui refuserait
   * une valeur hors enum — et le filtre d'exceptions en ferait un 503, en
   * rangeant une simple faute de frappe du cote des pannes d'infrastructure. Le
   * role « inexistant » se repond 404, comme n'importe quelle ressource absente.
   */
  async getByCode(code: string, actor: AuthenticatedUser): Promise<RoleDetailView> {
    new AccessPolicy(actor).requireScope('role', 'read', [SCOPE_ANY]);

    const roleCode = requireKnownRoleCode(code);

    const row = await this.prisma.role.findUnique({
      where: { code: roleCode },
      select: ROLE_DETAIL_SELECT,
    });

    if (!row) {
      // Le code est valide mais le seed n'a pas tourne : l'erreur est reelle et
      // merite un message distinct dans les journaux, meme si la reponse est la
      // meme pour l'appelant.
      throw AppException.notFound('ROLE_NOT_FOUND', 'Ce role est introuvable.');
    }

    return presentRoleDetail(row);
  }

  /**
   * Le catalogue TEL QU'IL EST EN BASE.
   *
   * Et non la constante `PERMISSION_CATALOGUE`. Les deux doivent coincider — le
   * seed les aligne — mais elles ne le font pas au meme moment : une permission
   * ajoutee au code n'existe en base qu'apres le seed, et une permission retiree
   * du code y survit jusqu'au prochain nettoyage. Servir la constante donnerait
   * une liste que la base ne sait pas honorer : un administrateur cocherait un
   * droit, `PATCH /roles/:code/permissions` le refuserait, et rien n'expliquerait
   * la contradiction. La base est la seule source qui ne peut pas mentir sur ce
   * qu'elle accepte.
   */
  async listPermissions(actor: AuthenticatedUser): Promise<PermissionView[]> {
    new AccessPolicy(actor).requireScope('permission', 'read', [SCOPE_ANY]);

    const rows = await this.prisma.permission.findMany({
      select: PERMISSION_SELECT,
      orderBy: [{ resource: 'asc' }, { action: 'asc' }, { scope: 'asc' }],
    });

    return rows.map(presentPermission);
  }

  // ---------------------------------------------------------------------------
  // Ecriture
  // ---------------------------------------------------------------------------

  /**
   * Remplace l'ensemble des permissions d'un role.
   *
   * REMPLACER, et non ajouter ou retirer. Une API qui n'offrirait que `POST` et
   * `DELETE` obligerait le frontend a calculer un differentiel, puis a l'envoyer
   * en deux requetes qui peuvent echouer independamment — laissant le role dans
   * un etat intermediaire que personne n'a voulu. Un ensemble remplace se decide
   * a un instant precis, sur un ecran ou l'administrateur voit exactement ce
   * qu'il valide.
   *
   * TROIS REFUS, DANS CET ORDRE :
   *
   *  1. Le role ADMIN n'est pas modifiable. Ses permissions viennent du
   *     catalogue, ou sa valeur est `'ALL'` et non une liste ; le seed les
   *     developpe en base. Les modifier ici les restreindrait jusqu'au prochain
   *     seed, qui les retablirait sans prevenir — et entre les deux, un
   *     administrateur ne pourrait plus administrer.
   *
   *  2. Tout code absent de la table des permissions est refuse, et les codes
   *     fautifs sont NOMMES dans les details. Un refus global laisserait
   *     l'administrateur deviner lequel de ses trente codes pose probleme.
   *
   *  3. Le remplacement est transactionnel. Un `deleteMany` suivi d'un
   *     `createMany` non transactionnel laisserait, si le second echoue, un role
   *     VIDE — c'est-a-dire tous ses porteurs prives de droits d'un coup, sans
   *     trace de ce qu'ils avaient. C'est precisement l'accident que la
   *     transaction rend impossible.
   */
  async replacePermissions(
    code: string,
    dto: ReplaceRolePermissionsDto,
    actor: AuthenticatedUser,
    meta: SessionMeta,
  ): Promise<RoleDetailView> {
    new AccessPolicy(actor).requireScope('role', 'manage', [SCOPE_ANY]);

    const roleCode = requireKnownRoleCode(code);

    assertRoleIsMutable(roleCode);

    // Dedoublonne AVANT d'interroger : la cle primaire de `role_permissions`
    // porte sur le couple (role, permission), donc un code envoye deux fois
    // ferait echouer le `createMany` sur une violation d'unicite — un 409
    // incomprehensible pour une liste qui ne contient, vue de l'ecran, aucun
    // doublon.
    const requested = [...new Set(dto.permissionCodes)];

    const before = await this.requireRoleState(roleCode);

    const result = await this.prisma.$transaction(async (tx) => {
      const known = await tx.permission.findMany({
        where: { code: { in: requested } },
        select: { id: true, code: true },
      });

      assertPermissionsKnown(requested, known.map((permission) => permission.code));

      await tx.rolePermission.deleteMany({ where: { roleId: before.id } });

      if (known.length > 0) {
        await tx.rolePermission.createMany({
          data: known.map((permission) => ({
            roleId: before.id,
            permissionId: permission.id,
          })),
        });
      }

      const after = await tx.role.findUniqueOrThrow({
        where: { code: roleCode },
        select: ROLE_DETAIL_SELECT,
      });

      return presentRoleDetail(after);
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'ROLE_PERMISSIONS_REPLACED',
      entityType: 'Role',
      entityId: roleCode,
      // `entityId` porte le CODE du role, pas son cuid : c'est ce que
      // l'administration affiche, et c'est ce qui rend une ligne de journal
      // comprehensible sans jointure.
      before: { permissions: before.permissionCodes },
      after: { permissions: result.permissions.map((permission) => permission.code) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Outils internes
  // ---------------------------------------------------------------------------

  /**
   * L'identifiant interne et les codes de permission actuels d'un role.
   *
   * `id` sert a ecrire, `permissionCodes` sert a journaliser AVANT : sans lui, le
   * `before` d'une ligne d'audit serait vide et l'on ne pourrait plus repondre a
   * « qu'a-t-on retire, et a qui ? » — la seule question qui se pose vraiment
   * quand on relit un changement de droits.
   */
  private async requireRoleState(
    code: RoleCode,
  ): Promise<{ id: string; permissionCodes: string[] }> {
    const row = await this.prisma.role.findUnique({
      where: { code },
      select: {
        id: true,
        permissions: { select: { permission: { select: { code: true } } } },
      },
    });

    if (!row) {
      throw AppException.notFound('ROLE_NOT_FOUND', 'Ce role est introuvable.');
    }

    return {
      id: row.id,
      permissionCodes: row.permissions.map((link) => link.permission.code).sort(),
    };
  }
}

/**
 * Valide le code recu dans l'URL et le RETRECIT au type de l'enumeration.
 *
 * La fonction fait deux choses, et la seconde n'est pas cosmetique. Le parametre
 * d'une route arrive toujours en `string` ; Prisma, lui, attend un `RoleCode`.
 * Ecrire `where: { code }` sans retrecissement ne compile pas — et si on le
 * forcait, PostgreSQL refuserait une valeur hors enumeration a l'execution, ce
 * qui produirait un 503 rangeant une faute de frappe du cote des pannes.
 *
 * Le retrecissement est rendu EXPLICITE par le type de retour plutot que laisse
 * au `is` du garde : une variable de type `string` perd son retrecissement des
 * qu'elle est lue depuis une fonction imbriquee (la transaction, ici), parce que
 * TypeScript ne peut pas garantir qu'elle n'a pas ete reassignee entre-temps.
 * Une valeur de retour, elle, garde son type partout.
 */
function requireKnownRoleCode(code: string): RoleCode {
  if (!isKnownRoleCode(code)) {
    throw AppException.notFound('ROLE_NOT_FOUND', 'Ce role est introuvable.');
  }

  return code;
}

/**
 * Refuse des codes de permission absents de la table.
 *
 * Le pendant de `assertRolesKnown` pour les permissions, mais ecrit ici : la
 * fonction de `identity-rules.ts` est typee sur `RoleCode`, et les codes de
 * permission sont des chaines libres — ils ne sont pas une enumeration. Le
 * message differe aussi, et c'est ce qui compte pour l'administrateur : savoir
 * s'il s'est trompe de role ou de droit.
 */
function assertPermissionsKnown(requested: readonly string[], known: readonly string[]): void {
  const unknown = unknownCodes(requested, known);

  if (unknown.length === 0) {
    return;
  }

  throw AppException.unprocessable(
    'UNKNOWN_PERMISSION',
    `Permission(s) inconnue(s) : ${unknown.join(', ')}.`,
    { permissions: unknown },
  );
}
