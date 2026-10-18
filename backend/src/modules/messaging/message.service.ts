import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditService } from '../../common/audit/audit.service.js';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import { resolvePagination } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { MessageType } from '../../generated/prisma/enums.js';
import { NotificationService } from '../notifications/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  beforeCursorWhere,
  buildMessagePage,
  decodeMessageCursor,
  notificationRecipients,
  participationWhere,
  previewOf,
} from './conversation-access.js';
import type { MessageListQueryDto, SendMessageDto } from './dto/messaging.dto.js';
import { MESSAGE_CREATED, type MessageCreatedEvent } from './messaging.events.js';
import {
  normalizeSharedResourceRefs,
  sharedResourcesPreview,
  type ResourceCardView,
} from './shared-resource-card.js';
import { SharedResourcesService } from './shared-resources.service.js';

/**
 * MESSAGES — ecriture, lecture, etat de lecture.
 *
 * LA BASE EST LA SOURCE DE VERITE. Le temps reel n'est qu'un raccourci : le
 * message est ecrit et committe AVANT que quoi que ce soit soit diffuse. Un
 * client deconnecte retrouve tout par `GET /conversations/:id/messages`. Si les
 * deux devaient diverger, c'est la diffusion qui est perdue, jamais l'ecriture.
 *
 * LE CONTENU VIENT DE LA REQUETE HTTP, JAMAIS DU SOCKET. Un evenement recu par
 * la passerelle ne transporte que des identifiants, et ces identifiants sont
 * revalides en base. Ecrire un message depuis un evenement socket ouvrirait un
 * chemin ou le corps echappe au DTO — donc a `forbidNonWhitelisted`, donc a
 * toute validation de longueur.
 */

const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderId: true,
  type: true,
  body: true,
  replyToId: true,
  editedAt: true,
  createdAt: true,
  deletedAt: true,
  deliveryStatus: true,
  sender: { select: { id: true, firstName: true, lastName: true, email: true } },
  attachments: {
    select: {
      documentId: true,
      document: { select: { name: true, mimeType: true, sizeBytes: true, visibility: true } },
    },
  },
  // LE COUPLE (type, id) ET RIEN D'AUTRE. Les colonnes `previewTitle` /
  // `previewText` restent en base pour l'audit et la recherche : elles ne
  // sortent JAMAIS par l'API. Un participant sans droit sur le projet partage
  // doit voir une carte muette, pas le titre que l'emetteur, lui, avait le
  // droit de lire — c'est la mise en oeuvre littérale de « le partage ne
  // contourne pas les permissions », et elle ne depend pas d'un `if` oublie
  // quelque part : le `select` ne transporte simplement pas la colonne.
  sharedResources: {
    select: { id: true, resourceType: true, resourceId: true, createdAt: true },
  },
} satisfies Prisma.MessageSelect;

/** La ligne de message telle que l'API l'expose (auteur et pieces jointes inclus). */
export type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

