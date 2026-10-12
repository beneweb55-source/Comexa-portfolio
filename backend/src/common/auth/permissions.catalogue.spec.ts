import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RoleCode } from '../../generated/prisma/enums.js';
import {
  ALL_PERMISSION_CODES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  parsePermissionCode,
} from './permissions.catalogue.js';
import { SCOPE_ANY, SCOPE_ASSIGNED, SCOPE_CLIENT, SCOPE_OWN, SCOPE_PERSONAL } from './principal.js';

/**
 * LE CATALOGUE CONTRE SON USAGE REEL.
 *
 * -----------------------------------------------------------------------------
 * POURQUOI CE FICHIER EXISTE
 * -----------------------------------------------------------------------------
 * `src/common/decorators/auth.decorators.ts` annoncait, en commentaire, que
 * « `permissions.catalogue.spec.ts` verifie que tous les codes references par
 * les controleurs existent reellement ». CE FICHIER N'EXISTAIT PAS. L'annonce
 * etait donc fausse, et c'est la pire des situations : un trou d'outillage qui
 * se presente comme un filet de securite. Personne ne verifie ce qu'un
 * commentaire affirme etre verifie.
 *
 * Le defaut qu'il fallait rendre impossible est precis, et il est SILENCIEUX.
 * Un code mal orthographie dans un decorateur — `quote:write:any` ecrit
 * `quote:writes:any`, ou `project:read:own` ecrit `project:read:owner` — ne
 * produit aucune erreur au demarrage : le catalogue ignore simplement ce code,
 * `PermissionsGuard` ne le trouve dans aucun role, et la route repond 403 a
 * TOUT LE MONDE, y compris a l'administrateur. Le symptome observable est
 * « l'administrateur ne peut pas faire X », ce qui n'oriente pas vers une faute
 * de frappe dans un decorateur. Le seul endroit ou l'erreur est visible est un
 * test qui compare les deux listes.
 *
 * -----------------------------------------------------------------------------
 * CE QUE CE FICHIER VERIFIE — ET CE QU'IL NE VERIFIE PAS
 * -----------------------------------------------------------------------------
 * VERIFIE, par lecture statique du code de production :
 *
 *  1. chaque code passe a `@RequirePermissions(...)` ou
 *     `@RequireAnyPermission(...)` existe au catalogue ;
 *  2. chaque code derive d'un appel `requireScope('resource', 'action', [...])`
 *     ENTIEREMENT LITTERAL existe au catalogue ;
 *  3. chaque code accorde a un role par `ROLE_PERMISSIONS` existe au catalogue ;
 *  4. chaque code du catalogue est canonique : minuscules, trois segments, et un
 *     `scope` qui appartient au vocabulaire declare — SIX portees, et non les
 *     quatre que `principal.ts` nomme. Voir `DECLARED_SCOPES` ;
 *  5. `ROLE_PERMISSIONS` couvre exactement les roles de l'enum `RoleCode` — un
 *     role ajoute a l'enum et oublie ici n'aurait silencieusement aucun droit.
 *
 * NE VERIFIE PAS, et il faut le dire plutot que de laisser croire le contraire :
 *
 *  - les codes atteints par une CONSTANTE. Le balayage est textuel : il ne
 *    resout pas `ACTIONS[action]` de `prospect-scope.ts`, ni une liste de
 *    portees nommee `PROJECT_READ_ORDER`. Ces appels sont ignores, pas valides.
 *    Un code faux cache derriere une constante passe donc ce fichier ;
 *  - `policy.has('...')`. Ce n'est pas un decorateur et la methode est aussi
 *    celle d'un `Set` et d'un `Map` : `.has('conversation:123')` sur un salon
 *    socket.io ressemble a un code de permission, et le balayer produirait de
 *    faux positifs la ou il faut de la precision ;
 *  - les codes accordes directement en base, hors `ROLE_PERMISSIONS` — une
 *    ligne ecrite a la main dans `RolePermission` par une migration. Le seed
 *    part de `ROLE_PERMISSIONS`, mais rien n'empeche une insertion manuelle.
 *
 * La conclusion honnete est que ce fichier ferme le trou annonce — le point 1,
 * celui des controleurs — et deux autres par la meme occasion. Il ne remplace
 * pas un controle a l'execution : `PermissionsGuard` reste la seule barriere
 * reelle, ce fichier ne fait que rendre une erreur de frappe bruyante.
 */

const THIS_DIR = dirname(fileURLToPath(import.meta.url));

/** La racine `src/`, d'ou part le balayage. */
const SRC_ROOT = resolve(THIS_DIR, '..', '..');

