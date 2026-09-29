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
  // DEUX CHEMINS D'ENVOI, UN SEUL EXIGE. `BREVO_API_KEY` (API HTTP, port 443)
  // et `SMTP_HOST` (relais SMTP) sont tous deux facultatifs ici, mais l'un des
  // deux est OBLIGATOIRE en production : voir `assertMailConfigured`. La
  // distinction est volontaire. Sans serveur d'envoi, l'API continue de tourner
  // — indispensable en developpement, ou personne ne veut configurer un relais
  // pour tester une connexion — mais en production, un « mot de passe oublie »
  // qui repond 200 sans rien envoyer est un mensonge a l'utilisateur : il attend
  // un courriel qui n'arrivera jamais, et personne ne s'en apercoit avant qu'il
  // n'appelle.
  //
  // `BREVO_API_KEY` est prefere quand il est present (voir
  // `MailService.resolveTransport`) : plusieurs hebergeurs gratuits bloquent en
  // sortie les ports SMTP 25, 465 et 587, et le port 443 ne l'est jamais.
  @IsOptional()
  @IsString()
  BREVO_API_KEY?: string;

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
 * SMTP) ou `BREVO_API_KEY` (API HTTP). Exiger le premier seul reviendrait a
 * interdire de deployer sur un hebergeur qui filtre les ports SMTP — ils sont
 * plusieurs a le faire, dont l'offre gratuite de Render, ou la connexion vers
 * `smtp-relay.brevo.com:587` n'aboutit jamais au lieu d'echouer franchement.
 * Le message nomme donc les deux, et rappelle lequel fonctionne partout.
 *
 * On refuse de demarrer plutot que de laisser cette panne silencieuse
 * s'installer. En developpement, l'absence de transport est normale : le lien
 * est ecrit dans les journaux (voir `MailService`).
 */
function assertMailConfigured(env: EnvironmentVariables): void {
  if (env.NODE_ENV !== NodeEnv.Production) {
    return;
  }

  if (!env.SMTP_HOST && !env.BREVO_API_KEY) {
    throw new Error(
      "Aucun moyen d'envoi de courriel n'est configure : sans transport, le parcours " +
        '"mot de passe oublie" repondrait 200 sans jamais envoyer de courriel. ' +
        'Renseigner BREVO_API_KEY (API HTTP, port 443 : fonctionne meme la ou le SMTP ' +
        'est bloque) ou, a defaut, SMTP_HOST, SMTP_PORT, SMTP_USER et SMTP_PASSWORD.',
    );
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

  return validated;
}
