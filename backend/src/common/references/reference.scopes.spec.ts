import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatReference } from '../../modules/counters/reference.js';
import { REFERENCE_PREFIXES, REFERENCE_SCOPES } from './reference.scopes.js';

/**
 * CE QUE CE SPEC PROTEGE
 *
 * Le tableau des portees/prefixes est lu par deux camps qui ne peuvent pas
 * s'importer l'un l'autre : `CounterService` (qui numerote) et `prisma/seed.ts`
 * (qui pose les premiers documents). Si les deux divergent, rien ne plante au
 * demarrage : le seed ecrit `PRO-2026-0001` et le service, croyant la portee
 * vierge, renvoie `PRO-2026-0001` a son tour. La collision ne se declare qu'a la
 * PREMIERE creation via l'API, sous forme de violation d'unicite Prisma — donc
 * a un endroit qui ne parle ni de prefixe ni de casse.
 *
 * Un test qui epingle les valeurs vaut mieux qu'un commentaire qui les decrit :
 * un commentaire ne fait echouer aucun build quand il devient faux.
 */

describe('REFERENCE_SCOPES', () => {
  it('declare les dix portees numerotees du domaine', () => {
    assert.deepEqual(Object.keys(REFERENCE_SCOPES).sort(), [
      'CLIENT',
      'CONTACT_REQUEST',
      'INVOICE',
      'MODIFICATION_REQUEST',
      'ORDER',
      'PAYMENT',
      'PROJECT',
      'PROJECT_REQUEST',
      'PROSPECT',
      'QUOTE',
    ]);
  });

  it('ecrit chaque portee en majuscules, sans espace ni accent', () => {
    // La cle primaire de `Counter` est `@@id([scope, year])` : la casse fait
    // partie de l'identite de la ligne, ce n'est pas une coquetterie.
    for (const [name, value] of Object.entries(REFERENCE_SCOPES)) {
      assert.equal(value, value.toUpperCase(), `${name} doit etre en majuscules`);
      assert.match(value, /^[A-Z][A-Z0-9_]*$/, `${name} doit etre un identifiant simple`);
    }
  });

  it('donne a chaque portee une valeur egale a son nom', () => {
    // `REFERENCE_SCOPES.PROSPECT === 'PROSPECT'`. La redondance est assumee :
    // la constante evite les chaines nues dans le code, et la valeur est ce qui
    // finit en base. Un ecart entre les deux signifierait que le nom du champ et
    // la ligne `counters` ne designent plus la meme portee.
    for (const [name, value] of Object.entries(REFERENCE_SCOPES)) {
      assert.equal(value, name);
    }
  });
});

describe('REFERENCE_PREFIXES', () => {
  it('couvre exactement les portees declarees, ni plus ni moins', () => {
    assert.deepEqual(Object.keys(REFERENCE_PREFIXES).sort(), Object.keys(REFERENCE_SCOPES).sort());
  });

  it('associe un prefixe non vide et lisible a chaque portee', () => {
    for (const [scope, prefix] of Object.entries(REFERENCE_PREFIXES)) {
      assert.ok(prefix.length >= 2, `${scope} : prefixe trop court`);
      // Un tiret dans le prefixe rendrait la reference ambigue a re-analyser :
      // `PRO-2026-0001` se decoupe sur le tiret, `A-B-2026-0001` non.
      assert.match(prefix, /^[A-Z][A-Z0-9]*$/, `${scope} : prefixe invalide « ${prefix} »`);
    }
  });

  it('n attribue jamais le meme prefixe a deux portees', () => {
    // Deux portees partageant un prefixe, ce sont deux documents que personne
    // ne peut distinguer a l'oeil — la seule raison d'etre d'une reference
    // lisible disparait, et le support ne peut plus identifier une piece par
    // son numero.
    const prefixes = Object.values(REFERENCE_PREFIXES);
    assert.equal(new Set(prefixes).size, prefixes.length);
  });

  it('epingle PRO et CLI, que le seed ecrit en dur', () => {
    // `prisma/seed.ts` cree le prospect `PRO-2026-0001` et le client
    // `CLI-2026-0001`. Ce sont les deux valeurs que l'utilisateur voit en
    // premier, et celles qui serviraient de reference dans un ticket de support.
    assert.equal(REFERENCE_PREFIXES.PROSPECT, 'PRO');
    assert.equal(REFERENCE_PREFIXES.CLIENT, 'CLI');
  });
});

describe('formatReference + REFERENCE_PREFIXES', () => {
  it('reproduit exactement les references posees par le seed', () => {
    // C'est L'ASSERTION DE COHERENCE entre les deux camps. Si elle tombe, le
    // seed et le service ne numerotent plus pareil, et la premiere creation via
    // l'API echouera sur une violation d'unicite.
    assert.equal(formatReference(REFERENCE_PREFIXES.PROSPECT, 2026, 1), 'PRO-2026-0001');
    assert.equal(formatReference(REFERENCE_PREFIXES.CLIENT, 2026, 1), 'CLI-2026-0001');
  });

  it('compose PREFIXE-ANNEE-SEQUENCE avec la sequence sur 4 chiffres', () => {
    assert.equal(formatReference(REFERENCE_PREFIXES.QUOTE, 2026, 7), 'DEV-2026-0007');
    assert.equal(formatReference(REFERENCE_PREFIXES.INVOICE, 2026, 42), 'FAC-2026-0042');
    assert.equal(formatReference(REFERENCE_PREFIXES.PAYMENT, 2026, 9999), 'PAY-2026-9999');
  });

  it('laisse la sequence s allonger au-dela de 9999 plutot que de la tronquer', () => {
    // `padStart` n'ecrit que des zeros en tete. Un `slice(-4)` donnerait
    // « 0000 » pour 10000 et ferait collisionner toute la fin de l'annee — au
    // 10000e document, c'est-a-dire jamais en developpement.
    assert.equal(formatReference(REFERENCE_PREFIXES.INVOICE, 2026, 10_000), 'FAC-2026-10000');
  });

  it('repart a 0001 a chaque annee, la portee etant annuelle', () => {
    assert.equal(formatReference(REFERENCE_PREFIXES.INVOICE, 2026, 1), 'FAC-2026-0001');
    assert.equal(formatReference(REFERENCE_PREFIXES.INVOICE, 2027, 1), 'FAC-2027-0001');
  });

  it('ne produit jamais deux fois la meme reference sur une portee, une annee donnee', () => {
    const seen = new Set<string>();
    for (let sequence = 1; sequence <= 1_000; sequence += 1) {
      seen.add(formatReference(REFERENCE_PREFIXES.PROJECT, 2026, sequence));
    }
    assert.equal(seen.size, 1_000);
  });
});
