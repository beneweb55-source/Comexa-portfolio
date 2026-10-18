import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  MAX_SOCKET_ID_LENGTH,
  extractHandshakeToken,
  isSocketOriginAllowed,
  readConversationIdFromPayload,
  readTypingFlag,
  roomForConversation,
  roomForUser,
  socketCorsOrigins,
} from './realtime.auth.js';

/**
 * LE TEST QUI COMPTE DANS CE FICHIER : LA POIGNEE DE MAIN SANS JETON.
 *
 * `JwtAuthGuard.canActivate` renvoie `true` pour tout contexte non-HTTP. Un
 * socket n'est donc protege par RIEN tant que la passerelle ne verifie pas son
 * jeton elle-meme. `extractHandshakeToken` est la premiere marche de cette
 * verification : si elle renvoie autre chose que `null` sur une poignee de main
 * vide, la passerelle croira avoir un jeton, echouera plus loin, et la
 * distinction entre « pas de jeton » et « jeton invalide » disparaitra.
 *
 * Le refus lui-meme — l'appel a `disconnect` — ne peut pas etre teste sans
 * ouvrir de serveur socket.io ; c'est ce qu'un test e2e ferait, et il monterait
 * une base pour verifier une ligne de code. Ce qui est verifie ici est la
 * DECISION : y a-t-il un jeton a verifier, oui ou non.
 */

const TOKEN = 'jeton-de-test';

describe('extractHandshakeToken — la ou arrive reellement le jeton', () => {
  it('refuse une poignee de main vide', () => {
    assert.equal(extractHandshakeToken({}), null);
    assert.equal(extractHandshakeToken({ auth: {} }), null);
    assert.equal(extractHandshakeToken({ auth: {}, headers: {} }), null);
  });

  it('lit le jeton dans `auth`, la voie normale dun navigateur', () => {
    // Un navigateur ne peut pas poser d'en-tete `Authorization` sur une
    // connexion WebSocket : `auth` est le seul chemin qui existe cote client.
    assert.equal(extractHandshakeToken({ auth: { token: TOKEN } }), TOKEN);
  });

  it('accepte aussi un `auth` qui serait directement la chaine', () => {
    assert.equal(extractHandshakeToken({ auth: TOKEN }), TOKEN);
  });

  it('lit l en-tete `Bearer` en secours', () => {
    assert.equal(extractHandshakeToken({ headers: { authorization: `Bearer ${TOKEN}` } }), TOKEN);
  });

  it('accepte un en-tete repete, comme Express le fournit', () => {
    assert.equal(
      extractHandshakeToken({ headers: { authorization: [`Bearer ${TOKEN}`, 'Bearer autre'] } }),
      TOKEN,
    );
  });

  it('refuse un en-tete qui nest pas un Bearer', () => {
    assert.equal(extractHandshakeToken({ headers: { authorization: TOKEN } }), null);
    assert.equal(extractHandshakeToken({ headers: { authorization: 'Basic abc' } }), null);
  });

  it('traite le jeton vide comme absent, pas comme present', () => {
    // C'est ce qu'envoie un client dont la session a expire. Le compter comme
    // present ferait echouer la verification avec « jeton invalide » alors que
    // la cause est « pas de jeton » — deux chemins pour un seul cas.
    assert.equal(extractHandshakeToken({ auth: { token: '' } }), null);
    assert.equal(extractHandshakeToken({ auth: { token: '   ' } }), null);
    assert.equal(extractHandshakeToken({ headers: { authorization: 'Bearer ' } }), null);
    assert.equal(extractHandshakeToken({ auth: { token: 42 } }), null);
    assert.equal(extractHandshakeToken({ auth: null }), null);
  });

  it('prefere `auth` a l en-tete quand les deux sont la', () => {
    const token = extractHandshakeToken({
      auth: { token: TOKEN },
      headers: { authorization: 'Bearer un-autre' },
    });

    assert.equal(token, TOKEN);
  });
});

describe('rooms', () => {
  it('derive le nom des rooms de lidentifiant, jamais de lautre sens', () => {
    assert.equal(roomForUser('u1'), 'user:u1');
    assert.equal(roomForConversation('c1'), 'conversation:c1');
  });

  it('ne confond pas une room utilisateur et une room conversation', () => {
    // Deux prefixes distincts : un identifiant qui serait le meme des deux
    // cotes ne doit pas produire la meme room, sinon une diffusion de
    // notification atteindrait un fil de discussion.
    assert.notEqual(roomForUser('x'), roomForConversation('x'));
  });
});

