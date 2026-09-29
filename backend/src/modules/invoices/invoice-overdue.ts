import type { Prisma } from '../../generated/prisma/client.js';
import { InvoiceStatus, NotificationType } from '../../generated/prisma/enums.js';
import type { NotificationInput } from '../notifications/notification.service.js';
import { type DecimalInput, toDecimal } from './money.js';

/**
 * REGLES DU RETARD DE PAIEMENT — separees de l'acces a la base, comme
 * `invoice-state.ts` et `money.ts` du meme dossier.
 *
 * POURQUOI CE FICHIER EXISTE. Le modele acceptait `InvoiceStatus.OVERDUE`, la
 * machine a etats l'incluait deliberement (« un `SENT` dont l'echeance est
 * passee : aucun geste n'a eu lieu »), les rapports le comptaient — et RIEN ne
 * l'ecrivait jamais. Une regle metier ecrite dans un commentaire et comptee dans
 * un rapport, mais qu'aucun geste ne declenche, est une regle qui n'existe pas :
 * la colonne `status` ne portait jamais `OVERDUE`, donc les listes « en retard »
 * et les relances ne voyaient rien.
 *
 * CE QUI DECLENCHE LE GESTE : le temps qui passe, et lui seul. Aucune route, donc
 * aucune permission a verifier ici — c'est `InvoiceOverdueService` qui balaie
 * periodiquement. La decision, elle, est prise par les fonctions de ce fichier,
 * qui ne connaissent ni Prisma Client ni Nest : elles repondent a « cette
 * facture est-elle en retard ? » et « que faut-il en dire ? », et se testent
 * statut par statut sans base de donnees.
 *
 * LE STATUT RESTE DERIVE. Cette regle n'ajoute pas un etat de plus a suivre : un
 * `OVERDUE` est un `SENT` en retard, et `statusAfterPayment` le ramene a
 * `SENT` ou `PARTIALLY_PAID` des qu'un encaissement bouge le solde — le balayage
 * suivant le remettra en retard si l'echeance reste depassee. C'est exactement
 * la propriete que la machine a etats documente, et la seule facon de ne pas
 * avoir deux verites sur la meme colonne.
 */

/**
 * Les SEULS statuts qu'un balayage fait passer en retard.
 *
 * La liste tient en un element, et c'est le point : `DRAFT` n'est pas un
 * document recu, `PAID` n'attend plus rien, `CANCELLED` et `REFUNDED` sont
 * tranches, `PARTIALLY_PAID` a recu un acompte — le retarder effacerait cet
 * encaissement du statut alors qu'il est reel. Seul `SENT` decrit la situation
 * visee : parti chez le client, rien recu, echeance depassee.
 *
 * `OVERDUE` n'y figure pas non plus, et ce n'est pas un oubli : une facture deja
 * en retard n'a rien a y faire. C'est ce qui rend le balayage idempotent — il ne
 * considere que ce qui n'est pas encore marque.
 */
export const SWEEPABLE_INVOICE_STATUSES: readonly InvoiceStatus[] = [InvoiceStatus.SENT];

/** Ce qu'il faut d'une facture pour decider, et pour rediger ce qu'on en dit. */
export interface OverdueInvoice {
  readonly id: string;
  readonly reference: string;
  readonly clientId: string;
  readonly currency: string;
  readonly total: DecimalInput;
  readonly amountPaid: DecimalInput;
  readonly dueDate: Date;
}

/**
 * Le PRE-FILTRE SQL du balayage.
 *
 * Il est volontairement LARGE, et c'est la decision de `isOverdueCandidate` qui
 * tranche ligne par ligne. La raison est qu'une comparaison de deux COLONNES
 * (`amountPaid < total`) s'ecrit differemment selon les versions du client
 * Prisma, alors que la regle, elle, ne doit pas dependre de l'outil : elle est
 * ecrite une seule fois, en clair, et le `where` ne fait que reduire le nombre de
 * lignes ramenees.
 *
 * `deletedAt: null` : une piece supprimee n'existe plus, la marquer en retard
 * n'aurait aucun sens et personne ne verrait le resultat.
 *
 * `dueDate: { lt: now }` : STRICTEMENT anterieure. Une facture due maintenant
 * n'est pas en retard — la meme comparaison est refaite dans la decision, donc
 * les deux ne peuvent pas diverger silencieusement.
 */
