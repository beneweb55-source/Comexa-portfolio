import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Paginated } from '../interceptors/transform.interceptor.js';

/**
 * `Paginated<T>` est REEXPORTE ici, et c'est deliberé.
 *
 * Le type est declare avec `TransformInterceptor`, qui est ce qui deplace `meta`
 * hors de `data` a la serialisation : c'est sa vraie place, et il y reste. Mais
 * `paginated()` ci-dessous en est le seul producteur, donc un module qui appelle
 * `paginated()` a besoin de nommer le type de ce qu'il renvoie — et il le
 * cherchera naturellement dans ce fichier. Sans ce reexport, l'import echoue
 * avec « has no exported member named 'Paginated' », ce qui n'oriente pas vers
 * un chemin d'import different.
 *
 * Reexport de TYPE uniquement (`export type`) : rien n'entre dans le paquet a
 * l'execution, et la declaration reste unique.
 */
export type { Paginated };

/**
 * PAGINATION — contrat commun a toutes les listes de l'API.
 *
 * Ce fichier existe parce que chaque module reecrivait sinon sa propre
 * pagination, avec deux consequences previsibles : des plafonds differents d'une
 * route a l'autre, et un `totalPages` calcule tantot avec `Math.ceil`, tantot
 * avec un arrondi entier. Le frontend, lui, lit `meta` de la meme facon partout.
 */

export const DEFAULT_PER_PAGE = 20;

/**
 * Plafond volontairement bas.
 *
 * Sans lui, `?perPage=1000000` transforme une liste en export complet de la
 * table : c'est a la fois un deni de service (la reponse est construite en
 * memoire) et une fuite de donnees faciles a aspirer. Un client qui veut tout
 * doit paginer, ce qui laisse une trace consultable.
 */
export const MAX_PER_PAGE = 100;

/**
 * `page` et `perPage` sont declares OPTIONNELS, et c'est important.
 *
 * Les ecrire `page: number = 1` les ferait typer `number` alors qu'a l'execution
 * la valeur peut tres bien etre `undefined` : `plainToInstance` n'applique PAS
 * les valeurs par defaut des initialiseurs (il faudrait `exposeDefaultValues`).
 * Le typage mentirait donc, et le premier `page - 1` produirait un `NaN` envoye
 * tel quel a Prisma. C'est exactement le piege rencontre sur `RefreshDto`, ou un
 * champ marque optionnel ne l'etait pas pour le validateur.
 *
 * Le type dit donc la verite, et `resolvePagination` applique les defauts.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'Page demandee (commence a 1).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Le numero de page doit etre un entier.' })
  @Min(1, { message: 'La page commence a 1.' })
  page?: number;

  @ApiPropertyOptional({
    default: DEFAULT_PER_PAGE,
    minimum: 1,
    maximum: MAX_PER_PAGE,
    description: `Elements par page (maximum ${MAX_PER_PAGE}).`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Le nombre par page doit etre un entier.' })
  @Min(1, { message: 'Au moins un element par page.' })
  @Max(MAX_PER_PAGE, { message: `Maximum ${MAX_PER_PAGE} elements par page.` })
  perPage?: number;
}

/** Pagination resolue, prete pour Prisma (`skip` / `take`). */
export interface ResolvedPagination {
  page: number;
  perPage: number;
  skip: number;
  take: number;
}

/**
 * Applique les defauts et borne les valeurs.
 *
 * Le garde de validation refuse deja `perPage=0` ou `perPage=abc`, mais cette
 * fonction reste defensive : elle est aussi appelee avec des valeurs venant de
 * la couche de service (exports internes, taches planifiees), ou aucun
 * `ValidationPipe` n'est passe.
 */
export function resolvePagination(query?: PaginationQueryDto): ResolvedPagination {
  const rawPage = Number(query?.page);
  const rawPerPage = Number(query?.perPage);

  // `Number.isFinite` plutot que `??` : `NaN` n'est pas `null`, il passerait
  // donc le test de nullite et contaminerait tout le calcul.
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.trunc(rawPage)) : 1;
  const perPage = Number.isFinite(rawPerPage)
    ? Math.min(MAX_PER_PAGE, Math.max(1, Math.trunc(rawPerPage)))
    : DEFAULT_PER_PAGE;

  return { page, perPage, skip: (page - 1) * perPage, take: perPage };
}

/**
 * Emballe une page de resultats dans la forme attendue par
 * `TransformInterceptor`, qui deplacera `meta` hors de `data`.
 *
 * `total` est le compte TOTAL (avant `skip`/`take`), pas la taille du tableau :
 * c'est ce que le frontend utilise pour afficher le nombre de pages.
 */
export function paginated<T>(
  items: T[],
  total: number,
  pagination: ResolvedPagination,
): Paginated<T> {
  return {
    items,
    meta: {
      page: pagination.page,
      perPage: pagination.perPage,
      total,
      // Zero resultat signifie zero page, pas une page vide : sinon le
      // frontend affiche « page 1 sur 1 » sur une liste qui n'existe pas.
      totalPages: total === 0 ? 0 : Math.ceil(total / pagination.perPage),
    },
  };
}
