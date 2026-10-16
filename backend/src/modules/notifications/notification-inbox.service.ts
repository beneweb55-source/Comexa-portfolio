import { Injectable } from '@nestjs/common';
import { AccessPolicy } from '../../common/auth/principal.js';
import { paginated, resolvePagination } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Paginated } from '../../common/interceptors/transform.interceptor.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { NotificationType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ListNotificationsQueryDto } from './dto/notification.dto.js';
import {
  NOTIFICATION_TYPES_BY_SPACE,
  SPACE_IDS,
  spaceOfNotificationType,
  type SpaceId,
} from '../../common/spaces/space-policy.js';

/** Non lues par espace, pour les pastilles du sélecteur d'espace. */
export interface NotificationSummary {
  readonly unread: number;
  readonly unreadBySpace: Readonly<Record<SpaceId, number>>;
}

/**
 * Filtre d'ESPACE : la cloche et ses compteurs ne mélangent jamais deux
 * espaces. Sans espace annoncé, toute la boîte (comportement historique).
 */
function spaceWhere(policy: AccessPolicy): Prisma.NotificationWhereInput {
  const space = policy.space;
  if (!space) return {};
  return { type: { in: [...NOTIFICATION_TYPES_BY_SPACE[space]] as NotificationType[] } };
}

/**
 * BOITE DE NOTIFICATIONS — la LECTURE.
 *
 * `NotificationService` (fichier voisin, et non modifie) est l'ECRITURE : cinq
 * modules l'appellent pour deposer une notification. Ce fichier-ci est l'autre
 * moitie — lister, marquer lu, supprimer — et il vit separe pour une raison
 * simple : la lecture obeit a des regles de portee que l'ecriture ne connait
 * pas. Un module de facturation qui notifie un client n'a pas a savoir qui a le
 * droit de relire la boite.
 *
 * LA SEULE REGLE QUI COMPTE ICI : `userId` VIENT DU PORTEUR.
 *
 * Il est dans le `where` de CHAQUE requete de ce fichier, y compris les
 * `updateMany` et les `deleteMany`. Ce n'est pas une precaution decorative :
 * c'est ce qui rend ces operations incapables de toucher la ligne d'un autre.
 * Il n'y a pas de « charger puis verifier » — la ligne d'autrui ne sort pas de
 * la base, et une mise a jour qui ne trouve rien ne trouve rien.
 *
 * Consequence recherchee : un identifiant de notification devine ne permet ni
 * de la marquer lue, ni de la supprimer, ni meme d'apprendre qu'elle existe. Le
 * 404 est identique dans les deux cas.
 */

/** La notification telle que l'API l'expose. */
export interface NotificationView {
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string | null;
  readonly link: string | null;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

/**
 * `userId` est volontairement ABSENT de la projection.
 *
 * Ce n'est pas une economie de quelques octets : c'est une valeur que le client
 * n'a aucun usage et qu'il n'a aucune raison de renvoyer un jour. Ne pas
 * l'exposer supprime la tentation de la faire voyager.
 */
const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  link: true,
  entityType: true,
  entityId: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

@Injectable()
export class NotificationInboxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * La boite du porteur, de la plus recente a la plus ancienne.
   *
   * `read` est un filtre a trois etats : `true` (lues), `false` (non lues),
   * omis (les deux). Le traduire en `readAt` est le role de ce fichier — le DTO
   * parle le langage du client, la base le sien.
   */
  async list(
    policy: AccessPolicy,
    query: ListNotificationsQueryDto,
  ): Promise<Paginated<NotificationView>> {
    policy.requireScope('notification', 'read', ['own']);

    const p = resolvePagination(query);
    const where: Prisma.NotificationWhereInput = {
      userId: policy.userId,
      ...spaceWhere(policy),
      ...(query.read === undefined ? {} : { readAt: query.read ? { not: null } : null }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        select: NOTIFICATION_SELECT,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return paginated([...rows], total, p);
  }

  /**
   * Marque une notification comme lue. IDEMPOTENT.
   *
   * Le `where` porte `readAt: null` : un second appel ne reecrit donc pas la
   * date. Mais il ne doit pas non plus echouer — un client qui recharge son
   * ecran et remarquait le meme evenement obtiendrait sinon un 404 pour une
   * operation deja faite. D'ou le repli : zero ligne modifiee, puis on cherche
   * la ligne PARMI LES SIENNES. Trouvee, l'operation est un succes ; pas
   * trouvee, la notification n'est pas au porteur, et c'est un 404.
   */
  async markRead(policy: AccessPolicy, notificationId: string): Promise<NotificationView> {
    policy.requireScope('notification', 'read', ['own']);

    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId: policy.userId, readAt: null },
      data: { readAt: new Date() },
    });

    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId: policy.userId },
      select: NOTIFICATION_SELECT,
    });

    if (!notification) {
      throw AppException.notFound('NOTIFICATION_NOT_FOUND', 'Notification introuvable.');
    }

    return notification;
  }

  /**
   * Marque TOUTE la boite comme lue.
   *
   * `userId` dans le `where`, donc les non-lues d'autrui ne sont pas touchees.
   * On ne renvoie que le nombre modifie : renvoyer les lignes demanderait de les
   * relire, et le client affiche de toute facon un compteur a zero.
   */
  async markAllRead(policy: AccessPolicy): Promise<{ updated: number }> {
    policy.requireScope('notification', 'read', ['own']);

    // Dans un espace, « tout marquer comme lu » ne touche que CET espace : un
    // membre ne doit pas perdre en silence les alertes d'un autre espace.
    const { count } = await this.prisma.notification.updateMany({
      where: { userId: policy.userId, readAt: null, ...spaceWhere(policy) },
      data: { readAt: new Date() },
    });

    return { updated: count };
  }

  /**
   * Non lues du porteur, réparties par espace (lecture seule, hors espace).
   *
   * Sert aux pastilles du sélecteur : « 3 dans l'espace équipe » s'affiche à
   * côté de l'espace concerné, sans jamais additionner deux espaces dans un même
   * compteur.
   */
  async summary(policy: AccessPolicy): Promise<NotificationSummary> {
    policy.requireScope('notification', 'read', ['own']);

    const groups = await this.prisma.notification.groupBy({
      by: ['type'],
      where: { userId: policy.userId, readAt: null },
      _count: { _all: true },
    });

    const unreadBySpace = Object.fromEntries(SPACE_IDS.map((space) => [space, 0])) as Record<
      SpaceId,
      number
    >;
    let unread = 0;
    for (const group of groups) {
      const count = group._count._all;
      unread += count;
      unreadBySpace[spaceOfNotificationType(group.type)] += count;
    }
    return { unread, unreadBySpace };
  }

  /**
   * Supprime une notification du porteur.
   *
   * `deleteMany` et non `delete` : `delete` exigerait un identifiant unique et
   * SUPPRIMERAIT la ligne sans regarder a qui elle appartient — exactement le
   * detournement que l'exigence du client vise. Ici, la condition d'appartenance
   * est dans la requete.
   */
  async remove(policy: AccessPolicy, notificationId: string): Promise<{ deleted: true }> {
    policy.requireScope('notification', 'manage', ['own']);

    const { count } = await this.prisma.notification.deleteMany({
      where: { id: notificationId, userId: policy.userId },
    });

    if (count === 0) {
      throw AppException.notFound('NOTIFICATION_NOT_FOUND', 'Notification introuvable.');
    }

    return { deleted: true };
  }
}
