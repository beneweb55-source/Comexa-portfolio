#!/usr/bin/env node
/**
 * AUDIT FINAL EN PRODUCTION — LA CHAINE METIER COMPLETE, PAR HTTP, SUR LE
 * SERVICE REELLEMENT DEPLOYE.
 *
 *   npm run smoke:prod
 *   npm run smoke:prod -- https://autre-service.onrender.com
 *   SMOKE_BASE_URL=https://... npm run smoke:prod
 *
 * POURQUOI CE SCRIPT EXISTE, ET CE QU'IL AJOUTE AUX TESTS E2E.
 *
 * `test/full-chain.e2e-spec.ts` parcourt deja la chaine complete, et il le fait
 * bien : il ecrit par une route, relit par une AUTRE, et confronte les
 * references au motif `PREFIX-ANNEE-NNNN`. Mais il monte l'application EN
 * MEMOIRE par `Test.createTestingModule`, sur `127.0.0.1`. Il ne prouve donc
 * rien de ce qui n'existe qu'une fois deploye :
 *
 *   - que le conteneur Render demarre avec les variables qu'il a vraiment ;
 *   - que Neon est joignable DEPUIS Render, et pas seulement depuis cette machine ;
 *   - que les migrations sont appliquees sur la base que le service interroge ;
 *   - que le stockage objet repond depuis le reseau de Render ;
 *   - que le compte admin du seed existe avec le mot de passe attendu ;
 *   - que TLS, le proxy, `TRUST_PROXY=1` et l'en-tete `Set-Cookie` se comportent
 *     comme prevu derriere le terminateur TLS de l'hebergeur.
 *
 * Ce sont exactement les six points sur lesquels un deploiement echoue alors que
 * la suite locale est verte. Ce script les exerce tous, dans l'ordre du cahier
 * des charges :
 *
 *     VISITEUR -> PROSPECT -> DEVIS -> ACCEPTATION -> CLIENT -> PROJET
 *              -> EQUIPE -> TACHES -> AVANCEMENT -> FACTURE -> PAIEMENT
 *              -> PROJET TERMINE
 *
 * LA MEME REGLE QUE LE FICHIER E2E : CREER, PUIS RELIRE, PUIS CONSTATER.
 *
 * Chaque etape ECRIT par une route, RELIT par une autre, et compare. Un 201 dit
 * « la requete a ete acceptee » ; il ne dit pas « l'etat a change ». Les
 * references sont confrontees a `PREFIX-ANNEE-NNNN`, ce qui prouve que la table
 * `Counter` est traversee et pas seulement qu'une colonne est remplie.
 *
 * LES SEPT DIFFERENCES AVEC LE FICHIER E2E, ET POURQUOI ELLES SONT OBLIGATOIRES.
 *
 * 1. AUCUN ACCES PRISMA POUR CREER QUOI QUE CE SOIT. Le fichier e2e ecrit
 *    directement en base l'administrateur, le developpeur et les deux porteurs
 *    clients. A distance, ce chemin n'existe pas : tout compte passe par
 *    `POST /api/users`. C'est une contrainte, et elle rend ce script PLUS
 *    probant que l'e2e sur un point precis — l'API d'administration des comptes
 *    est reellement exercee, elle qui n'etait jamais testee ici.
 *
 * 2. LE DEVELOPPEUR N'OUVRE AUCUNE SESSION. `POST /projects/:id/members` prend un
 *    identifiant d'utilisateur, pas un jeton : son compte est donc cree puis
 *    jamais connecte. Cela evite une connexion, sur un quota qui n'en autorise
 *    que dix par minute.
 *
 * 3. TROIS CONNEXIONS, PAS QUATRE. Administrateur, porteur A, porteur B. Le
 *    parcours « compte neuf au mot de passe impose » du fichier e2e est FONDU
 *    dans la creation du porteur A : ce compte-la nait de toute facon avec un
 *    mot de passe temporaire, il est donc bloque sur une route metier, puis
 *    change son mot de passe, puis le MEME jeton rouvre la route. C'etait
 *    l'etape 13, c'est maintenant l'etape 14 — et elle ne coute aucune
 *    connexion supplementaire.
 *
 * 4. UN RYTHME IMPOSE ENTRE LES REQUETES. Deux plafonds sont reels et mesures :
 *    120 requetes par minute et par IP en global, et 10 connexions par minute
 *    sur `POST /auth/login`. Un script qui tire en rafale se ferait repondre 429
 *    au milieu du parcours, et l'echec accuserait le service au lieu du script.
 *
 * 5. LE STOCKAGE OBJET EST EXERCE DE BOUT EN BOUT. Le fichier e2e depose quatre
 *    documents et les supprime, mais ne suit jamais le lien signe. Ici, un
 *    document est relu par `/content`, puis par le lien signe de `/download` qui
 *    est REELLEMENT OUVERT et compare OCTET PAR OCTET au contenu envoye. C'est
 *    le seul controle qui prouve que Backblaze est joignable et le bucket correct.
 *
 * 6. LE NETTOYAGE PASSE PAR L'API D'ABORD. L'objet de stockage part par
 *    `DELETE /api/documents/:id` — le seul chemin qui n'oublie pas de fichier
 *    dans le bucket. La base se nettoie ensuite par identifiants collectes, dans
 *    l'ordre impose par les cles etrangeres.
 *
 * 7. L'AGE DE GARDE SUR LE BALAYAGE EST CONSERVE. Une execution interrompue
 *    laisse des comptes. Les balayer sans seuil d'age supprimerait les comptes
 *    d'une execution VOISINE en cours — le fichier e2e documente ce bug, et il a
 *    coute une soiree. Le seuil est repris tel quel.
 *
 * CE QU'IL NETTOIE, ET CE QU'IL FAUT SAVOIR AVANT DE LE LANCER.
 *
 * Ce script ECRIT DANS LA BASE DE PRODUCTION : un dossier client, un projet, des
 * taches, un devis, une facture, un paiement. Tout est supprime a la fin, y
 * compris quand une etape echoue, et le nettoyage se verifie lui-meme. Mais un
 * arret force (Ctrl-C, coupure reseau) entre la creation et la suppression
 * laisserait des lignes derriere lui. Deux mesures : le balayage des restes au
 * demarrage les reprend, et le nettoyage est idempotent.
 *
 * Les documents sont supprimes par l'API, qui les marque supprimes et efface
 * l'objet du bucket. La ligne reste en base par conception — un paiement peut la
 * referencer comme justificatif, et c'est le commentaire de la route elle-meme.
 *
 * RIEN N'EST ENVOYE A UNE VRAIE ADRESSE. Toutes les adresses creees sont en
 * `@comexa.example`, domaine reserve par la RFC 2606 et donc jamais delivrable.
 * Les routes `send` declenchent bien un appel a Mailjet en production, mais
 * l'appelant entoure l'envoi d'un `try` (voir `quotes.service.ts` et
 * `invoices.service.ts`) : le statut du document est la verite, le courriel est
 * un effet. Un refus de Mailjet ne peut donc pas faire echouer ce parcours.
 */

import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

// ---------------------------------------------------------------------------
// Parametres
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, '..');

const BASE = (
  process.env.SMOKE_BASE_URL ??
  process.argv[2] ??
  'https://comexa-portfolio.onrender.com'
).replace(/\/+$/, '');
const API = `${BASE}/api`;

/**
 * Marqueur de namespace. Tout ce que ce script cree en base porte ce prefixe —
 * dans les adresses pour les comptes, dans les raisons sociales pour les dossiers
 * clients. C'est ce qui rend le nettoyage des restes possible sans toucher aux
 * donnees de qui que ce soit d'autre.
 */
const MARKER = 'smoke-prod';

/** Horodatage de l'execution : deux executions ne peuvent pas se heurter. */
const RUN = Date.now();

/**
 * Age minimal d'un reste abandonne, repris du fichier e2e et pour la meme raison.
 *
 * Cette execution dure moins de deux minutes. Un objet de plus de trente minutes
 * ne peut donc pas appartenir a une execution vivante ; ce qui est plus vieux est
 * un debris, et peut partir. Balayer sans ce seuil supprimerait les comptes d'une
 * execution voisine, en plein parcours.
 */
const STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * Rythme impose entre deux requetes.
 *
 * 500 ms ramene le parcours entier sous les 120 requetes par minute avec une
 * marge confortable, et laisse passer les trois connexions d'affilee sans
 * approcher les dix par minute. Le surcout total est d'une quarantaine de
 * secondes : c'est le prix d'un parcours qui va au bout.
 */
const PACE_MS = 500;

/** Le mot de passe des comptes crees. Deja valide par la politique (voir e2e). */
const NEW_PASSWORD = 'Boussole-Fractale-77-Zircon';

const DEV_EMAIL = `${MARKER}-dev-${RUN}@comexa.example`;
const PORTAL_A_EMAIL = `${MARKER}-portal-a-${RUN}@comexa.example`;
const PORTAL_B_EMAIL = `${MARKER}-portal-b-${RUN}@comexa.example`;
const VISITOR_EMAIL = `${MARKER}-visitor-${RUN}@comexa.example`;

const PROSPECT_COMPANY = `${MARKER} prospect ${RUN}`;
const CLIENT_B_COMPANY = `${MARKER} client B ${RUN}`;

/**
 * Devis : 1 x 1 000,00 + 2 x 500,00 = 2 000,00 HT, TVA 20 % -> 2 400,00 TTC.
 * Montants choisis exacts au centime : le solde attendu se lit directement.
 */
const LINES = [
  { title: 'Cadrage et maquettes', quantity: 1, unitPrice: 1000 },
  { title: 'Integration', quantity: 2, unitPrice: 500 },
];
const TOTAL = '2400.00';

const DOC_BODY = `Contenu du document de verification ${RUN}.\n`;

// ---------------------------------------------------------------------------
// Etat collecte, pour le nettoyage
// ---------------------------------------------------------------------------

interface Gathered {
  userIds: string[];
  clientIds: string[];
  projectIds: string[];
  quoteIds: string[];
  invoiceIds: string[];
  documentIds: string[];
  prospectIds: string[];
  contactRequestIds: string[];
}

function emptyGathered(): Gathered {
  return {
    userIds: [],
    clientIds: [],
    projectIds: [],
    quoteIds: [],
    invoiceIds: [],
    documentIds: [],
    prospectIds: [],
    contactRequestIds: [],
  };
}

// ---------------------------------------------------------------------------
// Couche HTTP
// ---------------------------------------------------------------------------

interface Envelope {
  success: boolean;
  data?: unknown;
  meta?: { page?: number; perPage?: number; total?: number; totalPages?: number };
  error?: { code: string; message: string; details?: unknown };
}

interface Result {
  status: number;
  body: Envelope;
}

let requestCount = 0;

interface CallOptions {
  token?: string;
  body?: unknown;
  form?: FormData;
  timeoutMs?: number;
}

