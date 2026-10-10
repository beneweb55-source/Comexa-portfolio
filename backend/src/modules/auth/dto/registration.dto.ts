import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../../common/security/password.js';
import { IsStrongPassword } from './is-strong-password.decorator.js';

const EMAIL_MAX_LENGTH = 320; // 254 pour la partie adresse + marge pour le domaine.

/**
 * Inscription libre.
 *
 * Le formulaire ne decide JAMAIS des privileges : il n'y a ici ni role, ni
 * `clientId`, ni statut. Le compte cree n'a aucun role et reste inactif tant que
 * l'adresse e-mail n'a pas ete verifiee.
 */
export class RegisterDto {
  @ApiProperty({ example: 'Amina' })
  @IsString({ message: 'Le prenom est obligatoire.' })
  @MinLength(2, { message: 'Le prenom est trop court.' })
  @MaxLength(60)
  firstName!: string;

  @ApiProperty({ example: 'Benali' })
  @IsString({ message: 'Le nom est obligatoire.' })
  @MinLength(2, { message: 'Le nom est trop court.' })
  @MaxLength(60)
  lastName!: string;

  @ApiProperty({ example: 'amina@exemple.dz', maxLength: EMAIL_MAX_LENGTH })
  @IsEmail({}, { message: "L'adresse e-mail n'est pas valide." })
  @MaxLength(EMAIL_MAX_LENGTH, { message: "L'adresse e-mail est trop longue." })
  email!: string;

  @ApiProperty()
  @IsStrongPassword()
  password!: string;

  @ApiProperty()
  @IsString({ message: 'La confirmation est obligatoire.' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  confirmPassword!: string;

  @ApiProperty({ example: 'DZ', description: 'Pays de residence, code ISO a deux lettres.' })
  @IsString({ message: 'Le pays est obligatoire.' })
  @Length(2, 2, { message: 'Le pays doit etre un code a deux lettres (ex. DZ).' })
  @Matches(/^[A-Za-z]{2}$/, { message: 'Le pays doit etre un code a deux lettres (ex. DZ).' })
  country!: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Jeton recu par e-mail.' })
  @IsString({ message: 'Le jeton est obligatoire.' })
  @MinLength(16, { message: 'Le jeton est invalide.' })
  @MaxLength(500)
  token!: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'amina@exemple.dz' })
  @IsEmail({}, { message: "L'adresse e-mail n'est pas valide." })
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;
}
