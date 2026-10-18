import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DistributionService } from './distribution.service.js';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import type {
  DistributionConfig,
  ProjectDistribution,
  Prisma,
} from '../../generated/prisma/client.js';
import { UrlBuilderService } from '../../common/services/url-builder.service.js';

/**
 * CONTRÔLEUR REST DES RÉPARTITIONS
 *
 * Routes:
 * - GET /distributions/configs - Lister les configurations
 * - GET /distributions/configs/active - Config active
 * - GET /distributions/configs/:id - Config par ID
 * - POST /distributions/configs - Créer une config (distribution:manage:any)
 * - POST /distributions/projects/:projectId/calculate - Calculer
 * - POST /distributions/:id/apply - Appliquer (créditer les soldes)
 * - GET /distributions/projects/:projectId - Répartitions d'un projet
 * - GET /distributions/:id - Répartition par ID
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
  @RequirePermissions('distribution:read:any')
  @ApiOperation({ summary: 'Lister toutes les configurations de répartition' })
  async listConfigs(@CurrentUser() user: AuthenticatedUser): Promise<DistributionConfig[]> {
    return this.distributionService.listConfigs(new AccessPolicy(user));
  }

  @Get('configs/active')
  @RequirePermissions('distribution:read:any')
  @ApiOperation({ summary: 'Obtenir la configuration active' })
  async getActiveConfig(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DistributionConfig | null> {
    return this.distributionService.getActiveConfig(new AccessPolicy(user));
  }

  @Get('configs/:id')
  @RequirePermissions('distribution:read:any')
  @ApiOperation({ summary: 'Obtenir une configuration par ID' })
  async getConfigById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DistributionConfig | null> {
    return this.distributionService.getConfigById(id, new AccessPolicy(user));
  }

  @Post('configs')
  @RequirePermissions('distribution:manage:any')
  @ApiOperation({ summary: 'Créer une configuration de répartition' })
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
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DistributionConfig> {
    const config = await this.distributionService.createConfig(
      {
        name: body.name,
        description: body.description,
        baseType: body.baseType as Prisma.DistributionBaseType,
        effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        beneficiaries: body.beneficiaries.map((b) => ({
          beneficiaryType: b.beneficiaryType as Prisma.BeneficiaryType,
          name: b.name,
          percentage: b.percentage,
          userId: b.userId,
          order: b.order,
        })),
      },
      { id: user.id },
      new AccessPolicy(user),
    );

    return this.urlBuilder.buildResponse(config, {
      message: 'Configuration de répartition créée avec succès',
      redirectTo: 'settings',
      resourceType: 'distribution',
      openInNewTab: false,
    });
  }

  // ---------------------------------------------------------------------------
  // Répartitions par projet
  // ---------------------------------------------------------------------------

  @Post('projects/:projectId/calculate')
  @RequirePermissions('distribution:manage:any')
  @ApiOperation({ summary: 'Calculer une répartition pour un projet' })
  async calculateForProject(
    @Param('projectId') projectId: string,
    @Query('configId') configId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const distribution = await this.distributionService.calculateForProject(
      projectId,
      configId,
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
  async applyDistribution(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
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
