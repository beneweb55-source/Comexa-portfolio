// En PREMIER, et volontairement : la classe importee plus bas est decoree
// (`@Cron`), et un decorateur applique appelle `Reflect.defineMetadata`. Le
// polyfill etait jusqu'ici charge par le graphe d'imports de `@nestjs/schedule`
// — donc par effet de bord d'un autre paquet. Ce fichier lit lui-meme les
// metadonnees du decorateur : il ne depend pas du graphe de quelqu'un d'autre.
import 'reflect-metadata';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CronExpression } from '@nestjs/schedule';
import type { AuditEntry, AuditService } from '../../common/audit/audit.service.js';
import type { Activity, Notification, Prisma } from '../../generated/prisma/client.js';
import {
  ActivityType,
  InvoiceStatus,
  NotificationType,
  UserStatus,
} from '../../generated/prisma/enums.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { ActivityInput, ActivityService } from '../activity/activity.service.js';
import type { NotificationInput, NotificationService } from '../notifications/notification.service.js';
import {
  SWEEPABLE_INVOICE_STATUSES,
  isOverdueCandidate,
  overdueActivityMessage,
  overdueCandidatesWhere,
  overdueNotification,
} from './invoice-overdue.js';
import { InvoiceOverdueService } from './invoice-overdue.service.js';
import { money } from './money.js';

/**
 * BALAYAGE DES ECHEANCES — LA REGLE, ET LE GESTE QUI L'APPLIQUE.
 *
 * DEUX NIVEAUX, ET LES DEUX SONT TESTES ICI.
 *
 *  1. `invoice-overdue.ts` — la DECISION, parcourue statut par statut. C'est elle
 *     qui dit non a un `SENT` dont l'echeance n'est pas passee, ou a un `SENT`
 *     deja solde. Aucune base, aucune horloge : ce sont des fonctions.
 *  2. `InvoiceOverdueService.sweepOverdue` — le GESTE. La date est un PARAMETRE
 *     (`sweepOverdue(now)`), donc rien n'attend et l'heure a laquelle la suite
 *     tourne n'a aucune influence : deux dates separees d'une milliseconde
 *     suffisent a tester « l'echeance est passee ».
 *
 * LE SERVICE EST CONSTRUIT A LA MAIN, avec des doublures, et non par
 * `Test.createTestingModule` : les suites unitaires tournent sous tsx/esbuild,
 * qui n'emet pas `design:paramtypes`, donc l'injection Nest ne resout pas les
 * dependances d'un service non compile. Les doublures ne sont pas un pis-aller :
 * elles permettent de faire ce qu'aucune base ne laisse faire depuis un test —
 * rendre une liste PLUS LARGE que le pre-filtre, perdre la reclamation contre un
 * encaissement concurrent, ou faire echouer une ligne sur deux.
 *
 * CE QUE LA DOUBLURE HONORE, ET POURQUOI C'EST LE POINT. Elle filtre selon le
 * `where` recu et ne rend que les colonnes du `select`. Une doublure qui rendrait
 * toute la ligne masquerait une colonne oubliee dans le `select` : le service
 * lirait `undefined` en production et la bonne valeur ici. Avec cette fidelite,
 * retirer `status` du `select` fait echouer le test comme la base le ferait.
 *
 * L'IDEMPOTENCE EST PROUVEE, PAS AFFIRMEE. Deux executions sont faites, et la
 * seconde n'ecrit rien et ne notifie personne. Mais comme elle ne VOIT plus rien
 * (le pre-filtre ne rend que des `SENT`), ce cas ne prouve pas que la reclamation
 * est gardee : c'est le cas « reclamation perdue » qui le prouve, en rejouant une
 * ligne que la lecture avait bien rendue. La notification suit la RECLAMATION,
 * jamais la lecture — c'est cette propriete-la qui evite la relance en double
 * quand deux instances balaient au meme moment.
 */

const NOW = new Date('2026-03-15T12:00:00.000Z');
/** Une echeance depassee, et une qui ne l'est pas. */
const LATE = new Date('2026-03-01T09:00:00.000Z');
const TOMORROW = new Date('2026-03-16T09:00:00.000Z');

