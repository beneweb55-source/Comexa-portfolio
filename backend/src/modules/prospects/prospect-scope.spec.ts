import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AccessPolicy,
  SCOPE_ANY,
  SCOPE_OWN,
  type AuthenticatedUser,
} from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import { RoleCode } from '../../generated/prisma/enums.js';
import { assertInternalSpace, composeAnd, prospectPerimeter } from './prospect-scope.js';

/**
 * LE PERIMETRE DES PROSPECTS, VERIFIE SANS BASE.
 *
 * Ce fichier est le garde-fou du module : il verifie que la fonction qui decide
 * QUELLES lignes un porteur atteint ne se trompe pas de scope, et qu aucun
 * filtre d appelant ne peut elargir ce qu elle a construit.
 *
 * Les trois proprietes qui comptent, et qu une refonte casserait sans doute :
 *
 *  1. `any` ne filtre RIEN et `own` filtre sur le PORTEUR — pas sur un
 *     identifiant venu de la requete.
 *  2. Le scope le plus LARGE gagne : un porteur qui detient les deux codes ne
 *     doit pas se retrouver restreint a son portefeuille.
 *  3. Un compte de l ESPACE CLIENT ne passe pas, MEME s il detient le code : le
 *     role est la barriere, la permission n est que le second verrou.
 */

const SALES = 'user-sales';
const COLLEAGUE = 'user-collegue';

interface BearerOptions {
  readonly id?: string;
  readonly roles?: readonly RoleCode[];
  readonly permissions?: readonly string[];
  readonly clientId?: string | null;
}

function bearer(options: BearerOptions = {}): AuthenticatedUser {
  return {
    id: options.id ?? SALES,
    email: 'porteur@agence.example',
    firstName: 'Camille',
    lastName: 'Roux',
    roles: options.roles ?? [RoleCode.SALES],
    permissions: new Set(options.permissions ?? []),
    clientId: options.clientId ?? null,
    mustChangePassword: false,
  };
}

function policy(options: BearerOptions = {}): AccessPolicy {
  return new AccessPolicy(bearer(options));
}

function refusal(action: () => void): AppException {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof AppException, `attendu une AppException, recu : ${String(error)}`);
    return error;
  }

  assert.fail('aucun refus leve alors que le cas doit etre refuse');
}

describe('prospectPerimeter — le scope decides quelles lignes', () => {
  it('ne filtre RIEN pour un porteur any', () => {
    const perimeter = prospectPerimeter(policy({ permissions: ['prospect:read:any'] }), 'read');

    assert.equal(perimeter.scope, SCOPE_ANY);
    assert.deepEqual(perimeter.where, {});
  });

  it('filtre sur le PORTEUR pour un porteur own', () => {
    // `own`, pour un prospect, veut dire « dont je suis responsable ». Le sens
    // est dit ici et pas devine depuis le nom du scope : `task:write:own` vise
    // les taches ASSIGNEES, `quote:read:own` le client du porteur.
    const perimeter = prospectPerimeter(policy({ permissions: ['prospect:read:own'] }), 'read');

    assert.equal(perimeter.scope, SCOPE_OWN);
    assert.deepEqual(perimeter.where, { ownerId: SALES });
  });

  it('retient le scope le plus LARGE quand les deux sont detenus', () => {
    const perimeter = prospectPerimeter(
      policy({ permissions: ['prospect:read:any', 'prospect:read:own'] }),
      'read',
    );

    assert.equal(perimeter.scope, SCOPE_ANY);
    assert.deepEqual(perimeter.where, {});
  });

  it('n accepte aucun identifiant dans son perimetre own', () => {
    // Il n y a pas de parametre a fournir : la seule valeur possible est celle
    // du porteur. Un appelant ne peut donc pas demander le portefeuille d un
    // collegue, meme en le voulant.
    const perimeter = prospectPerimeter(policy({ permissions: ['prospect:read:own'] }), 'read');

    assert.equal(JSON.stringify(perimeter.where).includes(COLLEAGUE), false);
  });

  it('exige any pour supprimer et convertir', () => {
    // Ces deux actions ne se declinent pas en `own` : le catalogue ne leur donne
    // que `any`. Un porteur reduit a son portefeuille ne doit donc pas pouvoir
    // supprimer une fiche, ni en ouvrir un dossier client.
    const own = policy({ permissions: ['prospect:write:own'] });

    assert.equal(refusal(() => prospectPerimeter(own, 'delete')).code, 'FORBIDDEN');
    assert.equal(refusal(() => prospectPerimeter(own, 'convert')).code, 'FORBIDDEN');
  });

  it('ne confond pas les actions entre elles', () => {
    // `prospect:write:any` n ouvre pas la suppression, et `prospect:delete:any`
    // n ouvre pas la lecture : les scopes ne se croisent pas d une action a
    // l autre, sinon un droit d ecriture deviendrait un droit de tout faire.
    const writer = policy({ permissions: ['prospect:write:any'] });
    const deleter = policy({ permissions: ['prospect:delete:any'] });

    assert.equal(refusal(() => prospectPerimeter(writer, 'delete')).code, 'FORBIDDEN');
    assert.equal(refusal(() => prospectPerimeter(deleter, 'read')).code, 'FORBIDDEN');
  });

  it('refuse un porteur sans aucun droit', () => {
    const error = refusal(() => prospectPerimeter(policy(), 'read'));

    assert.equal(error.code, 'FORBIDDEN');
    assert.equal(error.getStatus(), 403);
  });
});