/**
 * Un appel HTTP, avec rythme et budget de temps.
 *
 * Le rythme est applique AVANT la requete, jamais apres : applique apres, la
 * premiere requete partirait sans delai, et une boucle d'erreurs rapides pourrait
 * vider le quota en quelques secondes.
 *
 * Le delai d'attente n'est pas decoratif. Render endort un service gratuit apres
 * quinze minutes sans trafic entrant, et le premier appel qui le reveille attend
 * le demarrage complet du conteneur — soit couramment quarante a soixante
 * secondes. Un delai court transformerait ce reveil normal en echec.
 */
async function call(method: string, path: string, options: CallOptions = {}): Promise<Result> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  let payload: FormData | string | undefined;
  if (options.form) {
    // Le Content-Type multipart doit porter sa boundary : c'est `fetch` qui le
    // compose, et le fixer a la main la ferait disparaitre.
    payload = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }

  await sleep(PACE_MS);
  requestCount += 1;

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
  } catch (error) {
    throw new Error(
      `${method} ${API}${path} : la requete n'a pas abouti — ${describeNetworkError(error)}`,
    );
  }

  const text = await response.text();

  let body: Envelope;
  try {
    body = text.length > 0 ? (JSON.parse(text) as Envelope) : { success: false };
  } catch {
    throw new Error(
      `${method} ${path} : reponse ${response.status} NON-JSON.\n` +
        `  Debut du corps recu : ${text.slice(0, 300) || '(vide)'}\n` +
        "  Une page HTML ici signifie que la requete n'a pas atteint l'API : prefixe " +
        'different, service non demarre, ou proxy en amont.',
    );
  }

  return { status: response.status, body };
}

/** Le contenu utile, en refusant tout ce qui n'est pas un succes 2xx. */
function data<T>(result: Result, what: string): T {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(
      `${what} : attendu 2xx, recu ${result.status}\n  ${JSON.stringify(result.body)}`,
    );
  }
  if (result.body.success !== true) {
    throw new Error(`${what} : la reponse porte success != true\n  ${JSON.stringify(result.body)}`);
  }
  return result.body.data as T;
}

/** Controle qu'une reponse d'echec porte bien le code attendu. */
function expectError(result: Result, status: number, code: string, what: string): void {
  if (result.status !== status) {
    throw new Error(
      `${what} : attendu ${status}, recu ${result.status}\n  ${JSON.stringify(result.body)}`,
    );
  }
  if (result.body.success !== false) {
    throw new Error(`${what} : une reponse d'echec doit porter success: false`);
  }
  const received = result.body.error?.code;
  if (received !== code) {
    throw new Error(
      `${what} : attendu le code ${code}, recu ${received ?? '(aucun)'}\n` +
        `  ${JSON.stringify(result.body.error)}`,
    );
  }
}

/** Controle qu'une reponse est au statut attendu, sans se prononcer sur le corps. */
function expectStatus(result: Result, status: number, what: string): void {
  if (result.status !== status) {
    throw new Error(
      `${what} : attendu ${status}, recu ${result.status}\n  ${JSON.stringify(result.body)}`,
    );
  }
}

/**
 * Une liste paginee. `data` EST le tableau : l'intercepteur aplatit la pagination
 * et pose `meta` a cote. Un `data.items` vaudrait `undefined`, et un controle qui
 * lirait `data.items` ne s'en apercevrait pas.
 */
function listData<T>(result: Result, what: string): T[] {
  const value = data<unknown>(result, what);
  if (!Array.isArray(value)) {
    throw new Error(
      `${what} : une liste paginee doit rendre un TABLEAU dans data, recu ${typeof value}. ` +
        'Si un objet est recu ici, la pagination a change de forme.',
    );
  }
  return value as T[];
}

