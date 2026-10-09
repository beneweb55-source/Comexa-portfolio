import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '../../generated/prisma/client.js';
import {
  amountSection,
  amountString,
  averageOf,
  countOf,
  decimalOf,
  pickPrimaryCurrency,
  primaryAmount,
  ratioOf,
  shareOf,
  sortByAmountDesc,
  sumDecimals,
  type CurrencyAmount,
} from './report-metrics.js';

/**
 * Tests de l'arithmetique des agregats.
 *
 * Les deux proprietes defendues ici sont celles qui cassent en silence : un
 * centime perdu par un flottant, et un `NaN` produit par un jeu de donnees vide.
 */

describe('sumDecimals — exactitude monetaire', () => {
  it('additionne sans perte la ou un flottant deraille', () => {
    // Le cas d'ecole : 0.1 + 0.2 vaut 0.30000000000000004 en binaire.
    const total = sumDecimals([new Prisma.Decimal('0.1'), new Prisma.Decimal('0.2')]);

    assert.equal(total.toFixed(2), '0.30');
    assert.equal(amountString(total), '0.30');
    assert.notEqual(0.1 + 0.2, 0.3);
  });

  it('reste exact sur un cumul de centimes qui deraille en flottant', () => {
    // 12345678.91 + 0.09 : le passage a 12345679.00 est faux en flottant.
    const total = sumDecimals([
      new Prisma.Decimal('12345678.91'),
      new Prisma.Decimal('0.09'),
      new Prisma.Decimal('0.00'),
    ]);

    assert.equal(amountString(total), '12345679.00');
  });

  it('renvoie zero sur une liste vide', () => {
    assert.equal(amountString(sumDecimals([])), '0.00');
  });

  it('ignore les agregats nuls que Prisma renvoie sur une table vide', () => {
    // C'est la forme exacte d'un `aggregate({ _sum: { amount: true } })` qui ne
    // trouve aucune ligne : `{ _sum: { amount: null } }`.
    const total = sumDecimals([null, undefined, new Prisma.Decimal('12.34'), null]);

    assert.equal(amountString(total), '12.34');
    assert.equal(sumDecimals([null, undefined]).toFixed(2), '0.00');
  });

  it('accepte un Decimal, une chaine et un nombre indistinctement', () => {
    assert.equal(amountString(decimalOf('10.10')), '10.10');
    assert.equal(amountString(decimalOf(10)), '10.00');
    assert.equal(amountString(decimalOf(null)), '0.00');
  });

  it('refuse une valeur monetaire illisible plutot que de la remplacer par zero', () => {
    assert.throws(() => decimalOf('douze-euros'));
  });
});

describe('ratioOf — taux de recouvrement', () => {
  it('calcule le rapport des encaissements sur les factures emises', () => {
    assert.equal(ratioOf('4200.00', '10000.00'), 0.42);
    assert.equal(ratioOf('10000.00', '10000.00'), 1);
  });

  it('vaut zero — et non NaN ni infini — quand rien n a ete facture', () => {
    const rate = ratioOf(new Prisma.Decimal(0), new Prisma.Decimal(0));

    assert.equal(rate, 0);
    assert.equal(Number.isNaN(rate), false);
    assert.equal(Number.isFinite(rate), true);
  });

  it('vaut zero quand le denominateur est negatif', () => {
    assert.equal(ratioOf('500.00', '-1.00'), 0);
  });

  it('trouve ses bornes sur les cas nuls que Prisma produit', () => {
    assert.equal(ratioOf(null, null), 0);
    assert.equal(ratioOf(undefined, undefined), 0);
    assert.equal(ratioOf('120.00', null), 0);
    assert.equal(ratioOf(null, '120.00'), 0);
  });

  it('conserve assez de decimales pour ne pas afficher zero sur un petit taux', () => {
    // 4 EUR encaisses sur 10 000 : arrondi a deux decimales, ce serait 0 %.
    assert.equal(ratioOf('4.00', '10000.00'), 0.0004);
  });
});

