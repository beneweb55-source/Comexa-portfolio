/// <reference types="multer" />
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  AccessPolicy,
  SCOPE_ANY,
  SCOPE_OWN,
  type AuthenticatedUser,
} from '../../common/auth/principal.js';
import { paginated, resolvePagination, type Paginated } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-error.js';
import {
  assertUploadSize,
  buildStorageKey,
  normalizeMimeType,
  sanitizeOriginalName,
} from '../../common/storage/storage.key.js';
import { STORAGE_CONFIG } from '../../common/storage/storage.module.js';
import {
  SIGNED_URL_TTL_SECONDS,
  STORAGE_DRIVER,
  isStreamingDriver,
  type StorageConfig,
  type StorageDriver,
} from '../../common/storage/storage.types.js';
import { ActivityType } from '../../generated/prisma/enums.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { DocumentVisibility } from '../../generated/prisma/enums.js';
import {
  resolveDocumentAccess,
  narrowVisibilities,
  type DocumentAccessScope,
} from './document-visibility.js';
import type {
  ListDocumentsQueryDto,
  UpdateDocumentDto,
  UploadDocumentDto,
} from './dto/documents.dto.js';

/**
 * SERVICE DES DOCUMENTS.
 *
 * DEUX EXIGENCES DU CLIENT SE JOUENT ICI, et nulle part ailleurs :
 *
 *  1. « ne pas stocker les fichiers binaires dans PostgreSQL - utiliser un
 *     stockage S3-compatible - PostgreSQL conserve uniquement les metadonnees
 *     et references des fichiers ». Les octets ne sont donc jamais ecrits en
 *     base : ils partent dans le pilote de stockage, et la ligne ne garde
 *     qu'une cle opaque, une taille et une empreinte. Aucune colonne `Bytes` ni
 *     `content` n'existe dans `documents` — c'est verifiable dans le schema.
 *
 *  2. « Le client ne doit pas voir les documents internes. » La regle vit dans
 *     `document-visibility.ts`, et CE service ne filtre jamais a la main : il
 *     demande la portee au module pur, puis l'applique. Un `where` ecrit
 *     directement ici serait un endroit de plus ou la regle peut diverger.
 *
 * ORDRE DES ECRITURES, ET POURQUOI.
 *
 * Un depot ecrit DEUX choses : un objet dans le stockage, une ligne en base. Il
 * n'y a pas de transaction commune aux deux — un objet S3 n'a pas de rollback.
 * L'ordre est donc choisi pour que la panne la moins grave soit la seule
 * possible :
 *
 *  - a l'envoi, l'objet est ecrit AVANT la ligne. Si la ligne echoue ensuite, on
 *    supprime l'objet (action compensatoire) ; s'il reste, c'est un orphelin
 *    invisible, qui ne coute que du stockage. L'ordre inverse laisserait une
 *    ligne pointant vers un fichier absent, c'est-a-dire une entree de
 *    bibliotheque qui ment et un telechargement qui echoue ;
 *
 *  - a la suppression, la ligne est marquee AVANT l'objet. Une ligne perdue est
 *    irrecuperable ; un objet orphelin se nettoie. Si l'effacement de l'objet
 *    echoue, la ligne reste supprimee et l'incident est journalise — voir
 *    `remove`.
 */

/**
 * Ce qui sort de l'API pour un document.
 *
 * `storageKey` et `storageDriver` n'y figurent PAS, et c'est deliberé. La cle
 * n'est pas un secret, mais elle decrit l'arborescence du bucket (prefixe,
 * annee, mois) et n'a aucune utilité pour un appelant : la telecharger passe par
 * `/documents/:id/download`, qui verifie les droits AVANT de signer. La donner
 * inviterait a construire des URL a la main en contournant ce controle.
 */
