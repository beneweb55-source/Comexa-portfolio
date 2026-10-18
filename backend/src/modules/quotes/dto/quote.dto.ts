import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { QuoteStatus } from '../../../generated/prisma/enums.js';

/**
 * DEVISES ACCEPTÉES SUR UN DOCUMENT COMMERCIAL.
 *
 * DA d'abord : le marché principal est l'Algérie. Cette liste est VOLONTAIREMENT
 * distincte de `SUPPORTED_CURRENCIES` (tarification des commandes), qui répond
 * à une autre règle — la devise y vient du pays du visiteur, jamais d'un choix.
 * Un devis, lui, est écrit par un humain qui sait dans quelle devise il facture.
 */
export const DOCUMENT_CURRENCIES = ['DZD', 'EUR'] as const;

/**
 * CONTRATS D'ENTREE DES DEVIS.
 *
 * `main.ts` et `app.setup.ts` activent `forbidNonWhitelisted` : un champ non
 * declare ci-dessous fait ECHOUER la requete au lieu d'etre ignore.
 *
 * AUCUN DTO DE CE FICHIER NE PORTE DE MONTANT TOTAL. C'est deliberé, et c'est la
 * regle la plus importante du module : `subtotal`, `discountAmount`, `taxAmount`
 * et `total` sont calcules cote serveur a partir des lignes. Un total envoye par
 * le client n'est jamais cru — meme quand il est juste, il ne l'est que par
 * accident, et le premier client qui envoie `total: 1` sur un devis de 40 000
 * euros obtiendrait un devis signe a 1 euro.
 */

/** Bornes communes aux montants unitaires. `Decimal(14, 2)` porte 12 chiffres. */
const MAX_AMOUNT = 999_999_999_999.99;
const MAX_QUANTITY = 999_999_999.99;
const MAX_LINES = 200;
const MAX_LABEL = 300;

/**
 * Une ligne de devis.
 *
 * `position` n'est PAS acceptee : elle est derivee de l'ordre du tableau. Un
 * client qui enverrait deux lignes en position 1 produirait un document dont
 * l'ordre d'affichage depend du moteur de base de donnees, et une facture doit
 * se lire dans l'ordre ou elle a ete ecrite.
 */
export class QuoteLineDto {
  @ApiProperty({ example: 'Refonte du site vitrine', maxLength: MAX_LABEL })
  @IsString({ message: "L'intitule de la ligne est obligatoire." })
  @MinLength(1, { message: "L'intitule de la ligne est obligatoire." })
  @MaxLength(MAX_LABEL)
  title!: string;

  @ApiPropertyOptional({ example: 'Maquettes, integration et mise en ligne.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 2, default: 1, description: 'Decimal(12,2), positif.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'La quantite doit avoir au plus deux decimales.' })
  @Min(0)
  @Max(MAX_QUANTITY)
  quantity?: number;

  @ApiProperty({ example: 4500.5, description: 'Prix unitaire hors taxes.' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Le prix unitaire doit avoir au plus deux decimales.' },
  )
  @Min(0)
  @Max(MAX_AMOUNT)
  unitPrice!: number;

  @ApiPropertyOptional({ example: 10, default: 0, description: 'Remise de la ligne, en pourcent.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Une remise ne peut pas etre negative.' })
  @Max(100, {
    message: 'Une remise ne peut pas depasser 100 %. Le prix ne peut pas devenir negatif.',
  })
  discountPercent?: number;
}

export class CreateQuoteDto {
  @ApiProperty({ example: 'Refonte du site vitrine', maxLength: MAX_LABEL })
  @IsString({ message: "L'objet du devis est obligatoire." })
  @MinLength(1, { message: "L'objet du devis est obligatoire." })
  @MaxLength(MAX_LABEL)
  subject!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Conditions generales imprimees sur le document.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  terms?: string;

  @ApiPropertyOptional({ description: "Date d'emission. Defaut : aujourd'hui." })
  @IsOptional()
  @IsISO8601({}, { message: "La date d'emission n'est pas une date valide." })
  issueDate?: string;

