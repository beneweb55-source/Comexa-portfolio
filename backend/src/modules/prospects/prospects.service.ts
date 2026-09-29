import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  AccessPolicy,
  SCOPE_OWN,
  type AuthenticatedUser,
  type ScopeName,
} from '../../common/auth/principal.js';
import {
  type PaginationQueryDto,
  paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Paginated } from '../../common/interceptors/transform.interceptor.js';
import type { Client, ContactRequest, Prisma, Prospect } from '../../generated/prisma/client.js';
import {
  ActivityType,
  ContactRequestStatus,
  LeadSource,
  LeadStatus,
  NotificationType,
} from '../../generated/prisma/enums.js';
import { ActivityService } from '../activity/activity.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { CounterService } from '../counters/counter.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  ChangeProspectStatusDto,
  CreateProspectDto,
  ListProspectsQueryDto,
  UpdateProspectDto,
} from './dto/prospect.dto.js';
import { assertConvertible, assertTransitionAllowed } from './lead-pipeline.js';
import { assertInternalSpace, composeAnd, prospectPerimeter } from './prospect-scope.js';

/**
 * PIPELINE COMMERCIAL — la fiche prospect et son journal d'etapes.
 *
 * QUATRE REGLES STRUCTURENT CE FICHIER.
 *
 *  1. LE PERIMETRE EST DANS LE `where` (voir `prospect-scope.ts`). Chaque
 *     lecture, chaque ecriture et chaque suppression le portent. Un porteur
 *     `prospect:read:own` qui vise la fiche d'un collegue obtient un 404 : la
 *     ligne n'existe pas DANS SON PERIMETRE. Un `if` apres lecture aurait
 *     laisse fuiter l'existence de la fiche.
 *
 *  2. LE STATUT NE SE MODIFIE PAS PAR `PATCH`. Il n'est pas dans les DTO : un
 *     `PATCH { "status": "WON" }` est refuse en 400 par `forbidNonWhitelisted`.
 *     Le seul chemin est `POST /prospects/:id/status`, qui ecrit
 *     `LeadStatusHistory` DANS LA MEME TRANSACTION que le changement. Ouvrir un
 *     second chemin capable de deplacer l'etape sans laisser de trace viderait
 *     l'historique de sa valeur : il cesse d'etre la preuve du parcours.
 *
 *  3. TOUT FAIT ET SON TEMOIN VIVENT DANS LA MEME TRANSACTION. Changer une
 *     etape ecrit la fiche, l'historique et l'activite ensemble ; convertir
 *     ecrit le client, le contact, le lien, l'historique, l'activite et la
 *     notification ensemble. Un temoin qui survit a l'echec de son fait — ou
 *     l'inverse — est pire qu'une absence de temoin.
 *
 *  4. LA CONVERSION EST IDEMPOTENTE PAR REFUS. Une seconde conversion renvoie
 *     409 et ne cree rien. La garantie ne vient pas du `if` qui precede la
 *     creation, mais du compare-and-swap sur `convertedClientId` : deux appels
 *     simultanes ne peuvent pas, tous les deux, trouver la colonne a `null`.
 *
 *  5. L'ENTREE DE LA CHAINE — LA DEMANDE DE CONTACT — SE CONVERTIT ICI AUSSI.
 *     `convertContactRequest` ouvre la piste a partir d'une demande du
 *     formulaire public, avec la meme numerotation, le meme journal, le meme
 *     audit et le meme compare-and-swap. La regle vit dans ce service parce que
 *     c'est lui qui sait creer un prospect ; le controleur, lui, porte le chemin
 *     `contact-requests` (voir `contact-request-conversion.controller.ts`).
 *
 * POURQUOI AUCUNE ACTIVITE A LA CREATION D'UNE FICHE. `Activity` se lit par
 * projet ou par client (`ActivityService.list`), et un prospect n'a ni l'un ni
 * l'autre : l'entree ne serait servie a personne. Le journal d'etapes, lui, est
 * deja la chronologie de la fiche. L'audit, enfin, garde la trace de qui l'a
 * creee.
 *
 * CETTE RAISON NE VAUT PAS POUR LA CONVERSION D'UNE DEMANDE, et la difference
 * est de taille : convertir une demande EST l'evenement qui compte — un visiteur
 * du site est devenu une piste. Il depose donc un temoin dans le fil, invisible
 * au client (`isClientVisible: false` : il n'y a pas encore de client), comme le
 * fait deja un changement d'etape.
 */

/** Ligne du journal des etapes, avec son auteur resolu. */
export interface ProspectHistoryEntry {
  id: string;
  prospectId: string;
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus;
  note: string | null;
  changedById: string | null;
  createdAt: Date;
  changedBy: { id: string; firstName: string; lastName: string } | null;
}

