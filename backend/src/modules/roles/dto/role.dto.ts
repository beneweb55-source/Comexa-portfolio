import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

/**
 * Contrats d'entree de la gestion des roles.
 *
 * CE FICHIER NE VALIDE QUE LA FORME, ET C'EST DELIBERE.
 *
 * `@IsIn(PERMISSION_CODES)` serait tentant : la liste des codes valides existe
 * deja dans `common/auth/permissions.catalogue.ts`, et l'import est a un chemin
 * de distance. Ce serait pourtant une erreur, pour deux raisons.
 *
 * 1. Le catalogue est une CONSTANTE de code, la table `permissions` est la
 *    VERITE en base. Une permission ajoutee au catalogue mais dont le seed n'a
 *    pas encore tourne serait acceptee par le DTO, puis echouerait a l'insertion
 *    sur une cle etrangere — un 500 ou un 422 technique, la ou on veut un refus
 *    explique. L'inverse — une permission retiree du catalogue mais encore en
 *    base — serait refusee a tort, et l'administration ne pourrait plus remettre
 *    une role dans l'etat ou il est deja.
 *
 * 2. Le message d'erreur doit nommer LES CODES FAUTIFS. `@IsIn` rend « chaque
 *    valeur doit etre l'une des valeurs autorisees », sans dire lesquelles ni
 *    combien. L'administrateur qui vient d'envoyer trente codes ne sait pas
 *    lequel corriger.
 *
 * La validation metier est donc dans `RoleService`, qui interroge la table. Ce
 * que le DTO garantit ici, c'est qu'on n'y arrive pas avec autre chose qu'un
 * tableau de chaines de longueur raisonnable — la forme minimale pour que la
 * requete soit sure.
 */

/** Bornes de forme. Le catalogue compte une centaine de codes. */
const PERMISSION_CODE_MAX_LENGTH = 120;
const MAX_PERMISSION_CODES = 500;

/**
 * Remplacement des permissions d'un role.
 *
 * PAS de `@ArrayNotEmpty` : vider un role de ses permissions est une operation
 * legitime — c'est ainsi qu'on retire un droit a tous ceux qui portent le role
 * sans avoir a les nommer un par un. Un role sans permission ne sert a rien,
 * mais ce n'est pas a la forme de la requete d'en juger.
 */
export class ReplaceRolePermissionsDto {
  @ApiProperty({
    type: [String],
    example: ['user:read:any', 'role:read:any'],
    description: "Codes du catalogue, tels qu'ils existent dans la table des permissions.",
  })
  @IsArray({ message: 'Les permissions doivent etre une liste.' })
  @ArrayMaxSize(MAX_PERMISSION_CODES, { message: 'Trop de permissions pour un seul role.' })
  @IsString({ each: true, message: 'Chaque permission doit etre un code texte.' })
  @MaxLength(PERMISSION_CODE_MAX_LENGTH, {
    each: true,
    message: 'Un code de permission est trop long.',
  })
  permissionCodes!: string[];
}

/**
 * PAS DE DTO DE FILTRE POUR `GET /roles`, ET C'EST UN CHOIX.
 *
 * Les roles sont sept : ils tiennent sur un ecran. Les paginer obligerait
 * l'administration a parcourir des pages pour construire une simple liste
 * deroulante. Il n'y a donc aucun filtre a declarer — et un champ « options »
 * facultatif (`?includePermissions=true`) serait pire qu'inutile : avec
 * `forbidNonWhitelisted`, tout champ non declare fait echouer la requete, et un
 * booleen lu depuis une chaine de requete vaut `true` pour la chaine `'false'`.
 * Le detail d'un role, permissions comprises, est servi par `GET /roles/:code`.
 */
