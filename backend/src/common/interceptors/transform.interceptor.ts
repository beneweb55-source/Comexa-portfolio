import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

/** Reponse de succes. Forme contractuelle, symetrique de `ApiErrorBody`. */
export interface ApiSuccessBody<T> {
  success: true;
  data: T;
  meta?: PaginatedMeta;
  /**
   * Message lisible, quand la route en produit un. Present sur les reponses
   * construites par `UrlBuilderService.buildResponse` — « Devis envoye » — et
   * absent sur les lectures simples, qui n'ont rien a annoncer.
   */
  message?: string;
  /** Page a ouvrir apres l'action, quand la route en designe une. */
  redirectUrl?: string;
  /** Ce que le front doit faire de `redirectUrl`, et dans quel onglet. */
  action?: RedirectAction;
}

/** Action post-action, telle que `buildResponse` la decrit. */
export interface RedirectAction {
  type: 'open_tab' | 'redirect' | 'refresh';
  url: string;
  target: '_blank' | '_self';
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
 * Reconnait une reponse produite par `UrlBuilderService.buildResponse`.
 *
 * CE TEST EST VOLONTAIREMENT ETROIT. Il exige les TROIS marques reunis :
 * `success: true`, un `message` qui soit une chaîne, et une clef `data`. Une
 * donnee metier qui porterait par hasard un champ `message` — un brouillon de
 * facture, un journal — n'est donc jamais prise pour une enveloppe, et son
 * `message` reste une donnee. C'est le seul cas ou ce test pourrait se tromper,
 * et il est assez improbable pour qu'on prefere ce risque a celui de l'inverse :
 * avaler la redirection.
 */
function isEnvelope(value: unknown): value is {
  success: true;
  message: string;
  data: unknown;
  redirectUrl?: string;
  action?: RedirectAction;
} {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.success === true &&
    typeof candidate.message === 'string' &&
    'data' in candidate
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
 *
 * LES ENVELOPPES DE `buildResponse` SONT APLATIES A LEUR TOUR, et c'etait le
 * defaut le plus discret de ce fichier. `buildResponse` rend deja
 * `{ success, message, data, redirectUrl, action }` : le placer tel quel dans
 * `data` donnait `{ success: true, data: { success: true, message, … } }`. Rien
 * ne cassait — pas d'erreur, pas de test rouge — mais `request()` lisait
 * `json.message`, `json.redirectUrl` et `json.action` a la racine, et ne
 * trouvait que `undefined`. Le systeme de redirection post-action etait donc
 * entierement fonctionnel cote serveur, et entierement muet cote client.
 *
 * L'aplatissement remonte `message`, `redirectUrl` et `action` au niveau
 * superieur, la ou le frontend les attend. `data` garde la charge utile, et
 * seulement elle.
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

        if (isEnvelope(payload)) {
          const body: ApiSuccessBody<unknown> = {
            success: true as const,
            data: (payload.data ?? null) as unknown,
            message: payload.message,
          };
          if (payload.redirectUrl !== undefined) body.redirectUrl = payload.redirectUrl;
          if (payload.action !== undefined) body.action = payload.action;
          return body as ApiSuccessBody<T>;
        }

        return { success: true as const, data: (payload ?? null) as T };
      }),
    );
  }
}
