import { QuoteStatus } from '../../generated/prisma/enums.js';

// -----------------------------------------------------------------------------
// EXPIRATION : UN STATUT DERIVE, PAS UNE ECRITURE EN BASE
// -----------------------------------------------------------------------------

/**
 * `EXPIRED` N'AVAIT AUCUN ECRIVAIN.
 *
 * Le commentaire de `QuotesService.assertNotExpired` promettait « le statut
 * EXPIRED est pose par une tache planifiee », mais aucune tache de ce type
 * n'existe (seule `InvoiceOverdueService` est planifiee). Consequence : un
 * devis envoye restait `SENT`/`VIEWED` apres sa date de validite. L'ecran
 * affichait « Envoye », proposait encore de l'accepter, et l'API repondait
 * 422 — trois verites differentes pour un seul document.
 *
 * On ne cree PAS de cron et on ne reecrit PAS l'historique : `EXPIRED` est
 * derive a la LECTURE depuis `validUntil`. Un etat deja tranche (`ACCEPTED`,
 * `REJECTED`, `CANCELLED`, `EXPIRED`) n'est jamais modifie : un devis accepte
 * le reste, meme quand sa date de validite est passee. Un `DRAFT` non envoye
 * n'est pas « expire » non plus — il n'a jamais ete propose a personne.
 *
 * DEUXIEME INCOHERENCE CORRIGEE ICI : l'interface ne montre qu'un JOUR
 * (« Valable jusqu'au 26/11 »), et l'API accepte une date seule, stockee a
 * minuit UTC. Comparer `validUntil < now` declarait donc le devis expire des
 * 00:00 UTC le DERNIER jour de validite (01:00 a Alger). La validite est
 * INCLUSIVE : elle court jusqu'a la fin du jour UTC indique.
 */

/** Fin du jour UTC de la date de validite ; `null` sans date ou date invalide. */
export function quoteValidityDeadline(validUntil: Date | null): Date | null {
  if (!validUntil || !Number.isFinite(validUntil.getTime())) return null;
  return new Date(`${validUntil.toISOString().slice(0, 10)}T23:59:59.999Z`);
}

