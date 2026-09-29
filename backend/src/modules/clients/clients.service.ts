import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import {
  type PaginationQueryDto,
  paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Paginated } from '../../common/interceptors/transform.interceptor.js';
import type { Client, Contact, Prisma } from '../../generated/prisma/client.js';
import { ClientStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { clientPerimeter, composeAnd, contactPerimeter } from './client-scope.js';
import { CounterService } from '../counters/counter.service.js';
import type {
  CreateClientDto,
  CreateContactDto,
  ListClientsQueryDto,
  UpdateClientDto,
  UpdateContactDto,
} from './dto/client.dto.js';

/**
 * LOGIQUE DU DOMAINE CLIENT.
 *
 * Deux invariants portent tout ce fichier :
 *
 *  1. LE PERIMETRE EST DANS LE `where`, JAMAIS DANS UN `if` APRES LECTURE. Voir
 *     `client-scope.ts` pour la raison, et notamment l'exigence du cahier des
 *     charges sur l'identifiant d'un autre client. Chaque lecture ET chaque
 *     ecriture (`updateMany`) porte le perimetre : une ligne hors perimetre ne
 *     peut donc pas etre modifiee, meme si elle a ete lue par erreur.
 *
 *  2. UN SEUL CONTACT PRINCIPAL PAR CLIENT. Le schema l'annonce, la base ne
 *     l'impose pas : c'est donc ici que la regle tient, et elle tient dans une
 *     transaction — sans quoi deux requetes simultanees laisseraient deux
 *     principaux, et le frontend devrait choisir lequel afficher.
 *
 * La suppression est LOGIQUE (`deletedAt`) : le modele la porte, et un dossier
 * client ne disparait pas d'un `DELETE` — il porte des devis, des factures et
 * des paiements qui doivent rester lisibles. Toutes les lectures filtrent
 * `deletedAt: null`.
 */

/** Ce qu'un prospect fournit pour naitre en client. */
export interface ClientFromProspectInput {
  readonly companyName: string | null;
  readonly sector: string | null;
  readonly website: string | null;
  readonly accountManagerId: string | null;
  /** Renseigne quand le prospect porte un nom de contact : c'est le contact principal. */
  readonly contact: {
    readonly firstName: string;
    readonly lastName: string;
    readonly email: string | null;
    readonly phone: string | null;
    readonly jobTitle: string | null;
  } | null;
}

/** Dernier recours : `companyName` est obligatoire cote client, facultatif cote prospect. */
const UNNAMED_COMPANY = 'Client sans raison sociale';

function clientSnapshot(row: Client): Record<string, unknown> {
  return {
    reference: row.reference,
    companyName: row.companyName,
    status: row.status,
    accountManagerId: row.accountManagerId,
  };
}

function contactSnapshot(row: Contact): Record<string, unknown> {
  return {
    clientId: row.clientId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    isPrimary: row.isPrimary,
  };
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Dossiers clients
  // ---------------------------------------------------------------------------

  async list(user: AuthenticatedUser, query: ListClientsQueryDto): Promise<Paginated<Client>> {
    const policy = new AccessPolicy(user);
    const perimeter = clientPerimeter(policy, 'client', 'read');
    const p = resolvePagination(query);

    const filters: Prisma.ClientWhereInput = {};
    if (query.status) filters.status = query.status;
    if (query.accountManagerId) filters.accountManagerId = query.accountManagerId;
    if (query.search) {
      filters.OR = [
        { companyName: { contains: query.search, mode: 'insensitive' } },
        { legalName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const where: Prisma.ClientWhereInput = {
      deletedAt: null,
      // `AND` et non un etalement : un filtre de recherche ne doit jamais
      // pouvoir elargir le perimetre. Voir `composeAnd`.
      AND: composeAnd(perimeter, filters),
    };

    // Les deux requetes partent dans la meme transaction : sans instantane
    // commun, une creation entre le comptage et la lecture ferait afficher une
    // page vide en fin de liste.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.client.count({ where }),
    ]);

    return paginated(items, total, p);
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<Client> {
    const policy = new AccessPolicy(user);
    const perimeter = clientPerimeter(policy, 'client', 'read');

    const client = await this.prisma.client.findFirst({
      where: { deletedAt: null, AND: composeAnd(perimeter, { id }) },
    });

    if (!client) {
      // 404 et non 403 : pour un porteur de l'espace client, la fiche visee
      // n'existe pas DANS SON PERIMETRE. Un 403 distinct confirmerait
      // l'existence du dossier d'un autre client, ce que l'exigence du cahier
      // des charges cherche precisement a empecher.
      throw AppException.notFound('CLIENT_NOT_FOUND', "Ce dossier client n'existe pas.");
    }

    return client;
  }

  async create(user: AuthenticatedUser, dto: CreateClientDto): Promise<Client> {
    const policy = new AccessPolicy(user);
    clientPerimeter(policy, 'client', 'write');

    const client = await this.prisma.$transaction(async (tx) => {
      const accountManagerId = await this.assertKnownUser(
        tx,
        dto.accountManagerId ?? policy.userId,
        policy.userId,
      );

      // La reference vient de `CounterService.reference`, et le `tx` est passe
      // meme s'il est optionnel dans sa signature : la reservation rejoint
      // alors la transaction de la ligne, et un echec plus loin annule les deux
      // ensemble — au prix d'un trou dans la sequence, jamais d'un doublon.
      // Seul `scope` est transmis : le prefixe (`CLI`) appartient au tableau
      // canonique du compteur, pas a ses appelants.
      const reference = await this.counters.reference({ scope: 'CLIENT' }, tx);

      return tx.client.create({
        data: {
          reference,
          companyName: dto.companyName,
          legalName: dto.legalName,
          registrationNumber: dto.registrationNumber,
          vatNumber: dto.vatNumber,
          sector: dto.sector,
          website: dto.website,
          employeeRange: dto.employeeRange,
          addressLine1: dto.addressLine1,
          addressLine2: dto.addressLine2,
          postalCode: dto.postalCode,
          city: dto.city,
          region: dto.region,
          country: dto.country,
          status: dto.status ?? ClientStatus.ACTIVE,
          accountManagerId,
          notes: dto.notes,
        },
      });
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'CLIENT_CREATED',
      entityType: 'Client',
      entityId: client.id,
      after: clientSnapshot(client),
    });

    return client;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateClientDto): Promise<Client> {
    const policy = new AccessPolicy(user);
    const perimeter = clientPerimeter(policy, 'client', 'write');
    const scoped = composeAnd(perimeter, { id, deletedAt: null });

    const { before, after } = await this.prisma.$transaction(async (tx) => {
      const before = await tx.client.findFirst({ where: { AND: scoped } });

      if (!before) {
        throw AppException.notFound('CLIENT_NOT_FOUND', "Ce dossier client n'existe pas.");
      }

      // Une reassignation explicite est verifiee : `accountManagerId` est une cle
      // etrangere vers `users`, et un identifiant inconnu remonterait en 500
      // pour une faute de saisie. `null` desassigne le dossier, il n'y a alors
      // rien a verifier.
      const assignment =
        typeof dto.accountManagerId === 'string'
          ? {
              accountManagerId: await this.assertKnownUser(tx, dto.accountManagerId, policy.userId),
            }
          : {};

      // `updateMany` et non `update` : la contrainte de perimetre accompagne
      // l'ECRITURE elle-meme. Un `update` par identifiant unique ne saurait pas
      // la porter, et une ligne sortie du perimetre entre la lecture et
      // l'ecriture serait quand meme modifiee.
      const written = await tx.client.updateMany({
        where: { AND: scoped },
        data: {
          companyName: dto.companyName,
          legalName: dto.legalName,
          registrationNumber: dto.registrationNumber,
          vatNumber: dto.vatNumber,
          sector: dto.sector,
          website: dto.website,
          employeeRange: dto.employeeRange,
          addressLine1: dto.addressLine1,
          addressLine2: dto.addressLine2,
          postalCode: dto.postalCode,
          city: dto.city,
          region: dto.region,
          country: dto.country,
          status: dto.status,
          ...assignment,
          notes: dto.notes,
        },
      });

      if (written.count === 0) {
        throw AppException.notFound('CLIENT_NOT_FOUND', "Ce dossier client n'existe pas.");
      }

      const after = await tx.client.findFirstOrThrow({ where: { AND: scoped } });
      return { before, after };
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'CLIENT_UPDATED',
      entityType: 'Client',
      entityId: id,
      before: clientSnapshot(before),
      after: clientSnapshot(after),
    });

    return after;
  }

  // ---------------------------------------------------------------------------
  // Contacts
  // ---------------------------------------------------------------------------

  async listContacts(
    user: AuthenticatedUser,
    clientId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<Contact>> {
    const policy = new AccessPolicy(user);
    // Pour un porteur de l'espace client, `contactPerimeter` renvoie
    // `{ clientId: policy.clientId }` : l'identifiant du chemin devient un
    // simple filtre, et les deux contraintes se composent en `AND`. Un client
    // qui vise un autre dossier obtient donc une page vide, sans jamais
    // apprendre si ce dossier existe.
    const perimeter = contactPerimeter(policy, 'contact', 'read');
    const p = resolvePagination(query);

    const where: Prisma.ContactWhereInput = {
      deletedAt: null,
      AND: composeAnd(perimeter, { clientId }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({
        where,
        // Le principal d'abord : c'est l'interlocuteur que l'on cherche dans
        // un dossier, les autres viennent ensuite par ordre alphabetique.
        orderBy: [{ isPrimary: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.contact.count({ where }),
    ]);

    return paginated(items, total, p);
  }

  async createContact(
    user: AuthenticatedUser,
    clientId: string,
    dto: CreateContactDto,
  ): Promise<Contact> {
    const policy = new AccessPolicy(user);
    // Un seul perimetre suffit ici, et c'est celui des clients : la ressource de
    // permission est `contact` (`contact:write:any`), mais la table interrogee
    // est celle des dossiers. L'appel refuse au passage l'espace client, qui
    // n'ecrit aucun contact.
    const writableClient = clientPerimeter(policy, 'contact', 'write');

    const contact = await this.prisma.$transaction(async (tx) => {
      // L'existence du client est verifiee DANS LE PERIMETRE, pour rendre un 404
      // franc : sans ce controle, une cle etrangere inconnue ferait remonter une
      // violation de contrainte, donc un 500, pour une erreur d'appel.
      const client = await tx.client.findFirst({
        where: { deletedAt: null, AND: composeAnd(writableClient, { id: clientId }) },
        select: { id: true },
      });

      if (!client) {
        throw AppException.notFound('CLIENT_NOT_FOUND', "Ce dossier client n'existe pas.");
      }

      const isPrimary = dto.isPrimary ?? false;

      if (isPrimary) {
        await this.clearOtherPrimaries(tx, client.id, null);
      }

      return tx.contact.create({
        data: {
          clientId: client.id,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          jobTitle: dto.jobTitle,
          isPrimary,
          notes: dto.notes,
        },
      });
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'CONTACT_CREATED',
      entityType: 'Contact',
      entityId: contact.id,
      after: contactSnapshot(contact),
    });

    return contact;
  }

  async updateContact(
    user: AuthenticatedUser,
    contactId: string,
    dto: UpdateContactDto,
  ): Promise<Contact> {
    const policy = new AccessPolicy(user);
    const perimeter = contactPerimeter(policy, 'contact', 'write');
    const scoped = composeAnd(perimeter, { id: contactId, deletedAt: null });

    const { before, after } = await this.prisma.$transaction(async (tx) => {
      const before = await tx.contact.findFirst({ where: { AND: scoped } });

      if (!before) {
        throw AppException.notFound('CONTACT_NOT_FOUND', "Ce contact n'existe pas.");
      }

      const written = await tx.contact.updateMany({
        where: { AND: scoped },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          jobTitle: dto.jobTitle,
          isPrimary: dto.isPrimary,
          notes: dto.notes,
        },
      });

      if (written.count === 0) {
        throw AppException.notFound('CONTACT_NOT_FOUND', "Ce contact n'existe pas.");
      }

      if (dto.isPrimary === true) {
        // Le `clientId` est relu DANS LE PERIMETRE : la ligne vient d'etre
        // ecrite par cette transaction, elle est donc bien dans le perimetre du
        // porteur, et le nettoyage ne peut pas atteindre le contact principal
        // d'un autre dossier.
        await this.clearOtherPrimaries(tx, before.clientId, contactId);
      }

      const after = await tx.contact.findFirstOrThrow({ where: { AND: scoped } });
      return { before, after };
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'CONTACT_UPDATED',
      entityType: 'Contact',
      entityId: contactId,
      before: contactSnapshot(before),
      after: contactSnapshot(after),
    });

    return after;
  }

  async removeContact(user: AuthenticatedUser, contactId: string): Promise<{ deleted: true }> {
    const policy = new AccessPolicy(user);
    const perimeter = contactPerimeter(policy, 'contact', 'write');
    const scoped = composeAnd(perimeter, { id: contactId, deletedAt: null });

    const before = await this.prisma.contact.findFirst({ where: { AND: scoped } });

    if (!before) {
      throw AppException.notFound('CONTACT_NOT_FOUND', "Ce contact n'existe pas.");
    }

    // Suppression logique : `deletedAt` porte l'information, la ligne reste.
    await this.prisma.contact.updateMany({
      where: { AND: scoped },
      data: { deletedAt: new Date(), isPrimary: false },
    });

    await this.audit.record({
      actorId: policy.userId,
      action: 'CONTACT_DELETED',
      entityType: 'Contact',
      entityId: contactId,
      before: contactSnapshot(before),
    });

    return { deleted: true };
  }

  /**
   * Retire le drapeau « principal » aux autres contacts d'un client.
   *
   * Le schema annonce « un seul principal » et la base ne le contraint pas :
   * sans ce nettoyage dans la MEME transaction que la pose du drapeau, deux
   * interlocuteurs principaux cohabiteraient et le frontend devrait trancher.
   * `exceptId` protege le contact que l'on vient de designer.
   */
  private async clearOtherPrimaries(
    tx: Prisma.TransactionClient,
    clientId: string,
    exceptId: string | null,
  ): Promise<void> {
    await tx.contact.updateMany({
      where: {
        clientId,
        isPrimary: true,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { isPrimary: false },
    });
  }

  /**
   * Verifie que le responsable de compte designe existe vraiment.
   *
   * `accountManagerId` est une cle etrangere vers `users` : sans ce controle, un
   * identifiant errone remonterait en violation de contrainte, donc en 500, pour
   * ce qui n'est qu'une faute de saisie. Le porteur lui-meme n'est pas relu — il
   * vient du jeton, donc il existe.
   */
  private async assertKnownUser(
    tx: Prisma.TransactionClient,
    accountManagerId: string,
    actorId: string,
  ): Promise<string> {
    if (accountManagerId === actorId) {
      return accountManagerId;
    }

    const user = await tx.user.findUnique({
      where: { id: accountManagerId },
      select: { id: true },
    });

    if (!user) {
      throw AppException.unprocessable(
        'CLIENT_ACCOUNT_MANAGER_NOT_FOUND',
        "Le responsable de compte designe n'existe pas.",
        { accountManagerId },
      );
    }

    return accountManagerId;
  }

  // ---------------------------------------------------------------------------
  // Naissance d'un client par conversion d'un prospect
  // ---------------------------------------------------------------------------

  /**
   * Cree le dossier client d'un prospect converti, DANS LA TRANSACTION DE
   * L'APPELANT.
   *
   * Le `tx` est obligatoire et non optionnel : la conversion ecrit le client, le
   * contact, le lien sur le prospect, l'historique, l'activite et la
   * notification. Si l'une de ces ecritures echoue, aucune ne doit subsister —
   * un client sans prospect converti serait un dossier fantome, sans origine
   * connue.
   *
   * Ce n'est PAS une route : `POST /clients` sert la saisie manuelle, celle-ci
   * sert la chaine metier. Les deux passent par la meme numerotation et le meme
   * modele, mais seul le chemin de conversion ecrit `isPrimary` sur le contact
   * repris du prospect.
   */
  async createFromProspect(
    tx: Prisma.TransactionClient,
    input: ClientFromProspectInput,
  ): Promise<Client> {
    const reference = await this.counters.reference({ scope: 'CLIENT' }, tx);
    const contactName = input.contact
      ? `${input.contact.firstName} ${input.contact.lastName}`.trim()
      : '';

    const client = await tx.client.create({
      data: {
        reference,
        // `companyName` est obligatoire sur un client et facultatif sur un
        // prospect : sans repli, la conversion d'une personne physique
        // echouerait sur une colonne NOT NULL. Le nom du contact est le repli
        // naturel — c'est le meme dossier, vu d'une personne et non d'une
        // entreprise.
        companyName: input.companyName?.trim() || contactName || UNNAMED_COMPANY,
        sector: input.sector,
        website: input.website,
        accountManagerId: input.accountManagerId,
        status: ClientStatus.ACTIVE,
      },
    });

    if (input.contact) {
      await tx.contact.create({
        data: {
          clientId: client.id,
          firstName: input.contact.firstName,
          lastName: input.contact.lastName,
          email: input.contact.email,
          phone: input.contact.phone,
          jobTitle: input.contact.jobTitle,
          isPrimary: true,
        },
      });
    }

    return client;
  }
}
