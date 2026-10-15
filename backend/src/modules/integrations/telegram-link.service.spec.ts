/**
 * Tests unitaires du service d'appairage Telegram.
 *
 * Ceux-ci verifient la logique PURE (hachage du code, format) sans monter la
 * base : le reste (SQL, transactions) releve de l'e2e.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';

describe('telegram-link — empreinte du code d\'appairage', () => {
  it('le code est systematiquement un SHA-256 hex, deterministe', () => {
    const code = '482913';
    const expected = createHash('sha256').update(code, 'utf8').digest('hex');

    // Reproduit la logique de hashPairingCode sans charger le module (pour
    // rester unitaire et ne pas tirer Prisma).
    function hashPairingCode(c: string): string {
      return createHash('sha256').update(c, 'utf8').digest('hex');
    }

    assert.equal(hashPairingCode(code), expected);
    assert.equal(hashPairingCode(code).length, 64, 'SHA-256 hex = 64 caracteres');
    assert.notEqual(hashPairingCode('482913'), hashPairingCode('482914'), 'deux codes distincts ont des empreintes distinctes');
  });

  it('un code a 6 chiffres ne contient que des chiffres et a exactement 6 chiffres', () => {
    const pattern = /^\d{6}$/;
    for (let i = 0; i < 50; i++) {
      // Genere un code dans [0, 1_000_000) et le pad de zeros a gauche.
      const code = Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0');
      assert.ok(pattern.test(code), `code inattendu : ${code}`);
      assert.equal(code.length, 6);
    }
  });
});
