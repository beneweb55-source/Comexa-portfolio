import { Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import {
  ACCESS_TOKEN_VERIFIER,
  PRINCIPAL_LOADER,
  type AccessTokenVerifier,
  type PrincipalLoader,
} from '../../common/guards/access.guards.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  NOTIFICATION_CREATED,
  type NotificationCreatedEvent,
} from '../notifications/notification.service.js';
import { MESSAGE_CREATED, type MessageCreatedEvent } from './messaging.events.js';
import {
  MAX_CONVERSATION_ROOMS,
  REALTIME_NAMESPACE,
  extractHandshakeToken,
  readConversationIdFromPayload,
  readTypingFlag,
  roomForConversation,
  roomForUser,
  socketCorsOrigins,
} from './realtime.auth.js';

/**
 * PASSERELLE TEMPS REEL — namespace `/rt`.
 *
 * ELLE EST LA SEULE PORTE QUE LES GARDES GLOBAUX NE FERMENT PAS.
 *
 * `JwtAuthGuard.canActivate` commence par :
 *
 *     if (context.getType() !== 'http') { return true; }
 *
 * `PermissionsGuard` fait de meme. Un contexte WebSocket traverse donc la chaine
 * sans qu'aucun des deux ne regarde quoi que ce soit. Ce n'est pas un oubli —
 * le jeton d'un WebSocket n'arrive pas dans une requete HTTP — mais cela veut
 * dire que TOUT ce qui protege cette passerelle est ecrit ici, et nulle part
 * ailleurs. Si cette verification disparait, il ne reste rien : un socket
 * anonyme rejoint la room d'une conversation et lit la messagerie de l'agence.
 *
 * TROIS REGLES, ET AUCUNE N'EST FACULTATIVE.
 *
 *  1. LE JETON EST VERIFIE, PUIS LE PORTEUR EST RECHARGE EN BASE. La signature
 *     prouve qu'un jeton vient de nous ; `PRINCIPAL_LOADER` etablit que le compte
 *     est encore actif et ce qu'il a le droit de faire. Sans le second, un compte
 *     suspendu garderait un acces temps reel jusqu'a l'expiration de son jeton.
 *  2. UNE CONNEXION SANS JETON VALIDE EST FERMEE. Pas de session anonyme, pas de
 *     mode degrade : le temps reel ne sert qu'a des porteurs identifies.
 *  3. UN `conversationId` VENU DU CLIENT NE VAUT RIEN TANT QU'IL N'A PAS ETE
 *     CONFRONTE A LA BASE. Rejoindre une room sur parole donnerait a n'importe
 *     quel compte la messagerie de toute conversation dont il devine
 *     l'identifiant — un cuid reste court.
 *
 * OU ELLE EST DECLAREE, ET POURQUOI. Son provider est declare dans
 * `NotificationModule`, pas ici : ce module est deja monte dans `app.module.ts`,
 * donc la passerelle est vivante des le demarrage sans qu'aucun fichier interdit
 * ne soit touche. UNE SEULE INSTANCE DOIT EXISTER — deux passerelles sur le meme
 * namespace ouvriraient deux serveurs socket.io concurrents. Ne l'ajoutez donc
 * PAS aux `providers` de `MessagingModule`.
 */

/** Contrat des evenements client -> serveur. */
export interface ClientToServerEvents {
  'conversation:join': (payload: unknown) => void;
  typing: (payload: unknown) => void;
}

/** Contrat des evenements serveur -> client. */
export interface ServerToClientEvents {
  notification: (event: NotificationCreatedEvent) => void;
  'message:new': (event: MessageCreatedEvent) => void;
  typing: (event: { conversationId: string; userId: string; isTyping: boolean }) => void;
  'rt:error': (event: { code: string; message: string }) => void;
}

export interface RealtimeAck {
  readonly joined: boolean;
}