/**
 * Dossiers jamais balayes.
 *
 * `generated` est le client Prisma engendre : des milliers de lignes de code
 * machine, qui nomment des modeles et des enums, et ou une chaine de la forme
 * `resource:action:scope` n'a aucune raison d'apparaitre — mais un faux positif
 * y serait illisible. Le balayer coute cher et n'apprend rien.
 *
 * `node_modules` n'est pas sous `src/` aujourd'hui ; le filtre est la pour que
 * ce test ne devienne pas un parcours de `node_modules` le jour ou quelqu'un
 * deplace le point de depart.
 */
const SKIPPED_DIRS = new Set(['node_modules', 'generated', 'dist']);

/**
 * Les specs eux-memes sont exclus, et ce n'est pas un detail.
 *
 * Un test a le DROIT de nommer un code absent du catalogue : c'est meme la
 * facon normale de verifier qu'une absence est bien une absence. `billing-access`
 * est accompagne d'un test qui documente l'absence de `quote:accept:any`. Inclure
 * les specs ferait donc echouer ce fichier sur des tests justes — et la reaction
 * previsible serait d'affaiblir le balayage, c'est-a-dire de perdre exactement
 * ce qu'il surveille.
 */
function isScannable(name: string): boolean {
  return name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts');
}

/** Tous les fichiers `.ts` de production sous `src/`, recursivement. */
function collectSourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) {
      continue;
    }

    const full = join(directory, entry.name);

    if (entry.isDirectory()) {
      collectSourceFiles(full, found);
      continue;
    }

    if (isScannable(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

/** Chemin relatif a `src/`, en separateurs `/`, pour un message lisible. */
function label(absolutePath: string): string {
  return relative(SRC_ROOT, absolutePath).replaceAll('\\', '/');
}

interface PermissionUse {
  /** Chemin relatif du fichier fautif, ou le nom du role. */
  file: string;
  /** Le code tel qu'il est ecrit. */
  code: string;
}

interface ScanResult {
  /** Nombre de fichiers reellement lus — garde-fou contre un balayage vide. */
  filesScanned: number;
  /** Codes lus dans un decorateur, avec leur fichier. */
  decoratorUses: PermissionUse[];
  /** Codes derives d'un `requireScope` litteral, avec leur fichier. */
  scopeUses: PermissionUse[];
}

/**
 * `@RequirePermissions('a:b:c', 'd:e:f')` et `@RequireAnyPermission('a:b:c')`.
 *
 * `[^)]*` suffit : aucun appel du projet ne contient de parenthese dans ses
 * arguments, et les separer sur plusieurs lignes ne gene pas — `.` ne traverse
 * pas un retour a la ligne, mais la classe de caracteres si.
 */
const DECORATOR_CALL = /@(?:RequirePermissions|RequireAnyPermission)\s*\(([^)]*)\)/g;

/**
 * `requireScope('project', 'manage', ['status'])`.
 *
 * Le troisieme argument doit etre un TABLEAU LITTERAL : c'est ce qui permet de
 * resoudre la liste des portees sans evaluer le fichier. Un appel dont le
 * troisieme argument est un identifiant (`PROJECT_READ_ORDER`) ne correspond
 * simplement pas, et est donc ignore — voir la liste des limites en tete.
 */
const REQUIRE_SCOPE_CALL = /requireScope\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(\[[^\]]*\])/g;

/** Chaine entre apostrophes, n'importe ou dans un fragment de code. */
const SINGLE_QUOTED = /'([^']*)'/g;

/**
 * Retire les COMMENTAIRES avant de balayer.
 *
 * Sans cette etape, le balayage lit la documentation autant que le code — et il
 * l'a fait : `modification-request.controller.ts` explique, en commentaire,
 * `@RequireAnyPermission('...:read:any', '...:read:own')` pour montrer la forme
 * attendue, et ce test a signale ces chaines d'ILLUSTRATION comme des codes
 * inconnus. Le controleur, lui, etait juste.
 *
 * Le faux positif n'est pas anodin : il accuse un fichier sain, et la reaction
 * naturelle est alors de « corriger » le fichier plutot que le test — c'est-a-dire
 * d'abimer une documentation exacte pour faire taire une mesure fausse.
 *
 * LIMITE ASSUMEE : ce decoupage est textuel. Un `//` a l'interieur d'une chaine
 * de caracteres (une URL `https://`) n'est pas traite, et un appel de decorateur
 * ecrit APRES du code sur la meme ligne (`x(); // @RequirePermissions('a:b:c')`)
 * resterait lu. Aucun des deux n'existe aujourd'hui dans le projet ; le jour ou
 * l'un apparait, c'est ici qu'il faudra regarder.
 */