/** Ce que la conversion rend : la fiche a jour et le dossier client ne. */
export interface ProspectConversion {
  prospect: Prospect;
  client: Client;
}

/**
 * Ce que la conversion d'une demande de contact rend : la piste ouverte, et la
 * demande a jour.
 *
 * La demande est renvoyee AVEC le prospect, et pas seulement la piste : le
 * frontend recoit ainsi le lien dans les deux sens en un seul appel — il n'a pas
 * a relire la file pour savoir a quelle demande la fiche correspond. C'est la
 * meme forme que `ProspectConversion`, qui rend le client cree.
 */
export interface ProspectFromContactRequest {
  prospect: Prospect;
  contactRequest: ContactRequest;
}

function prospectSnapshot(row: Prospect): Record<string, unknown> {
  return {
    reference: row.reference,
    companyName: row.companyName,
    status: row.status,
    ownerId: row.ownerId,
    convertedClientId: row.convertedClientId,
  };
}

@Injectable()
export class ProspectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly counters: CounterService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Fiche prospect
  // ---------------------------------------------------------------------------

  async list(user: AuthenticatedUser, query: ListProspectsQueryDto): Promise<Paginated<Prospect>> {
    const policy = new AccessPolicy(user);
    const perimeter = prospectPerimeter(policy, 'read');
    const p = resolvePagination(query);

    const filters: Prisma.ProspectWhereInput = {};
    if (query.status) filters.status = query.status;
    if (query.source) filters.source = query.source;
    // `ownerId` est un FILTRE, pas un perimetre. Compose en `AND` avec le
    // perimetre, il ne peut que reduire : demander le portefeuille d'un collegue
    // quand on n'a que `own` renvoie une page vide, jamais la sienne.
    if (query.ownerId) filters.ownerId = query.ownerId;

    if (query.search) {
      filters.OR = [
        { companyName: { contains: query.search, mode: 'insensitive' } },
        { contactFirstName: { contains: query.search, mode: 'insensitive' } },
        { contactLastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const where: Prisma.ProspectWhereInput = {
      deletedAt: null,
      AND: composeAnd(perimeter.where, filters),
    };

    // Meme transaction pour les deux requetes : sans instantane commun, une
    // creation entre le comptage et la lecture ferait apparaitre une page vide
    // en fin de liste.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.prospect.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.prospect.count({ where }),
    ]);

    return paginated(items, total, p);
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<Prospect> {
    const policy = new AccessPolicy(user);
    const perimeter = prospectPerimeter(policy, 'read');

    const prospect = await this.prisma.prospect.findFirst({
      where: { deletedAt: null, AND: composeAnd(perimeter.where, { id }) },
    });

    if (!prospect) {
      throw AppException.notFound('PROSPECT_NOT_FOUND', "Ce prospect n'existe pas.");
    }

    return prospect;
  }

  async create(user: AuthenticatedUser, dto: CreateProspectDto): Promise<Prospect> {
    const policy = new AccessPolicy(user);
    const perimeter = prospectPerimeter(policy, 'write');

    const prospect = await this.prisma.$transaction(async (tx) => {
      const ownerId = await this.resolveOwner(tx, policy, perimeter.scope, dto.ownerId);

      // La reference vient de `CounterService.reference`, et le `tx` est passe
      // meme s'il est optionnel dans sa signature : la reservation rejoint
      // alors la transaction de la ligne, et un echec plus loin annule les deux
      // ensemble — au prix d'un trou dans la sequence, jamais d'un doublon.
      // Seul `scope` est transmis : le prefixe (`PRO`) appartient au tableau
      // canonique du compteur, qui le partage avec `prisma/seed.ts`.
      const reference = await this.counters.reference({ scope: 'PROSPECT' }, tx);

      const created = await tx.prospect.create({
        data: {
          reference,
          companyName: dto.companyName,
          contactFirstName: dto.contactFirstName,
          contactLastName: dto.contactLastName,
          email: dto.email,
          phone: dto.phone,
          jobTitle: dto.jobTitle,
          website: dto.website,
          sector: dto.sector,
          source: dto.source,
          budgetRange: dto.budgetRange,
          estimatedBudget: dto.estimatedBudget,
          notes: dto.notes,
          ownerId,
          // `status` n'est pas dans le DTO : le schema pose NEW, et la ligne
          // d'historique ci-dessous en fait foi.
        },
      });

      // Premiere ligne du journal : `fromStatus: null` dit « creation », comme
      // le fait le seed. Dans la MEME transaction que la fiche, pour qu'un
      // prospect ne puisse pas exister sans que l'on sache d'ou il vient.
      await tx.leadStatusHistory.create({
        data: {
          prospectId: created.id,
          fromStatus: null,
          toStatus: created.status,
          changedById: policy.userId,
          note: 'Creation de la fiche.',
        },
      });

      return created;
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'PROSPECT_CREATED',
      entityType: 'Prospect',
      entityId: prospect.id,
      after: prospectSnapshot(prospect),
    });

    return prospect;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateProspectDto): Promise<Prospect> {
    const policy = new AccessPolicy(user);
    const perimeter = prospectPerimeter(policy, 'write');
    const scoped = composeAnd(perimeter.where, { id, deletedAt: null });

    const { before, after } = await this.prisma.$transaction(async (tx) => {
      const before = await tx.prospect.findFirst({ where: { AND: scoped } });

      if (!before) {
        throw AppException.notFound('PROSPECT_NOT_FOUND', "Ce prospect n'existe pas.");
      }

      // La reassignation est traitee a part : elle n'est pas un champ comme un
      // autre. Un porteur `own` ne peut pas la faire du tout — sortir une fiche
      // de son portefeuille n'est pas un droit que `own` accorde — et pour les
      // autres, le responsable designe doit exister.
      const reassignment =
        dto.ownerId === undefined
          ? {}
          : {
              ownerId: await this.resolveOwner(tx, policy, perimeter.scope, dto.ownerId),
            };

      // `updateMany` et non `update` : la contrainte de perimetre accompagne
      // l'ECRITURE elle-meme. Un `update` par identifiant unique ne saurait pas
      // la porter, et une ligne sortie du perimetre entre la lecture et
      // l'ecriture serait quand meme modifiee.
      const written = await tx.prospect.updateMany({
        where: { AND: scoped },
        data: {
          companyName: dto.companyName,
          contactFirstName: dto.contactFirstName,
          contactLastName: dto.contactLastName,
          email: dto.email,
          phone: dto.phone,
          jobTitle: dto.jobTitle,
          website: dto.website,
          sector: dto.sector,
          source: dto.source,
          budgetRange: dto.budgetRange,
          estimatedBudget: dto.estimatedBudget,
          notes: dto.notes,
          ...reassignment,
        },
      });

      if (written.count === 0) {
        throw AppException.notFound('PROSPECT_NOT_FOUND', "Ce prospect n'existe pas.");
      }

      const after = await tx.prospect.findFirstOrThrow({ where: { AND: scoped } });
      return { before, after };
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'PROSPECT_UPDATED',
      entityType: 'Prospect',
      entityId: id,
      before: prospectSnapshot(before),
      after: prospectSnapshot(after),
    });

    return after;
  }

  /**
   * Suppression LOGIQUE.
   *
   * Un prospect converti est refuse (409) : il est l'origine d'un dossier client
   * et le lien `Client.convertedFromProspect` se viderait en silence. Le
   * prospect disparait, la trace de la provenance du client aussi — or c'est
   * exactement ce que la conversion sert a conserver.
   */
  async remove(user: AuthenticatedUser, id: string): Promise<{ deleted: true }> {
    const policy = new AccessPolicy(user);
    const perimeter = prospectPerimeter(policy, 'delete');
    const scoped = composeAnd(perimeter.where, { id, deletedAt: null });

    const before = await this.prisma.prospect.findFirst({ where: { AND: scoped } });

    if (!before) {
      throw AppException.notFound('PROSPECT_NOT_FOUND', "Ce prospect n'existe pas.");
    }

    if (before.convertedClientId !== null) {
      throw AppException.conflict(
        'PROSPECT_CONVERTED_NOT_DELETABLE',
        'Ce prospect est devenu un client : il ne peut plus etre supprime.',
      );
    }

    await this.prisma.prospect.updateMany({
      where: { AND: scoped },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'PROSPECT_DELETED',
      entityType: 'Prospect',
      entityId: id,
      before: prospectSnapshot(before),
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Pipeline
  // ---------------------------------------------------------------------------

  /**
   * Deplace la fiche d'une etape a la suivante.
   *
   * LE STATUT PRECEDENT EST DANS LE `where` DE L'ECRITURE (compare-and-swap).
   * Deux changements d'etape simultanes ne peuvent donc pas partir tous les deux
   * de NEW : le premier verrouille la ligne, le second reevalue la condition
   * apres son commit, ne la reconnait plus, et repart en 409. Sans cela, l'un
   * des deux mouvements serait perdu et l'historique raconterait une suite
   * d'etapes qui n'a jamais eu lieu.
   */
  async changeStatus(
    user: AuthenticatedUser,
    id: string,
    dto: ChangeProspectStatusDto,
  ): Promise<Prospect> {
    const policy = new AccessPolicy(user);
    const perimeter = prospectPerimeter(policy, 'write');

    const { before, after } = await this.prisma.$transaction(async (tx) => {
      // La lecture porte le perimetre : un porteur `own` ne trouve pas la fiche
      // d'un collegue, donc ne peut pas deplacer son etape.
      const current = await tx.prospect.findFirst({
        where: { AND: composeAnd(perimeter.where, { id, deletedAt: null }) },
      });

      if (!current) {
        throw AppException.notFound('PROSPECT_NOT_FOUND', "Ce prospect n'existe pas.");
      }

      assertTransitionAllowed(current.status, dto.status);

      const written = await tx.prospect.updateMany({
        where: {
          AND: composeAnd(perimeter.where, {
            id,
            deletedAt: null,
            status: current.status,
          }),
        },
        data: {
          status: dto.status,
          // La raison d'une perte appartient a l'EVENEMENT, pas a la fiche :
          // elle n'est retenue que vers LOST, et effacee en quittant LOST. Une
          // fiche « NEGOTIATION » qui conserverait la raison d'une perte passee
          // raconterait une histoire fausse.
          lostReason: dto.status === LeadStatus.LOST ? (dto.lostReason ?? null) : null,
        },
      });

      if (written.count === 0) {
        throw AppException.conflict(
          'PROSPECT_STATUS_CHANGED',
          'Le statut de ce prospect a change entre-temps : rechargez la fiche et recommencez.',
        );
      }

      // L'historique rejoint la transaction qui a produit le changement. C'est
      // la seule raison d'etre de cette route : un deplacement d'etape sans
      // ligne d'historique serait un deplacement dont on ne peut rien prouver.
      await tx.leadStatusHistory.create({
        data: {
          prospectId: id,
          fromStatus: current.status,
          toStatus: dto.status,
          note: dto.note ?? null,
          changedById: policy.userId,
        },
      });

      // `isClientVisible` reste au defaut `false`, et il est ecrit ici pour que
      // la relecture ne laisse aucun doute : le pipeline commercial n'est pas le
      // fil que le client lit. Seule la conversion produit une entree visible.
      await this.activity.record(
        {
          type: ActivityType.STATUS_CHANGE,
          message: `Etape du prospect ${current.reference} : ${current.status} -> ${dto.status}.`,
          clientId: current.convertedClientId,
          actorId: policy.userId,
          metadata: {
            prospectId: current.id,
            prospectReference: current.reference,
            from: current.status,
            to: dto.status,
            ...(dto.note === undefined ? {} : { note: dto.note }),
          },
          isClientVisible: false,
        },
        tx,
      );

      const after = await tx.prospect.findFirstOrThrow({
        where: { AND: composeAnd(perimeter.where, { id }) },
      });

      return { before: current, after };
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'PROSPECT_STATUS_CHANGED',
      entityType: 'Prospect',
      entityId: id,
      before: prospectSnapshot(before),
      after: prospectSnapshot(after),
    });

    return after;
  }

  /**
   * Le journal des etapes, du plus ancien au plus recent.
   *
   * La fiche est relue DANS LE PERIMETRE avant que son journal ne soit servi :
   * sans cette lecture, un identifiant suffirait a obtenir l'historique d'un
   * prospect que l'on n'a pas le droit de voir.
   *
   * L'ordre est `createdAt` puis `id`. Le second critere n'est pas decoratif :
   * deux lignes ecrites dans la MEME transaction partagent leur `createdAt`
   * (PostgreSQL fige `now()` au debut de la transaction), et sans departage
   * l'ordre varierait d'une requete a l'autre — donc la pagination sauterait ou
   * repeterait des lignes.
   */
  async history(
    user: AuthenticatedUser,
    id: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<ProspectHistoryEntry>> {
    await this.findOne(user, id);

    const p = resolvePagination(query);
    const where: Prisma.LeadStatusHistoryWhereInput = { prospectId: id };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.leadStatusHistory.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: p.skip,
        take: p.take,
        include: { changedBy: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.leadStatusHistory.count({ where }),
    ]);

    return paginated(items, total, p);
  }

  /**
   * CONVERSION D'UN PROSPECT EN CLIENT.
   *
   * Six ecritures, une seule transaction : le client, son contact principal, le
   * lien sur le prospect, la ligne d'historique, l'activite visible du client,
   * la notification du responsable. Si l'une echoue, aucune ne subsiste — un
   * client sans prospect d'origine serait un dossier fantome, et un prospect
   * marque converti sans client serait pire encore.
   *
   * PERIMETRE PRODUIT : uniquement l'ouverture du dossier client. Aucun devis,
   * aucun projet : l'etape suivante appartient aux modules de facturation et de
   * projet, qui liront `Client.convertedFromProspect` pour retrouver l'origine.
   */
  async convert(user: AuthenticatedUser, id: string): Promise<ProspectConversion> {
    const policy = new AccessPolicy(user);
    const perimeter = prospectPerimeter(policy, 'convert');

    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.prospect.findFirst({
        where: { AND: composeAnd(perimeter.where, { id, deletedAt: null }) },
      });

      if (!current) {
        throw AppException.notFound('PROSPECT_NOT_FOUND', "Ce prospect n'existe pas.");
      }

      // Premier refus, sur la lecture : il evite le travail inutile dans le cas
      // courant (une seconde conversion demandee a la main). Ce n'est PAS lui
      // qui garantit l'unicite — voir le compare-and-swap plus bas.
      assertConvertible(current);

      const client = await this.clients.createFromProspect(tx, {
        companyName: current.companyName,
        sector: current.sector,
        website: current.website,
        accountManagerId: current.ownerId ?? policy.userId,
        // Le contact principal reprend l'interlocuteur du prospect. Il existe
        // toujours : `contactFirstName`, `contactLastName` et `email` sont
        // obligatoires sur le prospect.
        contact: {
          firstName: current.contactFirstName,
          lastName: current.contactLastName,
          email: current.email,
          phone: current.phone,
          jobTitle: current.jobTitle,
        },
      });

      // COMPARE-AND-SWAP — c'est ICI que l'unicite se gagne.
      //
      // Deux appels simultanes lisent tous les deux `convertedClientId = null`
      // et creent chacun leur client. Puis chacun tente cette ecriture : la
      // premiere verrouille la ligne, la seconde attend son commit, reevalue la
      // condition, ne trouve plus `null` et compte 0. Le 409 qui suit ANNULE SA
      // TRANSACTION — donc le client qu'elle venait de creer et le numero
      // qu'elle venait de consommer. Un seul dossier client survit, et le
      // prospect ne pointe que vers lui.
      const claimed = await tx.prospect.updateMany({
        where: {
          AND: composeAnd(perimeter.where, { id, deletedAt: null, convertedClientId: null }),
        },
        data: {
          convertedClientId: client.id,
          convertedAt: new Date(),
          status: LeadStatus.WON,
          lostReason: null,
        },
      });

      if (claimed.count === 0) {
        throw AppException.conflict(
          'PROSPECT_ALREADY_CONVERTED',
          'Ce prospect a deja ete converti en client.',
        );
      }

      const converted = await tx.prospect.findFirstOrThrow({
        where: { AND: composeAnd(perimeter.where, { id }) },
      });

      // Une ligne d'historique seulement si l'etape a REELLEMENT bouge. Un
      // prospect deja WON que l'on convertit ne s'est pas deplace : une ligne
      // WON -> WON n'attesterait d'aucun fait, et l'historique ne doit contenir
      // que des changements.
      if (current.status !== LeadStatus.WON) {
        await tx.leadStatusHistory.create({
          data: {
            prospectId: converted.id,
            fromStatus: current.status,
            toStatus: LeadStatus.WON,
            note: 'Conversion en client.',
            changedById: policy.userId,
          },
        });
      }

      // LA SEULE ENTREE VISIBLE DU MODULE, et elle l'est parce que le client
      // vient de naitre : son portail doit contenir une trace de son entree.
      // Tout le reste du pipeline — notes, changements d'etape — reste interne.
      await this.activity.record(
        {
          type: ActivityType.MILESTONE_REACHED,
          message: `Ouverture du dossier client ${client.reference} (${client.companyName}).`,
          clientId: client.id,
          actorId: policy.userId,
          metadata: {
            prospectId: converted.id,
            prospectReference: converted.reference,
            clientId: client.id,
            clientReference: client.reference,
          },
          isClientVisible: true,
        },
        tx,
      );

      // La notification annonce un fait : elle doit disparaitre avec lui si la
      // transaction est annulee, donc elle rejoint la transaction.
      //
      // On ne notifie pas l'auteur de l'action a lui-meme : il vient de lire le
      // resultat de son propre appel, une notification serait du bruit. Et s'il
      // n'y a pas de responsable (prospect non assigne), il n'y a personne a
      // prevenir — le dossier revient alors au porteur, qui est l'auteur.
      if (converted.ownerId !== null && converted.ownerId !== policy.userId) {
        await this.notifications.notify(
          converted.ownerId,
          {
            type: NotificationType.SYSTEM,
            title: 'Prospect converti en client',
            body: `${converted.reference} est devenu le dossier client ${client.reference}.`,
            link: `/clients/${client.id}`,
            entityType: 'Client',
            entityId: client.id,
          },
          tx,
        );
      }

      return { before: current, after: converted, client };
    });

    // L'audit est ecrit APRES le commit, et non dans la transaction : il est en
    // « best effort » (un journal d'audit indisponible ne doit pas annuler une
    // conversion reussie) et il lui faut l'identifiant du client cree.
    await this.audit.record({
      actorId: policy.userId,
      action: 'PROSPECT_CONVERTED',
      entityType: 'Prospect',
      entityId: result.after.id,
      before: prospectSnapshot(result.before),
      after: { ...prospectSnapshot(result.after), clientReference: result.client.reference },
    });

    return { prospect: result.after, client: result.client };
  }

  /**
   * CONVERSION D'UNE DEMANDE DE CONTACT EN PROSPECT — l'anneau
   * VISITEUR -> PROSPECT de la chaine, celui que rien ne fermait.
   *
   * POURQUOI ELLE VIT ICI ET PAS DANS LE MODULE CONTENU. Une demande de contact
   * appartient au module contenu, qui la recoit et la traite ; convertir, c'est
   * CREER UN PROSPECT — sa reference, son responsable, sa premiere ligne de
   * journal, sa trace d'audit, sa notification. Ces regles ne sont ecrites qu'ici,
   * et nulle part ailleurs. Le module contenu refuse d'ailleurs explicitement le
   * statut CONVERTED depuis sa file de traitement
   * (`contact-request.service.ts`, `update`) precisement pour qu'aucune demande
   * ne puisse etre marquee convertie sans prospect derriere : le seul chemin est
   * celui-ci.
   *
   * C'est le meme motif que `POST /quotes/:id/invoice`, porte par le module
   * FACTURES et non par celui des devis (voir le commentaire de `app.module.ts`) :
   * le controleur suit le CHEMIN de la ressource, le service suit la REGLE. Le
   * module commercial porte donc le chemin `contact-requests` pour cette route,
   * et le module contenu garde la file et les notes internes.
   *
   * CINQ ECRITURES, UNE SEULE TRANSACTION : le prospect, la demande qui passe a
   * CONVERTED et se lie au prospect, la premiere ligne du journal d'etapes, le
   * temoin d'activite, la notification du responsable. Un prospect sans demande
   * d'origine serait une piste dont on ne sait plus d'ou elle vient ; une demande
   * marquee convertie sans prospect serait pire encore — l'entonnoir commercial
   * compterait des conversions inexistantes, et un chiffre faux ne se corrige pas
   * apres coup parce que plus personne ne sait lesquelles etaient fausses.
   *
   * L'UNICITE SE GAGNE SUR UN COMPARE-AND-SWAP, PAS SUR LA LECTURE QUI PRECEDE.
   * Deux appels simultanes liraient tous les deux `convertedProspectId = null` et
   * creeraient chacun leur prospect. Le `updateMany` filtre sur
   * `convertedProspectId: null` : le premier verrouille la ligne, le second
   * reevalue la condition apres son commit, compte 0, et le 409 qui suit ANNULE
   * sa transaction — donc le prospect qu'elle venait de creer, la ligne de
   * journal, et le numero `PRO-` qu'elle venait de consommer. Un seul prospect
   * survit.
   *
   * LE RESPONSABLE EST CELUI QUI AVAIT TRAITE LA DEMANDE, sinon l'auteur. Le
   * handler est un fait du modele, pas une supposition : `update` l'horodate au
   * premier changement d'etat — c'est « qui a pris cette demande en charge ». Un
   * prospect ne se cree pas sans responsable (voir `create`), et l'oublier ici
   * laisserait une piste que personne ne suit. S'il n'y en a pas, l'auteur prend
   * la fiche — il vient de la convertir.
   *
   * PAS DE `prospectPerimeter` ICI, ET C'EST VOULU : la route est autorisee par
   * `contactrequest:convert:any`, un droit que le catalogue accorde a des roles
   * (COMMUNICATION_MANAGER, SALES) qui traitent les demandes. Exiger en plus un
   * scope `prospect:*` ferait dependre l'acces a la route d'un droit qui n'a
   * jamais ete attribue pour cela. L'espace CLIENT reste ferme par
   * `assertInternalSpace`, pose sur le ROLE avant tout raisonnement sur les codes.
   */
  async convertContactRequest(
    user: AuthenticatedUser,
    contactRequestId: string,
  ): Promise<ProspectFromContactRequest> {
    const policy = new AccessPolicy(user);
    assertInternalSpace(policy);

    const result = await this.prisma.$transaction(async (tx) => {
      const request = await tx.contactRequest.findFirst({
        where: { id: contactRequestId, deletedAt: null },
      });

      // La lecture porte `deletedAt: null` : une demande retiree de la file a
      // disparu, et la convertir ferait naitre un prospect d'un document que
      // l'agence a explicitement ecarte.
      if (!request) throw notFoundContactRequest();

      // Premier refus, sur la lecture : il evite le travail inutile dans le cas
      // courant (une seconde conversion demandee a la main). Ce n'est PAS lui qui
      // garantit l'unicite — voir le compare-and-swap plus bas.
      if (request.convertedProspectId !== null) throw alreadyConverted();

      const ownerId = request.handledById ?? policy.userId;

      // `scope` seul : le prefixe (`PRO`) appartient au tableau canonique du
      // compteur, partage avec `prisma/seed.ts`. Le `tx` est transmis pour que la
      // reservation rejoigne la transaction du prospect : un echec plus loin
      // annule les deux ensemble — au prix d'un trou dans la sequence, jamais
      // d'un doublon.
      const reference = await this.counters.reference({ scope: 'PROSPECT' }, tx);

      const prospect = await tx.prospect.create({
        data: {
          reference,
          // Les coordonnees passent telles quelles. `companyName`, `phone`,
          // `jobTitle` et `website` sont facultatifs des deux cotes ;
          // `firstName`/`lastName`/`email`, obligatoires sur la demande, le sont
          // aussi sur la fiche.
          companyName: request.companyName,
          contactFirstName: request.firstName,
          contactLastName: request.lastName,
          email: request.email,
          phone: request.phone,
          jobTitle: request.jobTitle,
          website: request.website,
          // `sector` n'a pas d'equivalent sur la demande : il reste nul, et une
          // valeur inventee serait pire qu'une case vide.
          source: LeadSource.CONTACT_FORM,
          // La fourchette de budget est un choix ferme du visiteur : elle se
          // reprend. `estimatedBudget`, lui, est une estimation INTERNE du
          // commercial — elle ne se deduit pas d'une fourchette.
          budgetRange: request.budgetRange,
          notes: contactRequestNotes(request),
          ownerId,
          // `status` n'est pas ecrit : le schema pose NEW, et la ligne
          // d'historique ci-dessous en fait foi.
        },
      });

      // COMPARE-AND-SWAP. `updateMany` et non `update` : la condition
      // `convertedProspectId: null` accompagne l'ECRITURE elle-meme. Un `update`
      // par identifiant unique ne saurait pas la porter, et deux conversions
      // simultanees passeraient toutes les deux.
      //
      // `handledById` est pose en meme temps, et seulement s'il est vide : c'est
      // la regle de `update` (la PREMIERE prise en charge est horodatee, la
      // derniere ne l'ecrase pas). Convertir fait sortir la demande de la file,
      // donc c'est une prise en charge si personne ne l'avait ouverte.
      const claimed = await tx.contactRequest.updateMany({
        where: { id: request.id, deletedAt: null, convertedProspectId: null },
        data: {
          convertedProspectId: prospect.id,
          convertedAt: new Date(),
          status: ContactRequestStatus.CONVERTED,
          ...(request.handledById === null
            ? { handledById: policy.userId, handledAt: new Date() }
            : {}),
        },
      });

      if (claimed.count === 0) throw alreadyConverted();

      // La premiere ligne du journal : `fromStatus: null` dit « creation », comme
      // le fait `create` et comme le fait le seed. Dans la MEME transaction que
      // la fiche, pour qu'un prospect ne puisse pas exister sans que l'on sache
      // d'ou il vient.
      await tx.leadStatusHistory.create({
        data: {
          prospectId: prospect.id,
          fromStatus: null,
          toStatus: prospect.status,
          changedById: policy.userId,
          note: `Creation depuis la demande de contact ${request.reference}.`,
        },
      });

      // Le temoin du franchissement d'etape de l'entonnoir : un visiteur du site
      // est devenu une piste. `isClientVisible: false` est ecrit explicitement —
      // il n'y a pas encore de client, et le pipeline commercial est interne.
      await this.activity.record(
        {
          type: ActivityType.MILESTONE_REACHED,
          message: `Piste ${prospect.reference} ouverte depuis la demande de contact ${request.reference}.`,
          clientId: null,
          actorId: policy.userId,
          metadata: {
            prospectId: prospect.id,
            prospectReference: prospect.reference,
            contactRequestId: request.id,
            contactRequestReference: request.reference,
          },
          isClientVisible: false,
        },
        tx,
      );

      // Meme regle que la conversion prospect -> client : le responsable est
      // prevenu, l'AUTEUR ne l'est pas — il vient de lire le resultat de son
      // propre appel, et une notification serait du bruit. Le type est `SYSTEM`
      // parce que le catalogue de notifications n'a pas de code dedie a ce fait :
      // en inventer un exigerait une migration d'enum, et un schema different de
      // celui du reste du module pour un seul evenement.
      if (prospect.ownerId !== null && prospect.ownerId !== policy.userId) {
        await this.notifications.notify(
          prospect.ownerId,
          {
            type: NotificationType.SYSTEM,
            title: 'Nouvelle piste issue du formulaire de contact',
            body: `La demande ${request.reference} est devenue le prospect ${prospect.reference}.`,
            link: `/prospects/${prospect.id}`,
            entityType: 'Prospect',
            entityId: prospect.id,
          },
          tx,
        );
      }

      const updated = await tx.contactRequest.findFirstOrThrow({ where: { id: request.id } });

      return { before: request, prospect, contactRequest: updated };
    });

    // L'audit est ecrit APRES le commit, comme partout ailleurs : il est en
    // « best effort » et ne rejoint pas la transaction. Une entree, et une seule :
    // l'acte s'appelle « convertir cette demande », et ses effets — le prospect
    // cree — sont portes dans `after`. C'est exactement la forme de
    // `QUOTE_ACCEPTED`, qui cree un client et un projet et n'audite que le devis.
    await this.audit.record({
      actorId: policy.userId,
      action: 'CONTACT_REQUEST_CONVERTED',
      entityType: 'ContactRequest',
      entityId: result.contactRequest.id,
      before: {
        status: result.before.status,
        convertedProspectId: result.before.convertedProspectId,
      },
      after: {
        status: result.contactRequest.status,
        convertedProspectId: result.prospect.id,
        prospectReference: result.prospect.reference,
        ownerId: result.prospect.ownerId,
      },
    });

    return { prospect: result.prospect, contactRequest: result.contactRequest };
  }

  // ---------------------------------------------------------------------------
  // Interne
  // ---------------------------------------------------------------------------

  /**
   * Le responsable a ecrire sur la fiche, ou un refus.
   *
   * Trois cas, et le troisieme est celui qui compte :
   *
   *  - rien de demande : la fiche revient au PORTEUR ;
   *  - le porteur se designe lui-meme : rien a verifier ;
   *  - un autre utilisateur est designe : il faut detenir `any` (un porteur
   *    `own` ne sort pas une fiche de son portefeuille) ET que ce compte existe.
   *
   * Le controle d'existence n'est pas du zele : `ownerId` est une cle etrangere
   * vers `users`. Sans lui, un identifiant errone remonterait en violation de
   * contrainte, donc en 500, pour ce qui n'est qu'une faute de saisie.
   */
  private async resolveOwner(
    tx: Prisma.TransactionClient,
    policy: AccessPolicy,
    scope: ScopeName,
    requested: string | undefined,
  ): Promise<string> {
    const ownerId = requested ?? policy.userId;

    if (ownerId === policy.userId) {
      return ownerId;
    }

    if (scope === SCOPE_OWN) {
      throw AppException.forbidden('Vous ne pouvez assigner ce prospect qu\'a vous-meme.');
    }

    const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { id: true } });

    if (!owner) {
      throw AppException.unprocessable(
        'PROSPECT_OWNER_NOT_FOUND',
        "Le responsable designe n'existe pas.",
        { ownerId },
      );
    }

    return ownerId;
  }
}

