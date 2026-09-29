import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ContentService } from './content.service.js';
import {
  ContentListQueryDto,
  CreateCaseStudyCategoryDto,
  CreateCaseStudyDto,
  CreateFaqDto,
  CreatePackageDto,
  CreatePartnerDto,
  CreateServiceDto,
  CreateTestimonialDto,
  ModerateContentDto,
  UpdateCaseStudyCategoryDto,
  UpdateCaseStudyDto,
  UpdateFaqDto,
  UpdatePackageDto,
  UpdatePartnerDto,
  UpdateServiceDto,
  UpdateTestimonialDto,
} from './dto/content.dto.js';

/**
 * ADMINISTRATION DU CONTENU PUBLIC.
 *
 * Un seul controleur pour les sept ressources, et c'est un choix : elles
 * partagent exactement les memes regles — ecriture par l'agence, slug unique,
 * suppression logique, liste paginee — et les eclater en sept fichiers
 * multiplierait sept fois l'entete ci-dessous sans rien separer. La separation
 * qui compte est ailleurs, entre ce controleur et le controleur public.
 *
 * POURQUOI `@RequirePermissions` ET NON `@RequireAnyPermission` ICI. Chaque
 * route ne depend que d'un seul droit : celui de lire ou celui d'ecrire le type
 * de contenu concerne. Il n'y a pas d'alternative a arbitrer — donc rien a
 * prendre en compte dans l'autre sens. Le jour ou un role lira sans ecrire, il
 * detiendra `*:read:any` et pas `*:write:any`, et le catalogue fera le tri.
 *
 * AUCUNE ROUTE DE LECTURE D'UN SEUL ELEMENT. La liste paginee rend la ligne
 * complete : l'ecran d'edition part de la ligne qu'il a deja, et une route de
 * detail n'aurait pas d'appelant. En ajouter une « au cas ou » multiplierait
 * sept lectures dont aucune n'est utilisee — et une route sans appelant ne se
 * fait pas relire.
 *
 * LES SUPPRESSIONS SONT LOGIQUES. `deletedAt` est pose, la ligne reste, et le
 * contenu disparait du site public parce que toutes les lectures publiques
 * filtrent dessus. Une suppression reelle emporterait les rattachements
 * (`ContactRequest.serviceId` est `SetNull`, mais une etude de cas rattachee a
 * une categorie supprimee ne se replace pas toute seule) et ferait disparaitre
 * l'historique de ce qui a ete publie.
 *
 * AUCUN PRIX N'EST ACCEPTE NI RENDU, a aucun endroit de ce fichier. Voir
 * l'entete de `dto/content.dto.ts`.
 */
@ApiTags('Contenu')
@Controller('content')
export class ContentAdminController {
  constructor(private readonly content: ContentService) {}

  // ---------------------------------------------------------------------------
  // Services
  // ---------------------------------------------------------------------------

  @Get('services')
  @RequirePermissions('service:read:any')
  @ApiOperation({ summary: 'Lister les services' })
  async listServices(@Query() query: ContentListQueryDto) {
    return this.content.listServices(query);
  }

  @Post('services')
  @RequirePermissions('service:write:any')
  @ApiOperation({ summary: 'Creer un service' })
  async createService(@Body() dto: CreateServiceDto) {
    return this.content.createService(dto);
  }

  @Patch('services/:id')
  @RequirePermissions('service:write:any')
  @ApiOperation({ summary: 'Modifier un service' })
  async updateService(@Param('id') id: string, @Body() dto: UpdateServiceDto) {
    return this.content.updateService(id, dto);
  }

  @Delete('services/:id')
  @RequirePermissions('service:write:any')
  @ApiOperation({
    summary: 'Retirer un service',
    description: 'Suppression logique : la ligne reste, le service quitte le site public.',
  })
  async deleteService(@Param('id') id: string): Promise<void> {
    await this.content.deleteService(id);
  }

  // ---------------------------------------------------------------------------
  // Packs — sans prix
  // ---------------------------------------------------------------------------

