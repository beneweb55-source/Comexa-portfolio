import { Injectable } from '@nestjs/common';
import { Prisma, UserStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppException } from '../errors/app-error.js';

/**
 * QUI PEUT RECEVOIR DE L'ARGENT — la règle d'éligibilité, écrite UNE fois.
 *
 * Une part de répartition, un versement, une avance : la cible est toujours
 * un MEMBRE DE L'ÉQUIPE. Ni un client, ni un compte technique, ni un compte
 * désactivé, ni un compte supprimé.
 *
 * Cette règle était appliquée aux bénéficiaires d'une règle de répartition,
 * mais pas à la cible d'une opération de solde : rien n'empêchait un
 * administrateur de verser une part à un client, et le solde du client se
 * créait. Deux listes, deux vocabulaires, un seul endroit pour la vérité.
 *
 * D'où ce service : il définit le filtre, il le donne à la lecture (les
 * listes de membres) et à l'écriture (la validation), pour que les deux ne
 * puissent pas diverger.
 */

/** Un membre éligible, tel qu'affiché dans un sélecteur. */
export interface EligibleMember {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  /** Codes des rôles portés (ADMIN, DEVELOPER, ...). */
  readonly roles: readonly string[];
}

/**
 * LE FILTRE. Actif, non supprimé, et porteur d'au moins un rôle qui n'est pas
 * CLIENT : un compte sans rôle est un compte technique, pas un collègue.
 */
const ELIGIBLE_MEMBER_FILTER: Prisma.UserWhereInput = {
  deletedAt: null,
  status: UserStatus.ACTIVE,
  roles: { some: { role: { code: { not: 'CLIENT' } } } },
};

const ELIGIBLE_MEMBER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  roles: { select: { role: { select: { code: true } } } },
} satisfies Prisma.UserSelect;

@Injectable()
export class EligibleMembersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tous les membres éligibles, triés par nom.
   */
  async list(): Promise<EligibleMember[]> {
    const users = await this.prisma.user.findMany({
      where: ELIGIBLE_MEMBER_FILTER,
      select: ELIGIBLE_MEMBER_SELECT,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
    });

    return users.map((user) => ({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      roles: user.roles.map((entry) => entry.role.code),
    }));
  }

  /**
   * Un membre éligible par identifiant, ou `null` s'il ne l'est pas.
   */
  async find(userId: string): Promise<EligibleMember | null> {
    const user = await this.prisma.user.findFirst({
      where: { AND: [{ id: userId }, ELIGIBLE_MEMBER_FILTER] },
      select: ELIGIBLE_MEMBER_SELECT,
    });

    if (!user) return null;

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      roles: user.roles.map((entry) => entry.role.code),
    };
  }

  /**
   * Les membres éligibles parmi une liste d'identifiants.
   */
  async findMany(userIds: readonly string[]): Promise<EligibleMember[]> {
    if (userIds.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: { AND: [{ id: { in: [...userIds] } }, ELIGIBLE_MEMBER_FILTER] },
      select: ELIGIBLE_MEMBER_SELECT,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
    });

    return users.map((user) => ({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      roles: user.roles.map((entry) => entry.role.code),
    }));
  }

  /**
   * Vérifie qu'un compte peut recevoir une opération financière.
   *
   * L'échec est explicite : le message dit ce qui ne va pas, parce que la
   * personne qui saisit un versement ne peut pas deviner la règle.
   */
  async assertEligible(userId: string): Promise<EligibleMember> {
    const member = await this.find(userId);

    if (!member) {
      throw AppException.badRequest(
        'INELIGIBLE_MEMBER',
        'Ce compte n’est pas un membre actif de l’équipe : vérifiez le compte choisi.',
      );
    }

    return member;
  }
}