  @ApiPropertyOptional({ description: 'Date de fin de validite.' })
  @IsOptional()
  @IsISO8601({}, { message: "La date de validite n'est pas une date valide." })
  validUntil?: string;

  @ApiPropertyOptional({ enum: DOCUMENT_CURRENCIES, example: 'DZD', default: 'DZD' })
  @IsOptional()
  @IsIn(DOCUMENT_CURRENCIES, { message: 'Devise non prise en charge.' })
  currency?: string;

  @ApiPropertyOptional({
    example: 20,
    default: 0,
    description: 'Taux de TVA de la piece, en pourcent.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRate?: number;

  /**
   * Cible du devis : un prospect OU un client, jamais les deux ni aucun.
   *
   * Le schema le dit (« Exactement l'un des deux est renseigne ») mais AUCUNE
   * contrainte de base ne le garantit — voir le rapport : la migration ne pose
   * pas de CHECK. La verification est donc faite ici, dans le service, et c'est
   * le seul endroit ou elle existe.
   */
  @ApiPropertyOptional({ description: 'Devis emis avant conversion : vise un prospect.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  prospectId?: string;

  @ApiPropertyOptional({ description: 'Devis complementaire : vise un client deja converti.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  clientId?: string;

  @ApiProperty({
    type: [QuoteLineDto],
    description: 'Au moins une ligne. Aucun total n est accepte.',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Un devis doit porter au moins une ligne.' })
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  items!: QuoteLineDto[];
}

/**
 * Modification d'un brouillon.
 *
 * Tous les champs sont facultatifs ; `items`, s'il est fourni, REMPLACE
 * l'integralite des lignes (voir `QuotesService.update`). Modifier une ligne au
 * milieu d'un tableau demande un identifiant de ligne stable, que le client
 * n'a pas forcement ; un remplacement complet est plus simple et plus sur : il
 * n'y a pas d'etat intermediaire ou une ligne a change et les totaux non.
 */
export class UpdateQuoteDto {
  @ApiPropertyOptional({ maxLength: MAX_LABEL })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_LABEL)
  subject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  terms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({}, { message: "La date d'emission n'est pas une date valide." })
  issueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({}, { message: "La date de validite n'est pas une date valide." })
  validUntil?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  prospectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  clientId?: string;

  @ApiPropertyOptional({ type: [QuoteLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Un devis doit porter au moins une ligne.' })
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  items?: QuoteLineDto[];
}

/** Motif de refus : le client explique pourquoi, et c'est conserve sur la piece. */
export class RefuseQuoteDto {
  @ApiProperty({ example: 'Budget reporte au prochain trimestre.' })
  @IsString({ message: 'Le motif du refus est obligatoire.' })
  @MinLength(1, { message: 'Le motif du refus est obligatoire.' })
  @MaxLength(1000)
  reason!: string;
}

/** Filtres de liste. Un porteur CLIENT ne peut PAS elargir son perimetre ici. */
export class ListQuotesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: QuoteStatus })
  @IsOptional()
  @IsEnum(QuoteStatus, { message: 'Statut de devis inconnu.' })
  status?: QuoteStatus;

  @ApiPropertyOptional({
    description:
      'Filtre interne. IGNORE pour un porteur client, dont le perimetre vient du compte.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  clientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  prospectId?: string;

  @ApiPropertyOptional({ description: 'Recherche sur la reference ou l objet.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

/** Nombre de lignes maximum par piece. Exporte pour les tests de borne. */
export const QUOTE_MAX_LINES = MAX_LINES;

/** Reponse d'une acceptation : la piece, et ce qu'elle a produit. */
export interface QuoteAcceptanceResult {
  readonly quoteId: string;
  readonly status: QuoteStatus;
  readonly clientId: string;
  readonly projectId: string;
  /** Vrai quand le client a ete CREE par cette acceptation (et non retrouve). */
  readonly clientCreated: boolean;
}