  @Get('packages')
  @RequirePermissions('package:read:any')
  @ApiOperation({ summary: 'Lister les packs' })
  async listPackages(@Query() query: ContentListQueryDto) {
    return this.content.listPackages(query);
  }

  @Post('packages')
  @RequirePermissions('package:write:any')
  @ApiOperation({ summary: 'Creer un pack' })
  async createPackage(@Body() dto: CreatePackageDto) {
    return this.content.createPackage(dto);
  }

  @Patch('packages/:id')
  @RequirePermissions('package:write:any')
  @ApiOperation({ summary: 'Modifier un pack' })
  async updatePackage(@Param('id') id: string, @Body() dto: UpdatePackageDto) {
    return this.content.updatePackage(id, dto);
  }

  @Delete('packages/:id')
  @RequirePermissions('package:write:any')
  @ApiOperation({ summary: 'Retirer un pack' })
  async deletePackage(@Param('id') id: string): Promise<void> {
    await this.content.deletePackage(id);
  }

  // ---------------------------------------------------------------------------
  // Categories d'etudes de cas
  // ---------------------------------------------------------------------------

  @Get('case-study-categories')
  @RequirePermissions('casestudy:read:any')
  @ApiOperation({ summary: "Lister les categories d'etudes de cas" })
  async listCategories(@Query() query: ContentListQueryDto) {
    return this.content.listCategories(query);
  }

  @Post('case-study-categories')
  @RequirePermissions('casestudy:write:any')
  @ApiOperation({ summary: "Creer une categorie d'etudes de cas" })
  async createCategory(@Body() dto: CreateCaseStudyCategoryDto) {
    return this.content.createCategory(dto);
  }

  @Patch('case-study-categories/:id')
  @RequirePermissions('casestudy:write:any')
  @ApiOperation({ summary: "Modifier une categorie d'etudes de cas" })
  async updateCategory(@Param('id') id: string, @Body() dto: UpdateCaseStudyCategoryDto) {
    return this.content.updateCategory(id, dto);
  }

  @Delete('case-study-categories/:id')
  @RequirePermissions('casestudy:write:any')
  @ApiOperation({
    summary: "Retirer une categorie",
    description: 'Les etudes de cas rattachees restent en ligne, sans categorie.',
  })
  async deleteCategory(@Param('id') id: string): Promise<void> {
    await this.content.deleteCategory(id);
  }

  // ---------------------------------------------------------------------------
  // Etudes de cas
  // ---------------------------------------------------------------------------

  @Get('case-studies')
  @RequirePermissions('casestudy:read:any')
  @ApiOperation({ summary: 'Lister les etudes de cas' })
  async listCaseStudies(@Query() query: ContentListQueryDto) {
    return this.content.listCaseStudies(query);
  }

  @Post('case-studies')
  @RequirePermissions('casestudy:write:any')
  @ApiOperation({ summary: 'Creer une etude de cas' })
  async createCaseStudy(@Body() dto: CreateCaseStudyDto) {
    return this.content.createCaseStudy(dto);
  }

  @Patch('case-studies/:id')
  @RequirePermissions('casestudy:write:any')
  @ApiOperation({
    summary: 'Modifier une etude de cas',
    description:
      "Le passage a PUBLISHED pose la date de publication si elle n'existe pas encore ; " +
      "une republication ne la reecrit pas.",
  })
  async updateCaseStudy(@Param('id') id: string, @Body() dto: UpdateCaseStudyDto) {
    return this.content.updateCaseStudy(id, dto);
  }

  @Delete('case-studies/:id')
  @RequirePermissions('casestudy:write:any')
  @ApiOperation({ summary: 'Retirer une etude de cas' })
  async deleteCaseStudy(@Param('id') id: string): Promise<void> {
    await this.content.deleteCaseStudy(id);
  }

  // ---------------------------------------------------------------------------
  // Temoignages
  // ---------------------------------------------------------------------------

  @Get('testimonials')
  @RequirePermissions('testimonial:read:any')
  @ApiOperation({ summary: 'Lister les temoignages' })
  async listTestimonials(@Query() query: ContentListQueryDto) {
    return this.content.listTestimonials(query);
  }

