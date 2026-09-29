import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { RoleCode, UserStatus } from '../../../generated/prisma/enums.js';

/**
 * Contrats d'entree de l'administration des comptes.
 *
 * `forbidNonWhitelisted` est actif : un champ non declare ici fait ECHOUER la
 * requete. C'est ce qui empeche d'envoyer `{ ..., status: 'ACTIVE', roleId:
 * '...' }` en esperant qu'un service distrait le recopie — le statut se change
 * par `POST /users/:id/suspend` et `reactivate`, les roles par
 * `POST /users/:id/roles`, jamais par une mise a jour de profil.
 */

const EMAIL_MAX_LENGTH = 320; // 254 pour l'adresse + marge pour le domaine.
const NAME_MAX_LENGTH = 100;
const PHONE_MAX_LENGTH = 32;
const SEARCH_MAX_LENGTH = 120;

/**
 * Borne des identifiants, comme partout ailleurs dans le projet (`messaging`,
 * `prospects`, `clients`) : un cuid fait ~25 caracteres aujourd'hui, 64 laisse
 * la marge necessaire sans ouvrir un champ de texte libre a la place d'un
 * identifiant.
 */
const ID_MAX_LENGTH = 64;

/**
 * Adresse normalisee DES LA VALIDATION.
 *
 * Sans cela, `Jean@Exemple.fr` et `jean@exemple.fr` seraient deux valeurs
 * distinctes pour la contrainte d'unicite de PostgreSQL — qui, elle, compare
 * octet par octet. On obtiendrait deux comptes pour une meme personne, et la
 * connexion (qui normalise de son cote, voir `AuthService.login`) enverrait
 * toujours sur le premier. La normalisation est faite ici ET dans le service :
 * le DTO couvre le chemin HTTP, le service couvre tout le reste.
 */