function totalOf(result: Result, what: string): number {
  const total = result.body.meta?.total;
  if (total === undefined) {
    throw new Error(`${what} : une liste paginee doit porter meta.total a cote de data`);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Types des charges utiles lues
//
// Ce sont des ASSERTIONS sur une reponse JSON, pas des validations : un champ
// manquant ne levera rien a la lecture. Ils ne servent donc qu'a nommer ce que
// le script lit, et ils sont ecrits d'apres les reponses observees — pas d'apres
// une intention. Un type qui promet un champ absent fait perdre plus de temps
// qu'il n'en fait gagner.
// ---------------------------------------------------------------------------

interface Identified {
  id: string;
}

interface Reference extends Identified {
  reference: string;
}

interface ContactRequestView extends Reference {
  status: string;
  email: string;
}

interface ProspectView extends Reference {
  status: string;
  email: string;
  convertedClientId: string | null;
  convertedAt: string | null;
}

interface QuoteView extends Reference {
  status: string;
  clientId: string | null;
  prospectId: string | null;
  subtotal: unknown;
  taxAmount: unknown;
  total: unknown;
  items: Identified[];
}

interface Acceptance {
  quoteId: string;
  clientId: string;
  projectId: string;
  clientCreated: boolean;
}

interface ClientView extends Reference {
  companyName: string;
  status: string;
}

interface ProjectView extends Reference {
  status: string;
  progressPercent: number;
  completedAt: string | null;
  /**
   * Le projet porte son client en OBJET imbrique, pas en `clientId` plat : les
   * devis et factures exposent `clientId`, les projets exposent `client.id`.
   * Cette divergence a deja fait echouer le fichier e2e — le typage ne pouvait
   * pas la rattraper, puisqu'une reponse JSON n'est pas validee.
   */
  client: Identified | null;
}

/** Une tache n'a PAS de `reference` : elle est identifiee par son `id` seul. */
interface TaskView extends Identified {
  title: string;
  status: string;
  isClientVisible: boolean;
  assigneeId: string | null;
}

interface MemberView {
  projectRole: string | null;
  allocationPercent: number | null;
  user: Identified;
}

interface InvoiceView extends Reference {
  status: string;
  clientId: string;
  quoteId: string | null;
  projectId: string | null;
  total: unknown;
  amountPaid: unknown;
  paidAt: string | null;
  items: Identified[];
}

interface PaymentResult {
  payment: Reference & { amount: unknown; invoiceId: string; status: string };
  invoice: { id: string; status: string; amountPaid: string; total: string; balance: string };
}

interface DocumentView extends Identified {
  name: string;
  visibility: string;
}

interface UserView extends Identified {
  email: string;
  mustChangePassword: boolean;
  clientId: string | null;
  roles: string[];
}

interface CreatedAccount {
  user: UserView;
  temporaryPassword: string;
}

interface LoginView {
  accessToken: string;
}

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------

let stepNumber = 0;

function step(title: string): void {
  stepNumber += 1;
  console.log(`\n${String(stepNumber).padStart(2, '0')}. ${title}`);
}

function ok(message: string): void {
  console.log(`    OK — ${message}`);
}

function info(message: string): void {
  console.log(`         ${message}`);
}

// ---------------------------------------------------------------------------
// Le parcours
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const env = readEnvFile(resolve(backendRoot, '.env'));

  const adminEmail = env.SEED_ADMIN_EMAIL;
  const adminPassword = env.SEED_ADMIN_PASSWORD;
  const databaseUrl = env.DATABASE_URL;

  if (!adminEmail || !adminPassword) {
    fail(
      'SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD sont absentes de backend/.env.\n' +
        'Ce script a besoin du compte administrateur du seed pour ouvrir la session ' +
        'initiale. Les ajouter, puis relancer.',
    );
  }
  if (!databaseUrl) {
    fail(
      'DATABASE_URL est absente de backend/.env.\n' +
        'Elle est necessaire au nettoyage : la suppression des lignes creees ne passe par ' +
        'aucune route pour les devis, les prospects et les dossiers clients. Le fichier ' +
        '.env pointe deja vers la base du service deploye.',
    );
  }

  console.log('AUDIT FINAL — chaine metier complete sur le service deploye');
  console.log(`  Service   : ${BASE}`);
  console.log('  Prefixe   : /api');
  console.log(`  Execution : ${MARKER}-${RUN}`);
  console.log("  Nettoyage : par identifiants collectes, dans l'ordre des cles etrangeres");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const created = emptyGathered();
  const adminSession: AdminSession = {
    email: adminEmail,
    seedPassword: adminPassword,
    token: '',
    interimPassword: null,
  };
  let failure: unknown = null;

  try {
    await sweepStale(prisma);

    const ctx = await runChain(created, adminSession);

    console.log(`\n${'-'.repeat(78)}`);
    console.log('RESULTAT : la chaine complete tient sur le service deploye.');
    console.log(`  Devis ${ctx.quoteReference} accepte -> dossier ${ctx.clientReference}`);
    console.log(`  Projet ${ctx.projectReference} mene de PLANNED a COMPLETED`);
    console.log(`  Facture ${ctx.invoiceReference} encaissee ${TOTAL} EUR -> PAID, solde 0.00`);
    console.log(`  ${requestCount} requetes HTTP, aucune n'a echoue.`);
  } catch (error) {
    failure = error;
  } finally {
    console.log(`\n${'-'.repeat(78)}`);
    console.log('NETTOYAGE');

    // AVANT LE RESTE, ET HORS DU `try` DU NETTOYAGE. Si la restauration du mot
    // de passe de l'administrateur echouait en meme temps que le nettoyage, un
    // `catch` commun masquerait la plus grave des deux : un compte de service
    // laisse sur un mot de passe que personne ne connait. Chacune a donc son
    // propre traitement, et la restauration passe en premier.
    await restoreAdminPassword(adminSession);

    try {
      await removeInOrder(prisma, created);
      const leftovers = await countLeftovers(prisma, created);
      if (leftovers > 0) {
        console.log(
          `  ATTENTION : ${leftovers} ligne(s) n'ont pas pu etre supprimees. Verifier ` +
            `manuellement — l'execution ${RUN} a laisse des donnees en base.`,
        );
      } else {
        console.log('  Verifie : plus aucune ligne de cette execution ne subsiste.');
      }
    } catch (error) {
      console.log(
        `  ECHEC DU NETTOYAGE — ${error instanceof Error ? error.message : String(error)}`,
      );
      console.log(
        '  Des lignes de cette execution subsistent en base. Relancer le script les ' +
          'reprendra : leur marqueur les designe, et le balayage des restes les supprime.',
      );
    }
    await prisma.$disconnect();
  }

  if (failure) {
    throw failure;
  }
}

interface ChainContext {
  quoteReference: string;
  clientReference: string;
  projectReference: string;
  invoiceReference: string;
}

/**
 * La session de l'administrateur, y compris son etat de mot de passe.
 *
 * CET OBJET EST MUTABLE, ET C'EST VOULU. `runChain` le remplit au fil du
 * parcours (jeton, mot de passe intermediaire), et `main` le relit dans son
 * `finally` pour remettre le mot de passe en place. Un objet partage est ici
 * plus sur qu'une valeur de retour : le `finally` doit pouvoir agir MEME QUAND le
 * parcours a echoue avant d'avoir pu rendre quoi que ce soit.
 */
interface AdminSession {
  readonly email: string;
  /** Le mot de passe du seed, tel qu'il figure dans backend/.env. */
  readonly seedPassword: string;
  /** Jeton d'acces courant. Remplace a chaque changement de mot de passe. */
  token: string;
  /**
   * Le mot de passe pose par le script, tant qu'il n'a pas ete remis. `null`
   * veut dire « rien a restaurer » — soit que le compte n'etait pas en premiere
   * connexion, soit que la restauration a deja eu lieu.
   */
  interimPassword: string | null;
}

/**
 * Les identifiants de l'administrateur viennent de `main`, par la session, et
 * non de lectures de `process.env` dispersees. Une valeur lue deux fois finit
 * par diverger ; ici il n'y a qu'une lecture, et c'est elle qui porte le message
 * d'erreur nommant `backend/.env`.
 */
async function runChain(created: Gathered, adminSession: AdminSession): Promise<ChainContext> {
  // =========================================================================
  step('SANTE — le service repond, et il repond sur la vraie base');
  // =========================================================================
  //
  // Premier appel, donc celui qui reveille le conteneur endormi. Le delai est
  // large pour cette raison precise, et pour celle-la seulement.
  const health = await call('GET', '/health', { timeoutMs: 150_000 });
  const healthBody = data<{ status: string; database: string; uptimeSeconds: number }>(
    health,
    'GET /api/health',
  );
  if (healthBody.database !== 'up') {
    throw new Error(
      `La sonde rend database="${healthBody.database}". La base ne repond pas depuis le ` +
        'service : verifier DATABASE_URL cote hebergeur, puis que la base Neon est active.',
    );
  }
  ok(`status=${healthBody.status}, database=up — la sonde interroge vraiment la base`);
  info(`Le service tourne depuis ${healthBody.uptimeSeconds} s.`);

  // =========================================================================
  step('CONNEXION — le compte administrateur du seed ouvre une session');
  // =========================================================================
  const login = await call('POST', '/auth/login', {
    body: { email: adminSession.email, password: adminSession.seedPassword },
  });
  const loginBody = data<LoginView>(login, 'POST /api/auth/login');
  let admin = loginBody.accessToken;
  if (typeof admin !== 'string' || admin.length === 0) {
    throw new Error("La connexion a reussi mais aucun jeton d'acces n'a ete rendu.");
  }
  adminSession.token = admin;
  ok(`Session ouverte pour ${maskEmail(adminSession.email)}, jeton de ${admin.length} caracteres`);

  const wrongPassword = await call('POST', '/auth/login', {
    body: { email: adminSession.email, password: `${adminSession.seedPassword}-faux` },
  });
  expectError(wrongPassword, 401, 'INVALID_CREDENTIALS', 'connexion avec un mauvais mot de passe');
  ok('Un mauvais mot de passe est refuse (401 INVALID_CREDENTIALS)');

  const anonymous = await call('GET', '/users');
  expectError(anonymous, 401, 'UNAUTHENTICATED', 'liste des comptes sans jeton');
  ok('Sans jeton, la liste des comptes est fermee (401 UNAUTHENTICATED)');

  // =========================================================================
  step('MISE EN SERVICE — le mot de passe du seed est change une fois, puis remis');
  // =========================================================================
  //
  // CE QU'ON DECOUVRE ICI, ET POURQUOI CE N'EST PAS UN DETAIL.
  //
  // `upsertAccount` (prisma/seed.ts) cree le compte administrateur avec
  // `mustChangePassword: true`, et son commentaire donne la raison : le mot de
  // passe est connu de qui a lance le seed, il doit donc etre change a la
  // premiere connexion. La decision est bonne.
  //
  // La consequence, elle, n'etait ecrite nulle part : tant que ce changement n'a
  // pas eu lieu, LE COMPTE ADMINISTRATEUR NE PEUT RIEN FAIRE. Le garde
  // (`access.guards.ts`) ferme tout sauf les routes marquees comme permettant
  // d'en sortir. La connexion reussit — un jeton est delivre — puis chaque route
  // metier repond 403 PASSWORD_CHANGE_REQUIRED. Un deploiement neuf est donc
  // inutilisable, et le seul symptome est un 403 sur la PREMIERE requete venue.
  //
  // La premiere execution de ce script s'est arretee la, sur
  // `GET /api/contact-requests`. Le compte admin n'avait jamais ete mis en
  // service depuis le deploiement.
  //
  // CE QUE CE SCRIPT FAIT DE CET ETAT, ET POURQUOI CE N'EST PAS UN CONTOURNEMENT.
  //
  // Le changement est unavoidable : aucune route ne permet de poser le drapeau a
  // faux hors de `POST /auth/change-password`, qui exige le mot de passe actuel.
  // Le script change donc le mot de passe, fait le parcours, puis LE REMET A SA
  // VALEUR D'ORIGINE.
  //
  // Le retour en arriere est possible, et c'est verifie dans le code plutot que
  // suppose : `changePassword` n'interdit que « identique a l'actuel »
  // (auth.service.ts) — il n'y a aucun historique de mots de passe. Et l'ordre
  // des ecritures compte : `mustChangePassword` est mis a `false` par le
  // changement et N'EST PAS repose par le suivant. Le compte se retrouve donc
  // avec le mot de passe que l'operateur connait deja, ET le drapeau tombe. La
  // production se termine dans l'etat ou elle aurait du naitre.
  //
  // Ce qui rend la manœuvre supportable plutot que risque : elle est IDEMPOTENTE.
  // Sur un compte deja mis en service, la sonde rend 200 et le script ne touche a
  // rien. Une seconde execution ne repose jamais le drapeau.
  //
  // RESTE LE VRAI RISQUE, ET IL EST NOMME : un arret force entre le changement et
  // la remise laisserait le compte sur un mot de passe que personne ne connait.
  // C'est pourquoi la valeur intermediaire est AFFICHEE au moment ou elle est
  // posee. `verify-storage.ts` refuse d'afficher des identifiants, et c'est la
  // bonne regle pour une configuration stockee. Ici il s'agit d'un mot de passe
  // de recuperation : le taire exposerait a un verrouillage sur son propre
  // compte, ce qui est pire que le risque d'affichage. Il n'apparait que si le
  // script a effectivement touche au compte.
  const probe = await call('GET', '/users', { token: admin });

  if (probe.status === 403 && probe.body.error?.code === 'PASSWORD_CHANGE_REQUIRED') {
    info('Compte administrateur en PREMIERE CONNEXION : toutes les routes metier sont fermees.');
    info(
      "C'est exactement ce que le deploiement laisse derriere lui, et rien ne le documentait. " +
        'Le script met le compte en service, puis rend le mot de passe a sa valeur du .env.',
    );

    const interim = `Interim-${RUN}-Boussole-Zircon`;
    const changed = await call('POST', '/auth/change-password', {
      token: admin,
      body: {
        currentPassword: adminSession.seedPassword,
        newPassword: interim,
        confirmPassword: interim,
      },
    });
    expectStatus(changed, 200, 'POST /api/auth/change-password (mise en service)');
    adminSession.interimPassword = interim;

    // La route rend un jeton NEUF. L'ancien resterait valide — le garde recharge
    // le porteur depuis la base a chaque requete — mais rien ne justifie de
    // garder un jeton quand on en recoit un frais.
    const refreshed = data<LoginView>(changed, 'POST /api/auth/change-password');
    admin = refreshed.accessToken;
    adminSession.token = admin;

    ok('Compte mis en service : mot de passe change, drapeau mustChangePassword tombe');
    ok(
      `Valeur intermediaire (a reporter dans backend/.env si ce script est interrompu) : ${interim}`,
    );
    info('Elle sera remise a la valeur du .env a la fin du parcours.');

    expectStatus(
      await call('GET', '/users', { token: admin }),
      200,
      'GET /api/users apres mise en service',
    );
    ok('Les routes metier sont desormais ouvertes — le blocage etait bien le drapeau, pas un role');
  } else {
    expectStatus(probe, 200, 'GET /api/users (sonde de premiere connexion)');
    ok('Compte administrateur deja en service — le script ne touche pas a son mot de passe');
  }

  // =========================================================================
  step('VISITEUR — le formulaire public ecrit une demande, relue par l agence');
  // =========================================================================
  const visitor = await call('POST', '/public/contact-requests', {
    body: {
      firstName: 'Camille',
      lastName: 'Verification',
      email: VISITOR_EMAIL,
      companyName: `Verification SARL ${RUN}`,
      subject: 'Demande de devis site vitrine',
      message: 'Bonjour, je souhaite un devis pour la refonte de notre site vitrine.',
      budgetRange: 'FROM_15K_TO_30K',
      source: 'audit-production',
    },
  });
  expectStatus(visitor, 201, 'POST /api/public/contact-requests');
  const receipt = data<{ received: boolean }>(visitor, 'POST /api/public/contact-requests');
  if (receipt.received !== true) {
    throw new Error("La demande publique n'a pas rendu received: true.");
  }
  ok('Demande acceptee sans aucun compte — la seule route publique qui ecrit en base');
  info(
    'La reference est volontairement ABSENTE de cette reponse : elle est sequentielle, et ' +
      'deux envois suffiraient a en deduire le volume annuel de demandes.',
  );

  const requestSearch = `/contact-requests?search=${encodeURIComponent(VISITOR_EMAIL)}`;
  const requests = await call('GET', requestSearch, { token: admin });
  const found = listData<ContactRequestView>(requests, 'GET /api/contact-requests').find(
    (entry) => entry.email === VISITOR_EMAIL,
  );
  if (!found) {
    throw new Error("La demande du visiteur ne figure pas dans la file de l'agence.");
  }
  if (totalOf(requests, 'GET /api/contact-requests') !== 1) {
    throw new Error(
      "L'adresse du visiteur est unique par execution : la recherche doit rendre exactement " +
        'une demande.',
    );
  }
  created.contactRequestIds.push(found.id);
  assertReference(found.reference, 'CTR', 'la demande de contact');
  if (found.status !== 'NEW') {
    throw new Error(`Une demande qui vient d'arriver est NEW, recue ${found.status}.`);
  }
  ok(`Reference ${found.reference}, statut NEW — le compteur CTR est traverse`);

  // =========================================================================
  step('PROSPECT — creation, deplacement dans le pipeline, historique relu');
  // =========================================================================
  const prospectCreated = await call('POST', '/prospects', {
    token: admin,
    body: {
      companyName: PROSPECT_COMPANY,
      contactFirstName: 'Camille',
      contactLastName: 'Verification',
      email: VISITOR_EMAIL,
      phone: '+33 5 56 00 00 09',
      sector: 'Commerce de proximite',
      source: 'CONTACT_FORM',
      estimatedBudget: 18000,
      notes: `Issue de la demande de contact ${found.reference}.`,
    },
  });
  expectStatus(prospectCreated, 201, 'POST /api/prospects');
  const prospect = data<ProspectView>(prospectCreated, 'POST /api/prospects');
  created.prospectIds.push(prospect.id);

  const freshProspect = data<ProspectView>(
    await call('GET', `/prospects/${prospect.id}`, { token: admin }),
    'GET /api/prospects/:id',
  );
  if (freshProspect.status !== 'NEW') {
    throw new Error(`Un prospect nait NEW, recu ${freshProspect.status}.`);
  }
  assertReference(freshProspect.reference, 'PRO', 'le prospect');
  ok(
    `${freshProspect.reference} cree, statut NEW — relu par une AUTRE route que celle qui l'a ecrit`,
  );

  const movedProspect = data<ProspectView>(
    await call('POST', `/prospects/${prospect.id}/status`, {
      token: admin,
      body: { status: 'QUALIFIED', note: 'Budget et besoin confirmes par telephone.' },
    }),
    'POST /api/prospects/:id/status',
  );
  if (movedProspect.status !== 'QUALIFIED') {
    throw new Error(
      `Apres la transition, le statut devrait etre QUALIFIED, recu ${movedProspect.status}.`,
    );
  }
  ok('Transition NEW -> QUALIFIED appliquee');

  const entries = listData<{ fromStatus: string | null; toStatus: string }>(
    await call('GET', `/prospects/${prospect.id}/history`, { token: admin }),
    'GET /api/prospects/:id/history',
  );
  if (entries.length !== 2) {
    throw new Error(
      `L'historique doit porter deux lignes (creation, puis QUALIFIED), il en porte ${entries.length}.`,
    );
  }
  const lastTransition = entries[entries.length - 1];
  if (
    !lastTransition ||
    lastTransition.fromStatus !== 'NEW' ||
    lastTransition.toStatus !== 'QUALIFIED'
  ) {
    throw new Error(
      'La derniere ligne d historique doit relier NEW a QUALIFIED : ' +
        JSON.stringify(lastTransition),
    );
  }
  ok('Historique relu : deux lignes, NEW -> QUALIFIED — le pipeline est reellement historise');

  // =========================================================================
  step('DEVIS — creation sur le prospect, envoi, totaux calcules par le serveur');
  // =========================================================================
  const quoteCreated = await call('POST', '/quotes', {
    token: admin,
    body: {
      subject: `Refonte du site vitrine ${RUN}`,
      prospectId: prospect.id,
      currency: 'EUR',
      taxRate: 20,
      items: LINES,
    },
  });
  expectStatus(quoteCreated, 201, 'POST /api/quotes');
  const quote = data<QuoteView>(quoteCreated, 'POST /api/quotes');
  created.quoteIds.push(quote.id);

  const freshQuote = data<QuoteView>(
    await call('GET', `/quotes/${quote.id}`, { token: admin }),
    'GET /api/quotes/:id',
  );
  if (freshQuote.status !== 'DRAFT') {
    throw new Error(`Un devis nait en brouillon, recu ${freshQuote.status}.`);
  }
  if (freshQuote.clientId !== null) {
    throw new Error('Avant acceptation, un devis vise un prospect et non un client.');
  }
  assertReference(freshQuote.reference, 'DEV', 'le devis');
  if (money(freshQuote.subtotal) !== '2000.00') {
    throw new Error(`Sous-total attendu 2000.00, recu ${money(freshQuote.subtotal)}.`);
  }
  if (money(freshQuote.taxAmount) !== '400.00') {
    throw new Error(`TVA attendue 400.00, recu ${money(freshQuote.taxAmount)}.`);
  }
  if (money(freshQuote.total) !== TOTAL || freshQuote.items.length !== 2) {
    throw new Error(
      `Total attendu ${TOTAL} sur 2 lignes, recu ${money(freshQuote.total)} sur ` +
        `${freshQuote.items.length} ligne(s).`,
    );
  }
  ok(`${freshQuote.reference} : 2 000,00 HT + 400,00 TVA = ${TOTAL} TTC, calcule par le serveur`);

  const sentQuote = data<QuoteView>(
    await call('POST', `/quotes/${quote.id}/send`, { token: admin, body: {} }),
    'POST /api/quotes/:id/send',
  );
  if (sentQuote.status !== 'SENT') {
    throw new Error(`Apres envoi, le devis devrait etre SENT, recu ${sentQuote.status}.`);
  }
  ok("Envoi effectue : DRAFT -> SENT, relu sur la reponse de l'envoi lui-meme");

  // =========================================================================
  step('ACCEPTATION — le devis produit le dossier client ET le projet');
  // =========================================================================
  const acceptance = data<Acceptance>(
    await call('POST', `/quotes/${quote.id}/accept`, { token: admin, body: {} }),
    'POST /api/quotes/:id/accept',
  );
  created.clientIds.push(acceptance.clientId);
  created.projectIds.push(acceptance.projectId);

  if (acceptance.clientCreated !== true) {
    throw new Error(
      "Le prospect n'avait aucun dossier : l'acceptation devait en creer un (clientCreated true).",
    );
  }
  if (!acceptance.projectId || acceptance.projectId === acceptance.clientId) {
    throw new Error(
      "L'acceptation doit rendre un projet ET un dossier, distincts l'un de l'autre.",
    );
  }
  ok('Dossier client ET projet ouverts par la seule acceptation du devis');

  const acceptedQuote = data<QuoteView>(
    await call('GET', `/quotes/${quote.id}`, { token: admin }),
    'GET /api/quotes/:id',
  );
  if (acceptedQuote.status !== 'ACCEPTED' || acceptedQuote.clientId !== acceptance.clientId) {
    throw new Error(
      `Le devis accepte doit porter ACCEPTED et le dossier cree. Recu ${acceptedQuote.status}, ` +
        `clientId=${acceptedQuote.clientId ?? 'null'}.`,
    );
  }
  ok('Devis relu : ACCEPTED, et il porte desormais le dossier client');

  const wonProspect = data<ProspectView>(
    await call('GET', `/prospects/${prospect.id}`, { token: admin }),
    'GET /api/prospects/:id',
  );
  if (wonProspect.status !== 'WON' || wonProspect.convertedClientId !== acceptance.clientId) {
    throw new Error(
      `Le prospect doit etre WON et pointer vers le dossier cree. Recu ${wonProspect.status}, ` +
        `convertedClientId=${wonProspect.convertedClientId ?? 'null'}.`,
    );
  }
  if (!wonProspect.convertedAt) {
    throw new Error('La date de conversion doit etre posee avec le lien vers le dossier.');
  }
  ok('Prospect relu : WON, date de conversion posee — la conversion se verifie dans les deux sens');

  // =========================================================================
  step('CLIENT — le dossier ne de l acceptation est lisible et numerote');
  // =========================================================================
  const client = data<ClientView>(
    await call('GET', `/clients/${acceptance.clientId}`, { token: admin }),
    'GET /api/clients/:id',
  );
  if (client.status !== 'ACTIVE') {
    throw new Error(`Un dossier client neuf est ACTIVE, recu ${client.status}.`);
  }
  if (client.companyName !== PROSPECT_COMPANY) {
    throw new Error(
      `Le dossier doit reprendre la raison sociale du prospect (${PROSPECT_COMPANY}), ` +
        `recu ${client.companyName}.`,
    );
  }
  assertReference(client.reference, 'CLI', 'le dossier client');
  ok(`${client.reference} — ${client.companyName}, statut ACTIVE`);

  // =========================================================================
  step('PROJET — le projet ouvert est rattache au bon client');
  // =========================================================================
  const project = data<ProjectView>(
    await call('GET', `/projects/${acceptance.projectId}`, { token: admin }),
    'GET /api/projects/:id',
  );
  if (!project.client || project.client.id !== acceptance.clientId) {
    throw new Error('Le projet doit porter le dossier client ne de la meme acceptation.');
  }
  if (project.status !== 'PLANNED') {
    throw new Error(`Un projet ne nait pas en cours : il est PLANNED, recu ${project.status}.`);
  }
  assertReference(project.reference, 'PRJ', 'le projet');
  ok(`${project.reference} — statut PLANNED, rattache a ${client.reference}`);

  // =========================================================================
  step('EQUIPE — un developpeur cree PAR L API est ajoute au projet');
  // =========================================================================
  //
  // Le fichier e2e ecrit ce compte directement en base. Ici, ce chemin n'existe
  // pas : le compte passe par `POST /api/users`. C'est une couverture EN PLUS,
  // pas une contrainte contournee — l'administration des comptes est ainsi
  // exercee pour de vrai, elle qui n'etait jamais testee par ce parcours.
  const devResponse = await call('POST', '/users', {
    token: admin,
    body: {
      email: DEV_EMAIL,
      firstName: 'Verification',
      lastName: 'Developpeur',
      roleCodes: ['DEVELOPER'],
    },
  });
  expectStatus(devResponse, 201, 'POST /api/users (developpeur)');
  const dev = data<CreatedAccount>(devResponse, 'POST /api/users (developpeur)');
  created.userIds.push(dev.user.id);

  if (!dev.user.roles.includes('DEVELOPER')) {
    throw new Error(`Le compte doit porter le role DEVELOPER, recu ${dev.user.roles.join(', ')}.`);
  }
  if (dev.user.mustChangePassword !== true) {
    throw new Error(
      'Un compte cree par un administrateur doit naitre avec mustChangePassword : true.',
    );
  }
  if (!dev.temporaryPassword) {
    throw new Error("Le mot de passe initial n'est rendu qu'a la creation : il doit etre present.");
  }
  ok(
    `Compte DEVELOPER cree par l'API, mot de passe temporaire rendu UNE SEULE FOIS ` +
      `(${dev.temporaryPassword.length} caracteres)`,
  );
  info(
    "Ce compte n'ouvre aucune session : `POST /projects/:id/members` prend un identifiant " +
      "d'utilisateur. Cela economise une connexion sur un quota de dix par minute.",
  );

  expectStatus(
    await call('POST', `/projects/${project.id}/members`, {
      token: admin,
      body: { userId: dev.user.id, projectRole: 'Developpeur front', allocationPercent: 60 },
    }),
    201,
    'POST /api/projects/:id/members',
  );

  const members = listData<MemberView>(
    await call('GET', `/projects/${project.id}/members`, { token: admin }),
    'GET /api/projects/:id/members',
  );
  const member = members.find((entry) => entry.user.id === dev.user.id);
  if (!member || member.projectRole !== 'Developpeur front' || member.allocationPercent !== 60) {
    throw new Error(
      'Le membre ajoute doit figurer dans la composition relue, avec son role et sa charge.',
    );
  }
  ok('Membre relu dans la composition du projet : role « Developpeur front », charge 60 %');

  // =========================================================================
  step('TACHES — deux taches, dont une interne, menees a DONE');
  // =========================================================================
  const visibleTask = data<TaskView>(
    await call('POST', `/projects/${project.id}/tasks`, {
      token: admin,
      body: {
        title: `Integrer la page d'accueil ${RUN}`,
        description: 'Tache visible par le client.',
        assigneeId: dev.user.id,
        priority: 'HIGH',
        estimateMinutes: 480,
        isClientVisible: true,
      },
    }),
    'POST /api/projects/:id/tasks (visible)',
  );

  // `isClientVisible` est omis VOLONTAIREMENT : le defaut du schema est FAUX, et
  // un defaut inverse publierait un brouillon au premier oubli.
  const internalTask = data<TaskView>(
    await call('POST', `/projects/${project.id}/tasks`, {
      token: admin,
      body: { title: `Recette interne ${RUN}`, priority: 'NORMAL' },
    }),
    'POST /api/projects/:id/tasks (interne)',
  );

  const tasks = listData<TaskView>(
    await call('GET', `/projects/${project.id}/tasks`, { token: admin }),
    'GET /api/projects/:id/tasks',
  );
  const rereadVisible = tasks.find((entry) => entry.id === visibleTask.id);
  const rereadInternal = tasks.find((entry) => entry.id === internalTask.id);
  if (
    !rereadVisible ||
    rereadVisible.isClientVisible !== true ||
    rereadVisible.assigneeId !== dev.user.id ||
    rereadVisible.status !== 'TODO'
  ) {
    throw new Error('La tache visible doit etre relue TODO, visible, et assignee au developpeur.');
  }
  if (!rereadInternal || rereadInternal.isClientVisible !== false) {
    throw new Error(
      'Une tache creee sans `isClientVisible` doit rester INTERNE : le defaut du schema est faux.',
    );
  }
  ok('Deux taches relues : une visible et assignee, une interne par defaut');

  for (const target of ['IN_PROGRESS', 'DONE'] as const) {
    expectStatus(
      await call('PATCH', `/tasks/${visibleTask.id}/status`, {
        token: admin,
        body: { status: target },
      }),
      200,
      `PATCH /api/tasks/:id/status (${target})`,
    );
    const reread = data<TaskView>(
      await call('GET', `/tasks/${visibleTask.id}`, { token: admin }),
      'GET /api/tasks/:id',
    );
    if (reread.status !== target) {
      throw new Error(`Apres transition, la tache devrait etre ${target}, recue ${reread.status}.`);
    }
    ok(`Tache relue a l'etat ${target}`);
  }

  // =========================================================================
  step('AVANCEMENT — le projet demarre et declare son avancement');
  // =========================================================================
  expectStatus(
    await call('PATCH', `/projects/${project.id}/status`, {
      token: admin,
      body: { status: 'IN_PROGRESS', health: 'ON_TRACK', progressPercent: 40 },
    }),
    200,
    'PATCH /api/projects/:id/status (IN_PROGRESS)',
  );
  const running = data<ProjectView>(
    await call('GET', `/projects/${project.id}`, { token: admin }),
    'GET /api/projects/:id',
  );
  if (running.status !== 'IN_PROGRESS' || running.progressPercent !== 40) {
    throw new Error(
      `Projet attendu IN_PROGRESS a 40 %, recu ${running.status} a ${running.progressPercent} %.`,
    );
  }
  if (running.completedAt !== null) {
    throw new Error('Un projet en cours ne porte pas de date de fin.');
  }
  ok('Projet demarre : IN_PROGRESS, 40 %, aucune date de fin');

  // =========================================================================
  step('FACTURE — nee du devis accepte, lignes recopiees, aucun montant accepte');
  // =========================================================================
  const invoice = data<InvoiceView>(
    await call('POST', `/quotes/${quote.id}/invoice`, {
      token: admin,
      body: { notes: `Facture issue du devis accepte (execution ${RUN}).` },
    }),
    'POST /api/quotes/:id/invoice',
  );
  created.invoiceIds.push(invoice.id);

  if (invoice.status !== 'DRAFT') {
    throw new Error(`Une facture nait en brouillon, recu ${invoice.status}.`);
  }
  if (invoice.clientId !== acceptance.clientId || invoice.quoteId !== quote.id) {
    throw new Error('La facture doit rester liee au devis et au dossier dont elle est issue.');
  }
  assertReference(invoice.reference, 'FAC', 'la facture');
  if (
    invoice.items.length !== 2 ||
    money(invoice.total) !== TOTAL ||
    money(invoice.amountPaid) !== '0.00'
  ) {
    throw new Error(
      `Facture attendue : 2 lignes, ${TOTAL} au total, 0.00 encaisse. Recu : ` +
        `${invoice.items.length} ligne(s), ${money(invoice.total)}, ${money(invoice.amountPaid)}.`,
    );
  }
  if (invoice.paidAt !== null) {
    throw new Error('Une facture non payee ne porte pas de date de reglement.');
  }
  ok(`${invoice.reference} : lignes recopiees, total ${TOTAL}, rien d'encaisse`);

  // LE CORPS DE CETTE ROUTE N'ACCEPTE AUCUN MONTANT. Un total glisse dans la
  // requete doit etre refuse AVANT d'atteindre le service : un perimetre qui
  // depend d'un `if` apres lecture est un perimetre qu'un champ oublie contourne.
  expectError(
    await call('POST', `/quotes/${quote.id}/invoice`, { token: admin, body: { total: 1 } }),
    400,
    'VALIDATION_FAILED',
    'creation de facture avec un montant dans le corps',
  );
  ok('Un montant dans le corps est refuse (400 VALIDATION_FAILED) — avant le service');

  // =========================================================================
  step('PAIEMENT — la facture envoyee est encaissee, le statut est derive');
  // =========================================================================
  //
  // Une facture en brouillon n'est pas payable : c'est l'envoi qui la rend
  // exigible. L'ordre des deux appels est la regle, pas une commodite.
  const afterSend = data<InvoiceView>(
    await call('POST', `/invoices/${invoice.id}/send`, { token: admin, body: {} }),
    'POST /api/invoices/:id/send',
  );
  if (afterSend.status !== 'SENT') {
    throw new Error(`Apres envoi, la facture devrait etre SENT, recue ${afterSend.status}.`);
  }
  ok("Facture envoyee : DRAFT -> SENT — une facture en brouillon n'est pas exigible");

  const payment = data<PaymentResult>(
    await call('POST', `/invoices/${invoice.id}/payments`, {
      token: admin,
      body: {
        amount: 2400,
        method: 'BANK_TRANSFER',
        externalReference: `VIR-${RUN}`,
        notes: 'Solde de la facture.',
      },
    }),
    'POST /api/invoices/:id/payments',
  );
  assertReference(payment.payment.reference, 'PAY', 'le paiement');
  if (payment.payment.status !== 'SUCCEEDED' || money(payment.payment.amount) !== TOTAL) {
    throw new Error(
      `Paiement attendu SUCCEEDED de ${TOTAL}, recu ${payment.payment.status} de ` +
        `${money(payment.payment.amount)}.`,
    );
  }
  if (payment.payment.invoiceId !== invoice.id) {
    throw new Error('Le paiement doit pointer la facture sur laquelle il a ete enregistre.');
  }
  if (payment.invoice.status !== 'PAID' || money(payment.invoice.amountPaid) !== TOTAL) {
    throw new Error(
      `Le statut de la facture est DERIVE de la somme encaissee : attendu PAID pour ${TOTAL}, ` +
        `recu ${payment.invoice.status} pour ${money(payment.invoice.amountPaid)}.`,
    );
  }
  if (payment.invoice.balance !== '0.00') {
    throw new Error(`Solde attendu 0.00, recu ${payment.invoice.balance}.`);
  }
  ok(`${payment.payment.reference} : ${TOTAL} EUR encaisses — facture PAID, solde 0.00`);

  const settled = data<InvoiceView>(
    await call('GET', `/invoices/${invoice.id}`, { token: admin }),
    'GET /api/invoices/:id',
  );
  if (settled.status !== 'PAID' || !settled.paidAt) {
    throw new Error('Une facture soldee relue doit porter PAID et sa date de reglement.');
  }
  ok('Facture relue : PAID, date de reglement posee');

  const paymentList = await call('GET', `/invoices/${invoice.id}/payments`, { token: admin });
  const paymentEntries = listData<Reference>(paymentList, 'GET /api/invoices/:id/payments');
  if (totalOf(paymentList, 'GET /api/invoices/:id/payments') !== 1) {
    throw new Error('La liste des paiements de cette facture doit porter exactement une ligne.');
  }
  if (!paymentEntries.some((entry) => entry.id === payment.payment.id)) {
    throw new Error('Le paiement enregistre doit figurer dans la liste relue.');
  }
  assertReference(paymentEntries[0]?.reference ?? '', 'PAY', 'le paiement relu');
  ok('Paiement relu par sa propre route : une ligne, reference au format PAY-ANNEE-NNNN');

  // =========================================================================
  step('PROJET TERMINE — le projet est clos, la date de fin apparait');
  // =========================================================================
  expectStatus(
    await call('PATCH', `/projects/${project.id}/status`, {
      token: admin,
      body: { status: 'COMPLETED' },
    }),
    200,
    'PATCH /api/projects/:id/status (COMPLETED)',
  );
  const finished = data<ProjectView>(
    await call('GET', `/projects/${project.id}`, { token: admin }),
    'GET /api/projects/:id',
  );
  if (finished.status !== 'COMPLETED' || !finished.completedAt) {
    throw new Error('Un projet clos doit porter COMPLETED et sa date de fin.');
  }
  if (finished.progressPercent !== 100) {
    throw new Error(
      `Un projet termine est a 100 % par definition : laisser ${finished.progressPercent} ` +
        'contredirait le statut.',
    );
  }
  ok('Projet COMPLETED, 100 %, date de fin posee');

  // La chaine est bouclee : devis accepte -> client -> projet -> facture
  // encaissee -> projet termine. La facture relue est bien celle du projet.
  const closingInvoice = data<InvoiceView>(
    await call('GET', `/invoices/${invoice.id}`, { token: admin }),
    'GET /api/invoices/:id',
  );
  if (closingInvoice.projectId !== project.id) {
    throw new Error(
      'La facture doit pointer le projet ne de la meme acceptation : la chaine ne boucle pas.',
    );
  }
  ok('La chaine boucle : la facture encaissee pointe le projet clos, ne du meme devis');

  // =========================================================================
  step('PERIMETRE CLIENT — dossier B complet, pour eprouver l isolation');
  // =========================================================================
  const clientB = data<ClientView>(
    await call('POST', '/clients', {
      token: admin,
      body: { companyName: CLIENT_B_COMPANY, sector: 'Industrie' },
    }),
    'POST /api/clients (B)',
  );
  created.clientIds.push(clientB.id);

  const quoteB = data<QuoteView>(
    await call('POST', '/quotes', {
      token: admin,
      body: {
        subject: `Prestation client B ${RUN}`,
        clientId: clientB.id,
        currency: 'EUR',
        taxRate: 20,
        items: [{ title: 'Prestation isolee', quantity: 1, unitPrice: 2000 }],
      },
    }),
    'POST /api/quotes (B)',
  );
  created.quoteIds.push(quoteB.id);
  expectStatus(
    await call('POST', `/quotes/${quoteB.id}/send`, { token: admin, body: {} }),
    201,
    'POST /api/quotes/:id/send (B)',
  );

  const acceptanceB = data<Acceptance>(
    await call('POST', `/quotes/${quoteB.id}/accept`, { token: admin, body: {} }),
    'POST /api/quotes/:id/accept (B)',
  );
  created.projectIds.push(acceptanceB.projectId);
  if (acceptanceB.clientCreated !== false) {
    throw new Error('Le dossier B existait deja : son acceptation ne doit pas en creer un second.');
  }

  const invoiceB = data<InvoiceView>(
    await call('POST', `/quotes/${quoteB.id}/invoice`, { token: admin, body: {} }),
    'POST /api/quotes/:id/invoice (B)',
  );
  created.invoiceIds.push(invoiceB.id);
  ok(`Dossier B complet : client, devis accepte, projet, facture ${invoiceB.reference}`);

  // =========================================================================
  step('PREMIER ACCES — un compte cree par l agence change son mot de passe');
  // =========================================================================
  //
  // LE PARCOURS REEL D'UN UTILISATEUR QUI ARRIVE, et non un detour de test. Le
  // compte nait avec un mot de passe temporaire ; tant qu'il ne l'a pas change,
  // TOUTES les routes lui repondent 403 sauf la session. On verifie le blocage
  // sur une route METIER, puis on change le mot de passe, puis on verifie que le
  // MEME jeton rouvre ce qui etait ferme — sans reconnexion, parce que le garde
  // recharge le porteur depuis la base a chaque requete.
  const accountAResponse = await call('POST', '/users', {
    token: admin,
    body: {
      email: PORTAL_A_EMAIL,
      firstName: 'Verification',
      lastName: 'Porteur A',
      roleCodes: ['CLIENT'],
      clientId: acceptance.clientId,
    },
  });
  expectStatus(accountAResponse, 201, 'POST /api/users (porteur A)');
  const accountA = data<CreatedAccount>(accountAResponse, 'POST /api/users (porteur A)');
  created.userIds.push(accountA.user.id);

  if (accountA.user.clientId !== acceptance.clientId) {
    throw new Error(
      'Sans `clientId` applique, un compte CLIENT nait SANS PERIMETRE et reste inutilisable : ' +
        'le rattachement doit etre accepte ET pose par la route de creation.',
    );
  }
  ok(
    "Compte CLIENT cree par l'API ET rattache a son dossier — le perimetre est pose a la creation",
  );

  const tempLogin = await call('POST', '/auth/login', {
    body: { email: PORTAL_A_EMAIL, password: accountA.temporaryPassword },
  });
  const portalA = data<LoginView>(
    tempLogin,
    'POST /api/auth/login (porteur A, mot de passe temporaire)',
  ).accessToken;

  expectError(
    await call('GET', '/projects', { token: portalA }),
    403,
    'PASSWORD_CHANGE_REQUIRED',
    'route metier avant changement de mot de passe',
  );
  ok('Le compte neuf est bloque sur une route metier (403 PASSWORD_CHANGE_REQUIRED)');

  expectStatus(await call('GET', '/auth/me', { token: portalA }), 200, 'GET /api/auth/me');
  ok("GET /api/auth/me reste ouvert — c'est ce qui permet d'afficher l'ecran de changement");

  expectStatus(
    await call('POST', '/auth/change-password', {
      token: portalA,
      body: {
        currentPassword: accountA.temporaryPassword,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      },
    }),
    200,
    'POST /api/auth/change-password',
  );
  ok('Mot de passe change');

  expectStatus(
    await call('GET', '/projects', { token: portalA }),
    200,
    'GET /api/projects apres changement de mot de passe',
  );
  ok('Le MEME jeton ouvre desormais la route metier, sans reconnexion');

  const accountBResponse = await call('POST', '/users', {
    token: admin,
    body: {
      email: PORTAL_B_EMAIL,
      firstName: 'Verification',
      lastName: 'Porteur B',
      roleCodes: ['CLIENT'],
      clientId: clientB.id,
    },
  });
  expectStatus(accountBResponse, 201, 'POST /api/users (porteur B)');
  const accountB = data<CreatedAccount>(accountBResponse, 'POST /api/users (porteur B)');
  created.userIds.push(accountB.user.id);

  const portalB = data<LoginView>(
    await call('POST', '/auth/login', {
      body: { email: PORTAL_B_EMAIL, password: accountB.temporaryPassword },
    }),
    'POST /api/auth/login (porteur B)',
  ).accessToken;

  expectStatus(
    await call('POST', '/auth/change-password', {
      token: portalB,
      body: {
        currentPassword: accountB.temporaryPassword,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      },
    }),
    200,
    'POST /api/auth/change-password (porteur B)',
  );
  ok(`Porteur B : ${maskEmail(PORTAL_B_EMAIL)} — deuxieme et derniere session ouverte`);
  info('Trois connexions au total, sous le plafond de dix par minute sur /auth/login.');

  // =========================================================================
  step('ISOLATION — le porteur A ne peut atteindre le dossier B, ni par l URL ni par le corps');
  // =========================================================================
  const ownClient = data<ClientView>(
    await call('GET', `/clients/${acceptance.clientId}`, { token: portalA }),
    'GET /api/clients/:id (le sien)',
  );
  if (ownClient.id !== acceptance.clientId) {
    throw new Error('Le porteur A doit lire son propre dossier.');
  }
  ok('Porteur A : son propre dossier est lisible');

  // 404, ET JAMAIS 403. Un 403 confirmerait l'existence de la ressource et
  // permettrait de balayer des identifiants pour decouvrir quels dossiers sont
  // actifs. Le perimetre est pose dans le `where`, donc la ligne est
  // INTROUVABLE — pas refusee apres avoir ete lue.
  const crossChecks: Array<readonly [string, string]> = [
    [`/clients/${clientB.id}`, 'CLIENT_NOT_FOUND'],
    [`/projects/${acceptanceB.projectId}`, 'PROJECT_NOT_FOUND'],
    [`/quotes/${quoteB.id}`, 'QUOTE_NOT_FOUND'],
    [`/invoices/${invoiceB.id}`, 'INVOICE_NOT_FOUND'],
    [`/invoices/${invoiceB.id}/payments`, 'INVOICE_NOT_FOUND'],
  ];
  for (const [path, code] of crossChecks) {
    expectError(await call('GET', path, { token: portalA }), 404, code, `GET ${path} en porteur A`);
  }
  ok("Cinq identifiants echanges rendent 404, jamais 403 — aucune fuite d'existence");

  // Sans ce controle, les 404 ci-dessus seraient aussi vrais d'une base vide.
  const ownInvoiceB = data<InvoiceView>(
    await call('GET', `/invoices/${invoiceB.id}`, { token: portalB }),
    'GET /api/invoices/:id (porteur B)',
  );
  if (ownInvoiceB.clientId !== clientB.id) {
    throw new Error('Le porteur B doit lire SA facture : sinon les 404 ne prouveraient rien.');
  }
  ok("Le porteur B lit bien la sienne — les 404 ne sont donc pas ceux d'une base vide");

  // Le filtre dans l'URL est INTERNE. Pour un porteur client, le perimetre vient
  // du COMPTE : demander le dossier B ne peut pas elargir ce qu'il voit.
  const filteredQuotes = listData<QuoteView>(
    await call('GET', `/quotes?clientId=${clientB.id}`, { token: portalA }),
    'GET /api/quotes?clientId=... (porteur A)',
  );
  for (const entry of filteredQuotes) {
    if (entry.clientId !== acceptance.clientId) {
      throw new Error(
        'Un porteur client ne voit que les devis de SON dossier, quel que soit le filtre demande.',
      );
    }
  }
  if (filteredQuotes.some((entry) => entry.id === quoteB.id)) {
    throw new Error('Le devis de B ne doit jamais apparaitre dans la liste de A.');
  }
  if (!filteredQuotes.some((entry) => entry.id === quote.id)) {
    throw new Error('Le devis de A doit, lui, etre present.');
  }
  ok('Le filtre ?clientId= ne peut pas elargir le perimetre — il est ignore au profit du compte');

  // `forbidNonWhitelisted` fait echouer la requete sur un champ inconnu du DTO.
  // C'est la seconde barriere : un champ glisse dans un corps ne peut pas etre
  // « ignore en silence » par un service distrait.
  expectError(
    await call('POST', '/clients', {
      token: admin,
      body: { companyName: `Injection ${RUN}`, roleId: 'peu-importe' },
    }),
    400,
    'VALIDATION_FAILED',
    'POST /api/clients avec un champ non declare',
  );
  expectError(
    await call('POST', '/users', {
      token: admin,
      body: {
        email: `${MARKER}-inject-${RUN}@comexa.example`,
        firstName: 'Verification',
        lastName: 'Injection',
        roleCodes: ['CLIENT'],
        roleId: 'peu-importe',
      },
    }),
    400,
    'VALIDATION_FAILED',
    'POST /api/users avec un champ non declare',
  );
  ok('Un champ non declare est refuse en 400 VALIDATION_FAILED, jamais ignore');

  // =========================================================================
  step('DOCUMENTS — depot reel, lien signe suivi, INTERNAL invisible au client');
  // =========================================================================
  //
  // CETTE ETAPE EST LA SEULE QUI EXERCE LE STOCKAGE OBJET DEPUIS LE SERVICE
  // DEPLOYE. Le fichier e2e depose et supprime, mais ne suit jamais le lien
  // signe. Ici le contenu est compare OCTET PAR OCTET apres un aller-retour
  // complet par Backblaze.
  const upload = async (
    name: string,
    visibility: string,
    clientId: string,
    projectId: string,
  ): Promise<DocumentView> => {
    const form = new FormData();
    form.append('name', name);
    form.append('category', 'OTHER');
    form.append('visibility', visibility);
    form.append('clientId', clientId);
    form.append('projectId', projectId);
    form.append('file', new Blob([DOC_BODY], { type: 'text/plain' }), 'note.txt');

    const response = await call('POST', '/documents', { token: admin, form, timeoutMs: 60_000 });
    expectStatus(response, 201, `POST /api/documents (${name})`);
    return data<DocumentView>(response, `POST /api/documents (${name})`);
  };

  const docInternalA = await upload(
    `Note interne A ${RUN}`,
    'INTERNAL',
    acceptance.clientId,
    project.id,
  );
  const docClientA = await upload(
    `Livrable client A ${RUN}`,
    'CLIENT',
    acceptance.clientId,
    project.id,
  );
  const docPublicA = await upload(
    `Plaquette publique A ${RUN}`,
    'PUBLIC',
    acceptance.clientId,
    project.id,
  );
  const docInternalB = await upload(
    `Note interne B ${RUN}`,
    'INTERNAL',
    clientB.id,
    acceptanceB.projectId,
  );
  created.documentIds.push(docInternalA.id, docClientA.id, docPublicA.id, docInternalB.id);
  ok("Quatre documents deposes par l'API multipart — l'ecriture a donc atteint le stockage objet");

  // LES DEUX ROUTES DE LECTURE, ET LEUR PARTAGE DES ROLES.
  //
  // Ce script attendait ici un 200 de `/content`, et il a recu 422. La premiere
  // lecture a ete de croire a une panne ; c'etait une erreur de ma part, et la
  // correction n'est pas dans le service.
  //
  // `StorageDriver` et `StreamingStorageDriver` sont deux interfaces SEPAREES
  // (storage.types.ts), et le commentaire dit pourquoi : « un stockage objet n'a
  // aucune raison d'exposer une lecture qui ferait transiter les octets par
  // l'API — le tout interet de l'URL signee est justement de l'eviter. Seul le
  // pilote local en a besoin. » Les deux routes sont donc complementaires :
  //
  //   - `/download` rend une URL signee : le chemin de la PRODUCTION, ou le
  //     stockage est un objet distant et ou le fichier ne doit pas traverser
  //     l'API ;
  //   - `/content` sert le flux : le chemin du DEVELOPPEMENT, ou le pilote local
  //     ne signe rien et ou un fichier sur disque n'est joignable par personne.
  //
  // L'appel a `/content` est donc conserve, mais pour ce qu'il prouve vraiment :
  // que le refus est PROPRE et NOMME, et non un 500. C'est ce qui permet au
  // frontend de savoir quoi faire. Si le service tournait un jour sur le pilote
  // local, la meme assertion accepterait un 200 et comparerait les octets.
  const streamed = await fetch(`${API}/documents/${docClientA.id}/content`, {
    headers: { Authorization: `Bearer ${admin}` },
    signal: AbortSignal.timeout(60_000),
  });

  if (streamed.status === 200) {
    if ((await streamed.text()) !== DOC_BODY) {
      throw new Error(
        'Le contenu relu par /content differe de celui envoye. Ne jamais accepter ce cas : il ' +
          'signifierait que deux objets se recouvrent dans le bucket.',
      );
    }
    ok('Contenu relu par /content : identique octet pour octet (pilote qui sert un flux)');
  } else if (streamed.status === 422) {
    const refusal = (await streamed.json()) as Envelope;
    if (refusal.error?.code !== 'STORAGE_STREAM_UNSUPPORTED') {
      throw new Error(
        `Le refus de /content doit porter le code STORAGE_STREAM_UNSUPPORTED, recu ` +
          `${refusal.error?.code ?? '(aucun)'}.`,
      );
    }
    ok('Contenu : /content refuse PROPREMENT (422 STORAGE_STREAM_UNSUPPORTED), sans 500');
    info(
      "C'est le contrat du pilote objet : en production, la lecture passe par /download et " +
        'son URL signee. Le frontend doit utiliser cette route-la.',
    );
  } else {
    throw new Error(
      `GET /api/documents/:id/content a repondu ${streamed.status}. Attendu 200 (pilote qui ` +
        'sert un flux) ou 422 STORAGE_STREAM_UNSUPPORTED (pilote objet). Tout autre statut ' +
        'signale une panne non prevue.',
    );
  }

  // LE LIEN SIGNE, REELLEMENT OUVERT, et pas seulement rendu.
  const signed = data<{ url: string; expiresInSeconds: number; fileName: string }>(
    await call('GET', `/documents/${docClientA.id}/download`, { token: admin }),
    'GET /api/documents/:id/download',
  );
  if (!signed.url || signed.expiresInSeconds <= 0) {
    throw new Error('Le lien signe doit porter une URL et une duree de vie.');
  }
  const followed = await fetch(signed.url, { signal: AbortSignal.timeout(60_000) });
  if (!followed.ok) {
    throw new Error(
      `Le lien signe a repondu ${followed.status} ${followed.statusText}. Sans cet acces, ` +
        'aucun client ne peut telecharger un document.',
    );
  }
  if ((await followed.text()) !== DOC_BODY) {
    throw new Error('Le lien signe a rendu un contenu different de celui qui a ete ecrit.');
  }
  ok(
    `Lien signe SUIVI jusqu'a ${urlHost(signed.url)} et contenu identique — ` +
      'le stockage objet repond depuis le reseau du service',
  );

  const adminDocs = listData<DocumentView>(
    await call('GET', `/documents?projectId=${project.id}`, { token: admin }),
    'GET /api/documents (agence)',
  );
  if (adminDocs.length !== 3) {
    throw new Error(
      "L'agence doit voir les trois documents du projet, interne compris. " +
        `Elle en voit ${adminDocs.length}.`,
    );
  }
  ok("L'agence voit les trois documents du projet, y compris l'interne");

  const clientDocs = listData<DocumentView>(
    await call('GET', `/documents?projectId=${project.id}`, { token: portalA }),
    'GET /api/documents (porteur A)',
  );
  const visibleIds = clientDocs.map((document) => document.id).sort();
  const expectedIds = [docClientA.id, docPublicA.id].sort();
  if (JSON.stringify(visibleIds) !== JSON.stringify(expectedIds)) {
    throw new Error(
      'Le porteur client ne doit voir que les documents partageables de son dossier. ' +
        `Attendu ${expectedIds.length}, recu ${visibleIds.length}.`,
    );
  }
  if (clientDocs.some((document) => document.visibility === 'INTERNAL')) {
    throw new Error("Un document INTERNAL ne doit JAMAIS remonter dans l'espace client.");
  }
  ok("Le porteur A ne voit que CLIENT et PUBLIC — l'interne et celui de B ont disparu");

  expectError(
    await call('GET', `/documents/${docInternalA.id}`, { token: portalA }),
    404,
    'DOCUMENT_NOT_FOUND',
    "l'interne par son identifiant, en porteur A",
  );
  expectError(
    await call('GET', `/documents/${docInternalB.id}`, { token: portalA }),
    404,
    'DOCUMENT_NOT_FOUND',
    "l'interne du dossier B, en porteur A",
  );
  ok("Lire l'interne par son identifiant rend 404 — introuvable, pas interdit");

  // DEMANDER l'interne ne l'ouvre pas plus. La demande incoherente est REFUSEE
  // plutot que servie comme une liste vide : un appelant qui demanderait
  // l'interne et recevrait [] croirait a une base vide.
  expectError(
    await call('GET', '/documents?visibility=INTERNAL', { token: portalA }),
    403,
    'FORBIDDEN',
    'demander explicitement la visibilite INTERNAL',
  );
  ok('Demander INTERNAL rend 403, et non une liste vide qui ferait croire a une base vide');

  // Les taches internes sont fermees au client STRUCTURELLEMENT : le role CLIENT
  // ne detient aucune permission `task:*`, donc le garde l'arrete avant le
  // service et aucun chemin ne peut laisser sortir une tache interne.
  expectError(
    await call('GET', `/projects/${project.id}/tasks`, { token: portalA }),
    403,
    'FORBIDDEN',
    'les taches du projet, en porteur client',
  );
  expectStatus(await call('GET', '/me/tasks', { token: portalA }), 403, 'GET /api/me/tasks');
  ok("Taches et composition d'equipe fermees au client par le garde, avant le service");

  const clientUpload = new FormData();
  clientUpload.append('name', `Depot client ${RUN}`);
  clientUpload.append('file', new Blob(['Contenu.\n'], { type: 'text/plain' }), 'note.txt');
  expectStatus(
    await call('POST', '/documents', { token: portalA, form: clientUpload }),
    403,
    'POST /api/documents en porteur client',
  );
  ok('Le client ne depose pas dans la bibliotheque interne');

  // LE NETTOYAGE DES OBJETS PASSE PAR LA ROUTE QUI LES RETIRE : c'est le seul
  // chemin qui supprime le fichier ET la ligne, donc le seul qui ne laisse pas
  // d'objet orphelin dans le bucket.
  for (const documentId of created.documentIds) {
    expectStatus(
      await call('DELETE', `/documents/${documentId}`, { token: admin }),
      200,
      `DELETE /api/documents/${documentId}`,
    );
  }
  ok("Quatre documents supprimes par l'API : objets et lignes retires ensemble");

  return {
    quoteReference: freshQuote.reference,
    clientReference: client.reference,
    projectReference: project.reference,
    invoiceReference: invoice.reference,
  };
}

// ---------------------------------------------------------------------------
// Nettoyage
// ---------------------------------------------------------------------------

/**
 * Rend a l'administrateur le mot de passe que porte `backend/.env`.
 *
 * N'EST APPELEE QUE SI LE SCRIPT A EFFECTIVEMENT CHANGE CE MOT DE PASSE. La
 * garde est le `interimPassword` de la session : `null` veut dire « rien a
 * restaurer », et le cas le plus courant est celui-la — un compte deja mis en
 * service n'est jamais touche.
 *
 * CETTE FONCTION NE LEVE JAMAIS. Elle est appelee depuis un `finally`, ou une
 * exception remplacerait l'erreur d'origine par la sienne et ferait perdre le
 * diagnostic du parcours — la cause reelle deviendrait invisible. Elle rapporte
 * donc ses propres echecs, et l'erreur du parcours remonte intacte.
 *
 * CE QU'ELLE FAIT SI ELLE ECHOUE, ET POURQUOI ELLE AFFICHE LE MOT DE PASSE.
 * Sans cette fonction, un echec laisse le compte administrateur sur une valeur
 * que personne ne connait : l'operateur ne peut plus ouvrir de session, et il n'a
 * aucun moyen de retrouver le mot de passe — le seed ne le remet pas (il ne
 * touche pas au mot de passe d'un compte existant), et le parcours de
 * reinitialisation passe par un courriel que la configuration actuelle ne remet
 * pas. Le verrouillage serait donc definitif a court terme. C'est la seule raison
 * qui justifie d'ecrire la valeur ici : elle n'est affichee que si le compte a
 * ete touche, et seulement pour rendre le compte a son proprietaire.
 */
async function restoreAdminPassword(session: AdminSession): Promise<void> {
  if (!session.interimPassword) {
    return;
  }

  const interim = session.interimPassword;

  try {
    const response = await call('POST', '/auth/change-password', {
      token: session.token,
      body: {
        currentPassword: interim,
        newPassword: session.seedPassword,
        confirmPassword: session.seedPassword,
      },
    });

    if (response.status === 200) {
      session.interimPassword = null;
      console.log("  Mot de passe de l'administrateur remis a la valeur de backend/.env.");
      console.log(
        '  Le drapeau mustChangePassword, lui, reste tombe : le compte est utilisable tel quel.',
      );
      return;
    }

    reportInterimPassword(session, `la route a repondu ${response.status}`);
  } catch (error) {
    reportInterimPassword(session, error instanceof Error ? error.message : String(error));
  }
}

function reportInterimPassword(session: AdminSession, cause: string): void {
  console.log(`  ATTENTION — le mot de passe de l'administrateur n'a PAS ete remis (${cause}).`);
  console.log(`  Compte concerne           : ${session.email}`);
  console.log(`  Mot de passe actuel       : ${session.interimPassword}`);
  console.log('  A faire maintenant        : mettre cette valeur dans backend/.env');
  console.log('                              (SEED_ADMIN_PASSWORD), ou la changer depuis');
  console.log("                              l'ecran de compte. Le compte fonctionne : le");
  console.log('                              drapeau mustChangePassword est deja tombe.');
}

/**
 * Suppression en bloc, DANS L'ORDRE IMPOSE PAR LES CLES ETRANGERES.
 *
 * Cet ordre n'est pas une precaution de style, il est lu dans le schema :
 *
 *  - `Payment.invoice` et `InvoiceItem.invoice` sont en cascade, mais on les
 *    retire explicitement pour que le nettoyage reste lisible ;
 *  - `Invoice.quote` et `Invoice.project` sont en `SetNull` : les factures
 *    partent donc AVANT les projets et les devis ;
 *  - `Quote.client`, `Invoice.client` et `Project.client` sont en `Restrict` :
 *    les dossiers clients ne peuvent partir qu'EN DERNIER ;
 *  - `Activity.project` et `Activity.client` sont en cascade, mais l'ordre
 *    explicite evite d'en dependre ;
 *  - `AuditLog` ne porte AUCUNE cle etrangere vers ces entites (`entityType` et
 *    `entityId` sont de simples chaines) : il ne peut donc jamais bloquer, et
 *    n'est retire que pour ne pas laisser de bruit dans une base partagee ;
 *  - `User.client` est en `SetNull` : les comptes partent avant les dossiers.
 *
 * La fonction est IDEMPOTENTE : supprimer une ligne deja partie est sans effet.
 * C'est ce qui permet de la rappeler pour reprendre une execution interrompue.
 */
async function removeInOrder(prisma: PrismaClient, ids: Gathered): Promise<void> {
  const at = (list: string[]) => ({ in: list });

  if (ids.invoiceIds.length > 0) {
    await prisma.payment.deleteMany({ where: { invoiceId: at(ids.invoiceIds) } });
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: at(ids.invoiceIds) } });
    await prisma.invoice.deleteMany({ where: { id: at(ids.invoiceIds) } });
  }

  if (ids.projectIds.length > 0) {
    await prisma.projectMember.deleteMany({ where: { projectId: at(ids.projectIds) } });
    await prisma.task.deleteMany({ where: { projectId: at(ids.projectIds) } });
    await prisma.milestone.deleteMany({ where: { projectId: at(ids.projectIds) } });
    await prisma.project.deleteMany({ where: { id: at(ids.projectIds) } });
  }

  if (ids.quoteIds.length > 0) {
    await prisma.quoteItem.deleteMany({ where: { quoteId: at(ids.quoteIds) } });
    await prisma.quote.deleteMany({ where: { id: at(ids.quoteIds) } });
  }

  if (ids.prospectIds.length > 0) {
    await prisma.leadStatusHistory.deleteMany({ where: { prospectId: at(ids.prospectIds) } });
    await prisma.prospect.deleteMany({ where: { id: at(ids.prospectIds) } });
  }

  if (ids.contactRequestIds.length > 0) {
    await prisma.contactRequest.deleteMany({ where: { id: at(ids.contactRequestIds) } });
  }

  // Les documents ont deja ete retires par l'API, qui les marque supprimes et
  // efface l'objet. Ce passage est le filet : si une etape a echoue avant ses
  // `DELETE`, la ligne ne doit pas rester.
  if (ids.documentIds.length > 0) {
    await prisma.document.deleteMany({ where: { id: at(ids.documentIds) } });
  }

  // Les activites et les journaux d'audit sont rattaches par `actorId` : ils
  // doivent partir AVANT les comptes, sinon on effacerait les visages en
  // laissant subsister ce qu'ils ont fait.
  if (ids.userIds.length > 0) {
    await prisma.activity.deleteMany({ where: { actorId: at(ids.userIds) } });
    await prisma.auditLog.deleteMany({ where: { actorId: at(ids.userIds) } });
    await prisma.user.deleteMany({ where: { id: at(ids.userIds) } });
  }

  if (ids.clientIds.length > 0) {
    await prisma.activity.deleteMany({ where: { clientId: at(ids.clientIds) } });
    await prisma.client.deleteMany({ where: { id: at(ids.clientIds) } });
  }
}