/** Ce que renvoie une page de messages : `items` + un `meta` de curseur. */
export interface MessagePageView {
  readonly items: MessageRow[];
  readonly meta: {
    readonly perPage: number;
    readonly hasMore: boolean;
    readonly nextCursor: string | null;
  };
}

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
    private readonly sharedResources: SharedResourcesService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------

  /**
   * Les messages d'une conversation, du plus recent au plus ancien.
   *
   * PAGINATION PAR CURSEUR, PAS PAR `skip`. Trois raisons, dans l'ordre
   * d'importance :
   *
   *  1. Un fil de discussion grandit par le BAS de la liste affichee (le plus
   *     recent en tete). Avec `skip`, l'arrivee d'un message pendant que
   *     l'utilisateur lit la page 2 decale tout d'un rang : il revoit un message
   *     deja lu et, surtout, n'en voit jamais un. Le curseur pointe une LIGNE,
   *     pas un rang, donc rien ne glisse.
   *  2. `OFFSET` oblige PostgreSQL a parcourir et jeter les lignes sautees. Sur
   *     une table qui ne fait que grossir, la page 500 coute 500 pages.
   *  3. Le curseur est un couple (`createdAt`, `id`), pas une date seule : deux
   *     messages peuvent partager la meme milliseconde, et une date seule les
   *     sauterait ou les redonnerait sans fin.
   *
   * Le prix : `meta` ne porte pas de `total` ni de `totalPages`. Un flux de
   * messagerie n'a pas de « page 7 sur 42 » a afficher, et compter la table
   * entiere a chaque ouverture serait payer cher pour un nombre que personne
   * ne lit.
   */
  async list(
    policy: AccessPolicy,
    conversationId: string,
    query: MessageListQueryDto,
  ): Promise<MessagePageView> {
    policy.requireScope('message', 'read', ['own']);

    await this.assertParticipant(policy, conversationId);

    const cursor = query.cursor === undefined ? null : decodeMessageCursor(query.cursor);

    if (query.cursor !== undefined && cursor === null) {
      throw AppException.badRequest(
        'MESSAGE_CURSOR_INVALID',
        'Le curseur de pagination est illisible.',
      );
    }

    const p = resolvePagination({ perPage: query.perPage });

    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
        // Le filtre de participation est REJOUE ici, dans la meme requete. La
        // verification ci-dessus decide du statut HTTP ; celle-ci garantit
        // qu'aucune reorganisation du code ne peut faire sortir des messages
        // d'une conversation etrangere.
        conversation: participationWhere(policy.userId),
        ...(cursor ? beforeCursorWhere(cursor) : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // Une ligne de plus que demande : sa presence repond a « y a-t-il une
      // suite » sans requete de comptage.
      take: p.take + 1,
      select: MESSAGE_SELECT,
    });

    const page = buildMessagePage(rows, p.take);

    return {
      items: page.items,
      meta: { perPage: p.perPage, hasMore: page.hasMore, nextCursor: page.nextCursor },
    };
  }

  // ---------------------------------------------------------------------------
  // Ecriture
  // ---------------------------------------------------------------------------

  /**
   * Ecrit un message, met a jour la conversation, puis notifie les autres.
   *
   * L'ORDRE N'EST PAS NEGOCIABLE. La transaction (message + apercu + etat de
   * lecture) est validee AVANT la moindre notification ou diffusion. Notifier
   * d'abord annoncerait un message qu'un echec d'ecriture ferait disparaitre —
   * et un destinataire qui ouvre une conversation pour rien cesse de croire aux
   * notifications.
   *
   * LES RESSOURCES PARTAGEES SONT VALIDEES AVANT ECRIRE. Chaque couple
   * (type, id) est relu dans le PERIMETRE DE L'EMETTEUR : on ne peut partager
   * que ce qu'on peut lire, et un partage partiel — trois cartes sur quatre
   * acceptees — serait pire qu'un refus : l'emetteur croirait avoir tout montre.
   * Le refus est un 422 unique, le message entier reste a ecrire.
   */
  async send(
    policy: AccessPolicy,
    conversationId: string,
    dto: SendMessageDto,
    user: AuthenticatedUser,
  ): Promise<MessageRow> {
    policy.requireScope('message', 'write', ['own']);

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, ...participationWhere(policy.userId) },
      select: {
        id: true,
        participants: { select: { userId: true, leftAt: true } },
      },
    });

    if (!conversation) {
      throw AppException.notFound('CONVERSATION_NOT_FOUND', 'Conversation introuvable.');
    }

    const body = dto.body;
    const uniqueAttachments = [...new Set(dto.attachmentIds ?? [])];

    const normalizedRefs = normalizeSharedResourceRefs(dto.sharedResources);
    if (normalizedRefs.rejected > 0) {
      throw AppException.unprocessable(
        'MESSAGE_RESOURCE_UNSUPPORTED',
        "Une ressource partagee est d'un type inconnu ou sans identifiant.",
      );
    }
    if (body.trim().length === 0 && normalizedRefs.refs.length === 0) {
      throw AppException.unprocessable(
        'MESSAGE_EMPTY',
        'Un message porte un texte, une ressource partagee, ou les deux.',
      );
    }

    let resourceCards: readonly ResourceCardView[] = [];
    if (normalizedRefs.refs.length > 0) {
      resourceCards = await this.sharedResources.resolveAll(user, normalizedRefs.refs);
      if (resourceCards.some((card) => !card.available)) {
        // Un seul mot pour « n'existe plus » et « hors de votre perimetre » :
        // la distinction confirmerait l'existence de lignes que le porteur ne
        // doit pas pouvoir enumerer.
        throw AppException.unprocessable(
          'MESSAGE_RESOURCE_UNAVAILABLE',
          "Une ressource a partager est introuvable ou hors de votre perimetre d'acces.",
        );
      }
    }
    const sharedPreviewText =
      resourceCards.length > 0 ? previewOf(sharedResourcesPreview(resourceCards)) : '';

    const message = await this.prisma.$transaction(async (tx) => {
      if (dto.replyToId) {
        // La cible doit etre dans LA MEME conversation : sans ce controle, une
        // reponse pointerait un message d'une conversation a laquelle le porteur
        // n'a peut-etre pas acces, et le fil divulguerait un extrait de l'autre.
        const parent = await tx.message.findFirst({
          where: { id: dto.replyToId, conversationId, deletedAt: null },
          select: { id: true },
        });

        if (!parent) {
          throw AppException.unprocessable(
            'MESSAGE_REPLY_TARGET_NOT_FOUND',
            "Le message auquel vous repondez n'est pas dans cette conversation.",
          );
        }
      }

      if (uniqueAttachments.length > 0) {
        const documents = await tx.document.findMany({
          where: { id: { in: uniqueAttachments }, deletedAt: null },
          select: { id: true },
        });

        if (documents.length !== uniqueAttachments.length) {
          throw AppException.unprocessable(
            'MESSAGE_ATTACHMENT_UNKNOWN',
            'Une ou plusieurs pieces jointes sont introuvables.',
          );
        }
      }

      const created = await tx.message.create({
        data: {
          conversationId,
          // Jamais `dto.senderId` : il n'existe pas. L'auteur est le PORTEUR.
          senderId: policy.userId,
          type: dto.type ?? MessageType.TEXT,
          body,
          replyToId: dto.replyToId ?? null,
          attachments: {
            create: uniqueAttachments.map((documentId) => ({ documentId })),
          },
          // Le snapshot (titre, statut au moment du partage) est ecrit pour
          // l'audit et pour une future recherche « ou ce projet a-t-il ete
          // cite ? ». Il n'est lu par AUCUNE route : la carte affiche toujours
          // l'etat courant resolu pour le lecteur.
          sharedResources: {
            create: resourceCards.map((card) => ({
              resourceType: card.resourceType,
              resourceId: card.resourceId,
              previewTitle: card.title,
              previewText: card.statusKey,
              sharedById: policy.userId,
            })),
          },
        },
        select: MESSAGE_SELECT,
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: created.createdAt,
          // Corps vide + ressources : l'apercu de la liste devient le resume du
          // partage (« 📎 Refonte du site — Projet »), pas une ligne vide.
          lastMessagePreview: previewOf(body) || sharedPreviewText,
        },
      });

      // L'auteur a evidemment lu son propre message. Sans cette mise a jour, son
      // compteur de non-lus augmenterait a chaque message qu'il vient d'ecrire.
      await tx.conversationParticipant.updateMany({
        where: { conversationId, userId: policy.userId },
        data: { lastReadAt: created.createdAt },
      });

      return created;
    });

    const recipients = notificationRecipients(conversation.participants, policy.userId);

    if (recipients.length > 0) {
      // Hors transaction, volontairement : une notification est un effet de
      // bord. La faire echouer avec la transaction annulerait un message valide
      // parce qu'une ligne de notification n'est pas passee.
      await this.notifications.notifyMany(recipients, {
        type: 'MESSAGE_RECEIVED',
        title: 'Nouveau message',
        // La notification ne porte QUE le resume texte. Ni le type de
        // ressource, ni le titre partage : une notification est lue sur
        // l'ecran verrouille d'un tier, parfois par un autre membre du groupe
        // sans droit sur la ligne. La carte, elle, se relit dans la
        // conversation.
        body: previewOf(body) || 'a partagé une ressource',
        link: `/espace/messages/${conversationId}`,
        entityType: 'Conversation',
        entityId: conversationId,
      });
    }

    this.publish({ conversationId, message });

    await this.audit.record({
      actorId: policy.userId,
      action: 'MESSAGE_SENT',
      entityType: 'Message',
      entityId: message.id,
      after: {
        conversationId,
        attachmentCount: uniqueAttachments.length,
        sharedResourceCount: resourceCards.length,
      },
    });

    return message;
  }

  /**
   * Marque la conversation comme lue pour le porteur.
   *
   * `updateMany` conditionne a `userId` ET a `leftAt: null` : la contrainte
   * d'appartenance est dans la requete, pas dans un test apres lecture. Un
   * porteur ne peut donc pas marquer comme lue la conversation d'un autre, meme
   * en connaissant son identifiant — la ligne concernee n'est simplement pas
   * dans le `where`.
   *
   * On enregistre l'instant du marquage, pas la date du dernier message : l'ecart
   * entre les deux est de l'ordre de la milliseconde, et relire le dernier
   * message pour le trouver couterait une requete de plus sur le chemin le plus
   * frequent de l'interface.
   */
  async markRead(
    policy: AccessPolicy,
    conversationId: string,
  ): Promise<{ conversationId: string; lastReadAt: Date }> {
    policy.requireScope('message', 'read', ['own']);

    const lastReadAt = new Date();

    const { count } = await this.prisma.conversationParticipant.updateMany({
      where: {
        conversationId,
        userId: policy.userId,
        leftAt: null,
        conversation: { deletedAt: null },
      },
      data: { lastReadAt },
    });

    if (count === 0) {
      throw AppException.notFound('CONVERSATION_NOT_FOUND', 'Conversation introuvable.');
    }

    return { conversationId, lastReadAt };
  }

  // ---------------------------------------------------------------------------
  // Interne
  // ---------------------------------------------------------------------------

  /** Refuse un non-participant — sans jamais lui dire que la conversation existe. */
  private async assertParticipant(policy: AccessPolicy, conversationId: string): Promise<void> {
    const participant = await this.prisma.conversation.findFirst({
      where: { id: conversationId, ...participationWhere(policy.userId) },
      select: { id: true },
    });

    if (!participant) {
      throw AppException.notFound('CONVERSATION_NOT_FOUND', 'Conversation introuvable.');
    }
  }

  /**
   * Diffuse le message sur le bus interne.
   *
   * Une erreur d'emission ne remonte PAS : le message est en base, il sera lu a
   * la prochaine ouverture. Transformer une ecriture reussie en echec HTTP parce
   * qu'un abonne a leve reviendrait a perdre un message ecrit pour un probleme
   * de diffusion.
   */
  private publish(event: MessageCreatedEvent): void {
    try {
      this.events.emit(MESSAGE_CREATED, event);
    } catch (error) {
      this.logger.warn(
        `Message ${event.message.id} ecrit mais non diffuse en temps reel : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
