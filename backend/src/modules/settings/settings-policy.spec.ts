import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException } from '../../common/errors/app-error.js';
import {
  SETTING_KEY_MAX_LENGTH,
  SETTING_STRING_MAX_LENGTH,
  SETTING_VALUE_MAX_DEPTH,
  assertSettingKey,
  assertSettingValueSize,
  auditSettingValue,
  canonicalJson,
  isInternalSetting,
  isValidSettingKey,
  normalizeSettingKey,
  normalizeSettingValue,
  sameSettingValue,
} from './settings-policy.js';

/**
 * Tests de la politique des parametres.
 *
 * Deux proprietes sont defendues ici :
 *
 *  - une cle mal nommee est REFUSEE, jamais corrigee en silence ;
 *  - un parametre sensible est reconnu comme tel, y compris quand son nom est
 *    ambigu, parce que le sens de l'erreur est choisi : on cache trop.
 */

function assertCode(run: () => unknown, code: string): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof AppException, `attendu AppException, recu ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

describe('isValidSettingKey — format des cles', () => {
  it('accepte les cles en minuscules a segments separes', () => {
    for (const key of [
      'company.name',
      'invoice.numbering.prefix',
      'smtp_host',
      'payment-terms',
      '2fa.enabled',
      'currency',
      'a',
    ]) {
      assert.equal(isValidSettingKey(key), true, key);
    }
  });

  it('refuse les majuscules au lieu de les corriger', () => {
    // `@id` est sensible a la casse : accepter `Company.Name` creerait un second
    // parametre, et l'application en lirait un en ecrivant l'autre.
    assert.equal(isValidSettingKey('Company.Name'), false);
    assert.equal(isValidSettingKey('company.NAME'), false);
  });

  it('refuse les separateurs mal places et les caracteres etrangers', () => {
    for (const key of ['company..name', '.company', 'company.', 'company name', 'company/name', 'company:name', '', ' ']) {
      assert.equal(isValidSettingKey(key), false, `« ${key} » aurait du etre refuse`);
    }
  });

  it('refuse une cle plus longue que la limite', () => {
    assert.equal(isValidSettingKey('a'.repeat(SETTING_KEY_MAX_LENGTH)), true);
    assert.equal(isValidSettingKey('a'.repeat(SETTING_KEY_MAX_LENGTH + 1)), false);
  });

  it('normalise en retirant les espaces et la casse, sans jamais l utiliser pour valider', () => {
    assert.equal(normalizeSettingKey('  Company.Name  '), 'company.name');
    // La normalisation ne rend pas valide : la validation porte sur la valeur brute.
    assert.equal(isValidSettingKey('  company.name  '), false);
  });

  it('refuse une cle invalide avec un code stable', () => {
    assertCode(() => assertSettingKey('Company.Name'), 'SETTING_KEY_INVALID');
    assert.equal(assertSettingKey('company.name'), 'company.name');
  });
});

describe('isInternalSetting — ce qui doit etre masque', () => {
  it('masque les cles marquees explicitement', () => {
    assert.equal(isInternalSetting('internal.smtp'), true);
    assert.equal(isInternalSetting('private.notes'), true);
  });

  it('masque un segment nomme comme une credential', () => {
    assert.equal(isInternalSetting('bank.iban'), true);
    assert.equal(isInternalSetting('stripe.api_key'), true);
    assert.equal(isInternalSetting('oauth.client_secret'), true);
    assert.equal(isInternalSetting('mailer.password'), true);
  });

  it('masque un fragment sans ambiguite, meme sans separateur', () => {
    assert.equal(isInternalSetting('stripe.secretKey'), true);
    assert.equal(isInternalSetting('google.apikey'), true);
  });

  it('laisse visibles les parametres d affichage et de facturation', () => {
    // Le cas qui doit rester lisible : une page de reglages vide parce que tout
    // est juge sensible serait inutilisable.
    for (const key of [
      'company.name',
      'company.legal.address',
      'invoice.numbering.prefix',
      'invoice.payment_terms_days',
      'currency.default',
      'vat.rate',
      'timezone',
      'notifications.email.enabled',
    ]) {
      assert.equal(isInternalSetting(key), false, key);
    }
  });

  it('cache aussi quand le fragment est sans ambiguite, meme colle au mot', () => {
    // Direction de l'erreur assumee : `tokenizer.mode` n'est probablement pas un
    // secret, mais il contient « token ». On le cache — l'administrateur le voit
    // en cochant `includeInternal`. L'inverse ne se rattrape pas.
    assert.equal(isInternalSetting('tokenizer.mode'), true);
  });

  it('ne confond pas un SEGMENT avec un mot plus long qui le contient', () => {
    // `keyboard` contient « key » mais n'est pas le segment « key » : la regle
    // par segment le laisse passer, sinon tout nom de parametre contenant trois
    // lettres deviendrait sensible.
    assert.equal(isInternalSetting('ui.keyboard.layout'), false);
  });

  it('reconnait la casse et les espaces', () => {
    assert.equal(isInternalSetting('SMTP.PASSWORD'), true);
    assert.equal(isInternalSetting('  secret.token  '), true);
  });
});

describe('normalizeSettingValue — ce qui peut entrer en base', () => {
  it('accepte les types JSON simples', () => {
    assert.equal(normalizeSettingValue('Comexa'), 'Comexa');
    assert.equal(normalizeSettingValue(42), 42);
    assert.equal(normalizeSettingValue(0), 0);
    assert.equal(normalizeSettingValue(false), false);
    assert.deepEqual(normalizeSettingValue({ a: 1, b: [true, 'x'] }), { a: 1, b: [true, 'x'] });
  });

  it('accepte null imbrique mais refuse une valeur vide a la racine', () => {
    assert.deepEqual(normalizeSettingValue({ a: null }), { a: null });
    assertCode(() => normalizeSettingValue(null), 'SETTING_VALUE_INVALID');
    assertCode(() => normalizeSettingValue(undefined), 'SETTING_VALUE_INVALID');
  });

  it('refuse ce qui n est pas serialisable en JSON', () => {
    assertCode(() => normalizeSettingValue(() => 1), 'SETTING_VALUE_INVALID');
    assertCode(() => normalizeSettingValue(Symbol('x')), 'SETTING_VALUE_INVALID');
    assertCode(() => normalizeSettingValue(Number.NaN), 'SETTING_VALUE_INVALID');
    assertCode(() => normalizeSettingValue(Number.POSITIVE_INFINITY), 'SETTING_VALUE_INVALID');
    assertCode(() => normalizeSettingValue(new Date()), 'SETTING_VALUE_INVALID');
    assertCode(() => normalizeSettingValue(new Map()), 'SETTING_VALUE_INVALID');
  });

  it('accepte l imbrication a la limite et refuse au dela', () => {
    const wrap = (levels: number): unknown => {
      let value: unknown = 'fond';
      for (let level = 0; level < levels; level += 1) {
        value = { niveau: value };
      }
      return value;
    };

    assert.equal(normalizeSettingValue(wrap(SETTING_VALUE_MAX_DEPTH)) !== undefined, true);
    assertCode(
      () => normalizeSettingValue(wrap(SETTING_VALUE_MAX_DEPTH + 1)),
      'SETTING_VALUE_INVALID',
    );
  });

  it('refuse une valeur trop volumineuse', () => {
    assertCode(
      () => normalizeSettingValue('x'.repeat(SETTING_STRING_MAX_LENGTH + 1)),
      'SETTING_VALUE_INVALID',
    );
    assertCode(() => assertSettingValueSize('x'.repeat(40_000)), 'SETTING_VALUE_TOO_LARGE');
    // Une petite valeur passe sans etre transformee.
    assert.deepEqual(assertSettingValueSize({ a: 1 }), { a: 1 });
  });
});

describe('sameSettingValue — comparer deux valeurs', () => {
  it('ignore l ordre des cles', () => {
    assert.equal(sameSettingValue({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  });

  it('distingue les valeurs differentes, meme imbriquees', () => {
    assert.equal(sameSettingValue({ a: [1, 2] }, { a: [1, 2] }), true);
    assert.equal(sameSettingValue({ a: [1, 2] }, { a: [2, 1] }), false);
    assert.equal(sameSettingValue({ a: 1 }, { a: '1' }), false);
    assert.equal(sameSettingValue(null, { a: 1 }), false);
  });

  it('produit une serialisation stable', () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  });
});

describe('auditSettingValue — ce qui part dans le journal', () => {
  it('masque la valeur d un parametre interne', () => {
    // Sans cela, faire tourner un secret l'ecrirait en clair dans un journal
    // lisible par tous les administrateurs, et pour toujours.
    assert.equal(auditSettingValue('super-secret', true), '[masque : parametre interne]');
  });

  it('conserve la valeur d un parametre ordinaire', () => {
    assert.equal(auditSettingValue('Comexa', false), 'Comexa');
  });
});
