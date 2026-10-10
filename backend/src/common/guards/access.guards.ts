import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  ALLOW_PASSWORD_CHANGE_REQUIRED_KEY,
  PERMISSIONS_ALL_KEY,
  PERMISSIONS_ANY_KEY,
  REQUEST_USER_KEY,
  SCOPED_BY_SERVICE_KEY,
  userFromRequest,
} from '../decorators/auth.decorators.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { AppException, ErrorCode } from '../errors/app-error.js';
import { AccessPolicy, type AuthenticatedUser } from '../auth/principal.js';

/**
 * PORTE D'ENTREE UNIQUE DE L'AUTORISATION.
 *
 * Deux gardes, enregistres dans cet ordre via `APP_GUARD` dans `app.module.ts` :
 * d'abord l'authentification, ensuite les permissions. L'ordre n'est pas
 * cosmetique : le second lit ce que le premier a attache a la requete.
 *
 * REGLE PAR DEFAUT : TOUT EST FERME.
 *
 * Une route sans `@Public()` exige un jeton valide. C'est le sens inverse de la
 * plupart des didacticiels Nest (« tout est ouvert, on protege ce qui compte »),
 * et c'est delibere : dans le premier montage, oublier un decorateur sur une
 * route de facturation la publie silencieusement. Ici, oublier `@Public()` sur
 * une route destinee au public la rend inaccessible — le defaut se voit tout de
 * suite, et il echoue du bon cote.
 */

/**
 * Contrat de verification d'un access token.
 *
 * Le garde depend de cette interface, pas de la classe qui l'implemente. Deux
 * consequences : `src/common/` n'importe rien de `src/modules/`, et un test peut
 * fournir un verificateur de complaisance sans monter de module Nest.
 */
export interface AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<{ sub: string }>;
}

/** Contrat de chargement du porteur. */
export interface PrincipalLoader {
  /** Leve `UNAUTHENTICATED` si le compte est introuvable, suspendu ou archive. */
  load(userId: string): Promise<AuthenticatedUser>;
}

export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');
export const PRINCIPAL_LOADER = Symbol('PRINCIPAL_LOADER');

/**
 * Extrait le jeton d'acces.
 *
 * L'en-tete `Authorization` d'abord, puis le cookie `access_token`. Le cookie
 * sert au rendu cote serveur du frontend, ou l'en-tete n'est pas disponible.
 */
function extractAccessToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token.length > 0) return token;
  }

  const cookies = (request as Request & { cookies?: Record<string, unknown> }).cookies;
  const cookieToken = cookies?.['access_token'];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }

  return null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  /**
   * `@Inject(...)` EXPLICITE SUR LES DEUX INTERFACES — SANS QUOI RIEN NE MARCHE.
   *
   * TypeScript efface les interfaces a la compilation : elles n'existent pas au
   * runtime. La metadonnee `design:paramtypes`, que Nest lit pour savoir quoi
   * injecter, contient donc `Object` pour ces deux parametres — pas le jeton.
   * Nest ne peut rien resoudre et refuse de demarrer :
   *
   *     Nest can't resolve dependencies of the JwtAuthGuard (Reflector, ?, Object)
   *
   * Les jetons symboliques sont pourtant bien fournis par `AuthModule`. Le
   * probleme n'est pas le cablage, c'est que le constructeur ne DESIGNait pas
   * ces jetons. `@Inject` est le seul moyen de le faire pour une interface.
   *
   * C'est exactement le genre de defaut qu'aucune compilation ne signale : le
   * typage est correct, tout se compile, et la panne n'apparait qu'au demarrage
   * de l'application reelle.
   */
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
    @Inject(PRINCIPAL_LOADER) private readonly principals: PrincipalLoader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Les passerelles WebSocket ont leur propre poignee de main : le jeton
    // arrive dans `handshake.auth`, pas dans une requete HTTP. Traite ailleurs.
    if (context.getType() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const token = extractAccessToken(request);

    if (isPublic) {
      // Sur une route publique, on resout quand meme le porteur s'il y a un
      // jeton. Un jeton INVALIDE n'est pas une erreur ici : on ignore le porteur
      // et on laisse passer, car la route ne depend pas de lui. L'asymetrie est
      // volontaire — un jeton perime ne casse pas une page publique, et une
      // route protegee ne se satisfait jamais d'une absence.
      if (token) {
        try {
          const user = await this.resolveUser(token);
          (request as Request & Record<string, unknown>)[REQUEST_USER_KEY] = user;
        } catch {
          this.logger.debug('Jeton ignore sur une route publique');
        }
      }
      return true;
    }

    if (!token) {
      throw AppException.unauthenticated();
    }

    const user = await this.resolveUser(token);
    (request as Request & Record<string, unknown>)[REQUEST_USER_KEY] = user;

    // Mot de passe initial non change : tout est ferme sauf ce qui permet d'en
    // sortir. C'est le serveur qui decide, pas l'interface — un appel direct a
    // l'API avec le jeton d'un compte fraichement cree doit echouer ici.
    if (user.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean>(
        ALLOW_PASSWORD_CHANGE_REQUIRED_KEY,
        [context.getHandler(), context.getClass()],
      );

      if (!allowed) {
        throw new AppException(
          ErrorCode.PASSWORD_CHANGE_REQUIRED,
          'Vous devez definir un nouveau mot de passe avant de continuer.',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    return true;
  }

  /**
   * Verifie la signature, puis recharge le porteur depuis la base.
   *
   * La signature seule ne suffit pas : elle prouve qu'un jeton a ete emis par
   * nous, pas que le compte est encore autorise a agir. Entre l'emission et
   * maintenant, le compte a pu etre suspendu, supprime, ou ses roles retires.
   * C'est ce rechargement qui rend la revocation immediate.
   */
  private async resolveUser(token: string): Promise<AuthenticatedUser> {
    const payload = await this.verifier.verifyAccessToken(token);
    return this.principals.load(payload.sub);
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    // Liste dont le service restreint les lignes (voir `ScopedByService`).
    const scopedByService = this.reflector.getAllAndOverride<boolean>(SCOPED_BY_SERVICE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (scopedByService) {
      return true;
    }

    const requiredAll = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_ALL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAny = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_ANY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Aucune permission exigee : le garde d'authentification a deja fait son
    // travail, il n'y a rien a verifier de plus ici.
    if (!requiredAll?.length && !requiredAny?.length) {
      return true;
    }

    const user = userFromRequest(context.switchToHttp().getRequest<unknown>());
    if (!user) {
      // Ne devrait pas arriver : sans `@Public()`, le garde precedent a deja
      // exige un jeton. On refuse quand meme plutot que de laisser passer — une
      // incoherence entre les deux gardes ne doit pas ouvrir un acces.
      throw AppException.unauthenticated();
    }

    const policy = new AccessPolicy(user);

    if (requiredAll?.length && !policy.hasAll(requiredAll)) {
      throw AppException.forbidden(`Droit insuffisant : ${requiredAll.join(', ')}`);
    }

    if (requiredAny?.length && !policy.hasAny(requiredAny)) {
      throw AppException.forbidden(`Droit insuffisant : ${requiredAny.join(', ')}`);
    }

    return true;
  }
}
