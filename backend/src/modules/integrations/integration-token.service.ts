import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  INTEGRATION_NAME_PATTERN,
  generateIntegrationToken,
  hashIntegrationToken,
  integrationEmailFor,
  integrationTokenMatches,
  isIntegrationTokenExpired,
  isValidIntegrationName,
  looksLikeIntegrationToken,
  normalizeIntegrationScopes,
} from '../../common/auth/integration-token.js';
import { ALL_PERMISSION_CODES } from '../../common/auth/permissions.catalogue.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { AccessPolicy, SCOPE_ANY } from '../../common/auth/principal.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { paginated, resolvePagination, type Paginated } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { hashPassword } from '../../common/security/password.js';
import type { RequestContext } from '../projects/request-meta.decorator.js';
import {
  CreateIntegrationTokenDto,
  ListIntegrationTokensQueryDto,
  RenewIntegrationTokenDto,
} from './dto/integration-token.dto.js';
import type { IntegrationTokenView } from './integration-token.presenter.js';
import { toIntegrationTokenView } from './integration-token.presenter.js';

/**
 * JETONS D'INTEGRATION : le cycle de vie complet.
 *
 * -------------------------------------------------------------------------
 * POURQUOI UN COMPTE TECHNIQUE PAR JETON
 * -------------------------------------------------------------------------
 * Une integration doit ecrire : creer une tache, changer un statut, laisser une
 * trace d'activite. Or ces ecritures portent une CLE ETRANGERE vers `users`
 * (auteur, createur, expediteur). Sans compte, il aurait fallu rendre toutes ces
 * colonnes nullables — et perdre du meme coup la possibilite de repondre a « qui
 * a fait ca ? ».
 *
 * Le compte ainsi cree n'est pourtant pas un membre : aucun role (les droits
 * viennent du jeton, jamais du compte), exclu des listes d'utilisateurs, et un
 * mot de passe que personne ne detient. C'est la separation demandee entre
 * humains, machines et administrateurs.
 *
 * -------------------------------------------------------------------------
 * CE QUE CE FICHIER NE FAIT JAMAIS
 * -------------------------------------------------------------------------
 *  - rendre le secret : il n'est retourne qu'une fois, a la creation ou au
 *    renouvellement, puis oublie. `list()` ne peut pas le rendre, il n'existe
 *    plus nulle part.
 *  - ecrire un secret dans un journal : l'audit note le PREFIXE, jamais la
 *    valeur, ni le hachage.
 */
