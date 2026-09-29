import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AccessPolicy } from '../../common/auth/principal.js';
import { paginated, resolvePagination } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Paginated } from '../../common/interceptors/transform.interceptor.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ConversationType, ParticipantRole, UserStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  unreadCountsFromGroups,
  unreadMessagesWhere,
  type UnreadTarget,
} from './conversation-access.js';
import { participationWhere } from './conversation-access.js';
import type {
  AddParticipantDto,
  CreateConversationDto,
  ListConversationsQueryDto,
  UpdateConversationDto,
} from './dto/messaging.dto.js';

/**
 * CONVERSATIONS — creation, lecture, participants.
 *
 * DEUX NIVEAUX D'AUTORISATION, ET ILS NE DISENT PAS LA MEME CHOSE.
 *
 *  1. Le garde de route (`@RequirePermissions`) verifie que le porteur detient
 *     le CODE de permission. Il autorise la ROUTE.
 *  2. `AccessPolicy.requireScope` ci-dessous verifie QUELLE PART des donnees est
 *     accessible, et le `where` Prisma en decoule. Une route ouverte a
 *     `conversation:read:own` ne dit encore rien des conversations a renvoyer.
 *
 * Le troisieme niveau, celui que ce fichier ne relache jamais, est la
 * participation : elle vit DANS le `where` (voir `participationWhere`), pas dans
 * un `if` apres chargement.
 */

/**
 * Ce que l'on selectionne pour construire une conversation cote API.
 *
 * Une constante plutot que cinq `select` recopies : les listes, la fiche et le
 * retour de creation doivent exposer exactement les memes champs, sinon le
 * frontend recoit un objet dont la forme change selon la route appelee.
 */
