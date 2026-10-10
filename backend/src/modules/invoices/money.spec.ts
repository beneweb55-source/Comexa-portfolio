import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  balanceOf,
  buildLineRows,
  computeLine,
  computeTotals,
  lineTotalDelta,
  money,
  roundMoney,
  storedLineEntries,
  sumLineTotals,
  sumMoney,
  toDecimal,
  toLineEntries,
  zero,
  type LineEntry,
} from './money.js';

/**
 * ARITHMETIQUE DES PIECES COMPTABLES.
 *
 * Ce que ce fichier verifie n'est pas « la fonction fait ce que dit son code » :
 * c'est le COMPORTEMENT ATTENDU PAR UN COMPTABLE, sur les cas ou une
 * implementation plausible se trompe en silence. Quatre d'entre eux sont
 * nommement demandes, et chacun correspond a une erreur qui ne se voit pas a
 * l'oeil sur une facture :
 *
 *  - REMISE DE 0 % et REMISE DE 100 % : les deux bornes de la remise. A 0 %, un
 *    `discountAmount` calcule par soustraction au lieu d'etre nul fait apparaitre
 *    un `-0.00` ou un `0.01` fantome ; a 100 %, un `lineTotal` non ramene a zero
 *    laisse une ligne gratuite facturee.
 *  - TVA A 0 % : le total doit valoir exactement le net, pas le net arrondi une
 *    seconde fois.
 *  - ARRONDI AU CENTIME : `ROUND_HALF_UP`, celui qu'un comptable attend. Un
 *    arrondi bancaire (HALF_EVEN) donnerait 0,50 la ou il attend 0,51, et l'ecart
 *    se cumule sur une annee.
 *  - L'INVARIANT `total == somme des totaux de lignes`, verifie sur des cas
 *    PENIBLES (remise en pourcentage a trois decimales, quantite decimale, TVA a
 *    5,5 %). C'est l'invariant du module : s'il tombe, une facture ne se
 *    rapproche plus de ses lignes.
 *
 * Aucun test ici ne touche la base : `money.ts` est du calcul pur, et c'est
 * precisement pour cela qu'il est testable ainsi.
 */

/** Raccourci de lisibilite : la chaine a deux decimales d'un montant. */
function fixed(value: unknown): string {
  return money(value as string).toFixed(2);
}

describe('toDecimal', () => {
  it('convertit un nombre par sa representation decimale, pas par son binaire', () => {
    // 19.99 n'existe pas en binaire. `new Decimal(19.99)` passe par
    // `Number.prototype.toString`, qui redonne « 19.99 » : la valeur est exacte.
    assert.equal(fixed(toDecimal(19.99)), '19.99');
    assert.equal(fixed(toDecimal(0.1)), '0.10');
    assert.equal(fixed(toDecimal('19.99')), '19.99');
  });

  it('rend exacte l addition qui echoue en flottant', () => {
    // `0.1 + 0.2 !== 0.3` en IEEE 754 : c'est la raison d'etre de ce fichier.
    assert.notEqual(0.1 + 0.2, 0.3);
    assert.equal(toDecimal(0.1).plus(toDecimal(0.2)).equals(toDecimal(0.3)), true);
  });

  it('renvoie la MEME instance quand on lui passe deja un Decimal', () => {
    const value = money('12.34');
    assert.equal(toDecimal(value), value);
  });
});

describe('roundMoney', () => {
  it('arrondit au plus proche, les .5 AU-DESSUS', () => {
    // `ROUND_HALF_UP` : l'arrondi commercial. `ROUND_HALF_EVEN` donnerait 1.00
    // et 0.50, soit un centime perdu a chaque fois.
    assert.equal(fixed(roundMoney('1.005')), '1.01');
    assert.equal(fixed(roundMoney('1.015')), '1.02');
    assert.equal(fixed(roundMoney('2.345')), '2.35');
    assert.equal(fixed(roundMoney('0.005')), '0.01');
  });

  it('laisse intact ce qui tient deja en deux decimales', () => {
    assert.equal(fixed(roundMoney('100.00')), '100.00');
    assert.equal(fixed(roundMoney('0.01')), '0.01');
    assert.equal(fixed(roundMoney('0')), '0.00');
  });
});

