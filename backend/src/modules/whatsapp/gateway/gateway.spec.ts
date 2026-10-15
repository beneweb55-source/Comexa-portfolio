import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  commonStatusToErrorCode,
  GatewayHttpClient,
  withoutQuery,
  type FetchLike,
} from './http.js';
import { EvolutionGateway } from './evolution.gateway.js';
import { WahaGateway } from './waha.gateway.js';
import {
  WHATSAPP_ERROR_CODES,
  WhatsAppGatewayError,
  type WhatsAppGatewayConfig,
} from '../whatsapp.types.js';

/**
 * PILOTES DE PASSERELLE — TESTES SANS PASSERELLE.
 *
 * -------------------------------------------------------------------------
 * POURQUOI UN `fetch` FAUX, ET PAS UN SERVEUR
 * -------------------------------------------------------------------------
 * `GatewayHttpClient` prend un `fetchImpl` injectable. Sans lui, verifier que
 * WAHA traduit un 412 en « session non appairee » exigerait un conteneur WAHA,
 * donc un test qui ne tourne pas en CI — donc un test qui n'existe pas.
 *
 * Ici, chaque reponse est fabriquee. Ce qui est verifie n'est pas « WAHA
 * repond-il ceci » (impossible a garantir, la passerelle evolue) mais « QUELLE
 * QUE SOIT sa reponse, quel code et quel message produisons-nous ».
 *
 * -------------------------------------------------------------------------
 * CE QUE CES TESTS PROTEGENT
 * -------------------------------------------------------------------------
 *  1. LA TRADUCTION DES STATUTS. WAHA et Evolution n'emploient pas les memes
 *     statuts pour les memes situations : un 404 chez l'un, un 412 chez l'autre.
 *     Sans table verifiee, un incident remonte sous deux codes differents selon
 *     le pilote, et le workflow n8n n'en traite qu'un.
 *  2. LA CLE D'API. Elle part dans un en-tete (`X-Api-Key` pour WAHA, `apikey`
 *     pour Evolution). Un pilote qui l'oublierait rendrait 401 partout, et un
 *     pilote qui la mettrait EN QUERY la recopierait dans les journaux.
 *  3. LES MESSAGES. Ils nomment le pilote et la session : devant une panne,
 *     « la passerelle a echoue » ne dit pas laquelle, donc ne dit pas quoi
 *     redemarrer.
 *  4. LE QR. Il est rendu en base64 SANS prefixe `data:` : Telegram et l'API
 *     `sendPhoto` attendent des octets, et un prefixe rend l'image illisible sans
 *     qu'aucune erreur ne soit levee.
 */

const CONFIG: WhatsAppGatewayConfig = {
  driver: 'waha',
  baseUrl: 'http://waha:3000/',
  apiKey: 'cle-de-test',
  timeoutMs: 5_000,
  sessionPrefix: 'comexa',
  maxMessagesPerHour: 40,
  maxBodyLength: 1024,
  sessionCacheMs: 5_000,
  contactCacheMinutes: 30,
  defaultCountryCode: 'DZ',
  delegationCodeTtlMs: 72 * 3_600_000,
  consentTtlMs: null,
};

/** Un appel observe par le test : URL, methode, en-tetes, corps. */
interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** Fabrique un `fetch` qui rend les reponses donnees, dans l'ordre. */
function fakeFetch(
  responses: Array<{
    status?: number;
    json?: unknown;
    text?: string;
    contentType?: string;
    bytes?: Uint8Array;
  }>,
): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const rawBody = init?.body;

    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: { ...headers },
      body: typeof rawBody === 'string' ? safeParse(rawBody) : rawBody,
    });

    const spec = responses[Math.min(index, responses.length - 1)] ?? {};
    index += 1;

    const status = spec.status ?? 200;
    const contentType =
      spec.contentType ??
      (spec.bytes ? 'image/png' : spec.text !== undefined ? 'text/plain' : 'application/json');
    const payload =
      spec.bytes ?? (spec.text !== undefined ? spec.text : JSON.stringify(spec.json ?? {}));

    return new Response(payload, {
      status,
      headers: { 'content-type': contentType },
    });
  };

  return { fetch: fetchImpl, calls };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function waha(responses: Parameters<typeof fakeFetch>[0]) {
  const { fetch, calls } = fakeFetch(responses);
  return { gateway: new WahaGateway(CONFIG, new GatewayHttpClient(fetch)), calls };
}

