import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { Request } from 'express';
import {
  clientIp,
  clientUserAgent,
  configureClientIp,
  firstForwardedIp,
  isTrustingProxy,
  parseTrustProxy,
} from './client-ip.js';

/**
 * SPECS DE `client-ip.ts`.
 *
 * Trois choses sont verifiees ici, et la troisieme est la plus importante :
 *
 *  1. La TRADUCTION de `TRUST_PROXY`. C'est le seul endroit du projet ou une
 *     variable d'environnement decide d'un niveau de confiance, et `'false'` y
 *     est une chaine : une faute de frappe doit arreter le demarrage, pas
 *     accorder silencieusement la confiance a tout le monde.
 *  2. La LECTURE de l'en-tete, avec ses cas limites (absent, vide, liste,
 *     entree de tete vide, en-tete repete).
 *  3. Le CHANGEMENT DE MODE. Sans `TRUST_PROXY`, un `x-forwarded-for` forge
 *     gagne — c'est le comportement historique, assume ; avec, il PERD. Cette
 *     bascule est la raison d'etre du fichier, et elle se teste.
 *
 * Aucune base de donnees : ces fonctions ne lisent que deux champs d'une requete.
 */

/**
 * Une requete reduite a ce que ces fonctions lisent : `headers` et `ip`.
 *
 * Un vrai `Request` d'Express exigerait une socket, un serveur et une connexion
 * pour deux proprietes. Le transtypage est ici volontaire et documente : si
 * `client-ip.ts` se met a lire autre chose, ces tests cesseront de le couvrir,
 * ce qui est precisement le signal qu'on veut.
 */
function request(headers: Record<string, string | string[] | undefined>, ip?: string): Request {
  return { headers, ip } as unknown as Request;
}

/** Remet le mode historique avant chaque cas : aucun test n'herite du precedent. */
beforeEach(() => {
  configureClientIp(false);
});

describe('parseTrustProxy', () => {
  it('ne fait confiance a rien par defaut, sous toutes ses ecritures', () => {
    for (const valeur of ['', '   ', 'false', 'FALSE', 'False', 'off', 'no', '0']) {
      assert.equal(parseTrustProxy(valeur), false, `« ${valeur} » devrait valoir false`);
    }
  });

  it('accepte les formes affirmatives', () => {
    for (const valeur of ['true', 'TRUE', 'on', 'yes']) {
      assert.equal(parseTrustProxy(valeur), true, `« ${valeur} » devrait valoir true`);
    }
  });

  it('accepte un nombre de sauts, en NOMBRE et non en chaine', () => {
    // La distinction compte : pour Express, la chaine « 1 » est compilee comme
    // une adresse, alors que le nombre 1 se lit comme un nombre de sauts.
    for (const [valeur, attendu] of [
      ['1', 1],
      ['2', 2],
      ['10', 10],
    ] as const) {
      assert.equal(parseTrustProxy(valeur), attendu);
    }
  });

  it('accepte une liste de proxies, en retirant les espaces', () => {
    assert.deepEqual(parseTrustProxy('loopback'), ['loopback']);
    assert.deepEqual(parseTrustProxy(' 10.0.0.0/8 , 192.168.1.1 '), ['10.0.0.0/8', '192.168.1.1']);
    assert.deepEqual(parseTrustProxy('loopback,linklocal,uniquelocal'), [
      'loopback',
      'linklocal',
      'uniquelocal',
    ]);
  });

  it('REFUSE une valeur qui n est pas un proxy, plutot que de demarrer avec', () => {
    // Le point du fichier : une faute de frappe dans un reglage de confiance ne
    // doit pas etre interpretee. Express leverait de toute facon ; autant que le
    // message nomme la variable fautive.
    for (const valeur of ['garbage', 'proxy-interne', 'tous', 'loopback, n-importe-quoi']) {
      assert.throws(
        () => parseTrustProxy(valeur),
        /TRUST_PROXY/,
        `« ${valeur} » aurait du etre refuse`,
      );
    }
  });
});

describe('isTrustingProxy', () => {
  it('dit non pour tout ce qui desactive la confiance', () => {
    for (const valeur of [false, 0, [] as string[], '', 'false']) {
      configureClientIp(valeur);
      assert.equal(
        isTrustingProxy(),
        false,
        `${JSON.stringify(valeur)} ne devrait pas faire confiance`,
      );
    }
  });

  it('dit oui des qu un saut ou une plage est declare', () => {
    for (const valeur of [true, 1, ['loopback'], 'loopback']) {
      configureClientIp(valeur);
      assert.equal(isTrustingProxy(), true, `${JSON.stringify(valeur)} devrait faire confiance`);
    }
  });
});

