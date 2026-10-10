import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode, type ApiErrorBody } from '../errors/app-error.js';

/**
 * Traduit TOUTE exception en une reponse unique et previsible.
 *
 * Deux garanties, et c'est tout l'interet du filtre :
 *
 *  1. La forme ne varie jamais. Le frontend lit toujours `error.code` /
 *     `error.message` / `error.details`, quelle que soit la couche qui a
 *     echoue.
 *  2. En production, le detail technique ne sort pas. Une pile d'appels, un nom
 *     de table ou une requete SQL dans une reponse HTTP renseignent un attaquant
 *     sur la structure interne. Ces elements partent dans les journaux, pas
 *     dans la reponse.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, code, message, details } = this.describe(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Erreur non prevue : on journalise la pile complete, cote serveur.
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${status} ${code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiErrorBody = {
      success: false,
      error: { code, message, details },
    };

    response.status(status).json(body);
  }

  /** Ramene n'importe quelle exception a un quadruplet exploitable. */
  private describe(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details: unknown;
  } {
    // 1. Nos exceptions metier : elles portent deja tout.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (this.isAppExceptionPayload(payload)) {
        return { status, code: payload.code, message: payload.message, details: payload.details };
      }

      // 2. Exceptions Nest natives (ValidationPipe, ThrottlerGuard,
      //    ParseUUIDPipe...). On leur donne un code stable.
      if (typeof payload === 'object' && payload !== null && 'message' in payload) {
        const raw = (payload as { message: unknown }).message;
        const messages = Array.isArray(raw) ? raw : [String(raw)];

        const isBadRequest = status === HttpStatus.BAD_REQUEST;
        // Un 404 qui arrive ici vient du routeur de Nest, pas de nous : son
        // message est en anglais (« Cannot GET /api/x »). On le remplace, sinon
        // le frontend recoit une phrase anglaise au milieu d'une API francaise.
        const isUnmatchedRoute = status === HttpStatus.NOT_FOUND;

        return {
          status,
          code: this.codeForStatus(status),
          message: isBadRequest
            ? 'Requete invalide'
            : isUnmatchedRoute
              ? 'Route introuvable'
              : messages.join(', '),
          // Les messages de validation sont, eux, faits pour etre affiches.
          details: isBadRequest ? messages : null,
        };
      }

      return {
        status,
        code: this.codeForStatus(status),
        message: exception.message,
        details: null,
      };
    }

    // 3. Erreurs Prisma. On les reconnait a leur code (`P2002`, `P2025`...) et
    //    on teste la FORME plutot que la classe : l'import de la classe d'erreur
    //    depend de la version du client genere, la forme du code, non.
    const prismaCode = this.prismaCodeOf(exception);
    if (prismaCode) {
      return this.describePrisma(prismaCode, exception);
    }

    // 4. Tout le reste. En production, message generique ; en developpement, on
    //    garde le message pour ne pas obliger a ouvrir les journaux a chaque
    //    erreur de frappe.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: this.isProduction
        ? 'Une erreur interne est survenue'
        : exception instanceof Error
          ? exception.message
          : String(exception),
      details: null,
    };
  }

  private isAppExceptionPayload(
    payload: unknown,
  ): payload is { code: string; message: string; details: unknown } {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'code' in payload &&
      'message' in payload &&
      typeof (payload as { code: unknown }).code === 'string' &&
      typeof (payload as { message: unknown }).message === 'string'
    );
  }

  private prismaCodeOf(exception: unknown): string | null {
    if (typeof exception !== 'object' || exception === null) return null;
    const code = (exception as { code?: unknown }).code;
    return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null;
  }

  private describePrisma(
    prismaCode: string,
    exception: unknown,
  ): { status: number; code: string; message: string; details: unknown } {
    const meta = (exception as { meta?: Record<string, unknown> }).meta;

    switch (prismaCode) {
      case 'P2002': {
        // Violation d'unicite. `meta.target` nomme la ou les colonnes.
        const target = meta?.target;
        const champs = Array.isArray(target) ? target.join(', ') : String(target ?? 'inconnu');
        return {
          status: HttpStatus.CONFLICT,
          code: ErrorCode.CONFLICT,
          message: `Cette valeur existe deja (${champs})`,
          details: this.isProduction ? null : { fields: target },
        };
      }
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: ErrorCode.NOT_FOUND,
          message: "L'element demande est introuvable",
          details: null,
        };
      case 'P2003':
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          code: ErrorCode.UNPROCESSABLE,
          message: 'Reference inexistante : un element lie est introuvable',
          details: null,
        };
      default:
        // P1001 (base injoignable), P1017 (connexion fermee), etc.
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message: 'La base de donnees est momentanement indisponible',
          details: this.isProduction ? null : { prismaCode },
        };
    }
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_FAILED;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ErrorCode.UNPROCESSABLE;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMITED;
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return ErrorCode.PAYLOAD_TOO_LARGE;
      default:
        return status >= HttpStatus.INTERNAL_SERVER_ERROR
          ? ErrorCode.INTERNAL_ERROR
          : ErrorCode.VALIDATION_FAILED;
    }
  }
}