describe('assertInternalSpace — le role est la barriere', () => {
  it('refuse un compte de l espace client MEME s il detient le code', () => {
    // Le cas n est pas theorique : une permission ajoutee par erreur au role
    // CLIENT dans le catalogue ne doit pas ouvrir le pipeline commercial. Le
    // role est verifie AVANT les permissions, et c est tout l objet de cette
    // fonction.
    const espaceClient = policy({
      roles: [RoleCode.CLIENT],
      permissions: ['prospect:read:any', 'prospect:write:any', 'prospect:convert:any'],
      clientId: 'client-1',
    });

    const error = refusal(() => assertInternalSpace(espaceClient));

    assert.equal(error.code, 'FORBIDDEN');
    assert.equal(error.getStatus(), 403);
  });

  it('laisse passer un porteur interne', () => {
    assert.doesNotThrow(() => assertInternalSpace(policy({ permissions: ['prospect:read:any'] })));
  });
});

describe('composeAnd — un filtre ne peut pas elargir le perimetre', () => {
  it('compose en AND au lieu d ecraser les cles', () => {
    // LE TEST QUI JUSTIFIE LA FONCTION. Un etalement (`{...perimetre, ...filtre}`)
    // ferait gagner la derniere cle : un commercial a `own` qui ajoute
    // `?ownerId=<un collegue>` elargirait son perimetre par un simple parametre
    // de requete. En AND, les deux contraintes coexistent.
    const perimeter = prospectPerimeter(policy({ permissions: ['prospect:read:own'] }), 'read');
    const fragments = composeAnd(perimeter.where, { ownerId: COLLEAGUE });

    assert.equal(fragments.length, 2);
    // Le perimetre reste EN PREMIER et porte toujours le porteur : aucune
    // composition ne peut le retirer.
    assert.deepEqual(fragments[0], { ownerId: SALES });
    assert.deepEqual(fragments[1], { ownerId: COLLEAGUE });
  });

  it('ignore les fragments vides plutot que d ecrire un AND inutile', () => {
    assert.deepEqual(composeAnd({}, { id: 'p-1' }), [{ id: 'p-1' }]);
    assert.deepEqual(composeAnd({}, {}), []);
    assert.deepEqual(composeAnd(), []);
  });

  it('conserve un fragment non vide, meme sans cle connue du modele', () => {
    // La fonction ne juge pas le CONTENU : elle ne fait que retirer le vide. Un
    // fragment qu elle tenterait d interpreter finirait par en laisser passer un
    // qui elargit.
    assert.deepEqual(composeAnd({ OR: [{ status: 'NEW' }] }), [{ OR: [{ status: 'NEW' }] }]);
  });
});
