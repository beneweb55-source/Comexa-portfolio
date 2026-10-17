import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BalanceService } from './balance.service.js';
import { PaginatedResponse, PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { AccessPolicy, Policy, SCOPE_ANY, SCOPE_OWN } from '../../common/auth/principal.js';
import { CurrentActor } from '../../common/auth/decorators.js';
import { RequiresPolicy } from '../../common/auth/guards.js';
import { BalanceTransaction, MemberBalance } from '../../generated/prisma/client.js';
import { UrlBuilderService } from '../../../common/services/url-builder.service.js';

/**
 * CONTRÔLEUR REST DES SOLDES
 *
 * Routes:
 * - GET /balances/me - Obtenir mon solde
 * - GET /balances/me/all - Obtenir tous mes soldes
 * - GET /balances/me/transactions - Historique de mes transactions
 * - GET /balances/users/:userId - Obtenir le solde d'un membre (ADMIN)
 * - POST /balances/adjust - Ajustement manuel (ADMIN)
 *
 * Toutes les réponses incluent des URLs de redirection vers Comexa
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
  @ApiOkResponse({ type: MemberBalance })
  async getMyBalance(
    @Query('currency') currency: string = 'DZD',
    @Policy() policy: AccessPolicy,
  ): Promise<MemberBalance | null> {
    return this.balanceService.getBalance(policy.userId, currency, policy);
  }

  @Get('me/all')
  @ApiOperation({ summary: 'Obtenir tous mes soldes' })
  @ApiOkResponse({ type: [MemberBalance] })
  async getAllMyBalances(@Policy() policy: AccessPolicy): Promise<MemberBalance[]> {
    return this.balanceService.getAllBalances(policy.userId, policy);
  }

  @Get('me/transactions')
  @ApiOperation({ summary: 'Obtenir l\'historique de mes transactions' })
  @ApiOkResponse({ type: PaginatedResponse<BalanceTransaction> })
  async getMyTransactionHistory(
    @Query() query: PaginationQueryDto & {
      currency?: string;
      type?: string;
    },
    @Policy() policy: AccessPolicy,
  ): Promise<PaginatedResponse<BalanceTransaction>> {
    return this.balanceService.getTransactionHistory(
      policy.userId,
      {
        ...query,
        currency: query.currency,
        type: query.type as any,
      },
      policy,
    );
  }

  @Get('me/total-earnings')
  @ApiOperation({ summary: 'Obtenir le total de mes gains' })
  @ApiOkResponse({ type: Object })
  async getMyTotalEarnings(@Policy() policy: AccessPolicy): Promise<{
    total: string;
    byCurrency: Record<string, string>;
  }> {
    const result = await this.balanceService.getTotalEarnings(policy.userId, policy);
    return {
      total: result.total.toString(),
      byCurrency: Object.fromEntries(
        Object.entries(result.byCurrency).map(([k, v]) => [k, v.toString()]),
      ),
    };
  }

  // ---------------------------------------------------------------------------
  // Administration
  // ---------------------------------------------------------------------------

  @Get('users/:userId')
  @RequiresPolicy('balance', 'read')
  @ApiOperation({ summary: 'Obtenir les soldes d\'un membre' })
  @ApiOkResponse({ type: [MemberBalance] })
  async getUserBalances(
    @Param('userId') userId: string,
    @Policy() policy: AccessPolicy,
  ): Promise<MemberBalance[]> {
    return this.balanceService.getAllBalances(userId, policy);
  }

  @Get('users/:userId/transactions')
  @RequiresPolicy('balance', 'read')
  @ApiOperation({ summary: 'Obtenir l\'historique des transactions d\'un membre' })
  @ApiOkResponse({ type: PaginatedResponse<BalanceTransaction> })
  async getUserTransactionHistory(
    @Param('userId') userId: string,
    @Query() query: PaginationQueryDto & {
      currency?: string;
      type?: string;
    },
    @Policy() policy: AccessPolicy,
  ): Promise<PaginatedResponse<BalanceTransaction>> {
    return this.balanceService.getTransactionHistory(
      userId,
      {
        ...query,
        currency: query.currency,
        type: query.type as any,
      },
      policy,
    );
  }

  @Post('adjust')
  @RequiresPolicy('balance', 'manage')
  @ApiOperation({ summary: 'Effectuer un ajustement manuel' })
  @ApiOkResponse({ type: BalanceTransaction })
  async adjustBalance(
    @Body() body: {
      userId: string;
      currency: string;
      amount: string;
      description: string;
    },
    @CurrentActor() actor: { id: string },
    @Policy() policy: AccessPolicy,
  ) {
    const transaction = await this.balanceService.adjustBalance(
      body.userId,
      body.currency,
      body.amount,
      body.description,
      actor,
      policy,
    );

    return this.urlBuilder.buildResponse(transaction, {
      message: 'Solde ajusté avec succès',
      redirectTo: 'settings',
      resourceType: 'currency',
      openInNewTab: true,
    });
  }
}
