import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { MAILJET_ENDPOINT, createMailjetApiTransport } from './mailjet.transport.js';
import type { OutgoingMail } from './mail.types.js';

/**
 * CE QUE CES TESTS PROTEGENT.
 *
 * Le transport HTTP de Mailjet est le SEUL chemin d'envoi praticable sur un
 * hebergeur qui filtre les ports SMTP — le palier gratuit de Render, ou ce
 * backend est deploye. Une erreur ici ne se voit pas au demarrage : elle se voit
 * le jour ou quelqu'un demande la reinitialisation de son mot de passe et attend
 * un courriel qui n'arrive jamais. Aucun test d'integration ne couvre ce cas,
 * parce qu'il demanderait un compte Mailjet reel.
 *
 * LE TEST CENTRAL EST CELUI DU PIEGE, ET IL MERITE D'ETRE DIT. Mailjet repond
 * **HTTP 200 alors qu'il a rejete le message** : le refus vit dans le corps, sous
 * `Messages[].Status`, et le vrai code dans `Errors[].StatusCode`. Un transport
 * qui se fierait au seul code HTTP resoudrait — donc annoncerait un succes — sur
 * un courriel que personne ne recevra. C'est pire qu'un echec franc : l'appelant
 * n'a plus aucune raison de chercher la panne du cote de l'envoi. La suite
 * « le piege du HTTP 200 » est donc la piece maitresse de ce fichier, et chaque
 * variante de reponse illisible y est traitee comme un ECHEC, jamais comme un
 * succes.
 *
 * Trois autres familles d'assertions :
 *
 *   1. la forme exacte de la requete — `POST` sur le bon point d'entree, en-tete
 *      `Authorization: Basic`, corps JSON aux noms de champs de Mailjet
 *      (`Messages[].TextPart`, et non `text`). C'est un contrat externe : il ne
 *      se decouvre qu'en lisant ce qui part.
 *   2. les messages d'erreur — ils doivent NOMMER la cause et ne JAMAIS contenir
 *      une des deux clefs, ni en clair, ni en base64 dans l'en-tete recopie.
 *   3. l'ordre des deux clefs — le couple part en HTTP Basic, et l'en-tete tel
 *      qu'il est construit doit etre celui que Mailjet attend.
 *
 * `fetch` est remplace, pas le transport : ce sont bien les octets partants qui
 * sont inspectes. Aucun appel reseau n'a lieu, aucune dependance n'est ajoutee.
 */

/** Types derives de `fetch` lui-meme : `@types/node` ne garantit pas `RequestInit` ici. */
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

interface FetchCall {
  url: string;
  init: FetchInit;
}

const MAIL: OutgoingMail = {
  to: 'client@exemple.tld',
  subject: 'Comexa — facture F-2026-001',
  text: 'Bonjour, votre facture est disponible.',
  html: '<p>Bonjour, votre facture est disponible.</p>',
};

/** Les deux clefs de Mailjet : aucune ne doit apparaitre dans un message d'erreur. */
const API_KEY = 'clef-publique-a-ne-jamais-journaliser';
const SECRET_KEY = 'clef-secrete-a-ne-jamais-journaliser';

/** L'en-tete tel qu'il part, pour verifier qu'il est masque lui aussi. */
const BASE64_OF_KEYS = Buffer.from(`${API_KEY}:${SECRET_KEY}`).toString('base64');

/**
 * Remplace `fetch` et retient ce qui a ete demande.
 *
 * L'implementation fournie decide seule de la reponse : c'est ce qui permet de
 * simuler un 401, un 400, un succes-mais-rejete ou une coupure reseau sans reseau.
 */
function stubFetch(handler: (url: string, init: FetchInit) => Promise<Response>): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];

  const stub = mock.method(
    globalThis,
    'fetch',
    async (input: FetchInput, init?: FetchInit): Promise<Response> => {
      const url = String(input);
      const effective = init ?? {};
      calls.push({ url, init: effective });
      return handler(url, effective);
    },
  );

  return { calls, restore: () => stub.mock.restore() };
}