const ALL_STATUSES: readonly InvoiceStatus[] = [
  InvoiceStatus.DRAFT,
  InvoiceStatus.SENT,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.PAID,
  InvoiceStatus.OVERDUE,
  InvoiceStatus.CANCELLED,
  InvoiceStatus.REFUNDED,
];

describe('isOverdueCandidate', () => {
  it('n accepte QUE le statut SENT, sur toute l enumeration', () => {
    const expected: Record<InvoiceStatus, boolean> = {
      [InvoiceStatus.DRAFT]: false,
      [InvoiceStatus.SENT]: true,
      [InvoiceStatus.PARTIALLY_PAID]: false,
      [InvoiceStatus.PAID]: false,
      [InvoiceStatus.OVERDUE]: false,
      [InvoiceStatus.CANCELLED]: false,
      [InvoiceStatus.REFUNDED]: false,
    };

    for (const status of ALL_STATUSES) {
      assert.equal(
        isOverdueCandidate(
          { status, dueDate: LATE, amountPaid: money('0.00'), total: money('1200.00') },
          NOW,
        ),
        expected[status],
        `statut ${status}`,
      );
    }
  });

  it('exige une echeance STRICTEMENT passee', () => {
    const at = (dueDate: Date): boolean =>
      isOverdueCandidate(
        { status: InvoiceStatus.SENT, dueDate, amountPaid: money('0.00'), total: money('1200.00') },
        NOW,
      );

    assert.equal(at(new Date(NOW.getTime() - 1)), true, 'une milliseconde avant : en retard');
    assert.equal(at(NOW), false, "a l'instant meme : pas encore en retard");
    assert.equal(at(new Date(NOW.getTime() + 1)), false);
  });

  it('exige un solde restant du, et le compare en decimal', () => {
    const withPaid = (amountPaid: string): boolean =>
      isOverdueCandidate(
        {
          status: InvoiceStatus.SENT,
          dueDate: LATE,
          amountPaid: money(amountPaid),
          total: money('1000.00'),
        },
        NOW,
      );

    assert.equal(withPaid('0.00'), true, 'rien recu');
    assert.equal(withPaid('999.99'), true, 'un centime manque encore');
    assert.equal(withPaid('1000.00'), false, 'soldee');
    // Un trop-percu n'est pas un retard : c'est un avoir a emettre.
    assert.equal(withPaid('1000.01'), false);
  });

  it('accepte un acompte : un SENT partiellement regle reste en retard', () => {
    assert.equal(
      isOverdueCandidate(
        {
          status: InvoiceStatus.SENT,
          dueDate: LATE,
          amountPaid: money('400.00'),
          total: money('1200.00'),
        },
        NOW,
      ),
      true,
    );
  });
});

describe('overdueCandidatesWhere', () => {
  it('ne vise que les factures parties, echues et non supprimees', () => {
    assert.deepEqual(overdueCandidatesWhere(NOW), {
      status: InvoiceStatus.SENT,
      dueDate: { lt: NOW },
      deletedAt: null,
    });
  });

  it('ne balaie qu un seul statut, et c est celui qui n a pas encore ete marque', () => {
    assert.deepEqual([...SWEEPABLE_INVOICE_STATUSES], [InvoiceStatus.SENT]);
  });
});

describe('overdueNotification', () => {
  it('reprend le type existant, la reference et le montant REEL de la piece', () => {
    const input = overdueNotification(
      row({ id: 'inv-x', reference: 'FAC-2026-0042', total: money('1250.50') }),
    );

    assert.equal(input.type, NotificationType.INVOICE_OVERDUE);
    assert.equal(input.title, 'Facture FAC-2026-0042 en retard');
    assert.equal(input.body, "La facture de 1250.50 EUR n'a pas ete reglee a son echeance.");
    assert.equal(input.link, '/factures/inv-x');
    assert.equal(input.entityType, 'Invoice');
    assert.equal(input.entityId, 'inv-x');
  });

  it('laisse la date d echeance hors de la phrase du fil d activite', () => {
    const message = overdueActivityMessage(row({ id: 'inv-x', reference: 'FAC-2026-0042' }));

    assert.match(message, /FAC-2026-0042/);
    assert.ok(!message.includes('2026-03-01'), 'la date reste dans metadata, pas dans le texte');
  });
});

