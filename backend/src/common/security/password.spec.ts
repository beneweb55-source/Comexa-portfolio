import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PASSWORD_MIN_LENGTH,
  generateStrongPassword,
  hashPassword,
  passwordPolicyViolation,
  verifyPassword,
} from './password.js';

/**
 * Tests du hachage et de la politique de mot de passe.
 *
 * Ces tests portent sur une primitive de securite : ils verifient donc moins
 * « la fonction fait ce qu'elle dit » que « la fonction ne peut pas echouer
 * ouverte ». Le cas le plus important est celui de l'empreinte corrompue : une
 * exception qui remonte depuis `verifyPassword` deviendrait, dans un service de
 * connexion mal ecrit, un `catch` qui laisse passer.
 */

describe('hashPassword', () => {
  it('produit une empreinte Argon2id au format PHC', async () => {
    const digest = await hashPassword('UnMotDePasseSolide123');

    // Le prefixe identifie l'algorithme. S'il valait `$argon2i$` ou `$argon2d$`,
    // la configuration aurait silencieusement change de primitive.
    assert.match(digest, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('ne contient jamais le mot de passe en clair', async () => {
    const plain = 'UnMotDePasseSolide123';
    const digest = await hashPassword(plain);

    assert.ok(!digest.includes(plain), "l'empreinte ne doit pas contenir le mot de passe");
  });

  it('produit deux empreintes differentes pour le meme mot de passe (sel unique)', async () => {
    const plain = 'UnMotDePasseSolide123';
    const [a, b] = await Promise.all([hashPassword(plain), hashPassword(plain)]);

    assert.notEqual(a, b, 'deux hachages du meme secret ne doivent pas etre identiques');
  });
});

describe('verifyPassword', () => {
  it('accepte le bon mot de passe', async () => {
    const digest = await hashPassword('UnMotDePasseSolide123');
    assert.equal(await verifyPassword(digest, 'UnMotDePasseSolide123'), true);
  });

  it('refuse un mot de passe different', async () => {
    const digest = await hashPassword('UnMotDePasseSolide123');
    assert.equal(await verifyPassword(digest, 'UnMotDePasseSolide124'), false);
  });

  it('refuse une casse differente', async () => {
    const digest = await hashPassword('UnMotDePasseSolide123');
    assert.equal(await verifyPassword(digest, 'unmotdepassesolide123'), false);
  });

  it('renvoie false sur une empreinte illisible au lieu de lever', async () => {
    // C'est LE test qui compte. Si cette fonction levait, un appelant ecrit
    // `try { ... } catch { return true }` accorderait l'acces. On exige `false`.
    for (const broken of ['', 'pas-une-empreinte', '$argon2id$tronque', '$2b$10$abcdef']) {
      assert.equal(await verifyPassword(broken, 'UnMotDePasseSolide123'), false);
    }
  });
});

describe('generateStrongPassword', () => {
  it('produit 24 caracteres utilisables dans une URL', () => {
    const generated = generateStrongPassword();
    assert.equal(generated.length, 24);
    assert.match(generated, /^[A-Za-z0-9_-]+$/);
  });

  it('ne se repete pas', () => {
    const values = new Set(Array.from({ length: 50 }, () => generateStrongPassword()));
    assert.equal(values.size, 50, 'cinquante appels doivent donner cinquante valeurs distinctes');
  });

  it('satisfait toujours la politique de mot de passe', () => {
    // Un mot de passe genere qui echouerait sa propre politique serait un piege :
    // le seed creerait des comptes que l'API refuserait ensuite de mettre a jour.
    for (let i = 0; i < 100; i += 1) {
      const generated = generateStrongPassword();
      assert.equal(passwordPolicyViolation(generated), null, `refuse a tort : ${generated}`);
    }
  });
});

describe('passwordPolicyViolation', () => {
  const valid = 'UnMotDePasseSolide123';

  it('accepte un mot de passe conforme', () => {
    assert.equal(passwordPolicyViolation(valid), null);
  });

  it('refuse un mot de passe trop court', () => {
    const short = 'Ab1'
      .repeat(Math.ceil((PASSWORD_MIN_LENGTH - 1) / 3))
      .slice(0, PASSWORD_MIN_LENGTH - 1);
    const reason = passwordPolicyViolation(short);
    assert.ok(
      reason && reason.includes(String(PASSWORD_MIN_LENGTH)),
      `raison inattendue : ${reason}`,
    );
  });

  it('refuse sans minuscule, sans majuscule, puis sans chiffre', () => {
    assert.ok(passwordPolicyViolation('UNMOTDEPASSESOLIDE123')?.includes('minuscule'));
    assert.ok(passwordPolicyViolation('unmotdepassesolide123')?.includes('majuscule'));
    assert.ok(passwordPolicyViolation('UnMotDePasseSolide')?.includes('chiffre'));
  });

  it('refuse un mot de passe trop courant', () => {
    assert.ok(passwordPolicyViolation('MotDePasse123')?.includes('courant'));
  });

  it('refuse un mot de passe courant meme deguise par de la ponctuation', () => {
    // Sans normalisation, ajouter un caractere suffisait a contourner la liste :
    // `motdepasse123` etait refuse, `MotDePasse123!` passait.
    // Chaque variante doit deja satisfaire les controles de COMPOSITION, sinon
    // c'est le refus de composition qui s'applique en premier et le test ne
    // prouverait rien sur la liste des mots de passe courants. D'ou la majuscule
    // dans « Mot de passe 123 ».
    for (const disguised of ['MotDePasse123!', 'Mot de passe 123', 'MotDePasse123...']) {
      assert.ok(
        passwordPolicyViolation(disguised)?.includes('courant'),
        `devrait etre refuse : ${disguised}`,
      );
    }
  });

  it('ne refuse pas a tort un mot de passe long qui contient un mot courant', () => {
    // La comparaison est une EGALITE sur la forme normalisee, pas une recherche
    // de sous-chaine : sinon tout mot de passe contenant « password » deviendrait
    // impossible a choisir, ce qui pousserait les utilisateurs vers des variantes
    // plus faibles, pas plus fortes.
    assert.equal(passwordPolicyViolation('MonMotDePasseSolide2026'), null);
  });

  it("refuse un mot de passe qui contient l'adresse e-mail", () => {
    // Cas reel : `sofia.benali` / `Sofia.benali2026!`. La regle ne compare que
    // les caracteres alphanumeriques, donc les points de la partie locale ne la
    // contournent pas.
    const reason = passwordPolicyViolation('Sofia.benali2026', 'sofia.benali@comexa.example');
    assert.ok(reason?.includes('e-mail'), `raison inattendue : ${reason}`);
  });

  it("n'applique pas la regle e-mail quand la partie locale est trop courte", () => {
    // Une partie locale de moins de quatre caracteres produirait des faux
    // positifs absurdes (« ab » est contenu dans beaucoup de mots).
    assert.equal(passwordPolicyViolation('Abcdefghijkl1', 'ab@comexa.example'), null);
  });
});
