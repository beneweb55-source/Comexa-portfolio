import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import { RoleCode } from '../../generated/prisma/enums.js';
import { composeAnd as composedByProspects } from '../prospects/prospect-scope.js';
import { clientPerimeter, composeAnd, contactPerimeter } from './client-scope.js';

/**
 * LE PERIMETRE DES CLIENTS ET DES CONTACTS, VERIFIE SANS BASE.
 *
 * EXIGENCE DU CAHIER DES CHARGES, citee mot pour mot :
 *
 *   « Un client ne doit jamais pouvoir modifier l ID d un autre client dans une
 *     requete pour acceder a ses donnees. »
 *
 * Les tests de ce fichier sont la traduction de cette phrase en proprietes
 * verifiables. Le premier d entre eux est le plus important : pour un porteur de
 * l espace client, le filtre rendu porte le `clientId` DU JETON, et il est
 * ensuite compose en `AND` avec l identifiant demande — donc les deux doivent
 * etre vrais, et viser un autre dossier ne renvoie rien. Un `if` apres lecture
 * aurait, lui, laisse passer la ligne avant de la refuser.
 */

const CLIENT_OF_BEARER = 'client-du-porteur';
const CLIENT_OF_OTHER = 'client-dun-autre';
const STAFF = 'user-sales';

interface BearerOptions {
  readonly id?: string;
  readonly roles?: readonly RoleCode[];
  readonly permissions?: readonly string[];
  readonly clientId?: string | null;
}

function bearer(options: BearerOptions = {}): AuthenticatedUser {
  return {
    id: options.id ?? STAFF,
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

/** Un compte de l espace client, tel que le jeton le porte. */
function clientPolicy(options: BearerOptions = {}): AccessPolicy {
  return policy({
    roles: [RoleCode.CLIENT],
    permissions: ['client:read:own'],
    clientId: CLIENT_OF_BEARER,
    ...options,
  });
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

describe('clientPerimeter — l identifiant vient du JETON', () => {
  it('ne filtre rien pour l agence', () => {
    const where = clientPerimeter(policy({ permissions: ['client:read:any'] }), 'client', 'read');

    assert.deepEqual(where, {});
  });

  it('ramene un porteur de l espace client a SON dossier', () => {
    const where = clientPerimeter(clientPolicy(), 'client', 'read');

    assert.deepEqual(where, { id: CLIENT_OF_BEARER });
  });

  it('ne laisse JAMAIS viser le dossier d un autre client', () => {
    // Le coeur de l exigence. L identifiant du chemin est compose en `AND` avec
    // le perimetre : la requete doit satisfaire les DEUX, et `id` ne peut pas
    // valoir deux valeurs a la fois. Le resultat est un 404 — la fiche n existe
    // pas DANS LE PERIMETRE — et non un 403, qui confirmerait son existence.
    const perimeter = clientPerimeter(clientPolicy(), 'client', 'read');
    const scoped = { AND: composeAnd(perimeter, { id: CLIENT_OF_OTHER }) };

    assert.equal(scoped.AND.length, 2);
    assert.deepEqual(scoped.AND[0], { id: CLIENT_OF_BEARER });
    assert.deepEqual(scoped.AND[1], { id: CLIENT_OF_OTHER });
    // Aucun des deux fragments ne peut etre retire par l appelant : ils sont
    // tous les deux dans le `where` remis a Prisma.
    assert.equal(JSON.stringify(scoped).includes(CLIENT_OF_BEARER), true);
  });

  it('refuse en 403 un compte client non rattache a un dossier', () => {
    // Son perimetre serait vide. Le seul moyen de continuer serait de se
    // rabattre sur l identifiant venu de la requete — exactement ce qu il ne
    // faut pas faire. On refuse, on ne devine pas.
    const error = refusal(() =>
      clientPerimeter(clientPolicy({ clientId: null }), 'client', 'read'),
    );

    assert.equal(error.code, 'FORBIDDEN');
    assert.equal(error.getStatus(), 403);
  });

  it('refuse toute ECRITURE a l espace client, sur le role et non sur la permission', () => {
    // Le catalogue ne donne aujourd hui aucune ecriture au role CLIENT, mais cet
    // appel garantit que l y ajouter demain par erreur ne suffirait pas a lui
    // faire modifier le dossier d un autre.
    const error = refusal(() =>
      clientPerimeter(
        clientPolicy({ permissions: ['client:read:own', 'client:write:any'] }),
        'client',
        'write',
      ),
    );

    assert.equal(error.code, 'FORBIDDEN');
    assert.equal(error.getStatus(), 403);
  });

  it('n ouvre rien a un porteur interne qui n a que le scope own', () => {
    // `client:read:own` ne veut pas dire « un client qui lit le sien » vu de
    // l interieur : hors espace client, il n y a pas de `own` qui tienne. Le
    // scope interne est `any`, et rien d autre.
    const error = refusal(() =>
      clientPerimeter(policy({ permissions: ['client:read:own'] }), 'client', 'read'),
    );

    assert.equal(error.code, 'FORBIDDEN');
  });
});

describe('contactPerimeter — le rattachement, pas le chemin', () => {
  it('ramene un porteur de l espace client a SES contacts', () => {
    const where = contactPerimeter(clientPolicy(), 'contact', 'read');

    assert.deepEqual(where, { clientId: CLIENT_OF_BEARER });
  });

  it('ne laisse JAMAIS lire le contact d un autre client', () => {
    const perimeter = contactPerimeter(clientPolicy(), 'contact', 'read');
    const scoped = { AND: composeAnd(perimeter, { clientId: CLIENT_OF_OTHER }) };

    assert.equal(scoped.AND.length, 2);
    assert.deepEqual(scoped.AND[0], { clientId: CLIENT_OF_BEARER });
  });

  it('exige contact:write:any pour ecrire, meme pour l agence', () => {
    // La ressource de permission est `contact`, pas `client` : detenir
    // `client:write:any` ne donne pas le droit de gerer les interlocuteurs.
    const error = refusal(() =>
      contactPerimeter(policy({ permissions: ['client:write:any'] }), 'contact', 'write'),
    );

    assert.equal(error.code, 'FORBIDDEN');
  });

  it('refuse l ecriture a l espace client', () => {
    const error = refusal(() => contactPerimeter(clientPolicy(), 'contact', 'write'));

    assert.equal(error.code, 'FORBIDDEN');
  });
});

describe('composeAnd — une seule regle pour les deux modules', () => {
  it('est LA MEME fonction que celle des prospects', () => {
    // Deux copies divergeraient le jour ou l une serait corrigee. La regle de
    // surete est donc partagee, et ce test le rend visible : le jour ou l une
    // des deux est dupliquee, il echoue.
    assert.equal(composeAnd, composedByProspects);
  });

  it('ignore les fragments vides', () => {
    assert.deepEqual(composeAnd({}, { id: 'c-1' }), [{ id: 'c-1' }]);
    assert.deepEqual(composeAnd({}, {}), []);
  });
});
