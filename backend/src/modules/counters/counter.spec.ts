import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ReferenceScope } from '../../common/references/reference.scopes.js';
import {
  REFERENCE_PREFIXES,
  canonicalScope,
  resolveStamp,
  stampPrefix,
  stampReference,
  type CounterStamp,
} from './counter.service.js';
import { formatReference, referenceYear } from './reference.js';

/**
 * NUMEROTATION : ce qui se verifie SANS base de donnees.
 *
 * La partie atomique — deux transactions qui reservent en meme temps, et le
 * passage a l'annee nouvelle qui repart a 0001 — se verifie contre PostgreSQL,
 * dans `test/billing.e2e-spec.ts` : c'est la base qui porte le verrou, pas ce
 * fichier. Ce qui se verifie ici est le CONTRAT DE FORME, celui qui casse
 * silencieusement : la casse des portees, le prefixe imprime, l'annee retenue,
 * et l'unicite des chaines produites.
 */

describe('canonicalScope', () => {
  it('met la portee en majuscules', () => {
    assert.equal(canonicalScope('client'), 'CLIENT');
    assert.equal(canonicalScope('CLIENT'), 'CLIENT');
  });

  it('tolere les espaces autour', () => {
    assert.equal(canonicalScope('  quote '), 'QUOTE');
  });

  it('fait retomber deux orthographes sur la MEME portee', () => {
    // Le piege que ce test existe pour attraper. `counters` a une cle primaire
    // `@@id([scope, year])` : si 'client' et 'CLIENT' restaient distincts, deux
    // lignes de compteur coexisteraient, la seconde repartirait a 1, et la
    // reference produite serait celle que `prisma/seed.ts` a deja ecrite sur
    // `CLI-2026-0001` -> violation d'unicite au premier client cree par l'API.
    assert.equal(canonicalScope('client'), canonicalScope('CLIENT'));
    assert.equal(canonicalScope('prospect'), canonicalScope('PROSPECT'));
  });
});

describe('stampPrefix', () => {
  it('applique le tableau canonique', () => {
    assert.equal(stampPrefix('PROSPECT'), 'PRO');
    assert.equal(stampPrefix('CLIENT'), 'CLI');
    assert.equal(stampPrefix('PROJECT'), 'PRJ');
    assert.equal(stampPrefix('QUOTE'), 'DEV');
    assert.equal(stampPrefix('INVOICE'), 'FAC');
    assert.equal(stampPrefix('PAYMENT'), 'PAY');
    assert.equal(stampPrefix('CONTACT_REQUEST'), 'CTR');
    assert.equal(stampPrefix('MODIFICATION_REQUEST'), 'MOD');
  });

  it('lit le tableau canonique quelle que soit la casse demandee', () => {
    assert.equal(stampPrefix('invoice'), 'FAC');
    assert.equal(stampPrefix('Invoice'), 'FAC');
  });

  it('donne le meme prefixe a tous les appelants', () => {
    // L'objet de ce test n'est pas la valeur de retour mais l'EXISTENCE d'une
    // seule source : le client, le projet, le devis et la facture sont numerotes
    // par le meme service, donc `scope: 'project'` doit donner `PRJ` meme si
    // l'appelant oublie de le preciser. Une seconde table, dans un autre module,
    // ferait diverger les formats sans qu'aucun test ne le voie.
    const scopes: readonly ReferenceScope[] = [
      'PROSPECT',
      'CLIENT',
      'PROJECT',
      'QUOTE',
      'INVOICE',
      'PAYMENT',
    ];
    for (const scope of scopes) {
      assert.equal(stampPrefix(scope), REFERENCE_PREFIXES[scope]);
    }
  });

  it('laisse une surcharge explicite gagner', () => {
    // Parametre d'EXCEPTION (reprise d'historique, script) : s'il est fourni, il
    // doit gagner, sinon il ne servirait a rien.
    assert.equal(stampPrefix('QUOTE', 'old'), 'OLD');
    assert.equal(stampPrefix('QUOTE', ' old '), 'OLD');
  });

  it('ignore une surcharge vide plutot que de produire un prefixe vide', () => {
    // `FAC--2026-0001` serait pire qu'un prefixe par defaut : la reference
    // resterait unique, mais elle ne se lirait plus.
    assert.equal(stampPrefix('INVOICE', ''), 'FAC');
    assert.equal(stampPrefix('INVOICE', '   '), 'FAC');
  });

  it('derive un prefixe pour une portee inconnue', () => {
    assert.equal(stampPrefix('REPORT'), 'REP');
    assert.equal(stampPrefix('time_entry'), 'TIM');
    // Une portee tres courte ne doit pas produire `AB-2026-0001` : la largeur du
    // prefixe est ce qui distingue un document d'un autre a l'oeil.
    assert.equal(stampPrefix('ab'), 'ABX');
  });
});

