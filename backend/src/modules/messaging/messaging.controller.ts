import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import type { Paginated } from '../../common/interceptors/transform.interceptor.js';
import { ConversationService, type ConversationView } from './conversation.service.js';
import {
  AddParticipantDto,
  CreateConversationDto,
  ListConversationsQueryDto,
  MessageListQueryDto,
  SendMessageDto,
  UpdateConversationDto,
} from './dto/messaging.dto.js';
import { MessageService, type MessagePageView, type MessageRow } from './message.service.js';

/**
 * ROUTES DE MESSAGERIE.
 *
 * TROIS METIERS, TROIS REGLES, ET ELLES NE SE CONFONDENT PAS.
 *
 *  - `conversation:read:own` / `conversation:create:own` : les conversations ou
 *    le porteur participe, et seulement celles-la.
 *  - `conversation:manage:any` : la gestion des conversations d'equipe — sujet,
 *    archivage, participants. RESERVE AUX ROLES INTERNES.
 *  - `message:read:own` / `message:write:own` : le contenu d'un fil, donc la
 *    participation, verifiee en base a chaque appel.
 *
 * AUCUNE ROUTE N'ACCEPTE D'IDENTIFIANT DE PORTEUR. `userId` n'apparait nulle
 * part dans un DTO : il vient du jeton, lu par le garde, attache a la requete,
 * et transforme ici en `AccessPolicy`. C'est la reponse directe a l'exigence du
 * client — il n'existe aucun champ ou glisser l'identifiant d'un autre.
 *
 * Le controleur ne fait que cela : lire le porteur, lire le DTO valide, appeler
 * le service. Aucune decision d'acces n'est prise ici — les gardes autorisent la
 * ROUTE, les services restreignent les DONNEES.
 */
@ApiTags('Messagerie')
@Controller('conversations')
export class MessagingController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly messages: MessageService,
  ) {}

  @Get()
  @RequirePermissions('conversation:read:own')
  @ApiOperation({ summary: 'Lister les conversations du porteur' })
  listConversations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListConversationsQueryDto,
  ): Promise<Paginated<ConversationView>> {
    return this.conversations.list(new AccessPolicy(user), query);
  }

  @Post()
  @RequirePermissions('conversation:create:own')
  @ApiOperation({ summary: 'Creer une conversation' })
  createConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateConversationDto,
  ): Promise<ConversationView> {
    return this.conversations.create(new AccessPolicy(user), dto);
  }

  @Get(':id')
  @RequirePermissions('conversation:read:own')
  @ApiOperation({ summary: 'Lire une conversation dont on est participant' })
  getConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ConversationView> {
    return this.conversations.get(new AccessPolicy(user), id);
  }

  /**
   * `conversation:manage:any` et non un scope `own` : ce code n'existe pas au
   * catalogue. Consequence assumee et signalee — un participant qui n'est pas
   * responsable ne peut pas renommer ni archiver SA propre conversation.
   */
  @Patch(':id')
  @RequirePermissions('conversation:manage:any')
  @ApiOperation({ summary: 'Modifier le sujet ou archiver une conversation' })
  updateConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
  ): Promise<ConversationView> {
    return this.conversations.update(new AccessPolicy(user), id, dto);
  }

  @Post(':id/participants')
  @RequirePermissions('conversation:manage:any')
  @ApiOperation({ summary: 'Ajouter un participant' })
  addParticipant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddParticipantDto,
  ): Promise<ConversationView> {
    return this.conversations.addParticipant(new AccessPolicy(user), id, dto);
  }

  @Delete(':id/participants/:userId')
  @RequirePermissions('conversation:manage:any')
  @ApiOperation({ summary: 'Retirer un participant' })
  removeParticipant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<ConversationView> {
    return this.conversations.removeParticipant(new AccessPolicy(user), id, userId);
  }

  @Get(':id/messages')
  @RequirePermissions('message:read:own')
  @ApiOperation({ summary: 'Lire les messages, pagines par curseur' })
  listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: MessageListQueryDto,
  ): Promise<MessagePageView> {
    return this.messages.list(new AccessPolicy(user), id, query);
  }

  @Post(':id/messages')
  @RequirePermissions('message:write:own')
  @ApiOperation({ summary: 'Ecrire un message (persiste en base, puis diffuse)' })
  sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ): Promise<MessageRow> {
    return this.messages.send(new AccessPolicy(user), id, dto);
  }

  /**
   * `@HttpCode(200)` : un POST qui ne cree rien mais met a jour un etat de
   * lecture. Le 201 par defaut de Nest ferait croire a la creation d'une
   * ressource, et le frontend pourrait la chercher dans `data`.
   */
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('message:read:own')
  @ApiOperation({ summary: 'Marquer la conversation comme lue' })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ conversationId: string; lastReadAt: Date }> {
    return this.messages.markRead(new AccessPolicy(user), id);
  }
}
