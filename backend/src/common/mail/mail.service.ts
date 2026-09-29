import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * Envoi de courriels transactionnels.
 *
 * UN SEUL POINT DE VERITE SUR LE TRANSPORT. Sans `SMTP_HOST`, il n'y a pas de
 * transport — et surtout, l'absence est SIGNALEE, pas silencieuse. Le message
 * part dans les journaux avec une banniere explicite. C'est ce qui permet de
 * tester « mot de passe oublie » en developpement sans relais SMTP, tout en
 * gardant la certitude qu'en production (ou `env.validation` exige `SMTP_HOST`)
 * le courriel est reellement remis a un serveur.
 *
 * Ce service ne fabrique PAS de contenu anonyme : les gabarits sont dans des
 * methodes nommees (`sendPasswordReset`, `sendInvoice`, `sendQuote`), parce qu'un
 * courriel est un contrat avec l'utilisateur — l'objet, le lien et sa duree de
 * vie doivent etre verifiables a un seul endroit.
 *
 * Les erreurs d'envoi REMONTENT (`throw`). Un appelant qui declenche un envoi
 * doit decider quoi faire de l'echec ; les avaler ici transformerait une panne
 * d'envoi en succes apparent. C'est pourquoi les appelants qui declenchent un
 * envoi a la suite d'une action metier (facture, devis) entourent l'appel d'un
 * `try` : le statut du document est la verite, le courriel est un effet.
 */

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    this.from = this.config.get<string>('SMTP_FROM') ?? 'Comexa <no-reply@comexa.example>';

    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT') ?? 587;
    const user = this.config.get<string>('SMTP_USER');
    const password = this.config.get<string>('SMTP_PASSWORD');

    if (!host) {
      this.transport = null;
      return;
    }

    this.transport = createTransport({
      host,
      port,
      // Port 465 = TLS implicite des la connexion. Les autres ports demarrent
      // en clair et passent en STARTTLS. Deduire ce reglage du port evite une
      // variable de plus, qui serait un jour desaccordee du port.
      secure: port === 465,
      ...(user && password ? { auth: { user, pass: password } } : {}),
    });
  }

  /** Vrai si un serveur d'envoi est configure. */
  get isConfigured(): boolean {
    return this.transport !== null;
  }

  async send(mail: OutgoingMail): Promise<void> {
    if (!this.transport) {
      this.logger.warn(
        [
          '',
          '================ COURRIEL NON ENVOYE (SMTP non configure) ================',
          `  A       : ${mail.to}`,
          `  Objet   : ${mail.subject}`,
          '  --- Corps ---',
          mail.text,
          '========================================================================',
          'Configurez SMTP_HOST pour un envoi reel. En production, le serveur refuse',
          'de demarrer sans lui (voir src/config/env.validation.ts).',
        ].join('\n'),
      );
      return;
    }

    await this.transport.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  }

  /**
   * Lien de reinitialisation de mot de passe.
   *
   * Le message ne dit JAMAIS si l'adresse correspond a un compte : c'est
   * l'appelant qui garantit la reponse constante, et le texte est ecrit pour
   * rester vrai dans les deux cas. C'est aussi pourquoi ce gabarit ne contient
   * aucun prenom de compte, aucune date de creation, aucun element qui
   * varierait selon que le compte existe ou non.
   */
  async sendPasswordReset(params: {
    to: string;
    firstName: string;
    token: string;
    expiresInLabel: string;
  }): Promise<void> {
    const link = `${this.baseUrl()}/reset-password?token=${encodeURIComponent(params.token)}`;

    const text = [
      `Bonjour ${params.firstName},`,
      '',
      'Une reinitialisation de mot de passe a ete demandee pour votre compte Comexa.',
      `Le lien ci-dessous est valable ${params.expiresInLabel} et ne peut servir qu'une fois :`,
      '',
      link,
      '',
      "Si vous n'etes pas a l'origine de cette demande, ignorez ce message :",
      'votre mot de passe actuel reste valable.',
      '',
      "L'equipe Comexa",
    ].join('\n');

    await this.send({
      to: params.to,
      subject: 'Comexa — reinitialisation de votre mot de passe',
      text,
      html: [
        `<p>Bonjour ${escapeHtml(params.firstName)},</p>`,
        '<p>Une reinitialisation de mot de passe a ete demandee pour votre compte Comexa.',
        `Le lien ci-dessous est valable <strong>${escapeHtml(params.expiresInLabel)}</strong> et ne peut servir qu'une fois :</p>`,
        `<p><a href="${escapeHtml(link)}">Choisir un nouveau mot de passe</a></p>`,
        `<p>Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :<br>${escapeHtml(link)}</p>`,
        "<p>Si vous n'etes pas a l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.</p>",
        "<p>L'equipe Comexa</p>",
      ].join('\n'),
    });
  }

  /**
   * ENVOI D'UNE FACTURE AU CLIENT.
   *
   * Ce gabarit existe parce que la route s'appelle « envoyer » : jusqu'ici
   * l'envoi changeait un statut et deposait une notification DANS l'application,
   * si bien que le client ne recevait rien et que personne ne s'en apercevait
   * avant qu'il n'appelle. Le courriel est le seul effet qui sorte de l'agence.
   *
   * `path` est le chemin du document DANS l'espace client, pas une URL complete :
   * la base vient de la configuration (`FRONTEND_URL`, la meme que le lien de
   * reinitialisation) et le chemin est celui de la notification in-app, pour
   * qu'un changement de route ne se fasse pas a deux endroits. Aucune URL n'est
   * ecrite en dur ici.
   *
   * Les montants arrivent DEJA formates par l'appelant, qui les lit sur la
   * piece (`invoice.total`, derive des lignes) : ce service ne calcule rien et
   * n'invente aucun prix.
   */
  async sendInvoice(params: {
    to: string;
    firstName: string;
    reference: string;
    total: string;
    currency: string;
    dueDate: Date;
    path: string;
  }): Promise<void> {
    const link = `${this.baseUrl()}${params.path}`;
    const dueDate = formatDay(params.dueDate);

    const text = [
      `Bonjour ${params.firstName},`,
      '',
      `Votre facture ${params.reference} d'un montant de ${params.total} ${params.currency} est disponible dans votre espace client.`,
      `Son echeance de paiement est fixee au ${dueDate}.`,
      '',
      'Vous pouvez la consulter a tout moment :',
      '',
      link,
      '',
      "L'equipe Comexa",
    ].join('\n');

    await this.send({
      to: params.to,
      subject: `Comexa — facture ${params.reference}`,
      text,
      html: [
        `<p>Bonjour ${escapeHtml(params.firstName)},</p>`,
        `<p>Votre facture <strong>${escapeHtml(params.reference)}</strong> d'un montant de ${escapeHtml(params.total)} ${escapeHtml(params.currency)} est disponible dans votre espace client. Son echeance de paiement est fixee au <strong>${escapeHtml(dueDate)}</strong>.</p>`,
        `<p><a href="${escapeHtml(link)}">Consulter la facture</a></p>`,
        `<p>Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :<br>${escapeHtml(link)}</p>`,
        "<p>L'equipe Comexa</p>",
      ].join('\n'),
    });
  }

  /**
   * ENVOI D'UN DEVIS AU CLIENT OU AU PROSPECT.
   *
   * Meme contrat que la facture, et meme lien profond. `validUntil` peut etre
   * absent — un devis sans date de validite ne se perime pas — auquel cas la
   * phrase n'est pas ecrite du tout plutot que d'annoncer une date qui n'existe
   * pas.
   */
  async sendQuote(params: {
    to: string;
    firstName: string;
    reference: string;
    total: string;
    currency: string;
    validUntil: Date | null;
    path: string;
  }): Promise<void> {
    const link = `${this.baseUrl()}${params.path}`;
    const validity =
      params.validUntil === null
        ? ["Vous pouvez le consulter et l'accepter en ligne :"]
        : [
            `Il est valable jusqu'au ${formatDay(params.validUntil)}.`,
            "Vous pouvez le consulter et l'accepter en ligne :",
          ];

    const text = [
      `Bonjour ${params.firstName},`,
      '',
      `Votre devis ${params.reference} d'un montant de ${params.total} ${params.currency} est disponible dans votre espace client.`,
      ...validity,
      '',
      link,
      '',
      "L'equipe Comexa",
    ].join('\n');

    const htmlValidity =
      params.validUntil === null
        ? "<p>Vous pouvez le consulter et l'accepter en ligne :</p>"
        : `<p>Il est valable jusqu'au <strong>${escapeHtml(formatDay(params.validUntil))}</strong>. Vous pouvez le consulter et l'accepter en ligne :</p>`;

    await this.send({
      to: params.to,
      subject: `Comexa — devis ${params.reference}`,
      text,
      html: [
        `<p>Bonjour ${escapeHtml(params.firstName)},</p>`,
        `<p>Votre devis <strong>${escapeHtml(params.reference)}</strong> d'un montant de ${escapeHtml(params.total)} ${escapeHtml(params.currency)} est disponible dans votre espace client.</p>`,
        htmlValidity,
        `<p><a href="${escapeHtml(link)}">Consulter le devis</a></p>`,
        `<p>Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :<br>${escapeHtml(link)}</p>`,
        "<p>L'equipe Comexa</p>",
      ].join('\n'),
    });
  }

  /**
   * Base des liens profonds, lue dans la configuration et sans slash final.
   *
   * L'appelant fournit le CHEMIN, jamais l'URL : une URL complete ecrite dans un
   * service ne survit pas au premier changement de domaine, et une adresse de
   * production codee en dur dans le depot est un lien mort le jour de la mise en
   * ligne. Le repli sur `localhost` existe parce que `FRONTEND_URL` a la meme
   * valeur par defaut dans `env.validation.ts` ; en production, elle est
   * obligatoirement renseignee.
   */
  private baseUrl(): string {
    return (this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000').replace(
      /\/+$/,
      '',
    );
  }

  onModuleDestroy(): void {
    this.transport?.close();
  }
}

