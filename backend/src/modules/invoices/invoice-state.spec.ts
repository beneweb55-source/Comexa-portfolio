import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InvoiceStatus } from '../../generated/prisma/enums.js';
import {
  canCancelInvoice,
  canEditInvoice,
  canRecordPayment,
  canSendInvoice,
  isInvoiceFrozen,
  paidAtFor,
  statusAfterPayment,
} from './invoice-state.js';
import { money, sumMoney, zero } from './money.js';

/**
 * MACHINE A ETATS DES FACTURES.
 *
 * Le point central de ce fichier est UN SEUL : LE STATUT SE DERIVE DE LA SOMME
 * DES PAIEMENTS, il ne s'incremente pas. Une implementation par incrementation
 * (`if encaissement alors PARTIALLY_PAID`) donne le bon resultat sur le chemin
 * heureux et le mauvais des qu'un mouvement d'argent est RETIRE — suppression
 * d'un paiement, remboursement, correction de montant. C'est pourquoi la moitie
 * des cas ci-dessous simule une SUITE de mouvements (ajout puis retrait) et
 * verifie que le statut revient exactement la ou il doit, au lieu de rester
 * bloque sur l'etat le plus avance qu'il ait connu.
 *
 * Les statuts sont parcourus EXHAUSTIVEMENT, et pas seulement sur les cas
 * nominaux : `Record<InvoiceStatus, …>` dans le tableau force le compilateur a
 * refuser l'oubli d'un statut le jour ou l'enumeration s'allonge. C'est
 * exactement le genre d'oubli que la duplication de tables de transitions
 * produit ailleurs.
 */

const ALL_STATUSES: readonly InvoiceStatus[] = [
  InvoiceStatus.DRAFT,
  InvoiceStatus.SENT,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.PAID,
  InvoiceStatus.OVERDUE,
  InvoiceStatus.CANCELLED,
  InvoiceStatus.REFUNDED,
];

/** La somme des paiements encaisses, telle que `recomputePaymentState` la lit. */
function paid(amounts: readonly string[]) {
  return amounts.length === 0 ? zero() : sumMoney(amounts.map((amount) => money(amount)));
}

describe('canEditInvoice', () => {
  it('n ouvre la reecriture qu au BROUILLON', () => {
    const expected: Record<InvoiceStatus, boolean> = {
      [InvoiceStatus.DRAFT]: true,
      [InvoiceStatus.SENT]: false,
      [InvoiceStatus.PARTIALLY_PAID]: false,
      [InvoiceStatus.PAID]: false,
      [InvoiceStatus.OVERDUE]: false,
      [InvoiceStatus.CANCELLED]: false,
      [InvoiceStatus.REFUNDED]: false,
    };

    for (const status of ALL_STATUSES) {
      assert.equal(canEditInvoice(status), expected[status], status);
    }
  });
});

describe('canSendInvoice', () => {
  it('n envoie qu un brouillon — renvoyer une facture partie la redaterait', () => {
    for (const status of ALL_STATUSES) {
      assert.equal(canSendInvoice(status), status === InvoiceStatus.DRAFT, status);
    }
  });
});

describe('canCancelInvoice', () => {
  it('accepte le brouillon et la facture envoyee, refuse des qu il y a de l argent', () => {
    const expected: Record<InvoiceStatus, boolean> = {
      [InvoiceStatus.DRAFT]: true,
      [InvoiceStatus.SENT]: true,
      // Des qu'un centime est encaisse, la correction passe par un AVOIR : deux
      // documents doivent apparaitre en comptabilite, pas s'annuler en silence.
      [InvoiceStatus.PARTIALLY_PAID]: false,
      [InvoiceStatus.PAID]: false,
      [InvoiceStatus.OVERDUE]: true,
      [InvoiceStatus.CANCELLED]: false,
      [InvoiceStatus.REFUNDED]: false,
    };

    for (const status of ALL_STATUSES) {
      assert.equal(canCancelInvoice(status), expected[status], status);
    }
  });

  it('laisse annuler une facture EN RETARD — elle n a rien encaisse', () => {
    // `OVERDUE` n'est pas un etat financier, c'est une date depassee. Le refuser
    // obligerait a encaisser d'abord une facture qu'on veut justement annuler.
    assert.equal(canCancelInvoice(InvoiceStatus.OVERDUE), true);
    assert.equal(canRecordPayment(InvoiceStatus.OVERDUE), true);
  });
});

describe('canRecordPayment', () => {
  it('n encaisse jamais sur un brouillon ni sur une piece close', () => {
    const expected: Record<InvoiceStatus, boolean> = {
      // Le client n'a jamais recu ce document : encaisser dessus ferait entrer
      // de l'argent sur une piece qui n'existe pas pour lui.
      [InvoiceStatus.DRAFT]: false,
      [InvoiceStatus.SENT]: true,
      [InvoiceStatus.PARTIALLY_PAID]: true,
      // Une facture deja soldee n'est plus payable : c'est le controle de solde
      // (`PAYMENT_EXCEEDS_BALANCE`) qui prend le relais, a zero.
      [InvoiceStatus.PAID]: false,
      [InvoiceStatus.OVERDUE]: true,
      [InvoiceStatus.CANCELLED]: false,
      [InvoiceStatus.REFUNDED]: false,
    };

    for (const status of ALL_STATUSES) {
      assert.equal(canRecordPayment(status), expected[status], status);
    }
  });
});

