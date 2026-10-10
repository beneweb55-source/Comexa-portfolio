import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ActivityType,
  BudgetRange,
  ClientStatus,
  ContentStatus,
  InvoiceStatus,
  InvoiceType,
  LeadSource,
  LeadStatus,
  MilestoneStatus,
  PaymentMethod,
  PaymentStatus,
  PrismaClient,
  Priority,
  ProjectHealth,
  ProjectStatus,
  QuoteStatus,
  RoleCode,
  TaskStatus,
  UserStatus,
} from '../src/generated/prisma/client.js';
import {
  generateStrongPassword,
  hashPassword,
  passwordPolicyViolation,
} from '../src/common/security/password.js';
import {
  ALL_PERMISSION_CODES,
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  parsePermissionCode,
} from '../src/common/auth/permissions.catalogue.js';
import { REFERENCE_PREFIXES, REFERENCE_SCOPES } from '../src/common/references/reference.scopes.js';
import { formatReference } from '../src/modules/counters/reference.js';
import {
  buildLineRows,
  computeTotals,
  roundMoney,
  toLineEntries,
} from '../src/modules/invoices/money.js';

/**
 * DONNEES INITIALES.
 *
 * Ce script est IDEMPOTENT : on peut le relancer autant de fois que voulu, il
 * met a jour ce qui existe et ne cree que ce qui manque. C'est une exigence
 * pratique — il tourne automatiquement apres `prisma migrate reset`, et un
 * developpeur le relancera souvent.
 *
 * Deux principes de securite, tous les deux non negociables :
 *
 *  1. AUCUN mot de passe par defaut n'est ecrit dans ce fichier. Un
 *     « Admin1234! » commite ici finirait en production sur un serveur
 *     accessible publiquement. Les mots de passe sont tires au hasard et
 *     affiches UNE fois, ou fournis par variable d'environnement.
 *
 *  2. AUCUN PRIX. Le modele `Package` n'a pas de champ de montant, et ce script
 *     n'en invente pas. Le cahier des charges est explicite sur ce point.
 *
 * Les adresses des comptes de demonstration utilisent le domaine reserve
 * `.example` (RFC 2606). Ce n'est pas cosmetique : lancer le parcours
 * « mot de passe oublie » pendant un test enverrait un vrai courriel a un vrai
 * destinataire si les adresses ressemblaient a de vraies adresses. Avec
 * `.example`, c'est structurellement impossible.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL est absente. Copiez .env.example vers .env et renseignez la chaine de connexion.',
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * Annee des documents de demonstration.
 *
 * FIXE, et non `new Date().getFullYear()`. Deux raisons, toutes les deux
 * pratiques :
 *
 *  1. Les references ci-dessous servent de CLE a l'upsert
 *     (`where: { reference: ... }`). Avec l'annee courante, le 1er janvier le
 *     `where` ne trouverait plus rien et le seed creerait un SECOND client de
 *     demonstration au lieu de mettre a jour le premier — alors que
 *     l'idempotence est la propriete affirmee en tete de ce fichier.
 *  2. Le couple (reference, compteur) doit rester coherent : la ligne
 *     `Counter(scope, year)` ecrite plus bas porte la meme annee que la
 *     reference. Une annee qui derive d'un cote et pas de l'autre produit une
 *     numerotation qui redemarre a 0001 sans que rien ne le signale.
 *
 * Les PORTEES et les PREFIXES, eux, ne sont pas declares ici : ils vivent dans
 * `src/common/references/reference.scopes.ts`, que le service de numerotation
 * importe aussi. Les declarer des deux cotes serait la duplication exacte que
 * ce fichier partage existe pour empecher — le seed ecrirait `PROSPECT` et le
 * service chercherait `PROSPECTS`, et le premier prospect cree par l'API
 * echouerait sur une violation d'unicite.
 */
const REFERENCE_SEED_YEAR = 2026;

// -----------------------------------------------------------------------------
// 1. Permissions
// -----------------------------------------------------------------------------

/**
 * Ecrit le catalogue dans `permissions`.
 *
 * `resource`, `action` et `scope` sont DERIVES du code, jamais saisis a part :
 * une seule source, donc aucune derive possible entre les trois colonnes et le
 * code qu'elles decrivent.
 */
async function seedPermissions(): Promise<void> {
  for (const code of ALL_PERMISSION_CODES) {
    const { resource, action, scope } = parsePermissionCode(code);
    const description = PERMISSIONS[code];

    await prisma.permission.upsert({
      where: { code },
      create: { code, resource, action, scope, description },
      update: { resource, action, scope, description },
    });
  }

  console.log(`  permissions        ${ALL_PERMISSION_CODES.length}`);
}

// -----------------------------------------------------------------------------
// 2. Roles et attribution des permissions
// -----------------------------------------------------------------------------

async function seedRoles(): Promise<void> {
  for (const roleCode of Object.values(RoleCode)) {
    const meta = ROLES[roleCode];

    const role = await prisma.role.upsert({
      where: { code: roleCode },
      create: { code: roleCode, name: meta.name, description: meta.description, isSystem: true },
      update: { name: meta.name, description: meta.description, isSystem: true },
    });

    const declared = ROLE_PERMISSIONS[roleCode];
    const wanted: string[] = declared === 'ALL' ? [...ALL_PERMISSION_CODES] : [...declared];

    const permissions = await prisma.permission.findMany({
      where: { code: { in: wanted } },
      select: { id: true, code: true },
    });

    // Verification utile malgre le typage : ce script tourne sous `tsx`, qui
    // retire les types SANS les verifier. Un code mal orthographie dans
    // ROLE_PERMISSIONS ne serait donc pas attrape a la compilation. On le
    // rattrape ici, en nommant precisement ce qui manque — sinon l'erreur se
    // manifesterait plus tard par un refus d'acces inexplicable.
    if (permissions.length !== wanted.length) {
      const found = new Set(permissions.map((p) => p.code));
      const missing = wanted.filter((code) => !found.has(code));
      throw new Error(
        `Role ${roleCode} : ${missing.length} permission(s) introuvable(s) dans le catalogue : ` +
          missing.join(', '),
      );
    }

    // On remplace l'ensemble exactement, dans une transaction : ajouter une
    // permission au catalogue puis relancer le seed doit l'ACCORDER, et en
    // retirer une doit la REVOQUER. Un simple `createMany` laisserait les
    // permissions retirees en place.
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      }),
    ]);

    console.log(`  ${roleCode.padEnd(19)} ${wanted.length} permission(s)`);
  }
}

// -----------------------------------------------------------------------------
// 3. Comptes
// -----------------------------------------------------------------------------

interface AccountSpec {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: RoleCode;
  readonly jobTitle: string;
}

/**
 * Cree un compte et lui attribue son role.
 *
 * Sur un compte DEJA existant, le mot de passe n'est pas retouche. Relancer le
 * seed ne doit pas remettre a zero le mot de passe qu'un utilisateur a change —
 * ce serait une reinitialisation silencieuse, et personne ne s'en apercevrait
 * avant de ne plus pouvoir se connecter.
 *
 * Renvoie `true` si le compte vient d'etre cree, ce qui permet a l'appelant de
 * savoir s'il doit communiquer le mot de passe genere.
 */
async function upsertAccount(
  spec: AccountSpec,
  passwordHash: string,
  extra: { clientId?: string } = {},
): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.user.findUnique({
    where: { email: spec.email },
    select: { id: true, deletedAt: true },
  });

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          status: UserStatus.ACTIVE,
          // Comptes de demonstration : l'e-mail est tenu pour verifie, sinon la
          // connexion est bloquee par la verification (voulue en production).
          isEmailVerified: true,
          emailVerifiedAt: new Date(),
          // Un compte precedemment supprime est reactive : le seed doit laisser
          // la base dans un etat utilisable, pas dans un etat ou l'on se demande
          // pourquoi la connexion echoue.
          deletedAt: null,
          ...(extra.clientId ? { clientId: extra.clientId } : {}),
        },
        select: { id: true },
      })
    : await prisma.user.create({
        data: {
          email: spec.email,
          passwordHash,
          firstName: spec.firstName,
          lastName: spec.lastName,
          status: UserStatus.ACTIVE,
          // Verifie d'office : sans cela, un parcours de connexion qui exige
          // une adresse confirmee rendrait les comptes de demonstration
          // inutilisables.
          isEmailVerified: true,
          emailVerifiedAt: new Date(),
          // Le mot de passe est connu du seul operateur qui a lance le seed : il
          // doit etre change a la premiere connexion.
          mustChangePassword: true,
          ...(extra.clientId ? { clientId: extra.clientId } : {}),
        },
        select: { id: true },
      });

  const role = await prisma.role.findUniqueOrThrow({
    where: { code: spec.role },
    select: { id: true },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id },
    update: {},
  });

  return { id: user.id, created: !existing };
}

