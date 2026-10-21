import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DistributionService } from './distribution.service.js';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import type { ProjectDistribution } from '../../generated/prisma/client.js';
import { DistributionBaseType } from '../../generated/prisma/enums.js';
import { UrlBuilderService } from '../../common/services/url-builder.service.js';
import {
  CalculateDistributionDto,
  CreateDistributionConfigDto,
  ListRulesQueryDto,
  RegularizeDistributionDto,
  ReviseDistributionConfigDto,
} from './dto/distribution.dto.js';

/**
 * CONTRÔLEUR REST DES RÉPARTITIONS
 *
 * Routes:
 * - GET  /distributions/configs               - Lister les règles (toutes versions)
 * - GET  /distributions/configs/active        - Règle par défaut en vigueur
 * - GET  /distributions/configs/:id           - Règle par ID
 * - GET  /distributions/configs/:id/history   - Historique des versions
 * - POST /distributions/configs               - Créer une règle (global ou exception projet)
 * - POST /distributions/configs/:id/revise    - Nouvelle VERSION d'une règle
 * - POST /distributions/configs/:id/deactivate- Désactiver une règle
 * - GET  /distributions/projects/:projectId/base      - Base de calcul détaillée
 * - POST /distributions/projects/:projectId/calculate - Calculer
 * - POST /distributions/:id/apply             - Appliquer (créditer les soldes)
 * - POST /distributions/:id/regularize        - Régulariser par contre-passation
 * - POST /distributions/:id/cancel            - Annuler (uniquement si non appliquée)
 * - GET  /distributions/projects/:projectId   - Répartitions d'un projet
 * - GET  /distributions/:id                   - Répartition par ID
 *
 * L'ORDRE DES DÉCLARATIONS COMPTE : `configs/active` est déclaré avant
 * `configs/:id`, et `configs/*` avant `:id` — sinon « configs » serait capté
 * par le paramètre `:id`.
 *
 * DEUX VERROUS SUR L'APPLICATION, ET ILS NE SONT PAS REDONDANTS :
 * `applyDistribution` crédite les soldes des membres dans une transaction.
 * Le décorateur refuse les non-administrateurs AVANT d'ouvrir la transaction ;
 * le service revérifie (`requireScope`) parce qu'il est aussi appelable
 * depuis une tâche planifiée ou un script, où aucun décorateur ne passe.
 *
 * L'APPLICATION PREND L'ID DE LA RÉPARTITION, PAS CELUI DU PROJET : une même
 * configuration peut être recalculée plusieurs fois sur un projet (nouveau
 * paiement entre-temps), et chacune de ces répartitions est un objet distinct
 * avec son propre historique. « Appliquer la répartition du projet » ne
 * voudrait rien dire quand il y en a trois.
 */

@ApiTags('Distributions')
@Controller('distributions')
export class DistributionController {
  constructor(
    private readonly distributionService: DistributionService,
    private readonly urlBuilder: UrlBuilderService,
  ) {}

  // ---------------------------------------------------------------------------
  // Règles
  // ---------------------------------------------------------------------------

  @Get('configs')
  @RequirePermissions('distribution:read:any')
  @ApiOperation({ summary: 'Lister toutes les règles de répartition (toutes versions)' })
  async listConfigs(@Query() query: ListRulesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.distributionService.listConfigs(new AccessPolicy(user), {
      projectId: query.projectId ?? null,
      scope: query.scope,
    });
  }

  @Get('configs/active')
  @RequirePermissions('distribution:read:any')
  @ApiOperation({ summary: 'Obtenir la règle par défaut en vigueur' })
  async getActiveConfig(@CurrentUser() user: AuthenticatedUser) {
    return this.distributionService.getActiveConfig(new AccessPolicy(user));
  }