describe('statusAfterPayment — le statut vient de la SOMME', () => {
  const total = money('1000.00');

  it('un encaissement partiel donne PARTIALLY_PAID', () => {
    assert.equal(
      statusAfterPayment(InvoiceStatus.SENT, paid(['400.00']), total),
      InvoiceStatus.PARTIALLY_PAID,
    );
  });

  it('un encaissement complet donne PAID', () => {
    assert.equal(
      statusAfterPayment(InvoiceStatus.SENT, paid(['1000.00']), total),
      InvoiceStatus.PAID,
    );
  });

  it('un encaissement qui DEPASSE le du donne PAID, pas autre chose', () => {
    // Le trop-percu se corrige par un avoir ; il ne doit pas laisser la facture
    // dans un etat intermediaire alors qu'elle est entierement soldee.
    assert.equal(
      statusAfterPayment(InvoiceStatus.SENT, paid(['1200.00']), total),
      InvoiceStatus.PAID,
    );
  });

  it('plusieurs encaissements s ADDITIONNENT', () => {
    assert.equal(
      statusAfterPayment(InvoiceStatus.PARTIALLY_PAID, paid(['300.00', '300.00']), total),
      InvoiceStatus.PARTIALLY_PAID,
    );
    assert.equal(
      statusAfterPayment(InvoiceStatus.PARTIALLY_PAID, paid(['300.00', '700.00']), total),
      InvoiceStatus.PAID,
    );
  });

  it('REDESCEND quand un paiement est retire — c est tout l interet du recalcul', () => {
    // LE cas que l'incrementation rate. Un paiement de 1000 sur 1000 puis son
    // annulation : la facture a ete PAYEE, elle doit redevenir ENVOYEE. Un
    // `if (paiement) status = PAID` la laisserait payee pour toujours, et le
    // solde afficherait 1000 du que personne ne reclame.
    assert.equal(
      statusAfterPayment(InvoiceStatus.PAID, paid(['1000.00']), total),
      InvoiceStatus.PAID,
    );
    assert.equal(statusAfterPayment(InvoiceStatus.PAID, paid([]), total), InvoiceStatus.SENT);

    // Retrait partiel : de soldee a partiellement payee.
    assert.equal(
      statusAfterPayment(InvoiceStatus.PAID, paid(['600.00']), total),
      InvoiceStatus.PARTIALLY_PAID,
    );
  });

  it('revient a SENT quand le dernier centime est retire', () => {
    assert.equal(
      statusAfterPayment(InvoiceStatus.PARTIALLY_PAID, paid(['400.00']), total),
      InvoiceStatus.PARTIALLY_PAID,
    );
    assert.equal(
      statusAfterPayment(InvoiceStatus.PARTIALLY_PAID, paid([]), total),
      InvoiceStatus.SENT,
    );
    assert.equal(
      statusAfterPayment(InvoiceStatus.PARTIALLY_PAID, zero(), total),
      InvoiceStatus.SENT,
    );
  });

  it('un remboursement integral ramene a SENT, jamais a un etat negatif', () => {
    // Somme nulle apres retrait : c'est le meme calcul que « aucun paiement ».
    // Le statut ne doit pas rester PAID sous pretexte qu'il l'a ete.
    assert.equal(statusAfterPayment(InvoiceStatus.PAID, zero(), total), InvoiceStatus.SENT);
  });

  it('ne ressuscite pas un BROUILLON en facture envoyee', () => {
    // Une somme nulle sur un brouillon le laisse brouillon. Le transformer en
    // SENT ferait apparaitre chez le client une facture qu'on n'a jamais envoyee.
    assert.equal(statusAfterPayment(InvoiceStatus.DRAFT, zero(), total), InvoiceStatus.DRAFT);
  });

  it('PRESERVE une facture annulee, meme avec un paiement residuel', () => {
    // L'annulation est un acte, pas un solde : un remboursement en cours ne doit
    // pas transformer une piece annulee en piece envoyee.
    assert.equal(
      statusAfterPayment(InvoiceStatus.CANCELLED, paid(['400.00']), total),
      InvoiceStatus.CANCELLED,
    );
    assert.equal(
      statusAfterPayment(InvoiceStatus.CANCELLED, zero(), total),
      InvoiceStatus.CANCELLED,
    );
  });

  it('PRESERVE une facture remboursee', () => {
    assert.equal(statusAfterPayment(InvoiceStatus.REFUNDED, zero(), total), InvoiceStatus.REFUNDED);
    assert.equal(
      statusAfterPayment(InvoiceStatus.REFUNDED, paid(['100.00']), total),
      InvoiceStatus.REFUNDED,
    );
  });

  it('un retard se resorbe des le premier encaissement partiel', () => {
    // `OVERDUE` decrit une date, pas un montant : des qu'un paiement arrive, la
    // facture redevient une facture partiellement payee.
    assert.equal(
      statusAfterPayment(InvoiceStatus.OVERDUE, paid(['1.00']), total),
      InvoiceStatus.PARTIALLY_PAID,
    );
    assert.equal(
      statusAfterPayment(InvoiceStatus.OVERDUE, paid(['1000.00']), total),
      InvoiceStatus.PAID,
    );
  });

  it('un total NUL est paye des le premier centime, pas avant', () => {
    // Cas limite : une facture de zero euro (avoir deja deduit). Avec une somme
    // nulle elle reste SENT — on ne peut pas la payer — et le premier centime la
    // solde, puisqu'il n'y a plus rien a devoir.
    assert.equal(statusAfterPayment(InvoiceStatus.SENT, zero(), zero()), InvoiceStatus.SENT);
    assert.equal(
      statusAfterPayment(InvoiceStatus.SENT, paid(['0.01']), zero()),
      InvoiceStatus.PAID,
    );
  });

  it('ne depend PAS de l ORDRE des mouvements, seulement de leur somme', () => {
    // Deux histoires differentes, la meme somme : le meme statut. C'est la
    // definition d'un etat derive, et c'est ce qu'un `status` incremente ne sait
    // pas faire.
    const enDeuxFois = sumMoney([money('250.00'), money('250.00')]);
    const enUneFois = sumMoney([money('500.00')]);

    assert.equal(
      statusAfterPayment(InvoiceStatus.SENT, enDeuxFois, total),
      statusAfterPayment(InvoiceStatus.SENT, enUneFois, total),
    );
    assert.equal(
      statusAfterPayment(InvoiceStatus.SENT, enDeuxFois, total),
      InvoiceStatus.PARTIALLY_PAID,
    );
  });

  it('ne produit jamais un statut hors de l enumeration', () => {
    const sums = ['0', '0.01', '499.99', '500.00', '999.99', '1000.00', '1500.00'];

    for (const current of ALL_STATUSES) {
      for (const sum of sums) {
        const next = statusAfterPayment(current, money(sum), total);
        assert.ok(ALL_STATUSES.includes(next), `${current} + ${sum} -> ${String(next)}`);
      }
    }
  });
});

