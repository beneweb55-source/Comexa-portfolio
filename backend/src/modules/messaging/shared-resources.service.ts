import { Injectable, Logger } from '@nestjs/common';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PROJECT_READ_ORDER, projectScopeWhere, subjectOf } from '../projects/project-scope.js';
import { taskReadWhereFor } from '../tasks/task-rules.js';
import { clientPerimeter as clientTablePerimeter } from '../clients/client-scope.js';
import { clientPerimeter as billingPerimeter } from '../invoices/billing-access.js';
import { DocumentsService } from '../documents/documents.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  availableCard,
  cardFromClient,
  cardFromDocument,
  cardFromInvoice,
  cardFromPayment,
  cardFromProject,
  cardFromQuote,
  cardFromTask,
  sharedResourceKey,
  unavailableCard,
  type ResourceCardView,
  type SharedResourceRef,
} from './shared-resource-card.js';

/**
 * RESSOURCES PARTAGEES — lecture a la demande, dans le perimetre du LECTEUR.
 *
 * LE PRINCIPE, EN UNE PHRASE : une carte ne montre jamais plus que ce que la
 * page dashboard de la ressource montrerait au MEME porteur. La carte est une
 * VITRE, pas une COPIE : elle n'a pas de cache partage entre les membres, pas
 * de snapshot restitue aux non-autorises, pas de chemin de contournement.
 *
 * POURQUOI RESOLUTION EN DIRECT PLUTOT QUE SNAPSHOT. Le partage stocke un
 * snapshot de titre pour l'audit, mais l'affichage relit la ressource :
 *
 *  - le titre et le statut restent JUSTES apres un renommage ou un changement
 *    d'etat — c'est la garantie demandee : la reference vaut par son
 *    identifiant interne, pas par une copie de texte ;
 *  - un membre qui PERD l'acces a un projet ne continue pas a le lire par
 *    l'historique du chat ;
 *  - une ressource supprimee devient une carte muette, pas un lien mort.
 *
 * LES PERIMETRES SONT CEUX DES SERVICES, PAS DES COPIES APPROXIMATIVES :
 * `projectScopeWhere`, `taskReadWhereFor`, `clientPerimeter` (table et pieces
 * comptables), et pour les documents le service lui-meme, dont la visibilite
 * depend de requetes en base. Recoudre ces regles ici les desynchroniserait a
 * bas bruit ; chaque chemin d'acces est donc reutilise ou delegue.
 *
 * `resolveOne` ne leve JAMAIS : introuvable, supprime, hors perimetre, droit
 * insuffisant — tout devient `available: false`. C'est a dessein : distinguer
 * « n'existe pas » de « existe sans vous etre accessible » par le statut HTTP
 * serait une oracle d'enumeration gratuit pour n'importe quel compte authentifie.
 */

