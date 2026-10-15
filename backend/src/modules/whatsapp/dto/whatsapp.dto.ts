import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { WHATSAPP_GRANT_SCOPES } from '../consent.js';

/**
 * Les deux seules valeurs acceptees pour un drapeau passe en query string.
 *
 * Une valeur inattendue (`?all=oui`) repond 400 au lieu d'etre lue comme fausse :
 * un drapeau ignore en silence est un drapeau dont l'appelant croit qu'il a ete
 * applique.
 */
const BOOLEAN_QUERY_FLAGS = ['true', 'false'] as const;

/**
 * DTO WHATSAPP — ce qu'un appelant peut dire, et rien de plus.
 *
 * -------------------------------------------------------------------------
 * DEUX PRINCIPES QUI REVENNENT DANS CHAQUE CLASSE
 * -------------------------------------------------------------------------
 *  1. AUCUN CHAMP NE PERMET DE DESIGNER UN AUTRE COMPTE que celui du porteur
 *     (`/me/whatsapp/...`) : l'identifiant vient du jeton, jamais du corps. C'est
 *     la meme regle que pour les DTO de pilotage (`dashboard`, `reports`) : un
 *     champ `userId` dans le corps serait une porte vers le compte d'un autre.
 *     Les routes d'INTEGRATION, elles, portent l'identifiant dans le CHEMIN, et
 *     ne sont accessibles qu'avec un jeton `cxi_` scope — voir le controleur.
 *
 *  2. AUCUN CHAMP NE PERMET DE FOURNIR UN IDENTIFIANT DE SESSION. Le nom de
 *     session est genere cote serveur (`sessionNameFor`) : un nom choisi par
 *     l'appelant pourrait viser la session d'un autre compte sur la passerelle,
 *     donc envoyer depuis le telephone de quelqu'un d'autre.
 */

/** Demarrage de l'appairage de SON compte. */
export class StartWhatsAppSessionDto {
  /**
   * Acceptation explicite du texte de consentement.
   *
   * OBLIGATOIRE ET VERIFIEE COTE SERVEUR (422 si absente ou fausse). Sans ce
   * champ, un clic sur « connecter WhatsApp » engagerait le numero de la personne
   * sans qu'elle ait vu ce qu'elle autorise — et le consentement ne vaut rien
   * s'il est presume. La valeur n'est pas stockee telle quelle : elle declenche
   * l'ecriture de `consentVersion`, `consentAcceptedAt` et `consentIpAddress`.
   */
  @ApiProperty({
    description:
      'Doit valoir `true` : le titulaire accepte le texte de consentement rendu par ' +
      '`GET /me/whatsapp/consent`.',
    example: true,
  })
  @IsBoolean({ message: 'acceptConsent doit etre un booleen.' })
  acceptConsent!: boolean;