// ---------------------------------------------------------------------------
// Le geste : le balayage, avec ses doublures.
// ---------------------------------------------------------------------------

interface FakeInvoice {
  id: string;
  reference: string;
  clientId: string;
  currency: string;
  total: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  dueDate: Date;
  status: InvoiceStatus;
  deletedAt: Date | null;
}

interface PortalUser {
  readonly id: string;
  readonly clientId: string;
  readonly status: string;
  readonly deletedAt: Date | null;
}

/** Le sous-ensemble de `InvoiceWhereInput` que le balayage utilise. */
interface WhereClause {
  readonly id?: string;
  readonly status?: InvoiceStatus;
  readonly deletedAt?: null;
  readonly dueDate?: { readonly lt?: Date };
}

interface FindManyArgs {
  readonly where?: WhereClause;
  readonly select?: Record<string, boolean>;
}

interface HarnessOptions {
  /**
   * Le lecteur ne filtre RIEN et rend tout ce qu'il a. Sert a verifier que la
   * decision n'est pas decorative : le pre-filtre SQL reduit, c'est la regle qui
   * protege.
   */
  readonly unfilteredReader?: boolean;
  /** Joue ce qu'un autre ecrivain fait entre la lecture et la reclamation. */
  readonly beforeClaim?: (invoice: FakeInvoice) => void;
  /** Fait echouer la reclamation d'une facture (panne de base sur une ligne). */
  readonly failClaimOn?: string;
  /**
   * Fait echouer la LECTURE elle-meme (`findMany`), avant toute ecriture. C'est
   * la panne que seul l'enveloppe planifiee peut rencontrer : le balayage n'a
   * encore rien fait, donc aucun `try` par ligne ne la rattrape.
   */
  readonly readFails?: boolean;
}

/** Une facture partie, echue, non payee : le cas nominal du balayage. */
function row(overrides: Partial<FakeInvoice> & Pick<FakeInvoice, 'id' | 'reference'>): FakeInvoice {
  return {
    clientId: 'client-a',
    currency: 'EUR',
    total: money('1200.00'),
    amountPaid: money('0.00'),
    dueDate: LATE,
    status: InvoiceStatus.SENT,
    deletedAt: null,
    ...overrides,
  };
}

