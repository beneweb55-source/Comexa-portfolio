import { applyDecorators } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * ============================================================================
 * UN FILTRE BOOLEEN D'URL OU DE FORMULAIRE — LE PIEGE, ET LE SEUL ENDROIT OU
 * IL EST RACONTE.
 * ============================================================================
 *
 * ----------------------------------------------------------------------------
 * LE DEFAUT
 * ----------------------------------------------------------------------------
 * `configureApp` (`src/app.setup.ts`) monte le `ValidationPipe` global avec :
 *
 *     { whitelist: true, forbidNonWhitelisted: true, transform: true,
 *       transformOptions: { enableImplicitConversion: true } }
 *
 * `enableImplicitConversion` est necessaire — c'est lui qui fait d'un
 * `?perPage=20` un nombre, et `PaginationQueryDto` compte dessus. Mais il a un
 * effet de bord que personne n'attend : class-transformer 0.5.1 convertit la
 * valeur d'apres la metadonnee `design:type` emise par `tsc`, et il le fait
 * AVANT d'appliquer les `@Transform` du DTO. Le code est sans ambiguite, dans
 * `TransformOperationExecutor.transform` (branche `PLAIN_TO_CLASS`) :
 *
 *     finalValue = this.transform(subSource, subValue, type, ...);   // type = Boolean
 *     finalValue = this.applyCustomTransformations(finalValue, ...); // le @Transform recoit deja un booleen
 *
 * Or la coercition booleenne de class-transformer est `Boolean(value)`. Donc :
 *
 *     'false' -> Boolean('false') -> true      <-- LE FILTRE EST INVERSE
 *     'true'  -> Boolean('true')  -> true
 *     ''      -> Boolean('')      -> false
 *     absent  -> undefined
 *
 * Un `@Transform` ecrit naivement `(v) => v === true || v === 'true'` est du
 * CODE MORT : il ne voit jamais la chaine. Il recoit le booleen deja fausse, et
 * rend donc `true` pour `'false'`.
 *
 * Ce n'est pas une curiosite theorique, c'est la cause d'une famille de bogues
 * silencieux, mesures sur le pipe reel et sur les DTO compiles (`.e2e-build`) :
 * `?read=false` renvoyait les notifications LUES, `?includeExpired=false`
 * affichait les documents expires, `?includeArchived=false` incluait les
 * conversations archivees, et un corps `{ "isPublished": "false" }` PUBLIAIT au
 * lieu de depublier. Une propriete booleenne sans aucun `@Transform` subit la
 * meme coercition : `?isActive=false` etait lu `true` partout dans l'API.
 *
 * ----------------------------------------------------------------------------
 * LE CORRECTIF, ET POURQUOI IL TIENT EN DEUX DECORATEURS
 * ----------------------------------------------------------------------------
 * `@Type(() => String)` declare explicitement la metadonnee de type de la
 * propriete. class-transformer la trouve AVANT de regarder `design:type` (le
 * `findTypeMetadata` de `TransformOperationExecutor` precede la branche
 * `enableImplicitConversion`), donc la conversion implicite porte desormais sur
 * `String` et non sur `Boolean` : la valeur arrive INTACTE au `@Transform`.
 *
 * Le `@Transform` ci-dessous fait alors son travail — rendre `false` pour
 * `'false'`, `false` pour `''`, `true` pour `'true'` — et il reste juste meme si
 * la conversion implicite n'a pas lieu (valeur deja booleenne, ou metadonnee
 * absente). C'est volontaire : la fonction est defensive des deux cotes.
 *
 * La propriete reste declaree `boolean` : `String` ne decrit que la forme
 * d'ARRIVEE (un parametre de requete est toujours une chaine), jamais la valeur
 * apres conversion, qui est celle que voient le validateur et le service.
 *
 * ----------------------------------------------------------------------------
 * CE QUE CE FICHIER N'EST PAS
 * ----------------------------------------------------------------------------
 * Il n'est PAS un contournement du `enableImplicitConversion` global : celui-ci
 * reste en place, et c'est lui qui gere les nombres. Il n'est pas non plus une
 * seconde couche de validation : `@IsBoolean` est la, et le contrat est le meme
 * partout.
 *
 * Un `@Transform` local ecrit a la main sur un booleen est un bogue en attente,
 * meme quand son commentaire affirme le contraire : il faut `@Type(() => String)`
 * AVANT, et cet oubli est invisible a la lecture. Passer par ce decorateur est
 * la seule forme qui ne peut pas l'oublier.
 *
 * ----------------------------------------------------------------------------
 * LA MESURE
 * ----------------------------------------------------------------------------
 * La table de verite de ce contrat a ete etablie contre le vrai
 * `ValidationPipe` : elle couvre les trente et une proprietes booleennes
 * d'entree de `src/`. Ce fichier a ete ecrit AVANT le correctif, et le contrat
 * etait alors rouge sur trente d'entre elles.
 */

