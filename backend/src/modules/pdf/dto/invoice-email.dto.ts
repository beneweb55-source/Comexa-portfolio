import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString } from 'class-validator';

/**
 * DTO pour l'envoi d'une facture/devis par email
 */
export class SendDocumentEmailDto {
  @ApiProperty({ description: 'ID du document (facture ou devis)' })
  @IsString()
  documentId!: string;

  @ApiProperty({ description: 'Type de document', enum: ['invoice', 'quote'] })
  @IsString()
  documentType!: 'invoice' | 'quote';

  @ApiProperty({ description: 'Adresse email du destinataire' })
  @IsEmail()
  to!: string;

  @ApiPropertyOptional({ description: 'Sujet personnalisé' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional({ description: 'Message personnalisé (HTML)' })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional({ description: 'Inclure le PDF en pièce jointe', default: true })
  @IsOptional()
  @IsBoolean()
  includePdf?: boolean;

  @ApiPropertyOptional({ description: 'Langue du PDF', enum: ['fr', 'en', 'ar'], default: 'fr' })
  @IsOptional()
  @IsString()
  language?: 'fr' | 'en' | 'ar';
}
