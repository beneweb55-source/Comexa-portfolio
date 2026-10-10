import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

/** Reponse de succes. Forme contractuelle, symetrique de `ApiErrorBody`. */
export interface ApiSuccessBody<T> {
  success: true;
  data: T;
  meta?: PaginatedMeta;
}

/** Metadonnees de pagination, telles que le frontend les attend. */
export interface PaginatedMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

/** Ce que renvoie un service pour une liste paginee. */
export interface Paginated<T> {
  items: T[];
  meta: PaginatedMeta;
}

function isPaginated(value: unknown): value is Paginated<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    'meta' in value &&
    Array.isArray((value as Paginated<unknown>).items)
  );
}

/**
 * Enveloppe les reponses de succes dans `{ success: true, data }`.
 *
 * Pourquoi une enveloppe plutot que le corps brut : le frontend peut alors
 * traiter succes et echec avec le meme test (`if (body.success)`), sans savoir
 * a l'avance si le corps est un objet, un tableau ou `null`. Un `DELETE` qui ne
 * renvoie rien produit `data: null`, ce qui reste une reponse lisible.
 *
 * Les listes paginees sont aplaties : un service renvoie `{ items, meta }` et
 * le client recoit `{ success, data: [...], meta }` — les metadonnees sortent de
 * `data` parce qu'elles ne sont pas des donnees.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiSuccessBody<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccessBody<T>> {
    return next.handle().pipe(
      map((payload) => {
        if (isPaginated(payload)) {
          return {
            success: true as const,
            data: payload.items as unknown as T,
            meta: payload.meta,
          };
        }

        return { success: true as const, data: (payload ?? null) as T };
      }),
    );
  }
}