describe('socketCorsOrigins — meme regle que le CORS HTTP', () => {
  it('refuse tout cross-origin par defaut', () => {
    assert.equal(socketCorsOrigins(undefined), false);
    assert.equal(socketCorsOrigins(''), false);
    assert.equal(socketCorsOrigins('   ,  , '), false);
  });

  it('decoupe, nettoie et garde l ordre', () => {
    assert.deepEqual(socketCorsOrigins(' https://a.test , https://b.test '), [
      'https://a.test',
      'https://b.test',
    ]);
    assert.deepEqual(socketCorsOrigins('https://seul.test'), ['https://seul.test']);
  });
});

describe('isSocketOriginAllowed — le controle d acces reel du temps reel', () => {
  const previous = process.env.CORS_ORIGIN;

  beforeEach(() => {
    process.env.CORS_ORIGIN = 'https://front.test';
  });

  after(() => {
    if (previous === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = previous;
    }
  });

  it('accepte un client non navigateur (pas d origine)', () => {
    process.env.CORS_ORIGIN = 'https://front.test';
    assert.equal(isSocketOriginAllowed(undefined, 'api.test'), true);
    assert.equal(isSocketOriginAllowed('', 'api.test'), true);
    assert.equal(isSocketOriginAllowed('   ', 'api.test'), true);
  });

  it('accepte une origine autorisee', () => {
    process.env.CORS_ORIGIN = 'https://front.test , https://autre.test';
    assert.equal(isSocketOriginAllowed('https://front.test', 'api.test'), true);
    assert.equal(isSocketOriginAllowed('https://autre.test', 'api.test'), true);
  });

  it('refuse une origine inconnue', () => {
    process.env.CORS_ORIGIN = 'https://front.test';
    assert.equal(isSocketOriginAllowed('https://pirate.test', 'api.test'), false);
    assert.equal(isSocketOriginAllowed('https://front.test.pirate.test', 'api.test'), false);
  });

  it('refuse tout quand aucune origine nest configuree', () => {
    process.env.CORS_ORIGIN = '';
    assert.equal(isSocketOriginAllowed('https://front.test', 'api.test'), false);
  });

  it('accepte la meme origine que la requete (relais meme domaine)', () => {
    process.env.CORS_ORIGIN = '';
    assert.equal(isSocketOriginAllowed('https://comexa.test', 'comexa.test'), true);
    assert.equal(isSocketOriginAllowed('https://comexa.test', 'autre.test'), false);
  });

  it('ne se laisse pas tromper par une origine malformee', () => {
    process.env.CORS_ORIGIN = '';
    assert.equal(isSocketOriginAllowed('pas-une-url', 'comexa.test'), false);
    assert.equal(isSocketOriginAllowed('https://comexa.test', ''), false);
  });

  it('lit la variable au moment de la requete, pas au chargement du module', () => {
    process.env.CORS_ORIGIN = 'https://front.test';
    assert.equal(isSocketOriginAllowed('https://front.test', 'api.test'), true);
    process.env.CORS_ORIGIN = 'https://autre.test';
    assert.equal(isSocketOriginAllowed('https://front.test', 'api.test'), false);
  });
});

describe('readConversationIdFromPayload — ce quun client a le droit denvoyer', () => {
  it('accepte un identifiant simple et le nettoie', () => {
    assert.equal(readConversationIdFromPayload({ conversationId: ' conv-1 ' }), 'conv-1');
  });

  it('refuse tout ce qui nest pas une chaine non vide', () => {
    assert.equal(readConversationIdFromPayload(null), null);
    assert.equal(readConversationIdFromPayload('conv-1'), null);
    assert.equal(readConversationIdFromPayload({}), null);
    assert.equal(readConversationIdFromPayload({ conversationId: 12 }), null);
    assert.equal(readConversationIdFromPayload({ conversationId: '' }), null);
    assert.equal(readConversationIdFromPayload({ conversationId: '   ' }), null);
  });

  it('borne la longueur du nom de room', () => {
    const tooLong = 'x'.repeat(MAX_SOCKET_ID_LENGTH + 1);

    assert.equal(readConversationIdFromPayload({ conversationId: tooLong }), null);
    assert.equal(
      readConversationIdFromPayload({ conversationId: 'x'.repeat(MAX_SOCKET_ID_LENGTH) }),
      'x'.repeat(MAX_SOCKET_ID_LENGTH),
    );
  });
});

describe('readTypingFlag', () => {
  it('nexige que le booleen vrai', () => {
    assert.equal(readTypingFlag({ isTyping: true }), true);
    assert.equal(readTypingFlag({ isTyping: 'true' }), false);
    assert.equal(readTypingFlag({ isTyping: 1 }), false);
    assert.equal(readTypingFlag({}), false);
    assert.equal(readTypingFlag(null), false);
  });
});
