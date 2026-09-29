import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DocumentCategory, DocumentVisibility } from '../../../generated/prisma/enums.js';
import { BooleanFilter } from '../../../common/dto/boolean-filter.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

/**
 * DTO DU MODULE DOCUMENTS.
 *
 * Le garde global tourne avec `forbidNonWhitelisted: true` : tout champ accepte
 * par une route DOIT etre declare ici. Ce n'est pas une contrainte de style —
 * c'est ce qui empeche un appelant d'injecter `storageKey`, `checksum` ou
 * `uploadedById` dans un envoi multipart et de faire ecrire au service autre
 * chose que ce qu'il croit ecrire. Aucun de ces champs n'a de propriete
 * correspondante ci-dessous, donc ils sont refuses avant d'atteindre le
 * controleur.
 */

/**
 * Les champs optionnels d'un formulaire multipart arrivent en CHAINE VIDE.
 *
 * Un navigateur qui envoie un `<select>` non renseigne, ou un `<input>` laisse
 * vide, transmet `visibility=` et non l'absence du champ. `@IsOptional()` de
 * class-validator ne saute que `null` et `undefined` : sans cette conversion, un
 * envoi parfaitement normal serait rejete avec un 400 sur `@IsEnum`, et
 * l'utilisateur lirait « visibility must be a valid enum value » en ayant
 * simplement laisse la valeur par defaut. La conversion est donc faite AVANT la
 * validation, la ou `plainToInstance` applique les `@Transform`.
 */
const emptyToUndefined = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  });

/** Bornes de saisie. Elles suivent les colonnes `String` du schema. */
const MAX_NAME_LENGTH = 200;
const MAX_ID_LENGTH = 40;

/**
 * Corps de `POST /api/documents`.
 *
 * LE FICHIER LUI-MEME N'EST PAS DECLARE ICI. Il arrive par le `FileInterceptor`
 * de multer, qui le pose sur `request.file` : il n'est pas un champ du corps, et
 * l'ajouter au DTO ferait croire qu'on peut le fournir en JSON. Le controleur
 * refuse explicitement une requete sans fichier — voir `documents.controller.ts`.
 *
 * `visibility` par defaut a INTERNAL, et c'est le sens de la securite. Un envoi
 * qui oublie ce champ produit un document interne : au pire il faut le partager
 * ensuite, ce qui est une action explicite et tracee. Le defaut inverse
 * publierait un brouillon au premier oubli, et un document partage ne se
 * « de-partage » pas — le client l'a deja telecharge.
 */
export class UploadDocumentDto {
  @ApiPropertyOptional({
    description: "Nom lisible du document. A defaut, le nom du fichier envoye, nettoye.",
    maxLength: MAX_NAME_LENGTH,
  })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional({ enum: DocumentCategory, default: DocumentCategory.OTHER })
  @emptyToUndefined()
  @IsOptional()
  @IsEnum(DocumentCategory, { message: 'Categorie de document inconnue.' })
  category?: DocumentCategory;

  @ApiPropertyOptional({
    enum: DocumentVisibility,
    default: DocumentVisibility.INTERNAL,
    description:
      'INTERNAL reste invisible a un porteur CLIENT, quelle que soit la permission detenue.',
  })
  @emptyToUndefined()
  @IsOptional()
  @IsEnum(DocumentVisibility, { message: 'Visibilite inconnue.' })
  visibility?: DocumentVisibility;

  @ApiPropertyOptional({ description: 'Rattache le document a un dossier client.' })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ID_LENGTH)
  clientId?: string;

  @ApiPropertyOptional({ description: 'Rattache le document a un projet.' })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ID_LENGTH)
  projectId?: string;

  @ApiPropertyOptional({ description: 'Rattache le document a une tache.' })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ID_LENGTH)
  taskId?: string;
}

/**
 * Corps de `PATCH /api/documents/:id`.
 *
 * Seule la METADONNEE est modifiable. `storageKey`, `mimeType`, `sizeBytes` et
 * `checksum` decrivent un objet deja ecrit dans le stockage : les changer en
 * base sans reecrire l'objet produirait une ligne qui ment sur son contenu, et
 * un telechargement qui rend autre chose que ce que la bibliotheque annonce.
 *
 * `visibility` est modifiable, et c'est l'interet de la route : partager un
 * document interne est une decision, elle se prend apres coup et laisse une
 * trace d'audit.
 */
export class UpdateDocumentDto {
  @ApiPropertyOptional({ maxLength: MAX_NAME_LENGTH })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Le nom ne peut pas etre vide.' })
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional({ enum: DocumentCategory })
  @emptyToUndefined()
  @IsOptional()
  @IsEnum(DocumentCategory, { message: 'Categorie de document inconnue.' })
  category?: DocumentCategory;

  @ApiPropertyOptional({ enum: DocumentVisibility })
  @emptyToUndefined()
  @IsOptional()
  @IsEnum(DocumentVisibility, { message: 'Visibilite inconnue.' })
  visibility?: DocumentVisibility;
}

/**
 * Filtres de `GET /api/documents`.
 *
 * Ces filtres RESTREIGNENT, ils n'AUTORISENT jamais. `?visibility=INTERNAL`
 * envoye par un porteur CLIENT ne lui ouvre pas l'interne : le service croise
 * les visibilites autorisees avec celle demandee, et refuse si elle n'y figure
 * pas (voir `narrowVisibilities`).
 *
 * `search` porte sur le nom et le nom d'origine. Volontairement PAS sur le
 * contenu : chercher dans le contenu demanderait d'extraire le texte des
 * fichiers, donc de les lire depuis le stockage, et une recherche qui ignore
 * silencieusement la moitie des documents est pire qu'une recherche absente.
 */
export class ListDocumentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DocumentCategory })
  @emptyToUndefined()
  @IsOptional()
  @IsEnum(DocumentCategory, { message: 'Categorie de document inconnue.' })
  category?: DocumentCategory;

  @ApiPropertyOptional({ enum: DocumentVisibility })
  @emptyToUndefined()
  @IsOptional()
  @IsEnum(DocumentVisibility, { message: 'Visibilite inconnue.' })
  visibility?: DocumentVisibility;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ID_LENGTH)
  clientId?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ID_LENGTH)
  projectId?: string;

  @ApiPropertyOptional()
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ID_LENGTH)
  taskId?: string;

  @ApiPropertyOptional({ description: 'Recherche sur le nom du document et le nom du fichier.' })
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Inclut les documents dont la date d expiration est depassee.',
  })
  // Ce filtre etait ecrit a la main, avec le commentaire qui allait bien et le
  // decorateur qui manquait : `?includeExpired=false` affichait les documents
  // expires. Le piege et sa mesure sont dans `common/dto/boolean-filter.ts`.
  @BooleanFilter({ message: 'Ce filtre attend true ou false.' })
  includeExpired?: boolean;
}