describe('averageOf et countOf — moyennes sures', () => {
  it('vaut zero quand la moyenne porte sur zero element', () => {
    assert.equal(averageOf(0, 0), 0);
    assert.equal(averageOf(null, 0), 0);
    assert.equal(averageOf(undefined, undefined), 0);
    assert.equal(Number.isNaN(averageOf(null, 0)), false);
  });

  it('arrondit une moyenne reelle a une decimale', () => {
    assert.equal(averageOf(140, 3), 46.7);
  });

  it('ramene un compteur absent ou non numerique a zero', () => {
    assert.equal(countOf(null), 0);
    assert.equal(countOf(undefined), 0);
    assert.equal(countOf(7), 7);
    assert.equal(countOf(Number.NaN), 0);
  });
});

describe('shareOf — part entiere', () => {
  it('vaut zero sur un total nul', () => {
    assert.equal(shareOf(3, 0), 0);
    assert.equal(shareOf(0, 0), 0);
    assert.equal(shareOf(null, null), 0);
  });

  it('calcule une part', () => {
    assert.equal(shareOf(1, 4), 0.25);
  });
});

describe('amountSection — section de montants', () => {
  it('produit une section a zero sur une table vide, jamais null', () => {
    assert.deepEqual(amountSection([]), {
      currency: 'EUR',
      total: '0.00',
      count: 0,
      byCurrency: [],
    });
  });

  it('met en avant la devise dominante et conserve le detail par devise', () => {
    const section = amountSection([
      { currency: 'USD', total: new Prisma.Decimal('1200.00'), count: 2 },
      { currency: 'EUR', total: new Prisma.Decimal('8400.00'), count: 5 },
    ]);

    assert.equal(section.currency, 'EUR');
    assert.equal(section.total, '8400.00');
    assert.equal(section.count, 5);
    assert.equal(section.byCurrency.length, 2);
  });

  it('ramene a zero les sommes nulles rendues sur une table vide', () => {
    const section = amountSection([{ currency: 'EUR', total: null, count: null }]);

    assert.equal(section.total, '0.00');
    assert.equal(section.count, 0);
  });
});

describe('pickPrimaryCurrency — agregats multi-devises', () => {
  const amounts: CurrencyAmount[] = [
    { currency: 'USD', total: '1200.00', count: 2 },
    { currency: 'EUR', total: '8400.00', count: 5 },
    { currency: 'CHF', total: '300.00', count: 1 },
  ];

  it('retient la devise qui porte le montant le plus eleve', () => {
    assert.equal(pickPrimaryCurrency(amounts), 'EUR');
  });

  it('retire les devises a zero du calcul du montant principal', () => {
    const principal = primaryAmount([
      { currency: 'USD', total: '0.00', count: 0 },
      { currency: 'EUR', total: '42.00', count: 1 },
    ]);

    assert.equal(principal.currency, 'EUR');
    assert.equal(principal.total, '42.00');
  });

  it('retombe sur la devise du schema quand la table est vide', () => {
    assert.equal(pickPrimaryCurrency([]), 'EUR');
    assert.deepEqual(primaryAmount([]), { currency: 'EUR', total: '0.00', count: 0 });
  });

  it('tranche alphabetiquement a montants egaux, pour rester stable', () => {
    const tie: CurrencyAmount[] = [
      { currency: 'USD', total: '100.00', count: 1 },
      { currency: 'EUR', total: '100.00', count: 1 },
    ];

    assert.equal(pickPrimaryCurrency(tie), 'EUR');
    assert.equal(pickPrimaryCurrency([...tie].reverse()), 'EUR');
  });

  it('trie par montant decroissant sans muter l entree', () => {
    const original = [...amounts];
    const sorted = sortByAmountDesc(amounts);

    assert.deepEqual(
      sorted.map((entry) => entry.currency),
      ['EUR', 'USD', 'CHF'],
    );
    assert.deepEqual(amounts, original);
  });
});