export interface DocumentView {
  readonly id: string;
  readonly name: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksum: string | null;
  readonly category: string;
  readonly visibility: DocumentVisibility;
  readonly version: number;
  readonly clientId: string | null;
  readonly projectId: string | null;
  readonly taskId: string | null;
  readonly uploadedById: string | null;
  readonly expiresAt: Date | null;
  readonly signedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * La vue PLUS la cle de stockage.
 *
 * Type INTERNE au service, et c'est le point : seules `remove`, `downloadUrl` et
 * `content` en ont besoin, parce qu'elles parlent au stockage. Ces trois
 * methodes ne renvoient jamais cet objet — elles en extraient un nom de fichier,
 * un type MIME, une taille — donc la cle ne peut pas atteindre une reponse JSON
 * sans que quelqu'un l'ecrive explicitement. La mettre dans `DocumentView`
 * aurait au contraire place un champ interne dans le type que TOUTES les routes
 * renvoient, a un `return` de distance d'une fuite.
 */
interface StoredDocument extends DocumentView {
  readonly storageKey: string;
}

/** Champs necessaires a la construction d'une vue. Sous-ensemble du modele. */
const DOCUMENT_VIEW_FIELDS = {
  id: true,
  name: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  checksum: true,
  category: true,
  visibility: true,
  version: true,
  clientId: true,
  projectId: true,
  taskId: true,
  uploadedById: true,
  expiresAt: true,
  signedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Les memes, plus la cle : reserve aux operations qui touchent le stockage. */
const DOCUMENT_STORED_FIELDS = { ...DOCUMENT_VIEW_FIELDS, storageKey: true } as const;

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(STORAGE_CONFIG) private readonly storageConfig: StorageConfig,
  ) {}