function evolution(responses: Parameters<typeof fakeFetch>[0]) {
  const { fetch, calls } = fakeFetch(responses);
  return {
    gateway: new EvolutionGateway(
      { ...CONFIG, driver: 'evolution', baseUrl: 'http://evo:8080' },
      new GatewayHttpClient(fetch),
    ),
    calls,
  };
}

async function throwsWhatsAppGatewayError(
  promise: Promise<unknown>,
): Promise<WhatsAppGatewayError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(
      error instanceof WhatsAppGatewayError,
      `WhatsAppGatewayError attendue, recu : ${String(error)}`,
    );
    return error;
  }

  assert.fail('aucune erreur levee');
}

describe('withoutQuery — ne pas recopier la chaine de requete dans un message', () => {
  it('retire tout ce qui suit le point d’interrogation', () => {
    assert.equal(
      withoutQuery('http://waha:3000/api/contacts/all?session=comexa-abc&apiKey=secret'),
      'http://waha:3000/api/contacts/all',
    );
  });

  it('laisse intacte une URL sans query', () => {
    assert.equal(withoutQuery('http://waha:3000/api/sendText'), 'http://waha:3000/api/sendText');
  });
});

describe('commonStatusToErrorCode — la table partagee', () => {
  it('traduit 401 et 403 en refus d’authentification', () => {
    assert.equal(commonStatusToErrorCode(401), WHATSAPP_ERROR_CODES.UNAUTHORIZED);
    assert.equal(commonStatusToErrorCode(403), WHATSAPP_ERROR_CODES.UNAUTHORIZED);
  });

  it('traduit 402, 405 et 501 en fonctionnalite indisponible', () => {
    // 402 est le statut que rend WAHA Core pour `/api/contacts/all` (WAHA PLUS).
    // Le rendre comme une erreur generique ferait chercher une panne de cle.
    for (const status of [402, 405, 501]) {
      assert.equal(
        commonStatusToErrorCode(status),
        WHATSAPP_ERROR_CODES.FEATURE_UNAVAILABLE,
        String(status),
      );
    }
  });

  it('rend un echec amont pour tout le reste', () => {
    for (const status of [400, 404, 412, 429, 500, 502, 503]) {
      assert.equal(
        commonStatusToErrorCode(status),
        WHATSAPP_ERROR_CODES.UPSTREAM_FAILED,
        String(status),
      );
    }
  });
});

describe('GatewayHttpClient — reseau et delai', () => {
  it('ne leve PAS sur un statut d’erreur : le pilote decide', () => {
    // WAHA et Evolution n'emploient pas les memes statuts pour les memes
    // situations. Lever ici imposerait UNE interpretation aux deux pilotes.
    const { fetch, calls } = fakeFetch([{ status: 412, json: { message: 'pas appaire' } }]);
    const client = new GatewayHttpClient(fetch);

    return client
      .request({ method: 'GET', url: 'http://waha:3000/api/x', timeoutMs: 100, driver: 'waha' })
      .then((response) => {
        assert.equal(response.status, 412);
        assert.deepEqual(response.body, { message: 'pas appaire' });
        assert.equal(calls.length, 1);
      });
  });

  it('leve UNREACHABLE quand fetch echoue, en nommant le pilote', async () => {
    const client = new GatewayHttpClient((async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:3000');
    }) as FetchLike);

    const error = await throwsWhatsAppGatewayError(
      client.request({
        method: 'POST',
        url: 'http://waha:3000/api/sendText',
        timeoutMs: 100,
        driver: 'evolution',
      }),
    );

    assert.equal(error.code, WHATSAPP_ERROR_CODES.UNREACHABLE);
    assert.match(error.message, /evolution/, 'le pilote doit etre nomme');
    assert.match(error.message, /WHATSAPP_GATEWAY_URL/, 'la variable a verifier doit etre nommee');
  });

  it('leve UNREACHABLE sur un delai depasse, avec le delai dans le message', async () => {
    // Ce que leve un vrai `fetch` quand `AbortSignal.timeout` eclaire : une erreur
    // dont le NOM vaut `TimeoutError`. Attendre le signal reel ici ne testerait
    // rien de plus — et suspendrait le test sur une temporisation.
    const client = new GatewayHttpClient((async () => {
      const timeout = new Error('The operation was aborted due to timeout');
      timeout.name = 'TimeoutError';
      throw timeout;
    }) as FetchLike);

    const error = await throwsWhatsAppGatewayError(
      client.request({
        method: 'GET',
        url: 'http://waha:3000/api/sessions/x',
        timeoutMs: 20,
        driver: 'waha',
      }),
    );

    assert.equal(error.code, WHATSAPP_ERROR_CODES.UNREACHABLE);
    assert.match(error.message, /20 ms/);
  });

  it('tronque le corps brut conserve pour un message d’erreur', async () => {
    // Un corps de plusieurs megaoctets recopie dans une exception finirait dans
    // le journal, donc dans les sauvegardes, pour un message que personne ne lit.
    const { fetch } = fakeFetch([{ status: 500, text: 'x'.repeat(5_000) }]);
    const client = new GatewayHttpClient(fetch);

    const response = await client.request({
      method: 'GET',
      url: 'http://waha:3000/api/sessions/x',
      timeoutMs: 100,
      driver: 'waha',
    });

    assert.equal(response.text.length, 400);
    assert.equal(response.body, null, 'un corps non JSON ne doit pas etre interprete');
  });
});

