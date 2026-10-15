import { Type, plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';
import { parseDurationMs } from '../common/security/duration.js';
import { parsePaymentMethodList } from '../modules/orders/order-pricing.js';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Contrat des variables d'environnement.
 *
 * Ce n'est pas de la decoration : `ConfigModule.forRoot({ validate })` execute
 * `validateEnv` au demarrage. Une variable manquante, un port hors bornes ou un
 * secret trop court ARRETENT le processus avant qu'il n'accepte la moindre
 * requete. Un serveur qui demarre avec une configuration incomplete est un
 * serveur qui echouera plus tard, en production, sur un chemin qu'on n'aura pas
 * teste — mieux vaut un refus net au lancement.
 *
 * `MinLength(32)` sur les secrets n'est pas cosmetique : un JWT signe avec
 * « secret » se casse hors ligne en quelques minutes.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  // `@Type(() => Number)` est OBLIGATOIRE ici, et pas redondant avec
  // `enableImplicitConversion`.
  //
  // La conversion implicite de class-transformer s'appuie sur la metadonnee
  // `design:type` emise par TypeScript. Verifie sur le build reel : pour cette
  // classe, `design:type` vaut `Object` sur neuf proprietes et `String` sur
  // cinq — `Number` n'apparait JAMAIS, y compris pour `PORT`. Sans conversion,
  // `process.env.PORT` reste la chaine "3001" et les trois contraintes ci-dessous
  // echouent d'un coup, avec un message qui ne dit pas pourquoi.
  //
  // Lecon retenue : sur ce projet, la coercition des variables
  // d'environnement est EXPLICITE. On ne depend pas d'une metadonnee emise.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3001;

  @IsOptional()
  @IsString()
  API_PREFIX = 'api';

  @IsOptional()
  @IsString()
  CORS_ORIGIN = 'http://localhost:3000';

  /**
   * Limitation de debit : nombre de requetes acceptees par fenetre, et duree de
   * cette fenetre en millisecondes.
   *
   * Reglables plutot qu'ecrites en dur, parce que la bonne valeur depend de QUI
   * appelle : une agence qui pilote n8n avec des workflows bavards touche le
   * plafond bien avant un simple affichage. Et les valeurs par defaut restent
   * celles d'avant ce reglage — personne ne voit son API changer en mettant a
   * jour.
   *
   * CHAINES ET NOMBRES AVEC BORNES : une limite negative ou nulle viderait
   * l'API de ses reponses (tout le monde en 429), et une fenetre de 0 la
   * rendrait inutilisable. Les bornes transforment une faute de frappe en refus
   * au demarrage, visible tout de suite, plutot qu'en panne diffuse.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  RATE_LIMIT_LIMIT = 120;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  @Max(3_600_000)
  RATE_LIMIT_TTL = 60_000;

  @IsOptional()
  @IsString()
  FRONTEND_URL = 'http://localhost:3000';

  /**
   * Secret partage avec le frontend pour la purge du cache public
   * (`POST <FRONTEND_URL>/api/revalidate`). Optionnel : sans lui, le cache du
   * site public expire seul (1 h) et l'API le signale au demarrage.
   */
  @IsOptional()
  @IsString()
  @MinLength(32, { message: 'REVALIDATE_SECRET doit faire au moins 32 caracteres.' })
  REVALIDATE_SECRET?: string;

  /**
   * Politique SameSite du cookie de rafraichissement.
   *
   * `lax` convient quand le frontend et l'API partagent le meme domaine
   * enregistrable — c'est le cas en developpement (localhost:3000 et :3001 sont
   * same-site, seul le port differe, et les ports ne comptent pas pour SameSite).
   *
   * Si le frontend est servi depuis un AUTRE domaine que l'API, il faut `none`,
   * et `none` n'est accepte par les navigateurs qu'avec `Secure` — donc en
   * HTTPS. Le reglage est explicite plutot que devine, parce qu'un cookie
   * silencieusement non transmis produit un utilisateur deconnecte en boucle,
   * sans aucun message d'erreur nulle part.
   */
  @IsOptional()
  @IsIn(['lax', 'strict', 'none'])
  COOKIE_SAMESITE: 'lax' | 'strict' | 'none' = 'lax';

  // --- Reseau et reverse proxy -------------------------------------------------
  //
  // Confiance accordee aux en-tetes `X-Forwarded-*`, donc a `request.ip`. Le
  // raisonnement complet est dans `common/http/client-ip.ts` ; ce qu'il faut
  // retenir ici :
  //
  //   * vide (le defaut) : comportement historique du depot. L'adresse du client
  //     est lue dans `x-forwarded-for`, ce qui est juste derriere un proxy et
  //     falsifiable sans proxy.
  //   * `1` derriere UN reverse proxy : Express resout `request.ip` en traversant
  //     un saut de confiance. C'est le reglage recommande en production — sans
  //     lui, le limiteur de debit global voit une seule adresse pour tout le
  //     monde et finit par repondre 429 a tout le monde.
  //   * `true` : a n'utiliser que si l'application n'est JAMAIS joignable
  //     directement. Sinon un client forge une adresse par requete et echappe au
  //     limiteur.
  //
  // CHAINE, ET NON BOOLEEN, VOLONTAIREMENT : `validateEnv` s'execute avec
  // `enableImplicitConversion`, ou `'false'` devient `true`. Un champ booleen
  // inverserait le reglage le plus dangereux a inverser. La traduction est faite
  // par `parseTrustProxy`, qui refuse une valeur qui n'en est pas une.
  @IsOptional()
  @IsString()
  TRUST_PROXY = 'false';

  /** Connexion poolisee, utilisee par l'application. */
  @IsString()
  DATABASE_URL!: string;

  /** Connexion directe, utilisee par la CLI Prisma (voir prisma.config.ts). */
  @IsOptional()
  @IsString()
  DIRECT_URL?: string;

  @IsString()
  @MinLength(32, {
    message:
      "JWT_ACCESS_SECRET doit faire au moins 32 caracteres. Generer une valeur avec : node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
  })
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET doit faire au moins 32 caracteres.' })
  JWT_REFRESH_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_TTL = '15m';

  @IsOptional()
  @IsString()
  JWT_REFRESH_TTL = '30d';

  /** Duree de vie d'un lien de reinitialisation de mot de passe. */
  @IsOptional()
  @IsString()
  PASSWORD_RESET_TTL = '1h';

  /** Duree de vie d'un lien de verification d'adresse e-mail (inscription). */
  @IsOptional()
  @IsString()
  EMAIL_VERIFICATION_TTL = '24h';

  /**
   * Interrupteur de la verification d'adresse e-mail a l'inscription.
   * `true` (defaut) : le compte reste INVITED tant que le lien n'est pas suivi.
   * `false` : mise en veille. Le compte est cree ACTIF, aucun courriel n'est
   * envoye, et le code de verification reste en place pour une reactivation.
   * Chaine et non booleen : voir `ALLOW_BOOT_WITHOUT_MAIL`.
   */
  @IsOptional()
  @IsString()
  EMAIL_VERIFICATION_REQUIRED = 'true';

  /**
   * Moyens de paiement COMPATIBLES avec chaque devise, separes par des virgules
   * (valeurs de l'enum PaymentMethod : BANK_TRANSFER, CARD, CASH...). Vide ou
   * absent = aucun moyen de paiement configure : les commandes dans cette devise
   * ne sont pas proposees, et le visiteur est oriente vers une demande de projet.
   * Ne jamais y mettre un moyen qui n'est pas reellement disponible.
   */
  @IsOptional()
  @IsString()
  PAYMENT_METHODS_DZD?: string;

  @IsOptional()
  @IsString()
  PAYMENT_METHODS_EUR?: string;

  // --- Courriel transactionnel -------------------------------------------------
  //
  // DEUX CHEMINS D'ENVOI, UN SEUL EXIGE. Le couple `MAILJET_API_KEY` +
  // `MAILJET_SECRET_KEY` (API HTTP, port 443) et `SMTP_HOST` (relais SMTP) sont
  // tous facultatifs ici, mais l'un des deux est OBLIGATOIRE en production :
  // voir `assertMailConfigured`. La distinction est volontaire. Sans serveur
  // d'envoi, l'API continue de tourner — indispensable en developpement, ou
  // personne ne veut configurer un relais pour tester une connexion — mais en
  // production, un « mot de passe oublie » qui repond 200 sans rien envoyer est
  // un mensonge a l'utilisateur : il attend un courriel qui n'arrivera jamais,
  // et personne ne s'en apercoit avant qu'il n'appelle.
  //
  // L'API HTTP est preferee quand elle est configuree (voir
  // `MailService.resolveTransport`) : plusieurs hebergeurs gratuits bloquent en
  // sortie les ports SMTP 25, 465 et 587, et le port 443 ne l'est jamais.
  //
  // DEUX VARIABLES ET NON UNE. Mailjet authentifie en HTTP Basic, ou la cle
  // publique sert d'identifiant et la cle secrete de mot de passe. Il n'existe
  // pas de forme condensee : fournir une seule des deux donne un 401 a chaque
  // envoi, ce qui est la raison pour laquelle les deux sont exigees ensemble.
  @IsOptional()
  @IsString()
  MAILJET_API_KEY?: string;

  @IsOptional()
  @IsString()
  MAILJET_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT = 587;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SMTP_FROM = 'Comexa <no-reply@comexa.example>';

  /**
   * Derogation explicite au refus de demarrer sans moyen d'envoi.
   *
   * POURQUOI ELLE EXISTE. Le refus ci-dessous (`assertMailConfigured`) protege
   * une vraie panne : un « mot de passe oublie » qui repond 200 sans jamais rien
   * envoyer. Il a pourtant un cout qu'on ne mesurait pas : tant qu'aucun
   * transport n'est configure, RIEN ne se deploie — pas meme les parties du
   * backend qui n'ont aucun rapport avec le courriel. Cette variable rend ce
   * cout CHOISI plutot que subi.
   *
   * ELLE NE DESARME RIEN PAR DEFAUT. `false` est le defaut, et il faut
   * l'activer volontairement. Un deploiement qui l'active se signale tout seul :
   * `MailService` ecrit un avertissement au demarrage, et chaque envoi manque
   * recopie le courriel complet dans les journaux sous une banniere.
   *
   * A RETIRER des que le transport est configure : le refus redevient alors la
   * seule lecture possible.
   *
   * CHAINE, ET NON BOOLEEN, POUR LE MEME PIEGE QUE `TRUST_PROXY` :
   * `validateEnv` s'execute avec `enableImplicitConversion`, ou la chaine
   * `'false'` devient `true` — l'inverse exact de la demande. Un champ booleen
   * ici activerait donc la derogation sur un deploiement qui a pourtant ecrit
   * « false ». La traduction est faite par `allowsBootWithoutMail`, qui REFUSE
   * une valeur qui n'en est pas une : sans ce refus, une faute de frappe
   * eteindrait la derogation en silence, et le serveur refuserait de demarrer
   * sans qu'on voie pourquoi.
   */
  @IsOptional()
  @IsString()
  ALLOW_BOOT_WITHOUT_MAIL = 'false';

  // --- Stockage des fichiers ---------------------------------------------------
  //
  // Les binaires ne vont JAMAIS dans PostgreSQL : la base ne garde que les
  // metadonnees et la cle de stockage (voir modele Document). Le champ est donc
  // un choix entre deux backends, et `@IsIn` le dit — une faute de frappe
  // (`s3-compatible`) ferait autrement retomber silencieusement sur le disque
  // local, et les fichiers de production s'ecriraient dans le conteneur.
  @IsOptional()
  @IsIn(['local', 's3'])
  STORAGE_DRIVER: 'local' | 's3' = 'local';

  @IsOptional()
  @IsString()
  STORAGE_LOCAL_DIR = './storage';

  @IsOptional()
  @IsString()
  S3_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  S3_REGION?: string;

  @IsOptional()
  @IsString()
  S3_BUCKET?: string;

  @IsOptional()
  @IsString()
  S3_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  S3_SECRET_ACCESS_KEY?: string;

  /**
   * Adressage par CHEMIN plutot que par sous-domaine (`https://hote/bucket/cle`
   * au lieu de `https://bucket.hote/cle`).
   *
   * DECLAREE ICI, ET C'EST CE QUI LA REND VERIFIABLE : la variable etait
   * auparavant lue directement par `storage.module.ts`, hors de tout contrat — et
   * cette lecture retombait en silence sur son defaut. Or ce reglage decide de la
   * FORME des URL signees : un repli silencieux sur la mauvaise forme produit des
   * liens qui ne s'ouvrent pas, et l'exploitant cherche alors la panne du cote des
   * identifiants, qui sont, eux, corrects.
   *
   * Declaree comme CHAINE et non comme booleen, pour la meme raison que
   * `ALLOW_BOOT_WITHOUT_MAIL` : `enableImplicitConversion` lit `'false'` comme
   * vrai — l'inverse exact de la demande. La chaine est traduite par
   * `forcesPathStyle()` plus bas, qui LEVE sur une valeur inconnue.
   *
   * Le defaut est `true` : c'est le reglage qui fonctionne sur MinIO, Scaleway,
   * OVH, Backblaze B2 et Garage, et AWS l'accepte aussi. Un defaut a `false`
   * marcherait en apparence chez AWS et echouerait partout ailleurs, ce qui est le
   * pire des deux cas pour un projet qui vise un stockage compatible.
   */
  @IsOptional()
  @IsString()
  S3_FORCE_PATH_STYLE = 'true';

  /**
   * Nombre et non chaine : `MAX_UPLOAD_BYTES` est compare a une taille en
   * octets, et une comparaison entre une chaine et un nombre en JavaScript est
   * une source classique de bug silencieux (`'26214400' > 1000000` est vrai par
   * coercition, mais `'26214400' + 1` vaut `'262144001'`).
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1024)
  MAX_UPLOAD_BYTES = 26_214_400;

  // --- Documentation OpenAPI ---------------------------------------------------
  //
  // PAR DEFAUT, LA PRODUCTION NE SERT TOUJOURS AUCUNE DOCUMENTATION. C'est le
  // comportement historique du depot, et il ne change pas : `false` est le
  // defaut, et il faut l'activer volontairement.
  //
  // POURQUOI CETTE VARIABLE EXISTE. Le refus de servir le document en production
  // protege une vraie chose — un plan detaille de l'API aide surtout a la
  // cartographier — mais il avait un cout qu'on ne mesurait pas : l'associe qui
  // integre le frontend n'avait aucun moyen de lire le contrat en ligne, alors
  // que c'est exactement ce dont il a besoin. Cette variable rend ce choix
  // EXPLICITE plutot que subi.
  //
  // CHAINE, ET NON BOOLEEN, POUR LE MEME PIEGE QUE `TRUST_PROXY` :
  // `validateEnv` s'execute avec `enableImplicitConversion`, ou la chaine
  // `'false'` devient `true` — l'inverse exact de la demande. Un champ booleen
  // ici ouvrirait donc la documentation sur un deploiement qui a pourtant ecrit
  // « false ». La traduction est faite par `docsEnabled`, qui REFUSE une valeur
  // qui n'en est pas une.
  @IsOptional()
  @IsString()
  DOCS_ENABLED = 'false';

  /**
   * Identifiant et mot de passe de la protection de la documentation.
   *
   * EXIGES DES QUE `DOCS_ENABLED=true` EN PRODUCTION — voir `assertDocsConfigured`.
   * Sans ce refus, une faute de frappe sur `DOCS_ENABLED` publierait le plan
   * complet de l'API, sans protection ET sans un mot : c'est precisement le cas
   * que ce projet refuse ailleurs (voir `assertMailConfigured`).
   *
   * Ces valeurs sont lues par le serveur, jamais ecrites nulle part, et jamais
   * journalisees. Elles ne figurent pas dans le document OpenAPI.
   */
  @IsOptional()
  @IsString()
  DOCS_USER?: string;

  @IsOptional()
  @IsString()
  DOCS_PASSWORD?: string;

  // --- Bot Telegram ----------------------------------------------------------
  //
  // Nom du bot, SANS le `@`. Il est rendu dans les reponses d'appairage
  // (`POST /me/telegram-link/code` -> `botUsername`) et sert a construire le lien
  // profond `https://t.me/<nom>?start=...` remis a un tiers pour autoriser
  // l'usage de son compte WhatsApp.
  //
  // DECLARE ICI PLUTOT QUE HARDECODE : le nom etait ecrit en clair dans
  // `telegram-link.service.ts`. Un deuxieme endroit qui construit un lien vers le
  // bot (les invitations WhatsApp) aurait fait DEUX copies d'un meme nom — et un
  // changement de bot n'en aurait corrige qu'une, produisant des liens morts sans
  // aucune erreur nulle part.
  @IsOptional()
  @Matches(/^[A-Za-z0-9_]{3,32}$/, {
    message:
      'TELEGRAM_BOT_USERNAME : lettres, chiffres et tirets bas, 3 a 32 caracteres, sans le @.',
  })
  TELEGRAM_BOT_USERNAME = 'ComexaWork_bot';

  // --- Transcription des messages vocaux (bot Telegram) ----------------------
  //
  // Le bot @ComexaWork_bot recoit des vocaux ; n8n les transmet a
  // `POST /api/v1/integrations/telegram/transcribe`, qui rend du texte. Le
  // moteur est CONFIGURABLE et non impose : l'audio d'une personne est une
  // donnee personnelle sensible, et le choix de la confier a Groq, a OpenAI ou a
  // un serveur auto-heberge est une decision de l'exploitant, pas du code.
  //
  // `none` est le defaut, et ce n'est pas une valeur d'attente : sans moteur
  // configure, la route repond 503 `TRANSCRIPTION_NOT_CONFIGURED` — un refus net
  // et nomme, plutot qu'un texte vide que le workflow prendrait pour une
  // transcription reussie.
  @IsOptional()
  @IsIn(['none', 'openai-compatible'])
  TRANSCRIPTION_PROVIDER: 'none' | 'openai-compatible' = 'none';

  /**
   * Racine d'une API COMPATIBLE OpenAI (`POST {base}/audio/transcriptions`).
   *
   * Un seul pilote couvre donc Groq (`https://api.groq.com/openai/v1`), OpenAI
   * (`https://api.openai.com/v1`) et tout Whisper auto-heberge qui expose la
   * meme forme (faster-whisper-server, whisper.cpp `server`). Le choix du
   * fournisseur devient une URL, pas une dependance de plus.
   */
  @IsOptional()
  @IsString()
  TRANSCRIPTION_BASE_URL?: string;

  @IsOptional()
  @IsString()
  TRANSCRIPTION_API_KEY?: string;

  /**
   * Modele passe au moteur. Le defaut vise Groq, dont la couche gratuite est la
   * plus rapide pour un vocal de quelques minutes ; avec OpenAI, ecrire
   * `whisper-1` ou `gpt-4o-mini-transcribe`.
   */
  @IsOptional()
  @IsString()
  TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo';

  /**
   * Langue forcee (ex. `fr`), ou vide pour laisser le moteur la detecter.
   *
   * La forcer n'est pas un detail : sur un vocal court, la detection hesite, et
   * une transcription francaise rendue en anglais ne se remarque pas a la
   * lecture d'un journal. L'equipe travaille en francais ET en arabe : laisser
   * vide est donc le regle utile ici, et `language` reste acceptable par appel.
   */
  @IsOptional()
  @IsString()
  TRANSCRIPTION_LANGUAGE?: string;

  /**
   * Amorce passee au moteur (`prompt`) : vocabulaire metier, noms propres.
   * Whisper s'en sert comme contexte de decodage — « Comexa », « devis »,
   * « jalons » s'ecrivent alors correctement au lieu d'etre devines.
   */
  @IsOptional()
  @IsString()
  TRANSCRIPTION_PROMPT?: string;

  /**
   * Taille maximale d'un audio transmis, en octets (20 Mo par defaut).
   *
   * Plus basse que `MAX_UPLOAD_BYTES`, et volontairement : un vocal Telegram est
   * compresse en Opus et depasse rarement 1 Mo par minute. Une borne plus large
   * ne servirait qu'a laisser passer un fichier qui n'est pas un vocal — et le
   * moteur, lui, facture a la duree.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1024)
  @Max(52_428_800)
  TRANSCRIPTION_MAX_BYTES = 20_971_520;

  /**
   * Delai d'attente du moteur, en millisecondes.
   *
   * 60 s par defaut : un moteur distant met quelques secondes pour un vocal de
   * deux minutes, mais un modele `large` non turbo sur un petit serveur peut
   * prendre bien plus. Sans borne, une requete n8n expirerait cote client pendant
   * que le backend attendrait encore — et le rejeu transcrirait une deuxieme fois
   * le meme audio.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  @Max(600_000)
  TRANSCRIPTION_TIMEOUT_MS = 60_000;

  /**
   * Duree de conservation des transcriptions, en jours. `0` = conserver.
   *
   * Une transcription est le texte de la VOIX de quelqu'un : la garder sans fin
   * n'apporte rien au metier et alourdit ce qu'une fuite revelerait. Le balayage
   * est planifie (`TranscriptRetentionService`) et cette valeur le borne.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_650)
  TRANSCRIPT_RETENTION_DAYS = 30;

  // --- Passerelle WhatsApp ---------------------------------------------------
  //
  // IL N'EXISTE AUCUNE API OFFICIELLE DONNANT ACCES A UN COMPTE WHATSAPP
  // PERSONNEL ET A SON REPERTOIRE. L'API Business Cloud de Meta envoie depuis un
  // numero dedie, sans acces aux contacts personnels. Ce que le bot fait ici —
  // envoyer depuis LE COMPTE de la personne qui l'y a autorise — passe donc par
  // une passerelle qui tient une session WhatsApp Web : WAHA ou Evolution API.
  //
  // CETTE PASSERELLE VIT HORS DU BACKEND, ET C'EST LE POINT DE SECURITE.
  // Les identifiants de session (cookies, cles) restent dans son volume ; Comexa
  // ne conserve que le NOM de session, l'etat et les traces. Une fuite de la base
  // Comexa ne donne donc pas acces aux comptes WhatsApp. Le pilote est unique
  // (`WHATSAPP_GATEWAY_DRIVER`) pour qu'un seul endroit decide de l'adresse et de
  // l'en-tete d'authentification.
  //
  // `none` est le defaut : sans passerelle, les routes repondent 503
  // `WHATSAPP_GATEWAY_NOT_CONFIGURED`. Rien n'est envoye, et rien ne fait
  // semblant de l'etre.
  //
  // RAPPEL QUI DOIT RESTER VISIBLE : une session WhatsApp Web automatisee est
  // contraire aux conditions d'utilisation de WhatsApp et peut entrainer le
  // bannissement du numero. Le consentement explicite, les plafonds d'envoi et la
  // revocation immediate existent pour limiter ce risque, pas pour le supprimer.
  @IsOptional()
  @IsIn(['none', 'waha', 'evolution'])
  WHATSAPP_GATEWAY_DRIVER: 'none' | 'waha' | 'evolution' = 'none';

  /** Adresse de la passerelle, SANS barre oblique finale (ex. `http://waha:3000`). */
  @IsOptional()
  @IsString()
  WHATSAPP_GATEWAY_URL?: string;

  /**
   * Cle d'API de la passerelle (`X-Api-Key` pour WAHA, `apikey` pour Evolution).
   *
   * OBLIGATOIRE des que le pilote n'est pas `none`, y compris en developpement :
   * une passerelle sans cle est joignable par tout ce qui tourne sur le meme
   * reseau, et ce qu'elle detient est l'acces aux comptes WhatsApp de l'equipe.
   */
  @IsOptional()
  @IsString()
  WHATSAPP_GATEWAY_API_KEY?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  @Max(120_000)
  WHATSAPP_GATEWAY_TIMEOUT_MS = 20_000;

  /**
   * Prefixe des noms de session (ex. `comexa` donne `comexa-u_cmabc123`).
   *
   * Minuscules, chiffres et tirets : WAHA et Evolution refusent les espaces et
   * certains caracteres dans un nom d'instance. Un prefixe commun permet aussi de
   * reconnaitre nos sessions parmi d'autres sur une passerelle partagee.
   */
  @IsOptional()
  @Matches(/^[a-z0-9][a-z0-9-]{0,20}$/, {
    message: 'WHATSAPP_SESSION_PREFIX : minuscules, chiffres et tirets, 21 caracteres au plus.',
  })
  WHATSAPP_SESSION_PREFIX = 'comexa';

  /**
   * Plafond d'envois par compte et par heure glissante.
   *
   * CE N'EST PAS UNE REGLE DE CONFORT, C'EST LA PRINCIPALE PROTECTION CONTRE LE
   * BANNISSEMENT. Un volume soudain depuis un telephone est le signal que
   * WhatsApp surveille ; un bot qui envoie sans compter fait bannir le numero de
   * quelqu'un. 40 par heure couvre largement un usage de suivi (relances,
   * confirmations) et arrete une boucle de workflow avant le premier incident.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000)
  WHATSAPP_MAX_MESSAGES_PER_HOUR = 40;

  /** Longueur maximale du corps d'un message. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4_096)
  WHATSAPP_MAX_BODY_LENGTH = 1_024;

  /**
   * Duree de validite du CODE d'autorisation remis a un tiers (`72h`).
   *
   * Assez longue pour qu'une personne joigne par courriel ait le temps de
   * repondre, assez courte pour qu'un code oublie ne reste pas utilisable.
   */
  @IsOptional()
  @IsString()
  WHATSAPP_DELEGATION_CODE_TTL = '72h';

  /**
   * Duree de l'autorisation accordee une fois acceptee. VIDE = sans limite de
   * duree (mais toujours revocable).
   *
   * Une autorisation qui expire toute seule est preferable pour un tiers : elle
   * l'oblige a redire oui, et elle borne ce qu'un compte oublie permet encore.
   */
  @IsOptional()
  @IsString()
  WHATSAPP_CONSENT_TTL?: string;

  /**
   * Fraicheur acceptee de l'etat de session en base, en millisecondes.
   *
   * Interroger la passerelle a chaque envoi coute un aller-retour ; ne jamais
   * l'interroger fait envoyer sur une session morte. `0` = interroger a chaque
   * fois (le comportement le plus sur, et celui des tests).
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(600_000)
  WHATSAPP_SESSION_CACHE_MS = 5_000;

  /**
   * Fraicheur du cache des contacts, en minutes. `0` = resynchroniser a chaque
   * lecture.
   *
   * Un repertoire se relit du telephone : le faire a chaque demande use la
   * batterie du titulaire et sature la passerelle pour un resultat identique.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_080)
  WHATSAPP_CONTACT_CACHE_MINUTES = 30;

  /**
   * Indicatif pays par defaut (`DZ` donne `+213`) quand un destinataire est
   * saisi sans `+`.
   *
   * Deviner l'indicatif d'un numero local est la cause la plus frequente d'envoi
   * a un MAUVAIS DESTINATAIRE : `0555123456` sans indicatif n'est pas un numero,
   * et le composer tel quel aboutit ailleurs. Le defaut est donc explicite, et un
   * appel peut le remplacer (`countryCode` dans la requete).
   */
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, {
    message: 'WHATSAPP_DEFAULT_COUNTRY_CODE : deux lettres majuscules (ISO 3166-1).',
  })
  WHATSAPP_DEFAULT_COUNTRY_CODE = 'DZ';
}