const CONVERSATION_SELECT = {
  id: true,
  type: true,
  subject: true,
  projectId: true,
  clientId: true,
  createdById: true,
  lastMessageAt: true,
  lastMessagePreview: true,
  isArchived: true,
  createdAt: true,
  updatedAt: true,
  participants: {
    select: {
      userId: true,
      role: true,
      isMuted: true,
      lastReadAt: true,
      joinedAt: true,
      leftAt: true,
      user: { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: { joinedAt: 'asc' },
  },
} satisfies Prisma.ConversationSelect;

type ConversationRow = Prisma.ConversationGetPayload<{ select: typeof CONVERSATION_SELECT }>;

export interface ConversationParticipantView {
  readonly userId: string;
  readonly role: ParticipantRole;
  readonly isMuted: boolean;
  readonly lastReadAt: Date | null;
  readonly joinedAt: Date;
  readonly leftAt: Date | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
}

export interface ConversationView {
  readonly id: string;
  readonly type: ConversationType;
  readonly subject: string | null;
  readonly projectId: string | null;
  readonly clientId: string | null;
  readonly createdById: string | null;
  readonly lastMessageAt: Date | null;
  readonly lastMessagePreview: string | null;
  readonly isArchived: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Messages non lus pour le PORTEUR. Zero s'il n'est pas participant. */
  readonly unreadCount: number;
  readonly participants: ConversationParticipantView[];
}

@Injectable()
export class ConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------

  /**
   * Les conversations dont le porteur est PARTICIPANT, et seulement celles-la.
   *
   * Le filtre est dans le `where`. Il n'existe aucun chemin ou la liste serait
   * chargee puis filtree : le `if` apres coup, c'est precisement ce que
   * l'exigence du client interdit.
   */
  async list(
    policy: AccessPolicy,
    query: ListConversationsQueryDto,
  ): Promise<Paginated<ConversationView>> {
    policy.requireScope('conversation', 'read', ['own']);

    const p = resolvePagination(query);
    const where: Prisma.ConversationWhereInput = {
      ...participationWhere(policy.userId),
      ...(query.includeArchived === true ? {} : { isArchived: false }),
    };

    // Les deux requetes dans une seule transaction : sans instantane commun,
    // une conversation creee entre le comptage et la lecture ferait diverger
    // `total` et `items`, et le frontend afficherait une page vide a la fin.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        // `nulls: 'last'` : en PostgreSQL, un tri decroissant place les NULL en
        // TETE. Les conversations sans message passeraient donc avant celles ou
        // l'on vient d'ecrire, ce qui est exactement l'inverse de ce qu'on veut
        // montrer.
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
        select: CONVERSATION_SELECT,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    const unread = await this.unreadCountsFor(
      policy.userId,
      rows.map((row) => ({
        conversationId: row.id,
        // `?? null` : le filtre de participation garantit que le porteur est
        // participant, donc `myLastReadAt` ne devrait pas etre `undefined` ici.
        // Le repli transforme une incoherence impossible en « tout est non lu »
        // plutot qu'en erreur de typage a contourner plus tard.
        lastReadAt: this.myLastReadAt(row, policy.userId) ?? null,
      })),
    );

    const items = rows.map((row) => this.toView(row, unread.get(row.id) ?? 0));

    return paginated(items, total, p);
  }

  /** Une conversation precise, si le porteur en est participant. */
  async get(policy: AccessPolicy, conversationId: string): Promise<ConversationView> {
    policy.requireScope('conversation', 'read', ['own']);

    const row = await this.findAccessible(policy, conversationId);
    const mine = this.myLastReadAt(row, policy.userId);
    const unread = await this.unreadCountsFor(policy.userId, [
      { conversationId: row.id, lastReadAt: mine ?? null },
    ]);

    return this.toView(row, unread.get(row.id) ?? 0);
  }

  // ---------------------------------------------------------------------------
  // Ecriture
  // ---------------------------------------------------------------------------

  /**
   * Cree une conversation et ses participants DANS UNE SEULE TRANSACTION.
   *
   * Une conversation sans participant est un objet que rien dans le modele
   * n'interdit mais que personne ne peut lire : elle serait invisible pour tout
   * le monde, y compris pour son auteur. Verifier les utilisateurs dans la meme
   * transaction que la creation evite en plus la fenetre ou un compte est
   * supprime entre le controle et l'insertion.
   */
  async create(policy: AccessPolicy, dto: CreateConversationDto): Promise<ConversationView> {
    policy.requireScope('conversation', 'create', ['own']);

    const requested = [...new Set(dto.participantIds ?? [])];
    // L'auteur est TOUJOURS participant. Sans cette ligne, un appel sans
    // `participantIds` produirait une conversation que personne — pas meme son
    // createur — ne pourrait ouvrir.
    const participantIds = [...new Set([policy.userId, ...requested])];

    if (participantIds.length === 0) {
      throw AppException.unprocessable(
        'CONVERSATION_WITHOUT_PARTICIPANT',
        'Une conversation doit avoir au moins un participant.',
      );
    }

    const clientId = this.resolveClientId(policy, dto.clientId);

    const created = await this.prisma.$transaction(async (tx) => {
      const users = await tx.user.findMany({
        where: { id: { in: participantIds }, deletedAt: null, status: UserStatus.ACTIVE },
        select: { id: true },
      });

      if (users.length !== participantIds.length) {
        // Le detail des identifiants fautifs n'est PAS renvoye : il dirait a un
        // appelant quels comptes existent. Le message suffit a corriger une
        // saisie ; l'enumeration des comptes n'est pas un service a rendre.
        throw AppException.unprocessable(
          'CONVERSATION_PARTICIPANT_UNKNOWN',
          "Un ou plusieurs participants n'existent pas ou ne sont plus actifs.",
        );
      }

      if (dto.projectId) {
        const project = await tx.project.findFirst({
          where: { id: dto.projectId, deletedAt: null },
          select: { id: true, clientId: true },
        });

        if (!project) {
          throw AppException.notFound('PROJECT_NOT_FOUND', 'Projet introuvable.');
        }

        // Raccrocher une conversation client au projet d'un AUTRE client est
        // exactement le detournement que l'exigence vise. La verification est
        // ici, dans la transaction, pas dans l'interface.
        if (clientId && project.clientId !== clientId) {
          throw AppException.forbidden(
            "Ce projet n'appartient pas au dossier client de cette conversation.",
          );
        }
      }

      if (clientId) {
        const client = await tx.client.findFirst({
          where: { id: clientId, deletedAt: null },
          select: { id: true },
        });

        if (!client) {
          throw AppException.notFound('CLIENT_NOT_FOUND', 'Dossier client introuvable.');
        }
      }

      return tx.conversation.create({
        data: {
          type: dto.type ?? ConversationType.DIRECT,
          subject: dto.subject ?? null,
          projectId: dto.projectId ?? null,
          clientId,
          createdById: policy.userId,
          participants: {
            create: participantIds.map((userId) => ({
              userId,
              // L'auteur est OWNER : c'est la seule distinction de role que le
              // schema porte, et elle doit dire quelque chose.
              role: userId === policy.userId ? ParticipantRole.OWNER : ParticipantRole.MEMBER,
            })),
          },
        },
        select: CONVERSATION_SELECT,
      });
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'CONVERSATION_CREATED',
      entityType: 'Conversation',
      entityId: created.id,
      after: { type: created.type, participantCount: participantIds.length },
    });

    return this.toView(created, 0);
  }

  async update(
    policy: AccessPolicy,
    conversationId: string,
    dto: UpdateConversationDto,
  ): Promise<ConversationView> {
    policy.requireScope('conversation', 'manage', ['any']);

    const data: Prisma.ConversationUpdateManyMutationInput = {};
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.isArchived !== undefined) data.isArchived = dto.isArchived;

    if (Object.keys(data).length === 0) {
      // Un PATCH vide qui repondrait 200 laisserait croire qu'il a change
      // quelque chose. Dire « rien a modifier » est plus utile qu'un succes
      // mensonger.
      throw AppException.unprocessable('CONVERSATION_NOTHING_TO_UPDATE', 'Aucun champ a modifier.');
    }

    const { count } = await this.prisma.conversation.updateMany({
      where: { id: conversationId, deletedAt: null },
      data,
    });

    if (count === 0) {
      throw AppException.notFound('CONVERSATION_NOT_FOUND', 'Conversation introuvable.');
    }

    await this.audit.record({
      actorId: policy.userId,
      action: 'CONVERSATION_UPDATED',
      entityType: 'Conversation',
      entityId: conversationId,
      after: { ...data },
    });

    return this.findForManager(policy, conversationId);
  }

  /**
   * Ajoute un participant.
   *
   * `upsert` et non `create` : une ligne peut deja exister avec `leftAt`
   * renseigne — la personne a quitte, on la reinscrit. Un `create` echouerait
   * sur l'unicite `(conversationId, userId)`, et un `delete` suivi d'un `create`
   * effacerait sa date de lecture sans raison.
   */
  async addParticipant(
    policy: AccessPolicy,
    conversationId: string,
    dto: AddParticipantDto,
  ): Promise<ConversationView> {
    policy.requireScope('conversation', 'manage', ['any']);

    await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.findFirst({
        where: { id: conversationId, deletedAt: null },
        select: { id: true },
      });

      if (!conversation) {
        throw AppException.notFound('CONVERSATION_NOT_FOUND', 'Conversation introuvable.');
      }

      const user = await tx.user.findFirst({
        where: { id: dto.userId, deletedAt: null, status: UserStatus.ACTIVE },
        select: { id: true },
      });

      if (!user) {
        throw AppException.unprocessable(
          'CONVERSATION_PARTICIPANT_UNKNOWN',
          "Cet utilisateur n'existe pas ou n'est plus actif.",
        );
      }

      await tx.conversationParticipant.upsert({
        where: { conversationId_userId: { conversationId, userId: dto.userId } },
        create: {
          conversationId,
          userId: dto.userId,
          role: dto.role ?? ParticipantRole.MEMBER,
        },
        update: { leftAt: null, role: dto.role ?? ParticipantRole.MEMBER },
      });
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'CONVERSATION_PARTICIPANT_ADDED',
      entityType: 'Conversation',
      entityId: conversationId,
      after: { userId: dto.userId, role: dto.role ?? ParticipantRole.MEMBER },
    });

    return this.findForManager(policy, conversationId);
  }

  /**
   * Retire un participant.
   *
   * On ne SUPPRIME pas la ligne : on la marque sortie (`leftAt`). Les messages
   * de cette personne gardent leur auteur — `Message.senderId` pointe `User`,
   * pas la ligne de participation — et une reinscription ulterieure retrouve la
   * meme ligne plutot que d'en creer une seconde.
   */
  async removeParticipant(
    policy: AccessPolicy,
    conversationId: string,
    userId: string,
  ): Promise<ConversationView> {
    policy.requireScope('conversation', 'manage', ['any']);

    const { count } = await this.prisma.conversationParticipant.updateMany({
      where: {
        conversationId,
        userId,
        leftAt: null,
        conversation: { deletedAt: null },
      },
      data: { leftAt: new Date() },
    });

    if (count === 0) {
      throw AppException.notFound(
        'CONVERSATION_PARTICIPANT_NOT_FOUND',
        'Ce participant est introuvable dans cette conversation.',
      );
    }

    await this.audit.record({
      actorId: policy.userId,
      action: 'CONVERSATION_PARTICIPANT_REMOVED',
      entityType: 'Conversation',
      entityId: conversationId,
      after: { userId },
    });

    return this.findForManager(policy, conversationId);
  }

  // ---------------------------------------------------------------------------
  // Interne
  // ---------------------------------------------------------------------------

  /**
   * La conversation, si et seulement si le porteur y participe encore.
   *
   * 404 et non 403 : un 403 confirmerait que la conversation EXISTE. Avec un
   * identifiant devine, il suffirait alors a sonder l'existence des
   * conversations de l'agence une par une.
   */
  private async findAccessible(
    policy: AccessPolicy,
    conversationId: string,
  ): Promise<ConversationRow> {
    const row = await this.prisma.conversation.findFirst({
      where: { id: conversationId, ...participationWhere(policy.userId) },
      select: CONVERSATION_SELECT,
    });

    if (!row) {
      throw AppException.notFound('CONVERSATION_NOT_FOUND', 'Conversation introuvable.');
    }

    return row;
  }

  /**
   * La conversation, sans exiger la participation.
   *
   * Reserve aux routes `conversation:manage:any` : un responsable qui n'est pas
   * participant doit pouvoir gerer une conversation d'equipe. Le controle de
   * participation reste fait ailleurs pour tout ce qui touche au CONTENU.
   */
  private async findForManager(
    policy: AccessPolicy,
    conversationId: string,
  ): Promise<ConversationView> {
    const row = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: CONVERSATION_SELECT,
    });

    if (!row) {
      throw AppException.notFound('CONVERSATION_NOT_FOUND', 'Conversation introuvable.');
    }

    const mine = this.myLastReadAt(row, policy.userId);

    if (mine === undefined) {
      // Le gestionnaire n'est pas participant : il n'a rien a lire ici. Compter
      // « tous les messages depuis l'epoque » afficherait un compteur de non-lus
      // sur une conversation qui n'est pas la sienne.
      return this.toView(row, 0);
    }

    const unread = await this.unreadCountsFor(policy.userId, [
      { conversationId: row.id, lastReadAt: mine },
    ]);

    return this.toView(row, unread.get(row.id) ?? 0);
  }

  /** `lastReadAt` du porteur, ou `undefined` s'il n'est pas participant actif. */
  private myLastReadAt(row: ConversationRow, userId: string): Date | null | undefined {
    const mine = row.participants.find(
      (participant) => participant.userId === userId && participant.leftAt === null,
    );

    return mine ? mine.lastReadAt : undefined;
  }

  /**
   * Compte les non-lus d'une PAGE de conversations en une requete.
   *
   * `groupBy` avec une condition par conversation : chacune compare le
   * `createdAt` de SES messages a SON `lastReadAt`. Un comptage par conversation
   * ferait cent requetes pour afficher une liste de cent lignes.
   */
  private async unreadCountsFor(
    userId: string,
    targets: readonly UnreadTarget[],
  ): Promise<ReadonlyMap<string, number>> {
    const where = unreadMessagesWhere(userId, targets);

    if (!where) {
      return new Map<string, number>();
    }

    const groups = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where,
      _count: { _all: true },
    });

    return unreadCountsFromGroups(groups);
  }

  /**
   * L'identifiant de client a retenir pour la conversation.
   *
   * UN COMPTE CLIENT NE CHOISIT PAS SON DOSSIER. Sans cette regle, un porteur de
   * l'espace client pourrait envoyer `clientId` d'un autre dossier et rattacher
   * sa conversation a des donnees qui ne sont pas les siennes — le detournement
   * exact que l'exigence du client interdit. Le dossier est donc FORCE a celui
   * du porteur, et une valeur differente est un refus, pas un silence.
   */
  private resolveClientId(policy: AccessPolicy, requested?: string): string | null {
    if (!policy.clientId) {
      return requested ?? null;
    }

    if (requested !== undefined && requested !== policy.clientId) {
      throw AppException.forbidden(
        "Un compte client ne peut rattacher une conversation qu'a son propre dossier.",
      );
    }

    return policy.clientId;
  }

  private toView(row: ConversationRow, unreadCount: number): ConversationView {
    return {
      id: row.id,
      type: row.type,
      subject: row.subject,
      projectId: row.projectId,
      clientId: row.clientId,
      createdById: row.createdById,
      lastMessageAt: row.lastMessageAt,
      lastMessagePreview: row.lastMessagePreview,
      isArchived: row.isArchived,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      unreadCount,
      participants: row.participants.map((participant) => ({
        userId: participant.userId,
        role: participant.role,
        isMuted: participant.isMuted,
        lastReadAt: participant.lastReadAt,
        joinedAt: participant.joinedAt,
        leftAt: participant.leftAt,
        firstName: participant.user.firstName,
        lastName: participant.user.lastName,
        email: participant.user.email,
      })),
    };
  }
}
