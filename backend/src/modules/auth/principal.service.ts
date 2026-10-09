import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '../../common/errors/app-error.js';
import type { PrincipalLoader } from '../../common/guards/access.guards.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RoleCode, UserStatus } from '../../generated/prisma/enums.js';

/**
 * Rechargement du porteur depuis la base, a chaque requete authentifiee.
 *
 * C'EST LE FICHIER QUI REND LA REVOCATION IMMEDIATE.
 *
 * Un access token signe reste mathematiquement valide jusqu'a son expiration.
 * Si l'on s'arretait a la signature, suspendre un collaborateur n'aurait aucun
 * effet pendant les quinze minutes suivantes, et lui retirer un role non plus.
 * C'est le genre de fenetre qu'on ne remarque pas en developpement et qui se
 * paie le jour ou l'on doit couper un acces en urgence.
 *
 * Donc : la signature etablit QUE le jeton vient de nous ; cette lecture
 * etablit CE QUE son porteur a encore le droit de faire, maintenant.
 *
 * Le cout est une requete SQL par appel authentifie. Elle est admissible parce
 * qu'elle est indexee par cle primaire et qu'elle ramene peu de lignes. Le jour
 * ou elle devient le point chaud, la reponse est un cache de quelques secondes
 * par identifiant — jamais de figer les droits dans le jeton, ce qui
 * reintroduirait exactement le probleme qu'on cherche a eviter.
 *
 * Les REFUS sont volontairement distincts :
 *  - jeton valide mais compte disparu -> 401, le jeton doit etre jete ;
 *  - compte suspendu, archive ou jamais active -> 403, le jeton etait bon, mais
 *    ce compte n'a plus acces. Le frontend affiche alors un message d'un autre
 *    ordre (« contactez un administrateur ») au lieu de renvoyer vers le
 *    formulaire de connexion, qui ne resoudrait rien.
 */
@Injectable()
export class PrincipalService implements PrincipalLoader {
  constructor(private readonly prisma: PrismaService) {}

  async load(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findFirst({
      // `deletedAt: null` : une suppression logique doit couper l'acces comme
      // une suppression physique. Sans ce filtre, un compte « supprime »
      // continuerait d'agir.
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        clientId: true,
        mustChangePassword: true,
        roles: {
          select: {
            role: {
              select: {
                code: true,
                permissions: {
                  select: { permission: { select: { code: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw AppException.unauthenticated(
        ErrorCode.TOKEN_INVALID,
        "Ce compte n'existe plus. Veuillez vous reconnecter.",
      );
    }

    this.assertUsable(user.status);

    const roles: RoleCode[] = [];
    const permissions = new Set<string>();

    for (const userRole of user.roles) {
      roles.push(userRole.role.code);
      for (const rolePermission of userRole.role.permissions) {
        permissions.add(rolePermission.permission.code);
      }
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles,
      permissions,
      clientId: user.clientId,
      mustChangePassword: user.mustChangePassword,
    };
  }

  /**
   * Refuse un statut qui ne permet pas d'agir.
   *
   * 403 et non 401 : le jeton est authentique et le compte existe. Ce qui
   * manque, c'est l'autorisation — et la nuance compte pour le frontend, qui ne
   * doit pas supprimer le jeton en cache sur un 403 (l'utilisateur retrouverait
   * un ecran de connexion a chaque rafraichissement, sans comprendre pourquoi).
   */
  private assertUsable(status: UserStatus): void {
    switch (status) {
      case UserStatus.ACTIVE:
        return;

      case UserStatus.SUSPENDED:
        throw new AppException(
          ErrorCode.ACCOUNT_SUSPENDED,
          'Ce compte est suspendu. Contactez un administrateur.',
          HttpStatus.FORBIDDEN,
        );

      case UserStatus.ARCHIVED:
        throw new AppException(
          ErrorCode.ACCOUNT_SUSPENDED,
          'Ce compte est archive. Contactez un administrateur.',
          HttpStatus.FORBIDDEN,
        );

      case UserStatus.INVITED:
        throw new AppException(
          ErrorCode.ACCOUNT_INVITED,
          "Ce compte n'a pas encore ete active. Utilisez le lien recu par e-mail.",
          HttpStatus.FORBIDDEN,
        );

      default: {
        // `switch` exhaustif : ajouter un statut a l'enum sans le traiter ici
        // fait echouer la compilation. On refuse par defaut plutot que de
        // laisser passer un statut qu'on n'a pas explicitement autorise.
        const unreachable: never = status;
        throw new AppException(
          ErrorCode.ACCOUNT_SUSPENDED,
          `Statut de compte non autorise : ${String(unreachable)}.`,
          HttpStatus.FORBIDDEN,
        );
      }
    }
  }
}