/**
 * Refuse deux secrets identiques.
 *
 * Un access token et un refresh token signes avec la meme cle, c'est un refresh
 * token qui vaut un access token : la duree de vie courte du premier ne protege
 * plus rien. Le controle est fait ici parce que rien dans les types ne peut
 * l'exprimer.
 */
function assertSecretsDiffer(env: EnvironmentVariables): void {
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error(
      'JWT_ACCESS_SECRET et JWT_REFRESH_SECRET doivent etre DIFFERENTS : ' +
        "sinon un refresh token peut servir d'access token et la rotation ne protege plus rien.",
    );
  }
}

/**
 * En production, un moyen d'envoi doit etre configure.
 *
 * Le raisonnement : le parcours « mot de passe oublie » repond toujours 200, y
 * compris quand l'adresse est inconnue — c'est necessaire pour ne pas reveler
 * quels comptes existent. Cette reponse constante n'est honnete que si le
 * courriel part quand le compte existe. Sans transport, l'API repondrait
 * « consultez votre boite » a tout le monde, et personne ne recevrait rien.
 *
 * DEUX CHEMINS SATISFONT CETTE EXIGENCE, ET C'EST VOULU : `SMTP_HOST` (relais
 * SMTP) ou le couple `MAILJET_API_KEY` + `MAILJET_SECRET_KEY` (API HTTP). Exiger
 * le premier seul reviendrait a interdire de deployer sur un hebergeur qui filtre
 * les ports SMTP — ils sont plusieurs a le faire, dont l'offre gratuite de
 * Render, ou la connexion vers un relais SMTP sur le port 587 n'aboutit jamais au
 * lieu d'echouer franchement. Le message nomme donc les deux, et rappelle lequel
 * fonctionne partout.
 *
 * UNE DEROGATION EXPLICITE, ET VOLONTAIRE, LEVE CETTE EXIGENCE :
 * `ALLOW_BOOT_WITHOUT_MAIL`. Elle existe parce que le cout du refus n'etait pas
 * seulement l'absence de courriel — c'etait l'impossibilite de deployer quoi que
 * ce soit, y compris les parties du backend sans aucun rapport avec l'envoi, tant
 * qu'aucun fournisseur n'est configure. La derogation rend cet etat CHOISI. Elle
 * ne desarme pas le controle (le defaut reste `false`), et l'etat degrade
 * s'annonce ensuite tout seul dans les journaux de `MailService`.
 *
 * On refuse de demarrer plutot que de laisser cette panne silencieuse
 * s'installer. En developpement, l'absence de transport est normale : le lien
 * est ecrit dans les journaux (voir `MailService`).
 */