/** Borne « strictement avant aujourd'hui (UTC) » pour le filtre SQL de liste. */
export function quoteExpiredBefore(now: Date): Date {
  return new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export function isQuoteExpired(validUntil: Date | null, now: Date): boolean {
  const deadline = quoteValidityDeadline(validUntil);
  return deadline !== null && now.getTime() > deadline.getTime();
}

/** Statut REEL d'un devis, tel que l'API et les ecrans doivent le montrer. */
export function effectiveQuoteStatus(
  status: QuoteStatus,
  validUntil: Date | null,
  now: Date,
): QuoteStatus {
  if (status !== QuoteStatus.SENT && status !== QuoteStatus.VIEWED) return status;
  return isQuoteExpired(validUntil, now) ? QuoteStatus.EXPIRED : status;
}

/** Applique le statut derive a une ligne lue en base, sans toucher a la ligne. */
export function withEffectiveQuoteStatus<
  T extends { readonly status: QuoteStatus; readonly validUntil: Date | null },
>(row: T, now: Date): T {
  return { ...row, status: effectiveQuoteStatus(row.status, row.validUntil, now) };
}

/**
 * MACHINE A ETATS DES DEVIS.
 *
 * Separee du service pour la meme raison que celle des factures : ces regles se
 * testent etat par etat sans base de donnees, et elles sont lues a quatre
 * endroits (modifier, supprimer, envoyer, accepter/refuser) ou une copie
 * divergerait.
 *
 * LA REGLE QUI COMMANDE TOUT LE RESTE : un devis envoye ne se reecrit plus.
 * Ce n'est pas une precaution d'ergonomie. Le client recoit un document, il
 * l'accepte, et le devis accepte declenche un projet et une facture : si le
 * document pouvait encore changer entre l'envoi et l'acceptation, l'accord
 * porterait sur autre chose que ce qui a ete signe. Un brouillon, lui, ne
 * regarde personne.
 */

/** Le devis est-il encore un brouillon, c'est-a-dire reecrivable ? */
export function canEditQuote(status: QuoteStatus): boolean {
  return status === QuoteStatus.DRAFT;
}

/** Suppression persistée : tous les statuts, sous réserve du droit delete. */
export function canDeleteQuote(status: QuoteStatus): boolean {
  return Object.values(QuoteStatus).includes(status);
}

/** On n'envoie qu'un brouillon : renvoyer un devis deja parti le redate. */
export function canSendQuote(status: QuoteStatus): boolean {
  return status === QuoteStatus.DRAFT;
}

/**
 * Le devis est-il dans un etat ou le client (ou un interne) peut trancher ?
 *
 * `SENT` et `VIEWED` : `VIEWED` est renseigne quand le client a ouvert le
 * document, ce qui n'est qu'une information de lecture et ne change pas le
 * droit de repondre. Un `DRAFT` n'est pas decisionnaire — personne ne l'a recu.
 */
export function canDecideQuote(status: QuoteStatus): boolean {
  return status === QuoteStatus.SENT || status === QuoteStatus.VIEWED;
}

/**
 * Peut-on generer une facture ? Uniquement sur un devis ACCEPTE.
 *
 * C'est la garde qui empeche de facturer une proposition commerciale : le
 * document serait juridiquement un devis, comptablement une facture, et le
 * client recevrait une demande de paiement pour un travail qu'il n'a pas
 * commande.
 */
export function canInvoiceQuote(status: QuoteStatus): boolean {
  return status === QuoteStatus.ACCEPTED;
}

/**
 * Le refus est definitif, comme l'acceptation : on ne revient pas sur une
 * acceptation parce qu'un commercial a trouve un meilleur prix apres coup. Un
 * devis refuse se remplace par un NOUVEAU devis, qui garde sa propre trace.
 */
export function isQuoteClosed(status: QuoteStatus): boolean {
  return (
    status === QuoteStatus.ACCEPTED ||
    status === QuoteStatus.REJECTED ||
    status === QuoteStatus.EXPIRED ||
    status === QuoteStatus.CANCELLED
  );
}

/**
 * Pourquoi cette decision est-elle impossible ? `null` si elle l'est possible.
 *
 * Le service transforme ce motif en code d'erreur stable pour le frontend. La
 * fonction existe pour que la correspondance etat -> code soit ECRITE UNE FOIS :
 * un `if (status === 'ACCEPTED') throw conflict('QUOTE_ALREADY_ACCEPTED')`
 * recopie a trois endroits finit par diverger, et c'est le genre d'ecart que le
 * frontend ne voit qu'en production, quand il teste un code qui n'arrive jamais.
 */
export type QuoteDecisionBlocker =
  | 'QUOTE_ALREADY_ACCEPTED'
  | 'QUOTE_ALREADY_REJECTED'
  | 'QUOTE_CANCELLED'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_NOT_SENT';

export function quoteDecisionBlocker(status: QuoteStatus): QuoteDecisionBlocker | null {
  switch (status) {
    case QuoteStatus.ACCEPTED:
      return 'QUOTE_ALREADY_ACCEPTED';
    case QuoteStatus.REJECTED:
      return 'QUOTE_ALREADY_REJECTED';
    case QuoteStatus.CANCELLED:
      return 'QUOTE_CANCELLED';
    case QuoteStatus.EXPIRED:
      return 'QUOTE_EXPIRED';
    default:
      // `DRAFT` : jamais envoye, donc rien a accepter. `SENT` et `VIEWED` sont
      // les deux etats ou la decision est attendue.
      return status === QuoteStatus.DRAFT ? 'QUOTE_NOT_SENT' : null;
  }
}

/** Message associe au motif, pour ne pas le construire dans le service. */
export function quoteDecisionMessage(blocker: QuoteDecisionBlocker): string {
  switch (blocker) {
    case 'QUOTE_ALREADY_ACCEPTED':
      return 'Ce devis a deja ete accepte.';
    case 'QUOTE_ALREADY_REJECTED':
      return 'Ce devis a deja ete refuse.';
    case 'QUOTE_CANCELLED':
      return 'Ce devis a ete annule.';
    case 'QUOTE_EXPIRED':
      return 'Ce devis a expire.';
    case 'QUOTE_NOT_SENT':
      return "Ce devis n'a pas encore ete envoye au client : il ne peut pas etre accepte ni refuse.";
  }
}
