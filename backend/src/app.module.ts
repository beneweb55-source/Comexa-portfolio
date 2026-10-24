import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.validation.js';
import { AuditModule } from './common/audit/audit.module.js';
import { JwtAuthGuard, PermissionsGuard } from './common/guards/access.guards.js';
import { StorageModule } from './common/storage/storage.module.js';
import { HealthModule } from './health/health.module.js';
import { ActivityModule } from './modules/activity/activity.module.js';
import { AuditLogModule } from './modules/audit/audit-log.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BalanceModule } from './modules/balances/balance.module.js';
import { ClientsModule } from './modules/clients/clients.module.js';
import { ContentModule } from './modules/content/content.module.js';
import { CurrencyModule } from './modules/currencies/currency.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { DistributionModule } from './modules/distributions/distribution.module.js';
import { ExchangeRateModule } from './modules/exchange-rates/exchange-rate.module.js';
import { GoalsModule } from './modules/goals/goals.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { InvoicesModule } from './modules/invoices/invoices.module.js';
import { MessagingModule } from './modules/messaging/messaging.module.js';
import { MilestonesModule } from './modules/milestones/milestones.module.js';
import { NotificationModule } from './modules/notifications/notification.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { PdfModule } from './modules/pdf/pdf.module.js';
import { ProspectsModule } from './modules/prospects/prospects.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { QuotesModule } from './modules/quotes/quotes.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { RoleModule } from './modules/roles/role.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { TimeEntriesModule } from './modules/time-entries/time-entries.module.js';
import { TimerModule } from './modules/timer/timer.module.js';
import { CalendarModule } from './modules/calendar/calendar.module.js';
import { DailyReportsModule } from './modules/daily-reports/daily-reports.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { SpacesModule } from './modules/spaces/spaces.module.js';
import { UserModule } from './modules/users/user.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor.js';