/**
 * Traduit `ALLOW_BOOT_WITHOUT_MAIL` en booleen.
 *
 * Meme contrat que `parseTrustProxy` — chaine en entree, memes orthographes
 * acceptees — et meme contrat que `forcesPathStyle` plus bas : une valeur NON
 * RECONNUE LEVE, au lieu de retomber sur un defaut silencieux. Un repli
 * silencieux serait ici trompeur : quelqu'un qui ecrit `oui` a bien
 * l'intention d'ouvrir la derogation, et s'il obtenait `false` sans un mot, il
 * verrait le serveur refuser de demarrer et chercherait la panne partout sauf
 * dans la variable qu'il vient de poser.
 */
export function allowsBootWithoutMail(raw: string | undefined): boolean {
  const value = (raw ?? '').trim();
  const lowered = value.toLowerCase();

  if (value.length === 0 || ['false', '0', 'no', 'off'].includes(lowered)) {
    return false;
  }

  if (['true', '1', 'yes', 'on'].includes(lowered)) {
    return true;
  }

  throw new Error(
    `ALLOW_BOOT_WITHOUT_MAIL : « ${value} » n'est pas une valeur booleenne reconnue. ` +
      'Attendu : false (le defaut), ou true. Sont aussi acceptes 1, 0, yes, no, on, off.',
  );
}

