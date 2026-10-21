/**
 * JEUX DE DONNÉES DE FORMATION — amorçage de la base d'entraînement.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE FICHIER FABRIQUE
 * ---------------------------------------------------------------------------
 *  1. UN MIROIR D'IDENTITÉS : les comptes réels (utilisateurs, rôles,
 *     permissions) sont recopiés dans la base d'entraînement, avec les MÊMES
 *     identifiants. Les services métier lient les objets à des `userId` réels
 *     (auteur, assigné, responsable) : sans ce miroir, aucune relation ne
 *     résoudrait dans la base fictive. Les mots de passe y sont inutilisables
 *     par conception — l'authentification passe TOUJOURS par la production.
 *
 *  2. DES DONNÉES MÉTIER FICTIVES COHÉRENTES : clients, contacts, projets,
 *     jalons, tâches assignées, devis (dont un devis FAUTIF pour la mission de
 *     correction d'erreurs), facture, paiement, prospects. Chaque nom est
 *     choisi pour ne JAMAIS heurter les cibles des missions : les objets que le
 *     membre doit créer lui-même (« Atelier Ziryab », « Maison Yacine »,
 *     « Site vitrine Coopérative Numérique »...) n'existent pas ici.
 *
 *  3. DES DOSSIERS PAR MEMBRE : pour un compte d'espace client, son client
 *     (même identifiant qu'en production), un projet en cours et deux devis en
 *     attente — la situation de départ des missions client.
 *
 * La numérotation des références suit la MÊME politique que l'application
 * (`REFERENCE_PREFIXES`, `formatReference`) et alimente les compteurs de la
 * base d'entraînement : le premier document créé par l'API de formation prend
 * le numéro qui suit les fixtures, jamais un numéro déjà pris.
 */

import { REFERENCE_PREFIXES, type ReferenceScope } from '../../common/references/reference.scopes.js';
import { formatReference, referenceYear } from '../../modules/counters/reference.js';
import type { PrismaClient } from '../../generated/prisma/client.js';

type Db = PrismaClient;

const YEAR = referenceYear();

/** Ligne de document financier structurée (position, titre, total de ligne). */
function lineItem(description: string, unitPrice: number, position: number, quantity = 1) {
  return {
    position,
    title: description,
    description,
    quantity,
    unitPrice,
    lineTotal: quantity * unitPrice,
  };
}

/** Attribue une référence dans la continuité des fixtures (compteur d'entraînement). */
async function nextReference(db: Db, scope: ReferenceScope): Promise<string> {
  const updated = await db.counter.upsert({
    where: { scope_year: { scope, year: YEAR } },
    create: { scope, year: YEAR, value: 1 },
    update: { value: { increment: 1 } },
  });
  return formatReference(REFERENCE_PREFIXES[scope], YEAR, updated.value);
}

// ---------------------------------------------------------------------------
// 1. Miroir d'identités
// ---------------------------------------------------------------------------

/**
 * Recopie utilisateurs, rôles, permissions et attributions dans la base
 * d'entraînement (mêmes identifiants). Idempotent : chaque `enter` rafraîchit
 * le miroir, un membre nouveau apparaît tout de suite dans les listes fictives.
 */
export async function mirrorIdentities(prod: Db, training: Db): Promise<void> {
  const [users, roles, permissions, userRoles] = await Promise.all([
    prod.user.findMany(),
    prod.role.findMany(),
    prod.permission.findMany(),
    prod.userRole.findMany(),
  ]);

  for (const permission of permissions) {
    await training.permission.upsert({
      where: { id: permission.id },
      create: permission,
      update: { description: permission.description },
    });
  }
  for (const role of roles) {
    await training.role.upsert({
      where: { id: role.id },
      create: role,
      update: { name: role.name, description: role.description },
    });
  }
  for (const user of users) {
    await training.user.upsert({ where: { id: user.id }, create: user, update: user });
  }
  for (const link of userRoles) {
    await training.userRole.upsert({
      where: { userId_roleId: { userId: link.userId, roleId: link.roleId } },
      create: link,
      update: {},
    });
  }
}

// ---------------------------------------------------------------------------
// 2. Données métier fictives (environnement partagé)
// ---------------------------------------------------------------------------