/** Meme code que la file de traitement : une demande absente est absente partout. */
function notFoundContactRequest(): AppException {
  return AppException.notFound('CONTACT_REQUEST_NOT_FOUND', 'Demande de contact introuvable.');
}

/**
 * Le refus d'une seconde conversion.
 *
 * Le code est NOMME (`CONTACT_REQUEST_ALREADY_CONVERTED`) et non generique : le
 * frontend doit pouvoir dire « cette demande a deja donne une piste » et proposer
 * d'ouvrir la fiche existante, au lieu d'afficher un conflit sans issue. C'est un
 * 409 et non un 422 : la demande est dans un etat qui rend l'operation impossible,
 * et cet etat ne se corrige pas en modifiant la requete.
 */
function alreadyConverted(): AppException {
  return AppException.conflict(
    'CONTACT_REQUEST_ALREADY_CONVERTED',
    'Cette demande a deja ete convertie en prospect.',
  );
}

/**
 * Le contenu de la demande, transcrit dans les notes de la fiche.
 *
 * Le lien vers la demande est deja porte par `convertedProspectId` ; ce texte est
 * la pour le COMMERCIAL qui ouvre la fiche : il y lit ce que le visiteur a
 * demande, dans ses mots. La reference d'origine est citee pour qu'une note
 * recopiee ailleurs reste rattachable a sa source.
 *
 * Le sujet est facultatif : quand il manque, la phrase s'arrete au point, sans
 * laisser un « Sujet : » orphelin.
 */
function contactRequestNotes(request: {
  reference: string;
  subject: string | null;
  message: string;
}): string {
  const subject = request.subject?.trim();
  const head = `Demande de contact ${request.reference}${subject ? ` — ${subject}` : ''}.`;

  return `${head}\n\n${request.message}`;
}