describe('paidAtFor', () => {
  const now = new Date('2026-03-04T10:00:00.000Z');
  const earlier = new Date('2026-01-15T08:30:00.000Z');

  it('date l encaissement quand la facture est SOLDEE', () => {
    assert.equal(paidAtFor(InvoiceStatus.PAID, null, now), now);
  });

  it('PRESERVE la date du premier encaissement complet', () => {
    // Un second appel ne redate pas un paiement deja solde : sinon la date
    // d'encaissement glisserait a chaque recalcul, et un recalcul a lieu a chaque
    // mouvement de paiement.
    assert.equal(paidAtFor(InvoiceStatus.PAID, earlier, now), earlier);
  });

  it('n ecrit AUCUNE date sur une facture qui n est pas soldee', () => {
    assert.equal(paidAtFor(InvoiceStatus.PARTIALLY_PAID, null, now), null);
    assert.equal(paidAtFor(InvoiceStatus.SENT, null, now), null);
    assert.equal(paidAtFor(InvoiceStatus.OVERDUE, null, now), null);
  });

  it('EFFACE la date quand le statut redescend', () => {
    // C'est la contrepartie du recalcul : une facture qui redevient partiellement
    // payee ne peut pas garder une date d'encaissement, ce serait un faux dans le
    // journal comptable.
    assert.equal(paidAtFor(InvoiceStatus.PARTIALLY_PAID, earlier, now), null);
    assert.equal(paidAtFor(InvoiceStatus.SENT, earlier, now), null);
  });

  it('est idempotent : deux appels sur le meme etat donnent la meme date', () => {
    const first = paidAtFor(InvoiceStatus.PAID, null, now);
    const second = paidAtFor(InvoiceStatus.PAID, first, new Date('2026-03-05T10:00:00.000Z'));

    assert.equal(second, first);
  });
});

describe('isInvoiceFrozen', () => {
  it('gele les pieces soldees et annulees', () => {
    const expected: Record<InvoiceStatus, boolean> = {
      [InvoiceStatus.DRAFT]: false,
      [InvoiceStatus.SENT]: false,
      [InvoiceStatus.PARTIALLY_PAID]: false,
      [InvoiceStatus.PAID]: true,
      [InvoiceStatus.OVERDUE]: false,
      [InvoiceStatus.CANCELLED]: true,
      [InvoiceStatus.REFUNDED]: false,
    };

    for (const status of ALL_STATUSES) {
      assert.equal(isInvoiceFrozen(status), expected[status], status);
    }
  });
});