const PORTAL_USERS: readonly PortalUser[] = [
  { id: 'user-porteur-1', clientId: 'client-a', status: UserStatus.ACTIVE, deletedAt: null },
  { id: 'user-porteur-2', clientId: 'client-a', status: UserStatus.ACTIVE, deletedAt: null },
  { id: 'user-autre-dossier', clientId: 'client-b', status: UserStatus.ACTIVE, deletedAt: null },
  { id: 'user-suspendu', clientId: 'client-a', status: UserStatus.SUSPENDED, deletedAt: null },
  {
    id: 'user-archive',
    clientId: 'client-a',
    status: UserStatus.ACTIVE,
    deletedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
];

/** Le `where` de Prisma, rejoue ligne par ligne. */
function matches(invoice: FakeInvoice, where: WhereClause | undefined): boolean {
  if (!where) {
    return true;
  }

  if (where.id !== undefined && invoice.id !== where.id) {
    return false;
  }

  if (where.status !== undefined && invoice.status !== where.status) {
    return false;
  }

  if (where.deletedAt === null && invoice.deletedAt !== null) {
    return false;
  }

  if (where.dueDate?.lt !== undefined && invoice.dueDate.getTime() >= where.dueDate.lt.getTime()) {
    return false;
  }

  return true;
}

/** Le `select` de Prisma : seules les colonnes demandees sortent. */
function project(invoice: FakeInvoice, select: Record<string, boolean> | undefined): FakeInvoice {
  if (!select) {
    return { ...invoice };
  }

  const out: Record<string, unknown> = {};

  for (const [column, wanted] of Object.entries(select)) {
    if (wanted) {
      out[column] = (invoice as unknown as Record<string, unknown>)[column];
    }
  }

  return out as unknown as FakeInvoice;
}

function harness(
  invoices: FakeInvoice[],
  users: readonly PortalUser[],
  options: HarnessOptions = {},
) {
  const updates: Array<{ id: string; status: InvoiceStatus }> = [];
  const notifications: Array<{ userId: string; input: NotificationInput }> = [];
  const activities: ActivityInput[] = [];
  const activityTransactions: Array<Prisma.TransactionClient | undefined> = [];
  const audit: AuditEntry[] = [];

  const invoice = {
    findMany: async (args: FindManyArgs): Promise<FakeInvoice[]> => {
      if (options.readFails) {
        throw new Error('base injoignable');
      }

      const visible = options.unfilteredReader
        ? [...invoices]
        : invoices.filter((candidate) => matches(candidate, args.where));

      return visible.map((candidate) => project(candidate, args.select));
    },

    updateMany: async (args: { where: WhereClause; data: { status: InvoiceStatus } }) => {
      const target =
        args.where.id === undefined
          ? undefined
          : invoices.find((candidate) => candidate.id === args.where.id);

      if (target) {
        if (options.failClaimOn === target.id) {
          throw new Error(`panne simulee sur ${target.reference}`);
        }

        options.beforeClaim?.(target);
      }

      // La reclamation est EVALUEE APRES le crochet ci-dessus, comme le ferait la
      // base : ce qui a bouge entre-temps ne correspond plus au `where`.
      const claimed = invoices.filter((candidate) => matches(candidate, args.where));

      for (const candidate of claimed) {
        candidate.status = args.data.status;
        updates.push({ id: candidate.id, status: args.data.status });
      }

      return { count: claimed.length };
    },
  };

  const user = {
    findMany: async (args: {
      where: { clientId: string; deletedAt: null; status: string };
    }): Promise<Array<{ id: string }>> =>
      users
        .filter(
          (candidate) =>
            candidate.clientId === args.where.clientId &&
            candidate.deletedAt === null &&
            candidate.status === args.where.status,
        )
        .map((candidate) => ({ id: candidate.id })),
  };

  const tx = { invoice, user };

  const prisma = {
    invoice,
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>): Promise<unknown> => fn(tx),
  };

  const activity = {
    record: async (input: ActivityInput, transaction?: Prisma.TransactionClient) => {
      activities.push(input);
      activityTransactions.push(transaction);
      return { id: `activity-${activities.length}` } as unknown as Activity;
    },
  };

  const notification = {
    notify: async (userId: string, input: NotificationInput) => {
      notifications.push({ userId, input });
      return { id: `notification-${notifications.length}` } as unknown as Notification;
    },
  };

  const auditLog = {
    record: async (entry: AuditEntry) => {
      audit.push(entry);
    },
  };

  return {
    service: new InvoiceOverdueService(
      prisma as unknown as PrismaService,
      activity as unknown as ActivityService,
      notification as unknown as NotificationService,
      auditLog as unknown as AuditService,
    ),
    invoices,
    updates,
    notifications,
    activities,
    activityTransactions,
    audit,
    statusOf: (id: string): InvoiceStatus | undefined =>
      invoices.find((candidate) => candidate.id === id)?.status,
  };
}