  /**
   * Depose un document.
   *
   * Le fichier est deja en memoire quand cette methode s'execute : le
   * `FileInterceptor` du controleur l'a bufferise, avec une limite de taille qui
   * protege la RAM du serveur. La verification de taille ici n'est pas
   * redondante — elle applique la borne CONFIGUREE (`MAX_UPLOAD_BYTES`), qui
   * peut etre plus basse que la limite de transport, et elle rend une erreur du
   * domaine (`PAYLOAD_TOO_LARGE`, avec la limite en details) plutot que l'erreur
   * generique de multer.
   */
  async upload(
    user: AuthenticatedUser,
    file: Express.Multer.File | undefined,
    dto: UploadDocumentDto,
  ): Promise<DocumentView> {
    const policy = new AccessPolicy(user);

    // Defense en profondeur, avant meme de regarder les permissions. Le role
    // CLIENT ne detient aucune permission `document:write:*` dans le catalogue,
    // donc le garde l'arrete deja ; mais la garantie « le client ne depose pas
    // dans la bibliotheque interne » ne doit pas dependre d'une ligne du
    // catalogue, qui peut changer. Meme raisonnement que pour la lecture.
    if (policy.isClient()) {
      throw AppException.forbidden(
        'Un compte client ne depose pas de document dans la bibliotheque.',
      );
    }

    const scope = policy.requireScope('document', 'write', [SCOPE_ANY, SCOPE_OWN]);

    if (!file) {
      throw AppException.badRequest('FILE_REQUIRED', 'Aucun fichier recu.');
    }

    if (!file.buffer || file.buffer.length === 0) {
      throw AppException.badRequest(
        'EMPTY_FILE',
        "Le fichier recu est vide. Un fichier de zero octet ne s'ouvre pas et n'a pas de contenu a conserver.",
      );
    }

    assertUploadSize(file.size, this.storageConfig.maxUploadBytes);

    // `buildStorageKey` valide le type MIME au passage : un type hors liste
    // leve ici, avant toute ecriture. C'est le seul point ou le client pourrait
    // influencer la cle, et il n'influence que l'EXTENSION, choisie dans une
    // table fermee.
    const storageKey = buildStorageKey('documents', file.mimetype);

    const attachments = await this.resolveAttachments(user, scope, dto);
    const originalName = sanitizeOriginalName(file.originalname);
    const mimeType = normalizeMimeType(file.mimetype);

    // Ecriture de l'objet AVANT la ligne. Voir l'entete du fichier.
    await this.storage.put(storageKey, file.buffer, mimeType);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.document.create({
          data: {
            name: dto.name ?? originalName,
            originalName,
            mimeType,
            sizeBytes: file.size,
            checksum: createHash('sha256').update(file.buffer).digest('hex'),
            // Le pilote est enregistre avec la ligne : le jour ou l'on change
            // de stockage, les anciens documents restent lisibles par l'ancien
            // pilote, et une reprise de donnees sait ou chercher chaque objet.
            storageDriver: this.storage.kind,
            storageKey,
            category: dto.category,
            visibility: dto.visibility ?? DocumentVisibility.INTERNAL,
            uploadedById: user.id,
            ...attachments,
          },
          select: DOCUMENT_VIEW_FIELDS,
        });

        // `isClientVisible` suit la visibilite du document : une entree
        // « fichier depose » sur un document interne n'a rien a faire dans le
        // fil du client. Le defaut de `ActivityInput` est `false`, donc l'oubli
        // penche du bon cote ; on l'ecrit quand meme explicitement pour que la
        // regle soit lisible ici.
        await this.activity.record(
          {
            type: ActivityType.FILE_UPLOADED,
            message: `Document depose : ${created.name}`,
            projectId: attachments.projectId ?? null,
            taskId: attachments.taskId ?? null,
            clientId: attachments.clientId ?? null,
            actorId: user.id,
            metadata: { documentId: created.id, category: created.category },
            isClientVisible: created.visibility !== DocumentVisibility.INTERNAL,
          },
          tx,
        );

        return created;
      });
    } catch (error) {
      // Compensation : la ligne n'existe pas, l'objet ne doit pas rester. Un
      // objet sans ligne est introuvable depuis l'application — il occupe le
      // bucket sans que rien ne le reference, et rien ne permet de savoir s'il
      // faut le supprimer. On le retire donc tout de suite.
      await this.deleteObjectQuietly(storageKey, 'compensation apres echec de creation');
      throw error;
    }
  }

  /**
   * Liste les documents lisibles par le porteur.
   *
   * Les filtres de la requete RESTREIGNENT la liste autorisee, ils ne
   * l'elargissent jamais : `narrowVisibilities` refuse une visibilite hors de ce
   * que le porteur peut lire, et le filtre de portee est ajoute APRES, sans
   * possibilité de le retirer par un parametre.
   */
  async list(
    user: AuthenticatedUser,
    query: ListDocumentsQueryDto,
  ): Promise<Paginated<DocumentView>> {
    const access = this.accessFor(user);
    const where = this.readWhere(user, access, query);
    const pagination = resolvePagination(query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        select: DOCUMENT_VIEW_FIELDS,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.document.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  /** Un document precis, s'il est dans la portee du porteur. */
  async findOne(user: AuthenticatedUser, id: string): Promise<DocumentView> {
    return this.requireReadable(user, id);
  }

  /**
   * Modifie la metadonnee d'un document.
   *
   * Le fichier lui-meme n'est pas modifiable : remplacer un contenu se fait par
   * un nouvel envoi, qui portera sa propre version. Reecrire l'objet sous la
   * meme cle priverait de toute trace ce qu'un client a telecharge la veille.
   */
  async update(user: AuthenticatedUser, id: string, dto: UpdateDocumentDto): Promise<DocumentView> {
    const policy = new AccessPolicy(user);
    policy.requireScope('document', 'write', [SCOPE_ANY, SCOPE_OWN]);

    const existing = await this.requireReadable(user, id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.update({
        where: { id },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.category === undefined ? {} : { category: dto.category }),
          ...(dto.visibility === undefined ? {} : { visibility: dto.visibility }),
        },
        select: DOCUMENT_VIEW_FIELDS,
      });

      // Une entree d'activite par changement REELLEMENT applique. Comparer avant
      // d'ecrire evite un fil pollue par des « modification » qui n'ont rien
      // change — un PATCH idempotent n'est pas un evenement.
      const visibilityChanged = document.visibility !== existing.visibility;
      const nameChanged = document.name !== existing.name;

      if (visibilityChanged || nameChanged) {
        await this.activity.record(
          {
            type: visibilityChanged ? ActivityType.STATUS_CHANGE : ActivityType.NOTE,
            message: visibilityChanged
              ? `Visibilite du document « ${document.name} » : ${existing.visibility} vers ${document.visibility}`
              : `Document renomme : « ${existing.name} » devient « ${document.name} »`,
            projectId: document.projectId,
            taskId: document.taskId,
            clientId: document.clientId,
            actorId: user.id,
            metadata: visibilityChanged
              ? { documentId: document.id, from: existing.visibility, to: document.visibility }
              : { documentId: document.id },
            isClientVisible: document.visibility !== DocumentVisibility.INTERNAL,
          },
          tx,
        );
      }

      return document;
    });

    // Un document qui VIENT d'etre partage merite une trace plus visible qu'une
    // ligne de fil : c'est l'action qui expose un fichier a un client. Le code
    // passe par `System` — le meme canal que les alertes de service — et reste
    // invisible au client, qui n'a pas a lire les journaux internes.
    if (
      existing.visibility === DocumentVisibility.INTERNAL &&
      updated.visibility !== DocumentVisibility.INTERNAL
    ) {
      this.logger.log(
        `Document ${updated.id} partage avec le client ${updated.clientId ?? 'non rattache'} ` +
          `(visibilite ${updated.visibility}) par l'utilisateur ${user.id}`,
      );
    }

    return updated;
  }

  /**
   * Supprime un document : la ligne d'abord, l'objet ensuite.
   *
   * SUPPRESSION DOUCE, et ce n'est pas un choix de confort. `Payment.proofDocumentId`
   * pointe un document avec `onDelete: SetNull` : une suppression physique
   * detacherait silencieusement la justification d'un paiement deja enregistre,
   * et le rapprochement bancaire perdrait sa piece. Le meme mecanisme protege
   * les rapports et les pieces jointes de messages. La ligne reste donc en base
   * comme borne, et c'est l'OBJET qui disparait — ce qui satisfait l'exigence
   * « PostgreSQL conserve uniquement les metadonnees et references ».
   *
   * L'echec de l'effacement de l'objet NE FAIT PAS ECHOUER la requete. Du point
   * de vue de l'utilisateur, le document est supprime : il a disparu de toutes
   * les listes. Rendre une erreur le pousserait a recommencer, ce qui n'aurait
   * aucun effet sur l'objet reste dans le bucket. L'incident est journalise et
   * trace dans le fil d'activite pour qu'un objet orphelin soit identifiable —
   * c'est la seule chose qui manquerait sinon, et un orphelin qu'on ne sait pas
   * nommer ne se nettoie jamais.
   */
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const policy = new AccessPolicy(user);
    policy.requireScope('document', 'delete', [SCOPE_ANY]);

    const document = await this.requireStored(user, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id }, data: { deletedAt: new Date() } });

      await this.activity.record(
        {
          type: ActivityType.STATUS_CHANGE,
          message: `Document supprime : ${document.name}`,
          projectId: document.projectId,
          taskId: document.taskId,
          clientId: document.clientId,
          actorId: user.id,
          metadata: { documentId: document.id },
          isClientVisible: false,
        },
        tx,
      );
    });

    await this.deleteObjectQuietly(document.storageKey, 'suppression', {
      documentId: document.id,
      actorId: user.id,
    });
  }

  /**
   * URL de telechargement signee.
   *
   * Le controle de droits a lieu AVANT la signature : c'est tout l'interet de
   * passer par l'API plutot que de distribuer des URL. Une URL signee vaut
   * autorisation pour sa duree de vie ; la delivrer sans verifier reviendrait a
   * ouvrir le document a qui la demande.
   */
  async downloadUrl(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ url: string; expiresInSeconds: number; fileName: string }> {
    const document = await this.requireStored(user, id);

    if (!this.storage.supportsSignedUrl) {
      // Erreur d'exploitation, pas erreur d'utilisation : le pilote configure
      // ne sait pas signer. Le message dit quoi faire, parce que celui qui le
      // lit est l'administrateur du serveur, pas l'appelant.
      throw AppException.unprocessable(
        'STORAGE_SIGNED_URL_UNSUPPORTED',
        "Le stockage configure ne produit pas d'URL signee. Utiliser GET /api/documents/:id/content, ou configurer STORAGE_DRIVER=s3.",
      );
    }

    const url = await this.storage.getSignedUrl(document.storageKey, SIGNED_URL_TTL_SECONDS);

    return { url, expiresInSeconds: SIGNED_URL_TTL_SECONDS, fileName: document.originalName };
  }

  /**
   * Sert le contenu en flux.
   *
   * Deux usages, et un seul contrat : le developpement, ou le pilote local ne
   * signe rien, et le cas ou l'appelant veut telecharger sans dependre d'un
   * stockage joignable depuis son navigateur. Le flux evite de charger le
   * fichier entier en memoire, ce qui compte pour un PDF de plusieurs dizaines
   * de Mo.
   *
   * Le controle de droits est identique a celui de `downloadUrl` : une seule
   * porte, deux sorties.
   */
  async content(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ stream: Readable; fileName: string; mimeType: string; sizeBytes: number }> {
    const document = await this.requireStored(user, id);

    if (!isStreamingDriver(this.storage)) {
      throw AppException.unprocessable(
        'STORAGE_STREAM_UNSUPPORTED',
        'Ce pilote de stockage ne sait pas servir de flux. Utiliser GET /api/documents/:id/download.',
      );
    }

    const stream = await this.storage.readStream(document.storageKey);

    // On ne rend que ce dont l'appelant a besoin pour poser ses en-tetes, et pas
    // la ligne entiere : la cle de stockage reste a l'interieur du service.
    return {
      stream,
      fileName: document.originalName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
    };
  }

  // ---------------------------------------------------------------------------
  // Resolution des droits et des rattachements
  // ---------------------------------------------------------------------------

  /** La portee de lecture du porteur, decidee par le module pur. */
  private accessFor(user: AuthenticatedUser): DocumentAccessScope {
    return resolveDocumentAccess({
      isClient: new AccessPolicy(user).isClient(),
      clientId: user.clientId,
      permissions: user.permissions,
    });
  }

  /**
   * Le `where` de lecture, construit en UN seul endroit.
   *
   * `AND` de clauses plutot qu'un objet fusionne : avec une fusion, une cle
   * ecrite deux fois — `clientId` par le filtre de portee puis par le filtre de
   * requete — verrait la seconde ecraser la premiere. C'est exactement ainsi
   * qu'un porteur client obtiendrait les documents d'un autre en ajoutant un
   * parametre a l'URL.
   */
  private readWhere(
    user: AuthenticatedUser,
    access: DocumentAccessScope,
    query: ListDocumentsQueryDto,
  ): Prisma.DocumentWhereInput {
    const visibilities = narrowVisibilities(access.visibilities, query.visibility);
    const clauses: Prisma.DocumentWhereInput[] = [
      { deletedAt: null },
      { visibility: { in: [...visibilities] } },
    ];

    if (access.scope === 'client') {
      // Force, jamais lu depuis la requete : un porteur client est borne a SON
      // dossier, quel que soit `?clientId=` dans l'URL.
      clauses.push({ clientId: access.clientId });
    } else if (access.scope === 'own') {
      clauses.push(this.ownScopeFilter(user.id));
    }

    if (query.category) clauses.push({ category: query.category });
    if (query.projectId) clauses.push({ projectId: query.projectId });
    if (query.taskId) clauses.push({ taskId: query.taskId });

    // Le filtre `clientId` de la requete n'est applique qu'aux porteurs internes
    // assez larges pour le demander : pour un porteur borne a son dossier, il
    // contredirait le filtre force ci-dessus, et on ne veut pas d'un parametre
    // capable d'annuler une restriction.
    if (query.clientId && access.scope !== 'client') {
      clauses.push({ clientId: query.clientId });
    }

    if (query.search) {
      clauses.push({
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { originalName: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    if (!query.includeExpired) {
      // Un document perime reste en base mais sort des listes : le conserver
      // sert a l'audit, l'afficher ferait croire qu'il est encore valable.
      const now = new Date();
      clauses.push({ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] });
    }

    return { AND: clauses };
  }

  /**
   * Ce que « ses projets » veut dire pour un document.
   *
   * Trois cas, et le troisieme est celui qu'on oublie : le document depose par
   * le porteur lui-meme, ceux des projets qu'il pilote, et ceux des projets ou
   * il est membre actif (`leftAt: null` — un membre retire du projet ne doit
   * plus voir ce qui s'y depose ensuite).
   */
  private ownScopeFilter(userId: string): Prisma.DocumentWhereInput {
    return {
      OR: [
        { uploadedById: userId },
        {
          project: {
            OR: [{ managerId: userId }, { members: { some: { userId, leftAt: null } } }],
          },
        },
      ],
    };
  }

  /**
   * Le document, ou un refus.
   *
   * On repond `NOT_FOUND` et non `FORBIDDEN` quand la ligne existe mais sort de
   * la portee. La difference est volontaire : un 403 confirmerait l'existence du
   * document, et permettrait a un porteur client de balayer des identifiants
   * pour decouvrir quels dossiers sont actifs. Un 404 ne dit rien.
   */
  private async requireReadable(user: AuthenticatedUser, id: string): Promise<DocumentView> {
    return this.findReadable(user, id, DOCUMENT_VIEW_FIELDS);
  }

  /**
   * Le document AVEC sa cle de stockage, pour les operations qui touchent
   * l'objet. Meme filtre d'acces, meme refus : la porte est la meme, seule la
   * projection differe.
   */
  private async requireStored(user: AuthenticatedUser, id: string): Promise<StoredDocument> {
    return this.findReadable(user, id, DOCUMENT_STORED_FIELDS);
  }

  /**
   * Le document, ou un refus.
   *
   * On repond `NOT_FOUND` et non `FORBIDDEN` quand la ligne existe mais sort de
   * la portee. La difference est volontaire : un 403 confirmerait l'existence du
   * document, et permettrait a un porteur client de balayer des identifiants
   * pour decouvrir quels dossiers sont actifs. Un 404 ne dit rien.
   */
  private async findReadable<T extends Prisma.DocumentSelect>(
    user: AuthenticatedUser,
    id: string,
    select: T,
  ): Promise<Prisma.DocumentGetPayload<{ select: T }>> {
    const access = this.accessFor(user);
    const where: Prisma.DocumentWhereInput = {
      AND: [this.readWhere(user, access, {}), { id }],
    };

    const document = await this.prisma.document.findFirst({ where, select });

    if (!document) {
      throw AppException.notFound('DOCUMENT_NOT_FOUND', 'Document introuvable.');
    }

    return document;
  }

  /**
   * Deduit les rattachements du document, et verifie qu'ils sont legitimes.
   *
   * DEUX CHOSES S'Y JOUENT.
   *
   * 1. Coherence. Un document rattache a une tache mais pas a un projet
   *    n'apparaitrait dans aucune liste de projet, et le filtre client ne
   *    saurait pas le rattacher. On complete donc : tache -> projet ->
   *    clientId. `Client` est obligatoire sur un projet, donc la chaine aboutit
   *    toujours. Le `clientId` ainsi derive est ce qui rend le document visible
   *    au bon client sans que personne ait a y penser au depot.
   *
   * 2. Portee. Un porteur `own` ne depose que sur les projets ou il travaille.
   *    Sans ce controle, `document:write:own` suffirait a deposer un fichier sur
   *    n'importe quel projet en devinant son identifiant — une ecriture
   *    horizontale, exactement ce que le scope est cense empecher.
   */
  private async resolveAttachments(
    user: AuthenticatedUser,
    scope: string,
    dto: UploadDocumentDto,
  ): Promise<{ clientId: string | null; projectId: string | null; taskId: string | null }> {
    let projectId = dto.projectId ?? null;
    const taskId = dto.taskId ?? null;

    if (taskId) {
      const task = await this.prisma.task.findFirst({
        where: { id: taskId, deletedAt: null },
        select: { id: true, projectId: true },
      });

      if (!task) {
        throw AppException.notFound('TASK_NOT_FOUND', 'Tache introuvable.');
      }

      if (projectId && projectId !== task.projectId) {
        throw AppException.unprocessable(
          'DOCUMENT_ATTACHMENT_MISMATCH',
          "La tache indiquee n'appartient pas au projet indique.",
        );
      }

      projectId = task.projectId;
    }

    if (!projectId) {
      // Document rattache au client sans projet (un contrat cadre, par
      // exemple) : le client doit exister, et un porteur `own` n'a pas de
      // projet sur lequel s'appuyer — on exige donc un projet pour lui.
      if (!dto.clientId) {
        if (scope === SCOPE_OWN) {
          throw AppException.unprocessable(
            'DOCUMENT_ATTACHMENT_REQUIRED',
            'Un document doit etre rattache a un projet ou a un client.',
          );
        }
        return { clientId: null, projectId: null, taskId };
      }

      const client = await this.prisma.client.findFirst({
        where: { id: dto.clientId, deletedAt: null },
        select: { id: true },
      });

      if (!client) {
        throw AppException.notFound('CLIENT_NOT_FOUND', 'Dossier client introuvable.');
      }

      return { clientId: client.id, projectId: null, taskId };
    }

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true, clientId: true, managerId: true },
    });

    if (!project) {
      throw AppException.notFound('PROJECT_NOT_FOUND', 'Projet introuvable.');
    }

    if (dto.clientId && dto.clientId !== project.clientId) {
      throw AppException.unprocessable(
        'DOCUMENT_ATTACHMENT_MISMATCH',
        'Le client indique ne correspond pas a celui du projet.',
      );
    }

    if (scope === SCOPE_OWN) {
      await this.assertWorksOnProject(projectId, user.id);
    }

    // Le clientId vient du PROJET, jamais du corps de la requete lorsqu'un
    // projet est fourni. Sinon un appelant pourrait ranger un document de son
    // projet dans le dossier d'un autre client, et le porter au catalogue de
    // ce client.
    return { clientId: project.clientId, projectId: project.id, taskId };
  }

  /** Le porteur travaille-t-il sur ce projet ? */
  private async assertWorksOnProject(projectId: string, userId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null,
        OR: [{ managerId: userId }, { members: { some: { userId, leftAt: null } } }],
      },
      select: { id: true },
    });

    if (!project) {
      throw AppException.forbidden('Vous ne travaillez pas sur ce projet.');
    }
  }

  /**
   * Efface un objet sans faire echouer l'appelant.
   *
   * Le stockage est un systeme distant : il peut etre injoignable alors que la
   * base repond. Une ecriture en base qui a reussi ne doit pas etre presentee
   * comme un echec parce que le nettoyage d'un objet n'a pas abouti — l'appelant
   * recommencerait, et la ligne serait creee une seconde fois.
   */
  private async deleteObjectQuietly(
    key: string,
    raison: string,
    trace?: { documentId: string; actorId: string },
  ): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.error(
        `Objet de stockage non efface (${raison}). Un objet orphelin occupe le bucket ` +
          `sans reference en base. Detail : ${error instanceof Error ? error.message : String(error)}`,
      );

      if (trace) {
        // Trace en base : c'est la seule maniere de retrouver l'orphelin plus
        // tard. Un journal de serveur se fait tourner ; une ligne d'activite
        // reste.
        try {
          await this.activity.record({
            type: ActivityType.SYSTEM,
            message: `Objet de stockage orphelin apres suppression du document ${trace.documentId}.`,
            clientId: null,
            actorId: trace.actorId,
            metadata: { orphaned: true, documentId: trace.documentId, raison },
            isClientVisible: false,
          });
        } catch (activityError) {
          this.logger.error(
            `Impossible de tracer l'objet orphelin : ${
              activityError instanceof Error ? activityError.message : String(activityError)
            }`,
          );
        }
      }
    }
  }
}
