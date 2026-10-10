import { Injectable } from '@nestjs/common';
import { paginated, resolvePagination, type Paginated } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import { ContentStatus } from '../../generated/prisma/enums.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { resolveSlug, slugConflict } from './slug.js';
import type {
  ContentListQueryDto,
  CreateCaseStudyCategoryDto,
  CreateCaseStudyDto,
  CreateFaqDto,
  CreatePackageDto,
  CreatePartnerDto,
  CreateServiceDto,
  CreateTestimonialDto,
  ModerateContentDto,
  PublicCaseStudyQueryDto,
  UpdateCaseStudyCategoryDto,
  UpdateCaseStudyDto,
  UpdateFaqDto,
  UpdatePackageDto,
  UpdatePartnerDto,
  UpdateServiceDto,
  UpdateTestimonialDto,
} from './dto/content.dto.js';

/**
 * CONTENU PUBLIC — lecture pour le site, ecriture pour l'agence.
 *
 * DEUX FAMILLES DE METHODES, ET LA SEPARATION EST LE POINT CENTRAL.
 *
 * `listPublic*` et `getPublic*` sont servies par des routes `@Public()`,
 * c'est-a-dire accessibles a un visiteur ANONYME. Elles selectionnent leurs
 * colonnes une par une et ne renvoient jamais la ligne entiere : une colonne
 * ajoutee demain — une note interne sur un partenaire, un champ de travail sur
 * une etude de cas — ne se retrouve pas publiee par accident. Ecrire
 * `select: undefined` et compter sur le filtrage par `where` marcherait
 * aujourd'hui et fuirait a la premiere migration.
 *
 * Trois conditions de fond, appliquees a chaque lecture publique :
 *
 *   - `deletedAt: null`  : un contenu supprime ne se sert plus ;
 *   - l'indicateur d'etat : `isActive` ou `isPublished` selon le modele, et pour
 *     une etude de cas `status: PUBLISHED` ;
 *   - `publishedAt <= maintenant` : une publication planifiee dans le futur
 *     n'est pas encore publique. Sans cette condition, il suffirait de fixer une
 *     date d'avance pour publier en avance.
 *
 * AUCUN PRIX N'EST LU NI ECRIT ICI. `Package` ne porte aucun montant — voir
 * l'entete de `dto/content.dto.ts`.
 */
