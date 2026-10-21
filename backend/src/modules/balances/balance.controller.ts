import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BalanceService, type MemberBalanceSummary } from './balance.service.js';
import type { Paginated } from '../../common/dto/pagination.dto.js';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import type { BalanceTransaction, MemberBalance } from '../../generated/prisma/client.js';
import { UrlBuilderService } from '../../common/services/url-builder.service.js';
import {
  ListBalanceTransactionsQueryDto,
  ListBalancesQueryDto,
  RecordBalanceOperationDto,
  ReverseBalanceOperationDto,
  TransactionHistoryQueryDto,
} from './dto/balance.dto.js';

/**
 * CONTRÔLEUR REST DES SOLDES
 *
 * Routes:
 * - GET /balances/me - Obtenir mon solde
 * - GET /balances/me/all - Obtenir tous mes soldes
 * - GET /balances/me/summary - Mon relevé (gains, versements, reste dû)
 * - GET /balances/me/transactions - Historique de mes transactions
 * - GET /balances/me/total-earnings - Total de mes gains
 * - GET /balances/admin/overview - Soldes de tous les membres (balance:read:any)
 * - GET /balances/admin/transactions - Historique global (balance:read:any)
 * - GET /balances/users/:userId - Soldes d'un membre (balance:read:any)
 * - GET /balances/users/:userId/transactions - Historique d'un membre
 * - POST /balances/operations - Enregistrer paiement / avance / ajustement
 * - POST /balances/transactions/:id/reverse - Contre-passer une opération
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
 *
 * LES ROUTES `admin/*` SONT DÉCLARÉES AVANT `users/:userId` : l'ordre des
 * declarations décide, et `admin` serait sinon capté par `:userId`.
 */

@ApiTags('Balances')
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
  async getAllMyBalances(@CurrentUser() user: AuthenticatedUser): Promise<MemberBalance[]> {
    return this.balanceService.getAllBalances(user.id, new AccessPolicy(user));
  }

  @Get('me/summary')
  @ApiOperation({
    summary: 'Mon relevé de solde : gains, versements, avances, ajustements, reste dû',
  })
  async getMySummary(
    @Query('currency') currency: string = 'DZD',
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MemberBalanceSummary[]> {
    // Un membre ne voit QUE ses propres lignes : la lecture « any » est
    // réservée à l'administration, et cette route renvoie un tableau filtré
    // sur son propre identifiant.
    return this.balanceService.listBalances({ userId: user.id, currency }, new AccessPolicy(user));
  }

  @Get('me/transactions')
  @ApiOperation({ summary: "Obtenir l'historique de mes transactions" })
  async getMyTransactionHistory(
    @Query() query: TransactionHistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<BalanceTransaction>> {
    return this.balanceService.getTransactionHistory(
      user.id,
      {
        currency: query.currency,
        type: query.type,
        // La pagination fait partie de la requête, pas un détail d'affichage :
        // `perPage=5` demandé par le panneau doit rendre cinq lignes. Sans ce
        // transfert, `resolvePagination` retombait sur ses valeurs par défaut et
        // le panneau affichait jusqu'à vingt mouvements pour cinq demandés.
        page: query.page,
        perPage: query.perPage,
        status: query.status,
        kind: query.kind,
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
  //
  // Déclaré AVANT `users/:userId` : sinon « admin » serait capté par
  // `:userId` et la route ne répondrait jamais.
  // ---------------------------------------------------------------------------

  /**
   * Les comptes qui peuvent recevoir une part, un versement ou une avance.
   *
   * La meme regle que celle appliquee a l'ecriture : la liste proposee et la
   * validation ne peuvent pas diverger. Un client n'y est pas — un client
   * recoit une facture, pas une part de repartition.
   */
  @Get('eligible-members')
  @RequireAnyPermission('balance:read:any', 'distribution:read:any')
  @ApiOperation({ summary: 'Membres de l’équipe éligibles à une opération financière' })
  async getEligibleMembers() {
    const members = await this.balanceService.listEligibleMembers();
    return this.urlBuilder.buildResponse(members, {
      message: 'Membres éligibles',
      resourceType: 'currency',
    });
  }

  @Get('admin/overview')
  @RequirePermissions('balance:read:any')
  @ApiOperation({
    summary: 'Soldes de tous les membres (avec filtres membre, projet, période, devise, nature)',
  })
  async getBalancesOverview(
    @Query() query: ListBalancesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MemberBalanceSummary[]> {
    return this.balanceService.listBalances(
      {
        userId: query.userId,
        projectId: query.projectId,
        currency: query.currency,
        kind: query.kind,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
      new AccessPolicy(user),
    );
  }

  @Get('admin/transactions')
  @RequirePermissions('balance:read:any')
  @ApiOperation({ summary: 'Historique global des opérations de solde' })
  async getAllTransactions(
    @Query() query: ListBalanceTransactionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<BalanceTransaction>> {
    return this.balanceService.listTransactions(
      {
        userId: query.userId,
        projectId: query.projectId,
        currency: query.currency,
        kind: query.kind,
        type: query.type,
        status: query.status,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        page: query.page,
        perPage: query.perPage,
      },
      new AccessPolicy(user),
    );
  }

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
    @Query() query: TransactionHistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<BalanceTransaction>> {
    return this.balanceService.getTransactionHistory(
      userId,
      {
        currency: query.currency,
        type: query.type,
        page: query.page,
        perPage: query.perPage,
        status: query.status,
        kind: query.kind,
      },
      new AccessPolicy(user),
    );
  }

  // ---------------------------------------------------------------------------
  // Écriture — paiement, avance, ajustement, régularisation
  // ---------------------------------------------------------------------------

  @Post('operations')
  @RequirePermissions('balance:manage:any')
  @ApiOperation({
    summary: 'Enregistrer un paiement, une avance, un ajustement ou une régularisation',
  })
  async recordOperation(
    @Body() body: RecordBalanceOperationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const transaction = await this.balanceService.recordOperation(
      {
        userId: body.userId,
        kind: body.kind,
        amount: body.amount,
        currency: body.currency,
        reason: body.reason,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : null,
        reference: body.reference ?? null,
        projectId: body.projectId ?? null,
        idempotencyKey: body.idempotencyKey ?? null,
      },
      { id: user.id },
      new AccessPolicy(user),
    );

    return this.urlBuilder.buildResponse(transaction, {
      message: 'Opération enregistrée avec succès',
      resourceType: 'currency',
    });
  }

  @Post('transactions/:id/reverse')
  @RequirePermissions('balance:manage:any')
  @ApiOperation({
    summary: 'Contre-passer une opération validée (jamais de suppression)',
  })
  async reverseOperation(
    @Param('id') id: string,
    @Body() body: ReverseBalanceOperationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const transaction = await this.balanceService.reverseOperation(
      id,
      {
        reason: body.reason,
        reference: body.reference ?? null,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : null,
      },
      { id: user.id },
      new AccessPolicy(user),
    );

    return this.urlBuilder.buildResponse(transaction, {
      message: 'Opération contre-passée avec succès',
      resourceType: 'currency',
    });
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
