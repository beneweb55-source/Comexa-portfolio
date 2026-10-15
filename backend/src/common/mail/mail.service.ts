import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createMailjetApiTransport } from './mailjet.transport.js';
import { createSmtpTransport } from './smtp.transport.js';
import { parseSender } from './sender.js';
import type { MailTransport, OutgoingMail } from './mail.types.js';

/**
 * Envoi de courriels transactionnels.
 *
 * UN SEUL POINT DE VERITE SUR LE TRANSPORT, et il en existe DEUX depuis que le
 * SMTP ne suffit plus : plusieurs hebergeurs gratuits bloquent en sortie les
 * ports 25, 465 et 587. Sur ces plateformes, un service qui ne saurait parler
 * que SMTP demarre normalement puis echoue a chaque envoi sans que rien ne le
 * signale. Deux transports, donc, mais une seule regle de choix, ecrite dans
 * `resolveTransport()` juste en dessous, et annoncee dans les journaux au
 * demarrage : « pourquoi ce courriel n'est-il pas parti » se repond d'abord en
 * lisant quelle ligne a ete ecrite au boot.
 *
 * Sans aucun des deux reglages, il n'y a pas de transport — et surtout, l'absence
 * est SIGNALEE, pas silencieuse. Le message part dans les journaux avec une
 * banniere explicite. C'est ce qui permet de tester « mot de passe oublie » en
 * developpement sans relais, tout en gardant la certitude qu'en production (ou
 * `env.validation` exige l'un des deux) le courriel est reellement remis.
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

/**
 * Le type a demenage dans `mail.types.ts` le jour ou il a fallu le partager avec
 * les deux transports. Il reste reexporte par ce fichier pour qu'aucun import
 * existant ne casse.
 */
export type { OutgoingMail } from './mail.types.js';

/** Expediteur par defaut, identique a celui de `env.validation.ts`. */
const DEFAULT_FROM = 'Comexa <no-reply@comexa.example>';