function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, '');

  return withoutBlocks
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** Le nom d'une portee en clair, tel qu'il est passe a `requireScope`. */
const SCOPE_TOKENS: Record<string, string> = {
  SCOPE_ANY,
  SCOPE_OWN,
  SCOPE_ASSIGNED,
  SCOPE_CLIENT,
  SCOPE_PERSONAL,
};

/**
 * LE VOCABULAIRE REEL DES PORTEES — SIX VALEURS, PAS QUATRE.
 *
 * Ce test a d'abord ete ecrit avec les quatre constantes de `principal.ts`, et
 * il a echoue. Le catalogue, lui, etait juste : il contient bien deux portees de
 * plus, et c'est un choix de conception delibere, pas une faute de frappe.
 *
 * Les quatre premieres sont des PERIMETRES DE LIGNES. Elles repondent a « quelles
 * lignes ce porteur voit-il », et se posent dans le `where` Prisma :
 *
 *   any       toutes les lignes               `{}`
 *   own       les siennes                     `{ownerId: porteur}`
 *   assigned  celles qui lui sont confiees    `{assigneeId: porteur}`
 *   client    celles de son dossier client    `{clientId: policy.clientId}`
 *
 * Les deux suivantes sont des CAPACITES FINE, et c'est une autre nature. Elles
 * ne filtrent aucune ligne : elles separent deux pouvoirs qu'un meme role
 * detient par ailleurs. `project:manage:status` (« deplacer le projet d'etat »)
 * et `project:manage:team` (« affecter et retirer des membres ») sont accordes au
 * chef de projet, et les tenir separes est precisement ce qui permet de confier
 * a un developpeur l'un sans l'autre :
 *
 *   policy.requireScope('project', 'manage', ['status'])   // projects.service.ts:373
 *   policy.requireScope('project', 'manage', ['team'])     // projects.service.ts:554
 *
 * Un tableau a UN element a ici son sens litteral : `['status']` ne demande pas
 * la portee la plus large disponible, il demande EXACTEMENT celle-la. Ce n'est
 * donc pas l'ordre « du plus large au plus etroit » que `widestScope` attend.
 *
 * POURQUOI C'EST ECRIT ICI ET PAS DANS `principal.ts` : ces deux chaines ne sont
 * employees que par le domaine « projets », et leur donner une constante
 * partagee les presenterait comme des perimetres au meme titre que `own` — ce
 * qu'elles ne sont pas. Les nommer un jour est une bonne idee, mais c'est une
 * decision de conception du domaine projets, pas une correction de ce test.
 *
 * AJOUTER UNE SEPTIEME PORTEE EST DONC UN GESTE DELIBERE. Si ce test echoue sur
 * une portee inconnue, la question n'est pas « comment le faire passer » mais
 * « cette portee filtre-t-elle des lignes, ou separe-t-elle une capacite ? » —
 * et la reponse determine si elle doit rejoindre `principal.ts`.
 *
 * SEPTIEME PORTEE, `personal` (2026-10) : DECISION PRISE, ET VOICI POURQUOI.
 * `task:read:personal` / `task:write:personal` FILTRENT DES LIGNES — les taches
 * personnelles du porteur, sans projet ni client. C'est donc un SCOPE_PERSONAL
 * de `principal.ts`, au meme titre que `own`. Mais il ne prend place dans aucun
 * ordre de precedence : `any` n'ouvre PAS l'espace personnel des autres, et la
 * composition se fait par OU dans `task-rules.ts` (`taskReadWhereFor` /
 * `taskWriteWhereFor`). Ce n'est pas une capacite de plus dans la grammaire
 * existante : c'est un ensemble de lignes a part, et la grammaire le dit.
 */
const DECLARED_SCOPES = [
  SCOPE_ANY,
  SCOPE_OWN,
  SCOPE_ASSIGNED,
  SCOPE_CLIENT,
  SCOPE_PERSONAL,
  'team',
  'status',
] as const;

/**
 * Un fragment de code ne devient un candidat que s'il PORTE UN DEUX-POINTS.
 *
 * Sans ce filtre, tout mot entre apostrophes compterait comme un code de
 * permission. Avec lui, `'quote:writes:any'` est examine (et signale) alors
 * qu'un mot de commentaire ou un libelle ne l'est pas.
 */
function looksLikeCode(candidate: string): boolean {
  return candidate.includes(':');
}

/**
 * Resout les elements d'un tableau de portees litteral.
 *
 * Renvoie `null` des qu'un element n'est ni une chaine ni une constante de portee
 * connue : dans ce cas on ne sait pas lire l'appel, et deviner produirait
 * exactement le genre de faux signal qui fait desactiver un test. Ignorer est
 * une decision assumee, documentee en tete de fichier.
 */
