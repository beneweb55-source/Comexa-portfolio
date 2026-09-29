import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { AppException, ErrorCode } from '../../common/errors/app-error.js';
import { MailService } from '../../common/mail/mail.service.js';
import { parseDurationMs } from '../../common/security/duration.js';
import {
  hashPassword,
  passwordPolicyViolation,
  verifyPassword,
} from '../../common/security/password.js';
import { generateOpaqueToken, hashToken } from '../../common/security/token-hash.js';
import { UserStatus, type RoleCode } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
} from './dto/auth.dto.js';
import { PrincipalService } from './principal.service.js';
import type { SessionMeta } from './session.js';
import { TokenService, type ActiveSession } from './token.service.js';

/**
 * LOGIQUE D'AUTHENTIFICATION.
 *
 * Trois choses meritent d'etre expliquees, parce qu'elles sont des choix et non
 * des evidences.
 *
 * 1. LE COMPTE NE SE DEVINE PAS.
 *
 * `login` et `forgotPassword` repondent la meme chose qu'un compte existe ou
 * non, et surtout APRES LE MEME TEMPS DE CALCUL. Sans cela, un attaquant
 * distingue une adresse inscrite d'une adresse inconnue en mesurant la duree de
 * la reponse : `verifyPassword` sur un argon2id prend des dizaines de
 * millisecondes, alors qu'un `return` immediat sur compte introuvable n'en prend
 * aucune. C'est un oracle, et il est exploitable a distance. On hache donc
 * quelque chose meme quand il n'y a rien a hacher (voir `dummyHash`).
 *
 * 2. LE VERROUILLAGE EST UN COMPROMIS, PAS UNE PROTECTION ABSOLUE.
 *
 * Cinq echecs verrouillent le compte quinze minutes. Cela arrete le devinage en
 * ligne, au prix d'un vecteur de deni de service : n'importe qui connaissant une
 * adresse peut la verrouiller en cinq requetes. Le remede classique — ne
 * verrouiller que par adresse IP — se contourne avec un reseau de proxys. On
 * garde donc le verrouillage par compte, et la limitation de debit sur la route
 * de connexion est ce qui empeche d'y arriver en boucle.
 *
 * 3. LES ECRITURES SENSIBLES SONT TRANSACTIONNELLES.
 *
 * Reinitialiser un mot de passe, c'est marquer le jeton consomme, changer
 * l'empreinte, et fermer toutes les sessions. Si le processus tombe entre deux,
 * on obtient soit un jeton encore valable sur un mot de passe change (la faille
 * reste ouverte), soit un compte sans mot de passe. Les trois ecritures sont
 * donc dans une seule transaction, et la consommation du jeton est un
 * compare-and-swap : deux requetes simultanees avec le meme lien ne peuvent pas
 * aboutir toutes les deux.
 */

/** Au-dela, le compte est verrouille temporairement. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

/**
 * Empreinte factice, calculee une seule fois et seulement si besoin.
 *
 * Elle sert a faire travailler argon2 sur le chemin « compte inconnu ». Le
 * calcul est paresseux parce qu'il coute environ 19 Mo et quelques dizaines de
 * millisecondes : le payer au demarrage pour un chemin jamais emprunte en usage
 * normal serait du gaspillage pur.
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('empreinte-factice-pour-egaliser-le-temps-de-reponse');
  return dummyHashPromise;
}

export interface AuthProfile {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly roles: readonly RoleCode[];
  /** Trie : le frontend compare ce tableau d'un rendu a l'autre. */
  readonly permissions: readonly string[];
  readonly clientId: string | null;
  readonly mustChangePassword: boolean;
}

export interface AuthResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
  readonly user: AuthProfile;
}

/**
 * Reponse identique pour « compte inconnu » et « mot de passe faux ».
 *
 * Le code d'erreur ET le message sont les memes. Distinguer les deux cas
 * reviendrait a confirmer a un attaquant quelles adresses sont inscrites.
 */
function invalidCredentials(): AppException {
  return AppException.unauthenticated(
    ErrorCode.INVALID_CREDENTIALS,
    'Adresse e-mail ou mot de passe incorrect.',
  );
}