/**
 * Echappe le contenu insere dans le HTML.
 *
 * Le prenom vient de la base et le lien est construit ici, donc rien n'est
 * directement controlable par un tiers aujourd'hui. On echappe quand meme : un
 * prenom est modifiable par un administrateur, et un courriel est precisement
 * l'endroit ou une injection HTML se transforme en hameconnage credifiant
 * (en-tete falsifie, bouton « se connecter » pointant ailleurs). La protection
 * coute une ligne, son absence coute la confiance dans nos courriels.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Echeance ou date de validite, telle qu'elle est ecrite dans le courriel.
 *
 * La date est rendue EN UTC, et ce n'est pas un detail : `dueDate` et
 * `validUntil` viennent de la base et ont ete ecrits depuis une chaine ISO. Les
 * formater dans le fuseau du serveur ferait apparaitre la VEILLE pour une
 * echeance saisie a minuit UTC des que la machine tourne a l'ouest de Greenwich
 * — une facture « due le 14 » pour une echeance fixee au 15, sur le document le
 * plus contentieux qui soit. La forme numerique se lit sans ambiguite en
 * francais et ne depend d'aucun libelle traduit par l'environnement.
 */
const FRENCH_DAY = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatDay(date: Date): string {
  return FRENCH_DAY.format(date);
}
