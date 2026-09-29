import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { AppException, ErrorCode } from '../../common/errors/app-error.js';
import type { AccessTokenVerifier } from '../../common/guards/access.guards.js';
import { parseDurationMs } from '../../common/security/duration.js';
import { generateOpaqueToken, hashToken } from '../../common/security/token-hash.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SessionMeta } from './session.js';

/**
 * Emission et verification des jetons.
 *
 * DEUX JETONS, DEUX NATURES — et ce n'est pas un detail d'implementation :
 *
 *  - L'ACCESS TOKEN est un JWT signe, courte duree (15 min). Il est verifie
 *    hors ligne par la signature. C'est ce qui le rend rapide, et c'est aussi sa
 *    limite : revoquer un JWT demande une liste de revocation, ce qui annule son
 *    interet. On compense ailleurs — `PrincipalService` recharge les droits en
 *    base a chaque requete, donc une suspension prend effet tout de suite meme
 *    si le jeton reste cryptographiquement valide.
 *
 *  - LE REFRESH TOKEN est OPAQUE, longue duree (30 jours). Il n'est pas signe :
 *    il est cherche en base par son empreinte. Revoquer une session est donc une
 *    ecriture, immediate et sans delai de propagation. Comme il vit longtemps,
 *    c'est lui qui doit etre revocable pour de vrai.
 *
 * LA ROTATION, ET POURQUOI ELLE REVOQUE TOUT EN CAS DE REUTILISATION.
 *
 * A chaque rafraichissement, le jeton presente est REVOQUE et remplace. Si un
 * jeton deja revoque se represente, deux scenarios :
 *
 *   a) il a ete vole, et le voleur s'en sert apres que le vrai porteur a
 *      rafraichi — ou l'inverse ;
 *   b) c'est une reemission automatique concurrente, benigne.
 *
 * On ne peut pas distinguer (a) de (b) de facon fiable. On choisit donc de
 * fermer : toute la famille est revoquee et l'utilisateur se reconnecte. Le cout
 * d'un faux positif est une reconnexion ; le cout d'un faux negatif est une
 * session volee qui survit trente jours. L'arbitrage est vite fait.
 *
 * Si les fausses alertes devenaient genantes en pratique, le correctif est une
 * colonne `replacedById` sur `RefreshToken` permettant de rejouer la reponse du
 * concurrent — un changement de schema, PAS un affaiblissement de la detection.
 */

const ACCESS_TOKEN_TYPE = 'access';

/** Message unique pour les deux chemins de reutilisation : le client ne doit pas
 *  pouvoir distinguer « jeton inconnu » de « jeton course », qui revelerait
 *  qu'un jeton a existe. */
const REUSE_MESSAGE =
  'Ce jeton de rafraichissement a deja ete utilise. Toutes les sessions associees ' +
  'ont ete fermees par precaution ; veuillez vous reconnecter.';

interface AccessTokenPayload {
  sub?: string;
  typ?: string;
}

export interface IssuedRefreshToken {
  readonly raw: string;
  readonly expiresAt: Date;
}

export interface RotatedRefreshToken extends IssuedRefreshToken {
  readonly userId: string;
}

export interface ActiveSession {
  readonly id: string;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

@Injectable()
export class TokenService implements AccessTokenVerifier {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private get accessSecret(): string {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  /** Duree de vie de l'access token, en SECONDES. */
  private get accessTtlSeconds(): number {
    const ttl = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    return Math.floor(parseDurationMs(ttl, 'JWT_ACCESS_TTL') / 1000);
  }

  get refreshTtlMs(): number {
    const ttl = this.config.get<string>('JWT_REFRESH_TTL') ?? '30d';
    return parseDurationMs(ttl, 'JWT_REFRESH_TTL');
  }

  // ---------------------------------------------------------------------------
  // Access token
  // ---------------------------------------------------------------------------

  /**
   * `expiresIn` recoit des SECONDES, pas la chaine `'15m'`.
   *
   * Ce n'est pas une preference : le type attendu par `jsonwebtoken` est
   * `number | StringValue`, ou `StringValue` est un type a motif litteral. Une
   * chaine quelconque ne compile pas, et si elle passait, une faute de frappe
   * dans `JWT_ACCESS_TTL` produirait un jeton de duree imprevisible. En passant
   * par `parseDurationMs`, une valeur invalide empeche le demarrage au lieu de
   * produire un jeton douteux.
   */
  async issueAccessToken(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, typ: ACCESS_TOKEN_TYPE },
      { secret: this.accessSecret, expiresIn: this.accessTtlSeconds },
    );
  }