/**
 * Le nombre de lignes de cette execution qui subsistent. Doit valoir zero.
 *
 * Les documents sont volontairement EXCLUS : leur ligne est conservee par
 * conception apres un `DELETE` (un paiement peut la referencer comme
 * justificatif), donc la compter ici signalerait comme reste ce qui est voulu.
 */
async function countLeftovers(prisma: PrismaClient, ids: Gathered): Promise<number> {
  const at = (list: string[]) => ({ in: list });
  const checks: Array<Promise<number>> = [];

  if (ids.invoiceIds.length > 0) {
    checks.push(prisma.invoice.count({ where: { id: at(ids.invoiceIds) } }));
  }
  if (ids.quoteIds.length > 0) {
    checks.push(prisma.quote.count({ where: { id: at(ids.quoteIds) } }));
  }
  if (ids.projectIds.length > 0) {
    checks.push(prisma.project.count({ where: { id: at(ids.projectIds) } }));
  }
  if (ids.userIds.length > 0) {
    checks.push(prisma.user.count({ where: { id: at(ids.userIds) } }));
  }
  if (ids.clientIds.length > 0) {
    checks.push(prisma.client.count({ where: { id: at(ids.clientIds) } }));
  }
  if (ids.prospectIds.length > 0) {
    checks.push(prisma.prospect.count({ where: { id: at(ids.prospectIds) } }));
  }
  if (ids.contactRequestIds.length > 0) {
    checks.push(prisma.contactRequest.count({ where: { id: at(ids.contactRequestIds) } }));
  }

  const counts = await Promise.all(checks);
  return counts.reduce((sum, count) => sum + count, 0);
}

