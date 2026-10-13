/**
 * L'INTERCEPTEUR D'IDEMPOTENCE.
 *
 * -----------------------------------------------------------------------------
 * SANS EN-TETE, RIEN NE CHANGE — ET C'EST LA PROPRIETE QUI COMPTE
 * -----------------------------------------------------------------------------
 * L'intercepteur n'agit QUE si l'appelant envoie `Idempotency-Key`. Sans cet
 * en-tete, il laisse passer exactement comme avant : le frontend, qui n'en envoie
 * jamais, ne peut pas etre affecte par cette mecanique, et un incident ici ne
 * peut pas casser la creation de tache d'un utilisateur. C'est la condition pour
 * poser ce genre de dispositif sur une route deja en production.
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
  Injectable,
  Logger,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, from, mergeMap, of } from 'rxjs';
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

    return from(this.existing(scope, key, user.id, hash)).pipe(
      mergeMap((reponse) => {
        if (reponse) {
          const response = context.switchToHttp().getResponse<Response>();
          response.status(reponse.status);
          response.setHeader(IDEMPOTENCY_REPLAY_HEADER, 'true');
          return of(reponse.body);
        }

        return next.handle().pipe(
          mergeMap(async (payload) => {
            await this.remember(scope, key, user.id, hash, context, payload);
            return payload;
          }),
        );
      }),
    );
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

    // Une cle perimee n'existe plus : elle sera reecrite plus bas.
    if (record.expiresAt.getTime() <= Date.now()) return null;

    if (record.requestHash !== hash) {
      throw AppException.unprocessable(
        'IDEMPOTENCY_KEY_REUSED',
        "Cette cle d'idempotence a deja servi pour une autre requete. Generez une nouvelle cle.",
        { scope },
      );
    }

    return { status: record.status, body: record.body };
  }

  /**
   * Memorise la reponse.
   *
   * SEULES LES REPONSES 2xx SONT MEMORISEES. Une erreur 400 ne doit pas etre
   * rejouee : le client corrige son corps et renvoie la meme cle, ce qui est
   * exactement l'usage legitime d'une cle d'idempotence.
   *
   * LES ECHECS D'ECRITURE SONT IGNORES, ET C'EST UN CHOIX : la concurrence
   * (deux appels simultanes avec la meme cle) peut produire une violation
   * d'unicite. Mieux vaut alors une creation en double, rare et visible, qu'une
   * creation reussie qui repond 500.
   */
  private async remember(
    scope: string,
    key: string,
    principalId: string,
    hash: string,
    context: ExecutionContext,
    payload: unknown,
  ): Promise<void> {
    const status = context.switchToHttp().getResponse<Response>().statusCode;
    if (status < 200 || status >= 300) return;

    try {
      await this.prisma.idempotencyRecord.upsert({
        where: { scope_key_principalId: { scope, key, principalId } },
        create: {
          scope,
          key,
          principalId,
          requestHash: hash,
          status,
          body: (payload ?? null) as never,
          expiresAt: idempotencyExpiry(),
        },
        update: {
          requestHash: hash,
          status,
          body: (payload ?? null) as never,
          expiresAt: idempotencyExpiry(),
        },
        select: { id: true },
      });
    } catch (error) {
      this.logger.warn(
        `Reponse non memorisee pour la cle d'idempotence « ${key} » (${scope}) : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
