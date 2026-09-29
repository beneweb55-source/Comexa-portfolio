import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { createBrevoApiTransport, parseSender } from './brevo.transport.js';
import type { OutgoingMail } from './mail.types.js';

/**
 * CE QUE CES TESTS PROTEGENT.
 *
 * Le transport HTTP de Brevo est le SEUL chemin d'envoi praticable sur un
 * hebergeur qui filtre les ports SMTP — le palier gratuit de Render, ou ce
 * backend est deploye. Une erreur ici ne se voit pas au demarrage : elle se voit
 * le jour ou quelqu'un demande la reinitialisation de son mot de passe et attend
 * un courriel qui n'arrive jamais. Aucun test d'integration ne couvre ce cas,
 * parce qu'il demanderait un compte Brevo reel.
 *
 * Trois familles d'assertions :
 *
 *   1. `parseSender` — la decomposition de `SMTP_FROM`. C'est le seul endroit ou
 *      une adresse d'expedition malformee est arretee, et elle doit l'etre au
 *      demarrage : un expediteur invalide ne produit sinon que des refus a
 *      chaque envoi, decouverts par un client qui ne recoit rien.
 *   2. la forme exacte de la requete — `POST` sur le bon point d'entree, en-tete
 *      `api-key`, corps JSON aux noms de champs de Brevo (`textContent` et non
 *      `text`). C'est un contrat externe : il ne se decouvre qu'en lisant ce qui
 *      part.
 *   3. les messages d'erreur — ils doivent NOMMER la cause (401 = mauvaise cle,
 *      400 = expediteur non verifie) et ne JAMAIS contenir la cle d'API, meme
 *      quand le tiers la recopie dans son propre corps d'erreur.
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

/** L'API HTTP attend une cle ; elle ne doit apparaitre dans AUCUN message d'erreur. */
const API_KEY = 'xkeysib-clef-secrete-a-ne-jamais-journaliser';