/**
 * Resout le mot de passe a utiliser pour un groupe de comptes.
 *
 * L'operateur peut imposer une valeur par variable d'environnement — utile en
 * integration continue, ou pour rejouer un scenario connu. Sinon on en genere
 * un, et on ne l'affiche qu'une fois.
 */
function resolvePassword(envVar: string): { value: string; generated: boolean } {
  const provided = process.env[envVar];
  if (provided && provided.length > 0) {
    const problem = passwordPolicyViolation(provided);
    if (problem) {
      throw new Error(`${envVar} ne respecte pas la politique de mot de passe : ${problem}`);
    }
    return { value: provided, generated: false };
  }
  return { value: generateStrongPassword(), generated: true };
}

// -----------------------------------------------------------------------------
// 4. Contenu du site public — SANS AUCUN PRIX
// -----------------------------------------------------------------------------

const SERVICES = [
  {
    slug: 'creation-site-web',
    title: 'Creation de site web',
    shortDescription:
      'Des sites rapides, accessibles et durables, penses pour convertir autant que pour informer.',
    description:
      "Nous concevons des sites vitrines et institutionnels sur mesure : cadrage des besoins, architecture de l'information, design, developpement et mise en ligne. Chaque projet est livre avec ses tests d'accessibilite et un tableau de bord de mesure.",
    icon: 'globe',
    features: [
      'Design sur mesure',
      'Responsive',
      'Accessibilite WCAG 2.2',
      'Optimisation des performances',
    ],
    order: 1,
    isFeatured: true,
  },
  {
    slug: 'application-web',
    title: 'Application web metier',
    shortDescription: 'Des outils internes qui remplacent les tableurs et tiennent la charge.',
    description:
      "Espaces clients, back-offices, portails metier : nous construisons des applications web avec authentification, gestion fine des droits et workflows valides. La donnee est modelisee avant d'etre codee.",
    icon: 'layers',
    features: ['Gestion des droits', 'API documentee', 'Tests automatises', "Journal d'audit"],
    order: 2,
    isFeatured: true,
  },
  {
    slug: 'e-commerce',
    title: 'Boutique en ligne',
    shortDescription: "Vendre en ligne sans sacrifier la vitesse ni la clarte de l'offre.",
    description:
      'Catalogues, tunnels de commande, moyens de paiement et suivi des expeditions. Nous privilegions les solutions que votre equipe pourra administrer seule.',
    icon: 'shopping-cart',
    features: ['Catalogue', 'Paiement securise', 'Suivi des commandes', 'Tableau de bord'],
    order: 3,
    isFeatured: false,
  },
  {
    slug: 'identite-visuelle',
    title: 'Identite visuelle',
    shortDescription: "Une marque coherente, du logotype jusqu'aux supports imprimes.",
    description:
      "Recherche, logotype, palette, typographies et charte graphique complete. Livree avec les fichiers sources et un guide d'utilisation.",
    icon: 'palette',
    features: ['Logotype', 'Charte graphique', 'Fichiers sources', "Guide d'utilisation"],
    order: 4,
    isFeatured: false,
  },
  {
    slug: 'referencement-seo',
    title: 'Referencement naturel',
    shortDescription: 'Etre trouve par ceux qui cherchent ce que vous faites, durablement.',
    description:
      'Audit technique, recherche de mots-cles, optimisation des contenus et suivi des positions. Le referencement se construit dans la duree, pas en une passe.',
    icon: 'search',
    features: ['Audit technique', 'Mots-cles', 'Contenus optimises', 'Suivi des positions'],
    order: 5,
    isFeatured: false,
  },
  {
    slug: 'maintenance',
    title: 'Maintenance et evolution',
    shortDescription: 'Un site qui reste a jour, surveille et corrige.',
    description:
      'Mises a jour de securite, sauvegardes verifiees, corrections et petites evolutions, avec un engagement de delai de prise en charge.',
    icon: 'shield',
    features: ['Mises a jour', 'Sauvegardes', 'Supervision', 'Delais engages'],
    order: 6,
    isFeatured: false,
  },
];

/**
 * Packs de l'offre publique. AUCUN MONTANT — voir le commentaire du modele
 * `Package` dans schema.prisma. Le contenu decrit ce qui est INCLUS et ce qui
 * ne l'est pas, ce qui est la seule information honnete a donner tant que les
 * tarifs ne sont pas arretes.
 */
const PACKAGES = [
  {
    slug: 'essentiel',
    name: 'Essentiel',
    tagline: 'Pour poser une presence en ligne claire et credible.',
    description:
      "Un site vitrine de quelques pages, concu pour presenter l'activite et recevoir des demandes entrantes.",
    features: [
      "Site vitrine jusqu'a 6 pages",
      'Design responsive',
      'Formulaire de contact',
      'Optimisation des bases du referencement',
      'Mise en ligne accompagnee',
    ],
    excludes: ['Espace client', 'Fonctionnalites sur mesure', 'Maintenance incluse'],
    badge: null,
    order: 1,
    isFeatured: false,
  },
  {
    slug: 'croissance',
    name: 'Croissance',
    tagline: 'Pour developper la visibilite et gerer les demandes serieusement.',
    description:
      "Un site plus complet, dote d'un espace d'administration et d'un suivi des demandes entrantes.",
    features: [
      "Site jusqu'a 15 pages",
      "Espace d'administration",
      'Blog ou actualites',
      'Suivi des demandes entrantes',
      "Mesure d'audience respectueuse des visiteurs",
    ],
    excludes: ['Developpements specifiques', 'Application metier'],
    badge: 'Le plus choisi',
    order: 2,
    isFeatured: true,
  },
  {
    slug: 'sur-mesure',
    name: 'Sur-mesure',
    tagline: 'Pour un besoin qui ne rentre dans aucune case.',
    description:
      "Cadrage, conception et developpement d'une application, avec ateliers et livraisons intermediaires.",
    features: [
      'Ateliers de cadrage',
      'Conception fonctionnelle',
      'Developpement specifique',
      'Livraisons intermediaires',
      'Transfert de competences',
    ],
    excludes: [],
    badge: null,
    order: 3,
    isFeatured: false,
  },
];

const CASE_STUDY_CATEGORIES = [
  { slug: 'site-institutionnel', name: 'Site institutionnel', order: 1 },
  { slug: 'application-metier', name: 'Application metier', order: 2 },
  { slug: 'e-commerce', name: 'Commerce en ligne', order: 3 },
  { slug: 'identite-visuelle', name: 'Identite visuelle', order: 4 },
];