function profileOf(user: AuthenticatedUser): AuthProfile {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roles: user.roles,
    permissions: [...user.permissions].sort(),
    clientId: user.clientId,
    mustChangePassword: user.mustChangePassword,
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly principals: PrincipalService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private get passwordResetTtlMs(): number {
    return parseDurationMs(
      this.config.get<string>('PASSWORD_RESET_TTL') ?? '1h',
      'PASSWORD_RESET_TTL',
    );
  }

  // ---------------------------------------------------------------------------
  // Connexion / deconnexion
  // ---------------------------------------------------------------------------

  async login(dto: LoginDto, meta: SessionMeta): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: {
        id: true,
        passwordHash: true,
        failedLoginAttempts: true,
        lockedUntil: true,
      },
    });

    if (!user) {
      // Voir `dummyHash` : on paie le meme temps de calcul que sur un compte
      // existant, sinon la duree de la reponse revele quelles adresses existent.
      await verifyPassword(await dummyHash(), dto.password);
      await this.audit.record({
        actorId: null,
        action: 'LOGIN_FAILED',
        entityType: 'User',
        after: { email, reason: 'UNKNOWN_ACCOUNT' },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
      throw new AppException(
        ErrorCode.ACCOUNT_LOCKED,
        `Trop de tentatives de connexion. Ce compte est verrouille encore ${minutes} minute(s).`,
        HttpStatus.FORBIDDEN,
        { lockedUntil: user.lockedUntil.toISOString() },
      );
    }

    const matches = await verifyPassword(user.passwordHash, dto.password);

    if (!matches) {
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts + 1, meta);
      throw invalidCredentials();
    }

    // Statut verifie AVANT d'emettre le moindre jeton. `PrincipalService.load`
    // est le meme code que celui qui garde chaque requete authentifiee : un
    // compte suspendu est donc refuse ici par la source de verite unique, et non
    // par une seconde verification qui pourrait diverger.
    const principal = await this.principals.load(user.id);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const session = await this.tokens.startSession(user.id, meta);
    const accessToken = await this.tokens.issueAccessToken(user.id);

    await this.audit.record({
      actorId: user.id,
      action: 'LOGIN_SUCCESS',
      entityType: 'User',
      entityId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      accessToken,
      refreshToken: session.raw,
      refreshTokenExpiresAt: session.expiresAt,
      user: profileOf(principal),
    };
  }

  private async registerFailedAttempt(
    userId: string,
    attempts: number,
    meta: SessionMeta,
  ): Promise<void> {
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
      },
    });

    await this.audit.record({
      actorId: userId,
      action: shouldLock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
      entityType: 'User',
      entityId: userId,
      after: { attempts, threshold: MAX_FAILED_ATTEMPTS },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  /**
   * Rafraichit la session.
   *
   * L'access token est reemis a partir des droits RELUS EN BASE (via
   * `principals.load`), pas recopies depuis l'ancien. Un rafraichissement est
   * donc aussi le moment ou une revocation de role prend effet, meme si le
   * porteur n'a jamais ferme son onglet.
   */
  async refresh(rawToken: string, meta: SessionMeta): Promise<AuthResult> {
    const rotated = await this.tokens.rotateRefreshToken(rawToken, meta);
    const principal = await this.principals.load(rotated.userId);
    const accessToken = await this.tokens.issueAccessToken(rotated.userId);

    return {
      accessToken,
      refreshToken: rotated.raw,
      refreshTokenExpiresAt: rotated.expiresAt,
      user: profileOf(principal),
    };
  }

  /**
   * Ferme la session courante.
   *
   * Volontairement idempotent et silencieux : un jeton inconnu, deja revoque ou
   * expire produit le meme succes. Un utilisateur qui se deconnecte n'a pas a
   * apprendre que son jeton etait deja invalide, et repondre une erreur ici
   * pousserait le frontend a conserver un cookie qu'il essaie justement de
   * supprimer.
   */
  async logout(rawToken: string | null, meta: SessionMeta): Promise<void> {
    if (!rawToken) {
      return;
    }

    await this.tokens.revokeRefreshToken(rawToken);
    await this.audit.record({
      actorId: null,
      action: 'LOGOUT',
      entityType: 'RefreshToken',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  async logoutAll(user: AuthenticatedUser, meta: SessionMeta): Promise<{ revoked: number }> {
    const revoked = await this.tokens.revokeAllForUser(user.id);

    await this.audit.record({
      actorId: user.id,
      action: 'LOGOUT_ALL',
      entityType: 'User',
      entityId: user.id,
      after: { revoked },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { revoked };
  }

  // ---------------------------------------------------------------------------
  // Mot de passe oublie / reinitialisation
  // ---------------------------------------------------------------------------

  /**
   * Demande de reinitialisation.
   *
   * Ne revele JAMAIS si l'adresse correspond a un compte : meme reponse, meme
   * duree. Le cout est un hachage argon2 inutile sur le chemin « inconnue » —
   * c'est le prix de l'indistinguabilite, et le limiteur de debit sur cette
   * route est ce qui empeche d'en faire un levier de surcharge.
   *
   * Les jetons precedents non utilises sont marques consommes : demander un
   * nouveau lien invalide les anciens. Sans cela, chaque demande laisserait
   * derriere elle un lien encore valable une heure, et une boite mail
   * compromise offrirait autant de portes d'entree.
   */
  async forgotPassword(dto: ForgotPasswordDto, meta: SessionMeta): Promise<void> {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null, status: UserStatus.ACTIVE },
      select: { id: true, email: true, firstName: true },
    });

    if (!user) {
      await hashPassword(generateOpaqueToken());
      this.logger.debug(`Reinitialisation demandee pour une adresse sans compte actif : ${email}`);
      return;
    }

    const raw = generateOpaqueToken();

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + this.passwordResetTtlMs),
          ipAddress: meta.ipAddress,
        },
      });
    });

    await this.mail.sendPasswordReset({
      to: user.email,
      firstName: user.firstName,
      token: raw,
      expiresInLabel: this.config.get<string>('PASSWORD_RESET_TTL') ?? '1h',
    });

    await this.audit.record({
      actorId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'User',
      entityId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  async resetPassword(dto: ResetPasswordDto, meta: SessionMeta): Promise<void> {
    if (dto.password !== dto.confirmPassword) {
      throw AppException.unprocessable(
        'PASSWORD_MISMATCH',
        'Les deux mots de passe ne correspondent pas.',
      );
    }

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
        user: { select: { email: true } },
      },
    });

    // Un lien inconnu et un lien deja consomme donnent la MEME reponse : sinon,
    // deviner qu'un jeton a existe devient possible en comparant les messages.
    if (!record || record.usedAt) {
      throw AppException.badRequest(
        ErrorCode.TOKEN_INVALID,
        'Ce lien de reinitialisation est invalide ou a deja servi.',
      );
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      // Ici la distinction est assumee : le porteur legitime du lien a besoin de
      // savoir qu'il doit en demander un autre, et un lien expire est un
      // evenement normal, pas une information sensible.
      throw AppException.badRequest(
        ErrorCode.TOKEN_EXPIRED,
        'Ce lien de reinitialisation a expire. Demandez-en un nouveau.',
      );
    }

    const violation = passwordPolicyViolation(dto.password, record.user.email);
    if (violation) {
      throw AppException.unprocessable('WEAK_PASSWORD', violation);
    }

    const passwordHash = await hashPassword(dto.password);

    await this.prisma.$transaction(async (tx) => {
      // Compare-and-swap : deux clics simultanes sur le meme lien, et un seul
      // aboutit. Le second ne peut pas rejouer le changement.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      if (claimed.count !== 1) {
        throw AppException.badRequest(
          ErrorCode.TOKEN_INVALID,
          'Ce lien de reinitialisation est invalide ou a deja servi.',
        );
      }

      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          // Un mot de passe choisi par son titulaire n'est plus « initial ».
          mustChangePassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });

      // Toutes les sessions tombent. C'est le point du parcours : si le compte
      // etait compromis, la reinitialisation doit fermer la porte, pas la
      // laisser ouverte avec un nouveau mot de passe.
      await tx.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.audit.record({
      actorId: record.userId,
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: record.userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  // ---------------------------------------------------------------------------
  // Changement de mot de passe (utilisateur connecte)
  // ---------------------------------------------------------------------------

  /**
   * Change le mot de passe d'un utilisateur connecte.
   *
   * Le mot de passe actuel est EXIGE meme si le porteur est authentifie : sans
   * cela, un jeton d'acces vole suffirait a verrouiller le compte de sa victime
   * en changeant son mot de passe. L'authentification prouve qui parle ; le mot
   * de passe actuel prouve que c'est bien le titulaire, et pas quelqu'un qui a
   * ramasse un jeton.
   *
   * Toutes les sessions sont fermees, PUIS une nouvelle est ouverte : les autres
   * appareils sont deconnectes, celui qui vient de faire l'operation reste
   * connecte. Fermer aussi la session courante serait plus simple, mais
   * l'utilisateur qui vient de securiser son compte serait jete dehors — un
   * comportement qui decourage exactement le geste qu'on veut encourager.
   */
  async changePassword(
    user: AuthenticatedUser,
    dto: ChangePasswordDto,
    meta: SessionMeta,
  ): Promise<AuthResult> {
    if (dto.newPassword !== dto.confirmPassword) {
      throw AppException.unprocessable(
        'PASSWORD_MISMATCH',
        'Les deux mots de passe ne correspondent pas.',
      );
    }

    const row = await this.prisma.user.findFirst({
      where: { id: user.id, deletedAt: null },
      select: { email: true, passwordHash: true },
    });

    if (!row) {
      throw AppException.unauthenticated(
        ErrorCode.TOKEN_INVALID,
        "Ce compte n'existe plus. Veuillez vous reconnecter.",
      );
    }

    const matches = await verifyPassword(row.passwordHash, dto.currentPassword);

    if (!matches) {
      await this.audit.record({
        actorId: user.id,
        action: 'PASSWORD_CHANGE_FAILED',
        entityType: 'User',
        entityId: user.id,
        after: { reason: 'WRONG_CURRENT_PASSWORD' },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw AppException.unauthenticated(
        ErrorCode.INVALID_CREDENTIALS,
        'Le mot de passe actuel est incorrect.',
      );
    }

    if (dto.currentPassword === dto.newPassword) {
      throw AppException.unprocessable(
        'PASSWORD_UNCHANGED',
        "Le nouveau mot de passe doit etre different de l'actuel.",
      );
    }

    const violation = passwordPolicyViolation(dto.newPassword, row.email);
    if (violation) {
      throw AppException.unprocessable('WEAK_PASSWORD', violation);
    }

    const passwordHash = await hashPassword(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      });

      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    const session = await this.tokens.startSession(user.id, meta);
    const accessToken = await this.tokens.issueAccessToken(user.id);
    const principal = await this.principals.load(user.id);

    await this.audit.record({
      actorId: user.id,
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      accessToken,
      refreshToken: session.raw,
      refreshTokenExpiresAt: session.expiresAt,
      user: profileOf(principal),
    };
  }

  // ---------------------------------------------------------------------------
  // Profil et sessions
  // ---------------------------------------------------------------------------

  /**
   * Profil de l'utilisateur connecte.
   *
   * Relit en base plutot que de renvoyer le porteur attache a la requete : ce
   * dernier a deja ete charge quelques millisecondes plus tot, mais surtout il
   * est le format interne du garde. Repasser par `load` garantit qu'un ecran de
   * profil et une requete metier voient exactement le meme etat.
   */
  async me(userId: string): Promise<AuthProfile> {
    return profileOf(await this.principals.load(userId));
  }

  async listSessions(userId: string): Promise<ActiveSession[]> {
    return this.tokens.listActiveSessions(userId);
  }

  async revokeSession(userId: string, sessionId: string, meta: SessionMeta): Promise<void> {
    await this.tokens.revokeSessionForUser(userId, sessionId);

    await this.audit.record({
      actorId: userId,
      action: 'SESSION_REVOKED',
      entityType: 'RefreshToken',
      entityId: sessionId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }
}