@Injectable()
export class SharedResourcesService {
  private readonly logger = new Logger(SharedResourcesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  /**
   * Cartes pour une liste de references, dans l'ordre recu, une par cle.
   *
   * Les references sont deja dedoublees par `send` (la base l'interdit) ; ici le
   * cache `Map` protege surtout du client qui enverrait dix fois le meme
   * projet : une lecture, dix cartes.
   */
  async resolveAll(
    user: AuthenticatedUser,
    refs: readonly SharedResourceRef[],
  ): Promise<ResourceCardView[]> {
    const unique = new Map<string, SharedResourceRef>();
    for (const ref of refs) {
      if (!unique.has(sharedResourceKey(ref))) unique.set(sharedResourceKey(ref), ref);
    }

    const cards = await Promise.all([...unique.values()].map((ref) => this.resolveOne(user, ref)));

    const byKey = new Map<string, ResourceCardView>();
    [...unique.keys()].forEach((key, index) => byKey.set(key, cards[index]));

    return refs.map((ref) => byKey.get(sharedResourceKey(ref)) ?? unavailableCard(ref));
  }

  /** Une carte, ou la carte muette. Ne leve jamais. */
  async resolveOne(user: AuthenticatedUser, ref: SharedResourceRef): Promise<ResourceCardView> {
    try {
      const card = await this.load(new AccessPolicy(user), user, ref);
      return card ?? unavailableCard(ref);
    } catch (caught) {
      // Un perimetre refuse est une exception attendue (le garde des services
      // clients leve 403 sur le seul chemin « own sans dossier ») : elle
      // rejoint la file des cartes muettes, mais se signale dans le journal —
      // un incident de base ne doit pas se deguiser en droit insuffisant.
      if (!(caught instanceof AppException)) {
        this.logger.error(
          `Résolution de ressource ${sharedResourceKey(ref)} en échec`,
          (caught as Error)?.stack,
        );
      }
      return unavailableCard(ref);
    }
  }

  private async load(
    policy: AccessPolicy,
    user: AuthenticatedUser,
    ref: SharedResourceRef,
  ): Promise<ResourceCardView | null> {
    switch (ref.resourceType) {
      case 'PROJECT':
        return this.project(policy, ref);
      case 'TASK':
        return this.task(policy, ref);
      case 'CLIENT':
        return this.client(policy, ref);
      case 'QUOTE':
        return this.quote(policy, ref);
      case 'INVOICE':
        return this.invoice(policy, ref);
      case 'PAYMENT':
        return this.payment(policy, ref);
      case 'DOCUMENT':
        return this.document(user, ref);
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Chargeurs par type — chacun reproduit LE FILTRE DE LECTURE de son module,
  // ligne a ligne, et ne selectionne que les champs cités par la carte.
  // ---------------------------------------------------------------------------

  private async project(
    policy: AccessPolicy,
    ref: SharedResourceRef,
  ): Promise<ResourceCardView | null> {
    const scope = policy.widestScope('project', 'read', PROJECT_READ_ORDER);
    if (!scope) return null;

    const where = {
      id: ref.resourceId,
      deletedAt: null,
      AND: [projectScopeWhere(scope, subjectOf(policy))],
    } satisfies Prisma.ProjectWhereInput;

    const row = await this.prisma.project.findFirst({
      where,
      select: {
        id: true,
        name: true,
        status: true,
        health: true,
        progressPercent: true,
        dueDate: true,
        client: { select: { companyName: true } },
      },
    });

    return row ? availableCard(ref, cardFromProject(row)) : null;
  }

  private async task(
    policy: AccessPolicy,
    ref: SharedResourceRef,
  ): Promise<ResourceCardView | null> {
    // `taskReadWhereFor` est LE perimetre complet du module : scopes classiques
    // ET espace personnel, retrait des taches personnelles d'autrui, filtre
    // d'espace. Le recopier ici serait la premiere divergence.
    const row = await this.prisma.task.findFirst({
      where: {
        id: ref.resourceId,
        deletedAt: null,
        AND: [taskReadWhereFor(policy)],
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        isPersonal: true,
        project: { select: { name: true } },
      },
    });

    return row ? availableCard(ref, cardFromTask(row)) : null;
  }

  private async client(
    policy: AccessPolicy,
    ref: SharedResourceRef,
  ): Promise<ResourceCardView | null> {
    // Le perimetre de la TABLE client : `{ id: son dossier }` pour un compte
    // client, `requireScope('client','read')` pour l'interne — les deux sens de
    // la regle du CRM, dans la fonction exportee du module, pas une copie.
    let perimeter: Prisma.ClientWhereInput;
    try {
      perimeter = clientTablePerimeter(policy, 'client', 'read');
    } catch (caught) {
      if (caught instanceof AppException) return null;
      throw caught;
    }

    const row = await this.prisma.client.findFirst({
      where: { id: ref.resourceId, deletedAt: null, AND: [perimeter] },
      select: { id: true, companyName: true, status: true, sector: true },
    });

    return row ? availableCard(ref, cardFromClient(row)) : null;
  }

  private async quote(
    policy: AccessPolicy,
    ref: SharedResourceRef,
  ): Promise<ResourceCardView | null> {
    if (!policy.widestScope('quote', 'read', ['any', 'own'])) return null;

    let ownClientId: string | null;
    try {
      ownClientId = billingPerimeter(policy, 'quote', 'read');
    } catch (caught) {
      if (caught instanceof AppException) return null;
      throw caught;
    }

    const row = await this.prisma.quote.findFirst({
      where: {
        id: ref.resourceId,
        deletedAt: null,
        // Un porteur client ne voit jamais un brouillon : meme regle que la
        // liste du module devis, meme motif — le brouillon ne lui a pas ete
        // envoye.
        ...(ownClientId ? { clientId: ownClientId, NOT: { status: 'DRAFT' } } : {}),
      },
      select: {
        id: true,
        reference: true,
        subject: true,
        status: true,
        total: true,
        currency: true,
        client: { select: { companyName: true } },
      },
    });

    return row ? availableCard(ref, cardFromQuote(row)) : null;
  }

  private async invoice(
    policy: AccessPolicy,
    ref: SharedResourceRef,
  ): Promise<ResourceCardView | null> {
    if (!policy.widestScope('invoice', 'read', ['any', 'own'])) return null;

    let ownClientId: string | null;
    try {
      ownClientId = billingPerimeter(policy, 'invoice', 'read');
    } catch (caught) {
      if (caught instanceof AppException) return null;
      throw caught;
    }

    const row = await this.prisma.invoice.findFirst({
      where: {
        id: ref.resourceId,
        deletedAt: null,
        ...(ownClientId ? { clientId: ownClientId, NOT: { status: 'DRAFT' } } : {}),
      },
      select: {
        id: true,
        reference: true,
        status: true,
        total: true,
        currency: true,
        dueDate: true,
        client: { select: { companyName: true } },
      },
    });

    return row ? availableCard(ref, cardFromInvoice(row)) : null;
  }

  private async payment(
    policy: AccessPolicy,
    ref: SharedResourceRef,
  ): Promise<ResourceCardView | null> {
    let ownClientId: string | null;
    try {
      ownClientId = billingPerimeter(policy, 'payment', 'read');
    } catch (caught) {
      if (caught instanceof AppException) return null;
      throw caught;
    }

    // Un paiement n'a pas de `clientId` a lui : son perimetre passe par la
    // facture qu'il solde — exactement le filtre du module paiements.
    const row = await this.prisma.payment.findFirst({
      where: {
        id: ref.resourceId,
        deletedAt: null,
        invoice: {
          deletedAt: null,
          ...(ownClientId ? { clientId: ownClientId } : {}),
        },
      },
      select: {
        id: true,
        reference: true,
        status: true,
        amount: true,
        currency: true,
        paidAt: true,
      },
    });

    return row ? availableCard(ref, cardFromPayment(row)) : null;
  }

  /**
   * Un document passe par le SERVICE des documents, pas par un `where` recopie
   * ici : sa visibilite (interne, client, par projet, expire) se resout en
   * base selon des regles qui ne vivent que la. Le service leve 404/403 pour
   * tout le reste ; `resolveOne` convertit la levee en carte muette.
   */
  private async document(
    user: AuthenticatedUser,
    ref: SharedResourceRef,
  ): Promise<ResourceCardView | null> {
    const row = await this.documents.findOne(user, ref.resourceId);
    return row ? availableCard(ref, cardFromDocument(row)) : null;
  }
}