/** Message par defaut du validateur. Les sites qui veulent mieux le surchargent. */
export const BOOLEAN_FILTER_MESSAGE = 'Ce filtre attend true ou false.';

export interface BooleanFilterOptions {
  /**
   * Le champ est OBLIGATOIRE (`champ!: boolean`).
   *
   * `@IsOptional()` rendrait un corps vide valide, et le service lirait alors
   * `undefined` en croyant lire un booleen : sur `ModerateContentDto`, un corps
   * `{}` depublierait un temoignage au lieu d'etre refuse. Le champ doit rester
   * exige, donc la seule difference est ici.
   */
  readonly required?: boolean;
  /** Message de `@IsBoolean`. */
  readonly message?: string;
}

/**
 * La valeur brute d'un filtre booleen, ramenee a `true`, `false` ou `undefined`.
 *
 * - `'false'` -> `false`, `'true'` -> `true` (et la casse est tolerée) ;
 * - `''` (et l'espace seul) -> `false` : un formulaire qui envoie `champ=`
 *   signifie « decoche », pas « absent » ;
 * - absent, `null` -> `undefined` : absent veut dire ABSENT. C'est ce que lit
 *   `@IsOptional()`, et c'est ce qui laisse un filtre a trois etats
 *   (`ContentListQueryDto.active`) ne rien filtrer quand on ne lui demande rien ;
 * - tout le reste est rendu TEL QUEL, pour que `@IsBoolean` le refuse avec un
 *   message clair. Le confondre avec `false` ferait passer une faute de frappe
 *   pour un choix delibere — c'est le sens du test qui exige un 400 sur
 *   `includeInternal=maybe`.
 *
 * `'1'` et `'0'` ne sont PAS acceptes, et c'est deliberé : le contrat est
 * `true`/`false`, comme le declare `@IsBoolean`. Un client qui envoie `1` recoit
 * un 400 explicite plutot qu'une interpretation devinee.
 */
export function parseBooleanFilter(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '') {
    return false;
  }
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  return value;
}

/**
 * Decorateur compose d'un filtre booleen d'entree.
 *
 * L'ORDRE DES DEUX PREMIERS DECORATEURS N'EST PAS COSMETIQUE : `@Type(() => String)`
 * doit etre declare, sinon la conversion implicite convertit en booleen avant le
 * `@Transform` et le filtre est inverse. Voir l'en-tete de ce fichier.
 *
 *     @ApiPropertyOptional({ description: 'Inclure les archives.' })
 *     @BooleanFilter()
 *     includeArchived?: boolean;
 */
export function BooleanFilter(options: BooleanFilterOptions = {}): PropertyDecorator {
  return applyDecorators(
    Type(() => String),
    Transform(({ value }: { value: unknown }) => parseBooleanFilter(value)),
    ...(options.required === true ? [] : [IsOptional()]),
    IsBoolean({ message: options.message ?? BOOLEAN_FILTER_MESSAGE }),
  );
}
