import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ClientStatus,
  ContentStatus,
  PrismaClient,
  RoleCode,
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
      role: RoleCode.SOCIAL_MEDIA_MANAGER,
      jobTitle: 'Gestion reseaux sociaux',
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

  for (const spec of team) {
    const result = await upsertAccount(spec, demoHash);
    if (result.created) createdTeam.push(spec.email);
    if (spec.role === RoleCode.SALES) salesUserId = result.id;
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

  // AUCUN DOCUMENT N'EST ÉCRIT PAR LE SEED : les compteurs de devis, projet,
  // facture et paiement restent à zéro, pour que le premier document créé par
  // l'API prenne le numéro 1 et non un numéro déjà pris par une donnée
  // d'exemple. `value: 0` est écrit explicitement plutôt que laissé implicite :
  // un compteur absent ferait démarrer la numérotation à 1 quand même, mais
  // l'expliciter évite de s'en remettre à une valeur par défaut qu'on ne voit
  // pas depuis ce fichier.
  for (const scope of [
    REFERENCE_SCOPES.QUOTE,
    REFERENCE_SCOPES.PROJECT,
    REFERENCE_SCOPES.INVOICE,
    REFERENCE_SCOPES.PAYMENT,
  ]) {
    await prisma.counter.upsert({
      where: { scope_year: { scope, year: REFERENCE_SEED_YEAR } },
      create: { scope, year: REFERENCE_SEED_YEAR, value: 0 },
      update: { value: 0 },
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

  console.log("\n  Aucune donnee metier n'est injectee :");
  console.log('    ni devis, ni projet, ni tache, ni facture, ni paiement.');
  console.log("    Le premier document cree par l'API prend le numero 1.");
  console.log(
    `    Le seul client present, ${formatReference(REFERENCE_PREFIXES.CLIENT, REFERENCE_SEED_YEAR, 1)}, ` +
      'est une coquille vide : il rend le role CLIENT connectable.',
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