/**
 * Traduit `S3_FORCE_PATH_STYLE` en booleen.
 *
 * MEME CONTRAT QUE `allowsBootWithoutMail` CI-DESSUS, ET POUR LA MEME RAISON :
 * une valeur NON RECONNUE LEVE. Ce reglage decide de la forme des URL signees ;
 * un repli silencieux sur le defaut produirait des liens qui ne s'ouvrent pas, et
 * le diagnostic partirait du cote des identifiants — qui, eux, sont corrects.
 *
 * Une variable ABSENTE ou VIDE vaut `true`, le defaut de la declaration
 * ci-dessus : c'est la forme d'adressage qui fonctionne sur la quasi-totalite des
 * stockages compatibles, et l'ecrire explicitement dans un `.env` n'apporte donc
 * rien.
 *
 * ELLE N'EST PAS APPELEE PAR `validateEnv`, contrairement a
 * `allowsBootWithoutMail`, et c'est delibere : le seul consommateur de cette
 * valeur est `resolveStorageConfig()` dans `storage.module.ts`, qui s'execute
 * pendant la construction des providers — donc au demarrage, avant que le
 * serveur n'accepte la moindre requete. Y ajouter un appel ici pour jeter le
 * resultat ne ferait que dupliquer la meme regle a un second endroit.
 */
