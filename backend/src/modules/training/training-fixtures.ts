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

import {
  REFERENCE_PREFIXES,
  type ReferenceScope,
} from '../../common/references/reference.scopes.js';
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
// Tolérance aux conflits d'unicité
// ---------------------------------------------------------------------------

/**
 * Violation de contrainte d'unicité Prisma (P2002) ?
 *
 * `enter` est appelé par le navigateur, donc PARFOIS EN PLUSIEURS EXEMPLAIRES
 * PARALLÈLES (double clic, bouton « commencer » qui entre en formation avant de
 * démarrer la mission...). Deux amorçages simultanés qui créent le même objet
 * fictif produisent un P2002 chez le perdant : ce n'est PAS une erreur, c'est la
 * preuve que l'objet existe — on le constate et on continue. Sans cette
 * tolérance, un double clic suffisait à afficher « Cette valeur existe deja ».
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Surface de delegate Prisma utilisée par la réconciliation du miroir.
 *
 * Les paramètres sont volontairement larges (`Record<string, unknown>`,
 * `unknown`) : ce contrat structurel doit accepter un VRAI delegate Prisma
 * (`training.permission`, `training.role`, `training.user`) sans conversion —
 * la bivariance des méthodes fait le reste — et un delegate simulé dans les
 * tests (`backend/tests/training-fixtures.spec.ts`).
 */
