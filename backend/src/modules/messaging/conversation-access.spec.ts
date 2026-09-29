import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EPOCH,
  PREVIEW_MAX_LENGTH,
  beforeCursorWhere,
  buildMessagePage,
  decodeMessageCursor,
  encodeMessageCursor,
  notificationRecipients,
  participationWhere,
  previewOf,
  unreadCountsFromGroups,
  unreadMessagesWhere,
  type ParticipantRow,
  type UnreadTarget,
} from './conversation-access.js';

/**
 * LES TESTS QUI COMPTENT DANS CE FICHIER.
 *
 *  1. LA PARTICIPATION EST UN FILTRE, PAS UN TEST. `participationWhere` doit
 *     porter le `userId` du porteur ET l'exigence `leftAt: null` dans la
 *     requete. Si l'un des deux disparait, la liste des conversations cesse
 *     d'etre restreinte et l'acces horizontal redevient possible — sans qu'un
 *     seul appel de service change.
 *
 *  2. LE COMPTEUR DE NON-LUS NE DOIT PAS COMPTER LES SIENS. Il doit aussi
 *     compter les messages systeme (`senderId` nul), que l'ecriture naive
 *     `senderId: { not: viewerId }` exclurait en SQL.
 *
 *  3. LE CURSEUR POINTE UNE LIGNE. Deux messages a la meme milliseconde doivent
 *     etre departages par l'identifiant, sinon la pagination saute ou repete.
 *
 * Aucun de ces tests n'ouvre de base, de socket ou d'application : c'est la
 * REGLE qui est verifiee, pas son branchement.
 */

const VIEWER = 'user-viewer';
const OTHER = 'user-other';

function participant(userId: string, leftAt: Date | null = null): ParticipantRow {
  return { userId, leftAt };
}

describe('participationWhere — la contrainte dappartenance', () => {
  it('exige le porteur ET une participation non terminee', () => {
    const where = participationWhere(VIEWER);

    assert.equal(where.deletedAt, null);
    assert.deepEqual(where.participants, { some: { userId: VIEWER, leftAt: null } });
  });

  it('ne laisse passer aucun identifiant venu dailleurs', () => {
    // Le seul `userId` present dans le filtre est celui qu'on a donne. Un
    // appelant ne peut donc pas elargir la portee en ajoutant une entree : il
    // n'y a pas de tableau a completer, seulement une valeur.
    const where = participationWhere(VIEWER);
    const serialized = JSON.stringify(where);

    assert.ok(serialized.includes(VIEWER));
    assert.ok(!serialized.includes(OTHER));
  });

  it('construit un filtre NEUF a chaque appel', () => {
    // Le filtre est un objet mutable remis a Prisma, qui peut le reecrire (il
    // ajoute `undefined` aux champs absents, entre autres). Le partager entre
    // deux requetes ferait dependre la portee d'une requete de ce qu'une autre
    // vient d'en faire — le genre de panne qui n'apparait qu'en charge.
    const first = participationWhere(VIEWER);
    const second = participationWhere(VIEWER);

    assert.notEqual(first, second);
    assert.notEqual(first.participants, second.participants);
    assert.deepEqual(first, second);
  });
});

describe('notificationRecipients — qui prevenir', () => {
  it('exclut lauteur du message', () => {
    const recipients = notificationRecipients([participant(VIEWER), participant(OTHER)], VIEWER);

    assert.deepEqual(recipients, [OTHER]);
  });

  it('exclut ceux qui ont quitte la conversation', () => {
    const recipients = notificationRecipients(
      [participant(VIEWER), participant(OTHER), participant('user-gone', new Date(1))],
      VIEWER,
    );

    assert.deepEqual(recipients, [OTHER]);
  });

  it('retire les doublons meme si la table en contient', () => {
    // L'unicite (conversationId, userId) interdit deux lignes, mais la fonction
    // ne doit pas dependre de cette contrainte pour etre correcte.
    const recipients = notificationRecipients(
      [participant(OTHER), participant(OTHER), participant(VIEWER)],
      VIEWER,
    );

    assert.deepEqual(recipients, [OTHER]);
  });

  it('renvoie une liste vide quand le porteur est seul', () => {
    assert.deepEqual(notificationRecipients([participant(VIEWER)], VIEWER), []);
  });
});

describe('curseur de pagination', () => {
  const createdAt = new Date('2026-09-29T10:00:00.000Z');

  it('fait un aller-retour sans perdre la date ni lidentifiant', () => {
    const decoded = decodeMessageCursor(encodeMessageCursor(createdAt, 'msg-1'));

    assert.ok(decoded);
    assert.equal(decoded.id, 'msg-1');
    assert.equal(decoded.createdAt.toISOString(), createdAt.toISOString());
  });

  it('refuse un jeton illisible plutot que de deviner', () => {
    // Accepter un curseur casse en le traitant comme « depuis le debut »
    // renverrait silencieusement la mauvaise page. Un refus net est plus sur.
    assert.equal(decodeMessageCursor('pas-du-base64url!!'), null);
    assert.equal(decodeMessageCursor(''), null);
    assert.equal(decodeMessageCursor(Buffer.from('sans-separateur').toString('base64url')), null);
    assert.equal(decodeMessageCursor(Buffer.from('|msg-1').toString('base64url')), null);
    assert.equal(
      decodeMessageCursor(Buffer.from('pas-une-date|msg-1').toString('base64url')),
      null,
    );
  });

  it('refuse un identifiant vide ou demesure', () => {
    assert.equal(
      decodeMessageCursor(Buffer.from(`${createdAt.toISOString()}|`).toString('base64url')),
      null,
    );

    const tooLong = 'x'.repeat(65);
    assert.equal(
      decodeMessageCursor(
        Buffer.from(`${createdAt.toISOString()}|${tooLong}`).toString('base64url'),
      ),
      null,
    );
  });
});