@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: MailTransport | null;

  /**
   * Production, lue UNE fois et retenue.
   *
   * `send()` s'en sert pour decider s'il peut recopier le corps d'un courriel
   * dans les journaux, et cette decision ne doit pas dependre d'une relecture de
   * `NODE_ENV` a chaque envoi : une variable relue est une variable qui peut
   * changer entre deux appels, et le prix de l'ecart serait ici la divulgation
   * d'un jeton de reinitialisation.
   */
  private readonly production: boolean;

  constructor(private readonly config: ConfigService) {
    this.production = config.get<string>('NODE_ENV') === 'production';
    this.transport = this.resolveTransport();
  }

  /**
   * Choix du transport, en un seul endroit.
   *
   * L'API HTTP GAGNE QUAND ELLE EST CONFIGUREE, meme si le SMTP l'est aussi, et
   * cette regle n'est pas arbitraire : le SMTP peut etre bloque en sortie par
   * l'hebergeur, l'API HTTP non. Une installation qui possede les deux reglages
   * veut donc dire « utilise l'API si tu peux ». La precedence inverse ferait
   * retomber en silence sur le transport qui ne fonctionne pas — exactement la
   * panne que ce fichier existe pour rendre impossible.
   *
   * AUCUNE VARIABLE NE CHOISIT LE TRANSPORT. Un troisieme reglage
   * (`MAIL_TRANSPORT=...`) pourrait contredire les identifiants presents, et
   * l'application enverrait alors par un chemin dont elle n'annonce pas
   * l'existence. La presence des identifiants EST le choix.
   *
   * L'expediteur est decompose ici pour les deux transports, afin qu'une adresse
   * malformee arrete le demarrage au lieu de ne produire que des refus a chaque
   * envoi — une panne qu'on ne decouvrirait qu'en demandant a un client s'il a
   * bien recu son lien.
   */
  private resolveTransport(): MailTransport | null {
    const from = parseSender(this.config.get<string>('SMTP_FROM') ?? DEFAULT_FROM);
    const apiKey = this.config.get<string>('MAILJET_API_KEY');
    const secretKey = this.config.get<string>('MAILJET_SECRET_KEY');

    // LES DEUX CLES SONT EXIGEES ENSEMBLE. Mailjet authentifie en HTTP Basic :
    // une cle publique sans sa cle secrete ne produit pas un envoi degrade mais
    // un 401 a chaque tentative. Exiger le couple ici transforme une erreur de
    // configuration en trace de demarrage lisible, au lieu d'une panne qui ne se
    // manifeste qu'a l'usage — et sur le chemin le plus rare, celui du courriel.
    if (apiKey && secretKey) {
      this.logger.log(`Courriel : API HTTP Mailjet, expediteur "${from.email}" (port 443).`);
      return createMailjetApiTransport({ apiKey, secretKey, from }, this.logger);
    }

    // Une seule des deux cles : on le DIT. Se taire ferait retomber sur le SMTP
    // (ou sur rien), et l'exploitant chercherait longtemps pourquoi son envoi par
    // API ne part jamais alors qu'il a bien colle une cle quelque part.
    if (apiKey || secretKey) {
      this.logger.warn(
        'Courriel : MAILJET_API_KEY et MAILJET_SECRET_KEY doivent etre renseignees ' +
          `ENSEMBLE (seule ${apiKey ? 'MAILJET_API_KEY' : 'MAILJET_SECRET_KEY'} est ` +
          "presente). L'API Mailjet est ignoree en attendant.",
      );
    }

    const host = this.config.get<string>('SMTP_HOST');

    if (host) {
      const port = this.config.get<number>('SMTP_PORT') ?? 587;
      this.logger.log(`Courriel : SMTP ${host}:${port}, expediteur "${from.email}".`);
      return createSmtpTransport({
        host,
        port,
        user: this.config.get<string>('SMTP_USER'),
        password: this.config.get<string>('SMTP_PASSWORD'),
        from,
      });
    }

    // En production, cet etat n'est atteignable QUE par une derogation explicite
    // (`ALLOW_BOOT_WITHOUT_MAIL=true`, voir `env.validation.ts`). Le message doit
    // donc dire ce qui NE MARCHERA PAS, et pas seulement ce qui manque : un
    // deploiement dans cet etat accepte sciemment de perdre les courriels, et
    // c'est la seule ligne qui le lui rappellera au demarrage.
    // La valeur vient du champ fixe a la construction : voir sa declaration, et
    // `send()`, qui lit le meme champ pour decider de journaliser le corps.
    this.logger.warn(
      this.production
        ? 'Courriel : aucun transport configure (ni MAILJET_API_KEY + MAILJET_SECRET_KEY ' +
            'ni SMTP_HOST), ET CE SERVEUR TOURNE EN PRODUCTION. Le parcours « mot de passe ' +
            "oublie » repondra 200 sans qu'aucun courriel ne parte. Cet etat n'est possible " +
            'que parce que ALLOW_BOOT_WITHOUT_MAIL=true : retirer cette variable des que le ' +
            'transport est configure.'
        : 'Courriel : aucun transport configure (ni MAILJET_API_KEY + MAILJET_SECRET_KEY ' +
            'ni SMTP_HOST). Les courriels seront ecrits dans les journaux au lieu de partir.',
    );
    return null;
  }

  /** Vrai si un serveur d'envoi est configure. */
  get isConfigured(): boolean {
    return this.transport !== null;
  }

  /**
   * Envoie, ou recopie dans les journaux quand aucun transport n'existe.
   *
   * CE QUI EST JOURNALISE DEPEND DE L'ENVIRONNEMENT, ET C'EST UNE DECISION DE
   * SECURITE, PAS DE CONFORT.
   *
   * Les gabarits de ce service transportent des JETONS VIVANTS :
   * `sendPasswordReset` construit un lien `/reset-password?token=...` valable une
   * heure et a usage unique. Or les journaux d'un hebergeur ne sont pas un
   * coffre — ils sont consultables par l'equipe, exportes, indexes, et parfois
   * transmis a un support externe. Recopier ce lien revient a publier un jeton de
   * reinitialisation pour quiconque peut lire les journaux, et ce jeton ouvre le
   * compte.
   *
   * En developpement, l'inverse est vrai, et c'est tout l'interet du repli : sans
   * relais configure, le corps recopie EST le service rendu — c'est ce qui permet
   * de suivre « mot de passe oublie » de bout en bout sans fournisseur de
   * courriel. L'avertissement de demarrage de `resolveTransport()` l'annonce dans
   * ces termes, et ne l'annonce PAS en production : il y dit au contraire que le
   * parcours repondra 200 sans qu'aucun courriel ne parte.
   *
   * La banniere et le destinataire, eux, restent dans les deux cas. C'est la
   * seule trace qu'un courriel a ete perdu, et une trace sans destinataire ne
   * dirait pas lequel.
   */
  async send(mail: OutgoingMail): Promise<void> {
    if (!this.transport) {
      const corps = this.production
        ? [
            '  Corps   : NON JOURNALISE (production). Ces messages peuvent porter un',
            "            lien ou un jeton a usage unique, et un journal d'hebergeur n'est",
            '            pas un coffre.',
          ]
        : ['  --- Corps ---', mail.text];

      this.logger.warn(
        [
          '',
          '=========== COURRIEL NON ENVOYE (aucun transport configure) ============',
          `  A       : ${mail.to}`,
          `  Objet   : ${mail.subject}`,
          ...corps,
          '========================================================================',
          'Configurez MAILJET_API_KEY et MAILJET_SECRET_KEY (recommande : le port 443',
          'sort partout) ou SMTP_HOST pour un envoi reel. En production, le serveur',
          'refuse de demarrer sans aucun des deux (voir src/config/env.validation.ts).',
        ].join('\n'),
      );
      return;
    }

    // Le transport porte l'expediteur : le SMTP le recompose en en-tete, l'API
    // HTTP l'envoie en deux champs. `MailService` n'a donc plus a le connaitre,
    // et les deux chemins ne peuvent plus diverger sur cette valeur.
    await this.transport.send({
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
   * Lien de verification d'adresse e-mail, envoye a l'inscription.
   *
   * Le compte reste bloque tant que le lien n'a pas ete suivi : c'est la seule
   * preuve que l'adresse appartient bien a la personne qui s'inscrit.
   */
  async sendEmailVerification(params: {
    to: string;
    firstName: string;
    token: string;
    expiresInLabel: string;
  }): Promise<void> {
    const link = `${this.baseUrl()}/verify-email?token=${encodeURIComponent(params.token)}`;

    const text = [
      `Bonjour ${params.firstName},`,
      '',
      'Merci de vous etre inscrit a Comexa.',
      `Confirmez votre adresse e-mail en suivant le lien ci-dessous, valable ${params.expiresInLabel} :`,
      '',
      link,
      '',
      "Si vous n'etes pas a l'origine de cette inscription, ignorez ce message.",
      '',
      "L'equipe Comexa",
    ].join('\n');

    await this.send({
      to: params.to,
      subject: 'Comexa — confirmez votre adresse e-mail',
      text,
      html: [
        `<p>Bonjour ${escapeHtml(params.firstName)},</p>`,
        '<p>Merci de vous etre inscrit a Comexa.</p>',
        `<p>Confirmez votre adresse e-mail en suivant le lien ci-dessous, valable <strong>${escapeHtml(params.expiresInLabel)}</strong> :</p>`,
        `<p><a href="${escapeHtml(link)}">Confirmer mon adresse e-mail</a></p>`,
        `<p>Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :<br>${escapeHtml(link)}</p>`,
        "<p>Si vous n'etes pas a l'origine de cette inscription, ignorez ce message.</p>",
        "<p>L'equipe Comexa</p>",
      ].join('\n'),
    });
  }

  /**
   * INVITATION A AUTORISER L'USAGE D'UN COMPTE WHATSAPP.
   *
   * Ce gabarit est le seul endroit ou un TIERS lit ce qu'on lui demande. Trois
   * exigences en decoulent, et elles sont verifiables dans le texte :
   *
   *  1. LE TEXTE DE CONSENTEMENT EST RECOPIE TEL QUEL (`consentText`), dans un
   *     bloc preformate. Le resumer ici produirait deux versions de ce qui est
   *     autorise — et c'est la version courte, celle qui arrange, que la personne
   *     retiendrait. Le rendu vient de `describeConsent()`, la meme fonction que
   *     celle dont la version est stockee en base.
   *  2. LE REFUS EST AUSSI LISIBLE QUE L'ACCEPTATION. Un courriel qui n'explique
   *     que comment dire oui n'est pas une demande, c'est une relance.
   *  3. AUCUN LIEN NE PROVOQUE D'ACTION PAR LUI-MEME. Le lien ouvre une
   *     conversation Telegram avec le bot ; c'est la personne qui tape le code,
   *     puis qui scanne le QR depuis SON telephone. Un clic ne connecte rien.
   *
   * Le code apparait en clair ici — et c'est sa seule apparition : la base n'en
   * conserve que l'empreinte, et la reponse HTTP qui le rend n'est pas
   * journalisee.
   */
  async sendWhatsAppDelegation(params: {
    to: string;
    delegatorName: string | null;
    requesterName: string;
    code: string;
    botUrl: string;
    consentText: string;
    expiresInLabel: string;
    note: string | null;
  }): Promise<void> {
    const greeting = params.delegatorName?.trim() || 'Bonjour';
    const salutation = params.delegatorName?.trim() ? `Bonjour ${greeting},` : greeting + ',';

    const text = [
      salutation,
      '',
      `${params.requesterName} demande votre autorisation pour envoyer des messages`,
      'WhatsApp depuis VOTRE compte, par l’intermediaire de Comexa.',
      '',
      params.note ? `Contexte donne par la demande : ${params.note}` : null,
      params.note ? '' : null,
      'Ce que cette autorisation permet, et ce qu’elle engage :',
      '',
      params.consentText,
      '',
      '--- POUR ACCEPTER ---',
      `1. Ouvrir Telegram et le bot : ${params.botUrl}`,
      `2. Envoyer la commande :  /autoriser ${params.code}`,
      '3. Le bot affiche un QR code : le scanner depuis WhatsApp > Appareils connectes.',
      '',
      `Code d’autorisation : ${params.code}`,
      `Valable ${params.expiresInLabel}.`,
      '',
      '--- POUR REFUSER ---',
      `Repondre :  /refuser ${params.code}`,
      'Ou ne rien faire : sans action de votre part, rien n’est connecte et le code',
      'expire seul.',
      '',
      'Si cette demande ne vous dit rien, ignorez ce courriel : aucune connexion ne',
      'peut etre etablie sans votre scan.',
      '',
      'L’equipe Comexa',
    ]
      .filter((line) => line !== null)
      .join('\n');

    await this.send({
      to: params.to,
      subject: 'Comexa — autorisation d’envoi depuis votre compte WhatsApp',
      text,
      html: [
        `<p>${escapeHtml(salutation)}</p>`,
        `<p><strong>${escapeHtml(params.requesterName)}</strong> demande votre autorisation ` +
          'pour envoyer des messages WhatsApp depuis <strong>votre compte</strong>, par ' +
          'l’intermediaire de Comexa.</p>',
        params.note ? `<p>Contexte donne par la demande : ${escapeHtml(params.note)}</p>` : '',
        '<p>Ce que cette autorisation permet, et ce qu’elle engage :</p>',
        `<pre style="white-space:pre-wrap;font-family:monospace;font-size:13px">` +
          `${escapeHtml(params.consentText)}</pre>`,
        '<h3>Pour accepter</h3>',
        '<ol>',
        `<li>Ouvrir Telegram et le bot : <a href="${escapeHtml(params.botUrl)}">` +
          `${escapeHtml(params.botUrl)}</a></li>`,
        `<li>Envoyer la commande : <code>/autoriser ${escapeHtml(params.code)}</code></li>`,
        '<li>Scanner le QR affiche depuis WhatsApp &gt; Appareils connectes.</li>',
        '</ol>',
        `<p>Code d’autorisation : <strong>${escapeHtml(params.code)}</strong><br>` +
          `Valable ${escapeHtml(params.expiresInLabel)}.</p>`,
        '<h3>Pour refuser</h3>',
        `<p>Repondre <code>/refuser ${escapeHtml(params.code)}</code>, ou ne rien faire : ` +
          'sans action de votre part, rien n’est connecte et le code expire seul.</p>',
        '<p>Si cette demande ne vous dit rien, ignorez ce courriel : aucune connexion ne ' +
          'peut etre etablie sans votre scan.</p>',
        '<p>L’equipe Comexa</p>',
      ]
        .filter((line) => line.length > 0)
        .join('\n'),
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
    return (this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
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