export interface MirrorDelegate {
  findUnique(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>;
  findFirst(args: { where?: Record<string, unknown> }): Promise<{ id: string } | null>;
  create(args: { data: unknown }): Promise<unknown>;
  update(args: { where: Record<string, unknown>; data: unknown }): Promise<unknown>;
  delete(args: { where: Record<string, unknown> }): Promise<unknown>;
  upsert(args: {
    where: Record<string, unknown>;
    create: unknown;
    update: unknown;
  }): Promise<unknown>;
}

/**
 * RÉCONCILIE UNE LIGNE D'IDENTITÉ entre production et base d'entraînement.
 *
 * Le miroir doit garantir une chose : la base d'exercice contient la ligne de
 * production SOUS LE MÊME IDENTIFIANT (les écritures métier fictives portent des
 * `userId` réels). Un `upsert` par `id` seul ne suffit PAS, et c'est une panne
 * réelle observée en production (2026-10-21) : si la base d'entraînement contient
 * une ligne PERIMEE portant la même clé naturelle (`email`, `code`) sous un AUTRE
 * identifiant — base semée indépendamment, compte créé pendant un déploiement
 * défectueux, identité de production recréée — le `create` de l'upsert heurte la
 * contrainte d'unicité (P2002) à CHAQUE `enter`, et même `POST /training/reset`
 * n'y change rien (les identités ne sont volontairement pas tronquées). Le
 * parcours devenait inaccessible avec « Cette valeur existe deja (inconnu) ».
 *
 * La réconciliation, dans l'ordre :
 *  1. une ligne périmée porte la clé naturelle sous un autre id ?
 *     - si l'id de production est LIBRE : on REPOINTE la ligne périmée vers lui
 *       (la mise à jour de clé primaire cascade — défaut `onUpdate` de Prisma —
 *       les écritures d'exercice déjà liées suivent le mouvement) ;
 *     - si l'id de production est DÉJÀ présent : la ligne périmée est un doublon
 *       sans owner réel, on la supprime (ses liens suivent leurs `onDelete`) ;
 *  2. upsert par id de production ;
 *  3. si un miroir CONCURRENT a créé la ligne entre-temps (P2002), on réconcilie
 *     une fois puis on rejoue l'upsert.
 */
export async function mirrorRow(
  delegate: MirrorDelegate,
  spec: {
    id: string;
    naturalKey: Record<string, unknown>;
    create: unknown;
    update: Record<string, unknown>;
  },
): Promise<void> {
  const stale = await delegate.findFirst({ where: spec.naturalKey });
  if (stale && stale.id !== spec.id) {
    const holder = await delegate.findUnique({ where: { id: spec.id } });
    if (holder) {
      await delegate.delete({ where: { id: stale.id } });
    } else {
      await delegate.update({ where: { id: stale.id }, data: { id: spec.id, ...spec.update } });
      return;
    }
  }

  try {
    await delegate.upsert({ where: { id: spec.id }, create: spec.create, update: spec.update });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const blocker = await delegate.findFirst({ where: spec.naturalKey });
    if (blocker && blocker.id !== spec.id) {
      await delegate.delete({ where: { id: blocker.id } });
    }
    await delegate.upsert({ where: { id: spec.id }, create: spec.create, update: spec.update });
  }
}

/**
 * Crée un objet de fixture ; si un amorçage concurrent l'a créé entre le test
 * d'existence et le `create` (P2002), rend `null` au lieu de propager l'erreur :
 * l'objet existe, c'est exactement le résultat voulu.
 */
async function createSkippingConflict<T>(create: () => Promise<T>): Promise<T | null> {
  try {
    return await create();
  } catch (error) {
    if (isUniqueConstraintError(error)) return null;
    throw error;
  }
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

  // Chaque ligne est RÉCONCILIÉE (voir `mirrorRow`), pas simplement upsertée :
  // une base d'entraînement qui contient déjà la même clé naturelle sous un
  // autre identifiant ne doit plus jamais bloquer l'entrée en formation.
  for (const permission of permissions) {
    await mirrorRow(training.permission, {
      id: permission.id,
      naturalKey: { code: permission.code },
      create: permission,
      update: {
        resource: permission.resource,
        action: permission.action,
        scope: permission.scope,
        description: permission.description,
      },
    });
  }
  for (const role of roles) {
    await mirrorRow(training.role, {
      id: role.id,
      naturalKey: { code: role.code },
      create: role,
      update: { name: role.name, description: role.description, isSystem: role.isSystem },
    });
  }
  for (const user of users) {
    await mirrorRow(training.user, {
      id: user.id,
      naturalKey: { email: user.email },
      create: user,
      update: user,
    });
  }
  for (const link of userRoles) {
    try {
      await training.userRole.upsert({
        where: { userId_roleId: { userId: link.userId, roleId: link.roleId } },
        create: link,
        update: {},
      });
    } catch (error) {
      // Deux miroirs parallèles peuvent lier la même paire : le lien existe,
      // c'est le résultat cherché.
      if (!isUniqueConstraintError(error)) throw error;
    }
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
    contact: {
      firstName: 'Nadia',
      lastName: 'Belkacem',
      email: 'nadia.belkacem@coop-numerique.example',
    },
  },
  {
    companyName: 'Cabinet Falconi',
    sector: 'conseil',
    city: 'Oran',
    contact: {
      firstName: 'Karim',
      lastName: 'Falconi',
      email: 'karim.falconi@cabinet-falconi.example',
    },
  },
  {
    companyName: 'Dar El Mahatta',
    sector: 'restauration',
    city: 'Oran',
    contact: { firstName: 'Samira', lastName: 'Hadj', email: 'samira.hadj@dar-el-mahatta.example' },
  },
];

const PROSPECTS = [
  {
    companyName: 'Maison Yacine',
    contactFirstName: 'Yacine',
    contactLastName: 'Amrani',
    email: 'contact@maison-yacine.example',
  },
  {
    companyName: 'Studio Falco',
    contactFirstName: 'Elena',
    contactLastName: 'Falco',
    email: 'elena@studio-falco.example',
  },
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
      // `createSkippingConflict` : un second `enter` parallèle a pu créer la
      // même ligne entre le test et le create — l'objet existe, rien à faire.
      await createSkippingConflict(async () =>
        db.prospect.create({
          data: {
            reference: await nextReference(db, 'PROSPECT'),
            ...prospect,
            status: 'NEW',
            source: 'OTHER',
          },
        }),
      );
    }
  }

  // Clients, contacts, projets, jalons.
  for (const fixture of CLIENTS) {
    let client = await db.client.findFirst({ where: { companyName: fixture.companyName } });
    if (!client) {
      const created = await createSkippingConflict(async () =>
        db.client.create({
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
        }),
      );
      // Conflit gagné par un amorçage parallèle : relire la ligne existante.
      client =
        created ?? (await db.client.findFirst({ where: { companyName: fixture.companyName } }));
    }
    if (!client) continue;

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
        await createSkippingConflict(() =>
          db.milestone.create({
            data: { projectId: project.id, title: 'Cadrage', dueDate: inDays(7), order: 1 },
          }),
        );
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
      const created = await createSkippingConflict(async () =>
        db.quote.create({
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
        }),
      );
      if (created) await recomputeQuoteTotal(db, created.id);
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
      // Facture ET paiement d'un seul tenant : si un amorçage parallèle gagne la
      // création, les deux lignes existent déjà chez lui — rien à rejouer.
      await createSkippingConflict(async () => {
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
        return created;
      });
    }
  }
}