  @Get('configs/:id')
  @RequirePermissions('distribution:read:any')
  @ApiOperation({ summary: 'Obtenir une règle par ID' })
  async getConfigById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.distributionService.getConfigById(id, new AccessPolicy(user));
  }

  @Get('configs/:id/history')
  @RequirePermissions('distribution:read:any')
  @ApiOperation({ summary: 'Historique des versions d’une règle' })
  async getConfigHistory(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.distributionService.getRuleHistory(id, new AccessPolicy(user));
  }

  @Post('configs')
  @RequirePermissions('distribution:manage:any')
  @ApiOperation({
    summary: 'Créer une règle (règle par défaut, ou exception propre à un projet)',
  })
  async createConfig(
    @Body() body: CreateDistributionConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const config = await this.distributionService.createRule(
      {
        name: body.name,
        description: body.description ?? null,
        baseType: body.baseType ?? DistributionBaseType.COLLECTED_AMOUNT,
        effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : null,
        projectId: body.projectId ?? null,
        beneficiaries: body.beneficiaries,
      },
      { id: user.id },
      new AccessPolicy(user),
    );

    return this.urlBuilder.buildResponse(config, {
      message: 'Règle de répartition créée avec succès',
      redirectTo: 'settings',
      resourceType: 'distribution',
      openInNewTab: false,
    });
  }

  @Post('configs/:id/revise')
  @RequirePermissions('distribution:manage:any')
  @ApiOperation({
    summary:
      'Créer une nouvelle VERSION d’une règle (sans recalculer les répartitions déjà validées)',
  })
  async reviseConfig(
    @Param('id') id: string,
    @Body() body: ReviseDistributionConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const config = await this.distributionService.reviseConfig(
      id,
      {
        name: body.name,
        description: body.description,
        baseType: body.baseType ?? DistributionBaseType.COLLECTED_AMOUNT,
        effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : null,
        beneficiaries: body.beneficiaries,
        confirm: body.confirm,
        reason: body.reason ?? null,
      },
      { id: user.id },
      new AccessPolicy(user),
    );

    return this.urlBuilder.buildResponse(config, {
      message:
        'Nouvelle version de la règle créée. Les répartitions déjà validées ne changent pas.',
      resourceType: 'distribution',
      openInNewTab: false,
    });
  }

  @Post('configs/:id/deactivate')
  @RequirePermissions('distribution:manage:any')
  @ApiOperation({ summary: 'Désactiver une règle (sans la supprimer)' })
  async deactivateConfig(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const config = await this.distributionService.deactivateConfig(
      id,
      { id: user.id },
      new AccessPolicy(user),
    );

    return this.urlBuilder.buildResponse(config, {
      message: 'Règle désactivée',
      resourceType: 'distribution',
      openInNewTab: false,
    });
  }

  // ---------------------------------------------------------------------------
  // Répartitions par projet
  // ---------------------------------------------------------------------------

  @Get('projects/:projectId/base')
  @RequirePermissions('distribution:read:any')
  @ApiOperation({
    summary: 'Base de calcul d’un projet : budget, facturé, encaissé, devise, règle applicable',
  })
  async getProjectBase(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.distributionService.getProjectBase(projectId, new AccessPolicy(user));
  }

  @Post('projects/:projectId/calculate')
  @RequirePermissions('distribution:manage:any')
  @ApiOperation({ summary: 'Calculer une répartition pour un projet (idempotent)' })
  async calculateForProject(
    @Param('projectId') projectId: string,
    @Body() body: CalculateDistributionDto,
    @Query('configId') queryConfigId: string | undefined,
    @Query('idempotencyKey') queryIdempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Le corps prime, la query reste acceptee : les deux disent la meme
    // chose, et les anciens clients interrogent en query.
    const distribution = await this.distributionService.calculateForProject(
      projectId,
      {
        configId: body?.configId ?? queryConfigId ?? null,
        idempotencyKey: body?.idempotencyKey ?? queryIdempotencyKey ?? null,
      },
      new AccessPolicy(user),
    );

    // La page de répartition du projet est la destination naturelle : elle
    // montre le calcul qui vient d'être fait, part par part.
    return this.urlBuilder.buildResponse(distribution, {
      message: 'Répartition calculée avec succès',
      redirectTo: 'detail',
      resourceType: 'distribution',
      resourceId: projectId,
      openInNewTab: false,
    });
  }

  @Post(':id/apply')
  @RequirePermissions('distribution:manage:any')
  @ApiOperation({ summary: 'Appliquer une répartition (créditer les soldes)' })
  async applyDistribution(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const distribution = await this.distributionService.applyDistribution(
      id,
      new AccessPolicy(user),
    );

    return this.urlBuilder.buildResponse(distribution, {
      message: 'Répartition appliquée avec succès',
      redirectTo: 'detail',
      resourceType: 'distribution',
      resourceId: distribution.projectId,
      openInNewTab: false,
    });
  }

  @Post(':id/regularize')
  @RequirePermissions('distribution:manage:any')
  @ApiOperation({
    summary: 'Régulariser une répartition appliquée avec une autre règle (contre-passation tracée)',
  })
  async regularizeDistribution(
    @Param('id') id: string,
    @Body() body: RegularizeDistributionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const distribution = await this.distributionService.regularizeDistribution(
      id,
      { configId: body.configId, reason: body.reason },
      { id: user.id },
      new AccessPolicy(user),
    );

    return this.urlBuilder.buildResponse(distribution, {
      message: 'Régularisation calculée. Appliquez-la pour créditer l’écart par contre-passation.',
      resourceType: 'distribution',
      resourceId: distribution.projectId,
      openInNewTab: false,
    });
  }

  @Post(':id/cancel')
  @RequirePermissions('distribution:manage:any')
  @ApiOperation({ summary: 'Annuler une répartition qui n’a pas été appliquée' })
  async cancelDistribution(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const distribution = await this.distributionService.cancelDistribution(
      id,
      { id: user.id },
      new AccessPolicy(user),
    );

    return this.urlBuilder.buildResponse(distribution, {
      message: 'Répartition annulée',
      resourceType: 'distribution',
      resourceId: distribution.projectId,
      openInNewTab: false,
    });
  }

  @Get('projects/:projectId')
  @RequirePermissions('distribution:read:any')
  @ApiOperation({ summary: 'Obtenir les répartitions calculées pour un projet' })
  async getProjectDistributions(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProjectDistribution[]> {
    return this.distributionService.getProjectDistributions(projectId, new AccessPolicy(user));
  }

  @Get(':id')
  @RequirePermissions('distribution:read:any')
  @ApiOperation({ summary: 'Obtenir une répartition par ID' })
  async getDistributionById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProjectDistribution | null> {
    return this.distributionService.getDistributionById(id, new AccessPolicy(user));
  }
}