describe('sumMoney / zero', () => {
  it('somme sans arrondir — les operandes sont deja au centime', () => {
    assert.equal(fixed(sumMoney([money('0.1'), money('0.2')])), '0.30');
    assert.equal(fixed(zero()), '0.00');
    assert.equal(fixed(sumMoney([])), '0.00');
  });

  it('reste exact sur une longue serie', () => {
    // Cent fois 0.01 : en flottant, la somme derive tres vite.
    const centimes = Array.from({ length: 100 }, () => money('0.01'));
    assert.equal(fixed(sumMoney(centimes)), '1.00');
  });
});

describe('computeLine', () => {
  it('remise de 0 % : le total de ligne est le produit brut', () => {
    const line = computeLine({ quantity: 3, unitPrice: '19.99', discountPercent: 0 });
    assert.equal(fixed(line.gross), '59.97');
    assert.equal(fixed(line.discountAmount), '0.00');
    assert.equal(fixed(line.lineTotal), '59.97');
  });

  it('remise de 100 % : la ligne vaut ZERO, et rien ne subsiste', () => {
    const line = computeLine({ quantity: 2, unitPrice: '150.00', discountPercent: 100 });
    assert.equal(fixed(line.gross), '300.00');
    assert.equal(fixed(line.discountAmount), '300.00');
    // Un `lineTotal` non ramene a zero ferait facturer une ligne annoncee
    // gratuite, et le total du document ne serait plus la somme de ses lignes.
    assert.equal(fixed(line.lineTotal), '0.00');
    assert.equal(line.lineTotal.isNegative(), false);
  });

  it('arrondit le produit d une quantite decimale', () => {
    // 1,5 x 0,333 = 0,4995 -> 0,50 (HALF_UP). C'est le cas des quantites en
    // heures ou en jours, qui ne sont pas des entiers.
    const line = computeLine({ quantity: '1.5', unitPrice: '0.333', discountPercent: 0 });
    assert.equal(fixed(line.gross), '0.50');
    assert.equal(fixed(line.lineTotal), '0.50');
  });

  it('arrondit la REMISE, pas le total de ligne par soustraction', () => {
    // 10 x 33,333 % = 3,3333 -> 3,33 de remise, donc 6,67 de net. Calculer le
    // net d'abord puis la remise par soustraction donnerait un centime d'ecart
    // selon le sens de l'arrondi.
    const line = computeLine({ quantity: 1, unitPrice: '10.00', discountPercent: '33.333' });
    assert.equal(fixed(line.discountAmount), '3.33');
    assert.equal(fixed(line.lineTotal), '6.67');
  });

  it('gere une quantite nulle sans produire de montant negatif', () => {
    const line = computeLine({ quantity: 0, unitPrice: '99.99', discountPercent: 50 });
    assert.equal(fixed(line.gross), '0.00');
    assert.equal(fixed(line.lineTotal), '0.00');
  });
});

