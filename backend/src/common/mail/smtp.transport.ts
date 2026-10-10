import { createTransport, type Transporter } from 'nodemailer';
import type { MailAddress, MailTransport, OutgoingMail, SmtpOptions } from './mail.types.js';

/**
 * Transport SMTP.
 *
 * C'est le transport historique, extrait du constructeur de `MailService` le
 * jour ou un second transport est apparu. Le comportement est inchange : c'est
 * ce qui permet d'affirmer qu'un deploiement sur une machine classique continue
 * de fonctionner exactement comme avant.
 *
 * IL NE VERIFIE PAS LA CONNEXION AU DEMARRAGE, et c'est volontaire : un relais
 * momentanement injoignable ne doit pas empecher l'API de demarrer. L'echec est
 * donc rapporte a l'envoi, la ou il a une consequence visible.
 */
export function createSmtpTransport(options: SmtpOptions): MailTransport {
  const transport: Transporter = createTransport({
    host: options.host,
    port: options.port,
    // Port 465 = TLS implicite des la connexion. Les autres ports demarrent
    // en clair et passent en STARTTLS. Deduire ce reglage du port evite une
    // variable de plus, qui serait un jour desaccordee du port.
    secure: options.port === 465,
    ...(options.user && options.password
      ? { auth: { user: options.user, pass: options.password } }
      : {}),
  });

  return {
    kind: 'smtp',

    async send(mail: OutgoingMail): Promise<void> {
      await transport.sendMail({
        from: formatFromHeader(options.from),
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    },

    close(): void {
      transport.close();
    },
  };
}

/**
 * Recompose l'en-tete `From` a partir de l'adresse decomposee.
 *
 * Le nom d'affichage est mis entre guillemets quand il contient autre chose que
 * des lettres, des chiffres, des espaces, des points, des apostrophes et des
 * tirets. Ce n'est pas du zele : dans un en-tete SMTP, une virgule ou un
 * deux-points non echappe separe des elements de la liste d'adresses, et
 * « Comexa, Algerie <no-reply@...> » serait alors lu comme DEUX destinataires
 * dont le premier est invalide. Le nom est une chaine saisie par un
 * administrateur, donc le cas se produira.
 */
export function formatFromHeader(address: MailAddress): string {
  if (!address.name) {
    return address.email;
  }

  const simple = /^[A-Za-z0-9][A-Za-z0-9 .'-]*$/.test(address.name);
  const name = simple
    ? address.name
    : `"${address.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

  return `${name} <${address.email}>`;
}
