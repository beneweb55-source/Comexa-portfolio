import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuditEntry, AuditService } from '../../common/audit/audit.service.js';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import type { MailService } from '../../common/mail/mail.service.js';
import type { Activity, Notification, Prisma } from '../../generated/prisma/client.js';
import { ActivityType, InvoiceStatus, NotificationType } from '../../generated/prisma/enums.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { ActivityInput, ActivityService } from '../activity/activity.service.js';
import type { CounterService } from '../counters/counter.service.js';
import type { NotificationInput, NotificationService } from '../notifications/notification.service.js';
import { InvoicesService } from './invoices.service.js';
import { money } from './money.js';
import type { RequestMetadata } from './request-meta.js';

/**
 * LE COURRIEL DE L'ENVOI D'UNE FACTURE — et la seule chose qu'il ne doit JAMAIS
 * faire : empecher l'envoi.
 *
 * POURQUOI CE FICHIER EXISTE. `MailService` n'etait appele que par le mot de
 * passe oublie : une facture « envoyee » changeait de statut, apparaissait dans
 * l'espace client, declenchait une notification — et n'arrivait dans aucune
 * boite aux lettres. Un client sans compte, ou qui n'ouvre pas l'application,
 * n'etait jamais informe qu'il devait payer. Le statut etait vrai, le document
 * n'arrivait pas.
 *
 * CE QUI SE TESTE ICI, ET CE QUI NE PEUT PAS SE TESTER AILLEURS. Il n'y a pas de
 * relais SMTP en test, donc pas de boite aux lettres a interroger : la seule
 * verification possible est sur la FRONTIERE — `MailService` recoit-il le bon
 * destinataire, et son echec remonte-t-il ? On double donc `MailService` (un
 * espion qui enregistre ses appels) et l'on verifie deux proprietes :
 *
 *   1. le destinataire est celui du DOSSIER CLIENT — le contact principal, et a
 *      defaut le premier contact joignable — et non un compte de l'espace client,
 *      qui n'est pas une adresse ;
 *   2. quand le relais est en panne, `send()` REUSSIT quand meme : la facture est
 *      `SENT`, l'audit est ecrit, et rien ne remonte. Un etat metier correct ne se
 *      perd pas a cause d'un effet secondaire.
 *
 * LE SERVICE EST CONSTRUIT A LA MAIN. Les suites unitaires tournent sous
 * tsx/esbuild, qui n'emet pas `design:paramtypes` : l'injection Nest ne resout
 * pas les dependances d'un service non compile. La doublure Prisma filtre selon
 * le `where` recu, trie selon l'`orderBy` recu et ne rend que les colonnes du
 * `select` — sans quoi le test prouverait le comportement d'une doublure au lieu
 * de celui du service.
 */

const DUE_DATE = new Date('2026-04-30T00:00:00.000Z');

const META: RequestMetadata = { ipAddress: '203.0.113.7', userAgent: 'spec/1.0' };

/**
 * Un commercial interne, avec les DEUX codes que l'envoi exige reellement : le
 * garde de la route lit `invoice:send:any`, et le service pose son perimetre sur
 * `invoice:write`. Les deux sont detenus par SALES, PROJECT_MANAGER et ADMIN —
 * les seuls roles qui atteignent cette route.
 */
function policy(...extra: string[]): AccessPolicy {
  const user: AuthenticatedUser = {
    id: 'user-commercial',
    email: 'commercial@comexa.fr',
    firstName: 'Nadia',
    lastName: 'Roux',
    roles: [],
    permissions: new Set(['invoice:write:any', 'invoice:send:any', ...extra]),
    clientId: null,
    mustChangePassword: false,
  };

  return new AccessPolicy(user);
}

type InvoiceMail = Parameters<MailService['sendInvoice']>[0];

/** L'espion : il enregistre l'appel AVANT de pouvoir echouer. */
class MailSpy {
  constructor(private readonly probe: () => number = () => 0) {}

  readonly invoices: InvoiceMail[] = [];
  /** Combien d'entrees d'audit existaient au moment de l'appel. */
  readonly auditsAtSend: number[] = [];
  failure: Error | null = null;

  async sendInvoice(params: InvoiceMail): Promise<void> {
    this.invoices.push(params);
    this.auditsAtSend.push(this.probe());

    if (this.failure) {
      throw this.failure;
    }
  }
}

