import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BooleanFilter } from '../../../common/dto/boolean-filter.js';
import { ContentStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { emptyToUndefined, toStringArray } from './transforms.js';

/**
 * TOUS LES BOOLEENS DE CE FICHIER PASSENT PAR `@BooleanFilter()`.
 *
 * Ils passaient par un `@Transform` local qui ne pouvait pas fonctionner : avec
 * `enableImplicitConversion`, la conversion du pipe s'applique AVANT les
 * `@Transform`, donc `Boolean('false')` valait `true` et le filtre etait
 * inverse. Le piege, la trace de mesure et la table de verite sont documentes
 * une seule fois, dans `common/dto/boolean-filter.ts`, et verifies par
 * `common/dto/boolean-filter.spec.ts`.
 */

/**
 * DTO DU CONTENU PUBLIC.
 *
 * Le garde global tourne avec `forbidNonWhitelisted: true` : tout champ accepte
 * doit etre declare. C'est ce qui rend impossible l'injection d'un `id`, d'un
 * `createdAt` ou d'un `deletedAt` dans un corps de requete — aucun n'a de
 * propriete ici, donc aucun n'atteint le service.
 *
 * AUCUN PRIX N'EST DECLARE, ET C'EST UNE EXIGENCE DU CLIENT, mot pour mot :
 * « Ne mets aucun prix dans cette partie du backend. » / « Ne cree PAS de prix
 * fictifs. » `CreatePackageDto` decrit donc l'offre — nom, accroche,
 * fonctionnalites, exclusions, ordre d'affichage, actif — et rien qui ressemble
 * a un montant. Ajouter un champ `price` ici serait un mensonge de plus qu'une
 * erreur de typage : le modele `Package` ne le stocke pas, et un tarif invente
 * finirait affiche sur le site.
 */

/** Bornes partagees. Elles suivent les colonnes du schema et la taille des URLs. */
const MAX_TITLE = 160;
const MAX_SHORT_TEXT = 300;
const MAX_TEXT = 5000;
const MAX_URL = 500;
const MAX_ITEMS = 30;
const MAX_ITEM_LENGTH = 200;

// -----------------------------------------------------------------------------
// Services
// -----------------------------------------------------------------------------

export class CreateServiceDto {
  @ApiPropertyOptional({
    description: 'Slug public. Derive du titre silencieusement absent.',
    maxLength: 80,
  })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @ApiProperty({ maxLength: MAX_TITLE })
  @emptyToUndefined()
  @IsString()
  @MinLength(2, { message: 'Le titre est trop court.' })
  @MaxLength(MAX_TITLE)
  title!: string;

  @ApiProperty({ maxLength: MAX_SHORT_TEXT, description: 'Phrase affichee dans les listes.' })
  @emptyToUndefined()
  @IsString()
  @MinLength(1, { message: 'La description courte est obligatoire.' })
  @MaxLength(MAX_SHORT_TEXT)
  shortDescription!: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT)
  description?: string;

  @ApiPropertyOptional({ description: 'Nom du pictogramme cote frontend.' })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  icon?: string;

  @ApiPropertyOptional({
    description:
      "Cle de l'image de couverture dans le stockage. Une cle, jamais une URL : le domaine " +
      'du stockage peut changer sans reecrire le contenu.',
  })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  coverImageKey?: string;

  @ApiPropertyOptional({ type: [String], description: 'Points forts affiches en liste.' })
  @toStringArray()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(MAX_ITEM_LENGTH, { each: true })
  features?: string[];

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  order?: number;

  @ApiPropertyOptional({ default: true })
  @BooleanFilter()
  isActive?: boolean;

  @ApiPropertyOptional({ default: false })
  @BooleanFilter()
  isFeatured?: boolean;

  @ApiPropertyOptional({ maxLength: MAX_TITLE })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE)
  seoTitle?: string;

  @ApiPropertyOptional({ maxLength: MAX_SHORT_TEXT })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SHORT_TEXT)
  seoDescription?: string;
}

export class UpdateServiceDto {
  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(MAX_TITLE)
  title?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_SHORT_TEXT)
  shortDescription?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT)
  description?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  icon?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  coverImageKey?: string;

  @ApiPropertyOptional({ type: [String] })
  @toStringArray()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(MAX_ITEM_LENGTH, { each: true })
  features?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  order?: number;

  @ApiPropertyOptional()
  @BooleanFilter()
  isActive?: boolean;

  @ApiPropertyOptional()
  @BooleanFilter()
  isFeatured?: boolean;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE)
  seoTitle?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SHORT_TEXT)
  seoDescription?: string;
}

// -----------------------------------------------------------------------------
// Packs — aucun montant, voir l'entete du fichier
// -----------------------------------------------------------------------------

export class CreatePackageDto {
  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @ApiProperty({ maxLength: MAX_TITLE })
  @emptyToUndefined()
  @IsString()
  @MinLength(2, { message: 'Le nom est trop court.' })
  @MaxLength(MAX_TITLE)
  name!: string;

