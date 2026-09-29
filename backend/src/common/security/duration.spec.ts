import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDurationMs } from './duration.js';

describe('parseDurationMs', () => {
  it('convertit chaque unite vers les millisecondes', () => {
    assert.equal(parseDurationMs('45s'), 45_000);
    assert.equal(parseDurationMs('15m'), 900_000);
    assert.equal(parseDurationMs('2h'), 7_200_000);
    assert.equal(parseDurationMs('30d'), 2_592_000_000);
    assert.equal(parseDurationMs('1w'), 604_800_000);
  });

  it('interprete un entier nu comme des secondes', () => {
    assert.equal(parseDurationMs('900'), 900_000);
  });

  it('tolere les espaces autour de la valeur', () => {
    assert.equal(parseDurationMs('  30d  '), 2_592_000_000);
  });

  it('distingue bien les minutes des jours', () => {
    // Le piege que ce fichier existe pour attraper : 'm' = minutes, jamais
    // mois. Une session de 30 "m" comprise comme 30 mois serait un jeton
    // quasi immortel.
    assert.equal(parseDurationMs('30m'), 1_800_000);
    assert.notEqual(parseDurationMs('30m'), parseDurationMs('30d'));
  });

  it('refuse une unite inconnue', () => {
    assert.throws(() => parseDurationMs('30y'), /invalide/);
  });

  it('refuse une valeur vide', () => {
    assert.throws(() => parseDurationMs(''), /vide/);
    assert.throws(() => parseDurationMs('   '), /vide/);
  });

  it('refuse zero et les valeurs negatives', () => {
    assert.throws(() => parseDurationMs('0'), /strictement positive/);
    assert.throws(() => parseDurationMs('0d'), /strictement positive/);
    assert.throws(() => parseDurationMs('-5m'), /invalide/);
  });

  it('refuse une valeur non numerique plutot que de retourner NaN', () => {
    assert.throws(() => parseDurationMs('abc'), /invalide/);
    assert.throws(() => parseDurationMs('d30'), /invalide/);
    assert.throws(() => parseDurationMs('15 m'), /invalide/);
  });

  it('refuse un nombre trop grand pour etre sur', () => {
    assert.throws(() => parseDurationMs('99999999999999999999d'), /invalide|strictement positive/);
  });

  it('nomme la duree fautive dans le message', () => {
    assert.throws(() => parseDurationMs('zzz', 'JWT_REFRESH_TTL'), /JWT_REFRESH_TTL/);
  });
});
