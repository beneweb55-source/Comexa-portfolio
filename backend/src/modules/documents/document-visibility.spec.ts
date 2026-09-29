import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException } from '../../common/errors/app-error.js';
import { DocumentVisibility } from '../../generated/prisma/enums.js';
import {
  ALL_VISIBILITIES,
  CLIENT_VISIBILITIES,
  isClientRole,
  narrowVisibilities,
  resolveDocumentAccess,
  type DocumentAccessSubject,
} from './document-visibility.js';

/**
 * LE TEST QUI COMPTE DANS CE FICHIER.
 *
 * « Le client ne doit pas voir les documents internes. » La difficulte n'est pas
 * d'ecrire ce filtre une fois : c'est qu'il tienne quand le reste bouge. Un
 * porteur CLIENT detient `document:read:client`, donc la route s'ouvre pour
 * lui ; c'est le filtre qui protege. Et le jour ou un administrateur donne
 * `document:read:any` a un role client « pour debloquer un cas », rien ne doit
 * changer.
 *
 * D'ou le scenario central : un porteur CLIENT qui detient TOUTES les
 * permissions de documents, y compris `document:read:any`. Sa liste de
 * visibilites doit rester inchangee.
 */

const CLIENT_ID = 'client-abc';

function subject(overrides: Partial<DocumentAccessSubject> = {}): DocumentAccessSubject {
  return {
    isClient: false,
    clientId: null,
    permissions: new Set<string>(),
    ...overrides,
  };
}

function internalWith(...codes: string[]): DocumentAccessSubject {
  return subject({ permissions: new Set(codes) });
}

function clientWith(...codes: string[]): DocumentAccessSubject {
  return subject({ isClient: true, clientId: CLIENT_ID, permissions: new Set(codes) });
}

function codeOf(error: unknown): string {
  assert.ok(error instanceof AppException, `AppException attendue, recu : ${String(error)}`);
  return error.code;
}

describe('resolveDocumentAccess — le porteur CLIENT', () => {
  it('ne voit jamais les documents internes', () => {
    const access = resolveDocumentAccess(clientWith('document:read:client'));

    assert.ok(
      !access.visibilities.includes(DocumentVisibility.INTERNAL),
      'INTERNAL ne doit jamais figurer dans les visibilites servies a un client',
    );
    assert.deepEqual([...access.visibilities], ['CLIENT', 'PUBLIC']);
    assert.equal(access.scope, 'client');
  });

  it('reste confine a ses documents meme avec TOUTES les permissions de documents', () => {
    // Le scenario qui casse en silence : quelqu'un « debloque » un compte client
    // en lui ajoutant les permissions internes. La protection ne doit pas
    // dependre du catalogue, sinon elle tombe au premier ajustement.
    const access = resolveDocumentAccess(
      clientWith(
        'document:read:any',
        'document:read:own',
        'document:read:client',
        'document:write:any',
        'document:delete:any',
      ),
    );

    assert.ok(
      !access.visibilities.includes(DocumentVisibility.INTERNAL),
      'le role CLIENT doit primer sur toute permission accordee par erreur',
    );
    assert.equal(access.scope, 'client');
    assert.equal(access.clientId, CLIENT_ID, 'le porteur reste borne a SON dossier client');
  });

  it('est refuse quand le compte n est rattache a aucun dossier client', () => {
    // Sans ce refus, le filtre `clientId` vaudrait `null`, donc « aucun
    // filtre » : la bibliotheque entiere s'ouvrirait. Une valeur absente qui
    // transforme une restriction en autorisation est le defaut a attraper ici.
    assert.throws(
      () => resolveDocumentAccess(subject({ isClient: true, clientId: null })),
      (error) => codeOf(error) === 'FORBIDDEN',
    );
  });
});

