import { Injectable } from '@nestjs/common';
import {
  type PaginationQueryDto,
  paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto.js';
import type { Paginated } from '../../common/interceptors/transform.interceptor.js';
import type { Activity, Prisma } from '../../generated/prisma/client.js';
import type { ActivityType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * LE FIL D'ACTIVITE — ecrit par plusieurs modules, lu par le projet et l'espace
 * client.
 *
 * Ce service est volontairement extrait de `ProjectsModule`. Trois domaines
 * distincts alimentent ce fil : la conversion d'un prospect (CRM), la vie d'un
 * projet (taches, jalons, temps), et l'acceptation d'un devis (facturation). Si
 * chacun ecrivait sa propre ligne `prisma.activity.create`, deux derives
 * apparaitraient rapidement :
 *
 *   1. `isClientVisible` serait tantot `true` tantot `false` selon l'auteur du
 *      code, et une note interne finirait par s'afficher dans l'espace client ;
 *   2. certains ecrits passeraient hors transaction, laissant un fil d'activite
 *      qui raconte un changement qui n'a pas eu lieu — ou l'inverse.
 *
 * D'ou le second parametre `tx` : un ecrit d'activite doit pouvoir rejoindre la
 * transaction qui a produit le fait qu'il decrit.
 */

/** Client Prisma ou transaction en cours. Les deux exposent les memes delegues. */
export type ActivityDb = Prisma.TransactionClient | PrismaService;

export interface ActivityInput {
  type: ActivityType;
  /** Texte affiche dans le fil. Jamais de secret : ce champ peut sortir au client. */
  message: string;
  projectId?: string | null;
  taskId?: string | null;
  clientId?: string | null;
  /** `null` pour une action systeme (tache planifiee, migration). */
  actorId?: string | null;
  /** Ancien/nouveau statut, nom de fichier... Stocke tel quel dans `metadata`. */
  metadata?: Prisma.InputJsonValue;
  /**
   * Par defaut `false` — donc invisible au client.
   *
   * Le defaut va dans le sens de la securite : oublier ce champ cache l'entree
   * au client, au pire il manque une information. Le defaut inverse ferait
   * fuiter une note interne des le premier oubli, et une fuite ne se rattrape
   * pas.
   */
  isClientVisible?: boolean;
}

export interface ActivityFilter {
  projectId?: string;
  clientId?: string;
  taskId?: string;
  actorId?: string;
  type?: ActivityType;
  /**
   * Restreint aux entrees visibles par le client.
   *
   * Force a `true` pour l'espace client, quelle que soit la demande de
   * l'appelant — voir `listForProject`.
   */
  clientVisibleOnly?: boolean;
}

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ajoute une entree au fil.
   *
   * `tx` est un SECOND parametre positionnel, pas une option dans l'objet : il
   * est ainsi impossible d'ecrire l'appel sans voir qu'on a choisi — ou non — de
   * rejoindre une transaction.
   */
  async record(input: ActivityInput, tx?: Prisma.TransactionClient): Promise<Activity> {
    const db: ActivityDb = tx ?? this.prisma;

    return db.activity.create({
      data: {
        type: input.type,
        message: input.message,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        clientId: input.clientId ?? null,
        actorId: input.actorId ?? null,
        // Etalement conditionnel : passer `metadata: undefined` laisse Prisma
        // ecrire `DbNull`, alors qu'omettre la cle ecrit bien `NULL` sans
        // toucher a la colonne. `null` et `JsonNull` sont deux choses
        // differentes en JSON, et Prisma refuse l'ambiguite.
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        isClientVisible: input.isClientVisible ?? false,
      },
    });
  }

  /**
   * Enregistre plusieurs entrees d'un coup (import, tache planifiee).
   *
   * Une seule requete au lieu de N : sur un import de cinquante lignes, la
   * difference est celle entre une transaction et cinquante allers-retours.
   */
  async recordMany(
    inputs: readonly ActivityInput[],
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }

    const db: ActivityDb = tx ?? this.prisma;
    const result = await db.activity.createMany({
      data: inputs.map((input) => ({
        type: input.type,
        message: input.message,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        clientId: input.clientId ?? null,
        actorId: input.actorId ?? null,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        isClientVisible: input.isClientVisible ?? false,
      })),
    });

    return result.count;
  }

  /**
   * Le fil d'un projet, du plus recent au plus ancien.
   *
   * `asClient` force le filtre de visibilite cote SERVEUR. Le controle n'est pas
   * laisse a l'appelant : une route qui oublierait de le passer servirait les
   * notes internes a un compte client, et ce genre d'oubli ne se voit pas dans
   * une revue de code.
   */
  async listForProject(
    projectId: string,
    query?: PaginationQueryDto,
    options?: { asClient?: boolean },
  ): Promise<Paginated<Activity>> {
    return this.list({ projectId, clientVisibleOnly: options?.asClient }, query);
  }

  /** Le fil d'un client (espace client). Toujours filtre sur la visibilite. */
  async listForClient(clientId: string, query?: PaginationQueryDto): Promise<Paginated<Activity>> {
    return this.list({ clientId, clientVisibleOnly: true }, query);
  }

  async list(
    filter: ActivityFilter,
    query?: PaginationQueryDto,
    tx?: Prisma.TransactionClient,
  ): Promise<Paginated<Activity>> {
    const p = resolvePagination(query);
    const where = this.buildWhere(filter);

    const read = (db: ActivityDb) =>
      db.activity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        include: {
          actor: { select: { id: true, firstName: true, lastName: true } },
        },
      });

    // Deux chemins, et la distinction n'est pas cosmetique.
    //
    // HORS transaction : `$transaction` sur un tableau fait partir les deux
    // requetes dans la meme transaction PostgreSQL, donc sur le meme instantane.
    // Les enchainer laisserait une fenetre ou une entree s'insere entre le
    // comptage et la lecture : `total` ne correspondrait plus a `items`, et le
    // frontend afficherait des pages vides a la fin de la liste.
    //
    // DANS une transaction appelee par l'appelant : on ne peut PAS ouvrir de
    // transaction imbriquee ici — `Prisma.TransactionClient` est precisement le
    // client prive de `$transaction`, c'est la garantie que le typage donne pour
    // empecher l'imbrication. C'est sans consequence : la transaction
    // environnante a deja un instantane coherent, donc l'enchaine est sur.
    if (tx) {
      const [items, total] = await Promise.all([read(tx), tx.activity.count({ where })]);
      return paginated(items, total, p);
    }

    const [items, total] = await this.prisma.$transaction([
      read(this.prisma),
      this.prisma.activity.count({ where }),
    ]);

    return paginated(items, total, p);
  }

  private buildWhere(filter: ActivityFilter): Prisma.ActivityWhereInput {
    const where: Prisma.ActivityWhereInput = {};

    if (filter.projectId) where.projectId = filter.projectId;
    if (filter.clientId) where.clientId = filter.clientId;
    if (filter.taskId) where.taskId = filter.taskId;
    if (filter.actorId) where.actorId = filter.actorId;
    if (filter.type) where.type = filter.type;
    if (filter.clientVisibleOnly) where.isClientVisible = true;

    return where;
  }
}
