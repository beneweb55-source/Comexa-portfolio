import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BudgetRange, ContactRequestStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { emptyToUndefined } from './transforms.js';

/**
 * DTO DES DEMANDES DE CONTACT.
 *
 * `CreateContactRequestDto` est le seul DTO du module dont le corps vient d'un
 * VISITEUR ANONYME. C'est ce qui dicte le reste : chaque champ accepte ici est
 * une donnee qu'un inconnu peut ecrire en base, autant de fois qu'il le veut
 * dans la limite du quota de la route. D'ou trois principes.
 *
 * 1. RIEN QUI ENGAGE L'AGENCE. `status`, `handledById`, `notes` et
 *    `convertedProspectId` ne sont pas declares : un visiteur ne choisit pas
 *    l'etat de traitement de sa demande, ni qui la traite, ni a quel prospect
 *    elle correspond. Aucun n'a de propriete ici, donc `forbidNonWhitelisted`
 *    les refuse avant le controleur.
 *
 * 2. RIEN D'ARBITRAIREMENT GRAND. Les champs `utm*` sont trois chaines bornees,
 *    pas un objet JSON libre. La colonne `utm` est un `Json` : y ecrire le corps
 *    recu tel quel ferait de la base le stockage d'un inconnu, et un objet de
 *    plusieurs megaoctets par requete remplirait la table sans qu'aucune borne
 *    ne s'y oppose. Les trois champs ci-dessous sont ceux qui servent a savoir
 *    d'ou vient une demande — et ils sont bornes comme les autres.
 *
 * 3. LES TRACES TECHNIQUES NE VIENNENT PAS DU CORPS. `ipAddress` et
 *    `userAgent` sont lus sur la requete par le controleur. Les accepter en
 *    entree reviendrait a laisser l'appelant choisir sa propre trace d'audit.
 */

/** Bornes de saisie. Elles suivent les colonnes `String` du schema. */
const MAX_NAME = 80;
const MAX_EMAIL = 200;
const MAX_PHONE = 40;
const MAX_COMPANY = 160;
const MAX_JOB_TITLE = 120;
const MAX_URL = 500;
const MAX_SUBJECT = 200;
const MAX_MESSAGE = 5000;
const MAX_SOURCE = 80;
const MAX_UTM = 120;
const MAX_ID = 40;
const MAX_NOTES = 5000;

export class CreateContactRequestDto {
  @ApiProperty({ maxLength: MAX_NAME })
  @emptyToUndefined()
  @IsString()
  @MinLength(2, { message: 'Le prenom est trop court.' })
  @MaxLength(MAX_NAME)
  firstName!: string;

  @ApiProperty({ maxLength: MAX_NAME })
  @emptyToUndefined()
  @IsString()
  @MinLength(2, { message: 'Le nom est trop court.' })
  @MaxLength(MAX_NAME)
  lastName!: string;

  @ApiProperty({ maxLength: MAX_EMAIL })
  @emptyToUndefined()
  @IsEmail({}, { message: "L'adresse email n'est pas valide." })
  @MaxLength(MAX_EMAIL)
  email!: string;

  @ApiPropertyOptional({ maxLength: MAX_PHONE })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PHONE)
  phone?: string;

  @ApiPropertyOptional({ maxLength: MAX_COMPANY })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_COMPANY)
  companyName?: string;

  @ApiPropertyOptional({ maxLength: MAX_JOB_TITLE })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_JOB_TITLE)
  jobTitle?: string;

  /**
   * Le site web du visiteur, pas celui de l'agence.
   *
   * `http/https` uniquement : ce champ finit affiche dans la fiche de la
   * demande, et un `javascript:` y serait un lien piege pose par un inconnu.
   */
  @ApiPropertyOptional({ maxLength: MAX_URL })
  @emptyToUndefined()
  @IsOptional()
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'] },
    { message: "L'adresse doit commencer par http:// ou https://." },
  )
  @MaxLength(MAX_URL)
  website?: string;

  @ApiPropertyOptional({ maxLength: MAX_SUBJECT })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SUBJECT)
  subject?: string;

  @ApiProperty({ maxLength: MAX_MESSAGE })
  @emptyToUndefined()
  @IsString()
  @MinLength(10, { message: 'Le message est trop court pour etre traite.' })
  @MaxLength(MAX_MESSAGE)
  message!: string;

  @ApiPropertyOptional({ description: "Service concerne, pour savoir ce qui a declenche l'envoi." })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ID)
  serviceId?: string;

  @ApiPropertyOptional({ description: "Pack concerne, pour savoir ce qui a declenche l'envoi." })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ID)
  packageId?: string;

  @ApiPropertyOptional({ enum: BudgetRange, default: BudgetRange.UNKNOWN })
  @emptyToUndefined()
  @IsOptional()
  @IsEnum(BudgetRange, { message: 'Fourchette de budget inconnue.' })
  budgetRange?: BudgetRange;

  @ApiPropertyOptional({ description: 'Page d origine declaree par le formulaire.' })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SOURCE)
  source?: string;

  @ApiPropertyOptional({ maxLength: MAX_UTM, description: "Provenance d'une campagne (utm_source)." })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_UTM)
  utmSource?: string;

  @ApiPropertyOptional({ maxLength: MAX_UTM, description: "Canal d'une campagne (utm_medium)." })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_UTM)
  utmMedium?: string;

  @ApiPropertyOptional({ maxLength: MAX_UTM, description: "Nom d'une campagne (utm_campaign)." })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_UTM)
  utmCampaign?: string;
}

/**
 * Traitement d'une demande par l'agence.
 *
 * `handledById` et `handledAt` ne sont PAS declaras : ils sont pris du porteur
 * de la requete et de l'horloge du serveur. Les accepter permettrait d'attribuer
 * le traitement a un collegue sans qu'il l'ait fait — et la trace d'audit ne
 * vaudrait plus rien.
 */
export class UpdateContactRequestDto {
  @ApiPropertyOptional({ enum: ContactRequestStatus })
  @emptyToUndefined()
  @IsOptional()
  @IsEnum(ContactRequestStatus, { message: 'Statut de demande inconnu.' })
  status?: ContactRequestStatus;

  @ApiPropertyOptional({ maxLength: MAX_NOTES })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTES)
  notes?: string;
}

/**
 * Filtres de `GET /api/contact-requests`.
 *
 * Les dates sont bornees des deux cotes. Un `from` du 1er janvier et un `to` du
 * 31 decembre suffisent a couvrir l'annee ; laisser une borne ouverte sur une
 * table qui grandit a chaque visite publiee finirait par produire une requete
 * qui charge tout.
 */
export class ListContactRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ContactRequestStatus })
  @emptyToUndefined()
  @IsOptional()
  @IsEnum(ContactRequestStatus, { message: 'Statut de demande inconnu.' })
  status?: ContactRequestStatus;

  @ApiPropertyOptional({ description: "Recherche sur l'email, le nom, le sujet et le message." })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ID)
  serviceId?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ID)
  packageId?: string;

  @ApiPropertyOptional({ description: 'Date de creation minimale (ISO 8601).' })
  @emptyToUndefined()
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'La date de debut doit etre au format ISO 8601.' })
  from?: string;

  @ApiPropertyOptional({ description: 'Date de creation maximale (ISO 8601).' })
  @emptyToUndefined()
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'La date de fin doit etre au format ISO 8601.' })
  to?: string;
}
