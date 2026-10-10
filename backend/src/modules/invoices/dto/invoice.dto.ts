import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { InvoiceStatus } from '../../../generated/prisma/enums.js';

/**
 * CONTRATS D'ENTREE DES FACTURES.
 *
 * CE FICHIER NE PORTE AUCUN MONTANT, ET C'EST LA DECISION LA PLUS IMPORTANTE DE
 * TOUT LE MODULE DE FACTURATION.
 *
 * Une facture ne se saisit pas : elle se GENERE. Le seul chemin de creation
 * ouvre est `POST /quotes/:id/invoice`, qui part d'un devis ACCEPTE et en COPIE
 * les lignes. Les totaux sont recalcules cote serveur, a partir de ces lignes.
 *
 * Consequence directe : il n'existe aucun DTO par lequel un client pourrait
 * proposer un `total`, un `subtotal` ou un `taxAmount`. `forbidNonWhitelisted`
 * fait echouer la requete qui en enverrait un, et il n'y a pas de champ ou il
 * pourrait se glisser. La question « et si le client envoyait un total faux ? »
 * n'a donc pas de reponse a chercher dans le service : elle est fermee ici.
 *
 * Les seuls champs acceptes decrivent la FORME du document — dates, objet,
 * conditions — jamais son contenu chiffre.
 */

/** Une facture due DEPUIS COMBIEN de jours par defaut, faute d'echeance donnee. */
export const DEFAULT_PAYMENT_TERM_DAYS = 30;

const MAX_LABEL = 300;

export class CreateInvoiceFromQuoteDto {
  @ApiPropertyOptional({
    description: "Objet de la facture. Defaut : l'objet du devis facture.",
  })
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

  @ApiPropertyOptional({ description: 'Conditions de reglement imprimees sur la piece.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  terms?: string;

  @ApiPropertyOptional({ description: "Date d'emission. Defaut : aujourd'hui." })
  @IsOptional()
  @IsISO8601({}, { message: "La date d'emission n'est pas une date valide." })
  issueDate?: string;

  @ApiPropertyOptional({
    description: `Echeance de paiement. Defaut : date d'emission + ${DEFAULT_PAYMENT_TERM_DAYS} jours.`,
  })
  @IsOptional()
  @IsISO8601({}, { message: "La date d'echeance n'est pas une date valide." })
  dueDate?: string;
}

/** Filtres de liste. Un porteur CLIENT ne peut PAS elargir son perimetre ici. */
export class ListInvoicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus, { message: 'Statut de facture inconnu.' })
  status?: InvoiceStatus;

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
  projectId?: string;

  @ApiPropertyOptional({ description: 'Factures nees de ce devis.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  quoteId?: string;

  @ApiPropertyOptional({ description: 'Recherche sur la reference ou l objet.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
