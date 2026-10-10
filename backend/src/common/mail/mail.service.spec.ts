// En PREMIER, et volontairement : `MailService` est decore (`@Injectable()`), et
// un decorateur applique appelle `Reflect.defineMetadata`. Le polyfill arrive
// aujourd'hui par le graphe d'imports de `@nestjs/common` — donc par effet de
// bord d'un autre paquet. Ce fichier ne veut pas en dependre.
import 'reflect-metadata';

import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, it, mock } from 'node:test';
import type { OutgoingMail } from './mail.types.js';
import { MailService } from './mail.service.js';

/**
 * CE QUE CES TESTS PROTEGENT.
 *
 * `MailService` choisit son transport, et ce choix est la seule decision
 * d'architecture de ce module : le backend est deploye sur un hebergeur qui
 * filtre les ports SMTP, donc le couple `MAILJET_API_KEY` + `MAILJET_SECRET_KEY`
 * (API HTTP, port 443) doit l'emporter sur `SMTP_HOST` quand les deux sont
 * presents. La regle inverse ferait retomber en SILENCE sur le transport qui ne
 * fonctionne pas : le serveur demarrerait, chaque envoi echouerait, et personne
 * ne le saurait avant qu'un utilisateur ne signale qu'il n'a jamais recu son lien
 * de reinitialisation.
 *
 * Cinq points sont donc fixes ici :
 *
 *   1. la precedence — l'API HTTP gagne, et c'est le transport qui ENVOIE
 *      vraiment qui le prouve, pas seulement le journal ;
 *   2. l'annonce du transport actif au demarrage, parce que « pourquoi ce
 *      courriel n'est-il pas parti » se repond d'abord en lisant cette ligne ;
 *   3. l'echec au DEMARRAGE sur un expediteur malforme, plutot qu'a l'envoi ;
 *   4. l'absence de transport, qui doit etre SIGNALEE et non silencieuse ;
 *   5. le rejet du fournisseur, qui doit REMONTER au lieu d'etre transforme en
 *      succes — c'est le mensonge le plus couteux que ce module puisse produire,
 *      et le transport ne suffit pas a l'empecher : c'est ici que se decide si
 *      l'echec atteint l'appelant ou s'arrete.
 *
 * La forme des reponses simulees a suivi le changement de fournisseur, et elle
 * compte autant que le reste : voir `successBody` ci-dessous.
 *
 * Aucun appel reseau : `fetch` est remplace, et le seul cas qui emprunte le
 * transport SMTP est dirige vers un port local sans ecouteur.
 */

/** Types derives de `fetch` : `@types/node` ne garantit pas `RequestInit` ici. */
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

const MAIL: OutgoingMail = {
  to: 'client@exemple.tld',
  subject: 'Comexa — facture F-2026-001',
  text: 'Bonjour, votre facture est disponible.',
  html: '<p>Bonjour, votre facture est disponible.</p>',
};

const FROM = 'Comexa <no-reply@comexa.com>';

/**
 * Identifiants d'API : les DEUX, parce que le transport exige le couple.
 *
 * Les valeurs n'ont pas besoin d'etre secretes ici — `fetch` est remplace, donc
 * rien ne part — et les garder lisibles rend les messages d'echec plus courts a
 * diagnostiquer.
 */
const API_CREDENTIALS: Record<string, string> = {
  MAILJET_API_KEY: 'clef-publique',
  MAILJET_SECRET_KEY: 'clef-secrete',
};

/**
 * `ConfigService` reduit a ce que `MailService` utilise.
 *
 * Le vrai service resout des fichiers et des variables d'environnement ; le
 * passer par `unknown` evite de reconstruire cette mecanique pour un test qui ne
 * porte que sur la lecture de quatre cles.
 */