export function forcesPathStyle(raw: string | undefined): boolean {
  const value = (raw ?? '').trim();
  const lowered = value.toLowerCase();

  if (value.length === 0 || ['true', '1', 'yes', 'on'].includes(lowered)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(lowered)) {
    return false;
  }

  throw new Error(
    `S3_FORCE_PATH_STYLE : « ${value} » n'est pas une valeur booleenne reconnue. ` +
      'Attendu : true (le defaut, et le seul reglage qui fonctionne sur MinIO, Scaleway, ' +
      'OVH, Backblaze B2 et Garage), ou false (AWS par sous-domaine). Sont aussi acceptes ' +
      '1, 0, yes, no, on, off.',
  );
}

/**
 * Traduit `DOCS_ENABLED` en booleen.
 *
 * MEME CONTRAT QUE `allowsBootWithoutMail` ET `forcesPathStyle` CI-DESSUS, ET
 * POUR LA MEME RAISON : une valeur NON RECONNUE LEVE. Le repli silencieux serait
 * ici particulierement couteux — quelqu'un qui ecrit `oui` a l'intention
 * d'OUVRIR la documentation, et s'il obtenait `false` sans un mot, il chercherait
 * la panne du cote du reseau ou du cache, tres loin de la variable qu'il vient de
 * poser.
 *
 * Une variable ABSENTE ou VIDE vaut `false`, le defaut de la declaration
 * ci-dessus : la production reste donc fermee tant que personne ne l'ouvre
 * explicitement.
 */
