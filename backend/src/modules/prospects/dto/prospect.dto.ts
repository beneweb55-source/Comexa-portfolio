import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { BudgetRange, LeadSource, LeadStatus } from '../../../generated/prisma/enums.js';

/**
 * Contrats d'entree du module prospects.
 *
 * `forbidNonWhitelisted` est actif : tout champ absent d'ici fait ECHOUER la
 * requete au lieu d'etre ignore. C'est ce qui rend ces classes opposables — un
 * `PATCH { "status": "WON" }` doit etre refuse, pas absorber en silence.
 *
 * LE STATUT N'EST PAS UN CHAMP DE FICHE, ET C'EST VOULU.
 *
 * Il n'apparait ni dans la creation ni dans la modification : le pipeline est
 * modifie par `POST /prospects/:id/statut`, le seul chemin qui ecrit
 * `LeadStatusHistory` dans la meme transaction. L'ouvrir ici offrirait un second
 * chemin capable de deplacer l'etape sans laisser de trace, et l'historique
 * cesserait d'etre la preuve du parcours. A la creation, le statut est NEW :
 * c'est la valeur par defaut du schema, et l'historique recoit sa premiere ligne
 * (fromStatus: null), comme le fait deja le seed.
 *
 * LES LONGUEURS MAXIMALES NE SONT PAS DECORATIVES.
 *
 * Les colonnes sont du `text` sans limite en base : sans plafond ici, un champ
 * « notes » de plusieurs megaoctets entre en base et ressort a chaque lecture de
 * liste. Les valeurs retenues sont larges pour un usage reel et bornent la
 * surface d'abus.
 */

const NAME_MAX = 120;
const EMAIL_MAX = 320; // 254 pour l'adresse, marge pour le domaine.
const TEXT_MAX = 5000;
const ID_MAX = 64; // cuid = 25 caracteres aujourd'hui.

export class CreateProspectDto {
  @ApiPropertyOptional({ example: 'Boulangerie Lefranc', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @ApiProperty({ example: 'Nadia' })
  @IsString()
  @MinLength(1, { message: 'Le prenom du contact est obligatoire.' })
  @MaxLength(NAME_MAX)
  contactFirstName!: string;

  @ApiProperty({ example: 'Lefranc' })
  @IsString()
  @MinLength(1, { message: 'Le nom du contact est obligatoire.' })
  @MaxLength(NAME_MAX)
  contactLastName!: string;

  @ApiProperty({ example: 'nadia.lefranc@boulangerie-lefranc.example' })
  @IsEmail({}, { message: "L'adresse e-mail n'est pas valide." })
  @MaxLength(EMAIL_MAX)
  email!: string;

  @ApiPropertyOptional({ example: '+33 5 56 00 00 02' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ example: 'Gerante' })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  jobTitle?: string;

  // Pas de `@IsUrl()` : le validateur refuse les domaines sans extension
  // reconnue, et une adresse de developpement ou un intranet d'entreprise sont
  // des saisies parfaitement legitimes. Le champ est informatif, il n'est jamais
  // appele par le serveur — le contraindre plus que la base ne le fait
  // n'apporterait aucune securite, seulement des refus incomprehensibles.
  @ApiPropertyOptional({ example: 'https://boulangerie-lefranc.example' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  website?: string;

  @ApiPropertyOptional({ example: 'Commerce de proximite' })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  sector?: string;

  @ApiPropertyOptional({ enum: Object.values(LeadSource) })
  @IsOptional()
  @IsEnum(LeadSource, { message: "Cette source de prospect n'existe pas." })
  source?: LeadSource;

  @ApiPropertyOptional({ enum: Object.values(BudgetRange) })
  @IsOptional()
  @IsEnum(BudgetRange, { message: "Cette fourchette budgetaire n'existe pas." })
  budgetRange?: BudgetRange;

  // `Decimal(14, 2)` : douze chiffres avant la virgule. Le plafond est celui de
  // la colonne, pas une appreciation commerciale.
  @ApiPropertyOptional({ example: 12000.5, maximum: 99_999_999_999.99 })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Le budget estime doit avoir au plus deux decimales.' },
  )
  @Min(0, { message: 'Un budget estime ne peut pas etre negatif.' })
  @Max(99_999_999_999.99)
  estimatedBudget?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Responsable du prospect. Omis, la fiche revient au porteur. Un porteur du scope `own` ne peut designer que lui-meme.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ID_MAX)
  ownerId?: string;
}

/**
 * Modification d'une fiche.
 *
 * `null` EFFACE, L'ABSENCE NE TOUCHE PAS. C'est la semantique attendue d'un
 * `PATCH` : `{ "phone": null }` vide le telephone, `{}` ne change rien. Prisma
 * ignore les cles `undefined` mais ecrit `NULL` sur un `null` explicite, donc
 * les deux comportements se distinguent sans code supplementaire.
 */
export class UpdateProspectDto {
  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Le prenom du contact ne peut pas etre vide.' })
  @MaxLength(NAME_MAX)
  contactFirstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Le nom du contact ne peut pas etre vide.' })
  @MaxLength(NAME_MAX)
  contactLastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: "L'adresse e-mail n'est pas valide." })
  @MaxLength(EMAIL_MAX)
  email?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  jobTitle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  website?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  sector?: string | null;

