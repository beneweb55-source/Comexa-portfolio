import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { describe, it } from 'node:test';
import type { MailAddress, OutgoingMail } from './mail.types.js';
import { createSmtpTransport, formatFromHeader } from './smtp.transport.js';

/**
 * CE QUE CES TESTS PROTEGENT.
 *
 * Le transport SMTP n'est plus le chemin d'envoi de la production (le palier
 * gratuit de Render filtre les ports 25, 465 et 587, et le courriel part par
 * l'API HTTP de Mailjet). Il reste le chemin des deploiements sur machine
 * classique, et il a ete EXTRAIT du constructeur de `MailService` : une
 * extraction qui change le comportement est une panne qui n'apparait qu'au
 * premier envoi reel, chez quelqu'un qui a un relais SMTP. Ces tests fixent dont
 * ce comportement, pour que le jour ou on repasse par ce chemin, il soit
 * identique a celui d'avant.
 *
 * POURQUOI UN VRAI SERVEUR PLUTOT QU'UN ESPION. `createSmtpTransport` confie le
 * message a nodemailer, qui le RELIT puis le REEcrit en en-tetes a partir de la
 * chaine fournie. Espionner notre propre appel ne verrait que ce que nous avons
 * ecrit, jamais ce qui part — or c'est exactement la reecriture qui casse un nom
 * d'affichage contenant une virgule. Seul un socket local voit les octets reels.
 *
 * Le serveur ci-dessous n'accepte aucune connexion exterieure : il ecoute sur
 * `127.0.0.1`, sur un port attribue par le systeme, et il est ferme a la fin de
 * chaque test.
 */

const MAIL: OutgoingMail = {
  to: 'client@exemple.tld',
  subject: 'Comexa — devis D-2026-002',
  text: 'Bonjour, votre devis est disponible.',
  html: '<p>Bonjour, votre devis est disponible.</p>',
};

interface SmtpCapture {
  from?: string;
  recipient?: string;
  data?: string;
}

interface SmtpHarness {
  port: number;
  capture: SmtpCapture;
  close: () => Promise<void>;
}

/**
 * Serveur SMTP minimal, sur la boucle locale.
 *
 * Il ne parle que ce qu'il faut pour qu'un envoi aboutisse : accueil, EHLO sans
 * STARTTLS ni AUTH (donc en clair, ce qui est le chemin a tester), MAIL, RCPT,
 * DATA, QUIT.
 */