export function docsEnabled(raw: string | undefined): boolean {
  const value = (raw ?? '').trim();
  const lowered = value.toLowerCase();

  if (value.length === 0 || ['false', '0', 'no', 'off'].includes(lowered)) {
    return false;
  }

  if (['true', '1', 'yes', 'on'].includes(lowered)) {
    return true;
  }

  throw new Error(
    `DOCS_ENABLED : « ${value} » n'est pas une valeur booleenne reconnue. Attendu : ` +
      'false (le defaut — la documentation reste fermee en production), ou true. Sont ' +
      'aussi acceptes 1, 0, yes, no, on, off.',
  );
}

/**
 * Longueur minimale du mot de passe protégeant la documentation.
 *
 * CE N'EST PAS UNE COQUETTERIE. La documentation est servie derriere une
 * authentification HTTP Basic, et les routes de Swagger ne passent PAS par le
 * limiteur de debit global : celui-ci est un garde de Nest, et Swagger monte ses
 * routes directement sur l'adaptateur HTTP, hors du routeur de Nest. Rien ne
 * borne donc le nombre d'essais. La seule defense qui reste est la longueur du
 * secret, et elle doit etre exigeE ici plutot qu'esperee.
 *
 * 16 caracteres n'est pas un objectif de robustesse absolu : c'est le seuil a
 * partir duquel un mot de passe engendre aleatoirement n'est plus devinable. Un
 * mot de passe choisi a la main y arrivera aussi, a condition de ne pas etre un
 * mot du dictionnaire.
 */
export const DOCS_PASSWORD_MIN_LENGTH = 16;

