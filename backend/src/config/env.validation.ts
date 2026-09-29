import { Type, plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

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

  @IsOptional()
  @IsString()
  FRONTEND_URL = 'http://localhost:3000';

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

  return validated;
}
