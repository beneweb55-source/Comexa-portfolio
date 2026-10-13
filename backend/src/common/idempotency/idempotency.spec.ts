/**
 * LES REGLES D'IDEMPOTENCE, VERIFIEES SANS SERVEUR NI BASE.
 *
 * Ce que ce fichier empeche, en quatre points :
 *
 *   - une cle absente ou mal formee ne doit jamais faire echouer une creation
 *     « normale » : c'est la condition pour poser ce dispositif sur une route en
 *     production ;
 *   - une cle rejouee avec le MEME corps donne la meme reponse — c'est toute
 *     l'utilite de la mecanique ;
 *   - une cle rejouee avec un AUTRE corps est un conflit, pas une occasion de
 *     rendre une reponse qui ne correspond pas a la demande ;
 *   - deux corps equivalents (memes donnees, ordre de cles different) ont la
 *     meme empreinte, sans quoi un rejeu legitime serait pris pour un conflit.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_IDEMPOTENCY_KEY_LENGTH,
  fingerprintOf,
  idempotencyExpiry,
  normalizeIdempotencyKey,
} from './idempotency.js';

describe('cle d’idempotence — validation', () => {
  it('accepte une cle lisible', () => {
    assert.equal(normalizeIdempotencyKey('n8n-creation-tache-001'), 'n8n-creation-tache-001');
    assert.equal(
      normalizeIdempotencyKey('  abcdefgh_1  '),
      'abcdefgh_1',
      'les espaces sont ignores',
    );
  });

  it('refuse une cle absente, vide ou trop courte', () => {
    // Une cle vide ne doit pas devenir « la cle vide » partagee par tous les
    // appels : ce serait une deduplication generalisee, donc une perte de donnees.
    assert.equal(normalizeIdempotencyKey(undefined), null);
    assert.equal(normalizeIdempotencyKey(''), null);
    assert.equal(normalizeIdempotencyKey('   '), null);
    assert.equal(normalizeIdempotencyKey('abc'), null, 'moins de huit caracteres');
    assert.equal(normalizeIdempotencyKey('abcdefgh'), 'abcdefgh', 'huit caracteres suffisent');
    assert.equal(normalizeIdempotencyKey(42), null);
  });

  it('refuse une cle qui sort du motif, meme si elle est longue', () => {
    // Un point, une barre oblique ou une apostrophe : rien qui puisse servir de
    // nom de fichier, de fragment d'URL ou d'injection dans un journal.
    assert.equal(normalizeIdempotencyKey('cle.avec.des.points'), null);
    assert.equal(normalizeIdempotencyKey('cle/avec/slash'), null);
    assert.equal(normalizeIdempotencyKey('clé-avec-accent'), null);
    assert.equal(normalizeIdempotencyKey('a'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1)), null);
  });
});

describe('empreinte du corps', () => {
  it('donne la meme empreinte pour deux corps equivalents', () => {
    // Le cas d'usage : un client qui serialise ses objets dans un ordre different
    // entre deux essais. Sans tri des cles, son rejeu serait refuse.
    assert.equal(fingerprintOf({ a: 1, b: 'x' }), fingerprintOf({ b: 'x', a: 1 }));
    assert.equal(
      fingerprintOf({ nested: { x: [1, 2], y: null } }),
      fingerprintOf({ nested: { y: null, x: [1, 2] } }),
    );
  });

  it('distingue deux corps differents, meme infimes', () => {
    assert.notEqual(fingerprintOf({ title: 'A' }), fingerprintOf({ title: 'B' }));
    assert.notEqual(
      fingerprintOf({ a: 1 }),
      fingerprintOf({ a: '1' }),
      '1 et "1" ne se confondent pas',
    );
    assert.notEqual(fingerprintOf({ a: 1, b: 2 }), fingerprintOf({ a: 1 }));
  });

  it('rend une empreinte stable et non reversible', () => {
    const empreinte = fingerprintOf({ title: 'Maquette' });

    assert.match(empreinte, /^[a-f0-9]{64}$/);
    assert.equal(empreinte, fingerprintOf({ title: 'Maquette' }));
    assert.ok(!empreinte.includes('Maquette'), 'le corps ne doit pas apparaitre dans l’empreinte');
  });

  it('traite un corps vide de facon previsible', () => {
    // Deux requetes sans corps doivent se reconnaitre : c'est le cas d'un POST
    // qui ne prend ses parametres que dans l'URL.
    assert.equal(fingerprintOf(undefined), fingerprintOf(null));
    assert.equal(fingerprintOf({}), fingerprintOf({}));
  });
});

describe('expiration', () => {
  it('borne la duree de conservation a vingt-quatre heures', () => {
    const maintenant = new Date('2026-10-13T10:00:00.000Z');
    const expiration = idempotencyExpiry(maintenant);

    assert.equal(expiration.getTime() - maintenant.getTime(), 24 * 60 * 60 * 1000);
    assert.ok(expiration > maintenant);
  });
});