describe('WahaGateway — authentication et chemins', () => {
  it('envoie la cle dans l’en-tete X-Api-Key, jamais en query', async () => {
    const { gateway, calls } = waha([{ status: 201, json: { name: 'comexa-abc' } }]);

    await gateway.ensureSession('comexa-abc');

    assert.equal(calls[0]!.headers['X-Api-Key'], CONFIG.apiKey);
    assert.ok(!calls[0]!.url.includes('apiKey'), `cle en query : ${calls[0]!.url}`);
    assert.ok(!calls[0]!.url.includes(CONFIG.apiKey));
    assert.equal(
      calls[0]!.url,
      'http://waha:3000/api/sessions',
      'la barre de fin doit disparaitre',
    );
  });

  it('traite un 409 a la creation comme un succes', async () => {
    // La session existe deja : c'est le resultat cherche, pas une erreur. Lever
    // ici empecherait tout redemarrage apres une reprise sur erreur.
    const { gateway } = waha([{ status: 409, json: { message: 'already exists' } }]);

    await assert.doesNotReject(gateway.ensureSession('comexa-abc'));
  });

  it('traduit un 401 en refus d’authentification', async () => {
    const { gateway } = waha([{ status: 401, json: { message: 'invalid key' } }]);

    const error = await throwsWhatsAppGatewayError(gateway.ensureSession('comexa-abc'));

    assert.equal(error.code, WHATSAPP_ERROR_CODES.UNAUTHORIZED);
    assert.match(error.message, /WHATSAPP_GATEWAY_API_KEY/);
  });

  it('envoie le texte sur /api/sendText avec {session, chatId, text}', async () => {
    const { gateway, calls } = waha([{ status: 200, json: { id: '3EB0ABC_1' } }]);

    const result = await gateway.sendText('comexa-abc', '213555123456@s.whatsapp.net', 'Bonjour');

    assert.equal(calls[0]!.url, 'http://waha:3000/api/sendText');
    assert.deepEqual(calls[0]!.body, {
      session: 'comexa-abc',
      chatId: '213555123456@s.whatsapp.net',
      text: 'Bonjour',
    });
    assert.equal(result.messageId, '3EB0ABC_1');
    assert.ok(result.sentAt instanceof Date);
  });

  it('lit l’identifiant de message serialise', async () => {
    // WAHA rend parfois `{ id: { _serialized } }` plutot qu'une chaine.
    const { gateway } = waha([
      { status: 200, json: { id: { _serialized: 'true_213555123456@c.us_3EB0XYZ' } } },
    ]);

    const result = await gateway.sendText('comexa-abc', '213555123456@s.whatsapp.net', 'Bonjour');

    assert.equal(result.messageId, 'true_213555123456@c.us_3EB0XYZ');
  });

  it('rend null plutot que de deviner un identifiant de message absent', async () => {
    // Un identifiant invente serait journalise comme preuve d'envoi : mieux vaut
    // `null`, qui dit « la passerelle n'a rien confirme ».
    const { gateway } = waha([{ status: 200, json: {} }]);

    const result = await gateway.sendText('comexa-abc', '213555123456@s.whatsapp.net', 'Bonjour');

    assert.equal(result.messageId, null);
  });

  it('traduit un 412 a l’envoi en session non appairee', async () => {
    const { gateway } = waha([{ status: 412, json: { message: 'not connected' } }]);

    const error = await throwsWhatsAppGatewayError(
      gateway.sendText('comexa-abc', '213555123456@s.whatsapp.net', 'Bonjour'),
    );

    assert.equal(error.code, WHATSAPP_ERROR_CODES.SESSION_NOT_CONNECTED);
    assert.match(error.message, /comexa-abc/, 'la session doit etre nommee');
  });
});

