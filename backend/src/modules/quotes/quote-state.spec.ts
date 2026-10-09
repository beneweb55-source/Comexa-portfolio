import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QuoteStatus } from '../../generated/prisma/enums.js';
import {
  canDecideQuote,
  canDeleteQuote,
  canEditQuote,
  canInvoiceQuote,
  canSendQuote,
  isQuoteClosed,
  quoteDecisionBlocker,
  quoteDecisionMessage,
  type QuoteDecisionBlocker,
} from './quote-state.js';

/**
 * MACHINE A ETATS DES DEVIS.
 *
 * LA REGLE QUI COMMANDE TOUT LE RESTE : un devis envoye ne se reecrit plus. Le
 * client recoit un document, l'accepte, et cet accord declenche un projet et une
 * facture ; si le document pouvait encore changer entre l'envoi et l'acceptation,
 * l'accord porterait sur autre chose que ce qui a ete signe.
 *
 * LES DEUX CHEMINS DE DECISION SONT TESTES ENSEMBLE, parce qu'ils sont la MEME
 * transition vue de deux cotes : accept et refuse partagent leurs etats
 * d'ouverture (`SENT`, `VIEWED`) et leurs etats de fermeture (`ACCEPTED`,
 * `REJECTED`, `EXPIRED`, `CANCELLED`). Les separer laisserait passer le cas ou
 * l'un des deux oublie `VIEWED` — et le client qui a ouvert son devis ne pourrait
 * plus repondre.
 *
 * Le tableau de chaque garde est type `Record<QuoteStatus, boolean>` : le
 * compilateur refuse donc l'oubli d'un statut le jour ou l'enumeration s'allonge,
 * ce qui est precisement l'erreur qu'une table de transitions dupliquee produit.
 */

const ALL_STATUSES: readonly QuoteStatus[] = [
  QuoteStatus.DRAFT,
  QuoteStatus.SENT,
  QuoteStatus.VIEWED,
  QuoteStatus.ACCEPTED,
  QuoteStatus.REJECTED,
  QuoteStatus.EXPIRED,
  QuoteStatus.CANCELLED,
];

describe('canEditQuote / canDeleteQuote / canSendQuote', () => {
  it('reservent les trois gestes au BROUILLON', () => {
    const expected: Record<QuoteStatus, boolean> = {
      [QuoteStatus.DRAFT]: true,
      [QuoteStatus.SENT]: false,
      [QuoteStatus.VIEWED]: false,
      [QuoteStatus.ACCEPTED]: false,
      [QuoteStatus.REJECTED]: false,
      [QuoteStatus.EXPIRED]: false,
      [QuoteStatus.CANCELLED]: false,
    };

    for (const status of ALL_STATUSES) {
      assert.equal(canEditQuote(status), expected[status], `canEditQuote ${status}`);
      assert.equal(canDeleteQuote(status), expected[status], `canDeleteQuote ${status}`);
      assert.equal(canSendQuote(status), expected[status], `canSendQuote ${status}`);
    }
  });

  it('les trois disent la MEME chose, etat par etat', () => {
    // Un devis reecrivable est supprimable et envoyable : les trois gardes
    // decrivent une seule frontiere, celle du brouillon. Si l'une s'en ecartait
    // un jour, ce test le dirait avant le client.
    for (const status of ALL_STATUSES) {
      assert.equal(canEditQuote(status), canDeleteQuote(status), status);
      assert.equal(canEditQuote(status), canSendQuote(status), status);
    }
  });
});

describe('canDecideQuote — les DEUX chemins (acceptation et refus)', () => {
  it('ouvre la decision sur SENT et sur VIEWED', () => {
    // `VIEWED` est une information de lecture : le client a ouvert le document,
    // ce qui ne change rien a son droit de repondre. L'oublier ici bloquerait
    // l'acceptation de tout client curieux qui a consulte le devis avant de
    // signer.
    const expected: Record<QuoteStatus, boolean> = {
      [QuoteStatus.DRAFT]: false,
      [QuoteStatus.SENT]: true,
      [QuoteStatus.VIEWED]: true,
      [QuoteStatus.ACCEPTED]: false,
      [QuoteStatus.REJECTED]: false,
      [QuoteStatus.EXPIRED]: false,
      [QuoteStatus.CANCELLED]: false,
    };

    for (const status of ALL_STATUSES) {
      assert.equal(canDecideQuote(status), expected[status], status);
    }
  });

  it('acceptation et refus s ouvrent EXACTEMENT sur les memes etats', () => {
    // Le service appelle cette meme garde pour les deux routes. Ce test verrouille
    // l'egalite, de sorte qu'une seconde garde (par exemple `canRefuseQuote`)
    // ajoutee un jour sans mettre a jour l'autre fasse echouer la suite.
    for (const status of ALL_STATUSES) {
      assert.equal(
        canDecideQuote(status),
        quoteDecisionBlocker(status) === null,
        `desaccord de frontiere sur ${status}`,
      );
    }
  });
});