@WebSocketGateway({
  namespace: REALTIME_NAMESPACE,
  // Meme origine que CORS cote HTTP : une liste vide vaut `false`, donc aucune
  // origine externe. Voir `socketCorsOrigins` — la valeur est figee au chargement
  // du module, donc lue dans l'environnement du PROCESSUS et pas dans le `.env`
  // charge plus tard par `ConfigModule`.
  cors: { origin: socketCorsOrigins(process.env.CORS_ORIGIN), credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
    @Inject(PRINCIPAL_LOADER) private readonly principals: PrincipalLoader,
  ) {}

  // ---------------------------------------------------------------------------
  // Poignee de main
  // ---------------------------------------------------------------------------

  /**
   * Aucune connexion n'est acceptee sans jeton valide.
   *
   * Le porteur est ensuite abonne a sa room personnelle et aux rooms des
   * conversations ou il participe REELLEMENT, lues en base. C'est ce qui permet
   * de diffuser un message a une conversation sans que l'emetteur ait a savoir
   * qui est connecte : seuls les participants verifies sont dans la room.
   */
  async handleConnection(client: Socket): Promise<void> {
    const token = extractHandshakeToken(client.handshake);

    if (!token) {
      this.refuse(client, 'UNAUTHENTICATED', 'Jeton absent.');
      return;
    }

    let user: AuthenticatedUser;

    try {
      const payload = await this.verifier.verifyAccessToken(token);
      user = await this.principals.load(payload.sub);
    } catch {
      // Un seul message pour trois causes (signature invalide, jeton expire,
      // compte suspendu ou supprime) : les distinguer n'apprendrait rien
      // d'utile au client, qui doit simplement se reconnecter.
      this.refuse(client, 'UNAUTHENTICATED', 'Jeton invalide ou compte inutilisable.');
      return;
    }

    if (user.mustChangePassword) {
      // Meme regle que cote HTTP : tant que le mot de passe initial n'est pas
      // change, tout est ferme sauf la sortie. Laisser le temps reel ouvert
      // serait une porte de service sur des donnees metier.
      this.refuse(
        client,
        'PASSWORD_CHANGE_REQUIRED',
        'Vous devez definir un nouveau mot de passe avant de continuer.',
      );
      return;
    }

    setSocketUserId(client, user.id);
    await client.join(roomForUser(user.id));

    const memberships = await this.prisma.conversationParticipant.findMany({
      where: { userId: user.id, leftAt: null, conversation: { deletedAt: null } },
      select: { conversationId: true },
      orderBy: { joinedAt: 'desc' },
      take: MAX_CONVERSATION_ROOMS,
    });

    if (memberships.length > 0) {
      await client.join(memberships.map((row) => roomForConversation(row.conversationId)));
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Socket temps reel ferme : ${client.id}`);
  }

  /**
   * Refuse une connexion, en le DISANT avant de fermer.
   *
   * `handleConnection` s'execute apres l'etablissement du namespace : le client
   * est donc en mesure de recevoir ce message. Sans lui, il ne verrait qu'une
   * deconnexion immediate, sans cause — et reconnecterait en boucle.
   */
  private refuse(client: Socket, code: string, message: string): void {
    client.emit('rt:error', { code, message });
    this.logger.warn(`Connexion temps reel refusee (${code}) : socket ${client.id}`);
    client.disconnect(true);
  }

  // ---------------------------------------------------------------------------
  // Diffusion (bus interne -> socket)
  // ---------------------------------------------------------------------------

  /**
   * Une notification vient d'etre ecrite : on la pousse a SON destinataire.
   *
   * C'est le cablage qui permet a la facturation de notifier sans connaitre
   * socket.io : elle appelle `NotificationService`, qui emet ; la passerelle
   * ecoute. La room est derivee du `userId` de la notification, jamais d'une
   * donnee fournie par un client.
   */
  @OnEvent(NOTIFICATION_CREATED)
  onNotificationCreated(event: NotificationCreatedEvent): void {
    if (!this.server) {
      return;
    }

    this.server.to(roomForUser(event.notification.userId)).emit('notification', event);
  }

  /**
   * Un message vient d'etre ecrit : on le pousse dans la room de sa conversation.
   *
   * Aucun controle de participation ici, et ce n'est pas un oubli : la room ne
   * contient que des sockets dont la participation a ete verifiee en base, a la
   * connexion ou sur `conversation:join`. Un non-participant ne peut pas s'y
   * trouver.
   */
  @OnEvent(MESSAGE_CREATED)
  onMessageCreated(event: MessageCreatedEvent): void {
    if (!this.server) {
      return;
    }

    this.server.to(roomForConversation(event.conversationId)).emit('message:new', event);
  }

  // ---------------------------------------------------------------------------
  // Evenements client -> serveur
  // ---------------------------------------------------------------------------

  /**
   * Rejoint la room d'une conversation APRES verification en base.
   *
   * Le client envoie un identifiant qu'il connait ; la passerelle ne lui fait
   * aucun credit et interroge la table de participation. Un refus porte le meme
   * code qu'une conversation inexistante : sinon, un identifiant devine
   * suffirait a apprendre quelles conversations existent.
   */
  @SubscribeMessage('conversation:join')
  async onConversationJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<RealtimeAck> {
    const userId = socketUserId(client);
    const conversationId = readConversationIdFromPayload(payload);

    if (!userId || !conversationId) {
      client.emit('rt:error', { code: 'BAD_REQUEST', message: 'Requete temps reel invalide.' });
      return { joined: false };
    }

    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
        conversation: { deletedAt: null },
      },
      select: { id: true },
    });

    if (!participant) {
      client.emit('rt:error', {
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation introuvable.',
      });
      return { joined: false };
    }

    await client.join(roomForConversation(conversationId));
    return { joined: true };
  }

  /**
   * Relaie un indicateur de frappe. RIEN N'EST PERSISTE.
   *
   * L'appartenance a la room sert de preuve de participation : elle n'a ete
   * accordee qu'apres verification en base. Rejouer la requete ici ferait
   * doublon sans rien ajouter, et un evenement de frappe n'a de toute facon
   * aucune valeur apres quelques secondes.
   */
  @SubscribeMessage('typing')
  onTyping(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown): void {
    const userId = socketUserId(client);
    const conversationId = readConversationIdFromPayload(payload);

    if (!userId || !conversationId) {
      return;
    }

    const room = roomForConversation(conversationId);

    if (!client.rooms.has(room)) {
      return;
    }

    client.to(room).emit('typing', {
      conversationId,
      userId,
      isTyping: readTypingFlag(payload),
    });
  }
}

/** Le porteur attache au socket, ou `null` s'il n'a pas ete authentifie. */
function socketUserId(client: Socket): string | null {
  const data = client.data as { userId?: unknown };

  return typeof data.userId === 'string' && data.userId.length > 0 ? data.userId : null;
}

function setSocketUserId(client: Socket, userId: string): void {
  (client.data as { userId?: string }).userId = userId;
}