function resolveScopeArray(arrayLiteral: string): string[] | null {
  const scopes: string[] = [];

  for (const element of arrayLiteral.slice(1, -1).split(',')) {
    const token = element.trim();

    if (token === '') {
      continue;
    }

    const literal = /^'([^']+)'$/.exec(token);

    if (literal) {
      const scope = literal[1];

      if (scope === undefined) {
        return null;
      }

      scopes.push(scope);
      continue;
    }

    const named = SCOPE_TOKENS[token];

    if (named === undefined) {
      return null;
    }

    scopes.push(named);
  }

  return scopes.length > 0 ? scopes : null;
}

/**
 * Le balayage, calcule UNE fois pour tous les tests.
 *
 * Les trois tests de la seconde section lisent le meme resultat : relire le
 * disque trois fois donnerait trois occasions d'obtenir trois reponses
 * differentes, et le garde-fou anti-balayage-vide porterait alors sur un
 * balayage et les assertions sur un autre.
 */
function scan(): ScanResult {
  const decoratorUses: PermissionUse[] = [];
  const scopeUses: PermissionUse[] = [];
  const files = collectSourceFiles(SRC_ROOT);

  for (const file of files) {
    const source = stripComments(readFileSync(file, 'utf8'));
    const where = label(file);

    for (const call of source.matchAll(DECORATOR_CALL)) {
      const args = call[1];

      if (args === undefined) {
        continue;
      }

      for (const quoted of args.matchAll(SINGLE_QUOTED)) {
        const code = quoted[1];

        if (code !== undefined && looksLikeCode(code)) {
          decoratorUses.push({ file: where, code });
        }
      }
    }

    for (const call of source.matchAll(REQUIRE_SCOPE_CALL)) {
      const [, resource, action, arrayLiteral] = call;

      if (resource === undefined || action === undefined || arrayLiteral === undefined) {
        continue;
      }

      const scopes = resolveScopeArray(arrayLiteral);

      if (scopes === null) {
        continue;
      }

      for (const scope of scopes) {
        scopeUses.push({ file: where, code: `${resource}:${action}:${scope}` });
      }
    }
  }

  return { filesScanned: files.length, decoratorUses, scopeUses };
}

const SCAN = scan();

describe('catalogue des permissions — coherence interne', () => {
  it('expose un catalogue non vide et un index qui le reflete', () => {
    const keys = Object.keys(PERMISSIONS);

    assert.ok(
      keys.length > 0,
      'Le catalogue est VIDE. Tous les gardes refuseraient alors chaque acces, et aucun test de ce ' +
        'fichier ne le verrait : une liste vide ne contient aucun code invalide.',
    );

    assert.deepEqual(
      [...ALL_PERMISSION_CODES].sort(),
      [...keys].sort(),
      "`ALL_PERMISSION_CODES` ne correspond plus aux cles de `PERMISSIONS`. L'index est un " +
        "`Object.keys` fige a l'evaluation : le rendre manuel le ferait diverger en silence.",
    );
  });

  it('ne contient que des codes canoniques : minuscules, trois segments, portee declaree', () => {
    const malformed: Array<{ file: string; code: string; why: string }> = [];
    const scopes = new Set<string>(DECLARED_SCOPES);
    const file = 'src/common/auth/permissions.catalogue.ts';

    for (const code of ALL_PERMISSION_CODES) {
      if (code !== code.toLowerCase()) {
        malformed.push({ file, code, why: 'contient une majuscule' });
        continue;
      }

      const { resource, action, scope } = parsePermissionCode(code);

      if (resource.trim() === '' || action.trim() === '') {
        malformed.push({ file, code, why: 'segment resource ou action vide' });
        continue;
      }

      if (!scopes.has(scope)) {
        malformed.push({
          file,
          code,
          why:
            `portee « ${scope} » hors du vocabulaire declare (${[...scopes].join(', ')}). ` +
            "Une portee inconnue n'est pas une faute d'orthographe a corriger ici : c'est une " +
            'decision a prendre. Si elle filtre des LIGNES, elle doit devenir une constante de ' +
            '`principal.ts` comme `own` ou `assigned`. Si elle separe une CAPACITE, elle rejoint ' +
            "`DECLARED_SCOPES` avec le commentaire qui l'explique.",
        });
      }
    }

    assert.deepEqual(malformed, []);
  });

  it("n'accorde a un role que des codes qui existent reellement", () => {
    const unknown: PermissionUse[] = [];

    for (const [role, grants] of Object.entries(ROLE_PERMISSIONS)) {
      // `ADMIN` vaut la chaine `'ALL'` : ce n'est pas une liste de codes, c'est
      // une decision d'architecture (« l'administrateur a tout »), et elle n'a
      // donc rien a verifier ici.
      if (grants === 'ALL') {
        continue;
      }

      for (const code of grants) {
        if (!(code in PERMISSIONS)) {
          unknown.push({ file: `ROLE_PERMISSIONS[${role}]`, code });
        }
      }
    }

    assert.deepEqual(
      unknown,
      [],
      'Un role se voit accorder un code absent du catalogue. La consequence est asymetrique et ' +
        'trompeuse : le role perd le droit vise ET garde tous les autres, donc le symptome est un ' +
        '403 sur une seule action, chez un seul role.',
    );
  });

  it("couvre exactement les roles declares par l'enum RoleCode", () => {
    assert.deepEqual(
      Object.keys(ROLE_PERMISSIONS).sort(),
      Object.keys(RoleCode).sort(),
      "L'enum `RoleCode` et `ROLE_PERMISSIONS` ne decrivent plus les memes roles. Un role present " +
        "dans l'enum mais absent ici n'a AUCUN droit : il s'authentifie, et chaque route lui " +
        "repond 403 — sans qu'aucune ligne de code ne soit fautive.",
    );
  });
});

