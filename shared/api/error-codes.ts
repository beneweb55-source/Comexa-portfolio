/**
 * LES CODES D'ERREUR DE L'API — miroir du backend, a l'usage du frontend.
 *
 * Aucun import. Ce fichier est le pendant de `shared/api/envelope.ts` : la
 * forme de l'erreur est dans `envelope.ts`, ses VALEURS sont ici.
 *
 * PROVENANCE :
 *
 *   | Ce qui suit            | Fichier source                                     |
 *   |------------------------|----------------------------------------------------|
 *   | `ErrorCode` (18)       | backend/src/common/errors/app-error.ts              |
 *   | `RESOURCE_ERROR_CODES` | mesure sur backend/src/ (voir la commande plus bas) |
 *
 * En cas de desaccord entre ce fichier et le backend, LE BACKEND A RAISON.
 */

/**
 * Les codes GENERAUX, fermes, et c'est delibere.
 *
 * Ils viennent d'un `enum ErrorCode` du backend : l'ensemble est fixe par
 * construction, donc les enumerer ici est exact. Le frontend peut les traiter
 * exhaustivement — c'est utile pour la poignee de cas qui demandent une
 * reaction GLOBALE plutot qu'un message a l'ecran (reauthentifier sur
 * `UNAUTHENTICATED`, faire patienter sur `RATE_LIMITED`).
 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_INVITED'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'REFRESH_TOKEN_REUSED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

/** Les memes, en valeur, pour un test ou une validation de formulaire. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_INVITED',
  'PASSWORD_CHANGE_REQUIRED',
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'REFRESH_TOKEN_REUSED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'UNPROCESSABLE',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const satisfies readonly ErrorCode[];

/**
 * Les codes SPECIFIQUES a une ressource : `PROJECT_NOT_FOUND`,
 * `QUOTE_EXPIRED`, `LAST_ADMIN_PROTECTED`, ...
 *
 * POURQUOI CE N'EST PAS UNE UNION FERMEE, ET POURQUOI C'EST IMPORTANT.
 *
 * Contrairement aux codes generaux, cet ensemble est OUVERT : le backend en
 * ajoute un quand un cas metier apparait, et il le fait sans toucher au
 * frontend. Une union fermee inviterait un `switch` exhaustif cote frontend,
 * qui casserait a la COMPILATION du frontend le jour ou le backend enrichit
 * son catalogue — c'est-a-dire a un moment ou rien n'est casse en realite. Le
 * type reste donc `string` : on teste `if (code === 'QUOTE_EXPIRED')`, on ne
 * pretend pas avoir epuise la liste.
 *
 * CE TABLEAU EST UNE REFERENCE, JAMAIS UN CONTRAT — ET VOICI LA MESURE QUI LE
 * PROUVE, parce qu'une mise en garde sans chiffre ne convainc personne.
 *
 * Les trois commandes ci-dessous ont ete executees sur ce depot :
 *
 *   1. La forme litterale sur UNE ligne (`AppException.notFound('CODE'`)
 *      trouve 40 codes. C'est ce que ce fichier contenait avant, et c'etait
 *      faux par construction : la plupart des appels du depot ecrivent le code
 *      sur la ligne SUIVANTE.
 *   2. La commande corrigee ci-dessous, qui traverse les retours a la ligne,
 *      en trouve 132. Meme depot, meme instant : 92 codes de plus, zero retire.
 *   3. Cinq codes ECHAPPENT ENCORE a toute recherche textuelle, et pas par
 *      accident : ils ne sont pas ecrits a cote de `AppException`. Trois
 *      sortent d'un `switch` qui les RETOURNE (`quoteDecisionBlocker`, dans
 *      `quotes/quote-state.ts` : `QUOTE_ALREADY_REJECTED`, `QUOTE_CANCELLED`,
 *      `QUOTE_NOT_SENT`), et deux d'un ternaire (`identity-rules.ts` :
 *      `SELF_DELETE_FORBIDDEN`, `SELF_SUSPEND_FORBIDDEN`).
 *
 * Total mesure : 137 codes distincts pour 204 sites d'appel. Les deux chiffres
 * ne se mesurent PAS de la meme facon, et la commande de regeneration ci-dessous
 * ne les donne pas tels quels : elle atteint 198 de ces 204 sites, et 132 des 137
 * codes. Les six appels qu'elle manque passent leur code autrement qu'en clair
 * sur la meme ligne — un retour a la ligne (trois appels dans `auth.service.ts`,
 * un dans `identity-rules.ts`) ou une variable (`blocker`, deux fois dans
 * `quotes.service.ts`).
 *
 * Les 204 sont le nombre d'appels aux QUATRE fabriques que cette commande vise
 * (`notFound`, `conflict`, `unprocessable`, `badRequest`) ; `forbidden` et
 * `unauthenticated` ne figurent pas dans sa liste, et leurs appels ne sont donc
 * comptes nulle part ici.
 *
 * Le fosse entre 40 et 137 n'est pas une erreur de frappe : c'est la difference
 * entre ce qu'un grep sait voir et ce que le code fait.
 *
 * La consequence pratique pour le frontend est celle deja enoncee : `error.code`
 * se teste, il ne s'enumere pas. Ce tableau sert a la documentation, aux tests
 * et aux ecrans de demonstration.
 *
 * CONVENTION DE NOMMAGE, a connaitre pour traiter un code jamais vu :
 *   - `<RESSOURCE>_NOT_FOUND`  -> 404. Un porteur hors perimetre recoit ce code
 *     et non un 403 : cela ne revele pas l'existence de la ligne.
 *   - `<RESSOURCE>_ALREADY_<ETAT>` ou `<RESSOURCE>_CODE_TAKEN` -> 409.
 *   - `<RESSOURCE>_<CONTRAINTE>` (ex. `LAST_ADMIN_PROTECTED`) -> 422.
 *
 * REGENERATION DE CETTE LISTE — depuis `backend/` :
 *
 *   grep -rzoE "AppException\.(notFound|conflict|unprocessable|badRequest)\([[:space:]]*'[A-Z_]+'" \
 *     --exclude-dir=generated src \
 *     | tr '\0' '\n' | grep -oE "'[A-Z_]+'" | tr -d "'" | sort -u
 *
 * Les quatre pieces sont necessaires : `-z` fait de chaque FICHIER un seul
 * enregistrement, ce qui permet a `[[:space:]]*` de franchir le retour a la
 * ligne ; `tr '\0' '\n'` retablit des lignes ; `grep -oE` ne garde que les
 * litteraux entre apostrophes, ce qui ecarte au passage les fragments
 * (`AppException.conflict(`) laisses par le decoupage ; le second `tr` retire
 * les apostrophes elles-memes.
 *
 * PIEGE, PAYE UNE FOIS, ET LA RAISON DE L'ABSENCE DE `sed` CI-DESSUS : un
 * commentaire ne doit jamais contenir une etoile immediatement suivie d'une
 * barre oblique. Cette sequence le FERME, et tout ce qui suit dans la prose est
 * alors lu comme du code — ici, une erreur de syntaxe a la ligne meme de la
 * commande. La premiere version de cette commande utilisait un `sed` dont le
 * motif comportait un point-etoile suivi d'un separateur en barre oblique,
 * c'est-a-dire la sequence interdite, formee sans le vouloir. La lecon vaut
 * pour quiconque edite ce fichier.
 *
 * Cette commande ne voit QUE la forme litterale. Les cinq codes du point 3
 * ci-dessus lui echappent, et tout code construit dans une variable echappera
 * de meme. C'est une raison de plus pour ne pas faire de cette liste un contrat.
 */
