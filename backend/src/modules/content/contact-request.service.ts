import { Injectable, Logger } from '@nestjs/common';
import { paginated, resolvePagination, type Paginated } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import { REFERENCE_SCOPES } from '../../common/references/reference.scopes.js';
import {
  RoleCode,
  ContactRequestStatus,
  NotificationType,
  UserStatus,
} from '../../generated/prisma/enums.js';
import type { ContactRequest, Prisma } from '../../generated/prisma/client.js';
import { CounterService } from '../counters/counter.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  CreateContactRequestDto,
  ListContactRequestsQueryDto,
  UpdateContactRequestDto,
} from './dto/contact-request.dto.js';

/**
 * DEMANDES DE CONTACT — le formulaire public et sa file de traitement.
 *
 * DEUX RESPONSABILITES QUI NE PARTAGENT PAS LES MEMES REGLES.
 *
 * `create` est appelee par un visiteur ANONYME. Tout ce qui compte pour la suite
 * est donc ecrit par le SERVEUR et jamais lu dans le corps : la reference
 * sequentielle, l'horodatage, l'adresse IP, le navigateur, et l'etat initial
 * `NEW`. Un appelant ne choisit que le contenu de sa demande.
 *
 * Le reste est reserve a l'agence, derriere `contactrequest:read:any` et
 * `contactrequest:write:any`. Aucune de ces methodes ne verifie elle-meme la
 * permission : elle est posee sur la route par le garde, et c'est la route qui
 * decide qui entre. Ce service, lui, decide de ce qui est ecrit.
 *
 * LA REFERENCE NE SORT PAS DE LA REPONSE PUBLIQUE. Elle est sequentielle et
 * annuelle : deux envois suffisent a mesurer l'ecart entre les deux numeros,
 * donc a deduire le volume de demandes de l'agence sur l'annee. C'est du
 * renseignement concurrentiel gratuit, offert a qui remplit le formulaire deux
 * fois. Elle est donc ecrite en base, affichee a l'agence, et absente de la
 * reponse au visiteur.
 */
