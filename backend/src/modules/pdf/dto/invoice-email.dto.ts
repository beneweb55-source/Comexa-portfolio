import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString } from 'class-validator';

/**
 * Corps de `POST /pdf/invoices/:id/email` et `POST /pdf/quotes/:id/email`.
 *
 * IL N'Y A ICI NI `documentId` NI `documentType`. Ces deux champs étaient
 * déclarés obligatoires alors qu'aucun contrôleur ne les lit : l'identifiant
 * vient du paramètre de route, et le type de document, de la route elle-même.
 *
 * Le `ValidationPipe` global tourne en `whitelist` + `forbidNonWhitelisted` +
 * `transform` (voir `src/app.setup.ts`) : un champ obligatoire absent fait
 * échouer la requête en 400. Le frontend n'envoyait — à juste titre — que
 * `to`, `subject`, `message`, `includePdf` et `language`, donc CHAQUE envoi de
 * facture par email était rejeté avant d'atteindre le service. Le bouton
 * « Envoyer par Email » de l'aperçu PDF ne pouvait pas aboutir.
 *
 * Les conserver aurait en plus laissé un corps contredire sa propre route
 * (`documentType: 'quote'` sur `/pdf/invoices/:id/email`), écart que le
 * contrôleur aurait ignoré en silence.
 */
export class SendDocumentEmailDto {
  @ApiProperty({
    description: 'Adresse email du destinataire',
    example: 'contact@client.example',
  })
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
