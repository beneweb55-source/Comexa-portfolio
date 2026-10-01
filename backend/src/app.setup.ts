import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { configureClientIp, parseTrustProxy } from './common/http/client-ip.js';
import { docsSessionSecret, protectDocs } from './common/http/docs-access.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';
import { docsEnabled } from './config/env.validation.js';

/**
 * CONFIGURATION DE L'APPLICATION, PARTAGEE ENTRE LE DEMARRAGE ET LES TESTS.
 *
 * Ce fichier existe pour une raison precise : `main.ts` configurait tout
 * (securite des en-tetes, CORS, validation, filtre d'exceptions, enveloppe de
 * reponse) a l'interieur de `bootstrap()`. Un test qui demarrait `AppModule`
 * obtenait donc une application SANS `ValidationPipe` ni `TransformInterceptor` —
 * et validait un objet qui n'est pas celui qui tourne en production.
 *
 * Concretement, un test ecrit dans ce montage voyait `req.body` brut, sans
 * `forbidNonWhitelisted`, et recevait des reponses non enveloppees : il aurait
 * pu passer au vert sur une API qui, en vrai, refuse la requete ou renvoie une
 * autre forme. Une suite de tests qui ne teste pas l'assemblage reel donne une
 * fausse assurance, ce qui est pire que pas de suite du tout.
 *
 * D'ou la regle : UNE seule fonction d'assemblage, appelee par `main.ts` et par
 * les tests e2e. Ce qui est teste est ce qui est deploye.
 */
export interface AppSetupResult {
  /** Prefixe global des routes, tel qu'applique (`api` par defaut). */
  readonly apiPrefix: string;
  readonly isProduction: boolean;
  /**
   * Le document OpenAPI genere, ou `undefined` quand il n'est pas construit du
   * tout — c'est-a-dire en production quand `DOCS_ENABLED` n'est pas ouvert.
   *
   * Expose ICI parce qu'un document OpenAPI est une affirmation sur l'API, et
   * qu'une affirmation se verifie. Sans ce retour, `public.decorator.spec.ts`
   * devrait reconstruire un document de son cote, avec son propre
   * `DocumentBuilder` : il testerait alors une copie de la configuration, et
   * pourrait passer au vert pendant que le document reellement servi est faux.
   * C'est precisement ce que ce depot refuse ailleurs (voir l'en-tete du
   * fichier : une seule fonction d'assemblage, appelee par `main.ts` et par les
   * tests).
   */
  readonly document?: OpenAPIObject;
}

/**
 * Applique a `app` toute la configuration transverse.
 *
 * Ne fait PAS `listen` ni `enableShutdownHooks` : ce sont des decisions de
 * processus, qui appartiennent a `main.ts`. Un test qui appellerait `listen`
 * ouvrirait un port, et qui appellerait `enableShutdownHooks` enregistrerait des
 * gestionnaires de signaux qu'il ne peut pas retirer.
 */
