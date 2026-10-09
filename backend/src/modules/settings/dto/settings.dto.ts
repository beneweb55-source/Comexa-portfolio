import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BooleanFilter } from '../../../common/dto/boolean-filter.js';
import { SETTING_KEY_MAX_LENGTH, SETTING_KEY_PATTERN } from '../settings-policy.js';

/**
 * CONTRAT DES PARAMETRES.
 *
 * `forbidNonWhitelisted` est actif : un champ non declare ici fait echouer la
 * requete en 400. C'est ce qui empeche d'ecrire dans la table des parametres par
 * un champ qu'on aurait oublie de declarer — la liste des champs modifiables est
 * exactement celle de ce fichier, et rien d'autre.
 *
 * `value` est volontairement de type `unknown` : une colonne `Json` accepte
 * n'importe quelle forme, et la declarer ici en `string` ou en `number` mentirait
 * sur le contrat. Sa validation n'est donc pas deleguee a class-validator mais a
 * `normalizeSettingValue`, qui refuse ce que JSON ne sait pas representer.
 */

/** Nombre maximal de parametres modifies en un seul appel. */
export const SETTINGS_BATCH_MAX_ITEMS = 50;

/** Longueur maximale d'une description. */
export const SETTING_DESCRIPTION_MAX_LENGTH = 300;

export class SettingsQueryDto {
  @ApiPropertyOptional({
    description: 'Inclut les parametres internes. Reserve aux porteurs de `setting:write:any`.',
    default: false,
  })
  // Transformation explicite : sans elle, `?includeInternal=false` afficherait
  // les parametres internes a qui demandait a ne pas les voir. Le piege et sa
  // mesure sont documentes une seule fois, dans `common/dto/boolean-filter.ts`.
  @BooleanFilter({ message: 'includeInternal doit valoir true ou false.' })
  includeInternal?: boolean;
}

export class SettingItemDto {
  @ApiProperty({
    example: 'invoice.numbering.prefix',
    description: `Minuscules, segments separes par . - _ (maximum ${SETTING_KEY_MAX_LENGTH} caracteres).`,
  })
  @IsString()
  @MaxLength(SETTING_KEY_MAX_LENGTH, {
    message: `Une cle de parametre ne depasse pas ${SETTING_KEY_MAX_LENGTH} caracteres.`,
  })
  @Matches(SETTING_KEY_PATTERN, {
    message:
      'Cle invalide : minuscules, segments separes par . - _ (ex. invoice.numbering.prefix).',
  })
  key!: string;

  @ApiProperty({
    type: Object,
    description: 'Valeur JSON : chaine, nombre fini, booleen, tableau ou objet simple.',
  })
  @IsDefined({ message: 'Un parametre doit avoir une valeur.' })
  value!: unknown;

  @ApiPropertyOptional({ description: 'A quoi sert ce parametre.' })
  @IsOptional()
  @IsString()
  @MaxLength(SETTING_DESCRIPTION_MAX_LENGTH)
  description?: string;
}

export class UpdateSettingsDto {
  @ApiProperty({
    type: [SettingItemDto],
    description: `Parametres a creer ou a modifier, en une seule transaction (maximum ${SETTINGS_BATCH_MAX_ITEMS}).`,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Aucun parametre a enregistrer.' })
  @ArrayMaxSize(SETTINGS_BATCH_MAX_ITEMS, {
    message: `Un enregistrement porte sur ${SETTINGS_BATCH_MAX_ITEMS} parametres au plus.`,
  })
  @ValidateNested({ each: true })
  @Type(() => SettingItemDto)
  settings!: SettingItemDto[];
}
