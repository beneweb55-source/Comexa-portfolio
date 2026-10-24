/**
 * L'INTERCEPTEUR D'IDEMPOTENCE.
 *
 * -----------------------------------------------------------------------------
 * SANS EN-TETE, RIEN NE CHANGE — ET C'EST LA PROPRIETE QUI COMPTE
 * -----------------------------------------------------------------------------
 * L'intercepteur n'agit QUE si l'appelant envoie `Idempotency-Key`. Sans cet
 * en-tete, il laisse passer exactement comme avant : le web client standard ne
 * l'envoie pas ; seul le client desktop offline-first l'ajoute pour reprendre
 * ses mutations de façon idempotente.
 *
 * LES QUATRE CAS, ET LA REPONSE DE CHACUN :
 *
 *   - cle absente            -> on execute, sans rien enregistrer ;
 *   - cle inconnue           -> on execute, puis on memorise la reponse ;
 *   - cle connue, meme corps -> on REJOUE la reponse, sans reexecuter ;
 *   - cle connue, autre corps-> 422 IDEMPOTENCY_KEY_REUSED (jamais de mensonge).
 *
 * LA CLE APPARTIENT AU PORTEUR. L'unicite porte sur (portee, cle, porteur) : deux
 * integrations differentes peuvent employer la meme cle sans se marcher dessus,
 * et une machine ne peut pas lire — ni bloquer — les cles d'une autre.
 */
import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import { AppException } from '../errors/app-error.js';
import { userFromRequest } from '../decorators/auth.decorators.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_REPLAY_HEADER,
  fingerprintOf,
  idempotencyExpiry,
  normalizeIdempotencyKey,
} from './idempotency.js';

/** Cle de metadonnee : la portee de la cle d'idempotence. */
export const IDEMPOTENCY_SCOPE_KEY = 'idempotencyScope';

/**
 * La description de l'en-tete, pour la documentation.
 *
 * Exportee toute faite pour que les deux routes qui l'acceptent l'ecrivent a
 * l'identique : deux `@ApiHeader` recopies a la main finiraient par diverger, et
 * le contrat OpenAPI decrirait alors deux en-tetes differents pour une seule
 * mecanique.
 */
export const IDEMPOTENCY_API_HEADER = {
  name: 'Idempotency-Key',
  required: false,
  description:
    "Cle d'idempotence (8 a 128 caracteres, lettres, chiffres, tirets et soulignes). " +
    'Renvoyez la MEME cle pour reessayer une creation, jamais pour en faire une autre : ' +
    'le serveur rejoue alors la reponse au lieu de recreer la ressource. Une cle rejouee ' +
    'avec un autre corps est refusee en 422.',
  example: 'n8n-creation-tache-2026-10-13-001',
};

/**
 * Marque une route comme rejouable.
 *
 * `scope` distingue deux operations differentes qui partageraient une meme cle :
 * « creer une tache » et « creer un jalon » n'ont rien a voir, et un client qui
 * reutilise la meme chaine ne doit pas se voir rendre la reponse de l'autre.
 */
export const IdempotencyScope = (scope: string) => SetMetadata(IDEMPOTENCY_SCOPE_KEY, scope);

