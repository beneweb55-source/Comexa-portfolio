import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { clientIp, clientUserAgent } from '../../common/http/client-ip.js';

/**
 * ORIGINE DE LA REQUETE, pour le journal d'audit et la signature d'un devis.
 *
 * La lecture elle-meme — ce qu'elle lit, ce que la valeur vaut, et le reglage
 * `TRUST_PROXY` — vit dans `common/http/client-ip.ts`. Ce fichier en portait une
 * copie ; il n'en reste que le decorateur, qui est propre a ce module.
 */
export interface RequestMetadata {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export const RequestContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestMetadata => {
    const request = context.switchToHttp().getRequest<Request>();

    return {
      ipAddress: clientIp(request),
      userAgent: clientUserAgent(request),
    };
  },
);
