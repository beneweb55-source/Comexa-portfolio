import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { clientIp, clientUserAgent } from '../../common/http/client-ip.js';

/**
 * Contexte de la requete, reduit a ce que le journal d'audit sait ecrire.
 *
 * CE FICHIER A DUPLIQUE `Session` DE `auth.controller.ts`, ET C'EST FINI.
 *
 * Son propre en-tete portait la consigne : « A FUSIONNER dans `src/common/` le
 * jour ou un troisieme module en aura besoin. » Trois modules en avaient besoin
 * (auth, factures, projets) et un quatrieme — les demandes de contact — ne
 * suivait pas la convention, ce qui a rendu le cout visible : il lisait
 * `request.ip` et enregistrait l'adresse du proxy. La lecture vit maintenant dans
 * `common/http/client-ip.ts`, avec le reglage `TRUST_PROXY`.
 *
 * Ce qui reste ici est ce qui est propre au module : le nom du decorateur.
 */
export interface RequestContext {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export const RequestMeta = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestContext => {
    const request = context.switchToHttp().getRequest<Request>();

    return {
      ipAddress: clientIp(request),
      userAgent: clientUserAgent(request),
    };
  },
);