  @ApiPropertyOptional({ maxLength: MAX_SHORT_TEXT })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SHORT_TEXT)
  tagline?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT)
  description?: string;

  @ApiPropertyOptional({ type: [String], description: 'Ce que le pack comprend.' })
  @toStringArray()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(MAX_ITEM_LENGTH, { each: true })
  features?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Ce que le pack ne comprend PAS.' })
  @toStringArray()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(MAX_ITEM_LENGTH, { each: true })
  excludes?: string[];

  @ApiPropertyOptional({ description: 'Pastille affichee sur la carte ( « Populaire », ...).' })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  badge?: string;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  order?: number;

  @ApiPropertyOptional({ default: true })
  @BooleanFilter()
  isActive?: boolean;

  @ApiPropertyOptional({ default: false })
  @BooleanFilter()
  isFeatured?: boolean;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE)
  seoTitle?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SHORT_TEXT)
  seoDescription?: string;
}

export class UpdatePackageDto {
  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(MAX_TITLE)
  name?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SHORT_TEXT)
  tagline?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @toStringArray()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(MAX_ITEM_LENGTH, { each: true })
  features?: string[];

  @ApiPropertyOptional({ type: [String] })
  @toStringArray()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(MAX_ITEM_LENGTH, { each: true })
  excludes?: string[];

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  badge?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  order?: number;

  @ApiPropertyOptional()
  @BooleanFilter()
  isActive?: boolean;

  @ApiPropertyOptional()
  @BooleanFilter()
  isFeatured?: boolean;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE)
  seoTitle?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SHORT_TEXT)
  seoDescription?: string;
}

// -----------------------------------------------------------------------------
// Etudes de cas et leurs categories
// -----------------------------------------------------------------------------

export class CreateCaseStudyCategoryDto {
  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @ApiProperty({ maxLength: 120 })
  @emptyToUndefined()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  order?: number;

  @ApiPropertyOptional({ default: true })
  @BooleanFilter()
  isActive?: boolean;
}

export class UpdateCaseStudyCategoryDto {
  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  order?: number;

  @ApiPropertyOptional()
  @BooleanFilter()
  isActive?: boolean;
}

export class CreateCaseStudyDto {
  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @ApiProperty({ maxLength: MAX_TITLE })
  @emptyToUndefined()
  @IsString()
  @MinLength(2)
  @MaxLength(MAX_TITLE)
  title!: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE)
  clientName?: string;

  @ApiProperty({ maxLength: MAX_SHORT_TEXT })
  @emptyToUndefined()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_SHORT_TEXT)
  excerpt!: string;

  @ApiProperty()
  @emptyToUndefined()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TEXT)
  content!: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  coverImageKey?: string;

  @ApiPropertyOptional({ type: [String] })
  @toStringArray()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  galleryKeys?: string[];

  @ApiPropertyOptional({ type: [String] })
  @toStringArray()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  techStack?: string[];

  /**
   * `require_protocol` et la liste `http/https` ne sont pas du confort.
   *
   * Sans eux, `javascript:alert(1)` est une URL valide au sens de la
   * specification, et se retrouve dans un `href` de la page publique : un lien
   * qui execute du script sur l'origine du site. Le champ est saisi par un
   * membre de l'agence, donc la faille n'est pas ouverte a l'exterieur — mais
   * elle serait stockee, et servie a tous les visiteurs.
   */
  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'] },
    { message: "L'adresse du projet doit commencer par http:// ou https://." },
  )
  @MaxLength(MAX_URL)
  projectUrl?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  categoryId?: string;

  @ApiPropertyOptional({ enum: ContentStatus, default: ContentStatus.DRAFT })
  @emptyToUndefined()
  @IsOptional()
  @IsEnum(ContentStatus, { message: 'Statut de contenu inconnu.' })
  status?: ContentStatus;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  order?: number;

  @ApiPropertyOptional({ default: false })
  @BooleanFilter()
  isFeatured?: boolean;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE)
  seoTitle?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SHORT_TEXT)
  seoDescription?: string;
}

export class UpdateCaseStudyDto {
  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(MAX_TITLE)
  title?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE)
  clientName?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_SHORT_TEXT)
  excerpt?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TEXT)
  content?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  coverImageKey?: string;

  @ApiPropertyOptional({ type: [String] })
  @toStringArray()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  galleryKeys?: string[];

  @ApiPropertyOptional({ type: [String] })
  @toStringArray()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  techStack?: string[];

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'] },
    { message: "L'adresse du projet doit commencer par http:// ou https://." },
  )
  @MaxLength(MAX_URL)
  projectUrl?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  categoryId?: string;

  @ApiPropertyOptional({ enum: ContentStatus })
  @emptyToUndefined()
  @IsOptional()
  @IsEnum(ContentStatus, { message: 'Statut de contenu inconnu.' })
  status?: ContentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  order?: number;

  @ApiPropertyOptional()
  @BooleanFilter()
  isFeatured?: boolean;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE)
  seoTitle?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SHORT_TEXT)
  seoDescription?: string;
}

