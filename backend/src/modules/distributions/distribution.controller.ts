import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DistributionService } from './distribution.service.js';
import { AccessPolicy, Policy } from '../../common/auth/principal.js';
import { CurrentActor } from '../../common/auth/decorators.js';
import { RequiresPolicy } from '../../common/auth/guards.js';
import { DistributionConfig, ProjectDistribution } from '../../generated/prisma/client.js';
import { UrlBuilderService } from '../../../common/services/url-builder.service.js';

/**
 * CONTRÔLEUR REST DES RÉPARTITIONS
 *
 * Routes:
 * - GET /distributions/configs - Lister les configurations
 * - GET /distributions/configs/active - Config active
 * - GET /distributions/configs/:id - Config par ID
 * - POST /distributions/configs - Créer une config (ADMIN)
 * - POST /distributions/projects/:projectId/calculate - Calculer
 * - POST /distributions/projects/:projectId/apply - Appliquer
 * - GET /distributions/projects/:projectId - Historique
 * - GET /distributions/:id - Répartition par ID
 *
 * Toutes les réponses incluent des URLs de redirection vers Comexa
 */

@ApiTags('Distributions')
@ApiBearerAuth()
@Controller('distributions')
export class DistributionController {
  constructor(
    private readonly distributionService: DistributionService,
    private readonly urlBuilder: UrlBuilderService,
  ) {}

  // ---------------------------------------------------------------------------
  // Configurations
  // ---------------------------------------------------------------------------

  @Get('configs')
  @ApiOperation({ summary: 'Lister toutes les configurations de répartition' })
  @ApiOkResponse({ type: [DistributionConfig] })
  async listConfigs(@Policy() policy: AccessPolicy): Promise<DistributionConfig[]> {
    return this.distributionService.listConfigs(policy);
  }

  @Get('configs/active')
  @ApiOperation({ summary: 'Obtenir la configuration active' })
  @ApiOkResponse({ type: DistributionConfig })
  async getActiveConfig(@Policy() policy: AccessPolicy): Promise<DistributionConfig | null> {
    return this.distributionService.getActiveConfig(policy);
  }

  @Get('configs/:id')
  @ApiOperation({ summary: 'Obtenir une configuration par ID' })
  @ApiOkResponse({ type: DistributionConfig })
  async getConfigById(
    @Param('id') id: string,
    @Policy() policy: AccessPolicy,
  ): Promise<DistributionConfig | null> {
    return this.distributionService.getConfigById(id, policy);
  }

  @Post('configs')
  @RequiresPolicy('distribution', 'manage')
  @ApiOperation({ summary: 'Créer une configuration de répartition' })
  @ApiOkResponse({ type: DistributionConfig })
  async createConfig(
    @Body() body: {
      name: string;
      description?: string;
      baseType?: string;
      effectiveDate?: string;
      endDate?: string;
      beneficiaries: {
        beneficiaryType: string;
        name: string;
        percentage: string;
        userId?: string;
        order: number;
      }[];
    },
    @CurrentActor() actor: { id: string },
    @Policy() policy: AccessPolicy,
  ): Promise<DistributionConfig> {
    const config = await this.distributionService.createConfig(
      {
        name: body.name,
        description: body.description,
        baseType: body.baseType as any,
        effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        beneficiaries: body.beneficiaries.map((b) => ({
          beneficiaryType: b.beneficiaryType as any,
          name: b.name,
          percentage: b.percentage,
          userId: b.userId,
          order: b.order,
        })),
      },
      actor,
      policy,
    );

    return this.urlBuilder.buildResponse(config, {
      message: 'Configuration de répartition créée avec succès',
      redirectTo: 'settings',
      resourceType: 'currency',
      openInNewTab: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Répartitions par projet
  // ---------------------------------------------------------------------------

  @Post('projects/:projectId/calculate')
  @RequiresPolicy('distribution', 'manage')
  @ApiOperation({ summary: 'Calculer une répartition pour un projet' })
  @ApiOkResponse({ type: ProjectDistribution })
  async calculateForProject(
    @Param('projectId') projectId: string,
    @Query('configId') configId?: string,
    @Policy() policy: AccessPolicy,
  ) {
    const distribution = await this.distributionService.calculateForProject(
      projectId,
      configId,
      policy,
    );

    return this.urlBuilder.buildResponse(distribution, {
      message: 'Répartition calculée avec succès',
      redirectTo: 'detail',
      resourceType: 'distribution',
      resourceId: projectId,
      openInNewTab: true,
    });
  }

  @Post('projects/:projectId/apply')
  @RequiresPolicy('distribution', 'manage')
  @ApiOperation({ summary: 'Appliquer une répartition (créditer les soldes)' })
  @ApiOkResponse({ type: ProjectDistribution })
  async applyDistribution(
    @Param('id') id: string,
    @Policy() policy: AccessPolicy,
  ) {
    const distribution = await this.distributionService.applyDistribution(id, policy);

    return this.urlBuilder.buildResponse(distribution, {
      message: 'Répartition appliquée avec succès',
      redirectTo: 'detail',
      resourceType: 'distribution',
      resourceId: distribution.projectId,
      openInNewTab: true,
    });
  }

  @Get('projects/:projectId')
  @ApiOperation({ summary: 'Obtenir l\'historique des répartitions pour un projet' })
  @ApiOkResponse({ type: [ProjectDistribution] })
  async getProjectDistributions(
    @Param('projectId') projectId: string,
    @Policy() policy: AccessPolicy,
  ): Promise<ProjectDistribution[]> {
    return this.distributionService.getProjectDistributions(projectId, policy);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtenir une répartition par ID' })
  @ApiOkResponse({ type: ProjectDistribution })
  async getDistributionById(
    @Param('id') id: string,
    @Policy() policy: AccessPolicy,
  ): Promise<ProjectDistribution | null> {
    return this.distributionService.getDistributionById(id, policy);
  }
}