@Injectable()
export class IntegrationTokenService {
  private readonly logger = new Logger(IntegrationTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Administration
  // ---------------------------------------------------------------------------

  /**
   * Cree un jeton. Le secret est retourne UNE SEULE FOIS, dans cette reponse.
   *
   * Le service revérifie le droit alors que le garde l'a deja fait : le garde
   * protege la ROUTE, le service protege l'OPERATION. Un jour, une autre route
   * (une commande interne, un script) appellera `create` ; si la verification ne
   * vivait que dans le decorateur, cette route la distribuerait des acces a
   * l'insu de tout le monde.
   */
  async create(
    dto: CreateIntegrationTokenDto,
    actor: AuthenticatedUser,
    meta: RequestContext,
  ): Promise<{ token: IntegrationTokenView; secret: string }> {
    new AccessPolicy(actor).requireScope('integration', 'manage', [SCOPE_ANY]);

    const name = (dto.name ?? '').trim();
    if (!isValidIntegrationName(name)) {
      throw AppException.unprocessable(
        'INTEGRATION_NAME_INVALID',
        `Le nom doit suivre ${INTEGRATION_NAME_PATTERN} (minuscules, chiffres et tirets, 3 a 40 caracteres).`,
        { name },
      );
    }

    const scopes = this.resolveScopes(dto.scopes ?? []);
    const secret = generateIntegrationToken();
    const account = await this.createServiceAccount(name);

    try {
      const token = await this.prisma.integrationToken.create({
        data: {
          name,
          prefix: secret.slice(0, 12),
          tokenHash: hashIntegrationToken(secret),
          scopes,
          accountId: account.id,
          createdById: actor.id,
          expiresAt: this.expiresFrom(dto.expiresInDays),
        },
        select: TOKEN_SELECT,
      });

      await this.audit.record({
        actorId: actor.id,
        action: 'INTEGRATION_TOKEN_CREATED',
        entityType: 'IntegrationToken',
        entityId: token.id,
        after: { name, prefix: token.prefix, scopes },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return { token: toIntegrationTokenView(token), secret };
    } catch (error) {
      // Le compte technique a ete cree juste avant : si l'ecriture du jeton
      // echoue (nom deja pris, base indisponible), on ne le laisse pas orphelin.
      await this.prisma.user.delete({ where: { id: account.id } }).catch(() => undefined);
      throw this.translateWriteError(error, name);
    }
  }

  async list(
    query: ListIntegrationTokensQueryDto,
    actor: AuthenticatedUser,
  ): Promise<Paginated<IntegrationTokenView>> {
    new AccessPolicy(actor).requireScope('integration', 'read', [SCOPE_ANY]);
    const p = resolvePagination(query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.integrationToken.findMany({
        skip: p.skip,
        take: p.take,
        orderBy: { createdAt: 'desc' },
        select: TOKEN_SELECT,
      }),
      this.prisma.integrationToken.count(),
    ]);

    return paginated(rows.map(toIntegrationTokenView), total, p);
  }

  /**
   * Renouvelle le secret. L'ancien cesse de fonctionner IMMEDIATEMENT : c'est le
   * geste a faire quand un jeton a pu fuiter (un workflow n8n partage, un ticket,
   * un journal). Les droits peuvent etre revus au passage, sans changer de nom ni
   * d'identifiant — ce qui evite de reconfigurer tous les appels.
   */
  async renew(
    id: string,
    dto: RenewIntegrationTokenDto,
    actor: AuthenticatedUser,
    meta: RequestContext,
  ): Promise<{ token: IntegrationTokenView; secret: string }> {
    new AccessPolicy(actor).requireScope('integration', 'manage', [SCOPE_ANY]);

    const current = await this.requireToken(id);
    const scopes = dto.scopes ? this.resolveScopes(dto.scopes) : current.scopes;
    const secret = generateIntegrationToken();

    const token = await this.prisma.integrationToken.update({
      where: { id: current.id },
      data: {
        prefix: secret.slice(0, 12),
        tokenHash: hashIntegrationToken(secret),
        scopes,
        expiresAt: this.expiresFrom(dto.expiresInDays),
        // Un renouvellement leve la revocation : c'est une remise en service
        // explicite, pas une resurrection silencieuse d'un jeton coupe.
        revokedAt: null,
      },
      select: TOKEN_SELECT,
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'INTEGRATION_TOKEN_RENEWED',
      entityType: 'IntegrationToken',
      entityId: token.id,
      after: { name: token.name, prefix: token.prefix, scopes },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { token: toIntegrationTokenView(token), secret };
  }

  /**
   * Revoque : le jeton cesse d'authentifier DES LA REPONSE RENDUE, puisqu'il est
   * relu en base a chaque requete (aucun cache de droits cote serveur).
   */
  async revoke(
    id: string,
    actor: AuthenticatedUser,
    meta: RequestContext,
  ): Promise<IntegrationTokenView> {
    new AccessPolicy(actor).requireScope('integration', 'manage', [SCOPE_ANY]);
    const current = await this.requireToken(id);

    const token = await this.prisma.integrationToken.update({
      where: { id: current.id },
      data: { revokedAt: new Date() },
      select: TOKEN_SELECT,
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'INTEGRATION_TOKEN_REVOKED',
      entityType: 'IntegrationToken',
      entityId: token.id,
      after: { name: token.name, prefix: token.prefix },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toIntegrationTokenView(token);
  }

  /** Supprime definitivement (le compte technique suit, en cascade). */
  async remove(id: string, actor: AuthenticatedUser, meta: RequestContext): Promise<void> {
    new AccessPolicy(actor).requireScope('integration', 'manage', [SCOPE_ANY]);
    const current = await this.requireToken(id);

    await this.prisma.integrationToken.delete({ where: { id: current.id } });

    await this.audit.record({
      actorId: actor.id,
      action: 'INTEGRATION_TOKEN_DELETED',
      entityType: 'IntegrationToken',
      entityId: current.id,
      before: { name: current.name, prefix: current.prefix },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  // ---------------------------------------------------------------------------
  // Authentification (appele par le garde, a chaque requete)
  // ---------------------------------------------------------------------------

  /**
   * Resout le porteur d'un jeton d'integration.
   *
   * AUCUN CACHE : le jeton est relu en base a chaque requete. C'est ce qui rend
   * la revocation immediate — avec un cache, revoquer un jeton compromis
   * laisserait une fenetre pendant laquelle il continue d'agir, et c'est
   * exactement dans cette fenetre qu'un attaquant travaille.
   *
   * Les refus sont tous des 401 : du point de vue de l'appelant, un jeton revoque
   * ou perime n'est plus un jeton. Le detail (revoque, perime, inconnu) part dans
   * le journal, pas dans la reponse — elle ne doit rien apprendre a celui qui
   * presente un jeton qu'il n'a pas.
   */
  async resolvePrincipal(token: string): Promise<AuthenticatedUser> {
    if (!looksLikeIntegrationToken(token)) {
      throw AppException.unauthenticated(
        'INTEGRATION_TOKEN_INVALID',
        'Jeton d’integration invalide.',
      );
    }

    const row = await this.prisma.integrationToken.findUnique({
      where: { tokenHash: hashIntegrationToken(token) },
      select: {
        id: true,
        tokenHash: true,
        scopes: true,
        revokedAt: true,
        expiresAt: true,
        accountId: true,
        account: {
          select: { id: true, email: true, firstName: true, lastName: true, deletedAt: true },
        },
      },
    });

    // La recherche se fait PAR l'empreinte, ce qui suffirait en pratique. La
    // comparaison en temps constant est la seconde barriere : elle couvre le cas
    // ou la recherche ne porterait plus sur l'empreinte un jour (un index
    // partiel, une colonne tronquee) — la verification reste alors cote code, et
    // pas seulement cote requete.
    //
    // Meme reponse pour « inconnu » et « empreinte fausse » : ne pas dire
    // lesquels existent.
    if (!row || !integrationTokenMatches(token, row.tokenHash)) {
      throw AppException.unauthenticated(
        'INTEGRATION_TOKEN_INVALID',
        'Jeton d’integration invalide.',
      );
    }

    if (row.revokedAt) {
      this.logger.warn(`Jeton d’integration revoque presente (${row.id})`);
      throw AppException.unauthenticated(
        'INTEGRATION_TOKEN_REVOKED',
        'Ce jeton d’integration a ete revoque.',
      );
    }

    if (isIntegrationTokenExpired(row.expiresAt)) {
      this.logger.warn(`Jeton d’integration perime presente (${row.id})`);
      throw AppException.unauthenticated(
        'INTEGRATION_TOKEN_EXPIRED',
        'Ce jeton d’integration est perime.',
      );
    }

    if (!row.account || row.account.deletedAt) {
      throw AppException.unauthenticated(
        'INTEGRATION_TOKEN_INVALID',
        'Jeton d’integration invalide.',
      );
    }

    void this.touchLastUsedAt(row.id);

    return {
      id: row.account.id,
      email: row.account.email,
      firstName: row.account.firstName,
      lastName: row.account.lastName,
      // AUCUN ROLE : les droits viennent du jeton et de rien d'autre. Un compte
      // technique avec un role pourrait continuer d'agir apres la revocation de
      // son jeton, ce qui viderait la revocation de son sens.
      roles: [],
      permissions: new Set(row.scopes),
      clientId: null,
      mustChangePassword: false,
      isIntegration: true,
    };
  }

  /**
   * Note le dernier usage, au plus une fois par minute et par jeton.
   *
   * Une ecriture par requete ferait de l'authentification la requete la plus
   * couteuse de l'API — pour une information qui ne sert qu'a repondre a « ce
   * jeton sert-il encore ? ». La minute garde l'utile sans payer le reste.
   *
   * L'echec est ignore volontairement : ne pas pouvoir dater un usage ne doit
   * jamais empcher une integration de travailler.
   */
  private async touchLastUsedAt(id: string): Promise<void> {
    const threshold = new Date(Date.now() - 60_000);
    try {
      await this.prisma.integrationToken.updateMany({
        where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: threshold } }] },
        data: { lastUsedAt: new Date() },
      });
    } catch (error) {
      this.logger.debug(
        `Datation du dernier usage impossible (${id}) : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Internes
  // ---------------------------------------------------------------------------

  /** Valide les ports demandes contre le catalogue, en refusant tout inconnu. */
  private resolveScopes(requested: readonly string[]): string[] {
    const result = normalizeIntegrationScopes(requested, ALL_PERMISSION_CODES);

    if (result.ok) return result.scopes;

    if (result.unknown.length > 0) {
      throw AppException.unprocessable(
        'INTEGRATION_SCOPE_UNKNOWN',
        `Permissions inexistantes au catalogue : ${result.unknown.join(', ')}.`,
        { unknown: result.unknown },
      );
    }

    if (result.forbidden.length > 0) {
      throw AppException.unprocessable(
        'INTEGRATION_SCOPE_FORBIDDEN',
        'Une integration ne peut pas recevoir la gestion des integrations.',
        { forbidden: result.forbidden },
      );
    }

    throw AppException.unprocessable(
      'INTEGRATION_SCOPE_TOO_MANY',
      'Trop de permissions demandees pour un seul jeton.',
      { maximum: requested.length },
    );
  }

  private expiresFrom(days: number | undefined): Date | null {
    if (!days) return null;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private async requireToken(
    id: string,
  ): Promise<{ id: string; name: string; prefix: string; scopes: string[] }> {
    const token = await this.prisma.integrationToken.findUnique({
      where: { id },
      select: { id: true, name: true, prefix: true, scopes: true },
    });

    if (!token) {
      throw AppException.notFound('INTEGRATION_TOKEN_NOT_FOUND', 'Ce jeton est introuvable.');
    }

    return token;
  }

  /**
   * Cree le compte technique associe.
   *
   * Son mot de passe est un secret aleatoire de 32 octets, hashe comme un mot de
   * passe : personne ne le connait, donc personne ne peut se connecter avec. Le
   * compte existe pour porter des cles etrangeres et signer la trace, pas pour
   * ouvrir une session.
   */
  private async createServiceAccount(name: string): Promise<{ id: string }> {
    const email = integrationEmailFor(name);
    const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));

    try {
      return await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName: name,
          lastName: 'Integration',
          isServiceAccount: true,
          // Jamais de mot de passe a changer : le compte n'en a pas l'usage, et
          // exiger un changement bloquerait l'integration des la premiere requete.
          mustChangePassword: false,
          isEmailVerified: true,
        },
        select: { id: true },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw AppException.conflict(
          'INTEGRATION_ALREADY_EXISTS',
          `Une integration nommee « ${name} » existe deja.`,
        );
      }
      throw error;
    }
  }

  private translateWriteError(error: unknown, name: string): unknown {
    if (this.isUniqueViolation(error)) {
      return AppException.conflict(
        'INTEGRATION_ALREADY_EXISTS',
        `Une integration nommee « ${name} » existe deja.`,
      );
    }
    return error;
  }

  private isUniqueViolation(error: unknown): boolean {
    // P2002 = violation de contrainte unique (Prisma).
    return (
      typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
    );
  }
}

/**
 * Projection commune. `tokenHash` N'Y FIGURE JAMAIS : c'est le champ sensible, et
 * l'exclure ici — plutot que dans le presenter — garantit qu'aucune lecture
 * distraite ne peut le rendre, meme par oubli.
 */
const TOKEN_SELECT = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.IntegrationTokenSelect;
