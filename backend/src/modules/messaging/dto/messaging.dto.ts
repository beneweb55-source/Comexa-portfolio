import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BooleanFilter } from '../../../common/dto/boolean-filter.js';
import {
  DEFAULT_PER_PAGE,
  MAX_PER_PAGE,
  PaginationQueryDto,
} from '../../../common/dto/pagination.dto.js';
import { ConversationType, MessageType, ParticipantRole } from '../../../generated/prisma/enums.js';

/**
 * Contrats d'ENTREE de la messagerie.
 *
 * `configureApp` active `forbidNonWhitelisted` : tout champ accepte doit etre
 * declare ici, et un champ inconnu fait ECHOUER la requete. C'est la premiere
 * barriere contre l'escalade par le corps de la requete — le client ne peut pas
 * glisser un `senderId`, un `clientId` ou un `lastReadAt` en esperant qu'un
 * service distrait le recopie. Ces valeurs sont toujours derivees du PORTEUR ou
 * de la base, jamais du corps.
 *
 * Les identifiants sont bornes en longueur (64) : un cuid en fait ~25. La borne
 * n'est pas de la securite, c'est un refus rapide d'une entree absurde, avant
 * d'atteindre la base.
 */

const ID_MAX_LENGTH = 64;

export class ListConversationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Inclure les conversations archivees (exclues par defaut).',
  })
  // `?includeArchived=false` incluait justement les archives : la conversion
  // implicite en booleen passe AVANT le `@Transform`, et `Boolean('false')` vaut
  // `true`. Le piege est documente une seule fois, dans `boolean-filter.ts`.
  @BooleanFilter({ message: "Le filtre d'archivage doit etre un booleen." })
  includeArchived?: boolean;
}

export class CreateConversationDto {
  @ApiPropertyOptional({ enum: ConversationType, default: ConversationType.DIRECT })
  @IsOptional()
  @IsEnum(ConversationType, { message: 'Type de conversation inconnu.' })
  type?: ConversationType;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Le sujet ne peut pas etre vide.' })
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({ description: 'Projet auquel rattacher la conversation.' })
  @IsOptional()
  @IsString()
  @MaxLength(ID_MAX_LENGTH)
  projectId?: string;

  @ApiPropertyOptional({
    description:
      "Dossier client a rattacher. Ignore et force a son propre dossier pour un compte client.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(ID_MAX_LENGTH)
  clientId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: "Participants a ajouter. L'auteur est toujours participant.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50, { message: 'Maximum 50 participants par conversation.' })
  @IsString({ each: true })
  @MaxLength(ID_MAX_LENGTH, { each: true })
  participantIds?: string[];
}

export class UpdateConversationDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Le sujet ne peut pas etre vide.' })
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({ type: Boolean })
  // Meme piege que le filtre de liste ci-dessus : un corps `"isArchived": "false"`
  // archivait la conversation au lieu de la desarchiver.
  @BooleanFilter({ message: "L'etat d'archivage doit etre un booleen." })
  isArchived?: boolean;
}

export class AddParticipantDto {
  @ApiProperty({ description: "Identifiant de l'utilisateur a ajouter." })
  @IsString()
  @MinLength(1)
  @MaxLength(ID_MAX_LENGTH)
  userId!: string;

  @ApiPropertyOptional({ enum: ParticipantRole, default: ParticipantRole.MEMBER })
  @IsOptional()
  @IsEnum(ParticipantRole, { message: 'Role de participant inconnu.' })
  role?: ParticipantRole;
}

export class SendMessageDto {
  @ApiProperty({ description: 'Contenu du message. Persiste en base.', maxLength: 10_000 })
  @IsString({ message: 'Le message est obligatoire.' })
  @MinLength(1, { message: 'Le message ne peut pas etre vide.' })
  @MaxLength(10_000)
  body!: string;

  @ApiPropertyOptional({ enum: MessageType, default: MessageType.TEXT })
  @IsOptional()
  @IsEnum(MessageType, { message: 'Type de message inconnu.' })
  type?: MessageType;

  @ApiPropertyOptional({ description: 'Message auquel celui-ci repond (meme conversation).' })
  @IsOptional()
  @IsString()
  @MaxLength(ID_MAX_LENGTH)
  replyToId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Identifiants de documents deja deposes, a joindre au message.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: 'Maximum 20 pieces jointes par message.' })
  @IsString({ each: true })
  @MaxLength(ID_MAX_LENGTH, { each: true })
  attachmentIds?: string[];
}

/**
 * Requete de lecture des messages.
 *
 * PAS D'HERITAGE DE `PaginationQueryDto`, ET C'EST DELIBERE. Il n'y a pas de
 * `page` ici : la pagination se fait par curseur (`meta.nextCursor`). Accepter
 * `page` en silence laisserait croire au frontend qu'il pagine correctement
 * alors que la valeur serait ignoree — et `forbidNonWhitelisted` transforme
 * justement cet oubli en erreur 400 immediate au lieu d'un bogue d'affichage
 * decouvert en production.
 */
export class MessageListQueryDto {
  @ApiPropertyOptional({
    description:
      'Curseur opaque renvoye dans `meta.nextCursor`. Absent = messages les plus recents.',
    maxLength: 256,
  })
  @IsOptional()
  @IsString()
  @MaxLength(256, { message: 'Curseur de pagination illisible.' })
  cursor?: string;

  @ApiPropertyOptional({
    default: DEFAULT_PER_PAGE,
    minimum: 1,
    maximum: MAX_PER_PAGE,
    description: `Messages par page (maximum ${MAX_PER_PAGE}).`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Le nombre par page doit etre un entier.' })
  @Min(1, { message: 'Au moins un message par page.' })
  @Max(MAX_PER_PAGE, { message: `Maximum ${MAX_PER_PAGE} messages par page.` })
  perPage?: number;
}