/**
 * En production, ouvrir la documentation exige de la proteger.
 *
 * LE CAS QUE CE CONTROLE EMPECHE, ET IL EST LE SEUL QUI COMPTE : un deploiement
 * qui ecrit `DOCS_ENABLED=true` en oubliant `DOCS_PASSWORD`. Sans ce refus, le
 * serveur demarre, sert le plan complet de l'API — les 165 operations, les
 * modeles, les codes de permission — a quiconque connait l'URL, et RIEN ne le
 * signale. C'est exactement le raisonnement de `assertMailConfigured` : une
 * configuration incomplete doit arreter le processus, pas se decouvrir plus tard.
 *
 * POURQUOI REFUSER PLUTOT QUE SERVIR SANS PROTECTION. Une documentation ouverte
 * n'est pas un etat degrade, c'est un etat DIFFERENT, que personne n'a demande.
 * Le repli silencieux serait ici l'inverse d'un repli prudent : il elargirait un
 * droit au lieu de le restreindre.
 *
 * HORS PRODUCTION, CE CONTROLE NE DIT RIEN : le developpement sert la
 * documentation sans authentification, c'est voulu et c'est le comportement
 * historique. La fonction sort donc immediatement — un `.env` de developpement
 * n'a aucune raison de porter un mot de passe.
 */
function assertDocsConfigured(env: EnvironmentVariables): void {
  if (env.NODE_ENV !== NodeEnv.Production) {
    return;
  }

  if (!docsEnabled(env.DOCS_ENABLED)) {
    return;
  }

  const user = (env.DOCS_USER ?? '').trim();
  const password = (env.DOCS_PASSWORD ?? '').trim();

  // LES DEUX SONT NOMMEES ENSEMBLE quand aucune ne l'est : l'exploitant qui vient
  // d'ouvrir la documentation doit pouvoir corriger les deux d'un coup, sans
  // relancer un demarrage pour decouvrir la seconde.
  if (user.length === 0 || password.length === 0) {
    const manquantes =
      user.length === 0 && password.length === 0
        ? 'DOCS_USER et DOCS_PASSWORD sont toutes les deux manquantes'
        : user.length === 0
          ? 'DOCS_USER est manquante'
          : 'DOCS_PASSWORD est manquante';

    throw new Error(
      `DOCS_ENABLED=true en production, mais ${manquantes} : la documentation ` +
        "serait alors servie SANS protection, et le plan complet de l'API serait " +
        "lisible par quiconque connait l'URL. Renseigner DOCS_USER et DOCS_PASSWORD, " +
        `ou retirer DOCS_ENABLED. Generer un mot de passe avec : ` +
        `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`,
    );
  }

  if (password.length < DOCS_PASSWORD_MIN_LENGTH) {
    throw new Error(
      `DOCS_PASSWORD fait ${password.length} caracteres, or ${DOCS_PASSWORD_MIN_LENGTH} ` +
        'est le minimum quand DOCS_ENABLED=true en production. Les routes de Swagger ' +
        "ne passent pas par le limiteur de debit : rien ne borne le nombre d'essais, " +
        'et seule la longueur du secret protege encore. Generer une valeur avec : ' +
        `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`,
    );
  }
}

function assertMailConfigured(env: EnvironmentVariables): void {
  if (env.NODE_ENV !== NodeEnv.Production) {
    return;
  }

  if (env.SMTP_HOST || (env.MAILJET_API_KEY && env.MAILJET_SECRET_KEY)) {
    return;
  }

  if (allowsBootWithoutMail(env.ALLOW_BOOT_WITHOUT_MAIL)) {
    // Le demarrage est autorise, mais l'etat reste anormal : `MailService` ecrit
    // l'avertissement correspondant des que le module est instancie, et chaque
    // envoi manque recopie le courriel dans les journaux sous une banniere.
    return;
  }

  // UNE SEULE DES DEUX CLES EST UN CAS A PART, ET IL MERITE SON PROPRE MESSAGE.
  // Sans cette distinction, l'exploitant lit « aucun moyen d'envoi » alors qu'il
  // vient d'en coller un, et cherche la panne partout sauf dans la variable qu'il
  // n'a pas remplie. Le refus reste le meme ; seule la raison change.
  const missing = env.MAILJET_API_KEY
    ? env.MAILJET_SECRET_KEY
      ? null
      : 'MAILJET_SECRET_KEY'
    : env.MAILJET_SECRET_KEY
      ? 'MAILJET_API_KEY'
      : null;

  throw new Error(
    (missing
      ? `${missing} est manquante : Mailjet authentifie en HTTP Basic, avec la cle ` +
        'publique ET la cle secrete, et une seule des deux donne un 401 a chaque envoi. '
      : "Aucun moyen d'envoi de courriel n'est configure : ") +
      'sans transport, le parcours "mot de passe oublie" repondrait 200 sans jamais ' +
      'envoyer de courriel. Renseigner MAILJET_API_KEY et MAILJET_SECRET_KEY (API HTTP, ' +
      'port 443 : fonctionne meme la ou le SMTP est bloque) ou, a defaut, SMTP_HOST, ' +
      'SMTP_PORT, SMTP_USER et SMTP_PASSWORD. Pour deployer malgre tout, en sachant que ' +
      'le courriel ne partira pas : ALLOW_BOOT_WITHOUT_MAIL=true.',
  );
}

/**
 * Hotes consideres comme INTERNES : le trafic ne sort pas de la machine ou du
 * reseau de conteneurs, donc `http://` n'y expose rien a un tiers.
 *
 * La regle est volontairement courte et lisible plutot que complete : elle ne
 * cherche pas a classifier tout Internet, seulement a reconnaitre les trois cas
 * reels d'un deploiement — boucle locale, nom de service Compose (`waha`,
 * `evolution` : un nom SANS POINT n'est pas resoluble publiquement), et adresse
 * privee. Tout le reste est traite comme public, ce qui est le sens sur : un
 * doute doit faire exiger TLS, pas l'inverse.
 */
function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }

  // Nom de service Docker Compose : pas de point, donc pas de DNS public.
  if (/^[a-z0-9-]+$/.test(host)) {
    return true;
  }

  const parts = host.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const [a, b] = parts.map(Number) as [number, number];
    // 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16.
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }

  return host === '::1';
}

/**
 * Verifie qu'une adresse de service externe est exploitable, et qu'elle ne fait
 * pas voyager un secret en clair hors d'un reseau interne.
 *
 * Exportee pour etre testee : c'est une REGLE (quelle adresse est acceptable en
 * production ?), et une regle posee seulement dans un `useFactory` ne se teste
 * qu'en montant tout le serveur.
 */
