/**
 * LES DROITS D'UNE MACHINE, VERIFIES CONTRE LE VRAI CATALOGUE.
 *
 * -----------------------------------------------------------------------------
 * CE QUE CE FICHIER GARANTIT, ET POURQUOI IL FALLAIT L'ECRIRE
 * -----------------------------------------------------------------------------
 * `integration-token.spec.ts` verifie les REGLES avec un catalogue fictif de
 * trois codes : il prouve la mecanique, pas le cablage. Ici, les memes regles
 * sont exercees contre le CATALOGUE REEL et la politique d'acces reelle. C'est
 * la seule facon de repondre aux questions qui comptent :
 *
 *   - une integration peut-elle recevoir la lecture des taches ? OUI.
 *   - peut-elle recevoir l'administration des integrations ? NON, jamais.
 *   - un role du personnel autre qu'administrateur peut-il administrer les
 *     integrations ? NON — sinon un compte de developpeur suffirait a creer des
 *     acces machines.
 *   - un jeton qui ne lit que les taches passe-t-il la porte d'une facture ?
 *     NON, et c'est `AccessPolicy` qui le dit.
 *
 * AUCUNE BASE N'EST NECESSAIRE : le catalogue et `ROLE_PERMISSIONS` sont du code,
 * `AccessPolicy` est une classe pure, et `normalizeIntegrationScopes` prend son
 * catalogue en parametre.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALL_PERMISSION_CODES, PERMISSIONS, ROLE_PERMISSIONS } from './permissions.catalogue.js';
import { INTEGRATION_MANAGED_CODES, normalizeIntegrationScopes } from './integration-token.js';
import { AccessPolicy, SCOPE_ANY, type AuthenticatedUser } from './principal.js';

/** Une machine dont les droits sont exactement `scopes` — ni role, ni bonus. */
function machine(scopes: readonly string[]): AccessPolicy {
  const user = {
    id: 'svc-1',
    email: 'n8n-production@integrations.invalid',
    firstName: 'n8n-production',
    lastName: 'Integration',
    status: 'ACTIVE',
    clientId: null,
    mustChangePassword: false,
    // AUCUN ROLE : les droits d'une integration viennent du jeton seul. C'est la
    // difference avec un humain, et la raison d'etre de ce champ vide.
    roles: [],
    permissions: new Set(scopes),
    isIntegration: true,
  } as unknown as AuthenticatedUser;

  return new AccessPolicy(user);
}

/** Le catalogue, vu comme une simple liste de chaines : c'est ce que la regle attend. */
const CATALOGUE: readonly string[] = ALL_PERMISSION_CODES;

/** Les libelles du catalogue, indexes par chaine. */
const LIBELLES: Record<string, string> = PERMISSIONS;

describe('permissions d’une integration, contre le catalogue reel', () => {
  it('accepte les codes du catalogue que l’on veut vraiment donner', () => {
    const demande = ['task:read:any', 'task:write:any', 'project:read:any', 'time:write:any'];

    const resultat = normalizeIntegrationScopes(demande, ALL_PERMISSION_CODES);

    assert.equal(resultat.ok, true);
    assert.ok(resultat.ok && resultat.scopes.length === demande.length);
    for (const code of demande) {
      assert.ok(CATALOGUE.includes(code), `${code} doit exister au catalogue`);
    }
  });

  it('REFUSE qu’une machine recoive l’administration des integrations, meme demandee', () => {
    for (const code of INTEGRATION_MANAGED_CODES) {
      const resultat = normalizeIntegrationScopes(['task:read:any', code], ALL_PERMISSION_CODES);

      assert.equal(resultat.ok, false, `${code} ne doit jamais entrer dans un jeton`);
      assert.ok(!resultat.ok && resultat.forbidden.includes(code));
    }
  });

  it('REFUSE un code inconnu au lieu de l’ignorer', () => {
    // La faute de frappe la plus dangereuse n'est pas celle qui casse : c'est
    // celle qui donne un jeton apparemment autorise, et muet.
    const resultat = normalizeIntegrationScopes(['task:reed:any'], ALL_PERMISSION_CODES);

    assert.equal(resultat.ok, false);
    assert.ok(!resultat.ok && resultat.unknown.includes('task:reed:any'));
  });

  it('n’accorde l’administration des integrations qu’a un administrateur', () => {
    // `'ALL'` est la forme que prend « ce role a tout » dans le catalogue : il
    // compte donc parmi les roles qui portent les codes d'integration.
    const rolesAvecIntegration = Object.entries(ROLE_PERMISSIONS)
      .filter(
        ([, codes]) => codes === 'ALL' || codes.some((code) => code.startsWith('integration:')),
      )
      .map(([role]) => role);

    // Un seul role, et c'est le seul qui a deja tous les droits : tout autre
    // ferait d'un compte de developpeur un distributeur d'acces machines.
    assert.deepEqual(rolesAvecIntegration, ['ADMIN']);
  });

  it('les deux codes d’integration existent bien au catalogue', () => {
    for (const code of INTEGRATION_MANAGED_CODES) {
      assert.ok(
        CATALOGUE.includes(code),
        `${code} doit etre declare dans PERMISSIONS, sinon les routes qui l'exigent seraient inatteignables`,
      );
      assert.ok(LIBELLES[code], `${code} doit avoir une description lisible`);
    }
  });
});

describe('AccessPolicy — des droits par ressource, pas par statut', () => {
  it('un jeton de lecture des taches ouvre les taches, et RIEN d’autre', () => {
    const politique = machine(['task:read:any']);

    assert.equal(politique.requireScope('task', 'read', [SCOPE_ANY]), SCOPE_ANY);
    assert.equal(politique.isIntegration(), true);

    // Le coeur de l'exigence « un jeton qui lit les taches ne recoit pas toutes
    // les donnees de l'agence » : memes ressources voisines, meme verbe.
    for (const ressource of ['project', 'invoice', 'quote', 'user', 'client', 'order']) {
      assert.throws(
        () => politique.requireScope(ressource, 'read', [SCOPE_ANY]),
        /Droit insuffisant|permission/i,
        `un jeton de taches ne doit pas ouvrir « ${ressource} »`,
      );
    }
  });

  it('lire ne donne jamais ecrire', () => {
    const politique = machine(['task:read:any']);

    assert.throws(() => politique.requireScope('task', 'write', [SCOPE_ANY]));
    assert.equal(politique.requireScope('task', 'read', [SCOPE_ANY]), SCOPE_ANY);
  });

  it('une portee etroite (`own`) reste une portee etroite', () => {
    // `own` n'existe que parce qu'une liste restreinte se calcule en SQL : un
    // jeton `own` ne voit que ce qui lui est rattache. Aucune machine n'est
    // rattachee a quoi que ce soit, d'ou l'interet de `any` pour elles — mais la
    // difference doit rester une difference.
    const own = machine(['task:read:own']);

    assert.equal(own.requireScope('task', 'read', [SCOPE_ANY, 'own']), 'own');
    assert.throws(() => own.requireScope('task', 'read', [SCOPE_ANY]));
  });

  it('un jeton sans permission n’ouvre aucune porte', () => {
    const vide = machine([]);

    assert.equal(vide.has('task:read:any'), false);
    assert.equal(vide.hasAny(['task:read:any', 'project:read:any']), false);
    assert.throws(() => vide.requireScope('task', 'read', [SCOPE_ANY]));
  });
});
