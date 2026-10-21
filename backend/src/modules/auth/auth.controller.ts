import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import { OnboardingService, onboardingAreas } from './onboarding.service.js';
import { OnboardingDto } from './dto/onboarding.dto.js';
import { IgnoreSpace, ScopedByService } from '../../common/decorators/auth.decorators.js';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import {
  AllowPasswordChangeRequired,
  CurrentUser,
} from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { AppException, ErrorCode } from '../../common/errors/app-error.js';
import { clientIp, clientUserAgent } from '../../common/http/client-ip.js';
import { AuthService, type AuthProfile } from './auth.service.js';
import { RegisterDto, ResendVerificationDto, VerifyEmailDto } from './dto/registration.dto.js';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  ResetPasswordDto,
} from './dto/auth.dto.js';
import type { SessionMeta } from './session.js';
import type { ActiveSession } from './token.service.js';

/**
 * ROUTES D'AUTHENTIFICATION.
 *
 * Le nom du cookie est aussi celui declare dans `main.ts` pour Swagger
 * (`addCookieAuth('refresh_token')`) : les deux doivent rester alignes, sinon la
 * documentation decrit un cookie que l'API ne pose pas.
 */
export const REFRESH_COOKIE = 'refresh_token';

/** Contexte de session, extrait de la requete. */
export const Session = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionMeta => {
    const request = ctx.switchToHttp().getRequest<Request>();

    // La lecture de l'adresse et de l'agent vit desormais dans
    // `common/http/client-ip.ts` : ce decorateur en portait une copie, comme deux
    // autres modules. Ce que la valeur vaut, et le reglage `TRUST_PROXY`, sont
    // expliques la-bas.
    return {
      ipAddress: clientIp(request),
      userAgent: clientUserAgent(request),
    };
  },
);

/**
 * Reponse d'une connexion ou d'un rafraichissement.
 *
 * LE REFRESH TOKEN N'EST PAS DANS LE CORPS. Il part uniquement dans un cookie
 * `HttpOnly`. L'inclure ici annulerait sa protection : un script injecte dans la
 * page lirait la reponse de `/auth/login` et repartirait avec trente jours
 * d'acces, alors que le cookie, lui, reste invisible au JavaScript.
 *
 * Consequence assumee : un client sans pot a cookies (application mobile) ne
 * recoit pas de refresh token par ce chemin. C'est une decision a prendre
 * explicitement le jour ou ce client existe, pas un defaut a laisser ouvert
 * aujourd'hui.
 */
