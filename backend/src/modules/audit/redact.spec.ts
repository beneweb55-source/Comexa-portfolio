import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isSensitiveKey,
  looksLikeCredential,
  MASK,
  redactJson,
  redactPayload,
  TRUNCATED,
} from './redact.js';

/**
 * TESTS DU MASQUAGE.
 *
 * Le masquage est une protection dont l'echec est SILENCIEUX : un filtre casse
 * ne fait rien planter, il rend simplement la charge utile telle quelle. Le seul
 * moyen de savoir qu'il fonctionne encore est de l'attaquer sur les formes qu'un
 * service produirait reellement — un objet Prisma recopie, un DTO etale, un
 * tableau de liens.
 *
 * Les assertions comparent l'objet ENTIER (`deepEqual`) plutot que la seule
 * valeur masquee. C'est delibere : cela verifie aussi que le reste de la charge
 * utile est preserve, donc qu'une evolution du filtre ne se met pas a tout
 * masquer — un journal dont toutes les valeurs sont masquees ne sert plus a rien,
 * et personne ne s'en apercevrait avant d'en avoir besoin.
 */

/** Un JWT bien forme : trois segments, l'en-tete commencant par `eyJ`. */
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJpYXQiOjE3MDAwMDAwMDB9.c2lnbmF0dXJl';

describe('isSensitiveKey', () => {
  it('reconnait les noms qui trahissent un secret, quelle que soit la convention', () => {
    // Les trois ecritures d'un meme champ : camelCase, snake_case, et un
    // en-tete HTTP. C'est la normalisation qui les ramene toutes au meme motif.
    for (const key of [
      'password',
      'passwordHash',
      'password_hash',
      'Password-Hash',
      'newPassword',
      'currentPassword',
      'passwordConfirmation',
      'mustChangePassword',
      'token',
      'refreshToken',
      'access_token',
      'x-api-key',
      'apiKey',
      'privateKey',
      'signing_key',
      'secret',
      'clientSecret',
      'Authorization',
      'cookie',
      'signature',
      'salt',
    ]) {
      assert.equal(isSensitiveKey(key), true, `${key} doit etre sensible`);
    }
  });

  it('laisse passer les noms anodins', () => {
    for (const key of [
      'email',
      'firstName',
      'lastName',
      'phone',
      'status',
      'roles',
      'deleted',
      'entityType',
      'entityId',
      'activeAdminCount',
      'permissionCodes',
      'description',
    ]) {
      assert.equal(isSensitiveKey(key), false, `${key} ne doit pas etre sensible`);
    }
  });

  it('laisse passer sessionsRevoked', () => {
    // Ce nom contient « session », qui n'est PAS dans le motif. C'est un compte
    // de sessions fermees : le masquer priverait l'auditeur de l'information qui
    // justifie la ligne de journal, pour couvrir un cas que `token` couvre deja.
    assert.equal(isSensitiveKey('sessionsRevoked'), false);
  });

  it('ne confond pas un mot contenant « pin » avec un code secret', () => {
    // « mapping » contient `pin`. Un motif qui chercherait `pin` masquerait des
    // champs anodins des qu'un module parle de correspondance ou de cartographie.
    assert.equal(isSensitiveKey('mapping'), false);
    assert.equal(isSensitiveKey('shippingAddress'), false);
  });
});

describe('looksLikeCredential', () => {
  it('reconnait un JWT', () => {
    assert.equal(looksLikeCredential(JWT), true);
  });

  it('reconnait un en-tete Authorization recopie', () => {
    assert.equal(looksLikeCredential(`Bearer ${JWT}`), true);
    assert.equal(looksLikeCredential('bearer abcdef'), true);
  });

  it('laisse passer du texte ordinaire, meme long', () => {
    assert.equal(looksLikeCredential('Le client a demande un report du projet.'), false);
    // Une chaine longue n'est pas un secret en soi : sans le prefixe `eyJ`, ce
    // n'est pas un JWT, et masquer sur la seule longueur rendrait illisible tout
    // commentaire un peu developpe.
    assert.equal(looksLikeCredential('a'.repeat(400)), false);
    // Un texte qui commence par `eyJ` mais n'a pas la forme d'un JWT reste un
    // texte : le motif exige les trois segments.
    assert.equal(looksLikeCredential('eyJhbGciOiJIUzI1NiJ9 pas un jeton'), false);
  });
});