@Injectable()
export class ContactRequestService {
  private readonly logger = new Logger(ContactRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Enregistre une demande venue du site public.
   *
   * LA REFERENCE ET LA LIGNE SONT ECRITES DANS LA MEME TRANSACTION. Le compteur
   * est incremente dans la transaction : si l'ecriture echoue, l'increment est
   * annule avec elle et le numero n'est pas consomme pour rien. Un numero brule
   * laisserait un trou dans la numerotation annuelle, et un trou dans une suite
   * de references se lit comme une suppression.
   *
   * Renvoie `void` : rien de ce que contient la ligne ne doit sortir par la
   * route publique — ni la reference, ni l'identifiant interne.
   */
  async create(dto: CreateContactRequestDto, trace: RequestTrace): Promise<void> {
    const utm = buildUtm(dto);

    const created = await this.prisma.$transaction(async (tx) => {
      const reference = await this.counters.reference(
        { scope: REFERENCE_SCOPES.CONTACT_REQUEST },
        tx,
      );

      return tx.contactRequest.create({
        data: {
          reference,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone ?? null,
          companyName: dto.companyName ?? null,
          jobTitle: dto.jobTitle ?? null,
          website: dto.website ?? null,
          subject: dto.subject ?? null,
          message: dto.message,
          serviceId: dto.serviceId ?? null,
          packageId: dto.packageId ?? null,
          budgetRange: dto.budgetRange,
          source: dto.source ?? null,
          ...(utm === undefined ? {} : { utm }),
          ipAddress: trace.ipAddress,
          userAgent: trace.userAgent,
        },
        select: { id: true, reference: true, firstName: true, lastName: true, email: true },
      });
    });

    await this.notifyAgency(created);
  }

  async list(query: ListContactRequestsQueryDto): Promise<Paginated<ContactRequestRow>> {
    const pagination = resolvePagination(query);
    const where: Prisma.ContactRequestWhereInput = {
      AND: [
        { deletedAt: null },
        ...(query.status === undefined ? [] : [{ status: query.status }]),
        ...(query.serviceId === undefined ? [] : [{ serviceId: query.serviceId }]),
        ...(query.packageId === undefined ? [] : [{ packageId: query.packageId }]),
        ...(query.from === undefined && query.to === undefined
          ? []
          : [{ createdAt: buildDateRange(query.from, query.to) }]),
        ...(query.search === undefined
          ? []
          : [
              {
                OR: [
                  { email: { contains: query.search, mode: 'insensitive' as const } },
                  { firstName: { contains: query.search, mode: 'insensitive' as const } },
                  { lastName: { contains: query.search, mode: 'insensitive' as const } },
                  { subject: { contains: query.search, mode: 'insensitive' as const } },
                  { message: { contains: query.search, mode: 'insensitive' as const } },
                ],
              },
            ]),
      ],
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.contactRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.contactRequest.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  async findOne(id: string): Promise<ContactRequestRow> {
    const request = await this.prisma.contactRequest.findFirst({
      where: { id, deletedAt: null },
    });

    if (!request) throw notFoundRequest();
    return request;
  }

  /**
   * Traite une demande : etat et notes internes.
   *
   * `CONVERTED` EST REFUSE ICI, et c'est le point de cette methode. Une demande
   * convertie est une demande dont on a tire un prospect ; le passage a cet etat
   * appartient au module CRM, qui cree le prospect et renseigne le lien
   * `convertedProspectId`. Autoriser ce statut depuis la file de traitement
   * produirait des demandes marquees converties sans prospect derriere — et un
   * entonnoir commercial qui compte des conversions inexistantes ne se corrige
   * pas apres coup, parce que personne ne sait plus lesquelles etaient fausses.
   *
   * La PREMIERE prise en charge est horodatee. Des qu'une demande quitte l'etat
   * `NEW`, on note qui l'a ouverte et quand — a condition que personne ne l'ait
   * deja prise. Sans cette condition, le dernier a avoir touche la fiche
   * effacerait le nom du premier, et « qui a traite cette demande » n'aurait plus
   * de reponse.
   */
  async update(
    id: string,
    dto: UpdateContactRequestDto,
    actorId: string,
  ): Promise<ContactRequestRow> {
    const existing = await this.prisma.contactRequest.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, handledById: true, status: true },
    });

    if (!existing) throw notFoundRequest();

    if (dto.status === ContactRequestStatus.CONVERTED) {
      throw AppException.unprocessable(
        'CONTACT_REQUEST_CONVERT',
        'Une demande se convertit depuis le module commercial, qui cree le prospect et le rattache.',
      );
    }

    const firstHandling =
      existing.handledById === null && dto.status !== undefined && dto.status !== existing.status;

    return this.prisma.contactRequest.update({
      where: { id },
      data: {
        ...dto,
        ...(firstHandling
          ? { handledBy: { connect: { id: actorId } }, handledAt: new Date() }
          : {}),
      },
    });
  }