describe('resolveStamp', () => {
  it('remplit l annee, le prefixe et le padding', () => {
    const resolved = resolveStamp({ scope: 'quote' });
    assert.equal(resolved.scope, 'QUOTE');
    assert.equal(resolved.year, referenceYear());
    assert.equal(resolved.prefix, 'DEV');
    assert.equal(resolved.padding, 4);
  });

  it('respecte une annee explicite', () => {
    // Seul le seed et les scripts passent une annee : la numerotation legale
    // d'une annee close ne se rouvre pas depuis une requete HTTP.
    assert.equal(resolveStamp({ scope: 'invoice', year: 2027 }).year, 2027);
  });

  it('est idempotent', () => {
    // `resolveStamp` est appele deux fois pour un meme document (une fois par le
    // service appelant, une fois dans `next`). Un timbre deja resolu doit se
    // resoudre a l'identique, sans quoi la reference imprimee ne serait plus
    // celle du numero reserve.
    const once = resolveStamp({ scope: 'project' });
    const twice = resolveStamp(once);
    assert.deepEqual(twice, once);
  });

  it('corrige un padding absurde plutot que de produire une chaine cassee', () => {
    assert.equal(resolveStamp({ scope: 'CLIENT', padding: 0 }).padding, 4);
    assert.equal(resolveStamp({ scope: 'CLIENT', padding: -3 }).padding, 4);
    assert.equal(resolveStamp({ scope: 'CLIENT', padding: 2.7 }).padding, 2);
  });
});

describe('stampReference', () => {
  it('assemble prefixe, annee et sequence', () => {
    assert.equal(stampReference(resolveStamp({ scope: 'CLIENT', year: 2026 }), 1), 'CLI-2026-0001');
    assert.equal(stampReference(resolveStamp({ scope: 'QUOTE', year: 2026 }), 7), 'DEV-2026-0007');
  });

  it('separe les annees pour une meme sequence', () => {
    // La moitie PURE du passage a l'annee : le numero 1 de 2027 n'est pas le
    // numero 1 de 2026. La contrainte UNIQUE porte sur `reference`, donc c'est
    // cette distinction qui empeche la collision au 1er janvier. L'autre moitie
    // — deux lignes `counters` distinctes, donc deux sequences qui repartent
    // chacune a 1 — se verifie en base dans l'e2e.
    const in2026 = stampReference(resolveStamp({ scope: 'INVOICE', year: 2026 }), 1);
    const in2027 = stampReference(resolveStamp({ scope: 'INVOICE', year: 2027 }), 1);
    assert.equal(in2026, 'FAC-2026-0001');
    assert.equal(in2027, 'FAC-2027-0001');
    assert.notEqual(in2026, in2027);
  });

  it('n a pas besoin d un prefixe explicite pour etre stable', () => {
    const stamp: CounterStamp = { scope: 'PAYMENT', year: 2026 };
    assert.equal(stampReference(resolveStamp(stamp), 12), 'PAY-2026-0012');
  });
});

describe('formatReference', () => {
  it('complete la sequence a quatre chiffres', () => {
    assert.equal(formatReference('FAC', 2026, 1), 'FAC-2026-0001');
    assert.equal(formatReference('FAC', 2026, 42), 'FAC-2026-0042');
  });

  it('ne tronque pas au-dela de 9999', () => {
    // `slice(-4)` donnerait « FAC-2026-0000 » a partir du 10000e document, donc
    // une collision avec le 0 — et elle n'apparaitrait qu'en production, deux
    // ans apres la mise en service.
    assert.equal(formatReference('FAC', 2026, 10_000), 'FAC-2026-10000');
    assert.equal(formatReference('FAC', 2026, 123_456), 'FAC-2026-123456');
  });

  it('honore un padding different', () => {
    assert.equal(formatReference('CLI', 2026, 7, 6), 'CLI-2026-000007');
    assert.equal(formatReference('CLI', 2026, 7, 1), 'CLI-2026-7');
  });

  it('ne produit jamais deux fois la meme chaine sur une plage de sequences', () => {
    // L'unicite attendue d'une numerotation : sur une annee, 5000 numeros
    // donnent 5000 references distinctes.
    const seen = new Set<string>();
    for (let sequence = 1; sequence <= 5_000; sequence += 1) {
      seen.add(formatReference('DEV', 2026, sequence));
    }
    assert.equal(seen.size, 5_000);
  });
});

describe('referenceYear', () => {
  it('lit l annee de l horloge fournie', () => {
    // Dates construites en HEURE LOCALE (`new Date(annee, mois, jour, h, m, s)`)
    // et non depuis une chaine ISO en Z : `getFullYear()` lit le fuseau du
    // processus, donc `2026-01-01T00:00:00Z` vaut deja 2026 a Paris mais encore
    // 2025 a New York. Un test de numerotation qui depend du fuseau de la
    // machine est un test qui passera en local et echouera en integration.
    assert.equal(referenceYear(new Date(2026, 0, 1, 0, 0, 0)), 2026);
    assert.equal(referenceYear(new Date(2027, 0, 1, 0, 0, 0)), 2027);
  });

  it('bascule au 1er janvier a minuit', () => {
    // Le passage a l'annee est un instant precis : une seconde avant, la
    // sequence appartient encore a 2026 ; une seconde apres, elle repart a 1
    // dans une ligne `counters` neuve.
    assert.equal(referenceYear(new Date(2026, 11, 31, 23, 59, 59)), 2026);
    assert.equal(referenceYear(new Date(2027, 0, 1, 0, 0, 0)), 2027);
  });
});