/** Ce que l'on memorise pour rejouer : le statut et le corps, rien d'autre. */
interface StoredResponse {
  readonly status: number;
  readonly body: unknown;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase()))
      return next.handle();
    const raw = request.headers[IDEMPOTENCY_HEADER];

    // Aucune cle : comportement d'avant, a l'octet pres.
    if (raw === undefined) {
      return next.handle();
    }

    const key = normalizeIdempotencyKey(raw);
    if (!key) {
      throw AppException.badRequest(
        'IDEMPOTENCY_KEY_INVALID',
        "L'en-tete Idempotency-Key est invalide : lettres, chiffres, tirets et soulignes, 8 a 128 caracteres.",
      );
    }

    const user = userFromRequest(request);
    if (!user) {
      // Impossible sur une route qui exige un jeton. Refuser plutot que
      // d'enregistrer une cle sans proprietaire, qui serait alors partagee.
      throw AppException.unauthenticated();
    }

    const scope = this.scopeOf(context);
    const hash = fingerprintOf(request.body);
    const longLivedOfflineOperation = request.headers['x-comexa-offline-operation'] === 'true';

    return from(this.acquire(scope, key, user.id, hash, longLivedOfflineOperation)).pipe(
      mergeMap((reponse) => {
        if (reponse) {
          const response = context.switchToHttp().getResponse<Response>();
          response.status(reponse.status);
          response.setHeader(IDEMPOTENCY_REPLAY_HEADER, 'true');
          return of(reponse.body);
        }

        return from(this.assertExpectedVersion(request)).pipe(
          mergeMap(() => next.handle()),
          mergeMap(async (payload) => {
            await this.remember(
              scope,
              key,
              user.id,
              hash,
              context,
              payload,
              longLivedOfflineOperation,
            );
            return payload;
          }),
          catchError((error: unknown) => {
            const status = error instanceof HttpException ? error.getStatus() : 500;
            if (status >= 400 && status < 500) {
              return from(this.release(scope, key, user.id)).pipe(
                mergeMap(() => throwError(() => error)),
              );
            }
            // 5xx: keep the reservation. A service may have committed a side
            // effect before failing; refusing replay is safer than duplicating it.
            return throwError(() => error);
          }),
        );
      }),
    );
  }

  /**
   * Compare la version lue hors connexion avant une ecriture rejouee. Les routes
   * non couvertes et les appels sans If-Match gardent leur comportement existant.
   */
  private async assertExpectedVersion(request: Request): Promise<void> {
    const raw = request.headers['if-match'];
    if (typeof raw !== 'string') return;
    const target = this.versionTarget(request.path);
    if (!target) return;
    const delegate = (
      this.prisma as unknown as Record<
        string,
        {
          findUnique(args: {
            where: { id: string };
            select: { updatedAt: true };
          }): Promise<{ updatedAt: Date } | null>;
        }
      >
    )[target.model];
    if (!delegate) return;
    const record = await delegate.findUnique({
      where: { id: target.id },
      select: { updatedAt: true },
    });
    const expected = raw.replace(/^W\//, '').replace(/^"|"$/g, '');
    const actual =
      record?.updatedAt instanceof Date
        ? record.updatedAt.toISOString()
        : String(record?.updatedAt ?? '');
    if (!record || actual !== expected) {
      throw AppException.conflict(
        'OFFLINE_VERSION_CONFLICT',
        'La donnée a été modifiée ou supprimée sur le serveur depuis sa dernière synchronisation.',
      );
    }
  }

  private versionTarget(path: string): { model: string; id: string } | null {
    const clean = (path.split('?')[0] ?? '').replace(/^\/api(?=\/)/, '');
    const routes: Array<[RegExp, string]> = [
      [/^\/projects\/([^/]+)(?:\/[^/]+)?$/, 'project'],
      [/^\/tasks\/([^/]+)(?:\/[^/]+)?$/, 'task'],
      [/^\/me\/goals\/([^/]+)$/, 'goal'],
      [/^\/me\/calendar\/events\/([^/]+)$/, 'calendarEvent'],
      [/^\/time-entries\/([^/]+)$/, 'timeEntry'],
      [/^\/clients\/([^/]+)$/, 'client'],
      [/^\/contacts\/([^/]+)$/, 'contact'],
      [/^\/clients\/[^/]+\/contacts\/([^/]+)$/, 'contact'],
      [/^\/prospects\/([^/]+)(?:\/status)?$/, 'prospect'],
      [/^\/milestones\/([^/]+)$/, 'milestone'],
      [/^\/documents\/([^/]+)$/, 'document'],
    ];
    for (const [pattern, model] of routes) {
      const match = clean.match(pattern);
      if (match?.[1]) return { model, id: decodeURIComponent(match[1]) };
    }
    return null;
  }

  /** La portee declaree par le decorateur, ou le nom du gestionnaire a defaut. */
  private scopeOf(context: ExecutionContext): string {
    const declared: string | undefined = Reflect.getMetadata(
      IDEMPOTENCY_SCOPE_KEY,
      context.getHandler(),
    );

    return declared ?? `${context.getClass().name}.${context.getHandler().name}`;
  }

  /**
   * Cherche une reponse deja rendue pour cette cle.
   *
   * LEVE 422 SI LA CLE EST REJOUEE AVEC UN AUTRE CORPS : rendre la reponse d'une
   * autre operation serait une tromperie, et reexecuter apres l'avoir promise
   * annulerait l'interet de la cle. Le refus est la seule reponse honnete.
   */
  private async existing(
    scope: string,
    key: string,
    principalId: string,
    hash: string,
  ): Promise<StoredResponse | null> {
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: { scope_key_principalId: { scope, key, principalId } },
      select: { requestHash: true, status: true, body: true, expiresAt: true },
    });

    if (!record) return null;

    // Une reservation de traitement n'expire pas automatiquement : apres un
    // crash serveur, il faut arbitrer plutôt que risquer une seconde écriture.
    if (record.status !== 102 && record.expiresAt.getTime() <= Date.now()) {
      await this.prisma.idempotencyRecord.delete({
        where: { scope_key_principalId: { scope, key, principalId } },
      });
      return null;
    }

    if (record.requestHash !== hash) {
      throw AppException.unprocessable(
        'IDEMPOTENCY_KEY_REUSED',
        "Cette cle d'idempotence a deja servi pour une autre requete. Generez une nouvelle cle.",
        { scope },
      );
    }

    if (record.status === 102) {
      throw AppException.conflict(
        'IDEMPOTENCY_OPERATION_IN_PROGRESS',
        "Cette opération est en cours ou doit être vérifiée après une interruption serveur. Elle n'a pas été rejouée pour éviter un doublon.",
      );
    }

    return { status: record.status, body: record.body };
  }

  private async acquire(
    scope: string,
    key: string,
    principalId: string,
    hash: string,
    longLivedOfflineOperation: boolean,
  ): Promise<StoredResponse | null> {
    const previous = await this.existing(scope, key, principalId, hash);
    if (previous) return previous;
    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          scope,
          key,
          principalId,
          requestHash: hash,
          status: 102,
          body: { state: 'processing' },
          expiresAt: idempotencyExpiry(
            new Date(),
            longLivedOfflineOperation ? 10 * 365 * 24 * 60 * 60 * 1000 : undefined,
          ),
        },
        select: { id: true },
      });
      return null;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        return this.existing(scope, key, principalId, hash);
      }
      throw error;
    }
  }

  private async release(scope: string, key: string, principalId: string): Promise<void> {
    await this.prisma.idempotencyRecord.deleteMany({
      where: { scope, key, principalId, status: 102 },
    });
  }

  /**
   * Memorise la reponse.
   *
   * SEULES LES REPONSES 2xx SONT MEMORISEES. Une erreur 400 ne doit pas etre
   * rejouee : le client corrige son corps et renvoie la meme cle, ce qui est
   * exactement l'usage legitime d'une cle d'idempotence.
   *
   * La reservation est creee avant l'execution ; si sa finalisation echoue, la
   * requete remonte en erreur et la reservation est conservee pour eviter un
   * rejeu susceptible de dupliquer un effet deja commis.
   */
  private async remember(
    scope: string,
    key: string,
    principalId: string,
    hash: string,
    context: ExecutionContext,
    payload: unknown,
    longLivedOfflineOperation = false,
  ): Promise<void> {
    const status = context.switchToHttp().getResponse<Response>().statusCode;
    if (status < 200 || status >= 300) return;

    try {
      await this.prisma.idempotencyRecord.update({
        where: { scope_key_principalId: { scope, key, principalId } },
        data: {
          requestHash: hash,
          status,
          body: (payload ?? null) as never,
          expiresAt: idempotencyExpiry(
            new Date(),
            longLivedOfflineOperation ? 10 * 365 * 24 * 60 * 60 * 1000 : undefined,
          ),
        },
        select: { id: true },
      });
    } catch (error) {
      this.logger.error(
        `Réponse idempotente non finalisée pour « ${key} » (${scope}) : ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