function configOf(values: Record<string, string | number>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
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
 * LA FORME COMPTE AUTANT QUE LE CONTENU. Le transport ne se fie pas au code HTTP :
 * il relit le corps et n'annonce un succes que si celui-ci l'ECRIT, sous
 * `Messages[].Status`. Un simulacre plus simple — `{"messageId":"..."}`, ce que
 * renvoyait le transport precedent sous un HTTP 201 — serait classe « reponse
 * illisible », et `send()` leverait. Toutes les assertions de ce fichier sur le
 * contenu des courriels echoueraient alors pour une raison qui n'a rien a voir
 * avec ce qu'elles verifient.
 */
function successBody(): unknown {
  return {
    Messages: [
      {
        Status: 'success',
        To: [{ Email: 'client@exemple.tld', MessageUUID: 'uuid-de-test' }],
      },
    ],
  };
}

/**
 * Remplace `fetch` par une reponse de succes et retient les corps envoyes.
 *
 * Aucun appel reseau n'a lieu, et le corps reellement transmis est inspecte :
 * c'est ce qui permet de verifier le lien profond construit par les gabarits.
 * `respond` permet au cas qui en a besoin de simuler un echec du fournisseur ;
 * le rang de l'appel lui est passe, pour un stub qui repondrait differemment au
 * deuxieme envoi.
 */
function stubFetchCapture(
  respond: (call: number) => Response = () => jsonResponse(200, successBody()),
): { bodies: string[]; restore: () => void } {
  const bodies: string[] = [];

  const stub = mock.method(
    globalThis,
    'fetch',
    async (_input: FetchInput, init?: FetchInit): Promise<Response> => {
      bodies.push(typeof init?.body === 'string' ? init.body : '');
      return respond(bodies.length - 1);
    },
  );

  return { bodies, restore: () => stub.mock.restore() };
}

/** Corps JSON d'un envoi, tel qu'il est parti. */
function payloadOf(bodies: string[], index = 0): Record<string, unknown> {
  const body = bodies[index];
  assert.ok(body, `aucun envoi enregistre a l'index ${index}`);
  return JSON.parse(body) as Record<string, unknown>;
}

/**
 * La seule entree de `Messages`, deja dereferencee.
 *
 * Mailjet encapsule le courriel dans un tableau d'un element. Traverser ces deux
 * niveaux dans chaque assertion ferait lire une erreur de FORME comme une erreur
 * de CONTENU : « le lien est absent du HTML » au lieu de « la reponse n'a pas la
 * forme attendue ». Le dereferencement est fait ici, une fois, et il echoue avec
 * un message qui dit lequel des deux niveaux manque.
 */
function messageOf(bodies: string[], index = 0): Record<string, unknown> {
  const messages = payloadOf(bodies, index)['Messages'];

  if (!Array.isArray(messages)) {
    assert.fail('Messages doit etre un tableau dans le corps envoye');
  }

  const message = messages[0];
  assert.ok(message !== null && typeof message === 'object', 'Messages[0] doit etre un objet');

  return message as Record<string, unknown>;
}

/** Contenu d'un envoi, lu sur la piece qui part reellement. */
function partOf(bodies: string[], key: 'HTMLPart' | 'TextPart' | 'Subject', index = 0): string {
  return String(messageOf(bodies, index)[key] ?? '');
}

/**
 * Capture les lignes ecrites par `Logger`.
 *
 * Les methodes sont remplacees sur le PROTOTYPE, et non sur l'instance : le
 * transport est resolu dans le constructeur de `MailService`, donc avant que le
 * test n'ait la moindre reference au service. Passer par le prototype est ce qui
 * permet de voir la ligne de demarrage.
 */
function captureLogs(): { lines: string[] } {
  const lines: string[] = [];
  const record = (...args: unknown[]): void => {
    lines.push(String(args[0]));
  };

  mock.method(Logger.prototype, 'log', record);
  mock.method(Logger.prototype, 'warn', record);
  mock.method(Logger.prototype, 'debug', record);

  return { lines };
}

/**
 * Transport retenu, lu sur l'instance.
 *
 * `kind` est public sur `MailTransport` et documente comme servant a la trace de
 * demarrage ; c'est exactement ce qu'on verifie. Le champ lui-meme est prive,
 * d'ou la lecture par une vue typee plutot qu'un `any`.
 */
function kindOf(service: MailService): string | null {
  const internals = service as unknown as { transport: { kind: string } | null };
  return internals.transport?.kind ?? null;
}

afterEach(() => {
  mock.restoreAll();
});

describe('MailService — choix du transport', () => {
  it("retient l'API HTTP quand le couple de clefs Mailjet est renseigne", () => {
    const logs = captureLogs();
    const service = new MailService(configOf({ ...API_CREDENTIALS, SMTP_FROM: FROM }));

    assert.equal(kindOf(service), 'mailjet-api');
    assert.equal(service.isConfigured, true);
    assert.match(logs.lines.join('\n'), /API HTTP Mailjet/);
    assert.match(logs.lines.join('\n'), /port 443/);
  });

  it("DONNE LA PRECEDENCE a l'API quand les deux sont renseignes", () => {
    const logs = captureLogs();
    const service = new MailService(
      configOf({
        ...API_CREDENTIALS,
        SMTP_HOST: 'smtp.exemple.tld',
        SMTP_PORT: 587,
        SMTP_FROM: FROM,
      }),
    );

    // C'est la decision qui rend le deploiement viable sur un hebergeur qui
    // filtre le SMTP : choisir l'autre transport ferait echouer chaque envoi
    // sans le dire.
    assert.equal(kindOf(service), 'mailjet-api');
    assert.match(logs.lines.join('\n'), /API HTTP Mailjet/);
  });

  it('signale une cle seule et retombe sur le SMTP, au lieu de la garder en silence', () => {
    // Le transport exige le couple : une cle publique sans sa secrete donne un 401
    // a chaque envoi. Se taire ferait chercher la panne partout sauf dans la
    // variable non remplie — d'ou l'avertissement, qui doit NOMMER la manquante.
    const logs = captureLogs();
    const service = new MailService(
      configOf({
        MAILJET_API_KEY: 'clef-publique',
        SMTP_HOST: 'smtp.exemple.tld',
        SMTP_PORT: 587,
        SMTP_FROM: FROM,
      }),
    );

    assert.equal(kindOf(service), 'smtp');
    assert.match(logs.lines.join('\n'), /MAILJET_SECRET_KEY/);
    assert.match(logs.lines.join('\n'), /ENSEMBLE/);
  });

  it('retient le SMTP quand seul SMTP_HOST est renseigne', () => {
    const logs = captureLogs();
    const service = new MailService(
      configOf({ SMTP_HOST: 'smtp.exemple.tld', SMTP_PORT: 587, SMTP_FROM: FROM }),
    );

    assert.equal(kindOf(service), 'smtp');
    assert.equal(service.isConfigured, true);
    // Le port est annonce : c'est ce qui distingue 587 de 465 quand un relais
    // refuse la connexion.
    assert.match(logs.lines.join('\n'), /SMTP smtp\.exemple\.tld:587/);
  });

  it("n'annonce aucun transport, et le signale, quand rien n'est configure", () => {
    const logs = captureLogs();
    const service = new MailService(configOf({}));

    assert.equal(kindOf(service), null);
    assert.equal(service.isConfigured, false);
    // L'absence doit etre VISIBLE : c'est elle qui explique, plus tard, pourquoi
    // le lien de reinitialisation n'est jamais arrive.
    assert.match(logs.lines.join('\n'), /aucun transport configure/);
    assert.match(logs.lines.join('\n'), /MAILJET_API_KEY/);
    assert.match(logs.lines.join('\n'), /SMTP_HOST/);
  });

  it("echoue au DEMARRAGE si l'expediteur est malforme, quel que soit le transport", () => {
    // Un expediteur invalide ne produirait sinon que des refus a chaque envoi :
    // une panne decouverte par un client qui ne recoit rien.
    // Le type est explicite : sans lui, le tableau se widen en une union ou
    // chaque cle absente devient `undefined`, ce qui ne rentre plus dans
    // `Record<string, string | number>` — et le fichier est compile aussi par
    // `tsconfig.e2e.json`, donc l'erreur sort au build des tests de bout en bout.
    const cases: Record<string, string>[] = [
      { ...API_CREDENTIALS },
      { SMTP_HOST: 'smtp.exemple.tld' },
    ];

    for (const transport of cases) {
      assert.throws(
        () => new MailService(configOf({ ...transport, SMTP_FROM: 'Comexa' })),
        /SMTP_FROM/,
        `« ${JSON.stringify(transport)} » aurait du refuser de demarrer`,
      );
    }
  });

  it("reprend l'expediteur par defaut quand SMTP_FROM est absent", () => {
    // Le defaut de `env.validation.ts` est une adresse valide : sans `SMTP_FROM`,
    // le service doit demarrer, pas lever.
    const logs = captureLogs();
    const service = new MailService(configOf({ ...API_CREDENTIALS }));

    assert.equal(kindOf(service), 'mailjet-api');
    assert.match(logs.lines.join('\n'), /no-reply@comexa\.example/);
  });
});

describe('MailService — envoi', () => {
  it("envoie reellement par l'API HTTP quand elle est configuree", async () => {
    captureLogs();
    const stub = stubFetchCapture();

    try {
      const service = new MailService(
        configOf({
          ...API_CREDENTIALS,
          // Le SMTP est renseigne AUSSI : c'est la situation reelle d'une
          // installation qui possede les deux jeux d'identifiants.
          SMTP_HOST: 'smtp.exemple.tld',
          SMTP_FROM: FROM,
        }),
      );

      await service.send(MAIL);

      // Le transport qui ENVOIE est celui qu'on a annonce : c'est la seule
      // preuve qui compte, le journal ne suffirait pas.
      assert.equal(stub.bodies.length, 1);
      assert.deepEqual(messageOf(stub.bodies)['To'], [{ Email: 'client@exemple.tld' }]);
      assert.equal(partOf(stub.bodies, 'Subject'), MAIL.subject);
    } finally {
      stub.restore();
    }
  });

  it('laisse REMONTER un rejet du fournisseur au lieu de le transformer en succes', async () => {
    captureLogs();
    const stub = stubFetchCapture(() =>
      // HTTP 200, et pourtant un rejet : c'est exactement la reponse que Mailjet
      // rend quand il refuse un envoi. L'avaler ici ferait croire a l'appelant
      // que la facture est partie — et personne n'irait jamais chercher la panne,
      // ni du cote de l'expediteur, ni du cote du quota.
      jsonResponse(200, {
        Messages: [
          {
            Status: 'error',
            Errors: [
              {
                ErrorCode: 'mj-0004',
                StatusCode: 400,
                ErrorMessage: 'Sender is not validated',
                ErrorRelatedTo: ['Messages.0.From'],
              },
            ],
            To: [],
          },
        ],
      }),
    );

    try {
      const service = new MailService(configOf({ ...API_CREDENTIALS, SMTP_FROM: FROM }));

      await assert.rejects(() => service.send(MAIL), /Sender is not validated/);
    } finally {
      stub.restore();
    }
  });

  it("n'emprunte PAS l'API quand seul SMTP_HOST est configure", async () => {
    captureLogs();
    const stub = stubFetchCapture();

    try {
      const service = new MailService(
        // Port 1 : aucun ecouteur, donc un refus de connexion immediat. Le but
        // n'est pas de tester l'echec, mais de prouver que le chemin emprunte est
        // bien le SMTP et non l'API.
        configOf({ SMTP_HOST: '127.0.0.1', SMTP_PORT: 1, SMTP_FROM: FROM }),
      );

      assert.equal(kindOf(service), 'smtp');

      // Course contre une echeance courte : si le port etait filtre au lieu
      // d'etre ferme, nodemailer attendrait deux minutes. La suite ne doit pas
      // pouvoir se bloquer la-dessus.
      const outcome = await Promise.race([
        service.send(MAIL).then(
          () => 'sent',
          () => 'failed',
        ),
        new Promise<string>((resolve) => {
          setTimeout(() => resolve('timeout'), 2_000);
        }),
      ]);

      assert.equal(outcome, 'failed', 'un envoi SMTP vers un port ferme doit echouer');
      assert.deepEqual(stub.bodies, [], "l'API HTTP ne doit pas avoir ete appelee");
    } finally {
      stub.restore();
    }
  });

  it("ecrit le courriel dans les journaux quand aucun transport n'est configure", async () => {
    const logs = captureLogs();
    // `NODE_ENV` absent vaut « hors production » : c'est le poste de
    // developpement, et le seul cas ou le corps du courriel est recopie.
    const service = new MailService(configOf({}));

    // Ne doit PAS lever : en developpement, l'absence de transport est normale,
    // et un appelant qui declenche un envoi ne doit pas voir une panne.
    await service.send(MAIL);

    const output = logs.lines.join('\n');
    assert.match(output, /COURRIEL NON ENVOYE/);
    assert.match(output, /client@exemple\.tld/);
    assert.match(output, /Bonjour, votre facture est disponible\./);
  });

  it('ne recopie PAS le corps du courriel dans les journaux de production', async () => {
    const logs = captureLogs();
    const service = new MailService(configOf({ NODE_ENV: 'production' }));

    await service.send(MAIL);

    const output = logs.lines.join('\n');

    // La banniere et le destinataire RESTENT : c'est la seule trace qu'un
    // courriel a ete perdu, et une trace sans destinataire ne dit pas lequel.
    assert.match(output, /COURRIEL NON ENVOYE/);
    assert.match(output, /client@exemple\.tld/);
    assert.match(output, /NON JOURNALISE/);

    // Le corps, lui, ne doit pas y etre. Le controle porte sur la chaine EXACTE
    // du message : il vaut donc pour tout gabarit present ou futur, et pas
    // seulement pour celui de ce test.
    assert.equal(
      output.includes(MAIL.text),
      false,
      'le corps du courriel ne doit pas etre journalise en production',
    );
  });

  it('ne divulgue pas le jeton de reinitialisation dans les journaux de production', async () => {
    // LE CAS QUI MOTIVE LE PRECEDENT, et il est plus fort que lui : ce n'est pas
    // le texte du courriel qui est dangereux, c'est le lien qu'il contient. Un
    // jeton recopie dans un journal vaut un compte ouvert pour qui lit ce
    // journal, et il reste valable une heure.
    const logs = captureLogs();
    const service = new MailService(configOf({ NODE_ENV: 'production' }));
    const token = 'jeton-a-usage-unique-8f3c1d';

    await service.sendPasswordReset({
      to: 'client@exemple.tld',
      firstName: 'Samir',
      token,
      expiresInLabel: '1 heure',
    });

    const output = logs.lines.join('\n');
    assert.match(output, /COURRIEL NON ENVOYE/);
    assert.equal(
      output.includes(token),
      false,
      'le jeton ne doit pas apparaitre dans les journaux',
    );
    assert.equal(
      output.includes('/reset-password'),
      false,
      'le lien de reinitialisation ne doit pas apparaitre dans les journaux',
    );
  });
});

describe('MailService — gabarits et liens profonds', () => {
  it('construit le lien de reinitialisation depuis FRONTEND_URL, sans double slash', async () => {
    captureLogs();
    const stub = stubFetchCapture();

    try {
      const service = new MailService(
        configOf({
          ...API_CREDENTIALS,
          // Le slash final est le cas reel : une variable saisie a la main dans
          // un tableau de bord en porte presque toujours un.
          FRONTEND_URL: 'https://app.comexa.tld/',
          SMTP_FROM: FROM,
        }),
      );

      await service.sendPasswordReset({
        to: 'client@exemple.tld',
        firstName: 'Samir',
        token: 'jeton-abc',
        expiresInLabel: '1 heure',
      });

      const html = partOf(stub.bodies, 'HTMLPart');
      const text = partOf(stub.bodies, 'TextPart');

      assert.match(html, /https:\/\/app\.comexa\.tld\/reset-password\?token=jeton-abc/);
      assert.match(text, /https:\/\/app\.comexa\.tld\/reset-password\?token=jeton-abc/);
      assert.equal(html.includes('comexa.tld//reset'), false, 'aucun double slash attendu');
      // Le destinataire est un TABLEAU d'objets `{ Email }` : c'est la forme que
      // Mailjet attend, et une chaine simple serait refusee sans autre forme de
      // proces au moment de l'envoi.
      assert.deepEqual(messageOf(stub.bodies)['To'], [{ Email: 'client@exemple.tld' }]);
    } finally {
      stub.restore();
    }
  });

  it('encode le jeton dans le lien', async () => {
    captureLogs();
    const stub = stubFetchCapture();

    try {
      const service = new MailService(
        configOf({
          ...API_CREDENTIALS,
          FRONTEND_URL: 'https://app.comexa.tld',
          SMTP_FROM: FROM,
        }),
      );

      // Un jeton opaque peut contenir des caracteres reserves ; non encode, le
      // lien serait tronque au premier d'entre eux et la reinitialisation
      // echouerait sans message.
      await service.sendPasswordReset({
        to: 'client@exemple.tld',
        firstName: 'Samir',
        token: 'a b/c+d',
        expiresInLabel: '1 heure',
      });

      assert.match(partOf(stub.bodies, 'HTMLPart'), /token=a%20b%2Fc%2Bd/);
    } finally {
      stub.restore();
    }
  });

  it('date la facture en UTC, sans decaler au jour precedent', async () => {
    captureLogs();
    const stub = stubFetchCapture();

    try {
      const service = new MailService(
        configOf({
          ...API_CREDENTIALS,
          FRONTEND_URL: 'https://app.comexa.tld',
          SMTP_FROM: FROM,
        }),
      );

      await service.sendInvoice({
        to: 'client@exemple.tld',
        firstName: 'Samir',
        reference: 'F-2026-001',
        total: '120 000,00',
        currency: 'DZD',
        // Ecrit a minuit UTC : lu dans le fuseau du serveur, il s'afficherait la
        // veille sur le document le plus contentieux qui soit.
        dueDate: new Date('2026-09-15T00:00:00.000Z'),
        path: '/espace-client/factures/abc',
      });

      const html = partOf(stub.bodies, 'HTMLPart');

      // L'objet est une propriete de premier niveau du MESSAGE, pas du corps
      // entier : il se lit sous `Messages[0]`, comme le reste.
      assert.equal(messageOf(stub.bodies)['Subject'], 'Comexa — facture F-2026-001');
      assert.match(html, /15\/09\/2026/);
      assert.match(html, /https:\/\/app\.comexa\.tld\/espace-client\/factures\/abc/);
      assert.match(html, /120 000,00/);
    } finally {
      stub.restore();
    }
  });

  it("n'ecrit aucune date de validite quand le devis n'en a pas", async () => {
    captureLogs();
    const stub = stubFetchCapture();

    try {
      const service = new MailService(
        configOf({
          ...API_CREDENTIALS,
          FRONTEND_URL: 'https://app.comexa.tld',
          SMTP_FROM: FROM,
        }),
      );

      await service.sendQuote({
        to: 'prospect@exemple.tld',
        firstName: 'Nadia',
        reference: 'D-2026-002',
        total: '80 000,00',
        currency: 'DZD',
        validUntil: null,
        path: '/devis/d-2026-002',
      });

      const html = partOf(stub.bodies, 'HTMLPart');

      // Un devis sans date de validite ne se perime pas : annoncer une date qui
      // n'existe pas serait pire que de n'en annoncer aucune.
      assert.doesNotMatch(html, /valable jusqu/);
      assert.match(html, /accepter en ligne/);
    } finally {
      stub.restore();
    }
  });

  it('ferme le transport sans erreur a la destruction du module', () => {
    captureLogs();

    // Quatre cas, y compris celui sans transport — ou `close` doit rester sans
    // effet plutot que de lever sur un `null` — et celui d'une cle seule, qui a
    // bien resolu un transport SMTP et doit donc le fermer aussi.
    const cases: Record<string, string>[] = [
      { ...API_CREDENTIALS, SMTP_FROM: FROM },
      { SMTP_HOST: 'smtp.exemple.tld', SMTP_FROM: FROM },
      { MAILJET_API_KEY: 'clef-seule', SMTP_HOST: 'smtp.exemple.tld', SMTP_FROM: FROM },
      { SMTP_FROM: FROM },
    ];

    for (const values of cases) {
      const service = new MailService(configOf(values));
      assert.doesNotThrow(() => service.onModuleDestroy());
    }
  });
});