describe('InvoiceOverdueService.sweepOverdue', () => {
  it('passe en OVERDUE une facture partie et echue, et previent les porteurs du dossier', async () => {
    const late = row({ id: 'inv-late', reference: 'FAC-2026-0001' });
    const test = harness([late], PORTAL_USERS);

    const result = await test.service.sweepOverdue(NOW);

    assert.deepEqual(result, { examined: 1, markedOverdue: 1, notified: 2 });
    assert.equal(test.statusOf('inv-late'), InvoiceStatus.OVERDUE);
    assert.deepEqual(test.updates, [{ id: 'inv-late', status: InvoiceStatus.OVERDUE }]);

    // Les porteurs ACTIFS du dossier, et eux seuls : ni l'autre dossier, ni le
    // compte suspendu, ni le compte archive.
    assert.deepEqual(
      test.notifications.map((entry) => entry.userId).sort(),
      ['user-porteur-1', 'user-porteur-2'],
    );

    const input = test.notifications[0]!.input;
    assert.equal(input.type, NotificationType.INVOICE_OVERDUE);
    assert.equal(input.link, '/factures/inv-late');
    assert.equal(input.entityType, 'Invoice');
    assert.equal(input.entityId, 'inv-late');
    assert.match(String(input.body), /1200\.00 EUR/);

    // L'activite rejoint la transaction du fait qu'elle decrit, et reste visible
    // du client : une relance n'est pas une note interne.
    assert.equal(test.activities.length, 1);
    assert.equal(test.activities[0]!.type, ActivityType.STATUS_CHANGE);
    assert.equal(test.activities[0]!.clientId, 'client-a');
    assert.equal(test.activities[0]!.actorId, null);
    assert.equal(test.activities[0]!.isClientVisible, true);
    assert.notEqual(
      test.activityTransactions[0],
      undefined,
      "l'activite doit partir dans la transaction de la facture",
    );

    // L'audit est ecrit APRES le commit, et sans acteur : personne n'a decide.
    assert.equal(test.audit.length, 1);
    assert.equal(test.audit[0]!.action, 'INVOICE_MARKED_OVERDUE');
    assert.equal(test.audit[0]!.entityType, 'Invoice');
    assert.equal(test.audit[0]!.entityId, 'inv-late');
    assert.equal(test.audit[0]!.actorId, null);
    assert.deepEqual(test.audit[0]!.before, { status: InvoiceStatus.SENT });
  });

  it('ne fait rien de plus a la deuxieme execution', async () => {
    const test = harness([row({ id: 'inv-late', reference: 'FAC-2026-0001' })], PORTAL_USERS);

    const first = await test.service.sweepOverdue(NOW);
    const updatesAfterFirst = [...test.updates];
    const notificationsAfterFirst = test.notifications.length;

    const second = await test.service.sweepOverdue(NOW);

    assert.deepEqual(first, { examined: 1, markedOverdue: 1, notified: 2 });
    assert.deepEqual(second, { examined: 0, markedOverdue: 0, notified: 0 });
    assert.deepEqual(test.updates, updatesAfterFirst, 'aucune ecriture supplementaire');
    assert.equal(test.notifications.length, notificationsAfterFirst);
    assert.equal(test.activities.length, 1);
    assert.equal(test.audit.length, 1);
  });

  it('ne notifie pas quand la reclamation est perdue : la relance suit la reclamation', async () => {
    const test = harness([row({ id: 'inv-late', reference: 'FAC-2026-0020' })], PORTAL_USERS, {
      // Un encaissement se pose entre la lecture et la reclamation : la facture
      // n'est plus `SENT`, donc le `where` de la reclamation ne la reconnait plus.
      beforeClaim: (invoice) => {
        invoice.status = InvoiceStatus.PAID;
        invoice.amountPaid = invoice.total;
      },
    });

    const result = await test.service.sweepOverdue(NOW);

    assert.equal(result.examined, 1, 'la lecture l avait bien rendue');
    assert.equal(result.markedOverdue, 0);
    assert.equal(result.notified, 0);
    assert.equal(test.statusOf('inv-late'), InvoiceStatus.PAID);
    assert.equal(test.notifications.length, 0, "pas de relance sur une facture qui vient d'etre payee");
    assert.equal(test.activities.length, 0);
    assert.equal(test.audit.length, 0);
  });

  it('laisse intacte une facture dont l echeance n est pas passee', async () => {
    const test = harness(
      [row({ id: 'inv-future', reference: 'FAC-2026-0002', dueDate: TOMORROW })],
      PORTAL_USERS,
    );

    const result = await test.service.sweepOverdue(NOW);

    assert.deepEqual(result, { examined: 0, markedOverdue: 0, notified: 0 });
    assert.equal(test.statusOf('inv-future'), InvoiceStatus.SENT);
    assert.equal(test.notifications.length, 0);
  });

  it('ne declare pas en retard une facture deja soldee, meme partie et echue', async () => {
    const test = harness(
      [row({ id: 'inv-paid', reference: 'FAC-2026-0003', amountPaid: money('1200.00') })],
      PORTAL_USERS,
    );

    const result = await test.service.sweepOverdue(NOW);

    // Elle EST rendue : le pre-filtre ne peut pas comparer deux colonnes. C'est
    // donc la DECISION, et non la requete, qui protege un client qui a paye.
    assert.equal(result.examined, 1);
    assert.equal(result.markedOverdue, 0);
    assert.equal(test.statusOf('inv-paid'), InvoiceStatus.SENT);
    assert.equal(test.notifications.length, 0);
    assert.equal(test.activities.length, 0);
    assert.equal(test.audit.length, 0);
  });

  it('ne fait pas confiance au pre-filtre : une lecture trop large ne marque personne', async () => {
    const invoices = [
      row({ id: 'inv-brouillon', reference: 'FAC-2026-0010', status: InvoiceStatus.DRAFT }),
      row({ id: 'inv-future', reference: 'FAC-2026-0011', dueDate: TOMORROW }),
      row({
        id: 'inv-supprimee',
        reference: 'FAC-2026-0012',
        deletedAt: new Date('2026-03-02T00:00:00.000Z'),
      }),
      row({ id: 'inv-soldee', reference: 'FAC-2026-0013', amountPaid: money('1200.00') }),
      row({ id: 'inv-deja-en-retard', reference: 'FAC-2026-0014', status: InvoiceStatus.OVERDUE }),
    ];

    const test = harness(invoices, PORTAL_USERS, { unfilteredReader: true });

    const result = await test.service.sweepOverdue(NOW);

    assert.equal(result.examined, 5, 'le lecteur a rendu les cinq lignes');
    assert.equal(result.markedOverdue, 0);
    assert.equal(test.updates.length, 0);
    assert.equal(test.notifications.length, 0);
    assert.deepEqual(
      invoices.map((invoice) => invoice.status),
      [
        InvoiceStatus.DRAFT,
        InvoiceStatus.SENT,
        InvoiceStatus.SENT,
        InvoiceStatus.SENT,
        InvoiceStatus.OVERDUE,
      ],
    );
  });

  it('isole les lignes : une reclamation en echec n empeche pas les autres', async () => {
    const invoices = [
      row({ id: 'inv-1', reference: 'FAC-2026-0030' }),
      row({ id: 'inv-2', reference: 'FAC-2026-0031' }),
    ];

    const test = harness(invoices, PORTAL_USERS, { failClaimOn: 'inv-1' });

    const result = await test.service.sweepOverdue(NOW);

    assert.equal(result.examined, 2);
    assert.equal(result.markedOverdue, 1);
    assert.equal(test.statusOf('inv-1'), InvoiceStatus.SENT, 'la ligne en echec reste a balayer');
    assert.equal(test.statusOf('inv-2'), InvoiceStatus.OVERDUE);
    assert.equal(test.audit.length, 1);
    assert.equal(test.audit[0]!.entityId, 'inv-2');
  });
});