@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Site public
  // ---------------------------------------------------------------------------

  /** Services actifs, dans l'ordre choisi par l'agence. */
  async listPublicServices(): Promise<PublicService[]> {
    return this.prisma.service.findMany({
      where: { deletedAt: null, isActive: true },
      select: PUBLIC_SERVICE_FIELDS,
      orderBy: [{ order: 'asc' }, { title: 'asc' }],
    });
  }

  async getPublicService(slug: string): Promise<PublicService> {
    const service = await this.prisma.service.findFirst({
      where: { slug, deletedAt: null, isActive: true },
      select: PUBLIC_SERVICE_FIELDS,
    });

    if (!service) throw AppException.notFound('SERVICE_NOT_FOUND', 'Service introuvable.');
    return service;
  }

  /**
   * Packs actifs.
   *
   * Le `select` est la garantie qu'aucun montant ne sortira jamais d'ici : meme
   * si un champ de tarif etait ajoute au modele un jour, il faudrait l'ajouter
   * AUSSI a cette liste pour qu'il soit publie. L'oubli penche du cote sur.
   */
  async listPublicPackages(): Promise<PublicPackage[]> {
    return this.prisma.package.findMany({
      where: { deletedAt: null, isActive: true },
      select: PUBLIC_PACKAGE_FIELDS,
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
  }

  async getPublicPackage(slug: string): Promise<PublicPackage> {
    const pack = await this.prisma.package.findFirst({
      where: { slug, deletedAt: null, isActive: true },
      select: PUBLIC_PACKAGE_FIELDS,
    });

    if (!pack) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Pack introuvable.');
    return pack;
  }

  async listPublicCategories(): Promise<PublicCategory[]> {
    return this.prisma.caseStudyCategory.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, slug: true, name: true, order: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
  }

  /** Etudes de cas publiees, la plus recente d'abord a ordre egal. */
  async listPublicCaseStudies(query: PublicCaseStudyQueryDto): Promise<Paginated<PublicCaseStudy>> {
    const pagination = resolvePagination(query);
    const where: Prisma.CaseStudyWhereInput = {
      AND: [
        { deletedAt: null },
        { status: ContentStatus.PUBLISHED },
        // Une publication planifiee n'est pas encore publique : sans cette
        // borne, il suffirait de saisir une date d'avance pour publier en
        // avance, et la page apparaitrait avant la relecture.
        { publishedAt: { lte: new Date() } },
        ...(query.categoryId ? [{ categoryId: query.categoryId }] : []),
      ],
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.caseStudy.findMany({
        where,
        select: PUBLIC_CASE_STUDY_FIELDS,
        orderBy: [{ order: 'asc' }, { publishedAt: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.caseStudy.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  async getPublicCaseStudy(slug: string): Promise<PublicCaseStudy> {
    const study = await this.prisma.caseStudy.findFirst({
      where: {
        slug,
        deletedAt: null,
        status: ContentStatus.PUBLISHED,
        publishedAt: { lte: new Date() },
      },
      select: PUBLIC_CASE_STUDY_FIELDS,
    });

    if (!study) throw AppException.notFound('CASE_STUDY_NOT_FOUND', 'Etude de cas introuvable.');
    return study;
  }

  /** Temoignages publies. `isPublished` par defaut a faux : rien ne part sans validation. */
  async listPublicTestimonials(): Promise<PublicTestimonial[]> {
    return this.prisma.testimonial.findMany({
      where: { deletedAt: null, isPublished: true },
      select: PUBLIC_TESTIMONIAL_FIELDS,
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async listPublicPartners(): Promise<PublicPartner[]> {
    return this.prisma.partner.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true, logoKey: true, websiteUrl: true, order: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
  }

  async listPublicFaqs(): Promise<PublicFaq[]> {
    return this.prisma.faq.findMany({
      where: { deletedAt: null, isPublished: true },
      select: { id: true, question: true, answer: true, category: true, order: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  // ---------------------------------------------------------------------------
  // Administration — services
  // ---------------------------------------------------------------------------

  async listServices(query: ContentListQueryDto) {
    const pagination = resolvePagination(query);
    const where: Prisma.ServiceWhereInput = {
      deletedAt: null,
      ...(query.active === undefined ? {} : { isActive: query.active }),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' as const } },
              { slug: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.service.findMany({
        where,
        orderBy: [{ order: 'asc' }, { title: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.service.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  async createService(dto: CreateServiceDto) {
    const slug = resolveSlug(dto.slug, dto.title);
    await this.assertSlugFree('service', slug);

    return this.attempt(() => this.prisma.service.create({ data: { ...dto, slug } }), slug);
  }

  async updateService(id: string, dto: UpdateServiceDto) {
    await this.requireExisting('service', id);
    const slug = this.updateSlug(dto.slug, dto.title);

    if (slug !== undefined) await this.assertSlugFree('service', slug, id);

    return this.attempt(
      () =>
        this.prisma.service.update({ where: { id }, data: { ...dto, ...(slug ? { slug } : {}) } }),
      slug,
    );
  }

  async deleteService(id: string): Promise<void> {
    await this.requireExisting('service', id);
    await this.prisma.service.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ---------------------------------------------------------------------------
  // Administration — packs
  // ---------------------------------------------------------------------------

  async listPackages(query: ContentListQueryDto) {
    const pagination = resolvePagination(query);
    const where: Prisma.PackageWhereInput = {
      deletedAt: null,
      ...(query.active === undefined ? {} : { isActive: query.active }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { slug: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.package.findMany({
        where,
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.package.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  async createPackage(dto: CreatePackageDto) {
    const slug = resolveSlug(dto.slug, dto.name);
    await this.assertSlugFree('package', slug);

    return this.attempt(() => this.prisma.package.create({ data: { ...dto, slug } }), slug);
  }

  async updatePackage(id: string, dto: UpdatePackageDto) {
    await this.requireExisting('package', id);
    const slug = this.updateSlug(dto.slug, dto.name);

    if (slug !== undefined) await this.assertSlugFree('package', slug, id);

    return this.attempt(
      () =>
        this.prisma.package.update({ where: { id }, data: { ...dto, ...(slug ? { slug } : {}) } }),
      slug,
    );
  }

  async deletePackage(id: string): Promise<void> {
    await this.requireExisting('package', id);
    await this.prisma.package.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ---------------------------------------------------------------------------
  // Administration — categories d'etudes de cas
  // ---------------------------------------------------------------------------

  async listCategories(query: ContentListQueryDto) {
    const pagination = resolvePagination(query);
    const where: Prisma.CaseStudyCategoryWhereInput = {
      deletedAt: null,
      ...(query.active === undefined ? {} : { isActive: query.active }),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.caseStudyCategory.findMany({
        where,
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.caseStudyCategory.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  async createCategory(dto: CreateCaseStudyCategoryDto) {
    const slug = resolveSlug(dto.slug, dto.name);
    await this.assertSlugFree('category', slug);

    return this.attempt(
      () => this.prisma.caseStudyCategory.create({ data: { ...dto, slug } }),
      slug,
    );
  }

  async updateCategory(id: string, dto: UpdateCaseStudyCategoryDto) {
    await this.requireExisting('category', id);
    const slug = this.updateSlug(dto.slug, dto.name);

    if (slug !== undefined) await this.assertSlugFree('category', slug, id);

    return this.attempt(
      () =>
        this.prisma.caseStudyCategory.update({
          where: { id },
          data: { ...dto, ...(slug ? { slug } : {}) },
        }),
      slug,
    );
  }

  async deleteCategory(id: string): Promise<void> {
    await this.requireExisting('category', id);
    // Les etudes de cas rattachees ne sont pas supprimees : `CaseStudy.categoryId`
    // est `SetNull`, donc elles deviennent simplement sans categorie. Une
    // suppression en cascade ferait disparaitre des pages publiques parce qu'un
    // libelle de classement a ete retire — ce n'est pas la meme decision.
    await this.prisma.caseStudyCategory.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // Administration — etudes de cas
  // ---------------------------------------------------------------------------

  async listCaseStudies(query: ContentListQueryDto) {
    const pagination = resolvePagination(query);
    const where: Prisma.CaseStudyWhereInput = {
      deletedAt: null,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' as const } },
              { slug: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.caseStudy.findMany({
        where,
        orderBy: [{ order: 'asc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.caseStudy.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  async createCaseStudy(dto: CreateCaseStudyDto) {
    const slug = resolveSlug(dto.slug, dto.title);
    await this.assertSlugFree('caseStudy', slug);
    await this.assertCategoryExists(dto.categoryId);

    return this.attempt(
      () =>
        this.prisma.caseStudy.create({
          data: {
            ...dto,
            slug,
            // La date de publication est posee par le SERVEUR, au moment ou le
            // statut devient PUBLISHED. La laisser au client permettrait
            // d'annoncer une publication anterieure — et un `publishedAt` dans
            // le futur suffirait a faire apparaitre la page en avance, ce que la
            // lecture publique empeche deja, mais autant ne pas l'ecrire.
            ...(dto.status === ContentStatus.PUBLISHED ? { publishedAt: new Date() } : {}),
          },
        }),
      slug,
    );
  }

  async updateCaseStudy(id: string, dto: UpdateCaseStudyDto) {
    const existing = await this.requireExisting('caseStudy', id);
    const slug = this.updateSlug(dto.slug, dto.title);

    if (slug !== undefined) await this.assertSlugFree('caseStudy', slug, id);
    await this.assertCategoryExists(dto.categoryId);

    // `publishedAt` n'est pose qu'a la PREMIERE publication. Le reecrire a
    // chaque enregistrement ferait remonter l'article en tete du site chaque
    // fois qu'on corrige une faute, et la date affichee serait celle de la
    // derniere retouche, pas celle de la mise en ligne.
    const firstPublication =
      dto.status === ContentStatus.PUBLISHED && existing.publishedAt === null
        ? { publishedAt: new Date() }
        : {};

    return this.attempt(
      () =>
        this.prisma.caseStudy.update({
          where: { id },
          data: { ...dto, ...(slug ? { slug } : {}), ...firstPublication },
        }),
      slug,
    );
  }

  async deleteCaseStudy(id: string): Promise<void> {
    await this.requireExisting('caseStudy', id);
    await this.prisma.caseStudy.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ---------------------------------------------------------------------------
  // Administration — temoignages
  // ---------------------------------------------------------------------------

  async listTestimonials(query: ContentListQueryDto) {
    const pagination = resolvePagination(query);
    const where: Prisma.TestimonialWhereInput = {
      deletedAt: null,
      ...(query.active === undefined ? {} : { isPublished: query.active }),
      ...(query.search
        ? {
            OR: [
              { authorName: { contains: query.search, mode: 'insensitive' as const } },
              { quote: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.testimonial.findMany({
        where,
        orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.testimonial.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  /**
   * Cree un temoignage, toujours NON publie.
   *
   * `isPublished` n'est pas dans `CreateTestimonialDto` : la creation d'un
   * temoignage et sa mise en ligne sont deux actes distincts, et le second
   * demande `testimonial:moderate:any`. Le modele prevoit deja le defaut a faux
   * — « rien ne part en ligne sans une validation explicite du client cite ».
   */
  async createTestimonial(dto: CreateTestimonialDto) {
    await this.assertCaseStudyExists(dto.caseStudyId);

    return this.prisma.testimonial.create({ data: { ...dto } });
  }

  async updateTestimonial(id: string, dto: UpdateTestimonialDto) {
    await this.requirePlainRow('testimonial', id);
    await this.assertCaseStudyExists(dto.caseStudyId);

    return this.prisma.testimonial.update({ where: { id }, data: { ...dto } });
  }

  /**
   * Publie ou depublie un temoignage.
   *
   * Route separee, permission separee. Un redacteur qui peut CREER un
   * temoignage ne doit pas pouvoir le PUBLIER : les mots sont attribues a une
   * personne nommee, et c'est cette personne qui les valide. Confondre les deux
   * droits rendrait la permission de moderation inutile.
   */
  async moderateTestimonial(id: string, dto: ModerateContentDto) {
    await this.requirePlainRow('testimonial', id);

    return this.prisma.testimonial.update({
      where: { id },
      data: { isPublished: dto.isPublished },
    });
  }

  async deleteTestimonial(id: string): Promise<void> {
    await this.requirePlainRow('testimonial', id);
    await this.prisma.testimonial.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ---------------------------------------------------------------------------
  // Administration — partenaires
  // ---------------------------------------------------------------------------

  async listPartners(query: ContentListQueryDto) {
    const pagination = resolvePagination(query);
    const where: Prisma.PartnerWhereInput = {
      deletedAt: null,
      ...(query.active === undefined ? {} : { isActive: query.active }),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.partner.findMany({
        where,
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.partner.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  async createPartner(dto: CreatePartnerDto) {
    return this.prisma.partner.create({ data: { ...dto } });
  }

  async updatePartner(id: string, dto: UpdatePartnerDto) {
    await this.requirePlainRow('partner', id);

    return this.prisma.partner.update({ where: { id }, data: { ...dto } });
  }

  async deletePartner(id: string): Promise<void> {
    await this.requirePlainRow('partner', id);
    await this.prisma.partner.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ---------------------------------------------------------------------------
  // Administration — FAQ
  // ---------------------------------------------------------------------------

  async listFaqs(query: ContentListQueryDto) {
    const pagination = resolvePagination(query);
    const where: Prisma.FaqWhereInput = {
      deletedAt: null,
      ...(query.active === undefined ? {} : { isPublished: query.active }),
      ...(query.search
        ? {
            OR: [
              { question: { contains: query.search, mode: 'insensitive' as const } },
              { answer: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.faq.findMany({
        where,
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.faq.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  async createFaq(dto: CreateFaqDto) {
    return this.prisma.faq.create({ data: { ...dto } });
  }

  async updateFaq(id: string, dto: UpdateFaqDto) {
    await this.requirePlainRow('faq', id);

    return this.prisma.faq.update({ where: { id }, data: { ...dto } });
  }

  async deleteFaq(id: string): Promise<void> {
    await this.requirePlainRow('faq', id);
    await this.prisma.faq.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ---------------------------------------------------------------------------
  // Verifications partagees
  // ---------------------------------------------------------------------------

  /**
   * Slug demande pour une MISE A JOUR, ou `undefined` si l'appelant n'y touche pas.
   *
   * Le repli est une chaine vide, et non le libelle actuel ni l'identifiant : si
   * le slug fourni ne donne rien d'utilisable, `resolveSlug` refuse (422) au lieu
   * de fabriquer une adresse a partir d'un texte que personne n'a choisi. Le
   * repli sur l'`id` — un cuid interne — produirait une URL publique valide et
   * absurde, que le referencement enregistrerait avant qu'on s'en apercoive.
   */
  private updateSlug(
    explicit: string | undefined,
    currentLabel: string | undefined,
  ): string | undefined {
    if (explicit === undefined) return undefined;

    return resolveSlug(explicit, currentLabel ?? '');
  }

  /**
   * Le slug est-il libre ?
   *
   * Verifie AVANT l'insertion pour rendre un 409 lisible : le message nomme le
   * slug en conflit, ce qu'une erreur Prisma brute ne fait pas. La verification
   * n'est pas une garantie — deux creations simultanees passeraient toutes les
   * deux — d'ou le rattrapage de `P2002` dans `attempt`.
   */
  private async assertSlugFree(model: SlugModel, slug: string, exceptId?: string): Promise<void> {
    const clash = await this.findBySlug(model, slug, exceptId);
    if (clash) throw slugConflict(slug);
  }

  private async findBySlug(
    model: SlugModel,
    slug: string,
    exceptId?: string,
  ): Promise<{ id: string } | null> {
    const where = { slug, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) };

    // Les delegues Prisma n'ont pas de type commun utilisable : chacun a ses
    // propres filtres. Ce `switch` explicite est ce qui permet de rester type
    // sans `any` — ajouter une entite a `SlugModel` sans ajouter sa branche ne
    // compile pas.
    switch (model) {
      case 'service':
        return this.prisma.service.findFirst({ where, select: { id: true } });
      case 'package':
        return this.prisma.package.findFirst({ where, select: { id: true } });
      case 'category':
        return this.prisma.caseStudyCategory.findFirst({ where, select: { id: true } });
      case 'caseStudy':
        return this.prisma.caseStudy.findFirst({ where, select: { id: true } });
    }
  }

  /**
   * Verifie qu'une ligne existe, pour les entites SANS slug.
   *
   * Temoignage, partenaire et question frequente n'ont pas d'adresse publique
   * propre : il n'y a donc rien a rendre d'autre que la confirmation de leur
   * existence. Le controle a lieu AVANT l'ecriture pour rendre un 404 qui nomme
   * la ressource ; sans lui, un `update` sur un identifiant inconnu remonterait
   * un P2025 que le filtre traduit deja en 404, mais sans dire quoi.
   */
  private async requirePlainRow(model: PlainModel, id: string): Promise<void> {
    const where = { id, deletedAt: null };
    const select = { id: true } as const;

    const found =
      model === 'testimonial'
        ? await this.prisma.testimonial.findFirst({ where, select })
        : model === 'partner'
          ? await this.prisma.partner.findFirst({ where, select })
          : await this.prisma.faq.findFirst({ where, select });

    if (!found) throw AppException.notFound('CONTENT_NOT_FOUND', 'Contenu introuvable.');
  }

  private async requireExisting(model: SlugModel, id: string): Promise<WithSlug> {
    const existing = await this.findById(model, id);
    if (!existing) throw AppException.notFound('CONTENT_NOT_FOUND', 'Contenu introuvable.');
    return existing;
  }

  private async findById(model: SlugModel, id: string): Promise<WithSlug | null> {
    const where = { id, deletedAt: null };
    const select = { id: true, slug: true, publishedAt: true } as const;

    switch (model) {
      case 'service':
        return this.prisma.service.findFirst({ where, select });
      case 'package':
        return this.prisma.package.findFirst({ where, select });
      case 'category':
        // Une categorie n'a pas de date de publication : on rend `null` plutot
        // que d'inventer un champ, et `publishedAt` n'est lu que pour les
        // etudes de cas.
        return this.prisma.caseStudyCategory.findFirst({
          where,
          select: { id: true, slug: true },
        });
      case 'caseStudy':
        return this.prisma.caseStudy.findFirst({ where, select });
    }
  }

  /**
   * Execute une ecriture et retraduit un conflit d'unicite.
   *
   * Le controle fait avant l'insertion ne suffit pas : entre la lecture et
   * l'ecriture, une autre requete a pu prendre le slug. C'est PostgreSQL qui
   * tranche, et sa reponse est une erreur que l'appelant ne comprendrait pas. On
   * la retraduit donc dans la meme forme que le refus preventif, pour qu'un slug
   * deja pris donne TOUJOURS un 409 nommant le slug, quelle que soit la porte
   * par laquelle le conflit est arrive.
   *
   * L'ecriture est passee en FONCTION plutot qu'en objet de donnees : chaque
   * modele a son propre type d'entree, et passer par un objet generique
   * obligerait a le transtyper a l'aveugle. Ici le compilateur verifie l'appel a
   * `create`/`update` comme n'importe quel autre.
   *
   * `slug` est facultatif, et son absence veut dire quelque chose : une mise a
   * jour qui ne touche pas au slug ne PEUT pas provoquer de conflit de slug. Une
   * violation d'unicite y vient donc d'ailleurs, et la retraduire en 409 « slug
   * deja pris » enverrait corriger le mauvais champ.
   */
  private async attempt<T>(run: () => Promise<T>, slug?: string): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (slug !== undefined) this.rethrowSlugConflict(error, slug);
      throw error;
    }
  }

  /**
   * Traduit une violation d'unicite en conflit de slug.
   *
   * Une autre contrainte d'unicite — hypothetique — est relayee telle quelle :
   * annoncer un conflit de slug la ou le probleme est ailleurs enverrait
   * l'utilisateur corriger un champ qui n'est pas en cause.
   */
  private rethrowSlugConflict(error: unknown, slug: string): void {
    const code = (error as { code?: string } | null)?.code;

    if (code === 'P2002') {
      throw slugConflict(slug);
    }
  }

  private async assertCategoryExists(categoryId: string | undefined): Promise<void> {
    if (categoryId === undefined) return;

    const category = await this.prisma.caseStudyCategory.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { id: true },
    });

    if (!category) throw AppException.notFound('CATEGORY_NOT_FOUND', 'Categorie introuvable.');
  }

  private async assertCaseStudyExists(caseStudyId: string | undefined): Promise<void> {
    if (caseStudyId === undefined) return;

    const study = await this.prisma.caseStudy.findFirst({
      where: { id: caseStudyId, deletedAt: null },
      select: { id: true },
    });

    if (!study) throw AppException.notFound('CASE_STUDY_NOT_FOUND', 'Etude de cas introuvable.');
  }
}

/** Les entites qui portent un slug unique dans le contenu public. */
type SlugModel = 'service' | 'package' | 'category' | 'caseStudy';

/**
 * Les entites de contenu SANS slug.
 *
 * La distinction n'est pas cosmetique : elle vient du schema. Un temoignage, un
 * partenaire et une question frequente n'ont pas d'adresse publique propre, donc
 * pas de verification d'unicite a faire — et `assertValidSlug` n'a rien a y
 * verifier.
 */
type PlainModel = 'testimonial' | 'partner' | 'faq';

/** Ce que la verification d'existence doit rendre, au minimum. */
interface WithSlug {
  readonly id: string;
  readonly slug: string;
  readonly publishedAt?: Date | null;
}

// -----------------------------------------------------------------------------
// Colonnes publiques
// -----------------------------------------------------------------------------

/**
 * Chaque `select` est la definition du contrat public, ecrite une fois.
 *
 * Aucun ne contient `deletedAt`, `createdAt`, `updatedAt` ni `isActive` : ces
 * colonnes decrivent l'etat INTERNE du contenu, et un visiteur n'a rien a en
 * faire. `id` reste expose parce que le frontend s'en sert comme cle de liste et
 * qu'un cuid est un identifiant opaque — contrairement a une reference
 * sequentielle, il ne revele ni volume ni ordre de creation.
 */
const PUBLIC_SERVICE_FIELDS = {
  id: true,
  slug: true,
  title: true,
  shortDescription: true,
  description: true,
  icon: true,
  coverImageKey: true,
  features: true,
  order: true,
  isFeatured: true,
  seoTitle: true,
  seoDescription: true,
} as const;

/**
 * Colonnes publiques d'un pack — et l'absence de tout montant est ici aussi.
 *
 * Ce `select` ne peut pas exposer un prix : il n'y a pas de champ de prix a
 * selectionner, ni dans le modele, ni dans cette liste.
 */
const PUBLIC_PACKAGE_FIELDS = {
  id: true,
  slug: true,
  name: true,
  tagline: true,
  description: true,
  features: true,
  excludes: true,
  badge: true,
  order: true,
  isFeatured: true,
  seoTitle: true,
  seoDescription: true,
} as const;

const PUBLIC_CASE_STUDY_FIELDS = {
  id: true,
  slug: true,
  title: true,
  clientName: true,
  excerpt: true,
  content: true,
  coverImageKey: true,
  galleryKeys: true,
  techStack: true,
  projectUrl: true,
  publishedAt: true,
  order: true,
  isFeatured: true,
  seoTitle: true,
  seoDescription: true,
  category: { select: { slug: true, name: true } },
} as const;

const PUBLIC_TESTIMONIAL_FIELDS = {
  id: true,
  authorName: true,
  authorRole: true,
  authorCompany: true,
  avatarKey: true,
  quote: true,
  rating: true,
  order: true,
  caseStudy: { select: { slug: true, title: true } },
} as const;

export type PublicService = Prisma.ServiceGetPayload<{ select: typeof PUBLIC_SERVICE_FIELDS }>;
export type PublicPackage = Prisma.PackageGetPayload<{ select: typeof PUBLIC_PACKAGE_FIELDS }>;
export type PublicCategory = { id: string; slug: string; name: string; order: number };
export type PublicCaseStudy = Prisma.CaseStudyGetPayload<{
  select: typeof PUBLIC_CASE_STUDY_FIELDS;
}>;
export type PublicTestimonial = Prisma.TestimonialGetPayload<{
  select: typeof PUBLIC_TESTIMONIAL_FIELDS;
}>;
export type PublicPartner = {
  id: string;
  name: string;
  logoKey: string | null;
  websiteUrl: string | null;
  order: number;
};
export type PublicFaq = {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  order: number;
};