/**
 * Projet de fixture, cherché PAR CLIENT et non par seul nom.
 *
 * Chercher par nom seul était un bug réel : « Portail client » existe pour Dar
 * El Mahatta (environnement partagé) ET pour chaque compte d'espace client
 * (son dossier). La recherche par nom rendait le projet PARTAGÉ du bac à sable
 * au premier appelant, et le dossier client héritait du projet d'un autre
 * client. Le couple (nom, client) est la vraie identité d'un projet de fixture.
 */
async function ensureProject(
  db: Db,
  data: { name: string; clientId: string; description: string },
) {
  const where = { name: data.name, clientId: data.clientId };
  const existing = await db.project.findFirst({ where });
  if (existing) return existing;
  try {
    return await db.project.create({
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
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const concurrent = await db.project.findFirst({ where });
    if (!concurrent) throw error;
    return concurrent;
  }
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
    const clientId = user.clientId;
    let client = await db.client.findUnique({ where: { id: clientId } });
    if (!client) {
      // Référence dans une plage réservée aux dossiers de formation : elle ne
      // concurrence jamais la séquence des documents créés via l'API. Si la
      // tranche courte est déjà prise par UNE AUTRE ligne (deux comptes dont
      // les identifiants terminent pareil), `reserveDossierReference` allonge
      // la tranche au lieu de mourir sur la contrainte d'unicité.
      for (let attempt = 0; attempt < 3 && !client; attempt += 1) {
        try {
          client = await db.client.create({
            data: {
              id: clientId,
              reference: await reserveDossierReference(db, clientId),
              companyName: `Dossier de ${user.firstName || user.email}`,
              country: 'Algérie',
              currency: 'DZD',
              status: 'ACTIVE',
            },
          });
        } catch (error) {
          if (!isUniqueConstraintError(error)) throw error;
          // Course avec un autre `enter` : le dossier existe déjà sous cet id.
          client = await db.client.findUnique({ where: { id: clientId } });
        }
      }
      if (!client) {
        throw new Error(
          `Dossier de formation impossible pour le client ${clientId} : référence réservée indisponible.`,
        );
      }
    }

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
        await createSkippingConflict(() =>
          db.task.create({
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
          }),
        );
      }
    }
  }
}

/**
 * Référence réservée au dossier d'un compte client (plage `9…`, hors séquence
 * des compteurs). La tranche s'allonge tant qu'une AUTRE ligne client occupe la
 * candidate : deux comptes dont les identifiants terminent par les mêmes
 * caractères ne doivent pas pouvoir bloquer l'entrée en formation.
 */
async function reserveDossierReference(db: Db, clientId: string): Promise<string> {
  for (const depth of [4, 8, 12, 20]) {
    const reference = `CLI-${YEAR}-9${clientId.slice(-depth).toUpperCase()}`;
    const holder = await db.client.findFirst({ where: { reference } });
    if (!holder || holder.id === clientId) return reference;
  }
  return `CLI-${YEAR}-9${clientId.toUpperCase()}`;
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
  let created;
  try {
    created = await db.quote.create({
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
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    // Un amorçage parallèle a créé le même devis : recalculer ses totaux suffit
    // (le gagnant a pu être interrompu avant son propre recalcul).
    created = await db.quote.findFirst({
      where: { clientId: data.clientId, subject: data.subject },
    });
    if (!created) throw error;
  }
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