describe('WahaGateway — etat de session', () => {
  const cases: Array<[string, string]> = [
    ['WORKING', 'CONNECTED'],
    ['SCAN_QR_CODE', 'WAITING_QR'],
    ['STARTING', 'STARTING'],
    ['STOPPED', 'DISCONNECTED'],
    ['FAILED', 'FAILED'],
    ['PASSKEY_REQUIRED', 'STARTING'],
  ];

  for (const [raw, expected] of cases) {
    it(`traduit ${raw} en ${expected}`, async () => {
      const { gateway } = waha([{ status: 200, json: { name: 'comexa-abc', status: raw } }]);

      const state = await gateway.getStatus('comexa-abc');

      assert.equal(state.state, expected);
      assert.equal(state.raw, raw, 'l’etat brut doit rester visible pour le diagnostic');
    });
  }

  it('signale un etat inconnu au lieu de le faire passer pour un echec ordinaire', async () => {
    // Une nouvelle version de WAHA peut ajouter un etat. Rendre `FAILED` sans
    // explication ferait chercher une panne de telephone alors que c'est la
    // table de correspondance qu'il faut completer.
    const { gateway } = waha([{ status: 200, json: { status: 'SOMETHING_NEW' } }]);

    const state = await gateway.getStatus('comexa-abc');

    assert.equal(state.state, 'FAILED');
    assert.match(state.error ?? '', /SOMETHING_NEW/);
  });

  it('traduit un 404 en session introuvable', async () => {
    const { gateway } = waha([{ status: 404, json: { message: 'not found' } }]);

    const error = await throwsWhatsAppGatewayError(gateway.getStatus('comexa-abc'));

    assert.equal(error.code, WHATSAPP_ERROR_CODES.SESSION_NOT_FOUND);
  });

  it('recupere le numero depuis `me.id` sans appel de profil supplementaire', async () => {
    const { gateway, calls } = waha([
      { status: 200, json: { status: 'SCAN_QR_CODE', me: { id: '213555123456@c.us' } } },
    ]);

    const state = await gateway.getStatus('comexa-abc');

    assert.equal(state.phoneNumber, '213555123456');
    assert.equal(calls.length, 1, 'un etat non appaire ne doit pas appeler /profile');
  });

  it('ne fait pas echouer l’etat quand le profil est indisponible', async () => {
    // Le profil est decoratif. Une interrogation d'etat qui echoue parce que
    // `/profile` est absent dans cette version de WAHA rendrait le compte
    // inutilisable pour un champ qui ne sert a aucun controle.
    const { gateway } = waha([
      {
        status: 200,
        json: { status: 'WORKING', me: { id: '213555123456@c.us', pushName: 'Karim' } },
      },
      { status: 404, json: {} },
    ]);

    const state = await gateway.getStatus('comexa-abc');

    assert.equal(state.state, 'CONNECTED');
    assert.equal(state.phoneNumber, '213555123456');
    assert.equal(state.pushName, 'Karim');
  });
});

describe('WahaGateway — QR code', () => {
  it('rend le PNG en base64 SANS prefixe data:', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { gateway, calls } = waha([{ status: 200, bytes: png }]);

    const qr = await gateway.getQrCode('comexa-abc');

    assert.equal(qr.imageBase64, Buffer.from(png).toString('base64'));
    assert.ok(
      !qr.imageBase64!.startsWith('data:'),
      'un prefixe data: rend l’image illisible cote Telegram',
    );
    assert.equal(qr.rawValue, null);
    assert.equal(calls[0]!.url, 'http://waha:3000/api/comexa-abc/auth/qr');
  });

  it('retombe sur la valeur brute quand la reponse est du JSON', async () => {
    const { gateway } = waha([
      { status: 200, json: { value: '2@abcDEF==' }, contentType: 'application/json' },
    ]);

    const qr = await gateway.getQrCode('comexa-abc');

    assert.equal(qr.imageBase64, null);
    assert.equal(qr.rawValue, '2@abcDEF==');
  });

  it('dit clairement qu’une session deja appairee n’a pas de QR', async () => {
    // Le pilote rend 412 dans ce cas. Afficher une image vide dans Telegram
    // laisserait l'utilisateur scanner un carre blanc.
    const { gateway } = waha([{ status: 412, json: { message: 'already paired' } }]);

    const error = await throwsWhatsAppGatewayError(gateway.getQrCode('comexa-abc'));

    assert.equal(error.code, WHATSAPP_ERROR_CODES.SESSION_NOT_CONNECTED);
    assert.match(error.message, /deja appairee/);
  });
});

