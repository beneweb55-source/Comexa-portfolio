import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppException, ErrorCode } from '../../common/errors/app-error.js';
import {
  TRAINING_TOKEN_TYPE,
  type TrainingTokenInfo,
  type TrainingTokenResolver,
} from '../../common/auth/training-token.js';
import { parseDurationMs } from '../../common/security/duration.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * JETONS DE FORMATION — émission et vérification.
 *
 * Un jeton de formation est un JWT signé avec la clé d'ACCÈS, de `typ`
 * strictement `training`, qui porte la session (`sid`) ouverte en base de
 * production. Il se présente dans le même en-tête `Authorization` qu'un access
 * token — c'est le claim `typ`, vérifié des deux côtés, qui empêche tout
 * mélange :
 *
 *  - `TokenService.verifyAccessToken` rejette tout `typ` ≠ `access` ;
 *  - `resolveTrainingToken` rejette tout `typ` ≠ `training`.
 *
 * La session est une ÉCRITURE en base : `POST /training/exit` (ou une
 * révocation) coupe l'accès immédiatement, sans attendre l'expiration du jeton.
 * C'est le même arbitrage que les refresh tokens : la révocabilité prime sur la
 * vérification purement locale.
 */

interface TrainingTokenPayload {
  sub?: string;
  typ?: string;
  sid?: string;
}

@Injectable()
export class TrainingTokenService implements TrainingTokenResolver {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private get accessSecret(): string {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  /** Durée de vie d'un jeton de formation (4 h par défaut). */
  private get ttlMs(): number {
    return parseDurationMs(this.config.get<string>('TRAINING_TOKEN_TTL') || '4h', 'TRAINING_TOKEN_TTL');
  }

  /**
   * Ouvre une session de formation et émet son jeton.
   * Écrit UNIQUEMENT en production (modèle `trainingSession` verrouillé).
   */
  async issue(userId: string, missionId: string | null): Promise<{
    token: string;
    sessionId: string;
    expiresAt: Date;
  }> {
    const expiresAt = new Date(Date.now() + this.ttlMs);
    const session = await this.prisma.prodClient.trainingSession.create({
      data: { userId, missionId, expiresAt },
    });

    const token = await this.jwt.signAsync(
      { sub: userId, typ: TRAINING_TOKEN_TYPE, sid: session.id },
      { secret: this.accessSecret, expiresIn: Math.floor(this.ttlMs / 1000) },
    );

    return { token, sessionId: session.id, expiresAt };
  }

  /**
   * Vérifie un jeton de formation et rend sa session.
   *
   * Refuse : signature invalide, `typ` inconnu, session inconnue, terminée,
   * révoquée ou échue. Ne marque RIEN — c'est le garde qui posera le scope
   * après avoir rechargé l'identité en production.
   */
  async resolveTrainingToken(token: string): Promise<TrainingTokenInfo> {
    let payload: TrainingTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TrainingTokenPayload>(token, {
        secret: this.accessSecret,
      });
    } catch (error) {
      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      throw AppException.unauthenticated(
        expired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.TOKEN_INVALID,
        expired ? 'Session de formation expirée.' : 'Jeton de formation invalide.',
      );
    }

    if (!payload.sub || payload.typ !== TRAINING_TOKEN_TYPE || !payload.sid) {
      throw AppException.unauthenticated(ErrorCode.TOKEN_INVALID, 'Jeton de formation invalide.');
    }

    // Modèle « toujours production » : la session est une donnée réelle.
    const session = await this.prisma.prodClient.trainingSession.findUnique({
      where: { id: payload.sid },
    });

    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt !== null ||
      session.endedAt !== null ||
      session.expiresAt.getTime() < Date.now()
    ) {
      throw AppException.unauthenticated(
        ErrorCode.TOKEN_INVALID,
        'Cette session de formation est fermée. Reprenez le parcours depuis « Mon parcours ».',
      );
    }

    return { sessionId: session.id, userId: session.userId };
  }

  /** Ferme les sessions de formation actives d'un utilisateur (production). */
  async endSessions(userId: string, sessionId?: string): Promise<number> {
    const result = await this.prisma.prodClient.trainingSession.updateMany({
      where: {
        userId,
        endedAt: null,
        revokedAt: null,
        ...(sessionId ? { id: sessionId } : {}),
      },
      data: { endedAt: new Date() },
    });
    return result.count;
  }
}