  /**
   * Capacites accordees. Absent ou vide = `message:send` seul.
   *
   * `contact:read` COPIE LE REPERTOIRE du telephone. Le proposer par defaut
   * serait une collecte que personne n'a demandee : c'est donc un choix explicite,
   * et le refus de synchroniser sans lui est verifie dans le service.
   */
  @ApiPropertyOptional({
    description: 'Capacites accordees (defaut : envoi seul).',
    example: ['message:send'],
    enum: WHATSAPP_GRANT_SCOPES,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(WHATSAPP_GRANT_SCOPES.length)
  @IsIn(WHATSAPP_GRANT_SCOPES as unknown as string[], {
    each: true,
    message: `Capacites acceptees : ${WHATSAPP_GRANT_SCOPES.join(', ')}.`,
  })
  scopes?: string[];
}

/** Demande d'autorisation adressee a un TIERS. */
export class CreateWhatsAppDelegationDto {
  @ApiPropertyOptional({
    description: 'Nom du tiers, tel qu’il sera affiche dans le texte.',
    example: 'Karim B.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  delegatorName?: string;

  /**
   * Adresse du tiers : c'est par elle que l'invitation part.
   *
   * Facultative seulement en apparence — sans adresse, le service refuse
   * (422 `WHATSAPP_DELEGATION_UNREACHABLE`) : une autorisation demandee a
   * personne n'est pas une autorisation, et creer une delegation sans moyen de la
   * remettre produirait des codes qui expirent sans avoir ete lus.
   */
  @ApiPropertyOptional({
    description: 'Adresse courriel du tiers, qui recoit l’invitation et le texte de consentement.',
    example: 'karim@example.com',
  })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  delegatorEmail?: string;

  @ApiPropertyOptional({
    description: 'Numero du tiers, pour lever une ambiguite apres appairage.',
    example: '+213555123456',
  })
  @IsOptional()
  @IsString()
  @Length(6, 32)
  delegatorPhone?: string;

  @ApiPropertyOptional({
    description: 'Contexte remis au tiers avec le texte de consentement.',
    example: 'Relances des devis du projet Comexa.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description: 'Capacites demandees au tiers (defaut : envoi seul).',
    enum: WHATSAPP_GRANT_SCOPES,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(WHATSAPP_GRANT_SCOPES.length)
  @IsIn(WHATSAPP_GRANT_SCOPES as unknown as string[], { each: true })
  scopes?: string[];

  /**
   * Duree de l'autorisation, en jours, a partir de l'acceptation.
   *
   * Absent = la valeur de `WHATSAPP_CONSENT_TTL` (ou aucune limite si la
   * variable est vide). Borner est recommande : une autorisation qui expire toute
   * seule oblige a redire oui, et borne ce qu'un compte oublie permet encore.
   */
  @ApiPropertyOptional({
    description: 'Duree de l’autorisation en jours (1 a 3650).',
    minimum: 1,
    maximum: 3650,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;
}

/** Redemption d'un code d'autorisation, par le bot (route d'integration). */
export class AcceptWhatsAppDelegationDto {
  @ApiProperty({
    description: 'Code d’autorisation recu par le tiers (`WA-XXXX-XXXX-XXXX`, tirets facultatifs).',
    example: 'WA-7KQM-2ZPX-9BRT',
  })
  @IsString()
  @Length(8, 40, { message: 'Le code d’autorisation est illisible.' })
  code!: string;

  @ApiProperty({ description: 'Identifiant Telegram du tiers.', example: '987654321' })
  @IsString()
  @Length(1, 64)
  telegramUserId!: string;

  @ApiProperty({ description: 'Chat Telegram prive du tiers avec le bot.', example: '987654321' })
  @IsString()
  @Length(1, 64)
  telegramChatId!: string;

  @ApiPropertyOptional({ description: 'Nom d’utilisateur Telegram du tiers (sans le @).' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  telegramUsername?: string;

  /**
   * Le tiers accepte le texte de consentement.
   *
   * Le bot doit l'avoir affiche et avoir recu une reponse positive : sans ce
   * champ, la redemption d'un code suffirait a connecter un compte, et un code
   * transmis par erreur engagerait le numero de son destinataire.
   */
  @ApiProperty({
    description: 'Doit valoir `true` : le tiers accepte le texte de consentement.',
    example: true,
  })
  @IsBoolean()
  acceptConsent!: boolean;
}

/** Refus explicite d'une invitation, par le tiers (`/refuser <code>`). */
export class RefuseWhatsAppDelegationDto {
  @ApiProperty({
    description: 'Code d’autorisation recu (`WA-XXXX-XXXX-XXXX`, tirets facultatifs).',
    example: 'WA-7KQM-2ZPX-9BRT',
  })
  @IsString()
  @Length(8, 40)
  code!: string;

  /**
   * Identifiant Telegram du chat d'ou vient le refus.
   *
   * IL N'AUTORISE RIEN ET NE VERIFIE RIEN : aucune identite Telegram n'est
   * connue avant l'acceptation, il n'y a donc rien a comparer. La valeur est
   * simplement JOURNALISEE avec le refus, pour que « qui a dit non » ait une
   * reponse. Pretendre le contraire dans ce commentaire ferait croire a un
   * controle qui n'existe pas — et un refus reste sans consequence grave,
   * puisqu'il ne connecte rien.
   */
  @ApiPropertyOptional({ description: 'Identifiant Telegram du tiers qui refuse.' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  telegramUserId?: string;
}

/** Envoi d'un message. */
export class SendWhatsAppMessageDto {
  /**
   * Destinataire : numero (`+213555123456`, `0555123456`) ou JID
   * (`213555123456@s.whatsapp.net`).
   *
   * Les groupes sont REFUSES par la regle d'envoi : un message de groupe touche
   * tous ses membres, ce qui depasse l'autorisation accordee pour des contacts.
   */
  @ApiProperty({
    description: 'Destinataire : numero international ou JID WhatsApp.',
    example: '+213555123456',
  })
  @IsString()
  @Length(4, 64)
  to!: string;

  @ApiProperty({
    description: 'Texte du message (la borne vient de WHATSAPP_MAX_BODY_LENGTH).',
    example: 'Bonjour, le devis DEV-2026-014 est pret. Bonne journee.',
  })
  @IsString()
  @Length(1, 4_096)
  body!: string;

  /**
   * Indicatif pays applique a un numero local, s'il differre du defaut.
   *
   * Le defaut vient de `WHATSAPP_DEFAULT_COUNTRY_CODE`. Le permettre par appel
   * evite d'imposer le `+` a un bot qui relaie un numero saisi tel quel — sans
   * jamais deviner : un pays non reconnu est refuse.
   */
  @ApiPropertyOptional({
    description: 'Indicatif pays (ISO 3166-1 alpha-2) pour un numero local.',
    example: 'DZ',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  /**
   * Cle d'idempotence PROPRE A CE MODULE (en-tete `Idempotency-Key` non requis).
   *
   * Pourquoi une cle dans le CORPS et non l'en-tete deja prevu pour les
   * creations : l'en-tete `Idempotency-Key` rejoue la REPONSE stockee, ce qui
   * convient a une creation de tache. Ici il faut aussi pouvoir DIRE que l'envoi
   * a deja eu lieu, avec son identifiant WhatsApp — la ligne `whatsapp_messages`
   * est donc la memoire, et la cle en est l'adresse.
   */
  @ApiPropertyOptional({
    description: 'Cle d’idempotence : un rejeu rend l’envoi existant au lieu de renvoyer.',
    example: 'n8n-wa-2026-10-15-001',
  })
  @IsOptional()
  @IsString()
  @Length(8, 120)
  idempotencyKey?: string;

  @ApiPropertyOptional({ description: 'Chat Telegram a l’origine de la demande (tracabilite).' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  telegramChatId?: string;

  @ApiPropertyOptional({ description: 'Message Telegram a l’origine de la demande (tracabilite).' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  telegramMessageId?: string;
}

/** Liste des contacts en cache. */
export class ListWhatsAppContactsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filtre sur le nom ou le numero.', example: 'karim' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  /**
   * Force une resynchronisation depuis la passerelle.
   *
   * `false` par defaut : lire le repertoire du telephone a chaque consultation
   * userait la batterie du titulaire et saturerait la passerelle pour un resultat
   * identique. Le rafraichissement explicite reste possible, et le cache est de
   * toute facon perime au-dela de `WHATSAPP_CONTACT_CACHE_MINUTES`.
   */
  /**
   * Drapeau en CHAINE, pas en booleen — voir `BOOLEAN_QUERY_FLAGS`.
   *
   * Une conversion booleenne sur une query string rendrait vrai pour
   * `?refresh=false`, parce que la chaine "false" n'est pas vide. Une
   * resynchronisation declenchee par le parametre qui demandait l'inverse
   * appellerait la passerelle a chaque lecture : le cache n'existerait plus.
   */
  @ApiPropertyOptional({
    description: 'Resynchroniser depuis la passerelle avant de rendre la page.',
    enum: ['true', 'false'],
  })
  @IsOptional()
  @IsIn(BOOLEAN_QUERY_FLAGS)
  refresh?: 'true' | 'false';
}

/** Liste du journal d'envois. */
export class ListWhatsAppMessagesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filtrer par etat.',
    enum: ['QUEUED', 'SENT', 'FAILED', 'REFUSED'],
  })
  @IsOptional()
  @IsIn(['QUEUED', 'SENT', 'FAILED', 'REFUSED'])
  status?: 'QUEUED' | 'SENT' | 'FAILED' | 'REFUSED';

  @ApiPropertyOptional({
    description: 'Filtre sur le destinataire (numero ou JID).',
    example: '213555123456',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  to?: string;
}

/** Liste des delegations (membre demandeur, ou administrateur). */
export class ListWhatsAppDelegationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filtrer par etat de l’invitation.',
    enum: ['PENDING', 'ACCEPTED', 'REFUSED', 'EXPIRED', 'REVOKED'],
  })
  @IsOptional()
  @IsIn(['PENDING', 'ACCEPTED', 'REFUSED', 'EXPIRED', 'REVOKED'])
  status?: 'PENDING' | 'ACCEPTED' | 'REFUSED' | 'EXPIRED' | 'REVOKED';

  /**
   * `true` : toutes les delegations (administration, `whatsapp:manage:any`).
   * `false` ou absent : seulement celles du membre authentifie.
   *
   * Le perimetre reel est decide par le service a partir des permissions : ce
   * champ n'ouvre rien, il demande. Un appelant sans `manage` qui le met a `true`
   * obtient ses propres lignes, pas celles des autres — sinon le champ serait une
   * faille d'acces horizontal, exactement ce que les tests de perimetre cherchent.
   */
  /** Drapeau en CHAINE, pour la raison donnee sur `refresh` ci-dessus. */
  @ApiPropertyOptional({
    description: 'Voir toutes les delegations (administration).',
    enum: ['true', 'false'],
  })
  @IsOptional()
  @IsIn(BOOLEAN_QUERY_FLAGS)
  all?: 'true' | 'false';
}

/** Liste des comptes appaires (administration). */
export class ListWhatsAppAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filtrer par etat de session.',
    enum: ['DISCONNECTED', 'STARTING', 'WAITING_QR', 'CONNECTED', 'FAILED', 'REVOKED'],
  })
  @IsOptional()
  @IsIn(['DISCONNECTED', 'STARTING', 'WAITING_QR', 'CONNECTED', 'FAILED', 'REVOKED'])
  status?: string;
}