describe('resolveDocumentAccess — porteur interne', () => {
  it('document:read:any donne acces aux trois visibilites, sans restriction de client', () => {
    const access = resolveDocumentAccess(internalWith('document:read:any'));

    assert.equal(access.scope, 'any');
    assert.deepEqual([...access.visibilities], [...ALL_VISIBILITIES]);
    assert.equal(access.clientId, null);
  });

  it('document:read:own donne acces aux documents internes de ses projets', () => {
    // Les projets sont resolus par le service : la fonction reste pure et se
    // contente de dire « scope own, toutes visibilites ».
    const access = resolveDocumentAccess(internalWith('document:read:own'));

    assert.equal(access.scope, 'own');
    assert.ok(access.visibilities.includes(DocumentVisibility.INTERNAL));
  });

  it('document:read:any prime sur document:read:own, quel que soit l ordre du catalogue', () => {
    const access = resolveDocumentAccess(
      internalWith('document:read:own', 'document:read:any', 'document:read:client'),
    );

    assert.equal(access.scope, 'any');
  });

  it('document:read:client seul ne donne pas acces a l interne', () => {
    const access = resolveDocumentAccess(
      subject({ clientId: CLIENT_ID, permissions: new Set(['document:read:client']) }),
    );

    assert.equal(access.scope, 'client');
    assert.deepEqual([...access.visibilities], [...CLIENT_VISIBILITIES]);
  });

  it('refuse un porteur sans aucune permission de lecture', () => {
    // Une route ouverte par erreur ne doit pas servir de donnees : le refus est
    // un refus, pas une liste vide qui laisse croire a une base sans documents.
    assert.throws(
      () => resolveDocumentAccess(internalWith('document:write:any')),
      (error) => codeOf(error) === 'FORBIDDEN',
    );
  });

  it('refuse document:read:client sans dossier client rattache', () => {
    assert.throws(
      () => resolveDocumentAccess(internalWith('document:read:client')),
      (error) => codeOf(error) === 'FORBIDDEN',
    );
  });
});

describe('narrowVisibilities — un filtre ne peut pas elargir', () => {
  it('accepte un filtre compris dans les visibilites autorisees', () => {
    assert.deepEqual(
      [...narrowVisibilities(CLIENT_VISIBILITIES, DocumentVisibility.CLIENT)],
      ['CLIENT'],
    );
  });

  it('repond la liste complete quand aucun filtre n est demande', () => {
    assert.deepEqual([...narrowVisibilities(ALL_VISIBILITIES, undefined)], [...ALL_VISIBILITIES]);
  });

  it('refuse un client qui demande les documents internes', () => {
    // `?visibility=INTERNAL` envoye a la main par un porteur client : la
    // demande est refusee, et surtout elle n'elargit rien.
    assert.throws(
      () => narrowVisibilities(CLIENT_VISIBILITIES, DocumentVisibility.INTERNAL),
      (error) => codeOf(error) === 'FORBIDDEN',
    );
  });

  it('refuse un filtre hors des visibilites autorisees, meme en interne', () => {
    // Un porteur limite a CLIENT/PUBLIC (compte client interne, par exemple) ne
    // gagne rien a demander PUBLIC : c'est legitime. Mais demander INTERNAL
    // reste refuse.
    assert.throws(
      () => narrowVisibilities([DocumentVisibility.PUBLIC], DocumentVisibility.INTERNAL),
      (error) => codeOf(error) === 'FORBIDDEN',
    );
  });
});

describe('isClientRole', () => {
  it('reconnait le role CLIENT et rien d autre', () => {
    assert.equal(isClientRole(['CLIENT']), true);
    assert.equal(isClientRole(['ADMIN', 'CLIENT']), true);
    assert.equal(isClientRole(['ADMIN', 'SALES']), false);
    assert.equal(isClientRole([]), false);
    // Piege classique : une comparaison par sous-chaine ferait passer
    // « CLIENT_MANAGER » pour un client.
    assert.equal(isClientRole(['CLIENT_MANAGER']), false);
  });
});