export function assertServiceUrl(raw: string | undefined, label: string, nodeEnv: NodeEnv): string {
  const value = (raw ?? '').trim();

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `${label} : « ${value} » n'est pas une URL lisible. Attendu : ` +
        'http://hote:port ou https://hote, sans chemin ni barre oblique finale.',
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} : protocole « ${parsed.protocol} » refuse. Attendu : http ou https.`);
  }

  const internal = isInternalHost(parsed.hostname);

  // EN PRODUCTION, UNE CLE D'API NE SORT PAS EN CLAIR. La transcription envoie
  // l'AUDIO d'une personne, la passerelle WhatsApp envoie l'ACCES a un compte :
  // dans les deux cas la cle ouvre plus qu'un service. Un hote interne est
  // exempté parce que le trafic reste sur la machine ou le reseau de conteneurs —
  // exiger TLS entre deux services d'un meme Compose produirait des certificats
  // auto-signes que personne ne verifie, c'est-a-dire une securite de facade.
  if (nodeEnv === NodeEnv.Production && parsed.protocol === 'http:' && !internal) {
    throw new Error(
      `${label} est en http:// vers un hote PUBLIC (${parsed.hostname}) en production : ` +
        "la cle d'API voyagerait en clair. Utiliser https://, ou heberger le service " +
        'sur le meme reseau interne (un nom de service, une adresse privee ou localhost).',
    );
  }

  return value.replace(/\/+$/, '');
}

/**
 * Cohérence des deux blocs de messagerie externe : transcription vocale et
 * passerelle WhatsApp.
 *
 * POURQUOI DES REFUS AU DEMARRAGE, ALORS QUE LES DEUX BLOCS SONT OPTIONNELS.
 * Rien n'oblige a les configurer : `TRANSCRIPTION_PROVIDER=none` et
 * `WHATSAPP_GATEWAY_DRIVER=none` sont des etats PREVUS, et les routes repondent
 * alors 503 avec un code nomme. Ce qui est refuse ici, c'est l'etat
 * INTERMEDIAIRE — « j'ai choisi un moteur mais oublie la cle » — parce qu'il ne
 * se voit qu'au premier vocal, sous la forme d'un 401 du fournisseur, tres loin
 * de la variable manquante.
 */
function assertExternalMessagingConfigured(env: EnvironmentVariables): void {
  if (env.TRANSCRIPTION_PROVIDER !== 'none') {
    const missing: string[] = [];
    if (!(env.TRANSCRIPTION_BASE_URL ?? '').trim()) missing.push('TRANSCRIPTION_BASE_URL');
    if (!(env.TRANSCRIPTION_API_KEY ?? '').trim()) missing.push('TRANSCRIPTION_API_KEY');

    if (missing.length > 0) {
      throw new Error(
        `TRANSCRIPTION_PROVIDER=${env.TRANSCRIPTION_PROVIDER}, mais ${missing.join(' et ')} ` +
          (missing.length > 1 ? 'sont manquantes' : 'est manquante') +
          ' : chaque vocal recu par le bot echouerait en 502. Renseigner les deux, ou ' +
          'revenir a TRANSCRIPTION_PROVIDER=none pour desactiver la transcription.',
      );
    }

    assertServiceUrl(env.TRANSCRIPTION_BASE_URL, 'TRANSCRIPTION_BASE_URL', env.NODE_ENV);
  }

  if (env.WHATSAPP_GATEWAY_DRIVER !== 'none') {
    const missing: string[] = [];
    if (!(env.WHATSAPP_GATEWAY_URL ?? '').trim()) missing.push('WHATSAPP_GATEWAY_URL');
    if (!(env.WHATSAPP_GATEWAY_API_KEY ?? '').trim()) missing.push('WHATSAPP_GATEWAY_API_KEY');

    if (missing.length > 0) {
      throw new Error(
        `WHATSAPP_GATEWAY_DRIVER=${env.WHATSAPP_GATEWAY_DRIVER}, mais ${missing.join(' et ')} ` +
          (missing.length > 1 ? 'sont manquantes' : 'est manquante') +
          ' : une passerelle sans cle est joignable par tout ce qui tourne sur le meme ' +
          "reseau, et elle detient l'acces aux comptes WhatsApp. Renseigner les deux, ou " +
          'revenir a WHATSAPP_GATEWAY_DRIVER=none.',
      );
    }

    assertServiceUrl(env.WHATSAPP_GATEWAY_URL, 'WHATSAPP_GATEWAY_URL', env.NODE_ENV);
  }

  // Durees : parsees ici pour qu'une faute de frappe arrete le demarrage au lieu
  // de produire `new Date(NaN)` au premier code d'autorisation emis.
  parseDurationMs(env.WHATSAPP_DELEGATION_CODE_TTL, 'WHATSAPP_DELEGATION_CODE_TTL');
  if ((env.WHATSAPP_CONSENT_TTL ?? '').trim().length > 0) {
    parseDurationMs(env.WHATSAPP_CONSENT_TTL as string, 'WHATSAPP_CONSENT_TTL');
  }
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((e) => `  - ${e.property} : ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Configuration invalide — le serveur refuse de demarrer :\n${details}`);
  }

  assertSecretsDiffer(validated);
  assertMailConfigured(validated);
  assertDocsConfigured(validated);
  assertOrderSettings(validated);
  assertExternalMessagingConfigured(validated);

  return validated;
}

/**
 * Moyens de paiement et duree de verification : une valeur inconnue fait
 * echouer le demarrage, en nommant la variable. Un moyen de paiement mal ecrit
 * ne doit pas devenir « aucun moyen » silencieusement.
 */
function assertOrderSettings(config: EnvironmentVariables): void {
  parsePaymentMethodList(config.PAYMENT_METHODS_DZD, 'PAYMENT_METHODS_DZD');
  parsePaymentMethodList(config.PAYMENT_METHODS_EUR, 'PAYMENT_METHODS_EUR');
  parseDurationMs(config.EMAIL_VERIFICATION_TTL ?? '24h', 'EMAIL_VERIFICATION_TTL');
}
