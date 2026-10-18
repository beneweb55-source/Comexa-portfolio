import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '../../generated/prisma/client.js';
import { parsePercentage, splitAmount, validateShares } from './distribution-math.js';

/**
 * L'ARITHMÉTIQUE DE LA RÉPARTITION, MESURÉE.
 *
 * Ces tests ne vérifient pas « ça marche » : ils vérifient les DEUX
 * propriétés qui rendent une répartition digne de confiance — la somme vaut
 * exactement la base, et l'arrondi est reproductible et expliqué.
 *
 * Le cas le plus important est le dernier : 0,05 DZD réparti en trois parts
 * ne peut pas être exact au centime. La question n'est pas « comment on
 * arrondit ? » mais « la somme est-elle toujours égale à la base ? » — et la
 * réponse doit être oui, à chaque fois.
 */

const dec = (value: string) => new Prisma.Decimal(value);

describe('parsePercentage — la saisie reste du décimal, jamais du flottant', () => {
  it('lit une chaîne décimale sans la déformer', () => {
    assert.equal(parsePercentage('33.33').toString(), '33.33');
    assert.equal(parsePercentage(' 40 ').toString(), '40');
    assert.equal(parsePercentage('12,5').toString(), '12.5');
  });

  it('refuse ce qui n’est pas un pourcentage', () => {
    assert.throws(() => parsePercentage('un tiers'), /pourcentage valide/);
    assert.throws(() => parsePercentage(''), /pourcentage est obligatoire/);
    assert.throws(() => parsePercentage('33.333'), /pourcentage valide/);
    assert.throws(() => parsePercentage('-10'), /pourcentage valide/);
  });
});

describe('validateShares — les quatre interdits', () => {
  const share = (percentage: string, key = 'a', userId: string | null = 'u1') => ({
    key,
    percentage: dec(percentage),
    userId,
    beneficiaryType: 'MEMBER',
  });

  it('accepte un lot qui totalise 100 %', () => {
    const total = validateShares([
      share('50', 'a', 'u1'),
      share('50', 'b', 'u2'),
    ]);
    assert.equal(total.toString(), '100');
  });

  it('refuse un total différent de 100 %', () => {
    assert.throws(
      () => validateShares([share('50', 'a', 'u1'), share('40', 'b', 'u2')]),
      /exactement 100/,
    );
  });

  it('refuse un pourcentage négatif ou nul', () => {
    assert.throws(() => validateShares([share('0')]), /nulle ou négative/);
    assert.throws(() => validateShares([share('-5')]), /nulle ou négative/);
  });

  it('refuse un pourcentage supérieur à 100', () => {
    assert.throws(() => validateShares([share('120')]), /dépasser 100/);
  });

  it('refuse le même membre deux fois', () => {
    assert.throws(
      () => validateShares([share('50', 'a', 'u1'), share('50', 'b', 'u1')]),
      /même membre figure deux fois/,
    );
  });

  it('refuse un bénéficiaire MEMBER sans compte', () => {
    assert.throws(
      () => validateShares([share('50', 'a', null), share('50', 'b', 'u2')]),
      /MEMBER/,
    );
  });

  it('refuse une liste vide', () => {
    assert.throws(() => validateShares([]), /au moins un bénéficiaire/);
  });
});

describe('splitAmount — le plus grand reste', () => {
  it('répartit exactement, sans centime perdu', () => {
    const { results, total } = splitAmount(dec('1000.00'), [
      { key: 'a', percentage: dec('33.33'), userId: 'u1' },
      { key: 'b', percentage: dec('33.33'), userId: 'u2' },
      { key: 'c', percentage: dec('33.34'), userId: 'u3' },
    ]);

    assert.equal(total.toString(), '1000');
    assert.equal(
      results.map((result) => result.amount.toString()).join('|'),
      '333.3|333.3|333.4',
    );
  });

  it('donne le centime restant au plus grand reste', () => {
    // 10 DZD : 33,33 % -> 3,333 ; 33,33 % -> 3,333 ; 33,34 % -> 3,334.
    // Les planchers font 3 + 3 + 3 = 9 : il reste 1 DZD a distribuer.
    const { results, total } = splitAmount(dec('10.00'), [
      { key: 'a', percentage: dec('33.33'), userId: 'u1' },
      { key: 'b', percentage: dec('33.33'), userId: 'u2' },
      { key: 'c', percentage: dec('33.34'), userId: 'u3' },
    ]);

    assert.equal(total.toString(), '10');
    assert.equal(results[0]?.amount.toString(), '3.33');
    assert.equal(results[1]?.amount.toString(), '3.33');
    assert.equal(results[2]?.amount.toString(), '3.34');
  });

  it('départage les ex aequo par l’ordre des lignes, de façon reproductible', () => {
    const shares = [
      { key: 'a', percentage: dec('50'), userId: 'u1' },
      { key: 'b', percentage: dec('50'), userId: 'u2' },
    ];

    // 0,01 DZD : deux parts a 0,005 brut. Le centime va a la PREMIERE ligne,
    // et toujours a elle : le resultat ne doit pas changer d'une execution a
    // l'autre.
    const first = splitAmount(dec('0.01'), shares);
    const second = splitAmount(dec('0.01'), shares);

    assert.equal(first.results[0]?.amount.toString(), '0.01');
    assert.equal(first.results[1]?.amount.toString(), '0');
    assert.equal(first.total.toString(), '0.01');
    assert.deepEqual(
      first.results.map((result) => result.amount.toString()),
      second.results.map((result) => result.amount.toString()),
    );
  });

  it('conserve la somme exacte même quand la base ne se divise pas', () => {
    const { total } = splitAmount(dec('0.05'), [
      { key: 'a', percentage: dec('33.33'), userId: 'u1' },
      { key: 'b', percentage: dec('33.33'), userId: 'u2' },
      { key: 'c', percentage: dec('33.34'), userId: 'u3' },
    ]);

    assert.equal(total.toString(), '0.05');
  });

  it('trace le brut, le plancher, le reste et l’ajustement de chaque part', () => {
    const { results } = splitAmount(dec('10.00'), [
      { key: 'a', percentage: dec('50'), userId: 'u1' },
      { key: 'b', percentage: dec('50'), userId: 'u2' },
    ]);

    const first = results[0];
    assert.ok(first);
    assert.equal(first.raw.toString(), '5');
    assert.equal(first.floor.toString(), '5');
    assert.equal(first.remainder.toString(), '0');
    assert.equal(first.adjustment.toString(), '0');
    assert.equal(first.amount.toString(), '5');
    assert.equal(first.percentage.toString(), '50');
  });

  it('refuse un lot qui ne totalise pas 100 %', () => {
    assert.throws(
      () =>
        splitAmount(dec('100'), [
          { key: 'a', percentage: dec('30'), userId: 'u1' },
          { key: 'b', percentage: dec('30'), userId: 'u2' },
        ]),
      /ne totalisent pas 100/,
    );
  });
});