describe('WahaGateway — repertoire', () => {
  it('lit /api/contacts/all avec la session et la pagination', async () => {
    const { gateway, calls } = waha([
      {
        status: 200,
        json: [
          {
            id: { _serialized: '213555123456@c.us' },
            name: 'Amina',
            pushName: 'Amina H.',
            isBusiness: false,
          },
          { id: '120363001234567890@g.us', name: 'Equipe Comexa' },
        ],
      },
    ]);

    const contacts = await gateway.listContacts('comexa-abc', { limit: 500, offset: 0 });

    assert.match(calls[0]!.url, /^http:\/\/waha:3000\/api\/contacts\/all\?/);
    assert.match(calls[0]!.url, /session=comexa-abc/);
    assert.match(calls[0]!.url, /limit=500/);
    assert.equal(contacts.length, 2);
    assert.equal(
      contacts[0]!.jid,
      '213555123456@s.whatsapp.net',
      'le suffixe @c.us doit etre traduit',
    );
    assert.equal(contacts[0]!.phoneNumber, '213555123456');
    assert.equal(contacts[1]!.jid, '120363001234567890@g.us', 'un JID de groupe reste un groupe');
    assert.equal(contacts[1]!.phoneNumber, null);
  });

  it('ecarte les entrees sans identifiant exploitable', async () => {
    // Une entree sans JID ne peut etre ni retrouvee ni envoyee : la copier en
    // base ferait un contact mort, donc une ligne que personne ne peut corriger.
    const { gateway } = waha([
      {
        status: 200,
        json: [{ name: 'Sans identifiant' }, { id: '213555123456@c.us', name: 'Ok' }],
      },
    ]);

    const contacts = await gateway.listContacts('comexa-abc', { limit: 10, offset: 0 });

    assert.equal(contacts.length, 1);
    assert.equal(contacts[0]!.name, 'Ok');
  });

  it('traduit un 402 en fonctionnalite soumise a licence', async () => {
    // `/api/contacts/all` fait partie de WAHA PLUS. Sans ce message, un
    // repertoire vide laisserait croire que le compte n'a aucun contact — donc
    // que la synchronisation a reussi.
    const { gateway } = waha([{ status: 402, json: { message: 'WAHA PLUS required' } }]);

    const error = await throwsWhatsAppGatewayError(
      gateway.listContacts('comexa-abc', { limit: 10, offset: 0 }),
    );

    assert.equal(error.code, WHATSAPP_ERROR_CODES.FEATURE_UNAVAILABLE);
    assert.match(error.message, /PLUS|licence/i);
  });
});