// ---------------------------------------------------------------------------
// Le BRANCHEMENT PLANIFIE : ce qui reste a prouver quand il n'y a pas d'horloge.
// ---------------------------------------------------------------------------

/**
 * POURQUOI CE BLOC EXISTE, ET CE QU'IL NE PROUVE PAS.
 *
 * Un `@Cron` peut etre parfaitement ecrit et ne jamais s'executer : il ne suffit
 * pas qu'il soit pose, il faut que le planificateur le TROUVE. Ce bloc verifie les
 * deux choses qui sont verifiables sans horloge, en executer une seule fois :
 *
 *   1. la METADONNEE que le planificateur lit est bien posee sur cette methode
 *      — expression, nom, non-reentrance. C'est exactement ce que
 *      `ScheduleExplorer` parcourt au demarrage ; une expression invalide ou un
 *      nom en double le ferait echouer au demarrage ;
 *   2. l'ENVELOPPE ne fait rien d'autre que le balayage : meme ecriture, meme
 *      notification, et surtout, elle AVALE l'erreur au lieu de la laisser
 *      remonter dans un planificateur qui n'a personne a qui la dire.
 *
 * Ce qui n'est PAS prouve ici : que le planificateur monte a la racine appelle
 * reellement l'explorateur et enregistre cette tache. Cela se joue a
 * l'initialisation de l'application, pas dans une suite unitaire. La preuve
 * executee est ailleurs : la suite e2e de facturation demarre `AppModule` avec
 * `ScheduleModule.forRoot()` monte et ce service fourni — un demarrage qui
 * reussit, avec la metadonnee ci-dessous presente, est un demarrage ou la tache a
 * ete enregistree (l'explorateur rejette au demarrage une tache malformee).
 */