const SERVICES = [
  {
    slug: 'creation-site-web',
    title: 'Création de site web',
    shortDescription: 'Sites vitrines et institutionnels, sur mesure.',
    description: 'Sites vitrines et institutionnels, conçus sur mesure.',
  },
  {
    slug: 'application-web-metier',
    title: 'Application web métier',
    shortDescription: 'Des outils internes qui suivent vos processus réels.',
    description: 'Des outils internes qui suivent vos processus réels.',
  },
  {
    slug: 'boutique-en-ligne',
    title: 'Boutique en ligne',
    shortDescription: 'E-commerce complet, paiement et logistique inclus.',
    description: 'E-commerce complet, paiement et logistique inclus.',
  },
  {
    slug: 'identite-visuelle',
    title: 'Identité visuelle',
    shortDescription: 'Logos, chartes et supports de communication.',
    description: 'Logos, chartes et supports de communication.',
  },
  {
    slug: 'referencement-naturel',
    title: 'Référencement naturel',
    shortDescription: 'SEO technique et éditorial.',
    description: 'SEO technique et éditorial, suivi des positions.',
  },
  {
    slug: 'maintenance-et-evolution',
    title: 'Maintenance et évolution',
    shortDescription: 'Supervision, corrections et évolutions.',
    description: 'Supervision, corrections et évolutions régulières.',
  },
];

interface FixtureClient {
  readonly companyName: string;
  readonly sector: string;
  readonly city: string;
  readonly contact: { firstName: string; lastName: string; email: string };
}

const CLIENTS: readonly FixtureClient[] = [
  {
    companyName: 'Coopérative Numérique',
    sector: 'collectif',
    city: 'Alger',
    contact: { firstName: 'Nadia', lastName: 'Belkacem', email: 'nadia.belkacem@coop-numerique.example' },
  },
  {
    companyName: 'Cabinet Falconi',
    sector: 'conseil',
    city: 'Oran',
    contact: { firstName: 'Karim', lastName: 'Falconi', email: 'karim.falconi@cabinet-falconi.example' },
  },
  {
    companyName: 'Dar El Mahatta',
    sector: 'restauration',
    city: 'Oran',
    contact: { firstName: 'Samira', lastName: 'Hadj', email: 'samira.hadj@dar-el-mahatta.example' },
  },
];

const PROSPECTS = [
  { companyName: 'Maison Yacine', contactFirstName: 'Yacine', contactLastName: 'Amrani', email: 'contact@maison-yacine.example' },
  { companyName: 'Studio Falco', contactFirstName: 'Elena', contactLastName: 'Falco', email: 'elena@studio-falco.example' },
];

/**
 * Amorce les données métier partagées. Idempotent (création si absence) :
 * l'appel se fait au premier accès et à chaque `enter`, sans jamais détruire
 * le travail en cours des membres.
 */
