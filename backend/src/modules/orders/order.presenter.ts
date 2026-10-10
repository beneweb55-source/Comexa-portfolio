import type { Prisma } from '../../generated/prisma/client.js';

/**
 * FORMES DE REPONSE DES COMMANDES.
 *
 * Aucune ligne Prisma ne sort telle quelle : `userId`, `rateId`, `clientId` et
 * les champs internes restent dans la base. Le client voit sa commande et son
 * projet ; l'equipe voit en plus qui a commande (nom et courriel, pas plus) et
 * le tarif applique. Ces formes sont le contrat : un champ ajoute ici est
 * visible, donc a justifier.
 */
export const ORDER_INCLUDE = {
  project: {
    select: {
      id: true,
      reference: true,
      status: true,
      progressPercent: true,
      startDate: true,
      dueDate: true,
    },
  },
  user: { select: { firstName: true, lastName: true, email: true } },
} satisfies Prisma.OrderInclude;

export type OrderRecord = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

export interface ClientProjectView {
  id: string;
  reference: string;
  status: string;
  progressPercent: number;
  startDate: Date | null;
  dueDate: Date | null;
}

export interface ClientOrderView {
  id: string;
  reference: string;
  packageName: string;
  currency: string;
  /** Montant fige a la commande, chaine decimale a deux chiffres. */
  amount: string;
  paymentMethod: string;
  status: string;
  paymentStatus: string;
  orderedAt: Date;
  project: ClientProjectView | null;
}

export interface TeamOrderView extends ClientOrderView {
  packageId: string;
  clientId: string;
  country: string | null;
  customer: { firstName: string; lastName: string; email: string };
}

function projectOf(order: OrderRecord): ClientProjectView | null {
  if (!order.project) return null;
  return {
    id: order.project.id,
    reference: order.project.reference,
    status: order.project.status,
    progressPercent: order.project.progressPercent,
    startDate: order.project.startDate,
    dueDate: order.project.dueDate,
  };
}

export function presentClientOrder(order: OrderRecord): ClientOrderView {
  return {
    id: order.id,
    reference: order.reference,
    packageName: order.packageName,
    currency: order.currency,
    amount: order.amount.toFixed(2),
    paymentMethod: order.paymentMethod,
    status: order.status,
    paymentStatus: order.paymentStatus,
    orderedAt: order.orderedAt,
    project: projectOf(order),
  };
}

export function presentTeamOrder(order: OrderRecord): TeamOrderView {
  return {
    ...presentClientOrder(order),
    packageId: order.packageId,
    clientId: order.clientId,
    country: order.country,
    customer: {
      firstName: order.user.firstName,
      lastName: order.user.lastName,
      email: order.user.email,
    },
  };
}