export function overdueCandidatesWhere(now: Date): Prisma.InvoiceWhereInput {
  return {
    status: InvoiceStatus.SENT,
    dueDate: { lt: now },
    deletedAt: null,
  };
}

/**
 * CETTE FACTURE EST-ELLE EN RETARD ?
 *
 * Trois conditions, et les trois comptent :
 *
 *  1. le statut est balayable (`SENT` seul — voir la constante ci-dessus) ;
 *  2. l'echeance est PASSEE, strictement ;
 *  3. le solde n'est pas nul (`amountPaid < total`).
 *
 * La troisieme est une ceinture en plus des bretelles. Un `SENT` integralement
 * paye ne devrait pas exister — le statut se derive de la somme des paiements
 * (`statusAfterPayment`), donc une facture soldee est `PAID` — mais il peut en
 * exister un : un total corrige hors API, une reprise d'historique, une donnee
 * anterieure a la derivation. Le declarer en retard parce qu'on suppose que la
 * colonne ne peut pas mentir serait transformer une supposition en relance
 * adressee a un client qui a deja paye. Le comparaison se fait en `Decimal`, pas
 * en flottant : `999.99` et `1000.00` ne sont pas egaux parce qu'un arrondi
 * binaire l'a decide.
 *
 * Le TROP-PERCU est traite comme un paiement complet (`amountPaid >= total`) :
 * une facture qui a recu plus que son du n'est pas en retard, elle est a
 * corriger par un avoir.
 */
export function isOverdueCandidate(
  invoice: Pick<OverdueInvoice, 'dueDate' | 'amountPaid' | 'total'> & { readonly status: InvoiceStatus },
  now: Date,
): boolean {
  if (!SWEEPABLE_INVOICE_STATUSES.includes(invoice.status)) {
    return false;
  }

  if (invoice.dueDate.getTime() >= now.getTime()) {
    return false;
  }

  return toDecimal(invoice.amountPaid).lessThan(toDecimal(invoice.total));
}

/**
 * La notification deposee pour les porteurs de l'espace client.
 *
 * Meme forme que celle de l'envoi (`INVOICE_ISSUED`) : le titre porte la
 * reference, le corps porte le montant REEL de la piece — il vient de
 * `invoice.total`, il n'est jamais recalcule ni saisi ici — et le lien mene a la
 * meme fiche. Le type, lui, n'est pas nouveau : `INVOICE_OVERDUE` existe dans
 * l'enumeration depuis le debut et n'avait jamais ete emis.
 */
export function overdueNotification(invoice: OverdueInvoice): NotificationInput {
  return {
    type: NotificationType.INVOICE_OVERDUE,
    title: `Facture ${invoice.reference} en retard`,
    body: `La facture de ${toDecimal(invoice.total).toFixed(2)} ${invoice.currency} n'a pas ete reglee a son echeance.`,
    link: `/factures/${invoice.id}`,
    entityType: 'Invoice',
    entityId: invoice.id,
  };
}

/**
 * La ligne d'activite du dossier.
 *
 * La date d'echeance n'est PAS mise dans la phrase : elle est en `metadata`,
 * brute, la ou le reste du module range deja les valeurs. Une date ecrite en
 * clair dans un message est une date que personne ne peut plus comparer ni
 * reformater, et le fil d'activite est lu par des ecrans qui formatent les dates
 * eux-memes.
 *
 * `isClientVisible` vaut `true` a l'appel : le client doit voir pourquoi sa
 * facture a change d'etat. Ce n'est pas une note interne, c'est une relance.
 */
export function overdueActivityMessage(invoice: OverdueInvoice): string {
  return `Facture ${invoice.reference} en retard : l'echeance de paiement est depassee.`;
}