const CASE_STUDIES = [
  {
    slug: 'federation-des-vignobles-refonte',
    title: "Refonte du site d'une federation de vignobles",
    clientName: 'Federation des Vignobles du Sud-Ouest',
    excerpt:
      'Un site vieillissant, illisible sur mobile, et une equipe qui ne pouvait rien publier sans nous appeler.',
    content:
      "La federation regroupait quarante domaines adherents, mais son site datait de dix ans.\n\nNous avons commence par un audit : 70 % du trafic etait mobile, et le parcours de recherche d'un domaine demandait sept clics. Nous avons reconstruit le site autour d'une recherche unique et d'un annuaire filtrable.\n\nL'equipe dispose desormais d'un espace d'administration lui permettant de publier les actualites et de mettre a jour les fiches domaines sans intervenir sur le code. Le delai de publication est passe de plusieurs jours a quelques minutes.",
    techStack: ['Next.js', 'PostgreSQL', 'Stockage objet compatible S3'],
    categorySlug: 'site-institutionnel',
    order: 1,
    isFeatured: true,
  },
  {
    slug: 'plateforme-de-suivi-logistique',
    title: 'Plateforme de suivi pour un transporteur regional',
    clientName: 'Transports Marchetti',
    excerpt:
      'Dix-huit mois de suivi dans des classeurs Excel, et deux personnes a temps plein pour les tenir a jour.',
    content:
      "Le suivi des tournees vivait dans des classeurs partages, avec des versions concurrentes et des saisies doubles.\n\nNous avons modelise la donnee avec l'equipe exploitation avant d'ecrire la moindre ligne d'interface : tournees, vehicules, conducteurs, anomalies. L'application resultante remplace les classeurs et alimente un tableau de bord quotidien.\n\nLe schema verrouille les transitions interdites : une tournee ne peut plus etre cloturee tant qu'une anomalie reste ouverte.",
    techStack: ["Serveur d'application", 'PostgreSQL', 'Authentification JWT'],
    categorySlug: 'application-metier',
    order: 2,
    isFeatured: true,
  },
  {
    slug: 'boutique-artisanat-local',
    title: "Boutique en ligne d'un collectif d'artisans",
    clientName: 'Collectif Terre & Main',
    excerpt:
      "Douze artisans, douze facons de travailler, et un besoin de vendre sans dependre d'une place de marche.",
    content:
      'Le collectif vendait uniquement sur les marches et via une place de marche prelevant une commission importante.\n\nNous avons concu une boutique commune ou chaque artisan gere son propre catalogue, avec une facturation unique par le collectif. Le point delicat etait la gestion des stocks : un meme atelier alimentant deux boutiques.\n\nLa boutique est en ligne et les artisans administrent leurs fiches produits eux-memes.',
    techStack: ['Boutique en ligne', 'PostgreSQL', 'Stockage objet compatible S3'],
    categorySlug: 'e-commerce',
    order: 3,
    isFeatured: false,
  },
  {
    slug: 'identite-cabinet-conseil',
    title: "Identite visuelle d'un cabinet de conseil",
    clientName: 'Cabinet Aurel',
    excerpt: 'Une marque inexistante et des supports disparates, chacun produit dans son coin.',
    content:
      "Le cabinet n'avait pas d'identite unifiee : chaque associe utilisait sa propre version du logotype.\n\nNous avons travaille a partir d'un entretien avec les quatre associes, puis propose une direction sobre, lisible aussi bien en petit format numerique qu'en grand sur un mur.\n\nLa charte est livree avec les fichiers sources et un guide qui couvre les cas courants : fond clair, fond sombre, monochrome.",
    techStack: ['Conception graphique', 'Charte de marque'],
    categorySlug: 'identite-visuelle',
    order: 4,
    isFeatured: false,
  },
];

const TESTIMONIALS = [
  {
    authorName: 'Claire Vasseur',
    authorRole: 'Directrice',
    authorCompany: 'Federation des Vignobles du Sud-Ouest',
    quote:
      'La refonte a change notre quotidien : nous publions nos actualites nous-memes, sans attendre personne. Le cadrage initial a ete serieux, on nous a pose des questions que nous ne nous etions pas posees.',
    rating: 5,
    isPublished: true,
    order: 1,
  },
  {
    authorName: 'Hakim Marchetti',
    authorRole: 'Directeur exploitation',
    authorCompany: 'Transports Marchetti',
    quote:
      'Ils ont passe du temps avec les equipes avant de developper quoi que ce soit. Le resultat correspond vraiment a notre facon de travailler, pas a une methode generique.',
    rating: 5,
    isPublished: true,
    order: 2,
  },
  {
    authorName: 'Jeanne Aubert',
    authorRole: 'Coordinatrice',
    authorCompany: 'Collectif Terre & Main',
    quote:
      "Enfin une boutique qui nous appartient. Les artisans gerent leurs produits seuls, et nous avons une vue d'ensemble au meme endroit.",
    rating: 4,
    isPublished: false,
    order: 3,
  },
];

const PARTNERS = [
  { name: 'Atelier Rivage', websiteUrl: 'https://atelier-rivage.example', order: 1 },
  { name: 'Groupe Landais', websiteUrl: 'https://groupe-landais.example', order: 2 },
  { name: 'Studio Falco', websiteUrl: 'https://studio-falco.example', order: 3 },
  { name: 'Cooperative Numerique', websiteUrl: 'https://coop-numerique.example', order: 4 },
];

const FAQS = [
  {
    question: 'Combien de temps dure un projet de site ?',
    answer:
      'Pour un site vitrine, comptez quatre a six semaines entre le cadrage et la mise en ligne. Un projet sur mesure demande davantage : la phase de cadrage a elle seule prend souvent deux a trois semaines. Un planning vous est remis au demarrage, avec les livrables attendus de chaque cote.',
    category: 'Projets',
    order: 1,
  },
  {
    question: 'Qui est proprietaire du code et des fichiers sources ?',
    answer:
      'Vous. Le code, les maquettes et les fichiers sources vous appartiennent a la livraison finale. Nous conservons le droit de citer le projet dans nos references, sauf demande contraire de votre part.',
    category: 'Projets',
    order: 2,
  },
  {
    question: 'Comment se passe la facturation ?',
    answer:
      "Un devis detaille est emis avant tout demarrage, et il doit etre accepte pour que le projet commence. La facturation s'etale ensuite selon les jalons prevus au planning. Aucun travail n'est engage sans devis accepte.",
    category: 'Administratif',
    order: 3,
  },
  {
    question: 'Puis-je modifier mon site moi-meme ?',
    answer:
      "Oui, c'est le principe de l'espace d'administration. Nous vous formons a son utilisation a la livraison, et nous prenons en charge la formation de plusieurs personnes si necessaire.",
    category: 'Apres livraison',
    order: 4,
  },
  {
    question: 'Que se passe-t-il si je veux changer quelque chose apres la livraison ?',
    answer:
      'Vous deposez une demande de modification depuis votre espace client. Elle est examinee et chiffree si elle sort du perimetre initial. Les corrections de defauts, elles, restent en garantie pendant la periode prevue au contrat.',
    category: 'Apres livraison',
    order: 5,
  },
  {
    question: 'Mes donnees sont-elles hebergees en France ?',
    answer:
      "La question est traitee au cas par cas selon le projet, et la reponse figure noir sur blanc dans le devis. Nous n'utilisons aucun service d'audience qui revend des donnees personnelles.",
    category: 'Securite',
    order: 6,
  },
];

async function seedPublicContent(): Promise<void> {
  for (const service of SERVICES) {
    const { features, ...rest } = service;
    await prisma.service.upsert({
      where: { slug: service.slug },
      create: { ...rest, features },
      update: { ...rest, features },
    });
  }
  console.log(`  services             ${SERVICES.length}`);

  for (const pack of PACKAGES) {
    const { features, excludes, ...rest } = pack;
    await prisma.package.upsert({
      where: { slug: pack.slug },
      create: { ...rest, features, excludes },
      update: { ...rest, features, excludes },
    });
  }
  console.log(`  packs                ${PACKAGES.length} (sans prix — volontairement)`);

  const categoryIds = new Map<string, string>();
  for (const category of CASE_STUDY_CATEGORIES) {
    const row = await prisma.caseStudyCategory.upsert({
      where: { slug: category.slug },
      create: category,
      update: category,
      select: { id: true },
    });
    categoryIds.set(category.slug, row.id);
  }

  for (const study of CASE_STUDIES) {
    const { categorySlug, techStack, ...rest } = study;
    const data = {
      ...rest,
      techStack,
      status: ContentStatus.PUBLISHED,
      publishedAt: new Date(),
      categoryId: categoryIds.get(categorySlug) ?? null,
    };
    await prisma.caseStudy.upsert({
      where: { slug: study.slug },
      create: data,
      update: data,
    });
  }
  console.log(`  etudes de cas        ${CASE_STUDIES.length}`);

  for (const testimonial of TESTIMONIALS) {
    // Pas de contrainte d'unicite sur un temoignage : on identifie par auteur.
    const existing = await prisma.testimonial.findFirst({
      where: { authorName: testimonial.authorName },
      select: { id: true },
    });
    if (existing) {
      await prisma.testimonial.update({ where: { id: existing.id }, data: testimonial });
    } else {
      await prisma.testimonial.create({ data: testimonial });
    }
  }
  console.log(
    `  temoignages          ${TESTIMONIALS.length} ` +
      `(${TESTIMONIALS.filter((t) => t.isPublished).length} publies, le reste en attente de validation)`,
  );

  for (const partner of PARTNERS) {
    const existing = await prisma.partner.findFirst({
      where: { name: partner.name },
      select: { id: true },
    });
    if (existing) {
      await prisma.partner.update({ where: { id: existing.id }, data: partner });
    } else {
      await prisma.partner.create({ data: partner });
    }
  }
  console.log(`  partenaires          ${PARTNERS.length}`);

  for (const faq of FAQS) {
    const existing = await prisma.faq.findFirst({
      where: { question: faq.question },
      select: { id: true },
    });
    if (existing) {
      await prisma.faq.update({ where: { id: existing.id }, data: faq });
    } else {
      await prisma.faq.create({ data: faq });
    }
  }
  console.log(`  questions frequentes ${FAQS.length}`);
}

