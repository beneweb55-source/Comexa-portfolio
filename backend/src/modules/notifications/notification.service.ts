import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Notification, Prisma } from '../../generated/prisma/client.js';
import type { NotificationType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * NOTIFICATIONS — ecrites par presque tous les modules, lues par un seul.
 *
 * Meme raison d'etre que `ActivityService` : cinq domaines produisent des
 * notifications. Centraliser l'ecriture garantit que le type, le libelle et le
 * lien profond sont construits de la meme facon partout.
 *
 * Le service EMET un evenement (`notification.created`) au lieu d'appeler
 * directement la passerelle WebSocket. C'est ce qui permet a la messagerie
 * temps reel d'exister sans que la facturation ait a connaitre socket.io : la
 * facturation ecrit une notification, la passerelle l'ecoute. Le jour ou le
 * temps reel change de transport, aucun module metier ne bouge.
 */

/** Evenement emis apres l'ecriture d'une notification. */
export const NOTIFICATION_CREATED = 'notification.created';

export interface NotificationCreatedEvent {
  notification: Notification;
}

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  /** Lien profond resolu cote frontend (`/espace/projets/abc`). */
  link?: string | null;
  /** Type de l'entite visee, pour recalculer le lien si la route change. */
  entityType?: string | null;
  entityId?: string | null;
}

/** Client Prisma ou transaction en cours. */
type NotificationDb = Prisma.TransactionClient | PrismaService;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Notifie un utilisateur.
   *
   * `tx` en second parametre : une notification qui annonce une operation doit
   * disparaitre avec elle si la transaction est annulee. Ecrite hors
   * transaction, elle annoncerait un paiement qui n'a jamais ete enregistre.
   *
   * L'echec d'emission temps reel ne fait PAS echouer l'ecriture : la
   * notification est en base, elle sera vue a la prochaine lecture. Faire
   * remonter une erreur de socket jusqu'a la transaction annulerait un paiement
   * valide parce qu'un navigateur s'est deconnecte.
   */
  async notify(
    userId: string,
    input: NotificationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Notification> {
    const db: NotificationDb = tx ?? this.prisma;

    const notification = await db.notification.create({
      data: {
        userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      },
    });

    this.publish(notification);
    return notification;
  }

  /**
   * Notifie plusieurs utilisateurs.
   *
   * `createMany` puis relecture, plutot qu'un `create` par destinataire : une
   * affectation d'equipe produit un seul aller-retour. `createMany` ne renvoie
   * pas les lignes creees, d'ou la relecture — necessaire pour publier des
   * notifications completes sur le canal temps reel.
   */
  async notifyMany(
    userIds: readonly string[],
    input: NotificationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Notification[]> {
    // Dedoublonnage : notifier deux fois la meme personne pour le meme fait est
    // un bogue d'affichage, pas une insistance utile.
    const unique = [...new Set(userIds)];

    if (unique.length === 0) {
      return [];
    }

    const rows = {
      userId: { in: unique },
      type: input.type,
      title: input.title,
      entityId: input.entityId ?? null,
      readAt: null,
    };

    const insert = (db: NotificationDb) =>
      db.notification.createMany({
        data: unique.map((userId) => ({
          userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          link: input.link ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
        })),
      });

    // `createMany` ne renvoie pas les lignes creees : il faut relire pour
    // publier des notifications completes sur le canal temps reel.
    //
    // La relecture doit voir les lignes qu'on vient d'inserer, donc elle doit
    // etre dans la MEME transaction que l'insertion — d'ou les deux chemins.
    // On ne peut pas ouvrir une transaction imbriquee quand l'appelant en a
    // deja une : `Prisma.TransactionClient` est le client prive de
    // `$transaction`, c'est la garantie que donne le typage. Dans ce cas la
    // relecture sur `tx` voit naturellement l'insertion, puisqu'elle partage la
    // transaction environnante.
    let created: Notification[];

    if (tx) {
      await insert(tx);
      created = await tx.notification.findMany({
        where: rows,
        orderBy: { createdAt: 'desc' },
        take: unique.length,
      });
    } else {
      created = await this.prisma.$transaction(async (inner) => {
        await insert(inner);
        return inner.notification.findMany({
          where: rows,
          orderBy: { createdAt: 'desc' },
          take: unique.length,
        });
      });
    }

    for (const notification of created) {
      this.publish(notification);
    }

    return created;
  }

  /**
   * Publie sur le bus d'evenements, sans jamais laisser une erreur remonter.
   *
   * Un abonne qui leve (passerelle non initialisee, client deconnecte) ne doit
   * pas transformer une ecriture reussie en echec HTTP.
   */
  private publish(notification: Notification): void {
    try {
      this.events.emit(NOTIFICATION_CREATED, { notification } satisfies NotificationCreatedEvent);
    } catch (error) {
      this.logger.warn(
        `Notification ${notification.id} ecrite mais non diffusee en temps reel : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