  @ApiPropertyOptional({ enum: Object.values(LeadSource) })
  @IsOptional()
  @IsEnum(LeadSource, { message: "Cette source de prospect n'existe pas." })
  source?: LeadSource;

  @ApiPropertyOptional({ enum: Object.values(BudgetRange) })
  @IsOptional()
  @IsEnum(BudgetRange, { message: "Cette fourchette budgetaire n'existe pas." })
  budgetRange?: BudgetRange;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Un budget estime ne peut pas etre negatif.' })
  @Max(99_999_999_999.99)
  estimatedBudget?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX)
  notes?: string | null;

  @ApiPropertyOptional({ description: 'Responsable. Voir la regle de portee sur la creation.' })
  @IsOptional()
  @IsString()
  @MaxLength(ID_MAX)
  ownerId?: string;
}

/**
 * Changement d'etape du pipeline.
 *
 * `lostReason` n'est retenu QUE si le statut cible est LOST, et il est efface
 * lorsqu'on quitte LOST : une fiche dont le statut dit NEGOTIATION ne doit pas
 * conserver la raison d'une perte passee. La raison de la perte appartient a
 * l'evenement, pas a la fiche.
 *
 * Un statut inconnu est refuse par `@IsEnum` avant d'atteindre le service
 * (400 VALIDATION_FAILED). Le service, lui, ne juge que la TRANSITION.
 */
export class ChangeProspectStatusDto {
  @ApiProperty({ enum: Object.values(LeadStatus) })
  @IsEnum(LeadStatus, { message: "Ce statut de prospect n'existe pas." })
  status!: LeadStatus;

  @ApiPropertyOptional({ description: "Note jointe a l'etape, conservee dans l'historique." })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({ description: 'Raison de la perte. Retenue uniquement vers LOST.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  lostReason?: string;
}

/**
 * Filtres de la liste.
 *
 * `ownerId` est un filtre, pas un perimetre : combine en `AND` avec le filtre de
 * scope par le service, il ne peut pas elargir ce que le porteur voit. Le
 * demander pour un collegue quand on n'a que `own` ne renvoie donc rien.
 */
export class ListProspectsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Object.values(LeadStatus) })
  @IsOptional()
  @IsEnum(LeadStatus, { message: "Ce statut de prospect n'existe pas." })
  status?: LeadStatus;

  @ApiPropertyOptional({ enum: Object.values(LeadSource) })
  @IsOptional()
  @IsEnum(LeadSource, { message: "Cette source de prospect n'existe pas." })
  source?: LeadSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(ID_MAX)
  ownerId?: string;

  @ApiPropertyOptional({ description: "Recherche sur le nom, le contact et l'adresse e-mail." })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  search?: string;
}