function toNormalisedEmail({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

/**
 * Identifiant debarrasse de ses espaces.
 *
 * `null` et `undefined` traversent tels quels : ce sont deux valeurs
 * PORTEUSES DE SENS pour `clientId` (voir `UpdateUserDto`). Les transformer en
 * chaine vide effacerait la distinction que la validation doit justement
 * preserver.
 */
function toTrimmedIdentifier({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateUserDto {
  @ApiProperty({ example: 'sofia.benali@comexa.example', maxLength: EMAIL_MAX_LENGTH })
  @Transform(toNormalisedEmail)
  @IsEmail({}, { message: "L'adresse e-mail n'est pas valide." })
  @MaxLength(EMAIL_MAX_LENGTH, { message: "L'adresse e-mail est trop longue." })
  email!: string;

  @ApiProperty({ example: 'Sofia' })
  @IsString({ message: 'Le prenom est obligatoire.' })
  @MinLength(1, { message: 'Le prenom est obligatoire.' })
  @MaxLength(NAME_MAX_LENGTH)
  firstName!: string;

  @ApiProperty({ example: 'Benali' })
  @IsString({ message: 'Le nom est obligatoire.' })
  @MinLength(1, { message: 'Le nom est obligatoire.' })
  @MaxLength(NAME_MAX_LENGTH)
  lastName!: string;

  @ApiPropertyOptional({ example: '+33 6 12 34 56 78' })
  @IsOptional()
  @IsString()
  @MaxLength(PHONE_MAX_LENGTH)
  phone?: string;

  /**
   * RATTACHEMENT A UN DOSSIER CLIENT.
   *
   * Sans ce champ, un compte CLIENT cree par l'API nait SANS PERIMETRE : il se
   * connecte, et `client-scope.ts` lui refuse tout acces faute de savoir de quel
   * dossier il releve. Le compte est alors inutilisable, et le seul moyen de le
   * rattacher est une ecriture directe en base — ce qu'aucun appelant de l'API
   * ne peut faire. C'est precisement le trou que ce champ ferme.
   *
   * Le champ reste FACULTATIF : un compte CLIENT sans dossier est un etat de
   * transition legitime (le dossier n'existe pas encore), et il est INERTE —
   * toutes les routes de l'espace client le refusent avec un message explicite.
   * L'etat dangereux est l'inverse (un `clientId` sur un compte sans le role
   * CLIENT) : il est refuse par `identity-rules.ts`, voir
   * `assertClientScopeRequiresClientRole`.
   *
   * Le dossier doit exister, ne pas etre supprime logiquement, et le porteur
   * doit pouvoir le lire : trois verifications faites par le service, qui
   * repondent respectivement 404 `CLIENT_NOT_FOUND` et 403 `FORBIDDEN`.
   */
  @ApiPropertyOptional({
    example: 'clx0a1b2c3d4e5f6g7h8i9j0k',
    maxLength: ID_MAX_LENGTH,
    description: 'Dossier client a rattacher (comptes CLIENT uniquement).',
  })
  @IsOptional()
  @Transform(toTrimmedIdentifier)
  @IsString()
  @MinLength(1, { message: "L'identifiant du dossier client ne peut pas etre vide." })
  @MaxLength(ID_MAX_LENGTH, { message: "L'identifiant du dossier client est trop long." })
  clientId?: string;

  /**
   * ROLES OBLIGATOIRES, ET AU MOINS UN.
   *
   * Un compte sans role n'a AUCUNE permission : il peut se connecter et
   * n'ouvrir que son propre profil. Le creer ainsi ne rendrait service a
   * personne et declencherait un ticket de support a la premiere connexion. Si
   * l'on veut vraiment couper les droits d'un compte, on le suspend ou on lui
   * retire ses roles explicitement — pas en le creant vide.
   *
   * Le mot de passe n'est PAS une entree : il est genere par le serveur. Un
   * administrateur qui choisirait le mot de passe d'un tiers le connaitrait, et
   * le transmettrait par un canal qu'on ne maitrise pas.
   */
  @ApiProperty({ enum: RoleCode, isArray: true, example: ['DEVELOPER'] })
  @IsArray({ message: 'Les roles doivent etre une liste.' })
  @ArrayNotEmpty({ message: 'Au moins un role est obligatoire.' })
  @ArrayMaxSize(Object.keys(RoleCode).length, { message: 'Trop de roles pour un seul compte.' })
  @IsEnum(RoleCode, { each: true, message: 'Role inconnu.' })
  roleCodes!: RoleCode[];
}

/**
 * Mise a jour d'un profil.
 *
 * Tous les champs sont facultatifs : une mise a jour partielle ne doit pas
 * obliger le client a renvoyer ce qu'il ne change pas — il pourrait ecraser une
 * valeur modifiee entre-temps par quelqu'un d'autre.
 *
 * Le statut et les roles n'y figurent PAS, volontairement : ce sont des
 * operations distinctes, avec leurs propres regles (revocation de session,
 * protection du dernier administrateur). Les melanger a une mise a jour de
 * profil rendrait ces regles contournables par un `PATCH` ordinaire.
 */
export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'sofia.benali@comexa.example', maxLength: EMAIL_MAX_LENGTH })
  @IsOptional()
  @Transform(toNormalisedEmail)
  @IsEmail({}, { message: "L'adresse e-mail n'est pas valide." })
  @MaxLength(EMAIL_MAX_LENGTH)
  email?: string;

  @ApiPropertyOptional({ example: 'Sofia' })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Le prenom ne peut pas etre vide.' })
  @MaxLength(NAME_MAX_LENGTH)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Benali' })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Le nom ne peut pas etre vide.' })
  @MaxLength(NAME_MAX_LENGTH)
  lastName?: string;

  /** Une chaine vide efface le numero (le service la traduit en `null`). */
  @ApiPropertyOptional({ example: '+33 6 12 34 56 78', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(PHONE_MAX_LENGTH)
  phone?: string;

  /**
   * RATTACHEMENT A UN DOSSIER CLIENT — TROIS ETATS, PAS DEUX.
   *
   *   - `clientId` ABSENT    : le rattachement n'est pas touche ;
   *   - `clientId: null`     : le rattachement est RETIRE ;
   *   - `clientId: "<cuid>"` : le compte est rattache a ce dossier.
   *
   * La distinction « absent » / « null » n'est pas une coquetterie de typage :
   * un champ qui vaudrait `null` par defaut ne permettrait pas de dire « detache
   * ce compte », et le seul moyen de retirer un rattachement serait une route
   * dediee — c'est-a-dire une operation de plus a securiser, a auditer et a
   * tester. Elle est portee par `@IsOptional()` (qui laisse passer `null` ET
   * `undefined`) puis par un test `!== undefined` dans le service : le DTO
   * transporte les deux valeurs, le service decide ce que chacune veut dire.
   *
   * Une chaine vide n'est NI l'un NI l'autre et n'est pas acceptee : c'est une
   * faute de saisie, pas une intention. `@MinLength(1)` la refuse en 400, avec un
   * message qui nomme la valeur a utiliser pour detacher.
   *
   * Le champ n'est PAS un champ d'identite ordinaire : il deplace le perimetre
   * de l'espace client, donc les donnees que le compte peut lire. Trois
   * verifications le gardent, dans cet ordre : le porteur doit pouvoir LIRE le
   * dossier vise (`client:read:any`, en plus de `user:write:any` exige par la
   * route) ; le compte doit porter le role CLIENT ; le dossier doit exister et ne
   * pas etre supprime logiquement. Retirer un rattachement n'exige que
   * `user:write:any` : il ne lit aucun dossier, et l'etat qu'il produit est
   * inerte.
   */
  @ApiPropertyOptional({
    nullable: true,
    maxLength: ID_MAX_LENGTH,
    description: 'Dossier client a rattacher. `null` pour detacher le compte.',
  })
  @IsOptional()
  @Transform(toTrimmedIdentifier)
  @IsString()
  @MinLength(1, {
    message:
      "L'identifiant du dossier client ne peut pas etre vide. Pour detacher le compte, " +
      'envoyez `null`.',
  })
  @MaxLength(ID_MAX_LENGTH, { message: "L'identifiant du dossier client est trop long." })
  clientId?: string | null;
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserStatus, description: 'Filtrer sur le statut du compte.' })
  @IsOptional()
  @IsEnum(UserStatus, { message: 'Statut de compte inconnu.' })
  status?: UserStatus;

  @ApiPropertyOptional({
    description: 'Recherche sur le nom, le prenom ou l\'adresse e-mail (partielle, insensible a la casse).',
    example: 'benali',
  })
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: RoleCode, description: 'Filtrer sur un role detenu.' })
  @IsOptional()
  @IsEnum(RoleCode, { message: 'Role inconnu.' })
  roleCode?: RoleCode;
}

/**
 * Remplacement des roles d'un compte.
 *
 * PAS de `@ArrayNotEmpty` : retirer tous les roles est une operation
 * legitime — c'est la facon de couper tous les droits sans suspendre le
 * compte. L'invariant qui compte (garder un administrateur capable d'agir) est
 * verifie par `identity-rules.ts`, pas par la forme de la requete.
 */
export class SetUserRolesDto {
  @ApiProperty({ enum: RoleCode, isArray: true, example: ['PROJECT_MANAGER', 'DEVELOPER'] })
  @IsArray({ message: 'Les roles doivent etre une liste.' })
  @ArrayMaxSize(Object.keys(RoleCode).length, { message: 'Trop de roles pour un seul compte.' })
  @IsEnum(RoleCode, { each: true, message: 'Role inconnu.' })
  roleCodes!: RoleCode[];
}