const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
      // Refuse de demarrer si la configuration est incomplete. Voir
      // env.validation.ts pour le detail des controles.
      validate: validateEnv,
    }),

    /**
     * Journalisation structuree (JSON en production, lisible en developpement).
     *
     * `redact` retire les donnees sensibles AVANT qu'elles n'atteignent le
     * disque. Un journal qui contient un mot de passe en clair est une fuite,
     * meme si le mot de passe est correctement hache en base : c'est le mot de
     * passe en clair qui a transite, et c'est lui qui ouvre les autres comptes
     * ou l'utilisateur a reutilise le meme.
     */
    LoggerModule.forRoot({
      pinoHttp: {
        level: isProduction ? 'info' : 'debug',
        transport: isProduction
          ? undefined
          : {
              target: 'pino-pretty',
              options: { singleLine: true, translateTime: 'SYS:HH:MM:ss', colorize: true },
            },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            'req.body.password',
            'req.body.currentPassword',
            'req.body.newPassword',
            'req.body.confirmPassword',
            'req.body.token',
            'req.body.refreshToken',
          ],
          remove: true,
        },
        autoLogging: {
          // La sonde de sante est appelee en boucle par l'hebergeur : la
          // journaliser noierait le reste sans rien apprendre.
          ignore: (req) => req.url === '/api/health',
        },
      },
    }),

    /**
     * Garde-fou global contre l'abus. La limite est volontairement large : elle
     * arrete un balayage automatise, pas un utilisateur actif. Les routes
     * sensibles (connexion, mot de passe oublie) ont leur propre limite, plus
     * stricte, declaree sur leur controleur.
     *
     * Les limites declarees par `@Throttle` sur les controleurs ne prennent
     * effet QUE parce que `ThrottlerGuard` est enregistre ci-dessous. Le module
     * seul ne limite rien : il fournit le compteur, le garde le fait tourner.
     * Sans l'enregistrement, chaque `@Throttle` du projet serait decoratif — et
     * une limite de dix tentatives de connexion par minute qui n'existe pas est
     * pire qu'aucune limite, parce qu'elle rassure.
     */
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: Number(config.get<number>('RATE_LIMIT_TTL') ?? 60_000),
          limit: Number(config.get<number>('RATE_LIMIT_LIMIT') ?? 120),
        },
      ],
    }),

    /**
     * Bus d'evenements interne.
     *
     * Il sert a une seule chose aujourd'hui : detacher la diffusion temps reel
     * de l'ecriture metier. `NotificationService` emet `notification.created`,
     * la passerelle WebSocket ecoute. Sans ce module, `EventEmitter2` n'est pas
     * injectable et `NotificationService` ne peut pas etre construit — le
     * demarrage echoue, ce qui est preferable a une notification silencieusement
     * jamais diffusee.
     *
     * `maxListeners` est monte : chaque passerelle connectee ajoute un auditeur,
     * et la valeur par defaut de Node (10) ferait apparaitre un avertissement des
     * le onzieme utilisateur, alors que ce n'est pas une fuite.
     */
    EventEmitterModule.forRoot({ maxListeners: 50 }),

    /**
     * PLANIFICATEUR — le seul montage de taches planifiees du backend.
     *
     * Il n'y etait PAS JUSQU'ICI, et ce n'etait pas un choix : `@nestjs/schedule`
     * figurait dans les dependances depuis le debut, mais aucun
     * `ScheduleModule.forRoot()` n'etait monte a la racine. Un `@Cron` sans ce
     * module ne s'execute JAMAIS, et il ne le signale pas : le decorateur
     * s'enregistre, la compilation passe, la classe se construit normalement —
     * la tache ne tourne simplement jamais. C'est ce montage manquant qui a
     * laisse `InvoiceStatus.OVERDUE` sans aucun ecrivain : la regle existait, la
     * machine a etats la documentait, les rapports la comptaient, et rien ne
     * produisait la valeur.
     *
     * La premiere tache est le balayage des echeances
     * (`InvoiceOverdueService`), qui depasse les factures `SENT` dont l'echeance
     * est passee. Elle est declaree dans le module de facturation, comme le reste
     * de ses regles.
     *
     * SANS ARGUMENT : les expressions cron sont ecrites en clair sur chaque
     * tache. Un fuseau par defaut ici s'appliquerait a toutes les taches
     * presentes et futures, y compris a celles qu'un fuseau rendrait fausses —
     * `EVERY_HOUR` tombe au meme instant dans tous les fuseaux, et une tache
     * quotidienne devra dire explicitement de quel jour elle parle.
     */
    ScheduleModule.forRoot(),

    PrismaModule,
    HealthModule,
    AuthModule,

    /**
     * Journal d'audit — GLOBAL.
     *
     * Monte une seule fois ici, il rend `AuditService` injectable dans tous les
     * modules metier sans qu'aucun n'ait a importer l'authentification. Voir
     * `common/audit/audit.module.ts` pour la raison.
     */
    AuditModule,

    /**
     * Les deux services transverses, montes ici une fois pour toutes.
     *
     * Ils n'ont pas de controleur : ce sont des dependances d'autres modules,
     * qui les importent pour les injecter. Les enregistrer ici garantit une
     * instance UNIQUE — deux instances de `ActivityService` ne seraient pas un
     * bogue en soi (aucun etat n'y est conserve), mais deux instances de la
     * passerelle de notifications en seraient un.
     *
     * Les modules metier s'ajoutent a la suite de cette liste au fur et a mesure
     * de leur livraison.
     */
    ActivityModule,
    NotificationModule,

    /**
     * Stockage des fichiers — un seul choix de pilote pour tout le backend.
     *
     * Monte ici parce que plusieurs domaines y deposent des fichiers : le module
     * documents aujourd'hui, les rapports demain. `STORAGE_DRIVER=local` ecrit sur
     * le disque et est REFUSE AU DEMARRAGE en production ; la production passe par
     * un stockage S3-compatible, et PostgreSQL ne conserve que les metadonnees et
     * la reference de l'objet — jamais le binaire.
     */
    StorageModule,

    /**
     * IDENTITE — utilisateurs, roles, consultation du journal d'audit.
     *
     * Montage CENTRAL, et pas seulement par commodite : le coordinateur monte
     * tous les modules metier depuis ce fichier, un par un, pour qu'aucun agent
     * n'ecrive en concurrence dans la meme liste. Une liste ecrite par cinq
     * personnes est une liste ou la derniere ecriture gagne — et rien ne le
     * signale, puisque le fichier reste valide et la compilation reste verte.
     *
     * SANS CES TROIS LIGNES, L'API REPOND 404 PARTOUT :
     * les controleurs existent, la route n'est pas montee. C'est le mode de
     * defaillance le plus couteux a diagnostiquer, parce que le code des
     * controleurs est juste et que le symptome est un 404, pas une erreur.
     *
     * `AuditLogModule` (consultation, ici) et `AuditModule` (`common/audit/`,
     * monte en GLOBAL plus haut) sont deux modules distincts et volontairement
     * nommes differemment : le premier expose une route de lecture, le second
     * fournit l'ecriture injectable partout. Deux classes nommees `AuditModule`
     * se confondraient a l'import, et l'erreur n'apparaitrait qu'a l'execution,
     * sous la forme d'un service d'un autre module injecte au mauvais endroit.
     */
    UserModule,
    RoleModule,
    AuditLogModule,

    /**
     * INTEGRATIONS SERVEUR-A-SERVEUR (n8n, agents IA).
     *
     * Place ici, a cote de l'identite, parce que c'est de l'identite : le module
     * fournit le resolveur de jetons que le GARDE D'AUTHENTIFICATION appelle a
     * chaque requete (sous le jeton `INTEGRATION_PRINCIPAL_RESOLVER`). Le garde
     * declare une interface ; c'est ce module qui la realise — c'est ce qui
     * evite a `src/common/` de dependre d'un module metier.
     *
     * Son ordre dans cette liste n'a pas d'importance technique : le garde le
     * recoit par injection, pas par position.
     */
    IntegrationsModule,
    SpacesModule,

    /**
     * CRM — pipeline commercial et dossiers clients.
     *
     * `ClientsModule` AVANT `ProspectsModule`, dans cet ordre et pas l'inverse :
     * la conversion d'un prospect cree un client, donc `ProspectsModule` importe
     * `ClientsModule` et consomme son `ClientsService` — dans la MEME
     * transaction, ouverte par le prospect. Nest resout les dependances par
     * graphe et non par ordre de tableau, donc l'ordre n'est pas une contrainte
     * technique ; il est ecrit ainsi pour que la liste se lise comme le sens de
     * la dependance.
     *
     * Le perimetre des lignes de ces deux modules n'est PAS dans cette liste :
     * il est pose dans le `where` Prisma, par `prospect-scope.ts` et
     * `client-scope.ts`. C'est le point de securite de l'espace client — un
     * porteur qui remplace un identifiant dans l'URL obtient un 404, pas la
     * donnee d'un autre dossier.
     */
    ClientsModule,
    ProspectsModule,

    /**
     * PRODUCTION — projets, equipe, taches, jalons, saisie de temps.
     *
     * QUATRE modules, et pas moins : chacun porte son propre controleur, donc
     * ses propres routes. En oublier un ne casse pas le demarrage — il rend
     * seulement une famille de routes inexistante, et le symptome est un 404
     * sur un chemin qui existe pourtant dans le code.
     *
     * L'ORDRE, ICI, DECRIT LA DEPENDANCE : `TasksModule` importe
     * `ProjectsModule`, `TimeEntriesModule` importe `TasksModule`. Les aretes
     * descendent donc dans un seul sens et il n'y a aucun cycle — une propriete
     * que Nest resout de toute facon par graphe, mais qui rend cette liste
     * lisible comme une architecture plutot que comme un inventaire.
     *
     * `CountersModule` n'est pas listé : `ProjectsModule` l'importe pour la
     * numerotation `PRJ-`, et Nest le tire dans le graphe de lui-meme. Le
     * monter aussi a la racine ne casserait rien — Nest dedoublonne par
     * reference de classe — mais l'ajouter laisserait croire qu'une route en
     * depend, alors qu'il n'en expose aucune.
     */
    ProjectsModule,
    TasksModule,
    MilestonesModule,
    TimeEntriesModule,
    CalendarModule,
    TimerModule,
    GoalsModule,
    DailyReportsModule,

    /**
     * Messagerie — conversations, messages, temps reel.
     *
     * A ne pas confondre avec `NotificationModule` ci-dessus, qui fournit deja
     * `RealtimeGateway`. La passerelle n'est declaree QUE la : l'ajouter une
     * seconde fois ici monterait deux serveurs socket.io sur le meme namespace
     * `/rt`, et le bogue n'apparaitrait qu'au demarrage reel — pas a la
     * compilation. `MessagingModule` apporte les controleurs `/api/conversations`
     * et s'appuie sur la passerelle deja en place.
     */
    MessagingModule,

    /**
     * PILOTAGE — tableaux de bord, rapports, parametres.
     *
     * Trois modules, trois publics, et un point de securite commun : AUCUN de
     * leurs DTO ne declare d'identifiant de client. Le perimetre vient de
     * `policy.clientId`, donc du rattachement du COMPTE authentifie. Concretement
     * `?clientId=<un autre>` n'est pas ignore en silence : `forbidNonWhitelisted`
     * le refuse en 400 avant meme que le service ne le voie.
     *
     * `DashboardModule` n'importe PAS `ReportsModule`, et ce n'est pas un oubli.
     * Le tableau de bord reutilise les fonctions PURES de calcul
     * (`report-builders.ts`, `report-metrics.ts`) — elles recoivent `prisma` en
     * argument — plutot que le service. C'est ce qui garantit qu'un chiffre du
     * tableau de bord et le meme chiffre dans un rapport ne peuvent pas diverger :
     * deux implementations finiraient par ne plus s'accorder sur un cas limite, et
     * personne ne saurait laquelle croire.
     *
     * Aucun des trois ne declare d'`imports:` : `PrismaModule` et `AuditModule`
     * sont `@Global()`, et leurs services s'injectent sans import explicite.
     */
    ReportsModule,
    DashboardModule,
    SettingsModule,

    /**
     * CONTENU ET DOCUMENTS — le site public, et les fichiers.
     *
     * `DocumentsModule` exporte `DocumentsService` : d'autres domaines y deposent
     * des fichiers, donc son export sert. `ContentModule` n'exporte rien, et c'est
     * coherent — le contenu public se lit par HTTP, comme n'importe quel visiteur,
     * meme depuis l'interieur du backend.
     *
     * `CountersModule` n'est pas listé : `ContentModule` l'importe pour la
     * numerotation `CTR-`/`MOD-`, exactement comme `ProjectsModule` le fait pour
     * `PRJ-`. Le monter aussi a la racine ne casserait rien — Nest dedoublonne par
     * reference de classe — mais laisserait croire qu'une route en depend.
     *
     * `content-public.controller.ts` porte les seules ecritures NON authentifiees
     * du backend (le formulaire de contact), plafonnees a 5 requetes par minute.
     */
    ContentModule,
    DocumentsModule,

    /**
     * FACTURATION — devis, factures, paiements.
     *
     * L'ORDRE DECRIT LA DEPENDANCE, dans un seul sens et sans cycle :
     * `PaymentsModule` importe `InvoicesModule`, et les trois importent
     * `CountersModule` pour la numerotation `DEV-`/`FAC-`/`PAY-`. Nest resout de
     * toute facon par graphe ; l'ordre rend la liste lisible comme une
     * architecture plutot que comme un inventaire.
     *
     * DEUX CONTROLEURS PARTAGENT LE CHEMIN `quotes`, ET C'EST VOULU :
     * `POST /quotes/:id/invoice` vit dans `QuoteInvoiceController`, donc dans le
     * module FACTURES, parce qu'il CREE une facture — c'est le module factures qui
     * en porte la regle, le numero et l'audit. Le placer cote devis ferait
     * dependre les devis des factures dans le mauvais sens, et la regle « une
     * facture ne nait que d'un devis accepte » serait ecrite dans un module qui ne
     * connait pas les factures. Meme motif pour `POST|GET /invoices/:id/payments`,
     * porte par `InvoicePaymentsController` dans le module PAIEMENTS.
     *
     * Le corps de `POST /quotes/:id/invoice` n'accepte AUCUN montant : les lignes
     * sont copiees du devis et les totaux recalcules a partir d'elles. Un appelant
     * ne peut donc pas injecter un total.
     *
     * `PdfModule` EST MONTÉ ICI, ET CE N'ÉTAIT PAS LE CAS. Le module existait,
     * était testé, et n'était importé par AUCUN autre : `/api/pdf/invoices/:id`
     * répondait donc 404 « Route introuvable ». Le symptôme remontait loin de sa
     * cause — l'aperçu et le téléchargement d'un document passent par
     * `fetchProtectedBlob` (le jeton vit en mémoire, un `<iframe src>` ne peut
     * pas s'authentifier), qui transforme n'importe quel statut en un seul
     * message : « Le document n'a pas pu être téléchargé. » Rien, ni dans le
     * navigateur ni dans les journaux, ne distinguait une route absente d'un
     * serveur en panne. C'est le même piège que celui décrit plus haut pour les
     * devises : un module juste, testé, et pourtant invisible côté HTTP.
     *
     * Il est monté ici plutôt que dans `InvoicesModule`/`QuotesModule` parce
     * qu'il sert les DEUX : un PDF de facture et un PDF de devis sortent du même
     * service. Le placer dans l'un ferait dépendre l'autre d'un module qui n'est
     * pas le sien.
     */
    QuotesModule,
    OrdersModule,
    InvoicesModule,
    PaymentsModule,
    PdfModule,

    /**
     * FONDATION FINANCIÈRE — devises, taux de change, répartitions, soldes.
     *
     * Ces quatre modules étaient écrits, testés, et pourtant INEXISTANTS côté
     * HTTP : aucun n'était monté ici. Le symptôme n'est pas une erreur de
     * compilation mais un 404 sur `/api/currencies` — le mode de défaillance le
     * plus coûteux à diagnostiquer, parce que le code des contrôleurs est juste
     * et que rien ne signale l'absence de route. C'est exactement le piège
     * contre lequel met en garde le commentaire de `UserModule` plus haut.
     *
     * L'ORDRE DÉCRIT LA DÉPENDANCE, dans un seul sens et sans cycle :
     * `ExchangeRateModule` importe `CurrencyModule` (un taux cite deux devises
     * par leur code), `DistributionModule` importe `BalanceModule` (appliquer
     * une répartition crédite les soldes). Nest résout de toute façon par
     * graphe ; l'ordre rend la liste lisible comme une architecture.
     *
     * `BalanceModule` est exporté par `DistributionModule` : les paiements
     * pourront demain créditer un solde sans importer deux fois le même
     * service — Nest dédoublonne par référence de classe.
     *
     * Les permissions (`currency:read:any`, `balance:read:own`,
     * `distribution:manage:any`…) sont semées par la migration
     * `20261017120000_financial_permissions` et par le catalogue
     * `permissions.catalogue.ts`, que relit le seed. Un déploiement
     * « migrations seulement » sur une base déjà seedée les retrouve ; une
     * base neuve les reçoit du seed, qui remplace exactement l'ensemble des
     * droits de chaque rôle.
     */
    CurrencyModule,
    ExchangeRateModule,
    BalanceModule,
    DistributionModule,
  ],

  /**
   * GARDES GLOBAUX — L'ORDRE EST UNE PARTIE DE LA SECURITE.
   *
   * Nest les applique dans l'ordre de ce tableau. Chacun depend du precedent :
   *
   *  1. `ThrottlerGuard` — COMPTE D'ABORD. Placer la limitation apres
   *     l'authentification reviendrait a faire travailler argon2 et une requete
   *     PostgreSQL pour chaque tentative, y compris les millions d'une attaque
   *     par force brute. Le compteur est justement ce qui rend cette attaque
   *     assez couteuse pour qu'elle n'arrive pas jusqu'au hachage.
   *
   *  2. `JwtAuthGuard` — ETABLIT QUI PARLE, ou refuse. Il attache le porteur a la
   *     requete et fait respecter l'obligation de changer un mot de passe
   *     initial.
   *
   *  3. `PermissionsGuard` — VERIFIE CE QUE CE PORTEUR A LE DROIT DE FAIRE. Il
   *     lit ce que le precedent a attache : inverse, il ne trouverait rien et
   *     refuserait tout, ou pire, laisserait passer.
   *
   * Les deux derniers forment la porte unique de l'autorisation et sont
   * volontairement dans le meme fichier (`common/guards/access.guards.ts`) : les
   * separer avait deja produit un `forbidden` a deux arguments, corrige depuis.
   */
  providers: [
    // Idempotence serveur disponible sur toutes les routes métier : les
    // opérations desktop reprises après une réponse réseau perdue portent une
    // clé stable. Sans cet en-tête, l'intercepteur laisse le flux intact.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