// -----------------------------------------------------------------------------
// Temoignages, partenaires, FAQ
// -----------------------------------------------------------------------------

export class CreateTestimonialDto {
  @ApiProperty({ maxLength: 120 })
  @emptyToUndefined()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  authorName!: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  authorRole?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  authorCompany?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  avatarKey?: string;

  @ApiProperty({ maxLength: 1000 })
  @emptyToUndefined()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  quote!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  order?: number;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  caseStudyId?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  clientId?: string;
}

/**
 * Mise a jour d'un temoignage : tout sauf la publication.
 *
 * `isPublished` n'y figure PAS, et c'est deliberé. Publier un temoignage est une
 * DECISION — celle qui met en ligne les mots attribues a une personne nommee —
 * et elle demande `testimonial:moderate:any`, permission distincte de
 * `testimonial:write:any`. La laisser ici permettrait a quiconque redige un
 * temoignage de le publier lui-meme, sans que la separation des deux droits
 * serve a quoi que ce soit.
 */
export class UpdateTestimonialDto {
  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  authorName?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  authorRole?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  authorCompany?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  avatarKey?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  quote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  order?: number;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  caseStudyId?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  clientId?: string;
}

/** Corps de la route de moderation : publier ou depublier. */
export class ModerateContentDto {
  @ApiProperty({ description: 'Vrai pour mettre en ligne, faux pour retirer.' })
  // `required` : le champ reste obligatoire, sinon un corps vide vaudrait
  // « depublier ». Le piege de conversion est dans boolean-filter.ts.
  @BooleanFilter({ required: true, message: 'Ce champ attend true ou false.' })
  isPublished!: boolean;
}

export class CreatePartnerDto {
  @ApiProperty({ maxLength: 120 })
  @emptyToUndefined()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ description: 'Cle du logo dans le stockage.' })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  logoKey?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'] },
    { message: "L'adresse doit commencer par http:// ou https://." },
  )
  @MaxLength(MAX_URL)
  websiteUrl?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  order?: number;

  @ApiPropertyOptional({ default: true })
  @BooleanFilter()
  isActive?: boolean;
}

export class UpdatePartnerDto {
  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  logoKey?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'] },
    { message: "L'adresse doit commencer par http:// ou https://." },
  )
  @MaxLength(MAX_URL)
  websiteUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  order?: number;

  @ApiPropertyOptional()
  @BooleanFilter()
  isActive?: boolean;
}

export class CreateFaqDto {
  @ApiProperty({ maxLength: MAX_SHORT_TEXT })
  @emptyToUndefined()
  @IsString()
  @MinLength(3)
  @MaxLength(MAX_SHORT_TEXT)
  question!: string;

  @ApiProperty()
  @emptyToUndefined()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TEXT)
  answer!: string;

  @ApiPropertyOptional({ description: 'Regroupement libre affiche cote site.' })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  order?: number;

  @ApiPropertyOptional({ default: true })
  @BooleanFilter()
  isPublished?: boolean;
}

export class UpdateFaqDto {
  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(MAX_SHORT_TEXT)
  question?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TEXT)
  answer?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  order?: number;

  @ApiPropertyOptional()
  @BooleanFilter()
  isPublished?: boolean;
}

// -----------------------------------------------------------------------------
// Filtres de liste
// -----------------------------------------------------------------------------

/**
 * Filtres communs aux listes d'administration.
 *
 * `active` est un filtre a TROIS etats, et c'est voulu : absent, il ne filtre
 * rien ; `true` ne montre que l'actif ; `false` ne montre que l'inactif. Un
 * booleen a deux etats obligerait a choisir une valeur par defaut, et l'ecran
 * d'administration ne pourrait pas afficher « tout » et « les brouillons »
 * depuis la meme route.
 */
export class ContentListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Recherche sur le titre ou le nom.' })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'Filtre actif/inactif. Absent pour ne pas filtrer.' })
  @BooleanFilter()
  active?: boolean;

  @ApiPropertyOptional({ enum: ContentStatus })
  @emptyToUndefined()
  @IsOptional()
  @IsEnum(ContentStatus, { message: 'Statut de contenu inconnu.' })
  status?: ContentStatus;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  categoryId?: string;
}

/**
 * Filtres de la liste publique des etudes de cas.
 *
 * Volontairement PLUS ETROIT que `ContentListQueryDto`, et pas par economie :
 * une route publique qui accepterait `status` ou `active` laisserait croire
 * qu'on peut demander les brouillons, alors que le service force
 * `status: PUBLISHED`. Un filtre accepte puis ignore est pire qu'un filtre
 * absent — l'appelant croit avoir obtenu ce qu'il a demande.
 *
 * `search` ne figure pas non plus : chercher dans le contenu des etudes de cas
 * demande un index plein texte, qui n'existe pas ici. Une recherche qui
 * parcourrait la table a chaque visite serait un cout impose par un visiteur
 * anonyme.
 */
export class PublicCaseStudyQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: "Restreint a une categorie d'etudes de cas." })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  categoryId?: string;
}