describe('firstForwardedIp', () => {
  it('rend null quand l en-tete est absent ou vide', () => {
    assert.equal(firstForwardedIp(request({})), null);
    assert.equal(firstForwardedIp(request({ 'x-forwarded-for': '' })), null);
    assert.equal(firstForwardedIp(request({ 'x-forwarded-for': '   ' })), null);
  });

  it('rend l adresse seule telle quelle', () => {
    assert.equal(firstForwardedIp(request({ 'x-forwarded-for': '203.0.113.7' })), '203.0.113.7');
    assert.equal(firstForwardedIp(request({ 'x-forwarded-for': ' 203.0.113.7 ' })), '203.0.113.7');
  });

  it('rend le PREMIER element d une liste, c est-a-dire le client', () => {
    assert.equal(
      firstForwardedIp(request({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' })),
      '203.0.113.7',
    );
  });

  it('rend null si le premier element est vide', () => {
    // Un proxy qui n'a rien a ecrire laisse une entree vide. Rendre la suivante
    // ferait passer l'adresse d'un proxy interne pour celle du client.
    assert.equal(firstForwardedIp(request({ 'x-forwarded-for': ' , 10.0.0.1' })), null);
  });

  it('lit le premier en-tete quand il est repete', () => {
    assert.equal(
      firstForwardedIp(request({ 'x-forwarded-for': ['203.0.113.7', '198.51.100.9'] })),
      '203.0.113.7',
    );
  });
});

describe('clientIp — mode historique, sans TRUST_PROXY', () => {
  it('prefere l en-tete, meme forge, a l adresse de la socket', () => {
    configureClientIp(false);
    assert.equal(
      clientIp(request({ 'x-forwarded-for': '203.0.113.7' }, '10.0.0.1')),
      '203.0.113.7',
    );
  });

  it('retombe sur l adresse de la socket sans en-tete', () => {
    configureClientIp(false);
    assert.equal(clientIp(request({}, '10.0.0.1')), '10.0.0.1');
  });

  it('rend null quand il n y a ni en-tete ni adresse', () => {
    configureClientIp(false);
    assert.equal(clientIp(request({})), null);
    assert.equal(clientIp(request({}, '')), null);
  });
});

describe('clientIp — mode TRUST_PROXY', () => {
  beforeEach(() => {
    configureClientIp(1);
  });

  it('IGNORE un x-forwarded-for forge et garde ce qu Express a resolu', () => {
    // La propriete qui justifie le reglage : avec un saut de confiance, Express
    // a deja retire ce que le client a pu ecrire en tete de liste.
    assert.equal(clientIp(request({ 'x-forwarded-for': '203.0.113.7' }, '10.0.0.1')), '10.0.0.1');
  });

  it('rend null quand Express n a pas d adresse', () => {
    assert.equal(clientIp(request({ 'x-forwarded-for': '203.0.113.7' })), null);
  });
});

describe('la forme de l adresse enregistree', () => {
  it('retire le prefixe IPv6 d une adresse IPv4', () => {
    // Sans cela, la meme adresse s'ecrirait de deux facons selon la pile reseau.
    configureClientIp(false);
    assert.equal(clientIp(request({}, '::ffff:192.0.2.5')), '192.0.2.5');
    assert.equal(clientIp(request({ 'x-forwarded-for': '::ffff:192.0.2.5' })), '192.0.2.5');
  });

  it('borne une valeur qui n est pas une adresse', () => {
    // 45 = la plus longue adresse IPv6 ecrite en toutes lettres : une adresse
    // reelle ne peut donc pas etre tronquee.
    configureClientIp(false);
    assert.equal(clientIp(request({ 'x-forwarded-for': 'x'.repeat(400) }))?.length, 45);
  });

  it('laisse intacte la plus longue adresse IPv6 possible', () => {
    configureClientIp(false);
    const plusLongue = 'ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255';
    assert.equal(plusLongue.length, 45);
    assert.equal(clientIp(request({}, plusLongue)), plusLongue);
  });
});

describe('clientUserAgent', () => {
  it('rend null quand l en-tete est absent ou vide', () => {
    assert.equal(clientUserAgent(request({})), null);
    assert.equal(clientUserAgent(request({ 'user-agent': '' })), null);
    assert.equal(clientUserAgent(request({ 'user-agent': '   ' })), null);
  });

  it('detoure la valeur', () => {
    assert.equal(clientUserAgent(request({ 'user-agent': '  spec/1.0  ' })), 'spec/1.0');
  });

  it('lit le premier en-tete quand il est repete', () => {
    assert.equal(clientUserAgent(request({ 'user-agent': ['spec/1.0', 'autre/2.0'] })), 'spec/1.0');
  });

  it('borne a 512 caracteres, la valeur venant du client', () => {
    assert.equal(clientUserAgent(request({ 'user-agent': 'a'.repeat(5000) }))?.length, 512);
  });
});