// -----------------------------------------------------------------------------
// Dossier de demonstration : la chaine metier complete
// -----------------------------------------------------------------------------

/**
 * DEVIS -> ACCEPTATION -> PROJET -> EQUIPE -> TACHES -> JALONS -> FACTURE ->
 * PAIEMENT, ecrit une fois pour toutes.
 *
 * POURQUOI CE BLOC EXISTE. Sans lui, la base restait avec des comptes, un client
 * et un prospect qualifie — donc un tableau de bord vide. Le frontend, lui, a
 * besoin de lire des montants reels, un avancement, des echeances et un
 * encaissement pour rendre ses ecrans ; les inventer cote client serait la seule
 * alternative, et c'est exactement ce que le cahier des charges interdit.
 *
 * CE QUI RESTE VOLONTAIREMENT INACHEVE. `DEV-2026-0002` est un devis SENT vise
 * par le PROSPECT : c'est le point de depart que le developpeur peut parcourir
 * par l'API, l'acceptation creant alors le client, le projet et la facture par le
 * chemin reel. Le dossier accepte (`DEV-2026-0001`, cote CLIENT) montre l'etat
 * d'arrivee. Les DEUX branches de la regle « prospect OU client » sont donc
 * presentes en base — ce qui n'est pas un detail : c'est la seule facon de voir
 * a l'ecran qu'un devis vise par un prospect et un devis vise par un client ne
 * s'affichent pas dans la meme liste.
 *
 * LES MONTANTS SONT CALCULES, PAS SAISIS. Les totaux viennent de `computeTotals`,
 * les lignes de `buildLineRows`, et la facture reutilise les ENTREES DU DEVIS.
 * C'est la seule facon d'obtenir ici ce que le module factures garantit par
 * ailleurs : la facture nee d'un devis accepte porte le meme total que lui.
 * Recopier « 7668.00 » a la main finirait par produire une facture qui ne
 * correspond plus a ses lignes, sans que rien ne le signale.
 *
 * LES DATES SONT RELATIVES A L'EXECUTION. Une echeance datee en dur devient « en
 * retard » l'annee suivante, et un tableau de bord de demonstration qui affiche
 * tout en rouge ne montre plus rien. L'ANNEE DE NUMEROTATION, elle, reste fixe
 * (voir `REFERENCE_SEED_YEAR`) : c'est la cle de l'upsert, et la faire deriver
 * casserait l'idempotence affirmee en tete de ce fichier.
 *
 * IDEMPOTENCE, ENFIN, ET ELLE SE LIT DANS LA FORME DU CODE. Tout ce qui porte une
 * `reference` unique est un `upsert` sur cette reference (devis, projet, facture,
 * paiement) ; tout le reste est un enfant sans cle, ecrit UNE SEULE FOIS sous
 * condition de comptage — le meme procede que l'historique de statuts du
 * prospect plus haut, et pour la meme raison : sans contrainte d'unicite, une
 * seconde execution empilerait des doublons. Les appartenances d'equipe, elles,
 * ont une cle composee `(projectId, userId)` et sont donc des `upsert`.
 */
const DOSSIER_DEPOSIT_PERCENT = 40;
const DOSSIER_TAX_RATE = '20';
const DAY_MS = 86_400_000;

interface DossierIds {
  readonly clientId: string;
  readonly clientAccountId: string | null;
  readonly prospectId: string;
  readonly salesUserId: string | null;
  readonly projectManagerUserId: string | null;
  readonly developerUserId: string | null;
  readonly designerUserId: string | null;
}