describe('redactJson', () => {
  it('masque une cle sensible a la racine', () => {
    assert.deepEqual(redactJson({ email: 'sofia@comexa.example', passwordHash: 'argon2id$...' }), {
      email: 'sofia@comexa.example',
      passwordHash: MASK,
    });
  });

  it('masque une cle sensible IMBRIQUEE, quelle que soit la profondeur', () => {
    // La forme exacte que produit `{ ...user }` sur une ligne Prisma. Un filtre
    // qui ne regarderait que le premier niveau laisserait passer celle-la.
    assert.deepEqual(
      redactJson({ apres: { utilisateur: { profil: { passwordHash: 'argon2id$...' } } } }),
      { apres: { utilisateur: { profil: { passwordHash: MASK } } } },
    );
  });

  it("masque dans un tableau d'objets", () => {
    // `createMany` de roles : un tableau de liens, chacun portant des champs.
    assert.deepEqual(
      redactJson([
        { roleId: 'r1', accessToken: 'abc' },
        { roleId: 'r2', token: 'def' },
      ]),
      [
        { roleId: 'r1', accessToken: MASK },
        { roleId: 'r2', token: MASK },
      ],
    );
  });

  it('conserve le NOM de la cle masquee', () => {
    // Masquer la cle ferait disparaitre la seule information qui dit qu'un
    // service a tente de journaliser un secret — c'est-a-dire le signal d'alarme.
    const result = redactJson({ refreshToken: 'abc' });
    assert.deepEqual(Object.keys(result as object), ['refreshToken']);
  });

  it('masque un jeton colle sous une cle anodine', () => {
    assert.deepEqual(redactJson({ motif: JWT, note: `Bearer ${JWT}` }), {
      motif: MASK,
      note: MASK,
    });
  });

  it('preserve les valeurs anodines de tous types', () => {
    assert.deepEqual(
      redactJson({
        email: 'sofia@comexa.example',
        status: 'ACTIVE',
        deleted: true,
        activeAdminCount: 2,
        description: null,
        roles: ['DEVELOPER', 'SALES'],
        vide: {},
        listeVide: [],
      }),
      {
        email: 'sofia@comexa.example',
        status: 'ACTIVE',
        deleted: true,
        activeAdminCount: 2,
        description: null,
        roles: ['DEVELOPER', 'SALES'],
        vide: {},
        listeVide: [],
      },
    );
  });

  it('preserve un compte de sessions fermees', () => {
    assert.deepEqual(redactJson({ sessionsRevoked: 3 }), { sessionsRevoked: 3 });
  });

  it('NE MODIFIE PAS la charge utile recue', () => {
    // Le filtre construit un objet neuf. Modifier l'entree en place rendrait la
    // fonction dependante de l'appelant — et un jour quelqu'un la reutiliserait
    // sur une donnee qu'il continue d'utiliser.
    const source = { user: { passwordHash: 'argon2id$...', email: 'sofia@comexa.example' } };
    redactJson(source);
    assert.deepEqual(source, {
      user: { passwordHash: 'argon2id$...', email: 'sofia@comexa.example' },
    });
  });

  it("s'arrete net au-dela de la profondeur maximale", () => {
    let deep: unknown = 'sentinelle';
    for (let level = 0; level < 12; level += 1) {
      deep = { niveau: deep };
    }

    const serialised = JSON.stringify(redactJson(deep));

    assert.ok(serialised.includes(TRUNCATED), 'la coupe doit etre visible dans la reponse');
    assert.ok(!serialised.includes('sentinelle'), 'le fond ne doit pas etre atteint');
  });

  it('rend un texte pour un BigInt plutot que de lever', () => {
    // `JSON.stringify` leve sur un BigInt. Une reponse de journal ne doit pas
    // pouvoir se transformer en erreur 500 pour cette raison.
    assert.deepEqual(redactJson({ total: 12n }), { total: '12' });
  });
});

describe('redactPayload', () => {
  it('rend null pour une colonne vide', () => {
    // `null` et `undefined` sont deux cas distincts : la colonne est nullable, et
    // un appelant peut omettre le champ. Les deux doivent produire `null` dans la
    // reponse, jamais `undefined` — qui disparaitrait a la serialisation JSON et
    // ferait disparaitre la cle du contrat.
    assert.equal(redactPayload(null), null);
    assert.equal(redactPayload(undefined), null);
  });

  it('filtre une charge utile presente', () => {
    assert.deepEqual(redactPayload({ email: 'sofia@comexa.example', token: 'abc' }), {
      email: 'sofia@comexa.example',
      token: MASK,
    });
  });
});
