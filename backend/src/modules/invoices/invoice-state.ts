import type { Prisma } from '../../generated/prisma/client.js';
import { InvoiceStatus } from '../../generated/prisma/enums.js';
import { zero } from './money.js';

/**
 * MACHINE A ETATS DES FACTURES — les regles, separees de l'acces a la base.
 *
 * Ce fichier ne connait ni Prisma Client ni Nest : il repond a « cet etat
 * autorise-t-il cette operation ? » et « quel statut resulte de ces paiements ? ».
 * Deux raisons de l'isoler :
 *
 *  1. ces regles sont testables exhaustivement, etat par etat, sans base ;
 *  2. le statut d'une facture est ECRIT A DEUX ENDROITS (envoi, annulation) et
 *     RECALCULE a un troisieme (paiement). Trois copies d'une table de
 *     transitions divergent toujours : la premiere oubliera `OVERDUE`, la
 *     deuxieme aura un `if` sur `PAID` que la troisieme n'aura pas.
 *
 * LE STATUT NE S'INCREMENTE JAMAIS. Il se DERIVE de la somme des paiements.
 * Une incrementation manuelle (`status = PARTIALLY_PAID` quand `amountPaid > 0`)
 * se desynchronise au premier remboursement, a la premiere correction de
 * montant, a la premiere suppression — et une facture marquee payee qui ne l'est
 * plus est un contentieux avec le client, pas un bogue d'affichage.
 */

/** Une facture ne se reecrit que tant qu'elle est un brouillon. */
export function canEditInvoice(status: InvoiceStatus): boolean {
  return status === InvoiceStatus.DRAFT;
}

/** On n'envoie qu'un brouillon : renvoyer une facture deja partie la redate. */
export function canSendInvoice(status: InvoiceStatus): boolean {
  return status === InvoiceStatus.DRAFT;
}

/**
 * L'annulation n'est ouverte QUE tant qu'aucun mouvement d'argent n'existe.
 * Des qu'un paiement est encaisse, la correction comptable appropriee est un
 * avoir (`InvoiceType.CREDIT_NOTE`), pas une annulation : les deux documents
 * doivent apparaitre dans la comptabilite, pas s'annuler en silence.
 *
 * ATTENTION : CE GESTE N'EST PAS IMPLEMENTE. Le type est declare dans le schema
 * Prisma, mais aucun chemin de code n'en ecrit — voir `docs/API.md`, section
 * « Ecarts connus et limites assumees ». La regle ci-dessus explique POURQUOI
 * l'annulation est fermee ; elle ne decrit pas un remede disponible, et le
 * message d'erreur de `InvoicesService.cancel` est ecrit pour ne pas le
 * promettre.
 *
 * ET LE PREDICAT EST PLUS ETROIT QU'IL N'Y PARAIT, ce qui se paie a l'usage :
 * `PAID`, `PARTIALLY_PAID` et `REFUNDED` sont refuses. Retirer TOUS les
 * encaissements ramene la facture a `SENT` (`statusAfterPayment`) et l'annulation
 * redevient possible ; n'en retirer QU'UN SEUL la laisse en `PARTIALLY_PAID`,
 * donc toujours refusee. C'est la raison pour laquelle le message d'erreur insiste
 * sur « tous ».
 *
 * `OVERDUE` EST DANS LA LISTE, et ce n'est pas une exception ajoutee par
 * commodite. `OVERDUE` est un `SENT` dont la date d'echeance est passee : aucun
 * centime n'a ete encaisse, puisque le statut se DERIVE de la somme des paiements
 * — une facture en retard qui porterait un paiement serait `PARTIALLY_PAID`, pas
 * `OVERDUE`. L'exclure serait incoherent d'une facon qui se voit a l'usage : la
 * meme facture serait annulable une seconde avant son echeance et ne le serait
 * plus une seconde apres, alors que rien n'a change sinon le calendrier. Et le
 * besoin est reel : une affaire qui tombe a l'eau apres l'echeance doit pouvoir
 * etre annulee, sans quoi il ne reste que la marquer payee, ce qui serait un
 * mensonge comptable.
 */
export function canCancelInvoice(status: InvoiceStatus): boolean {
  return (
    status === InvoiceStatus.DRAFT ||
    status === InvoiceStatus.SENT ||
    status === InvoiceStatus.OVERDUE
  );
}

/**
 * Une facture se paie quand elle a ete ENVOYEE. Un brouillon n'est pas un
 * document : encaisser dessus reviendrait a faire entrer de l'argent sur une
 * piece que le client n'a jamais recue.
 */
export function canRecordPayment(status: InvoiceStatus): boolean {
  return (
    status === InvoiceStatus.SENT ||
    status === InvoiceStatus.PARTIALLY_PAID ||
    status === InvoiceStatus.OVERDUE
  );
}

/**
 * Statut resultant de la SOMME DES PAIEMENTS encaisses.
 *
 * `current` n'est pas un oubli : c'est lui qui preserve les etats que le solde
 * ne peut pas exprimer. Une facture annulee le reste meme si un paiement
 * residuel existe (le remboursement est un acte distinct), et un brouillon ne
 * devient pas « envoyee » parce qu'un solde nul traine.
 *
 * `paid >= total` couvre le TROP-PERCU : une facture entierement soldee est
 * payee, meme si l'encaissement depasse le du. L'excedent n'est pas une dette de
 * l'agence dans ce modele ; il se corrige par un avoir. (L'API, elle, refuse de
 * CREER un tel paiement — voir `PAYMENT_EXCEEDS_BALANCE` — donc ce cas ne peut
 * venir que d'une donnee existante ou d'une future reprise d'historique.)
 *
 * Le retour en arriere est volontaire et c'est tout l'interet du recalcul : un
 * paiement de 500 sur 1000 puis un remboursement rend le statut a « envoyee ».
 */
export function statusAfterPayment(
  current: InvoiceStatus,
  paid: Prisma.Decimal,
  total: Prisma.Decimal,
): InvoiceStatus {
  if (current === InvoiceStatus.CANCELLED || current === InvoiceStatus.REFUNDED) {
    return current;
  }

  if (paid.lessThanOrEqualTo(zero())) {
    // Plus rien d'encaisse : la facture revient a son etat d'avant paiement.
    // `DRAFT` n'arrive pas ici par l'API (on ne paie pas un brouillon) ; il est
    // preserve pour ne pas transformer un brouillon en facture envoyee.
    return current === InvoiceStatus.DRAFT ? InvoiceStatus.DRAFT : InvoiceStatus.SENT;
  }

  if (paid.lessThan(total)) {
    return InvoiceStatus.PARTIALLY_PAID;
  }

  return InvoiceStatus.PAID;
}

/**
 * Date d'encaissement effectif a porter sur la facture.
 *
 * Renseignee en meme temps que le statut `PAID`, et remise a `null` si le
 * statut redescend : une date d'encaissement sur une facture partiellement
 * remboursee serait un faux dans le journal comptable.
 */
export function paidAtFor(
  status: InvoiceStatus,
  previousPaidAt: Date | null,
  now: Date,
): Date | null {
  if (status !== InvoiceStatus.PAID) {
    return null;
  }
  return previousPaidAt ?? now;
}

/** Etats pour lesquels une facture ne doit plus bouger, meme en lecture outil. */
export function isInvoiceFrozen(status: InvoiceStatus): boolean {
  return status === InvoiceStatus.PAID || status === InvoiceStatus.CANCELLED;
}