interface StoredContact {
  readonly clientId: string;
  readonly email: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly isPrimary: boolean;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

interface StoredInvoice {
  id: string;
  reference: string;
  status: InvoiceStatus;
  clientId: string;
  quoteId: string | null;
  currency: string;
  total: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  dueDate: Date;
  deletedAt: Date | null;
}

function contact(overrides: Partial<StoredContact> & Pick<StoredContact, 'email'>): StoredContact {
  return {
    clientId: 'client-a',
    firstName: 'Awa',
    lastName: 'Diallo',
    isPrimary: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function invoice(): StoredInvoice {
  return {
    id: 'inv-1',
    reference: 'FAC-2026-0001',
    status: InvoiceStatus.DRAFT,
    clientId: 'client-a',
    quoteId: 'quote-1',
    currency: 'EUR',
    total: money('1200.00'),
    amountPaid: money('0.00'),
    dueDate: DUE_DATE,
    deletedAt: null,
  };
}

/** Le tri de Prisma, rejoue a partir de l'`orderBy` recu. */
type OrderClause = Record<string, 'asc' | 'desc'>;

function compare(left: unknown, right: unknown): number {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }

  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return Number(left) - Number(right);
  }

  if (typeof left === 'string' && typeof right === 'string') {
    return left.localeCompare(right);
  }

  return 0;
}

function sorted(rows: readonly StoredContact[], orderBy: readonly OrderClause[]): StoredContact[] {
  return [...rows].sort((left, right) => {
    for (const clause of orderBy) {
      for (const [field, direction] of Object.entries(clause)) {
        const difference = compare(
          (left as unknown as Record<string, unknown>)[field],
          (right as unknown as Record<string, unknown>)[field],
        );

        if (difference !== 0) {
          return direction === 'desc' ? -difference : difference;
        }
      }
    }

    return 0;
  });
}

/** Le `select` de Prisma : seules les colonnes demandees sortent. */
function project<T extends object>(row: T, select: Record<string, boolean> | undefined): T {
  if (!select) {
    return { ...row };
  }

  const out: Record<string, unknown> = {};

  for (const [column, wanted] of Object.entries(select)) {
    if (wanted) {
      out[column] = (row as unknown as Record<string, unknown>)[column];
    }
  }

  return out as unknown as T;
}

function harness(invoices: StoredInvoice[], contacts: readonly StoredContact[], failMail = false) {
  const activities: ActivityInput[] = [];
  const activityTransactions: Array<Prisma.TransactionClient | undefined> = [];
  const notifications: Array<{ userId: string; input: NotificationInput }> = [];
  const audit: AuditEntry[] = [];
  const users = [{ id: 'user-porteur-1', clientId: 'client-a' }];

  const mail = new MailSpy(() => audit.length);
  mail.failure = failMail ? new Error('relais SMTP injoignable') : null;

  const invoiceDelegate = {
    findFirst: async (args: {
      where: { id: string; deletedAt: null; clientId?: string };
      select?: Record<string, boolean>;
    }): Promise<StoredInvoice | null> => {
      const found = invoices.find(
        (candidate) =>
          candidate.id === args.where.id &&
          (args.where.clientId === undefined || candidate.clientId === args.where.clientId),
      );

      return found ? project(found, args.select) : null;
    },

    update: async (args: {
      where: { id: string };
      data: { status: InvoiceStatus; sentAt: Date };
    }): Promise<StoredInvoice> => {
      const target = invoices.find((candidate) => candidate.id === args.where.id)!;
      target.status = args.data.status;
      return { ...target };
    },
  };

  const userDelegate = {
    findMany: async (args: {
      where: { clientId: string | null };
    }): Promise<Array<{ id: string }>> =>
      users
        .filter((candidate) => candidate.clientId === args.where.clientId)
        .map((candidate) => ({ id: candidate.id })),
  };

  const contactDelegate = {
    findMany: async (args: {
      where: { clientId: string; deletedAt: null };
      orderBy: readonly OrderClause[];
    }): Promise<Array<{ email: string | null; firstName: string; lastName: string }>> =>
      sorted(
        contacts.filter(
          (candidate) => candidate.clientId === args.where.clientId && candidate.deletedAt === null,
        ),
        args.orderBy,
      ).map((candidate) => ({
        email: candidate.email,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
      })),
  };

  const tx = { invoice: invoiceDelegate, user: userDelegate, contact: contactDelegate };

  const prisma = {
    invoice: invoiceDelegate,
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
    // `send()` ne touche pas aux compteurs : un numero est consomme a la
    // CREATION, jamais a l'envoi. La doublure le dit en restant vide.
    service: new InvoicesService(
      prisma as unknown as PrismaService,
      {} as unknown as CounterService,
      activity as unknown as ActivityService,
      notification as unknown as NotificationService,
      auditLog as unknown as AuditService,
      mail as unknown as MailService,
    ),
    mail,
    invoices,
    activities,
    activityTransactions,
    notifications,
    audit,
  };
}

describe('InvoicesService.send — le courriel', () => {
  it('adresse la facture au contact du dossier, et part apres l ecriture de la verite', async () => {
    const target = invoice();
    const test = harness(
      [target],
      [
        contact({
          email: 'comptable@dossier.fr',
          isPrimary: false,
          createdAt: new Date('2026-01-05T00:00:00.000Z'),
        }),
        contact({
          email: 'direction@dossier.fr',
          firstName: 'Awa',
          isPrimary: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
    );

    const sent = await test.service.send('inv-1', policy(), META);

    assert.equal(sent.status, InvoiceStatus.SENT);

    // L'appel complet, au champ pres : destinataire, montant REEL de la piece et
    // chemin vers la meme fiche que la notification in-app.
    assert.deepEqual(test.mail.invoices, [
      {
        to: 'direction@dossier.fr',
        firstName: 'Awa',
        reference: 'FAC-2026-0001',
        total: '1200.00',
        currency: 'EUR',
        dueDate: DUE_DATE,
        path: '/factures/inv-1',
      },
    ]);

    // Le courriel est un EFFET : il part apres le commit, donc apres l'audit.
    assert.equal(
      test.mail.auditsAtSend[0],
      1,
      'le courriel doit partir apres l ecriture de la verite',
    );

    // Et la verite, elle, est bien ecrite : statut, activite dans la
    // transaction, notification au porteur du dossier.
    assert.equal(test.audit[0]!.action, 'INVOICE_SENT');
    assert.equal(test.activities[0]!.type, ActivityType.STATUS_CHANGE);
    assert.notEqual(test.activityTransactions[0], undefined);
    assert.equal(test.notifications[0]!.input.type, NotificationType.INVOICE_ISSUED);
    assert.equal(test.notifications[0]!.userId, 'user-porteur-1');
  });

  it('un contact principal sans adresse ne fait pas perdre le destinataire', async () => {
    const test = harness(
      [invoice()],
      [
        contact({
          email: '   ',
          isPrimary: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        contact({
          email: 'comptable@dossier.fr',
          firstName: 'Moussa',
          isPrimary: false,
          createdAt: new Date('2026-01-05T00:00:00.000Z'),
        }),
      ],
    );

    await test.service.send('inv-1', policy(), META);

    assert.equal(test.mail.invoices.length, 1);
    assert.equal(test.mail.invoices[0]!.to, 'comptable@dossier.fr');
    assert.equal(test.mail.invoices[0]!.firstName, 'Moussa');
  });

  it('sans contact joignable, l envoi reussit et aucun courriel ne part', async () => {
    const target = invoice();
    const test = harness([target], []);

    const sent = await test.service.send('inv-1', policy(), META);

    assert.equal(sent.status, InvoiceStatus.SENT);
    assert.equal(test.mail.invoices.length, 0);
    assert.equal(test.audit[0]!.action, 'INVOICE_SENT');
  });

  it('un relais en panne ne fait PAS echouer l envoi', async () => {
    const target = invoice();
    const test = harness([target], [contact({ email: 'direction@dossier.fr' })], true);

    const sent = await test.service.send('inv-1', policy(), META);

    // Le destinataire etait bon : c'est le relais qui est tombe.
    assert.equal(test.mail.invoices.length, 1);
    assert.equal(test.mail.invoices[0]!.to, 'direction@dossier.fr');

    // Et l'operation est un SUCCES : le statut est ecrit, l'audit est ecrit.
    assert.equal(sent.status, InvoiceStatus.SENT);
    assert.equal(test.audit.length, 1);
    assert.equal(test.audit[0]!.action, 'INVOICE_SENT');
  });

  it('refuse un second envoi sans rappeler le courriel', async () => {
    const target = invoice();
    const test = harness([target], [contact({ email: 'direction@dossier.fr' })]);

    await test.service.send('inv-1', policy(), META);

    await assert.rejects(
      () => test.service.send('inv-1', policy(), META),
      /deja ete envoyee/,
    );

    assert.equal(test.mail.invoices.length, 1, 'un seul courriel pour une seule piece envoyee');
  });
});