/** Journal minimal : `createMailjetApiTransport` ne demande que `debug`. */
function captureLogger(): { lines: string[]; debug: (message: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    debug(message: string) {
      lines.push(message);
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Reponse de succes telle que Mailjet la rend.
 *
 * La forme est celle de la documentation : un tableau `Messages`, un `Status` par
 * entree, et l'identifiant du message dans l'objet `To`. La reutiliser garantit
 * qu'aucun test ne passe sur une reponse inventee.
 */
function successBody(messageUuid = 'uuid-2026-09-29'): unknown {
  return {
    Messages: [
      {
        Status: 'success',
        To: [
          {
            Email: 'client@exemple.tld',
            MessageUUID: messageUuid,
            MessageID: 123456789,
            MessageHref: 'https://api.mailjet.com/v3/message/123456789',
          },
        ],
      },
    ],
  };
}

/**
 * Reponse HTTP 200 annoncant un REJET.
 *
 * C'est la forme reelle, recopiee de la documentation : le code HTTP exterieur
 * est 200, le refus est dans le corps, et le vrai code est dans `Errors[]`.
 */
function rejectedBody(code: number, message: string, relatedTo?: string[]): unknown {
  return {
    Messages: [
      {
        Status: 'error',
        Errors: [
          {
            ErrorIdentifier: 'identifier-interne',
            ErrorCode: 'mj-0004',
            StatusCode: code,
            ErrorMessage: message,
            ...(relatedTo ? { ErrorRelatedTo: relatedTo } : {}),
          },
        ],
        To: [],
      },
    ],
  };
}

/**
 * Premier appel enregistre.
 *
 * `noUncheckedIndexedAccess` type `calls[0]` en `FetchCall | undefined`, et
 * l'affirmer ici evite un `!` dissemine dans chaque test : un test qui echoue sur
 * « aucun appel » se lit mieux qu'un dereferencement sur `undefined`.
 */
function firstCall(stub: { calls: FetchCall[] }): FetchCall {
  const call = stub.calls[0];
  assert.ok(call, 'aucun appel a fetch enregistre');
  return call;
}

/** Corps JSON de l'appel, relu tel qu'il part. */
function payloadOf(call: FetchCall): Record<string, unknown> {
  assert.equal(typeof call.init.body, 'string', 'corps de requete en chaine attendu');
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

function transportWith(
  logger: { debug: (message: string) => void },
  from: { email: string; name?: string } = { email: 'no-reply@comexa.com', name: 'Comexa' },
  timeoutMs?: number,
): ReturnType<typeof createMailjetApiTransport> {
  return createMailjetApiTransport(
    { apiKey: API_KEY, secretKey: SECRET_KEY, from, timeoutMs },
    logger,
  );
}

/** Raccourci : envoie et exige un rejet, en laissant le test inspecter l'erreur. */
async function rejectsWithMessage(
  run: () => Promise<void>,
  check: (message: string) => void,
): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof Error, `un rejet etait attendu, recu : ${String(caught)}`);
  check(caught.message);
}

afterEach(() => {
  mock.restoreAll();
});

describe('createMailjetApiTransport — la requete envoyee', () => {
  it("poste sur le point d'entree de Mailjet, en HTTPS et en POST", async () => {
    const stub = stubFetch(async () => jsonResponse(200, successBody()));

    try {
      await transportWith(captureLogger()).send(MAIL);

      assert.equal(MAILJET_ENDPOINT, 'https://api.mailjet.com/v3.1/send');
      assert.equal(firstCall(stub).url, MAILJET_ENDPOINT);
      assert.equal(firstCall(stub).init.method, 'POST');
    } finally {
      stub.restore();
    }
  });

  it("presente le couple de clefs en `Authorization: Basic`, jamais dans l'URL", async () => {
    const stub = stubFetch(async () => jsonResponse(200, successBody()));

    try {
      await transportWith(captureLogger()).send(MAIL);

      const call = firstCall(stub);
      const headers = new Headers(call.init.headers);

      // Mailjet authentifie en HTTP Basic : cle publique en identifiant, cle
      // secrete en mot de passe. Les deux sont jointes par deux points, puis
      // encodees en base64.
      assert.equal(headers.get('authorization'), `Basic ${BASE64_OF_KEYS}`);
      assert.equal(headers.get('content-type'), 'application/json');
      // Une clef en parametre d'URL se retrouve dans les journaux d'acces.
      assert.equal(call.url.includes(API_KEY), false, "la clef ne doit pas figurer dans l'URL");
      assert.equal(call.url.includes(SECRET_KEY), false, "la clef ne doit pas figurer dans l'URL");
    } finally {
      stub.restore();
    }
  });

  it('envoie le corps aux noms de champs de Mailjet (Messages, TextPart, HTMLPart)', async () => {
    const stub = stubFetch(async () => jsonResponse(200, successBody()));

    try {
      await transportWith(captureLogger()).send(MAIL);

      // Forme exacte attendue par `POST /v3.1/send`. Un `text` au lieu de
      // `TextPart` serait ignore comme champ inconnu : le courriel partirait sans
      // corps de repli, et rien ne le signalerait. La casse compte aussi — ces
      // noms sont en capitales, et l'API ne les corrige pas.
      assert.deepEqual(payloadOf(firstCall(stub)), {
        Messages: [
          {
            From: { Email: 'no-reply@comexa.com', Name: 'Comexa' },
            To: [{ Email: 'client@exemple.tld' }],
            Subject: 'Comexa — facture F-2026-001',
            TextPart: 'Bonjour, votre facture est disponible.',
            HTMLPart: '<p>Bonjour, votre facture est disponible.</p>',
          },
        ],
      });
    } finally {
      stub.restore();
    }
  });

  it("omet le nom de l'expediteur quand il n'y en a pas", async () => {
    const stub = stubFetch(async () => jsonResponse(200, successBody()));

    try {
      await transportWith(captureLogger(), { email: 'no-reply@comexa.com' }).send(MAIL);

      const messages = payloadOf(firstCall(stub))['Messages'];
      assert.ok(Array.isArray(messages), 'Messages doit etre un tableau');
      const from = (messages[0] as Record<string, unknown>)['From'];
      assert.deepEqual(from, { Email: 'no-reply@comexa.com' });
    } finally {
      stub.restore();
    }
  });

  it("pose un delai maximal sur l'appel, pour qu'un tiers muet ne bloque pas la requete", async () => {
    const stub = stubFetch(async () => jsonResponse(200, successBody()));

    try {
      await transportWith(captureLogger()).send(MAIL);

      assert.ok(
        firstCall(stub).init.signal instanceof AbortSignal,
        'un AbortSignal doit accompagner chaque envoi',
      );
    } finally {
      stub.restore();
    }
  });

  it("trace l'identifiant d'envoi renvoye par Mailjet, sans le destinataire", async () => {
    const stub = stubFetch(async () => jsonResponse(200, successBody('<2026-09-29@mailjet>')));
    const logger = captureLogger();

    try {
      await transportWith(logger).send(MAIL);

      assert.equal(logger.lines.length, 1);
      assert.match(logger.lines[0] ?? '', /<2026-09-29@mailjet>/);
      assert.equal((logger.lines[0] ?? '').includes(MAIL.to), false);
    } finally {
      stub.restore();
    }
  });

  it("signale un succes dont l'identifiant est absent, sans echouer pour autant", async () => {
    const stub = stubFetch(async () =>
      jsonResponse(200, { Messages: [{ Status: 'success', To: [] }] }),
    );
    const logger = captureLogger();

    try {
      await transportWith(logger).send(MAIL);

      assert.match(logger.lines[0] ?? '', /sans identifiant/);
    } finally {
      stub.restore();
    }
  });
});

/**
 * LE PIEGE : HTTP 200 veut dire « requete recue », jamais « courriel accepte ».
 */
describe('createMailjetApiTransport — le piege du HTTP 200', () => {
  it('LEVE sur un rejet annonce en HTTP 200, au lieu de le prendre pour un succes', async () => {
    const stub = stubFetch(async () =>
      jsonResponse(200, rejectedBody(400, 'Sender is not validated')),
    );
    const logger = captureLogger();

    try {
      await rejectsWithMessage(
        () => transportWith(logger).send(MAIL),
        (message) => {
          // Le mot compte : Mailjet a VU le courriel et l'a refuse. Dire
          // « injoignable » enverrait chercher une panne reseau qui n'existe pas.
          assert.match(message, /a rejete l'envoi/);
          assert.match(message, /Sender is not validated/);
        },
      );

      // Et surtout : rien n'a ete annonce comme accepte.
      assert.deepEqual(logger.lines, [], 'un rejet ne doit rien tracer comme accepte');
    } finally {
      stub.restore();
    }
  });

  it("lit le vrai code dans Errors[].StatusCode, et non le 200 de l'enveloppe", async () => {
    // Le discriminant est volontaire : sur un HTTP 200 generique, aucune piste
    // d'authentification n'est ajoutee. Si la piste « 401 » apparait, c'est bien
    // le code INTERNE qui a ete lu.
    const stub = stubFetch(async () =>
      jsonResponse(200, rejectedBody(401, 'Unauthorized for this resource')),
    );

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /Unauthorized for this resource/);
          assert.match(message, /API Key Management/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it('cite le chemin du champ fautif quand Mailjet le fournit', async () => {
    const stub = stubFetch(async () =>
      jsonResponse(200, rejectedBody(400, 'Invalid email address', ['Messages.0.To'])),
    );

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          // `ErrorRelatedTo` designe le champ fautif : c'est ce qui fait gagner le
          // temps passe a deviner lequel des champs est en cause.
          assert.match(message, /Messages\.0\.To/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("accumule plusieurs erreurs plutot que de n'en garder qu'une", async () => {
    const stub = stubFetch(async () =>
      jsonResponse(200, {
        Messages: [
          {
            Status: 'error',
            Errors: [
              { ErrorCode: 'mj-0001', StatusCode: 400, ErrorMessage: 'Premiere erreur' },
              { ErrorCode: 'mj-0002', StatusCode: 400, ErrorMessage: 'Seconde erreur' },
            ],
            To: [],
          },
        ],
      }),
    );

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /Premiere erreur/);
          assert.match(message, /Seconde erreur/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it('signale un rejet sans detail, en reprenant le statut REEL', async () => {
    const stub = stubFetch(async () =>
      jsonResponse(200, { Messages: [{ Status: 'error', To: [] }] }),
    );

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          // Le statut est repris de la reponse plutot qu'invente : c'est lui qui
          // oriente la recherche, et « error » sans detail n'est pas « 400 ».
          assert.match(message, /statut « error » sans detail/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("REFUSE de conclure au succes quand le corps n'est pas du JSON", async () => {
    // Le silence n'est pas un accord. Un 200 dont on ne sait rien lire ne prouve
    // pas que le courriel est parti : le declarer accepte reproduirait exactement
    // le mensonge que ce transport existe pour empecher.
    const stub = stubFetch(async () => new Response('OK', { status: 200 }));

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /n'a pas confirme l'envoi/);
          assert.match(message, /corps non-JSON/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it('REFUSE de conclure au succes quand le tableau Messages est absent', async () => {
    const stub = stubFetch(async () => jsonResponse(200, { SuccessCount: 1 }));

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /n'a pas confirme l'envoi/);
          assert.match(message, /Messages/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("REFUSE de conclure au succes quand aucun statut n'est lisible", async () => {
    const stub = stubFetch(async () =>
      jsonResponse(200, { Messages: [{ To: [{ Email: 'client@exemple.tld' }] }] }),
    );

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /n'a pas confirme l'envoi/);
          assert.match(message, /Status/);
        },
      );
    } finally {
      stub.restore();
    }
  });
});

describe('createMailjetApiTransport — echecs', () => {
  it('abandonne apres le delai demande, en le nommant', async () => {
    const stub = stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          // `fetch` reel ne rejette que sur avortement du signal : on reproduit ce
          // seul comportement, sans simuler autre chose que le vrai.
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'TimeoutError')),
          );
        }),
    );

    // `AbortSignal.timeout` arme un minuteur NON REFERENCE. Dans l'application, la
    // boucle d'evenements est maintenue vivante par le serveur HTTP, donc
    // l'echeance arrive normalement ; dans un processus de test, il n'y a rien
    // d'autre a faire et Node conclut que la boucle est vide AVANT l'echeance — le
    // test se bloquerait alors sans jamais echouer. Ce minuteur-ci est reference,
    // et ne sert qu'a cela.
    const keepAlive = setInterval(() => undefined, 5);

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger(), undefined, 25).send(MAIL),
        (message) => {
          assert.match(message, /injoignable/);
          assert.match(message, /25 ms/);
        },
      );
    } finally {
      clearInterval(keepAlive);
      stub.restore();
    }
  });

  it('signale une panne reseau comme « injoignable », avec la cause', async () => {
    const stub = stubFetch(async () => {
      throw new TypeError('fetch failed');
    });

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /API Mailjet injoignable/);
          assert.match(message, /fetch failed/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it('sur 401, oriente vers le couple de clefs et non vers les identifiants SMTP', async () => {
    const stub = stubFetch(async () =>
      jsonResponse(401, {
        ErrorIdentifier: 'unauthorized',
        ErrorCode: 'mj-0002',
        StatusCode: 401,
        ErrorMessage: 'Invalid credentials',
      }),
    );

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /HTTP 401/);
          assert.match(message, /Invalid credentials/);
          // La confusion la plus probable au premier deploiement : coller les
          // identifiants SMTP de Mailjet, qui ne conviennent pas ici.
          assert.match(message, /API Key Management/);
          assert.match(message, /SMTP_USER/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it('sur 403, oriente aussi vers le couple de clefs', async () => {
    const stub = stubFetch(async () => jsonResponse(403, { ErrorMessage: 'Forbidden' }));

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /HTTP 403/);
          assert.match(message, /API Key Management/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("sur un refus mentionnant l'expediteur, oriente vers sa validation", async () => {
    const stub = stubFetch(async () =>
      jsonResponse(400, { ErrorCode: 'mj-0004', ErrorMessage: 'Sender is not valid' }),
    );

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /HTTP 400/);
          assert.match(message, /Sender is not valid/);
          assert.match(message, /Sender domains & addresses/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it('rappelle le mode Test et le plafond journalier quand le refus y ressemble', async () => {
    const stub = stubFetch(async () =>
      jsonResponse(200, rejectedBody(429, 'Too many messages, rate limit exceeded')),
    );

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          // Ces deux limites sont la cause la plus frequente sur un compte neuf, et
          // la seconde est invisible dans les reponses : elle merite d'etre
          // rappelee la ou on la lit.
          assert.match(message, /Test Mode/);
          assert.match(message, /200 courriels par jour/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("n'ajoute aucune piste quand la cause est inconnue", async () => {
    const stub = stubFetch(async () =>
      jsonResponse(500, { ErrorCode: 'mj-9999', ErrorMessage: 'Internal error' }),
    );

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /HTTP 500/);
          // Une piste fausse est pire que pas de piste : elle envoie chercher au
          // mauvais endroit.
          assert.doesNotMatch(message, /API Key Management/);
          assert.doesNotMatch(message, /Sender domains/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("masque les DEUX clefs quand le corps d'erreur les recopie", async () => {
    // Mailjet ne renvoie pas les clefs, mais une passerelle intermediaire peut
    // recopier la requete entrante — en-tete compris — dans son corps d'erreur.
    // Ces messages finissent dans les journaux de l'hebergeur.
    const stub = stubFetch(
      async () =>
        new Response(`Bad request for ${API_KEY} / ${SECRET_KEY}, body rejected`, {
          status: 400,
        }),
    );

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.equal(message.includes(API_KEY), false, 'la clef publique ne doit pas apparaitre');
          assert.equal(
            message.includes(SECRET_KEY),
            false,
            'la clef secrete ne doit pas apparaitre',
          );
          assert.match(message, /\[cle masquee\]/);
          assert.match(message, /Bad request/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("masque l'en-tete Basic recopie, ou les deux clefs voyagent encodees", async () => {
    // Masquer les clefs en clair ne suffit pas : base64 n'est pas du chiffrement,
    // et l'en-tete `authorization` contient les deux. Un journal qui le contient
    // est un journal ou les clefs se lisent en une commande.
    const stub = stubFetch(
      async () => new Response(`echo of Authorization: Basic ${BASE64_OF_KEYS}`, { status: 400 }),
    );

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.equal(
            message.includes(BASE64_OF_KEYS),
            false,
            "l'en-tete encode ne doit pas apparaitre",
          );
          assert.match(message, /\[cle masquee\]/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("masque les clefs jusque dans le message d'une erreur de transport", async () => {
    const stub = stubFetch(async () => {
      throw new Error(`connect ECONNREFUSED with ${BASE64_OF_KEYS}`);
    });

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.equal(message.includes(BASE64_OF_KEYS), false, 'la clef ne doit pas apparaitre');
          assert.match(message, /ECONNREFUSED/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("accepte un corps d'erreur qui n'est pas du JSON", async () => {
    const stub = stubFetch(async () => new Response('Bad Gateway', { status: 502 }));

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /HTTP 502/);
          assert.match(message, /Bad Gateway/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("accepte un corps d'erreur vide", async () => {
    const stub = stubFetch(async () => new Response('', { status: 503 }));

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /HTTP 503/);
        },
      );
    } finally {
      stub.restore();
    }
  });
});