async function seedBusinessDossier(ids: DossierIds): Promise<void> {
  const now = Date.now();
  const daysAgo = (days: number): Date => new Date(now - days * DAY_MS);
  const daysAhead = (days: number): Date => new Date(now + days * DAY_MS);

  const quoteReference = formatReference(REFERENCE_PREFIXES.QUOTE, REFERENCE_SEED_YEAR, 1);
  const prospectQuoteReference = formatReference(REFERENCE_PREFIXES.QUOTE, REFERENCE_SEED_YEAR, 2);
  const projectReference = formatReference(REFERENCE_PREFIXES.PROJECT, REFERENCE_SEED_YEAR, 1);
  const invoiceReference = formatReference(REFERENCE_PREFIXES.INVOICE, REFERENCE_SEED_YEAR, 1);
  const paymentReference = formatReference(REFERENCE_PREFIXES.PAYMENT, REFERENCE_SEED_YEAR, 1);

  // --- Devis accepte (cote CLIENT) ------------------------------------------
  // Ne porte pas de `prospectId` : c'est un devis complementaire sur un client
  // existant, l'autre branche de la regle. Un devis accepte porte legitimement
  // les deux champs quand il vient d'un prospect converti ; celui-ci n'a pas
  // cette origine, et le laisser vide est la verite.

  const quoteEntries = toLineEntries([
    {
      title: 'Boutique en ligne',
      description: 'Catalogue, panier, paiement en ligne et espace client.',
      quantity: 1,
      unitPrice: '4500.00',
    },
    {
      title: 'Refonte du site vitrine',
      description: 'Mise en page et parcours repenses, identite visuelle conservee.',
      quantity: 1,
      unitPrice: '2100.00',
      discountPercent: 10,
    },
  ]);
  const quoteTotals = computeTotals(quoteEntries, DOSSIER_TAX_RATE);
  const quoteRows = buildLineRows(quoteEntries, quoteTotals, DOSSIER_TAX_RATE);

  const terms = 'Acompte de 40 % a la commande, solde a la mise en ligne.';

  const acceptedQuote = await prisma.quote.upsert({
    where: { reference: quoteReference },
    create: {
      reference: quoteReference,
      sequence: 1,
      year: REFERENCE_SEED_YEAR,
      clientId: ids.clientId,
      subject: 'Boutique en ligne et refonte du site vitrine',
      notes: 'Devis accepte par Marc Delaunay, directeur.',
      terms,
      status: QuoteStatus.ACCEPTED,
      issueDate: daysAgo(45),
      validUntil: daysAhead(15),
      sentAt: daysAgo(44),
      viewedAt: daysAgo(43),
      acceptedAt: daysAgo(40),
      acceptedByName: 'Marc Delaunay',
      acceptedById: ids.clientAccountId,
      currency: 'EUR',
      subtotal: quoteTotals.subtotal,
      discountAmount: quoteTotals.discountAmount,
      taxRate: quoteTotals.taxRate,
      taxAmount: quoteTotals.taxAmount,
      total: quoteTotals.total,
      createdById: ids.salesUserId,
    },
    update: {
      clientId: ids.clientId,
      status: QuoteStatus.ACCEPTED,
      subtotal: quoteTotals.subtotal,
      discountAmount: quoteTotals.discountAmount,
      taxRate: quoteTotals.taxRate,
      taxAmount: quoteTotals.taxAmount,
      total: quoteTotals.total,
      acceptedByName: 'Marc Delaunay',
      acceptedById: ids.clientAccountId,
    },
    select: { id: true },
  });

  const quoteItemCount = await prisma.quoteItem.count({ where: { quoteId: acceptedQuote.id } });
  if (quoteItemCount === 0) {
    await prisma.quoteItem.createMany({
      data: quoteRows.map((row) => ({ quoteId: acceptedQuote.id, ...row })),
    });
  }

  // --- Devis en attente (cote PROSPECT) -------------------------------------
  // Le point de depart du parcours : rien n'en decoule encore, et c'est voulu.

  const prospectEntries = toLineEntries([
    {
      title: 'Boutique en ligne',
      description: 'Catalogue et paiement en ligne, sur la base du site actuel.',
      quantity: 1,
      unitPrice: '3900.00',
    },
    {
      title: 'Formation a la prise en main',
      description: 'Deux demi-journees sur site.',
      quantity: 2,
      unitPrice: '350.00',
      discountPercent: 10,
    },
  ]);
  const prospectTotals = computeTotals(prospectEntries, DOSSIER_TAX_RATE);
  const prospectRows = buildLineRows(prospectEntries, prospectTotals, DOSSIER_TAX_RATE);

  const prospectQuote = await prisma.quote.upsert({
    where: { reference: prospectQuoteReference },
    create: {
      reference: prospectQuoteReference,
      sequence: 2,
      year: REFERENCE_SEED_YEAR,
      prospectId: ids.prospectId,
      subject: 'Boutique en ligne et formation',
      notes: 'Devis envoye, en attente de decision.',
      terms,
      status: QuoteStatus.SENT,
      issueDate: daysAgo(6),
      validUntil: daysAhead(24),
      sentAt: daysAgo(5),
      currency: 'EUR',
      subtotal: prospectTotals.subtotal,
      discountAmount: prospectTotals.discountAmount,
      taxRate: prospectTotals.taxRate,
      taxAmount: prospectTotals.taxAmount,
      total: prospectTotals.total,
      createdById: ids.salesUserId,
    },
    update: {
      prospectId: ids.prospectId,
      status: QuoteStatus.SENT,
      subtotal: prospectTotals.subtotal,
      discountAmount: prospectTotals.discountAmount,
      taxRate: prospectTotals.taxRate,
      taxAmount: prospectTotals.taxAmount,
      total: prospectTotals.total,
    },
    select: { id: true },
  });

  const prospectItemCount = await prisma.quoteItem.count({
    where: { quoteId: prospectQuote.id },
  });
  if (prospectItemCount === 0) {
    await prisma.quoteItem.createMany({
      data: prospectRows.map((row) => ({ quoteId: prospectQuote.id, ...row })),
    });
  }

  // --- Projet -----------------------------------------------------------------
  // `quoteId` est unique : c'est la relation un-a-un « un devis accepte donne au
  // plus un projet ». Le budget est le total du devis, pas un montant invente.

  const project = await prisma.project.upsert({
    where: { reference: projectReference },
    create: {
      reference: projectReference,
      name: 'Boutique en ligne Maison Vasseur',
      code: 'MV-BOUTIQUE',
      description: 'Vente en ligne des produits de la maison, refonte du vitrine.',
      clientId: ids.clientId,
      quoteId: acceptedQuote.id,
      status: ProjectStatus.IN_PROGRESS,
      health: ProjectHealth.ON_TRACK,
      priority: Priority.NORMAL,
      startDate: daysAgo(38),
      dueDate: daysAhead(22),
      budget: quoteTotals.total,
      currency: 'EUR',
      progressPercent: 60,
      managerId: ids.projectManagerUserId,
      createdById: ids.salesUserId,
    },
    update: {
      quoteId: acceptedQuote.id,
      managerId: ids.projectManagerUserId,
      budget: quoteTotals.total,
      progressPercent: 60,
      status: ProjectStatus.IN_PROGRESS,
    },
    select: { id: true },
  });

  // --- Equipe -----------------------------------------------------------------
  // Cle composee `(projectId, userId)` : un `upsert` suffit, et `leftAt` est
  // remis a null pour qu'une execution apres un depart remette la personne a
  // bord — sinon le seed decrirait une equipe que le projet n'a plus.

  const members: { userId: string | null; projectRole: string; allocationPercent: number }[] = [
    {
      userId: ids.projectManagerUserId,
      projectRole: 'Chef de projet',
      allocationPercent: 30,
    },
    { userId: ids.developerUserId, projectRole: 'Developpeur full-stack', allocationPercent: 60 },
    { userId: ids.designerUserId, projectRole: 'Designer UI', allocationPercent: 25 },
  ];

  for (const member of members) {
    if (member.userId === null) continue;
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: member.userId } },
      create: {
        projectId: project.id,
        userId: member.userId,
        projectRole: member.projectRole,
        allocationPercent: member.allocationPercent,
      },
      update: {
        projectRole: member.projectRole,
        allocationPercent: member.allocationPercent,
        leftAt: null,
      },
    });
  }

  // --- Jalons -----------------------------------------------------------------
  // Deux jalons, un atteint et un a venir : c'est ce qui rend l'avancement
  // lisible. Les identifiants sont RELUS ensuite plutot que gardes en memoire,
  // pour que le chemin « premiere execution » et le chemin « execution suivante »
  // (ou les jalons existent deja) produisent le meme resultat.

  const milestoneCount = await prisma.milestone.count({ where: { projectId: project.id } });
  if (milestoneCount === 0) {
    await prisma.milestone.createMany({
      data: [
        {
          projectId: project.id,
          title: 'Cadrage et maquettes',
          description: 'Ateliers de cadrage, arborescence et maquettes validees.',
          status: MilestoneStatus.REACHED,
          dueDate: daysAgo(20),
          reachedAt: daysAgo(21),
          order: 0,
        },
        {
          projectId: project.id,
          title: 'Mise en ligne',
          description: 'Recette conjointe, reprise des contenus et ouverture au public.',
          status: MilestoneStatus.PENDING,
          dueDate: daysAhead(18),
          order: 1,
        },
      ],
    });
  }

  const milestones = await prisma.milestone.findMany({
    where: { projectId: project.id },
    orderBy: { order: 'asc' },
    select: { id: true },
  });
  const cadrageId = milestones[0]?.id ?? null;
  const miseEnLigneId = milestones[1]?.id ?? null;

  // --- Taches -----------------------------------------------------------------
  // DEUX taches internes (`isClientVisible: false`) pour trois partagees : la
  // distinction doit etre visible dans les donnees, sans quoi l'espace client ne
  // peut pas etre teste autrement qu'en fabriquant une fuite.

  const taskCount = await prisma.task.count({ where: { projectId: project.id } });
  if (taskCount === 0) {
    await prisma.task.createMany({
      data: [
        {
          projectId: project.id,
          milestoneId: cadrageId,
          title: 'Atelier de cadrage',
          status: TaskStatus.DONE,
          completedAt: daysAgo(31),
          estimateMinutes: 180,
          assigneeId: ids.projectManagerUserId,
          reporterId: ids.projectManagerUserId,
          isClientVisible: true,
          order: 0,
        },
        {
          projectId: project.id,
          milestoneId: cadrageId,
          title: 'Maquettes des parcours de commande',
          status: TaskStatus.DONE,
          completedAt: daysAgo(22),
          estimateMinutes: 720,
          assigneeId: ids.designerUserId,
          reporterId: ids.projectManagerUserId,
          isClientVisible: true,
          order: 1,
        },
        {
          projectId: project.id,
          milestoneId: miseEnLigneId,
          title: 'Integration du catalogue',
          status: TaskStatus.IN_PROGRESS,
          dueDate: daysAhead(9),
          estimateMinutes: 1440,
          assigneeId: ids.developerUserId,
          reporterId: ids.projectManagerUserId,
          isClientVisible: true,
          order: 2,
        },
        {
          projectId: project.id,
          milestoneId: miseEnLigneId,
          title: 'Recette technique interne',
          status: TaskStatus.TODO,
          dueDate: daysAhead(16),
          estimateMinutes: 480,
          assigneeId: ids.developerUserId,
          reporterId: ids.projectManagerUserId,
          isClientVisible: false,
          order: 3,
        },
        {
          projectId: project.id,
          title: 'Inventaire des contenus existants',
          status: TaskStatus.BLOCKED,
          dueDate: daysAhead(6),
          estimateMinutes: 600,
          assigneeId: ids.designerUserId,
          reporterId: ids.projectManagerUserId,
          isClientVisible: false,
          order: 4,
        },
      ],
    });
  }

  // --- Temps passe ------------------------------------------------------------
  // En minutes entieres, comme la colonne : une duree qui finit en facturation ne
  // s'arrondit pas au flottant.

  const timeEntryCount = await prisma.timeEntry.count({ where: { projectId: project.id } });
  if (timeEntryCount === 0) {
    // `userId` est OBLIGATOIRE sur un temps passe : une duree sans auteur n'a
    // pas de sens. Les identifiants de role sont donc testes avant d'ecrire,
    // plutot que remplaces par une chaine vide — qui violerait la cle etrangere
    // au premier insert, et donnerait une erreur parlant de contrainte la ou le
    // probleme est un compte manquant.
    const timeEntryRows: {
      userId: string;
      spentOn: Date;
      minutes: number;
      description: string;
      billable: boolean;
    }[] = [];

    if (ids.developerUserId !== null) {
      timeEntryRows.push({
        userId: ids.developerUserId,
        spentOn: daysAgo(25),
        minutes: 420,
        description: 'Mise en place du socle et du catalogue.',
        billable: true,
      });
    }
    if (ids.designerUserId !== null) {
      timeEntryRows.push({
        userId: ids.designerUserId,
        spentOn: daysAgo(18),
        minutes: 240,
        description: 'Declinaisons des maquettes validees.',
        billable: true,
      });
    }

    if (timeEntryRows.length > 0) {
      await prisma.timeEntry.createMany({
        data: timeEntryRows.map((row) => ({ projectId: project.id, ...row })),
      });
    }
  }

  // --- Facture ----------------------------------------------------------------
  // Memes entrees, meme taux que le devis : le total est donc identique par
  // construction, et non parce qu'il a ete recopie.

  const depositAmount = roundMoney(quoteTotals.total.times(DOSSIER_DEPOSIT_PERCENT).dividedBy(100));

  const invoice = await prisma.invoice.upsert({
    where: { reference: invoiceReference },
    create: {
      reference: invoiceReference,
      sequence: 1,
      year: REFERENCE_SEED_YEAR,
      clientId: ids.clientId,
      projectId: project.id,
      quoteId: acceptedQuote.id,
      type: InvoiceType.STANDARD,
      status: InvoiceStatus.PARTIALLY_PAID,
      subject: 'Boutique en ligne et refonte du site vitrine',
      notes: `Facture emise apres acceptation du devis ${quoteReference}.`,
      terms,
      issueDate: daysAgo(30),
      dueDate: daysAhead(15),
      currency: 'EUR',
      subtotal: quoteTotals.subtotal,
      discountAmount: quoteTotals.discountAmount,
      taxRate: quoteTotals.taxRate,
      taxAmount: quoteTotals.taxAmount,
      total: quoteTotals.total,
      // `amountPaid` est le cumul des paiements REUSSIS et rien d'autre. Ici il
      // vaut exactement le seul encaissement ecrit plus bas — la regle que
      // `recomputePaymentState` applique cote service, reproduite a la main
      // parce qu'une ecriture directe ne la declenche pas.
      amountPaid: depositAmount,
      // Partiellement payee : `paidAt` reste vide, sinon la vue d'encours
      // compterait une facture reglee.
      paidAt: null,
      sentAt: daysAgo(30),
      createdById: ids.salesUserId,
    },
    update: {
      status: InvoiceStatus.PARTIALLY_PAID,
      projectId: project.id,
      quoteId: acceptedQuote.id,
      subtotal: quoteTotals.subtotal,
      discountAmount: quoteTotals.discountAmount,
      taxRate: quoteTotals.taxRate,
      taxAmount: quoteTotals.taxAmount,
      total: quoteTotals.total,
      amountPaid: depositAmount,
      paidAt: null,
    },
    select: { id: true },
  });

  const invoiceItemCount = await prisma.invoiceItem.count({ where: { invoiceId: invoice.id } });
  if (invoiceItemCount === 0) {
    await prisma.invoiceItem.createMany({
      data: quoteRows.map((row) => ({ invoiceId: invoice.id, ...row })),
    });
  }

  // --- Paiement ---------------------------------------------------------------
  // SUCCEEDED, et c'est la seule chose qui le fasse compter dans `amountPaid`.

  await prisma.payment.upsert({
    where: { reference: paymentReference },
    create: {
      reference: paymentReference,
      invoiceId: invoice.id,
      amount: depositAmount,
      currency: 'EUR',
      method: PaymentMethod.BANK_TRANSFER,
      status: PaymentStatus.SUCCEEDED,
      paidAt: daysAgo(12),
      externalReference: 'VIR-4471',
      receivedById: ids.salesUserId,
      notes: 'Acompte de 40 % regle par virement.',
    },
    update: {
      invoiceId: invoice.id,
      amount: depositAmount,
      status: PaymentStatus.SUCCEEDED,
      receivedById: ids.salesUserId,
    },
    select: { id: true },
  });

  // --- Journal du projet ------------------------------------------------------
  // Une ecriture directe ne produit aucun evenement : sans ce bloc, la timeline
  // du projet serait vide, et le frontend ne pourrait pas la tester. Deux lignes
  // sont visibles du client, trois ne le sont pas — la encore, la distinction
  // doit exister en base.
  //
  // CE BLOC EST LE SEUL QUI EFFACE AVANT D'ECRIRE, et il y a deux raisons, toutes
  // les deux verifiees plutot que supposees :
  //
  //  1. LE TEXTE DU JOURNAL APPARTIENT AU CODE. Un libelle de tache, lui, est
  //     une donnee qu'un utilisateur peut avoir modifiee ; un message de journal
  //     est une phrase que le seed ecrit. Le protege par un comptage, c'est
  //     garder indefiniment un texte qu'on vient de corriger dans ce fichier —
  //     l'auteur du changement ne voit rien se passer et conclut que le seed ne
  //     marche pas. C'est exactement ce qui est arrive ici : la premiere version
  //     de ce journal affirmait une transition `PLANNED -> IN_PROGRESS` que le
  //     projet n'a jamais connue, la correction a ete ecrite, et la base a
  //     continue d'afficher l'ancienne phrase.
  //  2. AUCUNE CLE ETRANGERE NE POINTE VERS `activities`, contrairement aux
  //     taches (`activity.taskId`, `timeEntry.taskId`, `document.taskId`). On
  //     peut donc remplacer le journal sans casser le moindre lien — ce qui
  //     n'est PAS vrai des taches, d'ou le comptage qui les protege.
  //
  // Les autres enfants (lignes de devis, de facture, jalons, taches, temps)
  // gardent leur garde de comptage : leur contenu est une donnee, et les
  // remplacer a chaque execution detruirait un travail fait par l'API sur le
  // dossier de demonstration.
  //
  // `createdAt` EST ECRIT A LA MAIN, et c'est necessaire. La colonne a une valeur
  // par defaut (`now()`), donc cinq lignes ecrites en une fois porteraient le
  // MEME horodatage : la timeline afficherait cinq evenements a la seconde pres,
  // alors que les dates du projet s'etalent sur un mois et demi. Les dates
  // ci-dessous suivent l'ordre reel des jalons, du devis accepte a la mise en
  // ligne — un journal qu'on peut relire.
  //
  // AUCUN EVENEMENT N'AFFIRME UNE TRANSITION QUI N'A PAS EU LIEU. Le projet est
  // cree directement `IN_PROGRESS` ; la charge utile ne porte donc que l'etat
  // ATTEINT, ce que les donnees disent exactement.

  await prisma.activity.deleteMany({ where: { projectId: project.id } });
  await prisma.activity.createMany({
    data: [
      {
        projectId: project.id,
        clientId: ids.clientId,
        actorId: ids.salesUserId,
        type: ActivityType.SYSTEM,
        message: `Projet cree depuis le devis accepte ${quoteReference}.`,
        createdAt: daysAgo(38),
        isClientVisible: false,
      },
      {
        projectId: project.id,
        clientId: ids.clientId,
        actorId: ids.projectManagerUserId,
        type: ActivityType.STATUS_CHANGE,
        message: 'Le projet demarre, statut IN_PROGRESS.',
        metadata: { to: ProjectStatus.IN_PROGRESS },
        // UN JOUR PLUS TARD QUE LA CREATION, et c'est deliberé. Les deux
        // evenements portaient le meme `daysAgo(38)`, donc le meme horodatage :
        // une liste triee sur `createdAt` seul les rendait dans un ordre
        // arbitraire, et « le projet demarre » pouvait s'afficher AVANT « projet
        // cree ». Une timeline de demonstration qui commence par la fin ne montre
        // pas ce qu'elle pretend montrer.
        createdAt: daysAgo(37),
        isClientVisible: true,
      },
      {
        projectId: project.id,
        clientId: ids.clientId,
        actorId: ids.projectManagerUserId,
        type: ActivityType.MILESTONE_REACHED,
        message: 'Jalon atteint : Cadrage et maquettes.',
        createdAt: daysAgo(21),
        isClientVisible: true,
      },
      {
        projectId: project.id,
        actorId: ids.developerUserId,
        type: ActivityType.TASK_COMPLETED,
        message: 'Tache terminee : Maquettes des parcours de commande.',
        createdAt: daysAgo(22),
        isClientVisible: false,
      },
      {
        projectId: project.id,
        actorId: ids.developerUserId,
        type: ActivityType.TIME_LOGGED,
        message: '7 h passees sur Integration du catalogue.',
        createdAt: daysAgo(25),
        isClientVisible: false,
      },
    ],
  });

  console.log(`  devis accepte       ${quoteReference}  total ${quoteTotals.total.toFixed(2)}`);
  console.log(
    `  devis en attente    ${prospectQuoteReference}  total ${prospectTotals.total.toFixed(2)}`,
  );
  console.log(`  projet              ${projectReference}  avancement 60 %`);
  console.log(`  facture             ${invoiceReference}  encaisse ${depositAmount.toFixed(2)}`);
  console.log(`  paiement            ${paymentReference}  ${PaymentMethod.BANK_TRANSFER}`);
}