describe('beforeCursorWhere — la fenetre suivante', () => {
  it('departage deux messages a la meme milliseconde par lidentifiant', () => {
    const createdAt = new Date('2026-09-29T10:00:00.000Z');
    const where = beforeCursorWhere({ createdAt, id: 'msg-5' });

    assert.deepEqual(where, {
      OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: 'msg-5' } }],
    });
  });
});

describe('unreadMessagesWhere — le compteur de non-lus', () => {
  it('ne construit rien sans conversation a compter', () => {
    assert.equal(unreadMessagesWhere(VIEWER, []), null);
  });

  it('compte les messages dautrui ET les messages systeme', () => {
    const targets: UnreadTarget[] = [{ conversationId: 'conv-1', lastReadAt: new Date(5) }];

    // On compare le filtre ENTIER. Verifier un fragment a la fois laisserait
    // passer une clause ajoutee ailleurs qui elargirait le comptage.
    assert.deepEqual(unreadMessagesWhere(VIEWER, targets), {
      deletedAt: null,
      AND: [
        // `senderId: null` est la branche que l'ecriture naive oublie : en SQL,
        // `senderId <> 'user-viewer'` n'est jamais vrai pour un NULL, donc les
        // messages systeme seraient comptes comme lus.
        { OR: [{ senderId: null }, { senderId: { not: VIEWER } }] },
        { OR: [{ conversationId: 'conv-1', createdAt: { gt: new Date(5) } }] },
      ],
    });
  });

  it('donne a chaque conversation SON lastReadAt', () => {
    const first = new Date(100);
    const second = new Date(200);
    const where = unreadMessagesWhere(VIEWER, [
      { conversationId: 'conv-1', lastReadAt: first },
      { conversationId: 'conv-2', lastReadAt: second },
    ]);

    assert.deepEqual(where, {
      deletedAt: null,
      AND: [
        { OR: [{ senderId: null }, { senderId: { not: VIEWER } }] },
        {
          OR: [
            { conversationId: 'conv-1', createdAt: { gt: first } },
            { conversationId: 'conv-2', createdAt: { gt: second } },
          ],
        },
      ],
    });
  });

  it('traite « jamais lu » comme « tout est non lu »', () => {
    const where = unreadMessagesWhere(VIEWER, [{ conversationId: 'conv-1', lastReadAt: null }]);

    assert.deepEqual(where, {
      deletedAt: null,
      AND: [
        { OR: [{ senderId: null }, { senderId: { not: VIEWER } }] },
        { OR: [{ conversationId: 'conv-1', createdAt: { gt: EPOCH } }] },
      ],
    });
  });
});

describe('unreadCountsFromGroups', () => {
  it('traduit les groupes en table de correspondance', () => {
    const counts = unreadCountsFromGroups([
      { conversationId: 'conv-1', _count: { _all: 3 } },
      { conversationId: 'conv-2', _count: { _all: 0 } },
    ]);

    assert.equal(counts.get('conv-1'), 3);
    assert.equal(counts.get('conv-2'), 0);
  });

  it('laisse labsence valoir absence, pas zero', () => {
    // Le service ecrit `?? 0` au moment de construire la vue. Ici, ne pas
    // trouver une conversation doit rester distinguable d'un compteur a zero —
    // c'est la seule facon de reperer un filtre qui aurait perdu une ligne.
    const counts = unreadCountsFromGroups([]);

    assert.equal(counts.get('conv-1'), undefined);
  });
});

describe('previewOf — lapercu stocke sur la conversation', () => {
  it('ecrase les sauts de ligne', () => {
    assert.equal(previewOf('bonjour\n\ntout   le monde'), 'bonjour tout le monde');
  });

  it('tronque a la longueur annoncee, points de suspension compris', () => {
    const preview = previewOf('a'.repeat(500));

    assert.equal(preview.length, PREVIEW_MAX_LENGTH);
    assert.ok(preview.endsWith('...'));
    assert.equal(preview, `${'a'.repeat(PREVIEW_MAX_LENGTH - 3)}...`);
  });

  it('ne touche pas un message assez court', () => {
    assert.equal(previewOf('court'), 'court');
  });

  it('ne laisse pas passer un message fait despaces', () => {
    assert.equal(previewOf('   \n  '), '');
  });
});

describe('buildMessagePage — la page et sa suite', () => {
  const row = (id: string, millis: number) => ({ id, createdAt: new Date(millis) });

  it('signale la fin quand il y a moins de lignes que demande', () => {
    const page = buildMessagePage([row('m1', 1), row('m2', 2)], 5);

    assert.equal(page.items.length, 2);
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null);
  });

  it('coupe la ligne surnumeraire et renvoie le curseur de la derniere gardee', () => {
    // Trois lignes lues pour `perPage: 2` : la troisieme ne sert qu'a savoir
    // qu'il y a une suite. Elle ne doit PAS apparaitre dans la page.
    const page = buildMessagePage([row('m1', 1), row('m2', 2), row('m3', 3)], 2);

    assert.deepEqual(
      page.items.map((item) => item.id),
      ['m1', 'm2'],
    );
    assert.equal(page.hasMore, true);
    assert.ok(page.nextCursor);

    const decoded = decodeMessageCursor(page.nextCursor);
    assert.equal(decoded?.id, 'm2');
  });

  it('ne fabrique pas de curseur sur une page vide', () => {
    const page = buildMessagePage([], 20);

    assert.equal(page.items.length, 0);
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null);
  });
});
