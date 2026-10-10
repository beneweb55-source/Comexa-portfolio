import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { PublicCacheService } from './public-cache.service.js';

/**
 * Déclenche la purge du site public après toute écriture réussie.
 *
 * Le `tap` ne s'exécute qu'APRÈS que le handler a renvoyé sa réponse, donc après
 * l'écriture en base. Une écriture refusée (422, 404) ne purge rien.
 */
@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  constructor(private readonly publicCache: PublicCacheService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const method = context.switchToHttp().getRequest<Request>().method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next.handle();
    }
    return next.handle().pipe(tap(() => this.publicCache.purgePublicSite()));
  }
}
