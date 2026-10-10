import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PUBLIC_CONTENT_PATHS, PUBLIC_CONTENT_TAG } from './public-cache.js';

@Injectable()
export class PublicCacheService {
  private readonly logger = new Logger(PublicCacheService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Demande la purge sans attendre le résultat : la réponse à l'agence ne doit
   * pas dépendre du frontend. Les erreurs sont journalisées et avalées.
   */
  purgePublicSite(): void {
    const secret = this.config.get<string>('REVALIDATE_SECRET');
    if (!secret) {
      this.logger.warn('REVALIDATE_SECRET absent : cache public non purgé (expiration naturelle, 1 h).');
      return;
    }

    const frontend = (this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');

    void this.post(`${frontend}/api/revalidate`, secret);
  }

  private async post(url: string, secret: string): Promise<void> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-revalidate-secret': secret,
        },
        body: JSON.stringify({ tags: [PUBLIC_CONTENT_TAG], paths: PUBLIC_CONTENT_PATHS }),
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) {
        this.logger.warn(`Purge du cache public refusée (HTTP ${response.status}).`);
      }
    } catch (caught) {
      this.logger.warn(`Purge du cache public impossible : ${(caught as Error).message}`);
    }
  }
}