// -----------------------------------------------------------------------------
// Orchestration
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  // Garde-fou : lance par erreur contre une base de production, ce script
  // creerait des comptes de demonstration ouverts. On exige donc une
  // confirmation explicite des que NODE_ENV vaut production.
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'yes') {
    throw new Error(
      'NODE_ENV=production. Le seed cree des comptes de demonstration : ' +
        "definissez SEED_ALLOW_PRODUCTION=yes si c'est vraiment ce que vous voulez.",
    );
  }

  console.log('\nDonnees initiales Comexa\n');

  console.log('Permissions et roles');
  await seedPermissions();
  await seedRoles();

  console.log('\nComptes');

  const adminPassword = resolvePassword('SEED_ADMIN_PASSWORD');
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@comexa.example').toLowerCase();

  const admin = await upsertAccount(
    {
      email: adminEmail,
      firstName: 'Awa',
      lastName: 'Traore',
      role: RoleCode.ADMIN,
      jobTitle: 'Administratrice',
    },
    await hashPassword(adminPassword.value),
  );
  console.log(`  ${adminEmail.padEnd(34)} ${RoleCode.ADMIN}`);

  // Mot de passe commun aux comptes de demonstration : ils servent a exercer
  // les permissions de chaque role, pas a proteger une donnee reelle.
  const demoPassword = resolvePassword('SEED_DEMO_PASSWORD');
  const demoHash = await hashPassword(demoPassword.value);

  const team: AccountSpec[] = [
    {
      email: 'camille.rousseau@comexa.example',
      firstName: 'Camille',
      lastName: 'Rousseau',
      role: RoleCode.COMMUNICATION_MANAGER,
      jobTitle: 'Responsable communication',
    },
    {
      email: 'yanis.belkacem@comexa.example',
      firstName: 'Yanis',
      lastName: 'Belkacem',
      role: RoleCode.PROJECT_MANAGER,
      jobTitle: 'Chef de projet',
    },
    {
      email: 'thomas.lefevre@comexa.example',
      firstName: 'Thomas',
      lastName: 'Lefevre',
      role: RoleCode.DEVELOPER,
      jobTitle: 'Developpeur',
    },
    {
      email: 'ines.moreau@comexa.example',
      firstName: 'Ines',
      lastName: 'Moreau',
      role: RoleCode.DESIGNER,
      jobTitle: 'Designer',
    },
    {
      email: 'sofia.benali@comexa.example',
      firstName: 'Sofia',
      lastName: 'Benali',
      role: RoleCode.SALES,
      jobTitle: 'Commerciale',
    },
  ];

  const createdTeam: string[] = [];
  let salesUserId: string | null = null;
  // Les trois autres identifiants servent au dossier de demonstration plus bas
  // (chef de projet, equipe, temps passe). Ils sont collectes DANS cette boucle
  // et non retrouves plus tard par une seconde requete : `upsertAccount` vient
  // de rendre l'id, et le redemander par adresse serait une seconde source de
  // verite pour la meme ligne.
  let projectManagerUserId: string | null = null;
  let developerUserId: string | null = null;
  let designerUserId: string | null = null;

  for (const spec of team) {
    const result = await upsertAccount(spec, demoHash);
    if (result.created) createdTeam.push(spec.email);
    if (spec.role === RoleCode.SALES) salesUserId = result.id;
    if (spec.role === RoleCode.PROJECT_MANAGER) projectManagerUserId = result.id;
    if (spec.role === RoleCode.DEVELOPER) developerUserId = result.id;
    if (spec.role === RoleCode.DESIGNER) designerUserId = result.id;
    console.log(`  ${spec.email.padEnd(34)} ${spec.role}`);
  }

  // --- Client de demonstration ---------------------------------------------
  // Un compte CLIENT doit pointer vers une ligne `Client` : sans elle, son
  // perimetre serait vide et le role ne serait pas testable.

  const client = await prisma.client.upsert({
    where: { reference: formatReference(REFERENCE_PREFIXES.CLIENT, REFERENCE_SEED_YEAR, 1) },
    create: {
      reference: formatReference(REFERENCE_PREFIXES.CLIENT, REFERENCE_SEED_YEAR, 1),
      companyName: 'Maison Vasseur',
      legalName: 'Maison Vasseur SARL',
      sector: 'Agroalimentaire',
      website: 'https://maison-vasseur.example',
      addressLine1: '14 quai des Chartrons',
      postalCode: '33000',
      city: 'Bordeaux',
      country: 'France',
      status: ClientStatus.ACTIVE,
      accountManagerId: salesUserId,
      notes: 'Cliente historique. Prefere etre appelee le matin.',
    },
    update: { accountManagerId: salesUserId },
    select: { id: true },
  });

  const clientAccount = await upsertAccount(
    {
      email: 'marc.delaunay@comexa.example',
      firstName: 'Marc',
      lastName: 'Delaunay',
      role: RoleCode.CLIENT,
      jobTitle: 'Directeur',
    },
    demoHash,
    { clientId: client.id },
  );
  console.log(`  ${'marc.delaunay@comexa.example'.padEnd(34)} ${RoleCode.CLIENT}`);

  const existingContact = await prisma.contact.findFirst({
    where: { clientId: client.id, email: 'marc.delaunay@comexa.example' },
    select: { id: true },
  });
  if (!existingContact) {
    await prisma.contact.create({
      data: {
        clientId: client.id,
        firstName: 'Marc',
        lastName: 'Delaunay',
        email: 'marc.delaunay@comexa.example',
        phone: '+33 5 56 00 00 01',
        jobTitle: 'Directeur',
        isPrimary: true,
      },
    });
  }

  // --- Prospect de demonstration -------------------------------------------
  // Point de depart du parcours de bout en bout :
  // prospect -> devis -> acceptation -> client -> projet -> facture -> paiement.

  const prospect = await prisma.prospect.upsert({
    where: { reference: formatReference(REFERENCE_PREFIXES.PROSPECT, REFERENCE_SEED_YEAR, 1) },
    create: {
      reference: formatReference(REFERENCE_PREFIXES.PROSPECT, REFERENCE_SEED_YEAR, 1),
      companyName: 'Boulangerie Lefranc',
      contactFirstName: 'Nadia',
      contactLastName: 'Lefranc',
      email: 'nadia.lefranc@boulangerie-lefranc.example',
      phone: '+33 5 56 00 00 02',
      jobTitle: 'Gerante',
      website: 'https://boulangerie-lefranc.example',
      sector: 'Commerce de proximite',
      source: LeadSource.CONTACT_FORM,
      status: LeadStatus.QUALIFIED,
      budgetRange: BudgetRange.FROM_5K_TO_15K,
      notes: 'Souhaite une boutique en ligne et une refonte de son site actuel.',
      ownerId: salesUserId,
    },
    update: { ownerId: salesUserId },
    select: { id: true },
  });

  // L'historique n'a pas de contrainte d'unicite : on l'ecrit une seule fois,
  // sinon chaque execution du seed empilerait des lignes identiques.
  const historyCount = await prisma.leadStatusHistory.count({
    where: { prospectId: prospect.id },
  });
  if (historyCount === 0) {
    await prisma.leadStatusHistory.createMany({
      data: [
        {
          prospectId: prospect.id,
          fromStatus: null,
          toStatus: LeadStatus.NEW,
          note: 'Demande recue via le formulaire de contact du site.',
          changedById: salesUserId,
        },
        {
          prospectId: prospect.id,
          fromStatus: LeadStatus.NEW,
          toStatus: LeadStatus.CONTACTED,
          note: 'Premier echange telephonique.',
          changedById: salesUserId,
        },
        {
          prospectId: prospect.id,
          fromStatus: LeadStatus.CONTACTED,
          toStatus: LeadStatus.QUALIFIED,
          note: 'Besoin cadre : boutique en ligne plus refonte du site vitrine.',
          changedById: salesUserId,
        },
      ],
    });
  }

  // --- Dossier de demonstration --------------------------------------------
  console.log('\nDossier de demonstration');
  await seedBusinessDossier({
    clientId: client.id,
    clientAccountId: clientAccount.id,
    prospectId: prospect.id,
    salesUserId,
    projectManagerUserId,
    developerUserId,
    designerUserId,
  });

  // --- Numerotation ---------------------------------------------------------
  // On aligne les compteurs sur ce qui vient d'etre insere, pour que le premier
  // document cree par l'API prenne le numero SUIVANT et non un numero deja pris.
  //
  // CHAQUE VALEUR EST LE DERNIER NUMERO REELLEMENT UTILISE, et pas un 1 de
  // principe : `QUOTE` vaut 2 parce que le dossier ci-dessus ecrit `DEV-2026-0001`
  // ET `DEV-2026-0002`. Laisser 1 ferait renvoyer `DEV-2026-0002` au premier devis
  // cree par l'API, et la collision se declarerait en violation d'unicite
  // Prisma — c'est-a-dire a un endroit qui ne parle pas de numerotation.

  await prisma.counter.upsert({
    where: { scope_year: { scope: REFERENCE_SCOPES.PROSPECT, year: REFERENCE_SEED_YEAR } },
    create: { scope: REFERENCE_SCOPES.PROSPECT, year: REFERENCE_SEED_YEAR, value: 1 },
    update: { value: 1 },
  });
  await prisma.counter.upsert({
    where: { scope_year: { scope: REFERENCE_SCOPES.CLIENT, year: REFERENCE_SEED_YEAR } },
    create: { scope: REFERENCE_SCOPES.CLIENT, year: REFERENCE_SEED_YEAR, value: 1 },
    update: { value: 1 },
  });

  const dossierCounters: { scope: string; value: number }[] = [
    { scope: REFERENCE_SCOPES.QUOTE, value: 2 },
    { scope: REFERENCE_SCOPES.PROJECT, value: 1 },
    { scope: REFERENCE_SCOPES.INVOICE, value: 1 },
    { scope: REFERENCE_SCOPES.PAYMENT, value: 1 },
  ];
  for (const counter of dossierCounters) {
    await prisma.counter.upsert({
      where: { scope_year: { scope: counter.scope, year: REFERENCE_SEED_YEAR } },
      create: { scope: counter.scope, year: REFERENCE_SEED_YEAR, value: counter.value },
      update: { value: counter.value },
    });
  }

  console.log('\nContenu public');
  await seedPublicContent();

  // --- Recapitulatif --------------------------------------------------------
  console.log('\n--- Identifiants ---');
  console.log("Ces mots de passe ne sont affiches qu'ici et ne sont stockes nulle part.");
  console.log('Chaque compte devra en changer a sa premiere connexion.\n');

  if (admin.created || !adminPassword.generated) {
    console.log('  Administrateur');
    console.log(`    ${adminEmail}`);
    console.log(
      `    ${adminPassword.generated ? adminPassword.value : '(valeur de SEED_ADMIN_PASSWORD)'}`,
    );
  } else {
    console.log('  Administrateur : compte deja existant, mot de passe inchange.');
  }

  const demoEmails = [...createdTeam];
  if (clientAccount.created) demoEmails.push('marc.delaunay@comexa.example');

  if (demoEmails.length > 0 || !demoPassword.generated) {
    console.log('\n  Equipe et client de demonstration');
    for (const email of demoEmails) console.log(`    ${email}`);
    console.log(
      `    ${demoPassword.generated ? demoPassword.value : '(valeur de SEED_DEMO_PASSWORD)'}`,
    );
    if (demoEmails.length < team.length + 1) {
      console.log(
        '    (seuls les comptes nouvellement crees sont listes ; les autres gardent leur mot de passe)',
      );
    }
  } else {
    console.log('\n  Comptes de demonstration : deja existants, mots de passe inchanges.');
  }

  console.log('\n  Point de depart du parcours metier :');
  console.log(
    `    Prospect ${formatReference(REFERENCE_PREFIXES.PROSPECT, REFERENCE_SEED_YEAR, 1)} (Boulangerie Lefranc), statut QUALIFIED`,
  );
  console.log('    Responsable : sofia.benali@comexa.example');
  console.log(
    `    Un devis l\'attend : ${formatReference(REFERENCE_PREFIXES.QUOTE, REFERENCE_SEED_YEAR, 2)}, statut SENT.`,
  );
  console.log('    Son acceptation cree le client, le projet et la facture par le chemin reel.');

  console.log('\n  Dossier deja en cours, cote client :');
  console.log(
    `    Client ${formatReference(REFERENCE_PREFIXES.CLIENT, REFERENCE_SEED_YEAR, 1)} (Maison Vasseur)`,
  );
  console.log(
    `    Devis ${formatReference(REFERENCE_PREFIXES.QUOTE, REFERENCE_SEED_YEAR, 1)} ACCEPTED -> ` +
      `projet ${formatReference(REFERENCE_PREFIXES.PROJECT, REFERENCE_SEED_YEAR, 1)} IN_PROGRESS -> ` +
      `facture ${formatReference(REFERENCE_PREFIXES.INVOICE, REFERENCE_SEED_YEAR, 1)} PARTIALLY_PAID -> ` +
      `paiement ${formatReference(REFERENCE_PREFIXES.PAYMENT, REFERENCE_SEED_YEAR, 1)} SUCCEEDED`,
  );
  console.log(
    '    Comptes : marc.delaunay@comexa.example (CLIENT), sofia.benali@comexa.example (SALES)',
  );

  console.log('\nTermine.\n');
}

main()
  .catch((error: unknown) => {
    console.error('\nLe seed a echoue :');
    console.error(error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack && process.env.NODE_ENV !== 'production') {
      console.error(error.stack);
    }
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
