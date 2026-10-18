import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BalanceService } from './balance.service.js';
import { PaginationQueryDto, type Paginated } from '../../common/dto/pagination.dto.js';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import type { BalanceTransaction, MemberBalance } from '../../generated/prisma/client.js';
import { UrlBuilderService } from '../../common/services/url-builder.service.js';

/**
 * CONTRÔLEUR REST DES SOLDES
 *
 * Routes:
 * - GET /balances/me - Obtenir mon solde
 * - GET /balances/me/all - Obtenir tous mes soldes
 * - GET /balances/me/transactions - Historique de mes transactions
 * - GET /balances/me/total-earnings - Total de mes gains
 * - GET /balances/users/:userId - Soldes d'un membre (balance:read:any)
 * - GET /balances/users/:userId/transactions - Historique d'un membre
 * - POST /balances/adjust - Ajustement manuel (balance:manage:any)
 *
 * CHAQUE ROUTE DIT QUI ELLE AUTORISE, et la vérification réelle est dans le
 * service (`policy.requireScope`) : c'est la double barrière — le décorateur
 * refuse tôt et moins cher, le service refuse ce qui passerait par un autre
 * chemin (tâche planifiée, script, test d'intégration).
 *
 * Les routes `me/*` n'exigent AUCUNE permission nommée : `balance:read:own`
 * est possédé par tout membre de l'équipe, et le service tranche lui-même
 * entre « mon solde » (own) et « le solde d'un autre » (any). Un décorateur
 * `balance:read:own` ici serait vrai pour tout le monde et ne protégerait
 * donc rien — c'est la comparaison `policy.userId !== userId` qui protège.
 */

@ApiTags('Balances')
@ApiBearerAuth()
@Controller('balances')
export class BalanceController {
  constructor(
    private readonly balanceService: BalanceService,
    private readonly urlBuilder: UrlBuilderService,
  ) {}

  // ---------------------------------------------------------------------------
  // Mon compte
  // ---------------------------------------------------------------------------

  @Get('me')
  @ApiOperation({ summary: 'Obtenir mon solde pour une devise' })
  async getMyBalance(
    @Query('currency') currency: string = 'DZD',
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MemberBalance | null> {
    return this.balanceService.getBalance(user.id, currency, new AccessPolicy(user));
  }

  @Get('me/all')
  @ApiOperation({ summary: 'Obtenir tous mes soldes' })
  async getAllMyBalances(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MemberBalance[]> {
    return this.balanceService.getAllBalances(user.id, new AccessPolicy(user));
  }

  @Get('me/transactions')
  @ApiOperation({ summary: "Obtenir l'historique de mes transactions" })
  async getMyTransactionHistory(
    @Query() query: PaginationQueryDto & { currency?: string; type?: string; status?: string },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<BalanceTransaction>> {
    return this.balanceService.getTransactionHistory(
      user.id,
      {
        currency: query.currency,
        type: query.type as BalanceTransaction['type'] | undefined,
        // La pagination fait partie de la requête, pas un détail d'affichage :
        // `perPage=5` demandé par le panneau doit rendre cinq lignes. Sans ce
        // transfert, `resolvePagination` retombait sur ses valeurs par défaut et
        // le panneau affichait jusqu'à vingt mouvements pour cinq demandés.
        page: query.page,
        perPage: query.perPage,
        status: query.status as BalanceTransaction['status'] | undefined,
      },
      new AccessPolicy(user),
    );
  }

  @Get('me/total-earnings')
  @ApiOperation({ summary: 'Obtenir le total de mes gains' })
  async getMyTotalEarnings(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ total: string; byCurrency: Record<string, string> }> {
    const result = await this.balanceService.getTotalEarnings(user.id, new AccessPolicy(user));
    return {
      total: result.total.toString(),
      byCurrency: Object.fromEntries(
        Object.entries(result.byCurrency).map(([k, v]) => [k, v.toString()]),
      ),
    };
  }

  // ---------------------------------------------------------------------------
  // Administration — visibilité des soldes de chacun
  // ---------------------------------------------------------------------------

  @Get('users/:userId')
  @RequirePermissions('balance:read:any')
  @ApiOperation({ summary: 'Obtenir les soldes de chaque membre' })
  async getUserBalances(
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MemberBalance[]> {
    return this.balanceService.getAllBalances(userId, new AccessPolicy(user));
  }

  @Get('users/:userId/transactions')
  @RequirePermissions('balance:read:any')
  @ApiOperation({ summary: "Obtenir l'historique des transactions d'un membre" })
  async getUserTransactionHistory(
    @Param('userId') userId: string,
    @Query() query: PaginationQueryDto & { currency?: string; type?: string; status?: string },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<BalanceTransaction>> {
    return this.balanceService.getTransactionHistory(
      userId,
      {
        currency: query.currency,
        type: query.type as BalanceTransaction['type'] | undefined,
        // La pagination fait partie de la requête, pas un détail d'affichage :
        // `perPage=5` demandé par le panneau doit rendre cinq lignes. Sans ce
        // transfert, `resolvePagination` retombait sur ses valeurs par défaut et
        // le panneau affichait jusqu'à vingt mouvements pour cinq demandés.
        page: query.page,
        perPage: query.perPage,
        status: query.status as BalanceTransaction['status'] | undefined,
      },
      new AccessPolicy(user),
    );
  }

  @Post('adjust')
  @RequirePermissions('balance:manage:any')
  @ApiOperation({ summary: 'Effectuer un ajustement manuel' })
  async adjustBalance(
    @Body() body: { userId: string; currency: string; amount: string; description: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const transaction = await this.balanceService.adjustBalance(
      body.userId,
      body.currency,
      body.amount,
      body.description,
      { id: user.id },
      new AccessPolicy(user),
    );

    // AUCUNE redirection forcée, et c'est un choix. Un ajustement de solde se
    // fait depuis la fiche d'un membre ou depuis un tableau : arracher
    // l'opérateur vers le tableau de bord lui ferait perdre la liste qu'il
    // était en train de traiter, pour une information qu'il vient lui-même de
    // saisir. La réponse porte donc le verbe (« Solde ajusté avec succès ») et
    // rien d'autre : la notification d'action l'affiche, et la page se
    // rafraîchit d'elle-même. `resourceType` reste exigé par `buildResponse`,
    // mais sans `redirectTo` ni `resourceId` il ne construit aucune URL.
    return this.urlBuilder.buildResponse(transaction, {
      message: 'Solde ajusté avec succès',
      resourceType: 'currency',
    });
  }
}