export async function ensureSharedFixtures(db: Db): Promise<void> {
  // Contenus du site public (le CMS de formation a besoin de lignes à éditer).
  for (const service of SERVICES) {
    await db.service.upsert({
      where: { slug: service.slug },
      create: service,
      update: {},
    });
  }

  // Prospects à qualifier (liste Prospects non vide, missions commerciales).
  for (const prospect of PROSPECTS) {
    const exists = await db.prospect.findFirst({ where: { email: prospect.email } });
    if (!exists) {
      await db.prospect.create({
        data: {
          reference: await nextReference(db, 'PROSPECT'),
          ...prospect,
          status: 'NEW',
          source: 'OTHER',
        },
      });
    }
  }

  // Clients, contacts, projets, jalons.
  for (const fixture of CLIENTS) {
    let client = await db.client.findFirst({ where: { companyName: fixture.companyName } });
    if (!client) {
      client = await db.client.create({
        data: {
          reference: await nextReference(db, 'CLIENT'),
          companyName: fixture.companyName,
          sector: fixture.sector,
          city: fixture.city,
          country: 'Algérie',
          currency: 'DZD',
          status: 'ACTIVE',
          contacts: {
            create: {
              firstName: fixture.contact.firstName,
              lastName: fixture.contact.lastName,
              email: fixture.contact.email,
              isPrimary: true,
            },
          },
        },
      });
    }

    const coop = client.companyName === 'Coopérative Numérique';
    const mahatta = client.companyName === 'Dar El Mahatta';

    if (coop) {
      // Projet d'accueil des tâches assignées, jalon de découverte.
      const project = await ensureProject(db, {
        name: 'Refonte site vitrine',
        clientId: client.id,
        description: 'Refonte du site vitrine de la Coopérative Numérique.',
      });
      const milestoneExists = await db.milestone.findFirst({
        where: { projectId: project.id, title: 'Cadrage' },
      });
      if (!milestoneExists) {
        await db.milestone.create({
          data: { projectId: project.id, title: 'Cadrage', dueDate: inDays(7), order: 1 },
        });
      }
    }

    if (mahatta) {
      // Projet du dossier client (mission « demander une modification »).
      await ensureProject(db, {
        name: 'Portail client',
        clientId: client.id,
        description: 'Portail de suivi des commandes de Dar El Mahatta.',
      });
    }
  }

  // Le devis FAUTIF de la mission « détecter et corriger les erreurs » :
  // brouillon « Création de site web » pour Cabinet Falconi, avec une ligne
  // « Maintenance et évolution » qui n'a jamais été négociée.
  const falconi = await db.client.findFirst({ where: { companyName: 'Cabinet Falconi' } });
  if (falconi) {
    const faulty = await db.quote.findFirst({
      where: { clientId: falconi.id, subject: 'Création de site web' },
    });
    if (!faulty) {
      const created = await db.quote.create({
        data: {
          reference: await nextReference(db, 'QUOTE'),
          subject: 'Création de site web',
          clientId: falconi.id,
          status: 'DRAFT',
          currency: 'DZD',
          year: YEAR,
          issueDate: new Date(),
          items: {
            create: [
              lineItem('Création de site web', 180000, 1),
              // LIGNE ERRONÉE : à retirer dans la mission de correction.
              lineItem('Maintenance et évolution', 60000, 2),
            ],
          },
        },
      });
      await recomputeQuoteTotal(db, created.id);
    }
  }

  // Facture réglée + paiement (exemples de consultation, espace client et
  // rubrique Factures) sur la Coopérative Numérique.
  const coop = await db.client.findFirst({ where: { companyName: 'Coopérative Numérique' } });
  if (coop) {
    const invoice = await db.invoice.findFirst({
      where: { clientId: coop.id, reference: { startsWith: `FAC-${YEAR}-` } },
    });
    if (!invoice) {
      const created = await db.invoice.create({
        data: {
          reference: await nextReference(db, 'INVOICE'),
          clientId: coop.id,
          status: 'PAID',
          type: 'STANDARD',
          currency: 'DZD',
          year: YEAR,
          issueDate: inDays(-30),
          dueDate: inDays(-2),
          subtotal: 90000,
          total: 90000,
          items: {
            create: [lineItem('Création de site web — acompte', 90000, 1)],
          },
        },
      });
      await db.payment.create({
        data: {
          reference: await nextReference(db, 'PAYMENT'),
          invoiceId: created.id,
          amount: 90000,
          currency: 'DZD',
          method: 'BANK_TRANSFER',
          status: 'SUCCEEDED',
          paidAt: inDays(-5),
        },
      });
    }
  }
}

async function ensureProject(
  db: Db,
  data: { name: string; clientId: string; description: string },
) {
  const existing = await db.project.findFirst({ where: { name: data.name } });
  if (existing) return existing;
  return db.project.create({
    data: {
      reference: await nextReference(db, 'PROJECT'),
      name: data.name,
      description: data.description,
      clientId: data.clientId,
      status: 'IN_PROGRESS',
      currency: 'DZD',
      startDate: inDays(-14),
      dueDate: inDays(45),
    },
  });
}

// ---------------------------------------------------------------------------
// 3. Dossiers et tâches par membre
// ---------------------------------------------------------------------------

/**
 * Objets propres à un membre, recréés à chaque `enter` s'ils manquent :
 *
 *  - un compte d'espace client reçoit SON client (identique à la production),
 *    un projet en cours et les deux devis de ses missions ;
 *  - tout membre d'équipe reçoit une tâche assignée « Préparer la maquette »
 *    (situation de départ de la mission « prendre en charge une tâche »).
 */
export async function ensureUserFixtures(db: Db, userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user) return;

  const isClient = await hasOnlyClientRole(db, userId);

  if (user.clientId) {
    const client = await db.client.upsert({
      where: { id: user.clientId },
      create: {
        id: user.clientId,
        // Référence dans une plage réservée aux dossiers de formation : elle ne
        // concurrence jamais la séquence des documents créés via l'API.
        reference: `CLI-${YEAR}-9${user.clientId.slice(-4).toUpperCase()}`,
        companyName: `Dossier de ${user.firstName || user.email}`,
        country: 'Algérie',
        currency: 'DZD',
        status: 'ACTIVE',
      },
      update: {},
    });

    await ensureProject(db, {
      name: 'Portail client',
      clientId: client.id,
      description: 'Portail de suivi de votre dossier.',
    });

    // Devis de la mission client : « Site vitrine » (à répondre) et
    // « Évolution catalogue » (évaluation finale).
    const siteQuote = await db.quote.findFirst({
      where: { clientId: client.id, subject: 'Site vitrine' },
    });
    if (!siteQuote) {
      await createQuoteWithItems(db, {
        subject: 'Site vitrine',
        clientId: client.id,
        items: [lineItem('Site vitrine — phase 1', 150000, 1)],
      });
    }
    const catalogQuote = await db.quote.findFirst({
      where: { clientId: client.id, subject: 'Évolution catalogue' },
    });
    if (!catalogQuote) {
      await createQuoteWithItems(db, {
        subject: 'Évolution catalogue',
        clientId: client.id,
        items: [lineItem('Évolution catalogue — périmètre à définir', 80000, 1)],
      });
    }
  }

  if (!isClient) {
    const project = await db.project.findFirst({ where: { name: 'Refonte site vitrine' } });
    if (project) {
      const assigned = await db.task.findFirst({
        where: { title: 'Préparer la maquette', assigneeId: userId, projectId: project.id },
      });
      if (!assigned) {
        await db.task.create({
          data: {
            title: 'Préparer la maquette',
            description:
              'Maquette de la page d’accueil du site en refonte. Situation de formation : traitée comme une tâche réelle.',
            projectId: project.id,
            assigneeId: userId,
            reporterId: userId,
            status: 'TODO',
            priority: 'NORMAL',
            dueDate: inDays(5),
            isClientVisible: false,
          },
        });
      }
    }
  }
}