describe('computeTotals', () => {
  it('TVA a 0 % : le total vaut EXACTEMENT le net', () => {
    const totals = computeTotals([{ quantity: 4, unitPrice: '25.00', discountPercent: 0 }], 0);
    assert.equal(fixed(totals.subtotal), '100.00');
    assert.equal(fixed(totals.discountAmount), '0.00');
    assert.equal(fixed(totals.taxAmount), '0.00');
    assert.equal(fixed(totals.total), '100.00');
  });

  it('applique la TVA de la piece, sur le net remise deduite', () => {
    // Convention retenue : la TVA se calcule sur le net. Le jeu de donnees est
    // choisi pour que les deux lectures (sur le brut, sur le net) DIFFERENT :
    // 100 - 10 = 90, TVA 20 % = 18, total 108. Sur le brut, on lirait 120.
    const totals = computeTotals([{ quantity: 1, unitPrice: '100.00', discountPercent: 10 }], 20);
    assert.equal(fixed(totals.subtotal), '100.00');
    assert.equal(fixed(totals.discountAmount), '10.00');
    assert.equal(fixed(totals.taxAmount), '18.00');
    assert.equal(fixed(totals.total), '108.00');
  });

  it('arrondit la TVA au centime, une seule fois', () => {
    // 19,99 x 20 % = 3,998 -> 4,00.
    const totals = computeTotals([{ quantity: 1, unitPrice: '19.99', discountPercent: 0 }], 20);
    assert.equal(fixed(totals.taxAmount), '4.00');
    assert.equal(fixed(totals.total), '23.99');
  });

  it('remise de 100 % sur toute la piece : un total nul, TVA comprise', () => {
    const totals = computeTotals(
      [
        { quantity: 2, unitPrice: '100.00', discountPercent: 100 },
        { quantity: 1, unitPrice: '50.50', discountPercent: 100 },
      ],
      20,
    );
    assert.equal(fixed(totals.subtotal), '250.50');
    assert.equal(fixed(totals.discountAmount), '250.50');
    assert.equal(fixed(totals.taxAmount), '0.00');
    assert.equal(fixed(totals.total), '0.00');
  });

  it('recopie le taux sur le document, tel qu il sera stocke', () => {
    const totals = computeTotals([{ quantity: 1, unitPrice: '10.00', discountPercent: 0 }], '5.5');
    assert.equal(totals.taxRate.toFixed(2), '5.50');
    assert.equal(fixed(totals.taxAmount), '0.55');
    assert.equal(fixed(totals.total), '10.55');
  });

  it('accepte une piece SANS ligne : tout est nul, rien ne plante', () => {
    const totals = computeTotals([], 20);
    assert.equal(fixed(totals.total), '0.00');
    assert.equal(totals.lines.length, 0);
    assert.equal(lineTotalDelta(totals).equals(zero()), true);
  });
});

