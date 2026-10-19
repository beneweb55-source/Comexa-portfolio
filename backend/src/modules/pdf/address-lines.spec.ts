import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAddressLines, inlineAddress, postalLine } from './address-lines.js';

/**
 * L'adresse est le premier bloc lu sur une facture, et celui qui trahit le plus
 * vite une donnée mal recopiée. Ces tests verrouillent le cas réel de la
 * capture : « Algérie / Algiers / Algérie ».
 */
describe('Lignes d’adresse', () => {
  it('supprime un pays recopié dans la rue', () => {
    assert.deepEqual(buildAddressLines(['Algérie', 'Algiers', 'Algérie']), ['Algérie', 'Algiers']);
  });

  it('écarte les champs vides, les blancs et les valeurs manquantes', () => {
    assert.deepEqual(
      buildAddressLines(['14 quai des Chartrons', '', '   ', null, undefined, 'France']),
      ['14 quai des Chartrons', 'France'],
    );
  });

  it('compare sans casse, sans accents ni ponctuation finale', () => {
    assert.deepEqual(buildAddressLines(['Alger', 'alger.', 'ALGÉRIE', 'Algérie']), [
      'Alger',
      'ALGÉRIE',
    ]);
  });

  it('conserve l’ordre des morceaux, celui de l’adresse postale', () => {
    assert.deepEqual(buildAddressLines(['12 rue Didouche Mourad', '16000 Alger', 'Algérie']), [
      '12 rue Didouche Mourad',
      '16000 Alger',
      'Algérie',
    ]);
  });

  it('ne traite pas deux rues différentes comme un doublon', () => {
    assert.deepEqual(
      buildAddressLines(['14 quai des Chartrons', '14 quai des Chartrons, bâtiment B']),
      ['14 quai des Chartrons', '14 quai des Chartrons, bâtiment B'],
    );
  });

  it('écrit la ligne postale dans l’ordre « code postal puis ville »', () => {
    assert.equal(postalLine('16000', 'Alger'), '16000 Alger');
    assert.equal(postalLine(null, 'Alger'), 'Alger');
    assert.equal(postalLine('16000', undefined), '16000');
    assert.equal(postalLine('  ', '  '), '');
  });

  it('assemble une mention de pied de page sans doublon ni séparateur vide', () => {
    assert.equal(
      inlineAddress(['Comexa', '', '16000 Alger', 'Algérie', 'Algérie', 'RC 16/00-1234567 B 20']),
      'Comexa · 16000 Alger · Algérie · RC 16/00-1234567 B 20',
    );
    assert.equal(inlineAddress([null, undefined, '']), '');
  });
});