/**
 * Balayage des restes d'une execution ANTERIEURE interrompue.
 *
 * L'AGE DE GARDE EST LE POINT CRITIQUE, et il a ete paye une fois. La premiere
 * version du fichier e2e coupait a « anterieur a mon demarrage », en croyant que
 * cela suffisait a exclure une execution vivante. C'est faux : une AUTRE
 * execution demarree trente secondes plus tot a tous ses objets anterieurs. La
 * lancer deux fois faisait donc que la seconde SUPPRIMAIT les comptes de la
 * premiere, en plein parcours, et le symptome apparaissait tres loin de sa
 * cause. Un delai de garde de trente minutes leve l'ambiguite, cette execution
 * durant moins de deux minutes.
 *
 * Le balayage est borne au marqueur de ce script : il ne peut donc pas toucher
 * aux donnees d'une autre suite, qui porte d'autres prefixes.
 */
async function sweepStale(prisma: PrismaClient): Promise<void> {
  const cutoff = new Date(RUN - STALE_AFTER_MS);

  const staleUsers = await prisma.user.findMany({
    where: { email: { startsWith: `${MARKER}-` }, createdAt: { lt: cutoff } },
    select: { id: true },
  });

  const staleClients = await prisma.client.findMany({
    where: { companyName: { startsWith: MARKER }, createdAt: { lt: cutoff } },
    select: { id: true },
  });

  if (staleUsers.length === 0 && staleClients.length === 0) {
    return;
  }

  const clientIds = staleClients.map((client) => client.id);

  // Les dependances du dossier doivent partir avec lui : `Quote.client`,
  // `Invoice.client` et `Project.client` sont en Restrict, donc un dossier ne
  // peut pas etre supprime tant qu'ils sont la.
  const [projects, quotes, invoices] =
    clientIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          prisma.project.findMany({ where: { clientId: { in: clientIds } }, select: { id: true } }),
          prisma.quote.findMany({ where: { clientId: { in: clientIds } }, select: { id: true } }),
          prisma.invoice.findMany({ where: { clientId: { in: clientIds } }, select: { id: true } }),
        ]);

  const resume = emptyGathered();
  resume.userIds.push(...staleUsers.map((user) => user.id));
  resume.clientIds.push(...clientIds);
  resume.projectIds.push(...projects.map((project) => project.id));
  resume.quoteIds.push(...quotes.map((quote) => quote.id));
  resume.invoiceIds.push(...invoices.map((invoice) => invoice.id));

  console.log(
    `\nReprise : ${staleUsers.length} compte(s) et ${staleClients.length} dossier(s) d'une ` +
      'execution interrompue, supprimes avant de commencer.',
  );

  await removeInOrder(prisma, resume);
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Un montant tel que le serveur l'a envoye, ramene a deux decimales.
 *
 * Les colonnes monetaires sont des `Decimal` : `JSON.stringify` les serialise en
 * CHAINE, et `Decimal.toString()` retire les zeros inutiles — « 2400 » pour
 * 2400,00. Comparer les chaines brutes serait fragile pour une raison qui n'a
 * rien a voir avec l'arithmetique testee.
 */