interface SessionResponse {
  accessToken: string;
  refreshTokenExpiresAt: string;
  user: AuthProfile;
}

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Chemin du cookie.
   *
   * Restreint a `/api/auth` : le navigateur ne le joint donc PAS aux autres
   * routes, ce qui reduit sa surface d'exposition (journaux, proxys, code qui
   * journalise les en-tetes). Le prefixe vient de la configuration et n'est pas
   * ecrit en dur — sinon un changement d'`API_PREFIX` poserait un cookie que le
   * navigateur n'enverrait jamais a `/auth/refresh`, et l'utilisateur serait
   * deconnecte a chaque expiration sans le moindre message d'erreur.
   */
  private get cookiePath(): string {
    const prefix = this.config.get<string>('API_PREFIX') ?? 'api';
    return `/${prefix}/auth`;
  }

  private setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
    const sameSite = this.config.get<'lax' | 'strict' | 'none'>('COOKIE_SAMESITE') ?? 'lax';
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      // `SameSite=None` est refusé par les navigateurs sans `Secure`. Il est
      // requis quand l'application est affichée dans un cadre d'un autre site
      // (aperçu) : sans lui, le rafraîchissement échoue au rechargement.
      secure: this.config.get<string>('NODE_ENV') === 'production' || sameSite === 'none',
      sameSite,
      path: this.cookiePath,
      expires: expiresAt,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: this.cookiePath });
  }

  private toResponse(result: {
    accessToken: string;
    refreshTokenExpiresAt: Date;
    user: AuthProfile;
  }): SessionResponse {
    return {
      accessToken: result.accessToken,
      refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
      user: result.user,
    };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOperation({ summary: 'Se connecter. Pose le cookie de rafraichissement.' })
  async login(
    @Body() dto: LoginDto,
    @Session() meta: SessionMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const result = await this.auth.login(dto, meta);
    this.setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
    return this.toResponse(result);
  }

  /**
   * Rafraichit l'access token.
   *
   * Route PUBLIQUE a dessein : elle doit rester joignable avec un access token
   * expire, sinon elle ne servirait a rien. C'est le refresh token — presente
   * dans le cookie ou, pour un client sans pot a cookies, dans le corps — qui
   * fait office de preuve.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  @ApiOperation({ summary: "Rafraichir l'access token (rotation du refresh token)." })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Session() meta: SessionMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const raw = readRefreshToken(request, dto);
    const result = await this.auth.refresh(raw, meta);
    this.setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
    return this.toResponse(result);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  @ApiOperation({ summary: 'Se deconnecter. Efface le cookie.' })
  async logout(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Session() meta: SessionMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ loggedOut: true }> {
    await this.auth.logout(readRefreshTokenOrNull(request, dto), meta);
    this.clearRefreshCookie(res);
    return { loggedOut: true };
  }

  @AllowPasswordChangeRequired()
  @HttpCode(HttpStatus.OK)
  @Post('logout-all')
  @ApiOperation({ summary: 'Fermer toutes les sessions de ce compte.' })
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Session() meta: SessionMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ revoked: number }> {
    const result = await this.auth.logoutAll(user, meta);
    this.clearRefreshCookie(res);
    return result;
  }

  /**
   * Repond TOUJOURS 200, meme si l'adresse est inconnue.
   *
   * Voir `AuthService.forgotPassword` : la reponse constante est ce qui empeche
   * d'enumerer les comptes. Le frontend affiche un message neutre du type
   * « si un compte existe, un courriel vient de partir ».
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  @ApiOperation({ summary: 'Demander un lien de reinitialisation (reponse toujours identique).' })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Session() meta: SessionMeta,
  ): Promise<{ sent: true }> {
    await this.auth.forgotPassword(dto, meta);
    return { sent: true };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  @ApiOperation({ summary: 'Definir un nouveau mot de passe a partir du lien recu.' })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Session() meta: SessionMeta,
  ): Promise<{ reset: true }> {
    await this.auth.resetPassword(dto, meta);
    return { reset: true };
  }

  /**
   * Inscription libre. Reponse identique, que l'adresse existe ou non. Le compte
   * reste inactif jusqu'a la verification de l'adresse.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('register')
  @ApiOperation({ summary: 'Creer un compte (inscription libre). Envoie un lien de verification.' })
  async register(
    @Body() dto: RegisterDto,
    @Session() meta: SessionMeta,
  ): Promise<{ accepted: true; verificationRequired: boolean }> {
    await this.auth.register(dto, meta);
    // Indicateur global (pas par compte) : le front choisit le bon message.
    return { accepted: true, verificationRequired: this.auth.emailVerificationRequired };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('verify-email')
  @ApiOperation({ summary: 'Activer le compte a partir du lien recu par e-mail.' })
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Session() meta: SessionMeta,
  ): Promise<{ verified: true }> {
    await this.auth.verifyEmail(dto, meta);
    return { verified: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('resend-verification')
  @ApiOperation({ summary: 'Renvoyer le lien de verification (reponse toujours identique).' })
  async resendVerification(@Body() dto: ResendVerificationDto): Promise<{ sent: true }> {
    await this.auth.resendVerification(dto);
    return { sent: true };
  }

  @AllowPasswordChangeRequired()
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  @ApiOperation({ summary: 'Changer son mot de passe (mot de passe actuel exige).' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Session() meta: SessionMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const result = await this.auth.changePassword(user, dto, meta);
    this.setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
    return this.toResponse(result);
  }

  @AllowPasswordChangeRequired()
  @Get('me')
  @ApiOperation({ summary: "Profil et permissions de l'utilisateur connecte." })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<AuthProfile> {
    return this.auth.me(user.id);
  }

  @Get('onboarding')
  @IgnoreSpace()
  @ScopedByService()
  async onboarding(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.list(user);
  }

  @Patch('onboarding')
  @IgnoreSpace()
  @ScopedByService()
  async saveOnboarding(@CurrentUser() user: AuthenticatedUser, @Body() dto: OnboardingDto) {
    return this.onboardingService.save(user, dto);
  }

  @Get('onboarding/access')
  @IgnoreSpace()
  @ScopedByService()
  async onboardingAccess(@CurrentUser() user: AuthenticatedUser) {
    return onboardingAreas(user);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Sessions ouvertes de ce compte.' })
  async sessions(@CurrentUser() user: AuthenticatedUser): Promise<ActiveSession[]> {
    return this.auth.listSessions(user.id);
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Fermer une session precise.' })
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Session() meta: SessionMeta,
  ): Promise<{ revoked: true }> {
    await this.auth.revokeSession(user.id, id, meta);
    return { revoked: true };
  }
}

/**
 * Le refresh token, cookie d'abord.
 *
 * L'ordre n'est pas arbitraire : quand les deux sont presents, c'est le cookie
 * qui fait foi. S'il primait, un appelant pourrait faire rafraichir une session
 * avec un jeton fourni dans le corps, et l'origine reelle de la requete
 * deviendrait difficile a raisonner — notamment pour la detection de
 * reutilisation, dont tout l'interet est de reperer un porteur qui n'est pas
 * celui a qui le cookie a ete pose.
 */
function readRefreshToken(request: Request, dto: RefreshDto | undefined): string {
  const token = readRefreshTokenOrNull(request, dto);

  if (!token) {
    throw AppException.unauthenticated(
      ErrorCode.TOKEN_INVALID,
      'Aucun jeton de rafraichissement fourni.',
    );
  }

  return token;
}

/**
 * `dto` est declare optionnel : sur Express 5, `req.body` vaut `undefined` quand
 * aucun analyseur de corps n'a travaille (requete sans `Content-Type: json`).
 * Ce n'est PAS un cas theorique ici — le chemin nominal de `refresh` et
 * `logout` consiste justement a n'envoyer aucun corps, le jeton etant dans le
 * cookie.
 */
function readRefreshTokenOrNull(request: Request, dto: RefreshDto | undefined): string | null {
  const cookies = (request as Request & { cookies?: Record<string, unknown> }).cookies;
  const fromCookie = cookies?.[REFRESH_COOKIE];

  if (typeof fromCookie === 'string' && fromCookie.length > 0) {
    return fromCookie;
  }

  const fromBody = dto?.refreshToken;
  return typeof fromBody === 'string' && fromBody.length > 0 ? fromBody : null;
}
