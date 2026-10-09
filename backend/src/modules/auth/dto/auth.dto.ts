import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../../common/security/password.js';
import { IsStrongPassword } from './is-strong-password.decorator.js';

/**
 * Contrats d'entree de l'authentification.
 *
 * `main.ts` active `forbidNonWhitelisted` : un champ non declare ici fait
 * ECHOUER la requete au lieu d'etre ignore en silence. C'est voulu — un client
 * qui envoie `{ email, password, roleCode: 'ADMIN' }` doit apprendre tout de
 * suite que `roleCode` n'est pas une entree acceptee, plutot que de croire que
 * le serveur l'a peut-etre pris en compte.
 */

const EMAIL_MAX_LENGTH = 320; // 254 pour la partie adresse + marge pour le domaine.

export class LoginDto {
  @ApiProperty({ example: 'admin@comexa.example', maxLength: EMAIL_MAX_LENGTH })
  @IsEmail({}, { message: "L'adresse e-mail n'est pas valide." })
  @MaxLength(EMAIL_MAX_LENGTH, { message: "L'adresse e-mail est trop longue." })
  email!: string;

  // Volontairement AUCUNE contrainte de longueur minimale ici.
  //
  // La politique de mot de passe s'applique quand on EN CHOISIT un, pas quand on
  // presente un mot de passe existant. Refuser un mot de passe court a la
  // connexion ferait deux degats : cela revelerait la politique a un attaquant,
  // et cela enfermerait dehors tout compte dont le mot de passe precede la
  // politique — sans aucun moyen de se connecter pour le changer.
  @ApiProperty({ example: 'un-mot-de-passe-quelconque' })
  @IsString({ message: 'Le mot de passe est obligatoire.' })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: 'Le mot de passe est trop long.' })
  password!: string;
}

export class RefreshDto {
  /**
   * Facultatif — et `@IsOptional()` n'est pas une precaution de style.
   *
   * Le refresh token voyage normalement dans un cookie HttpOnly, que le
   * navigateur joint tout seul : le corps de la requete est donc VIDE dans le
   * cas nominal. Sans `@IsOptional()`, `@IsString()` s'appliquait a `undefined`
   * et refusait la requete avec un 400 — c'est-a-dire que le chemin principal
   * (cookie, sans corps) etait casse, alors que le commentaire ci-dessus
   * annoncait deja le contraire.
   *
   * Le defaut est invisible en lecture : le champ est bien marque optionnel par
   * son `?`, et le typage est correct. Seul un appel reel avec un corps vide le
   * revele.
   *
   * Le champ existe pour les clients qui ne gerent pas les cookies (application
   * mobile, tests d'integration).
   */
  @ApiProperty({ required: false, description: 'Omis si le cookie refresh_token est present.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  refreshToken?: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'client@exemple.example' })
  @IsEmail({}, { message: "L'adresse e-mail n'est pas valide." })
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Jeton recu par e-mail.' })
  @IsString({ message: 'Le jeton est obligatoire.' })
  @MinLength(16, { message: 'Le jeton est invalide.' })
  @MaxLength(500)
  token!: string;

  @ApiProperty()
  @IsStrongPassword()
  password!: string;

  @ApiProperty()
  @IsString({ message: 'La confirmation est obligatoire.' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  confirmPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString({ message: 'Le mot de passe actuel est obligatoire.' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @ApiProperty()
  @IsStrongPassword()
  newPassword!: string;

  @ApiProperty()
  @IsString({ message: 'La confirmation est obligatoire.' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  confirmPassword!: string;
}