  /**
   * Retire une demande de la file.
   *
   * Suppression LOGIQUE : la ligne reste, `deletedAt` est pose. Une demande de
   * contact est une piece de la relation commerciale — elle peut etre citee dans
   * un litige, et sa reference est unique. L'effacer vraiment libererait le
   * numero, qu'un envoi ulterieur reutiliserait : deux documents differents
   * porteraient alors la meme reference.
   */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.contactRequest.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });

    if (!existing) throw notFoundRequest();

    await this.prisma.contactRequest.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Previent l'agence qu'une demande est arrivee.
   *
   * ADMIN et SALES : un formulaire de contact est un lead, et ces deux roles
   * sont ceux qui le traitent. Les autres roles ne sont pas notifies — une
   * notification qui arrive a tout le monde ne reveille personne.
   *
   * L'APPEL EST HORS TRANSACTION ET SON ECHEC EST AVALE. Ce n'est pas de la
   * negligence, c'est l'ordre des priorites : la demande est deja enregistree.
   * Faire echouer la reponse parce qu'une notification n'est pas partie
   * afficherait une erreur a un visiteur dont le message a bien ete recu, et il
   * le renverrait — produisant un doublon. Mieux vaut une notification manquante,
   * qui se voit dans le journal et se rattrape en ouvrant la file, qu'un doublon
   * qu'on ne saura pas distinguer d'une vraie seconde demande.
   *
   * Le nombre de destinataires est borne. La route publique est quota et chaque
   * envoi coute une ecriture par destinataire : sans borne, un formulaire
   * automatise multiplierait les ecritures par la taille de l'equipe. Vingt
   * couvre une agence entiere ; au-dela, la file reste consultable.
   */
  private async notifyAgency(request: {
    id: string;
    reference: string;
    firstName: string;
    lastName: string;
    email: string;
  }): Promise<void> {
    try {
      const recipients = await this.prisma.user.findMany({
        where: {
          deletedAt: null,
          status: UserStatus.ACTIVE,
          roles: { some: { role: { code: { in: [RoleCode.ADMIN, RoleCode.SALES] } } } },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 20,
      });

      if (recipients.length === 0) return;

      await this.notifications.notifyMany(
        recipients.map((user) => user.id),
        {
          type: NotificationType.CONTACT_REQUEST_RECEIVED,
          title: `Nouvelle demande de contact ${request.reference}`,
          body: `${request.firstName} ${request.lastName} — ${request.email}`,
          entityType: 'ContactRequest',
          entityId: request.id,
          link: `/admin/demandes/${request.id}`,
        },
      );
    } catch (error) {
      this.logger.error(
        `Demande ${request.reference} enregistree, notification non envoyee : ${String(error)}`,
      );
    }
  }
}

/** Ce que le controleur sait de la requete et que le corps ne doit pas pouvoir inventer. */
export interface RequestTrace {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

type ContactRequestRow = ContactRequest;

function notFoundRequest(): AppException {
  return AppException.notFound('CONTACT_REQUEST_NOT_FOUND', 'Demande de contact introuvable.');
}

/**
 * Intervalle de dates sur la creation, a partir des bornes du filtre.
 *
 * Une borne absente n'est pas remplacee par une valeur par defaut : `from` seul
 * veut dire « depuis cette date », `to` seul « jusqu'a cette date », et les deux
 * rien du tout — auquel cas la clause n'est meme pas construite. Inventer une
 * borne manquante repondrait a une question qui n'a pas ete posee.
 *
 * La borne haute est posee en fin de journee quand seule la date est fournie,
 * sinon une recherche « jusqu'au 15 » exclurait tout le 15 a partir de minuit —
 * et l'agence conclurait que la journee n'a rien recu.
 */
function buildDateRange(from: string | undefined, to: string | undefined): Prisma.DateTimeFilter {
  const range: Prisma.DateTimeFilter = {};

  if (from !== undefined) range.gte = new Date(from);

  if (to !== undefined) {
    const end = new Date(to);
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(to.trim());
    if (isDateOnly) end.setUTCHours(23, 59, 59, 999);
    range.lte = end;
  }

  return range;
}

/**
 * Compose la colonne `utm` a partir des trois champs bornes du DTO.
 *
 * Rend `undefined` quand aucune campagne n'est renseignee : Prisma n'ecrit alors
 * rien et la colonne reste nulle, ce qui distingue « aucune campagne » de
 * « campagne vide ». Un objet `{}` serait une troisieme valeur pour un seul etat.
 */
function buildUtm(dto: CreateContactRequestDto): Prisma.InputJsonObject | undefined {
  const entries: Record<string, string> = {};

  if (dto.utmSource !== undefined) entries.source = dto.utmSource;
  if (dto.utmMedium !== undefined) entries.medium = dto.utmMedium;
  if (dto.utmCampaign !== undefined) entries.campaign = dto.utmCampaign;

  return Object.keys(entries).length === 0 ? undefined : entries;
}