/**
 * Remplace `fetch` et retient ce qui a ete demande.
 *
 * L'implementation fournie decide seule de la reponse : c'est ce qui permet de
 * simuler un 401, un 400 ou une coupure reseau sans reseau.
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

/** Journal minimal : `createBrevoApiTransport` ne demande que `debug`. */
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
 * Premier appel enregistre.
 *
 * `noUncheckedIndexedAccess` type `calls[0]` en `FetchCall | undefined`, et
 * l'affirmer ici evite un `!` dissemine dans chaque test : un test qui echoue
 * sur « aucun appel » se lit mieux qu'un dereferencement sur `undefined`.
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
): ReturnType<typeof createBrevoApiTransport> {
  return createBrevoApiTransport({ apiKey: API_KEY, from, timeoutMs }, logger);
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

describe('parseSender — decomposition de SMTP_FROM', () => {
  it("separe le nom et l'adresse de « Comexa <no-reply@comexa.com> »", () => {
    assert.deepEqual(parseSender('Comexa <no-reply@comexa.com>'), {
      email: 'no-reply@comexa.com',
      name: 'Comexa',
    });
  });

  it('accepte une adresse seule : le nom est alors absent, et non vide', () => {
    const sender = parseSender('no-reply@comexa.com');

    assert.equal(sender.email, 'no-reply@comexa.com');
    // `name` absent plutot que `name: ''` : la requete omet alors le champ, ce
    // qui laisse Brevo afficher le nom du compte au lieu d'un libelle vide.
    assert.equal('name' in sender, false, 'le champ name ne doit pas exister');
  });

  it("tolere les espaces autour du nom et de l'adresse", () => {
    assert.deepEqual(parseSender('   Comexa   <   no-reply@comexa.com   >  '), {
      email: 'no-reply@comexa.com',
      name: 'Comexa',
    });
  });

  it('enleve les guillemets doubles qui entourent le nom', () => {
    assert.deepEqual(parseSender('"Comexa Algerie" <no-reply@comexa.com>'), {
      email: 'no-reply@comexa.com',
      name: 'Comexa Algerie',
    });
  });

  it('enleve les guillemets simples et preserve la virgule du nom', () => {
    // La virgule est le cas qui casse un en-tete SMTP mal compose ; elle doit
    // survivre a la decomposition pour que le transport SMTP la re-echappe.
    assert.deepEqual(parseSender("'Comexa, Algerie' <no-reply@comexa.com>"), {
      email: 'no-reply@comexa.com',
      name: 'Comexa, Algerie',
    });
  });

  it('preserve une virgule dans un nom non guillemete', () => {
    assert.deepEqual(parseSender('Comexa, Algerie <no-reply@comexa.com>'), {
      email: 'no-reply@comexa.com',
      name: 'Comexa, Algerie',
    });
  });

  it("accepte un angle sans nom d'affichage, sans produire de nom vide", () => {
    assert.deepEqual(parseSender('<no-reply@comexa.com>'), {
      email: 'no-reply@comexa.com',
    });
  });

  it('refuse une valeur sans arobase, en nommant le format attendu', () => {
    for (const raw of ['Comexa', 'Comexa <comexa>', '', 'comexa.com']) {
      assert.throws(
        () => parseSender(raw),
        (error: unknown) => {
          assert.ok(error instanceof Error, `Error attendue pour « ${raw} »`);
          assert.match(error.message, /SMTP_FROM/);
          assert.match(error.message, /Comexa <no-reply@comexa\.com>/);
          return true;
        },
        `« ${raw} » aurait du etre refuse`,
      );
    }
  });
});

describe('createBrevoApiTransport — la requete envoyee', () => {
  it("poste sur le point d'entree de Brevo, en HTTPS", async () => {
    const stub = stubFetch(async () => jsonResponse(201, { messageId: '<a@b>' }));

    try {
      await transportWith(captureLogger()).send(MAIL);

      assert.equal(firstCall(stub).url, 'https://api.brevo.com/v3/smtp/email');
      assert.equal(firstCall(stub).init.method, 'POST');
    } finally {
      stub.restore();
    }
  });

  it("presente la cle en en-tete `api-key`, jamais dans l'URL", async () => {
    const stub = stubFetch(async () => jsonResponse(201, { messageId: '<a@b>' }));

    try {
      await transportWith(captureLogger()).send(MAIL);

      const call = firstCall(stub);
      const headers = new Headers(call.init.headers);
      assert.equal(headers.get('api-key'), API_KEY);
      assert.equal(headers.get('content-type'), 'application/json');
      // Une cle en parametre d'URL se retrouve dans les journaux d'acces.
      assert.equal(call.url.includes(API_KEY), false, "la cle ne doit pas figurer dans l'URL");
    } finally {
      stub.restore();
    }
  });

  it('envoie le corps aux noms de champs de Brevo (textContent, htmlContent)', async () => {
    const stub = stubFetch(async () => jsonResponse(201, { messageId: '<a@b>' }));

    try {
      await transportWith(captureLogger()).send(MAIL);

      // Forme exacte attendue par `POST /v3/smtp/email`. Un `text` au lieu de
      // `textContent` serait ignore comme champ inconnu : le courriel partirait
      // sans corps de repli, et rien ne le signalerait.
      assert.deepEqual(payloadOf(firstCall(stub)), {
        sender: { email: 'no-reply@comexa.com', name: 'Comexa' },
        to: [{ email: 'client@exemple.tld' }],
        subject: 'Comexa — facture F-2026-001',
        textContent: 'Bonjour, votre facture est disponible.',
        htmlContent: '<p>Bonjour, votre facture est disponible.</p>',
      });
    } finally {
      stub.restore();
    }
  });

  it("omet le nom de l'expediteur quand il n'y en a pas", async () => {
    const stub = stubFetch(async () => jsonResponse(201, { messageId: '<a@b>' }));

    try {
      await transportWith(captureLogger(), { email: 'no-reply@comexa.com' }).send(MAIL);

      assert.deepEqual(payloadOf(firstCall(stub))['sender'], { email: 'no-reply@comexa.com' });
    } finally {
      stub.restore();
    }
  });

  it("pose un delai maximal sur l'appel, pour qu'un tiers muet ne bloque pas la requete", async () => {
    const stub = stubFetch(async () => jsonResponse(201, { messageId: '<a@b>' }));

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

  it("trace l'identifiant d'envoi renvoye par Brevo", async () => {
    const stub = stubFetch(async () => jsonResponse(201, { messageId: '<2026-09-29@brevo>' }));
    const logger = captureLogger();

    try {
      await transportWith(logger).send(MAIL);

      assert.equal(logger.lines.length, 1);
      assert.match(logger.lines[0] ?? '', /<2026-09-29@brevo>/);
      // Le destinataire n'a rien a faire dans un journal.
      assert.equal((logger.lines[0] ?? '').includes(MAIL.to), false);
    } finally {
      stub.restore();
    }
  });

  it('accepte une reponse de succes sans corps JSON', async () => {
    const stub = stubFetch(async () => new Response('OK', { status: 200 }));
    const logger = captureLogger();

    try {
      await transportWith(logger).send(MAIL);

      assert.match(logger.lines[0] ?? '', /sans identifiant/);
    } finally {
      stub.restore();
    }
  });
});

describe('createBrevoApiTransport — echecs', () => {
  it('abandonne apres le delai demande, en le nommant', async () => {
    const stub = stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          // `fetch` reel ne rejette que sur avortement du signal : on reproduit
          // ce seul comportement, sans simuler autre chose que le vrai.
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'TimeoutError')),
          );
        }),
    );

    // `AbortSignal.timeout` arme un minuteur NON REFERENCE. Dans l'application,
    // la boucle d'evenements est maintenue vivante par le serveur HTTP, donc
    // l'echeance arrive normalement ; dans un processus de test, il n'y a rien
    // d'autre a faire et Node conclut que la boucle est vide AVANT l'echeance —
    // le test se bloque alors sans jamais echouer. Ce minuteur-ci est reference,
    // et ne sert qu'a cela : laisser le temps au signal d'aboutir.
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
          assert.match(message, /API Brevo injoignable/);
          assert.match(message, /fetch failed/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("sur 401, oriente vers la cle d'API et non vers l'onglet SMTP", async () => {
    const stub = stubFetch(async () =>
      jsonResponse(401, { code: 'unauthorized', message: 'Key not found' }),
    );

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /HTTP 401/);
          assert.match(message, /Key not found/);
          // La confusion la plus probable au premier deploiement : coller la cle
          // de l'onglet SMTP (xkeysib-...) dans BREVO_API_KEY.
          assert.match(message, /API Keys/);
          assert.match(message, /xkeysib-/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("sur 403, oriente aussi vers la cle d'API", async () => {
    const stub = stubFetch(async () => jsonResponse(403, { message: 'Forbidden' }));

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /HTTP 403/);
          assert.match(message, /API Keys/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("sur 400 mentionnant l'expediteur, oriente vers la verification dans Brevo", async () => {
    const stub = stubFetch(async () =>
      jsonResponse(400, { code: 'invalid_parameter', message: 'sender is not valid' }),
    );

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /HTTP 400/);
          assert.match(message, /sender is not valid/);
          assert.match(message, /Senders, Domains & Dedicated IPs/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("n'ajoute aucune piste quand la cause est inconnue", async () => {
    const stub = stubFetch(async () => jsonResponse(500, { message: 'Internal error' }));

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.match(message, /HTTP 500/);
          // Une piste fausse est pire que pas de piste : elle envoie chercher au
          // mauvais endroit.
          assert.doesNotMatch(message, /API Keys/);
          assert.doesNotMatch(message, /Senders/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("masque la cle d'API meme quand le corps d'erreur la recopie", async () => {
    // Brevo ne renvoie pas la cle, mais une passerelle intermediaire peut
    // recopier la requete entrante — en-tete compris — dans son corps d'erreur.
    // Ces messages finissent dans les journaux de l'hebergeur.
    const stub = stubFetch(
      async () => new Response(`Bad request, api-key: ${API_KEY}, body rejected`, { status: 400 }),
    );

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.equal(message.includes(API_KEY), false, 'la cle ne doit pas apparaitre');
          assert.match(message, /\[cle masquee\]/);
          assert.match(message, /Bad request/);
        },
      );
    } finally {
      stub.restore();
    }
  });

  it("masque la cle d'API jusque dans le message d'une erreur de transport", async () => {
    const stub = stubFetch(async () => {
      throw new Error(`connect ECONNREFUSED for api-key ${API_KEY}`);
    });

    try {
      await rejectsWithMessage(
        () => transportWith(captureLogger()).send(MAIL),
        (message) => {
          assert.equal(message.includes(API_KEY), false, 'la cle ne doit pas apparaitre');
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