function money(value: unknown): string {
  return Number(value).toFixed(2);
}

/**
 * La forme d'une reference sequentielle : `PREFIX-ANNEE-NNNN`.
 *
 * C'est ce motif — et pas seulement « la colonne est remplie » — qui prouve que
 * la table `Counter` est traversee : `NNNN` vient d'un compteur incremente
 * atomiquement, pas d'un identifiant aleatoire ni d'une date.
 */
function assertReference(reference: string, prefix: string, what: string): void {
  const pattern = new RegExp(`^${prefix}-\\d{4}-\\d{4}$`);
  if (!pattern.test(reference)) {
    throw new Error(
      `${what} : la reference « ${reference} » ne suit pas le motif ${prefix}-ANNEE-NNNN. ` +
        'Une reference qui ne vient pas du compteur signale que la transaction de ' +
        "numerotation n'a pas ete traversee.",
    );
  }
}

/** Une adresse, reduite a ce qui suffit a reconnaitre de qui l'on parle. */
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '(adresse masquee)';
  return `${email.slice(0, 3)}***${email.slice(at)}`;
}

/** L'hote d'une URL signee : la signature reste dans ses parametres, pas ici. */
function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(hote illisible)';
  }
}

/** Traduit une panne reseau en cause probable, plutot qu'en code brut. */
function describeNetworkError(error: unknown): string {
  const code =
    (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof Error && error.name === 'TimeoutError') {
    return (
      "le delai d'attente est depasse. Sur l'offre gratuite, un service endormi met " +
      'couramment quarante a soixante secondes a redemarrer : relancer suffit alors.'
    );
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return "le nom du service ne se resout pas. Verifier l'adresse, caractere par caractere.";
  }
  if (code === 'ECONNREFUSED') {
    return "la connexion est refusee : le service n'ecoute pas sur ce port.";
  }
  if (code === 'CERT_HAS_EXPIRED' || message.includes('certificate')) {
    return 'le certificat TLS est refuse. Verifier le domaine du service.';
  }
  return `${message}${code ? ` (${code})` : ''}`;
}

/**
 * Lit un fichier d'env au format `CLE=valeur`.
 *
 * Les guillemets qui entourent la valeur sont retires : les hebergeurs et les
 * editeurs les conservent volontiers tels qu'ils ont ete saisis, et un secret
 * entoure de guillemets est un secret qui ne fonctionne pas. C'est le meme piege
 * que celui corrige dans `parseSender`.
 */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    fail(
      `Fichier introuvable : ${path}\n` +
        'Ce script lit les identifiants dans backend/.env, jamais dans .env.render. ' +
        'Si .env manque, le copier depuis backend/.env.example.',
    );
  }

  const result: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    result[name] = unquote(trimmed.slice(separator + 1).trim());
  }
  return result;
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && first === value[value.length - 1]) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exitCode = 1;
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(`\n${'-'.repeat(78)}`);
  console.error('ECHEC');
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    '\nLe nettoyage a deja eu lieu (voir ci-dessus). Corriger la cause, puis relancer : ' +
      'le parcours est rejouable tel quel.',
  );
  process.exitCode = 1;
});