async function startSmtpServer(): Promise<SmtpHarness> {
  const capture: SmtpCapture = {};
  const sockets = new Set<Socket>();

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));

    // `setEncoding` fait decoder les octets par Node, qui recolle un caractere
    // accentue coupe entre deux paquets. Le type annonce par `net` reste
    // `Buffer` malgre tout, d'ou le `String()` plus bas, qui accepte les deux.
    socket.setEncoding('utf8');
    socket.write('220 localhost ESMTP\r\n');

    let buffer = '';
    let inData = false;
    let data = '';

    socket.on('data', (chunk: Buffer) => {
      buffer += String(chunk);

      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) {
            return;
          }
          data += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          capture.data = data;
          socket.write('250 OK\r\n');
          continue;
        }

        const eol = buffer.indexOf('\r\n');
        if (eol === -1) {
          return;
        }
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);

        const command = line.toUpperCase();

        if (command.startsWith('EHLO') || command.startsWith('HELO')) {
          socket.write('250-localhost\r\n250 PIPELINING\r\n');
        } else if (command.startsWith('MAIL FROM')) {
          capture.from = line.slice(line.indexOf(':') + 1).trim();
          socket.write('250 OK\r\n');
        } else if (command.startsWith('RCPT TO')) {
          capture.recipient = line.slice(line.indexOf(':') + 1).trim();
          socket.write('250 OK\r\n');
        } else if (command === 'DATA') {
          inData = true;
          data = '';
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (command === 'QUIT') {
          socket.write('221 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });

    socket.on('error', () => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object', 'adresse de socket attendue');

  return {
    port: address.port,
    capture,
    close: async () => {
      // `net.Server` n'a PAS de `closeAllConnections` — c'est une methode de
      // `http.Server`, et la confondre coute cher : l'appel leve, donc le
      // `server.close()` place apres n'est jamais atteint, le port reste en
      // ecoute, et le processus de test ne se termine plus. Le symptome est un
      // BLOCAGE (aucune sortie, aucun echec), pas une erreur : on tient donc la
      // liste des sockets nous-memes, et on les detruit avant de fermer.
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();

      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** En-tete `From` tel qu'il est parti, deplie s'il a ete coupe sur plusieurs lignes. */
function fromHeaderOf(capture: SmtpCapture): string {
  const data = capture.data ?? '';
  const match = /^From:([\s\S]*?)(?:\r?\n(?![ \t])|$)/m.exec(data);
  assert.ok(match, `en-tete From introuvable dans :\n${data}`);
  return (match[1] ?? '').replace(/\r?\n[ \t]+/g, ' ').trim();
}

/** Envoie un courriel par le transport SMTP, contre le serveur local. */
async function sendThrough(
  server: SmtpHarness,
  from: MailAddress,
): Promise<{ from: string; recipient: string | undefined }> {
  const transport = createSmtpTransport({
    host: '127.0.0.1',
    port: server.port,
    from,
  });

  try {
    await transport.send(MAIL);
  } finally {
    transport.close();
  }

  return { from: fromHeaderOf(server.capture), recipient: server.capture.recipient };
}

describe("formatFromHeader — recomposition de l'expediteur", () => {
  it("rend l'adresse seule quand il n'y a pas de nom", () => {
    assert.equal(formatFromHeader({ email: 'no-reply@comexa.com' }), 'no-reply@comexa.com');
  });

  it('traite un nom vide comme une absence de nom', () => {
    assert.equal(
      formatFromHeader({ email: 'no-reply@comexa.com', name: '' }),
      'no-reply@comexa.com',
    );
  });

  it("n'entoure pas de guillemets un nom d'affichage ordinaire", () => {
    for (const name of ['Comexa', 'Comexa Algerie', 'Comexa SARL 2026', "Comexa d'Alger"]) {
      assert.equal(
        formatFromHeader({ email: 'no-reply@comexa.com', name }),
        `${name} <no-reply@comexa.com>`,
        `« ${name} » n'avait pas besoin d'etre guillemete`,
      );
    }
  });

  it('entoure de guillemets un nom qui contient une virgule', () => {
    // Sans les guillemets, l'en-tete se lit comme DEUX destinataires dont le
    // premier est invalide : le courriel part alors avec un expediteur casse.
    assert.equal(
      formatFromHeader({ email: 'no-reply@comexa.com', name: 'Comexa, Algerie' }),
      '"Comexa, Algerie" <no-reply@comexa.com>',
    );
  });

  it('entoure de guillemets un nom qui contient un deux-points', () => {
    // Un deux-points separe le nom du corps de l'en-tete.
    assert.equal(
      formatFromHeader({ email: 'no-reply@comexa.com', name: 'Comexa: Algerie' }),
      '"Comexa: Algerie" <no-reply@comexa.com>',
    );
  });

  it('entoure de guillemets un nom qui contient un accent ou un chevron', () => {
    for (const name of ['Comexa Algérie', 'Comexa <Algerie>', 'Comexa;Algerie']) {
      assert.equal(
        formatFromHeader({ email: 'no-reply@comexa.com', name }),
        `"${name}" <no-reply@comexa.com>`,
        `« ${name} » aurait du etre guillemete`,
      );
    }
  });

  it('entoure de guillemets un nom qui ne commence pas par une lettre ou un chiffre', () => {
    assert.equal(
      formatFromHeader({ email: 'no-reply@comexa.com', name: '-Comexa' }),
      '"-Comexa" <no-reply@comexa.com>',
    );
  });

  it('echappe les guillemets internes au nom', () => {
    assert.equal(
      formatFromHeader({ email: 'no-reply@comexa.com', name: 'Comexa "Algerie"' }),
      '"Comexa \\"Algerie\\"" <no-reply@comexa.com>',
    );
  });

  it('echappe les contre-obliques du nom', () => {
    // Un antislash non double devant le guillemet fermant le neutraliserait :
    // l'en-tete serait alors lu de travers jusqu'a la fin de la ligne.
    assert.equal(
      formatFromHeader({ email: 'no-reply@comexa.com', name: 'Comexa\\Algerie' }),
      '"Comexa\\\\Algerie" <no-reply@comexa.com>',
    );
  });
});

describe('createSmtpTransport — construction', () => {
  it('ne se connecte pas a la construction', () => {
    // Le port 1 n'a pas d'ecouteur : si la construction tentait une connexion,
    // ce test echouerait ou trainerait. Un relais momentanement injoignable ne
    // doit pas empecher l'API de demarrer.
    const transport = createSmtpTransport({
      host: '127.0.0.1',
      port: 1,
      from: { email: 'no-reply@comexa.com' },
    });

    assert.equal(transport.kind, 'smtp');
    transport.close();
  });
});

describe('createSmtpTransport — envoi reel sur un serveur local', () => {
  it("remet l'expediteur dans l'en-tete From, virgule guillemetee comprise", async () => {
    const server = await startSmtpServer();

    try {
      const sent = await sendThrough(server, {
        email: 'no-reply@comexa.com',
        name: 'Comexa, Algerie',
      });

      // L'enveloppe ne porte que l'adresse : un nom d'affichage glisse dans
      // `MAIL FROM` ferait refuser le message par le relais.
      assert.equal(server.capture.from, '<no-reply@comexa.com>');
      assert.equal(sent.recipient, '<client@exemple.tld>');
      // Motif et non egalite stricte : nodemailer relit et reecrit l'en-tete,
      // donc seule la FORME compte — nom guillemete, adresse intacte.
      assert.match(sent.from, /^"Comexa, Algerie"\s*<no-reply@comexa\.com>$/);
    } finally {
      await server.close();
    }
  });

  it("n'ajoute aucun guillemet superflu a un nom ordinaire", async () => {
    const server = await startSmtpServer();

    try {
      const sent = await sendThrough(server, {
        email: 'no-reply@comexa.com',
        name: 'Comexa Algerie',
      });

      assert.match(sent.from, /^Comexa Algerie\s*<no-reply@comexa\.com>$/);
      assert.equal(sent.from.includes('"'), false, 'aucun guillemet attendu');
    } finally {
      await server.close();
    }
  });

  it("part sans nom d'affichage quand il n'y en a pas", async () => {
    const server = await startSmtpServer();

    try {
      const sent = await sendThrough(server, { email: 'no-reply@comexa.com' });

      assert.match(sent.from, /^no-reply@comexa\.com$/);
      assert.equal(server.capture.from, '<no-reply@comexa.com>');
    } finally {
      await server.close();
    }
  });

  it("transmet le destinataire, l'objet et les deux corps", async () => {
    const server = await startSmtpServer();

    try {
      await sendThrough(server, { email: 'no-reply@comexa.com', name: 'Comexa' });

      const data = server.capture.data ?? '';
      assert.equal(server.capture.recipient, '<client@exemple.tld>');
      assert.match(data, /^Subject:/m);
      // Le sujet contient un tiret cadratin : il doit sortir encode ou litteral,
      // jamais en caractere de remplacement, qui signalerait un probleme
      // d'encodage sur le chemin.
      assert.equal(data.includes('�'), false, 'aucun caractere de remplacement attendu');
      assert.match(data, /text\/plain/);
      assert.match(data, /text\/html/);
      assert.match(data, /Bonjour, votre devis est disponible\./);
    } finally {
      await server.close();
    }
  });
});