  @Post('testimonials')
  @RequirePermissions('testimonial:write:any')
  @ApiOperation({
    summary: 'Creer un temoignage',
    description: "Cree toujours non publie : la mise en ligne est une autre route, un autre droit.",
  })
  async createTestimonial(@Body() dto: CreateTestimonialDto) {
    return this.content.createTestimonial(dto);
  }

  @Patch('testimonials/:id')
  @RequirePermissions('testimonial:write:any')
  @ApiOperation({ summary: 'Modifier un temoignage (sans le publier)' })
  async updateTestimonial(@Param('id') id: string, @Body() dto: UpdateTestimonialDto) {
    return this.content.updateTestimonial(id, dto);
  }

  /**
   * Publier ou depublier.
   *
   * Route et permission SEPAREES de la modification. Un temoignage porte les mots
   * d'une personne nommee : les rediger et les publier sont deux actes, et le
   * second engage celui qui est cite. Les confondre rendrait
   * `testimonial:moderate:any` decoratif.
   */
  @Patch('testimonials/:id/publication')
  @RequirePermissions('testimonial:moderate:any')
  @ApiOperation({ summary: 'Publier ou depublier un temoignage' })
  async moderateTestimonial(@Param('id') id: string, @Body() dto: ModerateContentDto) {
    return this.content.moderateTestimonial(id, dto);
  }

  @Delete('testimonials/:id')
  @RequirePermissions('testimonial:write:any')
  @ApiOperation({ summary: 'Retirer un temoignage' })
  async deleteTestimonial(@Param('id') id: string): Promise<void> {
    await this.content.deleteTestimonial(id);
  }

  // ---------------------------------------------------------------------------
  // Partenaires
  // ---------------------------------------------------------------------------

  @Get('partners')
  @RequirePermissions('partner:read:any')
  @ApiOperation({ summary: 'Lister les partenaires' })
  async listPartners(@Query() query: ContentListQueryDto) {
    return this.content.listPartners(query);
  }

  @Post('partners')
  @RequirePermissions('partner:write:any')
  @ApiOperation({ summary: 'Creer un partenaire' })
  async createPartner(@Body() dto: CreatePartnerDto) {
    return this.content.createPartner(dto);
  }

  @Patch('partners/:id')
  @RequirePermissions('partner:write:any')
  @ApiOperation({ summary: 'Modifier un partenaire' })
  async updatePartner(@Param('id') id: string, @Body() dto: UpdatePartnerDto) {
    return this.content.updatePartner(id, dto);
  }

  @Delete('partners/:id')
  @RequirePermissions('partner:write:any')
  @ApiOperation({ summary: 'Retirer un partenaire' })
  async deletePartner(@Param('id') id: string): Promise<void> {
    await this.content.deletePartner(id);
  }

  // ---------------------------------------------------------------------------
  // FAQ
  // ---------------------------------------------------------------------------

  @Get('faqs')
  @RequirePermissions('faq:read:any')
  @ApiOperation({ summary: 'Lister les questions frequentes' })
  async listFaqs(@Query() query: ContentListQueryDto) {
    return this.content.listFaqs(query);
  }

  @Post('faqs')
  @RequirePermissions('faq:write:any')
  @ApiOperation({ summary: 'Creer une question frequente' })
  async createFaq(@Body() dto: CreateFaqDto) {
    return this.content.createFaq(dto);
  }

  @Patch('faqs/:id')
  @RequirePermissions('faq:write:any')
  @ApiOperation({ summary: 'Modifier une question frequente' })
  async updateFaq(@Param('id') id: string, @Body() dto: UpdateFaqDto) {
    return this.content.updateFaq(id, dto);
  }

  @Delete('faqs/:id')
  @RequirePermissions('faq:write:any')
  @ApiOperation({ summary: 'Retirer une question frequente' })
  async deleteFaq(@Param('id') id: string): Promise<void> {
    await this.content.deleteFaq(id);
  }
}