  async verifyAccessToken(token: string): Promise<{ sub: string }> {
    let payload: AccessTokenPayload;

    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.accessSecret,
      });
    } catch (error) {
      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      // `TOKEN_EXPIRED` et `TOKEN_INVALID` sont distincts a dessein : le
      // frontend doit tenter un rafraichissement dans le premier cas, et
      // renvoyer vers la connexion dans le second. Un seul code pour les deux
      // obligerait le client a rafraichir sur un jeton falsifie, en boucle.
      throw AppException.unauthenticated(
        expired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.TOKEN_INVALID,
        expired ? 'Session expiree.' : 'Jeton invalide.',
      );
    }

    if (!payload.sub || payload.typ !== ACCESS_TOKEN_TYPE) {
      // Un refresh token signe avec la meme cle — ce que la validation
      // d'environnement interdit deja — serait rejete ici. La verification est
      // conservee par defense en profondeur : c'est la seule barriere qui reste
      // si quelqu'un aligne un jour les deux secrets.
      throw AppException.unauthenticated(ErrorCode.TOKEN_INVALID, 'Jeton invalide.');
    }

    return { sub: payload.sub };
  }

  // ---------------------------------------------------------------------------
  // Refresh token
  // ---------------------------------------------------------------------------

  /**
   * Ouvre une nouvelle famille de session.
   *
   * `family` est l'identifiant de la session, partage par tous les jetons issus
   * de la meme connexion. C'est ce qui permet de revoquer une session entiere
   * sans toucher aux autres appareils du meme utilisateur.
   */
  async startSession(userId: string, meta: SessionMeta): Promise<IssuedRefreshToken> {
    return this.issueInFamily(userId, randomUUID(), meta);
  }

  private async issueInFamily(
    userId: string,
    family: string,
    meta: SessionMeta,
  ): Promise<IssuedRefreshToken> {
    const raw = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + this.refreshTtlMs);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(raw),
        family,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        expiresAt,
      },
    });

    return { raw, expiresAt };
  }

  /**
   * Consomme un refresh token et en emet un nouveau dans la meme famille.
   *
   * L'ordre des operations est le point delicat. On ne peut pas « lire puis
   * ecrire » : deux requetes concurrentes liraient toutes les deux un jeton
   * valide et en emettraient deux. On utilise donc un COMPARE-AND-SWAP : la
   * revocation est un `updateMany` conditionne a `revokedAt: null`, et le nombre
   * de lignes affectees dit qui a gagne. Un seul appelant peut obtenir
   * `count === 1` ; les autres traitent le jeton comme deja consomme.
   */
  async rotateRefreshToken(raw: string, meta: SessionMeta): Promise<RotatedRefreshToken> {
    const tokenHash = hashToken(raw);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing) {
      throw AppException.unauthenticated(
        ErrorCode.TOKEN_INVALID,
        'Jeton de rafraichissement invalide.',
      );
    }

    if (existing.revokedAt) {
      await this.revokeFamily(existing.family);
      this.logger.warn(
        `Reutilisation d'un jeton de rafraichissement revoque : famille ${existing.family} entierement revoquee.`,
      );
      throw AppException.unauthenticated(ErrorCode.REFRESH_TOKEN_REUSED, REUSE_MESSAGE);
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      // Une session expiree n'est pas une reutilisation : on ne revoque pas la
      // famille. Sinon, revenir trois mois plus tard fermerait la session
      // encore ouverte sur un autre appareil.
      throw AppException.unauthenticated(ErrorCode.TOKEN_EXPIRED, 'Session expiree.');
    }

    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (claimed.count !== 1) {
      await this.revokeFamily(existing.family);
      this.logger.warn(
        `Course sur un jeton de rafraichissement (famille ${existing.family}) : la famille est revoquee.`,
      );
      throw AppException.unauthenticated(ErrorCode.REFRESH_TOKEN_REUSED, REUSE_MESSAGE);
    }

    const next = await this.issueInFamily(existing.userId, existing.family, meta);
    return { userId: existing.userId, ...next };
  }

  /** Revoque un jeton precis. Idempotent : un jeton deja revoque ne leve pas. */
  async revokeRefreshToken(raw: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoque toutes les sessions d'un utilisateur. */
  async revokeAllForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** Revoque une famille entiere (une session, tous ses jetons successifs). */
  async revokeFamily(family: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // Sessions actives
  // ---------------------------------------------------------------------------

  /**
   * Les sessions ouvertes d'un utilisateur.
   *
   * On filtre sur `expiresAt > maintenant` en plus de `revokedAt: null` : une
   * session revoquee et une session expiree ne sont pas la meme chose en base,
   * mais elles sont identiquement inutilisables, et l'ecran qui affiche cette
   * liste parle d'acces encore valides.
   */
  async listActiveSessions(userId: string): Promise<ActiveSession[]> {
    return this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Ferme une session precise, apres avoir verifie qu'elle appartient bien a
   * l'utilisateur qui le demande.
   *
   * Le `userId` est dans le `where`, pas dans un `if` apres coup. C'est le meme
   * raisonnement que partout ailleurs contre l'acces horizontal : un
   * identifiant de session vole dans une liste ne doit pas permettre de fermer
   * la session de quelqu'un d'autre. En mettant la contrainte dans la requete,
   * il n'existe aucun chemin ou l'oubli est possible.
   */
  async revokeSessionForUser(userId: string, sessionId: string): Promise<void> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (count === 0) {
      throw AppException.notFound('SESSION_NOT_FOUND', 'Session introuvable.');
    }
  }
}