describe('INVARIANT : total == somme des totaux de lignes', () => {
  /**
   * `subtotal - discountAmount == somme(lineTotal)`, ecart nul.
   *
   * Ce n'est pas une propriete decorative : c'est elle qui garantit qu'une
   * facture se rapproche de ses lignes. Les jeux ci-dessous sont choisis pour
   * etre PENIBLES — pourcentages a trois decimales, quantites fractionnaires,
   * taux a 5,5 % — parce qu'un invariant qui ne tient que sur des nombres ronds
   * ne prouve rien.
   */
  const cases: readonly {
    readonly name: string;
    readonly entries: readonly LineEntry[];
    readonly rate: string;
  }[] = [
    {
      name: 'remise 0 %, TVA 20 %',
      entries: [
        { title: 'A', description: null, quantity: 3, unitPrice: '19.99', discountPercent: 0 },
        { title: 'B', description: null, quantity: 1, unitPrice: '149.00', discountPercent: 0 },
      ],
      rate: '20',
    },
    {
      name: 'remise 100 % sur une ligne, 7,5 % sur une autre',
      entries: [
        {
          title: 'Offerte',
          description: null,
          quantity: 1,
          unitPrice: '89.90',
          discountPercent: 100,
        },
        {
          title: 'Remisee',
          description: null,
          quantity: 2,
          unitPrice: '33.33',
          discountPercent: '7.5',
        },
      ],
      rate: '20',
    },
    {
      name: 'quantite fractionnaire et remise a trois decimales',
      entries: [
        {
          title: 'Heures',
          description: null,
          quantity: '2.75',
          unitPrice: '61.70',
          discountPercent: '12.345',
        },
        {
          title: 'Jours',
          description: null,
          quantity: '0.333',
          unitPrice: '450.00',
          discountPercent: '3.333',
        },
      ],
      rate: '5.5',
    },
    {
      name: 'TVA 0 %',
      entries: [
        {
          title: 'Detaxe',
          description: null,
          quantity: 7,
          unitPrice: '0.07',
          discountPercent: '1.5',
        },
      ],
      rate: '0',
    },
    {
      name: 'centimes serres',
      entries: [
        {
          title: 'Petit',
          description: null,
          quantity: 1,
          unitPrice: '0.01',
          discountPercent: '33.333',
        },
        {
          title: 'Autre',
          description: null,
          quantity: 3,
          unitPrice: '0.01',
          discountPercent: '0.001',
        },
      ],
      rate: '20',
    },
  ];

  for (const testCase of cases) {
    it(`tient sur : ${testCase.name}`, () => {
      const totals = computeTotals(testCase.entries, testCase.rate);

      // L'ecart est nul, et il est compare en Decimal — pas apres conversion en
      // flottant, ce qui reintroduirait exactement le bruit que le noyau evite.
      assert.equal(lineTotalDelta(totals).equals(zero()), true, 'ecart de lignes non nul');
      assert.equal(lineTotalDelta(totals).toFixed(2), '0.00');
      assert.equal(
        sumLineTotals(totals.lines).equals(totals.subtotal.minus(totals.discountAmount)),
        true,
      );
      assert.equal(
        totals.total.equals(totals.subtotal.minus(totals.discountAmount).plus(totals.taxAmount)),
        true,
      );
    });
  }

  it('tient ligne par ligne, pas seulement sur le total', () => {
    // Un total juste peut cacher deux erreurs opposees. On refait donc le calcul
    // de chaque ligne a la main, depuis ses propres entrees.
    const entries: readonly LineEntry[] = [
      {
        title: 'A',
        description: null,
        quantity: '3.5',
        unitPrice: '12.99',
        discountPercent: '7.25',
      },
      { title: 'B', description: null, quantity: 1, unitPrice: '1000.00', discountPercent: '0.5' },
      { title: 'C', description: null, quantity: 12, unitPrice: '0.99', discountPercent: 0 },
    ];
    const totals = computeTotals(entries, '5.5');

    for (const [index, line] of totals.lines.entries()) {
      const recomputed = computeLine(line);
      assert.equal(
        recomputed.lineTotal.equals(line.lineTotal),
        true,
        `ligne ${String(index)} (${entries[index]?.title ?? '?'})`,
      );
    }
  });
});

describe('balanceOf', () => {
  it('rend le reste du', () => {
    assert.equal(fixed(balanceOf('1000.00', '400.00')), '600.00');
  });

  it('rend ZERO quand la facture est soldee', () => {
    assert.equal(fixed(balanceOf('1000.00', '1000.00')), '0.00');
  });

  it('ne rend JAMAIS un solde negatif sur un trop-percu', () => {
    // Un trop-percu n'est pas une dette de l'agence dans ce modele : c'est un
    // avoir. Un solde negatif afficherait « -200,00 » au client et ferait
    // echouer le controle `amount > balance` de la route de paiement.
    assert.equal(fixed(balanceOf('1000.00', '1200.00')), '0.00');
    assert.equal(balanceOf('1000.00', '1200.00').isNegative(), false);
  });

  it('reste exact en centimes', () => {
    assert.equal(fixed(balanceOf('0.03', '0.01')), '0.02');
    assert.equal(fixed(balanceOf('19.99', '9.99')), '10.00');
  });
});

describe('toLineEntries', () => {
  it('applique les defauts de la COLONNE : quantite 1, remise 0', () => {
    // `plainToInstance` n'applique pas les initialiseurs de classe, et Prisma ne
    // les voit pas cote calcul : sans cette normalisation, une ligne sans
    // quantite vaudrait `undefined` dans la multiplication, donc `NaN`.
    const entries = toLineEntries([{ title: 'Forfait', unitPrice: '500.00' }]);
    const first = entries[0];

    assert.ok(first);
    assert.equal(money(first.quantity).toFixed(2), '1.00');
    assert.equal(money(first.discountPercent).toFixed(2), '0.00');
    assert.equal(first.description, null);
  });

  it('ne remplace pas une quantite explicitement nulle', () => {
    const entries = toLineEntries([{ title: 'A', unitPrice: '10.00', quantity: 0 }]);
    const first = entries[0];

    assert.ok(first);
    assert.equal(money(first.quantity).toFixed(2), '0.00');
  });
});