describe('catalogue des permissions — usage reel dans le code de production', () => {
  /**
   * LE GARDE-FOU CONTRE LE BALAYAGE VIDE.
   *
   * C'est l'assertion la plus importante des trois, et la moins evidente. Les
   * deux tests suivants passent TRIOMPHALEMENT si le balayage ne lit rien : une
   * liste d'usages vide ne contient evidemment aucun code inconnu. Un renommage
   * de dossier, une extension `.mts`, un filtre trop strict, et ce fichier
   * deviendrait decoratif — c'est-a-dire exactement le probleme qu'il est ecrit
   * pour resoudre.
   *
   * Les seuils sont des PLANCHERS volontairement bas, pas des objectifs : ils ne
   * mesurent pas la qualite du code, ils repondent a « le balayage a-t-il
   * seulement tourne ? ». Le jour ou ils cassent, la bonne reaction est de
   * verifier le balayage, pas de baisser le nombre.
   */
  it('a bien lu le projet, et pas une liste vide', () => {
    assert.ok(
      SCAN.filesScanned > 50,
      `Le balayage n'a lu que ${SCAN.filesScanned} fichier(s) sous src/. Il ne parcourt donc pas ce ` +
        "qu'il croit parcourir, et les deux tests suivants ne prouveraient rien.",
    );

    assert.ok(
      SCAN.decoratorUses.length >= 30,
      `Le balayage n'a trouve que ${SCAN.decoratorUses.length} code(s) dans des decorateurs. Les ` +
        "controleurs en declarent bien davantage : la forme des appels a change, ou l'expression " +
        'de recherche ne correspond plus.',
    );

    assert.ok(
      SCAN.scopeUses.length > 0,
      "Aucun appel `requireScope` litteral n'a ete reconnu. Les perimetres sont peut-etre tous " +
        "derives de constantes — auquel cas ce n'est pas une panne, mais il faut alors elargir le " +
        'balayage, pas supprimer cette assertion sans le dire.',
    );
  });

  it('ne reference, dans les decorateurs, aucun code absent du catalogue', () => {
    const unknown = SCAN.decoratorUses.filter((use) => !(use.code in PERMISSIONS));

    assert.deepEqual(
      unknown,
      [],
      "Un controleur exige un code de permission que le catalogue ne declare pas. Ce n'est pas une " +
        "erreur de compilation, et ce n'est pas un 500 : c'est un 403 definitif pour TOUT LE MONDE, " +
        'administrateur compris, puisque `PermissionsGuard` ne trouve ce code dans aucun role. ' +
        "Corriger ici, ou declarer le code dans `permissions.catalogue.ts` puis l'accorder.",
    );
  });

  it('ne derive, des perimetres `requireScope` litteraux, aucun code absent du catalogue', () => {
    const unknown = SCAN.scopeUses.filter((use) => !(use.code in PERMISSIONS));

    assert.deepEqual(
      unknown,
      [],
      "Un perimetre demande un scope qui n'existe pas au catalogue. Ces appels ne passent par aucun " +
        "decorateur : l'erreur n'apparait ni a la compilation ni au demarrage, mais au moment ou un " +
        "porteur legitime se voit refuser l'acces a ses propres lignes.",
    );
  });
});