describe('EvolutionGateway — authentication, chemins et traductions', () => {
  it('envoie la cle dans l’en-tete apikey', async () => {
    const { gateway, calls } = evolution([{ status: 201, json: { instanceName: 'comexa-abc' } }]);

    await gateway.ensureSession('comexa-abc');

    assert.equal(calls[0]!.headers.apikey, CONFIG.apiKey);
    assert.match(calls[0]!.url, /^http:\/\/evo:8080\/instance\/create/);
    assert.ok(!calls[0]!.url.includes(CONFIG.apiKey));
  });

  it('cree l’instance en integration multidevice', async () => {
    // Seul `WHATSAPP-BAILEYS` peut appairer un compte PERSONNEL : l'integration
    // officielle (`WHATSAPP-BUSINESS-BAILEYS` ou l'API Cloud) exigerait un numero
    // d'entreprise dedie. Changer cette valeur changerait la nature du service.
    const { gateway, calls } = evolution([{ status: 201, json: {} }]);

    await gateway.ensureSession('comexa-abc');

    assert.equal((calls[0]!.body as { integration?: string }).integration, 'WHATSAPP-BAILEYS');
  });

  it('envoie le texte sur /message/sendText/{instance} avec le JID complet', async () => {
    const { gateway, calls } = evolution([
      {
        status: 200,
        json: { key: { id: 'BAE5ABC123', remoteJid: '213555123456@s.whatsapp.net' } },
      },
    ]);

    const result = await gateway.sendText('comexa-abc', '213555123456@s.whatsapp.net', 'Bonjour');

    assert.equal(calls[0]!.url, 'http://evo:8080/message/sendText/comexa-abc');
    assert.deepEqual(calls[0]!.body, { number: '213555123456@s.whatsapp.net', text: 'Bonjour' });
    assert.equal(result.messageId, 'BAE5ABC123');
  });

  it('traduit les etats de connexion', async () => {
    for (const [raw, expected] of [
      ['open', 'CONNECTED'],
      ['connecting', 'STARTING'],
      ['close', 'DISCONNECTED'],
      ['refused', 'FAILED'],
    ] as const) {
      const { gateway } = evolution([
        { status: 200, json: { instance: { state: raw } } },
        // L'instance appairee declenche une seconde lecture (le profil) :
        // repondre quelque chose d'inoffensif suffit.
        { status: 200, json: [] },
      ]);

      const state = await gateway.getStatus('comexa-abc');

      assert.equal(state.state, expected, String(raw));
    }
  });

  it('retombe sur DISCONNECTED pour un etat inconnu, en l’expliquant', async () => {
    const { gateway } = evolution([{ status: 200, json: { instance: { state: 'weird' } } }]);

    const state = await gateway.getStatus('comexa-abc');

    assert.equal(state.state, 'DISCONNECTED');
    assert.match(state.error ?? '', /weird/);
  });

  it('retire le prefixe data: du QR rendu par Evolution', async () => {
    // Evolution rend `data:image/png;base64,…`. Telegram attend les octets seuls.
    const { gateway } = evolution([
      { status: 200, json: { base64: 'data:image/png;base64,iVBORw0KGgo=' } },
    ]);

    const qr = await gateway.getQrCode('comexa-abc');

    assert.equal(qr.imageBase64, 'iVBORw0KGgo=');
    assert.ok(!qr.imageBase64!.startsWith('data:'));
  });

  it('rend la cle d’appairage quand Evolution en donne une', async () => {
    const { gateway } = evolution([
      { status: 200, json: { pairingCode: 'ABCD1234', code: '2@xyz' } },
    ]);

    const qr = await gateway.getQrCode('comexa-abc');

    assert.equal(qr.pairingCode, 'ABCD1234');
    assert.equal(qr.rawValue, '2@xyz');
  });

  it('dit qu’aucun QR n’est disponible quand l’instance est deja appairee', async () => {
    const { gateway } = evolution([{ status: 200, json: { instance: { state: 'open' } } }]);

    const error = await throwsWhatsAppGatewayError(gateway.getQrCode('comexa-abc'));

    assert.equal(error.code, WHATSAPP_ERROR_CODES.SESSION_NOT_CONNECTED);
  });

  it('traduit un 404 en instance introuvable', async () => {
    const { gateway } = evolution([{ status: 404, json: {} }]);

    const error = await throwsWhatsAppGatewayError(gateway.getStatus('comexa-abc'));

    assert.equal(error.code, WHATSAPP_ERROR_CODES.SESSION_NOT_FOUND);
  });
});

describe('les deux pilotes respectent le meme contrat', () => {
  it('annoncent leur pilote et leur configuration', () => {
    const { gateway: wahaGateway } = waha([]);
    const { gateway: evolutionGateway } = evolution([]);

    assert.equal(wahaGateway.driver, 'waha');
    assert.equal(evolutionGateway.driver, 'evolution');
    assert.equal(wahaGateway.configured, true);
    assert.equal(evolutionGateway.configured, true);
  });

  it('produisent le meme code pour une cle refusee', async () => {
    // Un workflow n8n branche ses reprises sur le CODE. Si WAHA rendait
    // `UPSTREAM_FAILED` et Evolution `UNAUTHORIZED` pour la meme faute, il
    // faudrait deux traitements pour un seul incident.
    const { gateway: wahaGateway } = waha([{ status: 401, json: {} }]);
    const { gateway: evolutionGateway } = evolution([{ status: 401, json: {} }]);

    const wahaError = await throwsWhatsAppGatewayError(wahaGateway.ensureSession('comexa-abc'));
    const evolutionError = await throwsWhatsAppGatewayError(
      evolutionGateway.ensureSession('comexa-abc'),
    );

    assert.equal(wahaError.code, evolutionError.code);
    assert.equal(wahaError.code, WHATSAPP_ERROR_CODES.UNAUTHORIZED);
  });
});