async function hasOnlyClientRole(db: Db, userId: string): Promise<boolean> {
  const links = await db.userRole.findMany({
    where: { userId },
    include: { role: true },
  });
  return links.length > 0 && links.every((link) => link.role?.code === 'CLIENT');
}

async function createQuoteWithItems(
  db: Db,
  data: {
    subject: string;
    clientId: string;
    items: ReturnType<typeof lineItem>[];
  },
): Promise<void> {
  const created = await db.quote.create({
    data: {
      reference: await nextReference(db, 'QUOTE'),
      subject: data.subject,
      clientId: data.clientId,
      status: 'SENT',
      currency: 'DZD',
      year: YEAR,
      issueDate: new Date(),
      items: { create: data.items },
    },
  });
  await recomputeQuoteTotal(db, created.id);
}

/** Recalcule les totaux d'un devis depuis ses lignes (comme le fait l'API). */
async function recomputeQuoteTotal(db: Db, quoteId: string): Promise<void> {
  const items = await db.quoteItem.findMany({ where: { quoteId } });
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.unitPrice) * Number(item.quantity),
    0,
  );
  await db.quote.update({
    where: { id: quoteId },
    data: { subtotal, total: subtotal },
  });
}

function inDays(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

// ---------------------------------------------------------------------------
// Réinitialisation complète
// ---------------------------------------------------------------------------

/**
 * Tables métier vidées par une réinitialisation — dans l'ordre des dépendances
 * inversé, `TRUNCATE ... CASCADE` se charge du reste.
 *
 * EXCLUES, volontairement :
 *  - `users`, `roles`, `permissions`, `user_roles` : le miroir d'identités est
 *    REFRESHI par `mirrorIdentities`, pas laissé vide ;
 *  - `_prisma_migrations` : la base reste « migrée ».
 */
const TRUNCATE_TABLES = [
  'message_read_receipts',
  'message_resources',
  'balance_transactions',
  'member_balances',
  'distribution_history',
  'distribution_items',
  'project_distributions',
  'distribution_beneficiaries',
  'distribution_configs',
  'exchange_rates',
  'currencies',
  'reports',
  'audit_logs',
  'settings',
  'counters',
  'telegram_links',
  'documents',
  'daily_reports',
  'timer_sessions',
  'time_entries',
  'goal_tasks',
  'goals',
  'calendar_event_participants',
  'calendar_events',
  'activities',
  'notifications',
  'messages',
  'message_attachments',
  'conversation_participants',
  'conversations',
  'payments',
  'invoice_items',
  'invoices',
  'quote_items',
  'quotes',
  'tasks',
  'milestones',
  'project_members',
  'projects',
  'modification_requests',
  'contacts',
  'clients',
  'orders',
  'project_requests',
  'package_rates',
  'lead_status_history',
  'prospects',
  'contact_requests',
  'testimonials',
  'case_studies',
  'case_study_categories',
  'partners',
  'faqs',
  'packages',
  'services',
];

/** Vide la base d'entraînement (jamais la production) et renvoie le nombre de tables vidées. */
export async function wipeTrainingData(db: Db): Promise<number> {
  // Vérification de vie : une requête de réinitialisation ne doit pouvoir
  // parler qu'à la base d'entraînement. `db` est toujours `trainingClient` —
  // la garde ci-dessous refuse poliment si un appelant se trompe.
  const tables = TRUNCATE_TABLES.map((name) => `"${name}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  return TRUNCATE_TABLES.length;
}