describe('canInvoiceQuote', () => {
  it('n ouvre la facturation qu a un devis ACCEPTE', () => {
    for (const status of ALL_STATUSES) {
      assert.equal(canInvoiceQuote(status), status === QuoteStatus.ACCEPTED, status);
    }
  });

  it('refuse un devis seulement ENVOYE — le client n a pas encore dit oui', () => {
    // Facturer une proposition commerciale produirait un document qui est
    // juridiquement un devis et comptablement une facture.
    assert.equal(canInvoiceQuote(QuoteStatus.SENT), false);
    assert.equal(canInvoiceQuote(QuoteStatus.VIEWED), false);
  });
});

describe('isQuoteClosed', () => {
  it('considere closes les quatre sorties definitives', () => {
    const expected: Record<QuoteStatus, boolean> = {
      [QuoteStatus.DRAFT]: false,
      [QuoteStatus.SENT]: false,
      [QuoteStatus.VIEWED]: false,
      [QuoteStatus.ACCEPTED]: true,
      [QuoteStatus.REJECTED]: true,
      [QuoteStatus.EXPIRED]: true,
      [QuoteStatus.CANCELLED]: true,
    };

    for (const status of ALL_STATUSES) {
      assert.equal(isQuoteClosed(status), expected[status], status);
    }
  });

  it('une piece close n est NI reecrivable NI decisionnaire', () => {
    for (const status of ALL_STATUSES) {
      if (isQuoteClosed(status)) {
        assert.equal(canEditQuote(status), false, `reecriture possible sur ${status}`);
        assert.equal(canDecideQuote(status), false, `decision possible sur ${status}`);
      }
    }
  });
});

describe('quoteDecisionBlocker', () => {
  it('donne un motif, et un seul, par etat', () => {
    const expected: Record<QuoteStatus, QuoteDecisionBlocker | null> = {
      // Jamais envoye : rien a accepter, rien a refuser.
      [QuoteStatus.DRAFT]: 'QUOTE_NOT_SENT',
      // Les deux etats ou la decision est attendue.
      [QuoteStatus.SENT]: null,
      [QuoteStatus.VIEWED]: null,
      [QuoteStatus.ACCEPTED]: 'QUOTE_ALREADY_ACCEPTED',
      [QuoteStatus.REJECTED]: 'QUOTE_ALREADY_REJECTED',
      [QuoteStatus.EXPIRED]: 'QUOTE_EXPIRED',
      [QuoteStatus.CANCELLED]: 'QUOTE_CANCELLED',
    };

    for (const status of ALL_STATUSES) {
      assert.equal(quoteDecisionBlocker(status), expected[status], status);
    }
  });

  it('est une FONCTION PURE de l etat : deux appels donnent le meme code', () => {
    // Ce qui est teste ici, c'est l'absence d'effet de bord. Un motif calcule une
    // fois et memorise ferait diverger la premiere et la seconde reponse apres
    // une transition, et le frontend testerait un code qui n'arrive qu'une fois.
    for (const status of ALL_STATUSES) {
      const first = quoteDecisionBlocker(status);
      const second = quoteDecisionBlocker(status);
      assert.equal(first, second, status);
    }
  });

  it('aiguille un devis DEJA accepte vers QUOTE_ALREADY_ACCEPTED, meme pour un refus', () => {
    // Une seconde decision — accepter a nouveau, ou refuser apres coup — se
    // heurte au meme motif. Le dire honnetement (« deja accepte ») vaut mieux
    // qu'un code generique : le frontend affiche un etat, pas une erreur.
    assert.equal(quoteDecisionBlocker(QuoteStatus.ACCEPTED), 'QUOTE_ALREADY_ACCEPTED');
    assert.notEqual(quoteDecisionBlocker(QuoteStatus.ACCEPTED), 'QUOTE_ALREADY_REJECTED');
  });
});

describe('quoteDecisionMessage', () => {
  const BLOCKERS: readonly QuoteDecisionBlocker[] = [
    'QUOTE_ALREADY_ACCEPTED',
    'QUOTE_ALREADY_REJECTED',
    'QUOTE_CANCELLED',
    'QUOTE_EXPIRED',
    'QUOTE_NOT_SENT',
  ];

  it('donne un message non vide pour chaque motif', () => {
    for (const blocker of BLOCKERS) {
      const message = quoteDecisionMessage(blocker);
      assert.equal(typeof message, 'string', blocker);
      assert.ok(message.length > 0, blocker);
      // Le message est destine a un humain : il doit finir par un point, comme
      // tous les autres messages de l'API.
      assert.ok(message.endsWith('.'), blocker);
    }
  });

  it('donne un message DIFFERENT par motif', () => {
    // Deux motifs qui partageraient le meme texte rendraient la distinction
    // inutile, et le code stable serait alors le seul a porter l'information.
    const messages = BLOCKERS.map(quoteDecisionMessage);
    assert.equal(new Set(messages).size, BLOCKERS.length);
  });

  it('couvre tous les motifs produits par quoteDecisionBlocker', () => {
    // La correspondance etat -> motif et motif -> message sont ecrites dans deux
    // fonctions voisines : ce test verifie qu'aucun motif atteignable n'a ete
    // oublie dans la seconde.
    for (const status of ALL_STATUSES) {
      const blocker = quoteDecisionBlocker(status);

      if (blocker !== null) {
        assert.equal(typeof quoteDecisionMessage(blocker), 'string', `${status} -> ${blocker}`);
      }
    }
  });
});
