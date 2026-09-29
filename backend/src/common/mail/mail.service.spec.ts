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
 * filtre les ports SMTP, donc `BREVO_API_KEY` (API HTTP, port 443) doit
 * l'emporter sur `SMTP_HOST` quand les deux sont presents. La regle inverse
 * ferait retomber en SILENCE sur le transport qui ne fonctionne pas : le serveur
 * demarrerait, chaque envoi echouerait, et personne ne le saurait avant qu'un
 * utilisateur ne signale qu'il n'a jamais recu son lien de reinitialisation.
 *
 * Quatre points sont donc fixes ici :
 *
 *   1. la precedence — l'API HTTP gagne, et c'est le transport qui ENVOIE
 *      vraiment qui le prouve, pas seulement le journal ;
 *   2. l'annonce du transport actif au demarrage, parce que « pourquoi ce
 *      courriel n'est-il pas parti » se repond d'abord en lisant cette ligne ;
 *   3. l'echec au DEMARRAGE sur un expediteur malforme, plutot qu'a l'envoi ;
 *   4. l'absence de transport, qui doit etre SIGNALEE et non silencieuse.
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

/**
 * Remplace `fetch` par une reponse de succes et retient les corps envoyes.
 *
 * Aucun appel reseau n'a lieu, et le corps reellement transmis est inspecte :
 * c'est ce qui permet de verifier le lien profond construit par les gabarits.
 */
function stubFetchCapture(): { bodies: string[]; restore: () => void } {
  const bodies: string[] = [];

  const stub = mock.method(
    globalThis,
    'fetch',
    async (_input: FetchInput, init?: FetchInit): Promise<Response> => {
      bodies.push(typeof init?.body === 'string' ? init.body : '');
      return new Response(JSON.stringify({ messageId: '<a@b>' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
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
  it("retient l'API HTTP quand BREVO_API_KEY est renseignee", () => {
    const logs = captureLogs();
    const service = new MailService(configOf({ BREVO_API_KEY: 'clef', SMTP_FROM: FROM }));

    assert.equal(kindOf(service), 'brevo-api');
    assert.equal(service.isConfigured, true);
    assert.match(logs.lines.join('\n'), /API HTTP Brevo/);
    assert.match(logs.lines.join('\n'), /port 443/);
  });

  it("DONNE LA PRECEDENCE a l'API quand les deux sont renseignes", () => {
    const logs = captureLogs();
    const service = new MailService(
      configOf({
        BREVO_API_KEY: 'clef',
        SMTP_HOST: 'smtp-relay.brevo.com',
        SMTP_PORT: 587,
        SMTP_FROM: FROM,
      }),
    );

    // C'est la decision qui rend le deploiement viable sur un hebergeur qui
    // filtre le SMTP : choisir l'autre transport ferait echouer chaque envoi
    // sans le dire.
    assert.equal(kindOf(service), 'brevo-api');
    assert.match(logs.lines.join('\n'), /API HTTP Brevo/);
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
    assert.match(logs.lines.join('\n'), /BREVO_API_KEY/);
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
      { BREVO_API_KEY: 'clef' },
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
    const service = new MailService(configOf({ BREVO_API_KEY: 'clef' }));

    assert.equal(kindOf(service), 'brevo-api');
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
          BREVO_API_KEY: 'clef',
          // Le SMTP est renseigne AUSSI : c'est la situation reelle d'une
          // installation qui possede les deux jeux d'identifiants.
          SMTP_HOST: 'smtp-relay.brevo.com',
          SMTP_FROM: FROM,
        }),
      );

      await service.send(MAIL);

      // Le transport qui ENVOIE est celui qu'on a annonce : c'est la seule
      // preuve qui compte, le journal ne suffirait pas.
      assert.equal(stub.bodies.length, 1);
      assert.deepEqual(payloadOf(stub.bodies)['to'], [{ email: 'client@exemple.tld' }]);
      assert.equal(payloadOf(stub.bodies)['subject'], MAIL.subject);
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
    const service = new MailService(configOf({}));

    // Ne doit PAS lever : en developpement, l'absence de transport est normale,
    // et un appelant qui declenche un envoi ne doit pas voir une panne.
    await service.send(MAIL);

    const output = logs.lines.join('\n');
    assert.match(output, /COURRIEL NON ENVOYE/);
    assert.match(output, /client@exemple\.tld/);
    assert.match(output, /Bonjour, votre facture est disponible\./);
  });
});

describe('MailService — gabarits et liens profonds', () => {
  it('construit le lien de reinitialisation depuis FRONTEND_URL, sans double slash', async () => {
    captureLogs();
    const stub = stubFetchCapture();

    try {
      const service = new MailService(
        configOf({
          BREVO_API_KEY: 'clef',
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

      const payload = payloadOf(stub.bodies);
      const html = String(payload['htmlContent'] ?? '');
      const text = String(payload['textContent'] ?? '');

      assert.match(html, /https:\/\/app\.comexa\.tld\/reset-password\?token=jeton-abc/);
      assert.match(text, /https:\/\/app\.comexa\.tld\/reset-password\?token=jeton-abc/);
      assert.equal(html.includes('comexa.tld//reset'), false, 'aucun double slash attendu');
      // Le destinataire est un TABLEAU chez Brevo, pas une chaine.
      assert.deepEqual(payload['to'], [{ email: 'client@exemple.tld' }]);
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
          BREVO_API_KEY: 'clef',
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

      const html = String(payloadOf(stub.bodies)['htmlContent'] ?? '');
      assert.match(html, /token=a%20b%2Fc%2Bd/);
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
          BREVO_API_KEY: 'clef',
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

      const payload = payloadOf(stub.bodies);
      const html = String(payload['htmlContent'] ?? '');

      assert.equal(payload['subject'], 'Comexa — facture F-2026-001');
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
          BREVO_API_KEY: 'clef',
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

      const html = String(payloadOf(stub.bodies)['htmlContent'] ?? '');

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

    // Trois cas, y compris celui sans transport — ou `close` doit rester sans
    // effet plutot que de lever sur un `null`.
    const cases: Record<string, string>[] = [
      { BREVO_API_KEY: 'clef', SMTP_FROM: FROM },
      { SMTP_HOST: 'smtp.exemple.tld', SMTP_FROM: FROM },
      { SMTP_FROM: FROM },
    ];

    for (const values of cases) {
      const service = new MailService(configOf(values));
      assert.doesNotThrow(() => service.onModuleDestroy());
    }
  });
});
