import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { Paginated } from '../../common/dto/pagination.dto.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { clientIp, clientUserAgent } from '../../common/http/client-ip.js';
import { ContentService, type PublicCaseStudy } from './content.service.js';
import { ContactRequestService, type RequestTrace } from './contact-request.service.js';
import { PublicCaseStudyQueryDto } from './dto/content.dto.js';
import { CreateContactRequestDto } from './dto/contact-request.dto.js';

/**
 * ROUTES DU SITE PUBLIC.
 *
 * ELLES SONT TOUTES `@Public()` ET C'EST UNE NECESSITE, PAS UN CHOIX DE
 * COMMODITE. Le role CLIENT ne detient aucune permission de contenu — ni
 * `service:read:any`, ni `package:read:any`, ni aucune autre. Le catalogue est
 * ainsi fait : le contenu public n'est pas une ressource de l'espace client,
 * c'est ce que sert le site vitrine. Fermer ces routes derriere une permission
 * obligerait donc a en accorder une a un role qui n'en a pas besoin, et a
 * ouvrir d'un cran plus large que necessaire ce qui est justement la vitrine.
 *
 * CE QUI PROTEGE CES ROUTES N'EST PAS UN DROIT, C'EST LE `select`. Chaque
 * methode de `ContentService` nomme ses colonnes : un contenu supprime, un
 * brouillon, un element inactif ou une publication planifiee ne sortent pas, et
 * aucune colonne interne ne peut se retrouver publiee par inadvertance. Voir
 * l'entete de `content.service.ts`.
 *
 * AUCUN COMPTEUR N'EST EXPOSE ICI. Les listes rendent un `slug`, qui est
 * l'adresse publique choisie par l'agence, et jamais une reference
 * sequentielle — un numero qui s'incremente dit combien d'elements existent et
 * dans quel ordre ils ont ete crees.
 */
@ApiTags('Contenu public')
@Controller('public')
export class ContentPublicController {
  constructor(
    private readonly content: ContentService,
    private readonly contactRequests: ContactRequestService,
  ) {}

  @Public()
  @Get('services')
  @ApiOperation({ summary: 'Services actifs' })
  async listServices() {
    return this.content.listPublicServices();
  }

  @Public()
  @Get('services/:slug')
  @ApiOperation({ summary: "Detail d'un service par son adresse publique" })
  async getService(@Param('slug') slug: string) {
    return this.content.getPublicService(slug);
  }

  @Public()
  @Get('packages')
  @ApiOperation({ summary: 'Packs actifs' })
  async listPackages() {
    return this.content.listPublicPackages();
  }

  @Public()
  @Get('packages/:slug')
  @ApiOperation({ summary: "Detail d'un pack par son adresse publique" })
  async getPackage(@Param('slug') slug: string) {
    return this.content.getPublicPackage(slug);
  }

  @Public()
  @Get('case-study-categories')
  @ApiOperation({ summary: "Categories d'etudes de cas" })
  async listCategories() {
    return this.content.listPublicCategories();
  }

  @Public()
  @Get('case-studies')
  @ApiOperation({ summary: 'Etudes de cas publiees' })
  async listCaseStudies(
    @Query() query: PublicCaseStudyQueryDto,
  ): Promise<Paginated<PublicCaseStudy>> {
    return this.content.listPublicCaseStudies(query);
  }

  @Public()
  @Get('case-studies/:slug')
  @ApiOperation({ summary: "Detail d'une etude de cas publiee" })
  async getCaseStudy(@Param('slug') slug: string) {
    return this.content.getPublicCaseStudy(slug);
  }

  @Public()
  @Get('testimonials')
  @ApiOperation({ summary: 'Temoignages publies' })
  async listTestimonials() {
    return this.content.listPublicTestimonials();
  }

  @Public()
  @Get('partners')
  @ApiOperation({ summary: 'Partenaires actifs' })
  async listPartners() {
    return this.content.listPublicPartners();
  }

  @Public()
  @Get('faqs')
  @ApiOperation({ summary: 'Questions frequentes publiees' })
  async listFaqs() {
    return this.content.listPublicFaqs();
  }

  /**
   * Le formulaire de contact du site.
   *
   * C'EST LA SEULE ROUTE PUBLIQUE QUI ECRIT EN BASE, et elle ne demande aucun
   * compte. Deux choses la protegent, et aucune n'est un droit :
   *
   *  - le quota, plus serre que le quota general : un formulaire rempli par un
   *    humain produit un envoi, pas cinquante par minute. Il est pose ici, sur la
   *    route, et non sur l'ensemble du controleur, pour que la lecture du
   *    catalogue public — qui, elle, est appelee a chaque visite — ne le
   *    consomme pas ;
   *  - la validation du corps, ou chaque champ est borne et ou aucun champ
   *    d'etat n'existe.
   *
   * LA REPONSE NE CONTIENT PAS LA REFERENCE. Elle est sequentielle : deux envois
   * suffiraient a en deduire le volume annuel de demandes de l'agence. Le
   * visiteur recoit une confirmation, l'agence recoit le numero par notification
   * et le retrouve dans sa file.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('contact-requests')
  @ApiOperation({
    summary: 'Envoyer une demande de contact',
    description:
      "Enregistre la demande et previent l'agence. La reference interne n'est pas renvoyee.",
  })
  async createContactRequest(
    @Body() dto: CreateContactRequestDto,
    @Req() request: Request,
  ): Promise<{ received: true }> {
    await this.contactRequests.create(dto, traceFrom(request));
    return { received: true };
  }
}

/**
 * Les traces techniques de la requete, bornees avant enregistrement.
 *
 * L'en-tete `User-Agent` et l'adresse IP sont ecrits par le client : Node borne
 * deja la taille des en-tetes, mais la colonne, elle, n'a pas de limite. Une
 * troncature explicite garantit que la taille d'une ligne de la file reste
 * previsible, quel que soit ce qu'on nous envoie.
 *
 * La lecture de l'adresse et de l'agent vit dans `common/http/client-ip.ts`, avec
 * ce que la valeur vaut et le reglage `TRUST_PROXY`.
 *
 * CE FICHIER ETAIT LE SEUL DES QUATRE A NE PAS SUIVRE LA CONVENTION : il lisait
 * `request.ip` directement, et son propre commentaire en annoncait la
 * consequence — derriere un reverse proxy, la colonne contenait l'adresse du
 * proxy, donc la meme pour tout le monde. C'est corrige, et non plus signale
 * comme restant a verifier.
 */
function traceFrom(request: Request): RequestTrace {
  return {
    ipAddress: clientIp(request),
    userAgent: clientUserAgent(request),
  };
}