export const RESOURCE_ERROR_CODES = [
  // Contenu public
  'SERVICE_NOT_FOUND',
  'PACKAGE_NOT_FOUND',
  'CASE_STUDY_NOT_FOUND',
  'CONTENT_NOT_FOUND',
  'CATEGORY_NOT_FOUND',
  'SLUG_INVALID',
  'SLUG_RESERVED',
  'SLUG_TAKEN',
  'MODIFICATION_REQUEST_NOT_FOUND',
  'MODIFICATION_ALREADY_DECIDED',

  // CRM : visiteur -> prospect -> client
  'CONTACT_REQUEST_NOT_FOUND',
  'CONTACT_REQUEST_ALREADY_CONVERTED',
  'CONTACT_REQUEST_CONVERT',
  'PROSPECT_NOT_FOUND',
  'PROSPECT_ALREADY_CONVERTED',
  'PROSPECT_CONVERTED_NOT_DELETABLE',
  'PROSPECT_LOST_NOT_CONVERTIBLE',
  'PROSPECT_OWNER_NOT_FOUND',
  'PROSPECT_STATUS_CHANGED',
  'LEAD_STATUS_TRANSITION_INVALID',
  'LEAD_STATUS_UNCHANGED',
  'CLIENT_NOT_FOUND',
  'CLIENT_ACCOUNT_MANAGER_NOT_FOUND',
  'CONTACT_NOT_FOUND',

  // Projets
  'PROJECT_NOT_FOUND',
  'PROJECT_CODE_TAKEN',
  'PROJECT_CLIENT_NOT_FOUND',
  'PROJECT_MEMBER_NOT_FOUND',
  'PROJECT_USER_NOT_FOUND',
  'PROJECT_MANAGER_MUST_BE_MEMBER',
  'PROJECT_STATUS_TRANSITION_REFUSED',
  'PROJECT_STATUS_UNCHANGED',

  // Taches
  'TASK_NOT_FOUND',
  'TASK_ASSIGNEE_IS_CLIENT',
  'TASK_ASSIGNEE_NOT_FOUND',
  'TASK_ASSIGNEE_UNCHANGED',
  'TASK_CLOSED_NOT_EDITABLE',
  'TASK_EDIT_CONFLICT',
  'TASK_HAS_OPEN_SUBTASKS',
  'TASK_HAS_SUBTASKS',
  'TASK_MILESTONE_NOT_FOUND',
  'TASK_PARENT_CLOSED',
  'TASK_PARENT_NOT_FOUND',
  'TASK_STATUS_CONFLICT',
  'TASK_STATUS_TRANSITION_REFUSED',
  'TASK_STATUS_UNCHANGED',

  // Jalons
  'MILESTONE_NOT_FOUND',
  'MILESTONE_EDIT_CONFLICT',
  'MILESTONE_HAS_TASKS',
  'MILESTONE_REACHED_NOT_DELETABLE',
  'MILESTONE_STATUS_TRANSITION_REFUSED',

  // Temps passe
  'TIME_ENTRY_NOT_FOUND',
  'TIME_ENTRY_AUTHOR_IS_CLIENT',
  'TIME_ENTRY_AUTHOR_NOT_FOUND',
  'TIME_ENTRY_DELETE_CONFLICT',
  'TIME_ENTRY_EDIT_CONFLICT',
  'TIME_ENTRY_FUTURE_DAY',
  'TIME_INVALID_MINUTES',

  // Devis
  'QUOTE_NOT_FOUND',
  'QUOTE_EXPIRED',
  'QUOTE_ALREADY_ACCEPTED',
  'QUOTE_ALREADY_REJECTED',
  'QUOTE_CANCELLED',
  'QUOTE_NOT_SENT',
  'QUOTE_EMPTY',
  'QUOTE_LINES_INCONSISTENT',
  'QUOTE_CLIENT_NOT_FOUND',
  'QUOTE_PROSPECT_NOT_FOUND',
  'QUOTE_TARGET_INVALID',
  'QUOTE_NOT_DELETABLE',
  'QUOTE_NOT_EDITABLE',
  'QUOTE_NOT_INVOICEABLE',
  'QUOTE_NOT_SENDABLE',
  'QUOTE_NOT_VIEWABLE',

  // Factures et paiements
  'INVOICE_NOT_FOUND',
  'INVOICE_NOT_CANCELLABLE',
  'INVOICE_NOT_DELETABLE',
  'INVOICE_NOT_PAYABLE',
  'INVOICE_NOT_SENDABLE',
  'INVOICE_DUE_DATE_BEFORE_ISSUE',
  'PAYMENT_NOT_FOUND',
  'PAYMENT_ALREADY_REMOVED',
  'PAYMENT_AMOUNT_INVALID',
  'PAYMENT_EXCEEDS_BALANCE',
  'PAYMENT_PROOF_NOT_FOUND',

  // Documents et stockage
  'DOCUMENT_NOT_FOUND',
  'DOCUMENT_ATTACHMENT_MISMATCH',
  'DOCUMENT_ATTACHMENT_REQUIRED',
  'FILE_REQUIRED',
  'EMPTY_FILE',
  'INVALID_FILE_SIZE',
  'UNSUPPORTED_FILE_TYPE',
  'STORAGE_OBJECT_NOT_FOUND',
  'INVALID_STORAGE_KEY',
  'INVALID_STORAGE_PREFIX',
  'STORAGE_SIGNED_URL_UNSUPPORTED',
  'STORAGE_STREAM_UNSUPPORTED',
  'STORAGE_WRITE_INCOMPLETE',

  // Messagerie et notifications
  'CONVERSATION_NOT_FOUND',
  'CONVERSATION_NOTHING_TO_UPDATE',
  'CONVERSATION_PARTICIPANT_NOT_FOUND',
  'CONVERSATION_PARTICIPANT_UNKNOWN',
  'CONVERSATION_WITHOUT_PARTICIPANT',
  'MESSAGE_ATTACHMENT_UNKNOWN',
  'MESSAGE_CURSOR_INVALID',
  'MESSAGE_REPLY_TARGET_NOT_FOUND',
  'NOTIFICATION_NOT_FOUND',

  // Comptes, roles, sessions
  'USER_NOT_FOUND',
  'USER_ALREADY_ACTIVE',
  'USER_ALREADY_SUSPENDED',
  'LAST_ADMIN_PROTECTED',
  'SELF_ADMIN_REMOVAL_FORBIDDEN',
  'SELF_DELETE_FORBIDDEN',
  'SELF_SUSPEND_FORBIDDEN',
  'CLIENT_ROLE_REQUIRED',
  'CLIENT_SCOPE_STILL_ATTACHED',
  'ROLE_NOT_FOUND',
  'ROLE_IMMUTABLE',
  'UNKNOWN_ROLE',
  'UNKNOWN_PERMISSION',
  'SESSION_NOT_FOUND',
  'WEAK_PASSWORD',
  'PASSWORD_MISMATCH',
  'PASSWORD_UNCHANGED',
  'EMAIL_ALREADY_USED',
  'CONCURRENT_MODIFICATION',

  // Rapports et parametres
  'REPORT_NOT_FOUND',
  'REPORT_PROJECT_NOT_FOUND',
  'REPORT_PERIOD_INVALID',
  'REPORT_PERIOD_AMBIGUOUS',
  'REPORT_PERIOD_INCOMPLETE',
  'REPORT_TYPE_UNSUPPORTED',
  'INVALID_PERIOD',
  'SETTING_VALUE_INVALID',
  'SETTING_KEY_INVALID',
  'SETTING_KEY_DUPLICATED',
  'SETTING_VALUE_TOO_LARGE',
] as const;

/**
 * La correspondance STATUT -> code general, pour le seul cas ou le frontend a
 * besoin du statut plutot que du code : un intermediaire qui laisse passer la
 * reponse (proxy, cache) sans lire le corps.
 *
 * Ces valeurs sont lues dans `app-error.ts` : ce sont celles des fabriques
 * statiques (`notFound` -> 404, `forbidden` -> 403, `conflict` -> 409,
 * `unprocessable` -> 422, `badRequest` -> 400, `unauthenticated` -> 401). Les
 * codes qui n'y figurent pas (verrouillage de compte, quota, panne) portent un
 * statut decide par le filtre d'exceptions : lire `error.code` reste la seule
 * facon fiable de savoir quoi faire.
 */
export const ERROR_STATUS_HINTS: Readonly<Partial<Record<ErrorCode, number>>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
};