describe('storedLineEntries', () => {
  it('relit une ligne stockee sans inverser quantite et prix', () => {
    // Le risque de cette fonction est reel et silencieux : intervertir
    // `quantity` et `unitPrice` ne change pas la FORME du document, seulement
    // son montant.
    const entries = storedLineEntries([
      {
        title: 'A',
        description: 'desc',
        quantity: '2.5',
        unitPrice: '40.00',
        discountPercent: '10',
      },
    ]);
    const first = entries[0];

    assert.ok(first);
    assert.equal(money(first.quantity).toFixed(2), '2.50');
    assert.equal(money(first.unitPrice).toFixed(2), '40.00');
    assert.equal(money(first.discountPercent).toFixed(2), '10.00');
    assert.equal(first.title, 'A');
    assert.equal(first.description, 'desc');
  });

  it('redonne le meme total que le calcul d origine', () => {
    // Le vrai enjeu : une facture generee depuis un devis recalcule ses totaux
    // a partir des lignes stockees. Si cette relecture perdait un centime, le
    // controle `QUOTE_LINES_INCONSISTENT` refuserait une facture pourtant juste.
    const entries: readonly LineEntry[] = [
      { title: 'A', description: null, quantity: '2.5', unitPrice: '40.00', discountPercent: '10' },
      { title: 'B', description: null, quantity: 1, unitPrice: '99.99', discountPercent: '33.333' },
    ];
    const original = computeTotals(entries, '20');

    const stored = storedLineEntries(
      original.lines.map((line) => ({
        title: 'x',
        description: null,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
      })),
    );
    const replay = computeTotals(stored, '20');

    assert.equal(replay.total.equals(original.total), true);
    assert.equal(replay.subtotal.equals(original.subtotal), true);
    assert.equal(replay.taxAmount.equals(original.taxAmount), true);
  });
});

describe('buildLineRows', () => {
  const entries: readonly LineEntry[] = [
    { title: 'Premiere', description: 'd1', quantity: 2, unitPrice: '10.00', discountPercent: 0 },
    { title: 'Seconde', description: null, quantity: 1, unitPrice: '5.00', discountPercent: '50' },
  ];

  it('numerote les positions de 1 a n, dans l ordre', () => {
    const totals = computeTotals(entries, 20);
    const rows = buildLineRows(entries, totals, 20);

    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.position, 1);
    assert.equal(rows[1]?.position, 2);
    assert.equal(rows[0]?.title, 'Premiere');
    assert.equal(rows[1]?.title, 'Seconde');
  });

  it('ecrit le total de LA ligne, pas celui du document', () => {
    const totals = computeTotals(entries, 20);
    const rows = buildLineRows(entries, totals, 20);

    assert.equal(rows[0]?.lineTotal.toFixed(2), '20.00');
    assert.equal(rows[1]?.lineTotal.toFixed(2), '2.50');
    assert.equal(rows[0]?.discountPercent.toFixed(2), '0.00');
    assert.equal(rows[1]?.discountPercent.toFixed(2), '50.00');
  });

  it('recopie le taux sur chaque ligne, sans qu il serve au calcul', () => {
    const totals = computeTotals(entries, '5.5');
    const rows = buildLineRows(entries, totals, '5.5');

    assert.equal(rows[0]?.taxRate.toFixed(2), '5.50');
    assert.equal(rows[1]?.taxRate.toFixed(2), '5.50');
  });

  it('REFUSE une incoherence entre entrees et lignes calculees', () => {
    // Choix assume : lever une erreur franche plutot que d'ecrire un document
    // tronque. Un document dont les lignes ne correspondent pas aux totaux est
    // un document faux, pas une erreur visible.
    const totals = computeTotals(entries, 20);
    assert.throws(
      () => buildLineRows([entries[0] as LineEntry], totals, 20),
      /Lignes incoherentes/,
    );
  });
});