describe('InvoiceOverdueService.runOverdueSweep — la tache planifiee', () => {
  it('declare une tache horaire nommee et non reentrante, sur cette methode', () => {
    const method = InvoiceOverdueService.prototype.runOverdueSweep;

    // On ne code pas la cle de metadonnees en dur : on prend TOUTES celles que le
    // decorateur a posees sur la methode et l'on cherche celle qui decrit une
    // tache. La cle interne de `@nestjs/schedule` n'est pas un chemin d'import
    // public (`exports` du paquet ne l'expose pas) : la lire par son nom
    // casserait le jour d'une renommage, alors que la chercher par sa FORME suit.
    const jobs = Reflect.getOwnMetadataKeys(method)
      .map((key) => Reflect.getOwnMetadata(key, method) as unknown)
      .filter(
        (value): value is { cronTime: unknown; name: unknown; waitForCompletion: unknown } =>
          typeof value === 'object' && value !== null && 'cronTime' in value,
      );

    assert.equal(jobs.length, 1, 'une seule declaration de tache sur cette methode');

    const [job] = jobs;
    assert.equal(job!.cronTime, CronExpression.EVERY_HOUR);
    assert.equal(job!.name, 'invoice-overdue-sweep');
    assert.equal(
      job!.waitForCompletion,
      true,
      'un balayage plus long qu une heure doit etre saute, pas double',
    );
  });

  it('l enveloppe fait le meme travail que le balayage, a l horloge pres', async () => {
    // `runOverdueSweep` n'accepte pas de date : c'est la seule difference avec
    // `sweepOverdue`. L'echeance est donc calculee par rapport a l'horloge reelle
    // pour que le test reste vrai quelle que soit la date d'execution.
    const yesterday = new Date(Date.now() - 86_400_000);
    const late = row({ id: 'inv-cron', reference: 'FAC-2026-0090', dueDate: yesterday });
    const test = harness([late], PORTAL_USERS);

    await test.service.runOverdueSweep();

    assert.equal(test.statusOf('inv-cron'), InvoiceStatus.OVERDUE);
    assert.deepEqual(test.updates, [{ id: 'inv-cron', status: InvoiceStatus.OVERDUE }]);
    assert.equal(test.notifications.length, 2);
    assert.equal(test.audit.length, 1);
    assert.equal(test.audit[0]!.action, 'INVOICE_MARKED_OVERDUE');
  });

  it('ne laisse PAS remonter une panne de lecture : personne ne l entendrait', async () => {
    const late = row({ id: 'inv-cron', reference: 'FAC-2026-0091' });
    const test = harness([late], PORTAL_USERS, { readFails: true });

    // Une exception qui sort d'une tache planifiee n'a aucun appelant pour la
    // recevoir : elle est perdue. La seule reponse utile est de journaliser ici.
    await assert.doesNotReject(() => test.service.runOverdueSweep());

    assert.equal(test.statusOf('inv-cron'), InvoiceStatus.SENT, 'rien n a ete ecrit');
    assert.equal(test.notifications.length, 0);
    assert.equal(test.audit.length, 0);
  });
});