export function configureApp(app: INestApplication): AppSetupResult {
  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';
  const apiPrefix = config.get<string>('API_PREFIX') ?? 'api';

  app.use(helmet());
  app.use(cookieParser());

  // Le refresh token voyage dans un cookie ; sans `credentials: true` le
  // navigateur ne l'enverrait pas, et sans liste blanche d'origines n'importe
  // quel site pourrait poser la question a la place de l'utilisateur.
  const origins = (config.get<string>('CORS_ORIGIN') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
  });

  // Le limiteur de debit global compte par `request.ip` (son `getTracker` par
  // defaut est `normalizeIp(req.ip)`) : derriere un reverse proxy sans ce
  // reglage, tous les visiteurs partagent un seul compteur et le site finit par
  // repondre 429 a tout le monde. `configureClientIp` recoit la MEME valeur que
  // l'adaptateur, sinon `clientIp()` et le limiteur ne compteraient pas la meme
  // chose. Voir `common/http/client-ip.ts`.
  const trustProxy = parseTrustProxy(config.get<string>('TRUST_PROXY') ?? 'false');
  (app as NestExpressApplication).set('trust proxy', trustProxy);
  configureClientIp(trustProxy);

  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      // `whitelist` retire les champs non declares dans le DTO,
      // `forbidNonWhitelisted` refuse carrement la requete. C'est ce qui
      // empeche un client d'injecter `{ "roleId": "...", "clientId":
      // "autre-client" }` en esperant qu'un service distrait le recopie.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter(isProduction));
  app.useGlobalInterceptors(new TransformInterceptor());

  /**
   * Documentation OpenAPI.
   *
   * HORS PRODUCTION, ELLE EST SERVIE SANS PROTECTION, comme avant : elle sert au
   * frontend de developpement, et exiger un mot de passe pour lire une API qui
   * tourne sur `localhost` ne protegerait rien tout en genant tout le monde.
   *
   * EN PRODUCTION, ELLE RESTE FERMEE PAR DEFAUT. `DOCS_ENABLED=true` l'ouvre,
   * parce qu'un integrateur qui n'a pas le depot sous la main a besoin de lire le
   * contrat en ligne. Mais un document OpenAPI est le plan complet de l'API — ses
   * 165 operations, ses modeles, ses codes de permission — donc cette ouverture
   * est CONDITIONNELLE : `assertDocsConfigured` (voir `config/env.validation.ts`)
   * refuse le demarrage si `DOCS_ENABLED` est ouvert sans identifiants, ou avec
   * un mot de passe trop court. Autrement dit, on ne peut pas deployer une
   * documentation publique par accident.
   *
   * LA PROTECTION N'EST ENREGISTREE QUE DANS CE CAS, jamais en developpement :
   * la-bas les identifiants peuvent etre absents, et un middleware qui exigerait
   * un couple vide repondrait 401 a tout le monde.
   */
  let document: OpenAPIObject | undefined;

  const docsOpen = !isProduction || docsEnabled(config.get<string>('DOCS_ENABLED'));

  if (docsOpen) {
    /**
     * L'ORDRE COMPTE : ce middleware est enregistre AVANT `SwaggerModule.setup`,
     * et Express execute les intergiciels dans leur ordre d'inscription. Place
     * apres, il ne verrait jamais passer une seule requete de documentation.
     *
     * Il est monte GLOBALEMENT, sans chemin, parce qu'il porte lui-meme le
     * controle de chemin — voir l'en-tete de `common/http/docs-access.ts` pour
     * les deux pieges que cela evite (les routes `-json`/`-yaml` sont des freres
     * de `/api/docs`, et Express ignore la casse).
     *
     * IL SERT AUSSI LA PAGE DE CONNEXION. L'invite native du navigateur, celle
     * que declenche `WWW-Authenticate`, ne revient pas apres un refus memorise :
     * l'associe restait alors devant une page blanche. Une page rendue par le
     * serveur ne depend d'aucun comportement du navigateur, ni d'une fenetre
     * privee, ni d'un vidage de cache. L'authentification Basic continue d'etre
     * acceptee, pour les clients qui n'affichent pas de HTML.
     */
    if (isProduction) {
      // Le mot de passe est lu une seule fois : il sert d'identifiant attendu ET
      // de matiere pour le secret qui signe les sessions. Changer
      // `DOCS_PASSWORD` invalide donc toutes les sessions ouvertes. Lire les deux
      // fois separement suffirait a ce que la signature derive d'autre chose que
      // ce qui est reellement verifie — voir `docsSessionSecret`.
      const password = (config.get<string>('DOCS_PASSWORD') ?? '').trim();

      app.use(
        protectDocs({
          credentials: {
            user: (config.get<string>('DOCS_USER') ?? '').trim(),
            password,
          },
          apiPrefix,
          sessionSecret: docsSessionSecret(password),
        }),
      );
    }

    const swaggerConfig = new DocumentBuilder()
      .setTitle('API Comexa')
      .setDescription(
        "API de l'agence : espace public, espace client et administration.\n\n" +
          'Toutes les reponses suivent le meme contrat :\n' +
          '- succes : `{ "success": true, "data": ... }`\n' +
          '- echec : `{ "success": false, "error": { "code", "message", "details" } }`\n\n' +
          "Le champ `error.code` est stable : c'est lui que le frontend teste, jamais le message.",
      )
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addCookieAuth('refresh_token')
      // EXIGENCE DE SECURITE GLOBALE.
      //
      // `addBearerAuth` ne fait que DECLARER un schema : il ajoute l'entree
      // `components.securitySchemes` et fait apparaitre le bouton « Authorize »
      // dans Swagger UI. Il ne dit a aucune operation d'envoyer le jeton.
      //
      // Sans la ligne ci-dessous, le bouton fonctionne donc en apparence et
      // n'a aucun effet : Swagger UI n'ajoute l'en-tete `Authorization` que sur
      // les operations dont le `security` le reclame. Les 165 operations du
      // document n'en declaraient aucune, et chacune partait sans
      // authentification, en 401.
      //
      // La portee globale est ici la bonne, et pas un raccourci : `JwtAuthGuard`
      // est enregistre en `APP_GUARD` (voir app.module.ts), donc toute route
      // exige un jeton SAUF `@Public()`. Les 17 routes publiques annulent cette
      // exigence elles-memes — `security: []`, pose par le decorateur
      // `common/decorators/public.decorator.ts`. C'est ce qui garde les deux
      // sources d'accord : la route ne peut pas devenir publique sans que sa
      // documentation suive.
      //
      // Ce nombre a deja derive : il valait 19 dans une version anterieure de ce
      // commentaire. Il n'est pas verifie ici, et rien ne le verifierait.
      // `test/docs.e2e-spec.ts` compare, lui, le NOMBRE de routes publiques du
      // document au nombre de `@Public()` du code — c'est la-bas que la
      // coherence est tenue, pas dans cette ligne.
      .addSecurityRequirements('access-token')
      .build();

    document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
    });
  }

  return { apiPrefix, isProduction, document };
}
