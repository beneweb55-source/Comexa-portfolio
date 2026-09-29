import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuditEntry, AuditService } from '../../common/audit/audit.service.js';
import { AccessPolicy, type AuthenticatedUser } from '../../common/auth/principal.js';
import type { MailService } from '../../common/mail/mail.service.js';
import type { Activity, Notification, Prisma } from '../../generated/prisma/client.js';
import {
  ActivityType,
  NotificationType,
  QuoteStatus,
  UserStatus,
} from '../../generated/prisma/enums.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { ActivityInput, ActivityService } from '../activity/activity.service.js';
import type { ClientsService } from '../clients/clients.service.js';
import type { CounterService } from '../counters/counter.service.js';
import type { NotificationInput, NotificationService } from '../notifications/notification.service.js';
import type { RequestMetadata } from '../invoices/request-meta.js';
import { money } from '../invoices/money.js';
import { QuotesService } from './quotes.service.js';

/**
 * LE COURRIEL DE L'ENVOI D'UN DEVIS — et le destinataire qui n'existe nulle part
 * ailleurs.
 *
 * POURQUOI CE FICHIER EXISTE, A COTE DE CELUI DES FACTURES. Une facture vise
 * toujours un dossier client, donc toujours un contact a interroger. Un DEVIS,
 * NON : il peut partir AVANT la conversion du prospect, a une adresse qui n'est
 * encore ni un dossier ni un compte. C'est precisement le cas ou le courriel est
 * le SEUL canal — le prospect n'a pas d'espace client, donc la notification in-app
 * ne le touche pas — et c'est donc celui que ce fichier verifie.
 *
 * L'ORDRE DE LECTURE DES CONTACTS (principal d'abord, puis les autres par
 * anciennete) n'est PAS reteste ici : il appartient a `primaryContactEmail`, la
 * fonction partagee avec les factures, et il est couvert par le fichier de
 * factures. Ce fichier-ci verifie la COMPOSITION : le contact du dossier d'abord,
 * l'adresse du prospect ensuite, rien du tout en dernier — et jamais d'echec.
 *
 * Le service est construit a la main, avec des doublures : les suites unitaires
 * tournent sous tsx/esbuild, qui n'emet pas `design:paramtypes`, donc Nest ne peut
 * pas resoudre les dependances d'un service non compile.
 */

const VALID_UNTIL = new Date('2026-05-31T00:00:00.000Z');

const META: RequestMetadata = { ipAddress: '203.0.113.7', userAgent: 'spec/1.0' };

/** Un commercial interne : les deux codes que l'envoi exige. */
function policy(): AccessPolicy {
  const user: AuthenticatedUser = {
    id: 'user-commercial',
    email: 'commercial@comexa.fr',
    firstName: 'Nadia',
    lastName: 'Roux',
    roles: [],
    permissions: new Set(['quote:write:any', 'quote:send:any']),
    clientId: null,
    mustChangePassword: false,
  };

  return new AccessPolicy(user);
}

type QuoteMail = Parameters<MailService['sendQuote']>[0];

class MailSpy {
  readonly quotes: QuoteMail[] = [];
  failure: Error | null = null;

  async sendQuote(params: QuoteMail): Promise<void> {
    this.quotes.push(params);

    if (this.failure) {
      throw this.failure;
    }
  }
}

interface StoredQuote {
  id: string;
  reference: string;
  status: QuoteStatus;
  clientId: string | null;
  prospectId: string | null;
  currency: string;
  total: Prisma.Decimal;
  validUntil: Date | null;
  deletedAt: Date | null;
  prospect: { email: string; contactFirstName: string; contactLastName: string } | null;
}

interface StoredContact {
  readonly clientId: string;
  readonly email: string | null;
  readonly firstName: string;
  readonly lastName: string;
}

function quote(overrides: Partial<StoredQuote> = {}): StoredQuote {
  return {
    id: 'quote-1',
    reference: 'DEV-2026-0001',
    status: QuoteStatus.DRAFT,
    clientId: 'client-a',
    prospectId: null,
    currency: 'EUR',
    total: money('4500.00'),
    validUntil: VALID_UNTIL,
    deletedAt: null,
    prospect: null,
    ...overrides,
  };
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

function harness(
  quotes: StoredQuote[],
  contacts: readonly StoredContact[],
  users: readonly string[] = [],
  failMail = false,
) {
  const activities: ActivityInput[] = [];
  const notifications: Array<{ userId: string; input: NotificationInput }> = [];
  const audit: AuditEntry[] = [];

  const mail = new MailSpy();
  mail.failure = failMail ? new Error('relais SMTP injoignable') : null;

  const quoteDelegate = {
    findFirst: async (args: {
      where: { id: string; deletedAt: null; clientId?: string };
      select?: Record<string, boolean>;
    }): Promise<StoredQuote | null> => {
      const found = quotes.find(
        (candidate) =>
          candidate.id === args.where.id &&
          (args.where.clientId === undefined || candidate.clientId === args.where.clientId),
      );

      return found ? project(found, args.select) : null;
    },

    update: async (args: {
      where: { id: string };
      data: { status: QuoteStatus; sentAt: Date };
    }): Promise<StoredQuote> => {
      const target = quotes.find((candidate) => candidate.id === args.where.id)!;
      target.status = args.data.status;
      return { ...target };
    },
  };

  const userDelegate = {
    // La doublure ne connait que des porteurs ACTIFS du dossier : si le service
    // demandait autre chose que `ACTIVE`, elle ne rendrait personne — et le test
    // s'en apercevrait au lieu de notifier une liste inventee.
    findMany: async (args: {
      where: { clientId: string | null; status: string };
    }): Promise<Array<{ id: string }>> =>
      args.where.clientId === null || args.where.status !== UserStatus.ACTIVE
        ? []
        : users.map((id) => ({ id })),
  };

  const contactDelegate = {
    findMany: async (args: {
      where: { clientId: string };
    }): Promise<Array<{ email: string | null; firstName: string; lastName: string }>> =>
      contacts
        .filter((candidate) => candidate.clientId === args.where.clientId && candidate.email !== null)
        .map((candidate) => ({
          email: candidate.email,
          firstName: candidate.firstName,
          lastName: candidate.lastName,
        })),
  };

  const tx = { quote: quoteDelegate, user: userDelegate, contact: contactDelegate };

  const prisma = {
    quote: quoteDelegate,
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>): Promise<unknown> => fn(tx),
  };

  const activity = {
    record: async (input: ActivityInput) => {
      activities.push(input);
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
    // `send()` ne consomme aucun compteur (le numero est pris a la CREATION) et
    // ne convertit aucun prospect (c'est l'ACCEPTATION qui le fait) : les deux
    // doublures restent vides, et le disent.
    service: new QuotesService(
      prisma as unknown as PrismaService,
      {} as unknown as CounterService,
      activity as unknown as ActivityService,
      notification as unknown as NotificationService,
      auditLog as unknown as AuditService,
      {} as unknown as ClientsService,
      mail as unknown as MailService,
    ),
    mail,
    quotes,
    activities,
    notifications,
    audit,
  };
}

describe('QuotesService.send — le courriel', () => {
  it('prefere le contact du dossier a l adresse du prospect', async () => {
    const test = harness(
      [
        quote({
          prospectId: 'prospect-1',
          prospect: {
            email: 'contact@prospect.fr',
            contactFirstName: 'Ibrahima',
            contactLastName: 'Sow',
          },
        }),
      ],
      [{ clientId: 'client-a', email: 'direction@dossier.fr', firstName: 'Awa', lastName: 'Diallo' }],
      ['user-porteur-1'],
    );

    await test.service.send('quote-1', policy(), META);

    assert.deepEqual(test.mail.quotes, [
      {
        to: 'direction@dossier.fr',
        firstName: 'Awa',
        reference: 'DEV-2026-0001',
        total: '4500.00',
        currency: 'EUR',
        validUntil: VALID_UNTIL,
        path: '/devis/quote-1',
      },
    ]);

    assert.equal(test.audit[0]!.action, 'QUOTE_SENT');
    assert.equal(test.activities[0]!.type, ActivityType.STATUS_CHANGE);
    assert.equal(test.notifications[0]!.input.type, NotificationType.QUOTE_SENT);
    assert.equal(test.notifications[0]!.userId, 'user-porteur-1');
    assert.equal(test.notifications[0]!.input.link, '/devis/quote-1');
  });

  it('adresse le devis au prospect quand il n y a pas encore de dossier client', async () => {
    const test = harness(
      [
        quote({
          clientId: null,
          prospectId: 'prospect-1',
          prospect: {
            email: 'contact@prospect.fr',
            contactFirstName: 'Ibrahima',
            contactLastName: 'Sow',
          },
        }),
      ],
      [],
    );

    const sent = await test.service.send('quote-1', policy(), META);

    assert.equal(sent.status, QuoteStatus.SENT);
    assert.deepEqual(test.mail.quotes, [
      {
        to: 'contact@prospect.fr',
        firstName: 'Ibrahima',
        reference: 'DEV-2026-0001',
        total: '4500.00',
        currency: 'EUR',
        validUntil: VALID_UNTIL,
        path: '/devis/quote-1',
      },
    ]);

    // Aucun compte client : la notification in-app n'a personne a qui parler.
    // C'est le cas ou le courriel est le SEUL canal.
    assert.equal(test.notifications.length, 0);
    assert.equal(test.audit[0]!.action, 'QUOTE_SENT');
  });

  it('sans contact ni adresse de prospect, l envoi reussit et aucun courriel ne part', async () => {
    const test = harness([quote({ clientId: null, prospectId: 'prospect-1' })], []);

    const sent = await test.service.send('quote-1', policy(), META);

    assert.equal(sent.status, QuoteStatus.SENT);
    assert.equal(test.mail.quotes.length, 0);
    assert.equal(test.audit[0]!.action, 'QUOTE_SENT');
  });

  it('un relais en panne ne fait PAS echouer l envoi', async () => {
    const test = harness(
      [quote({})],
      [{ clientId: 'client-a', email: 'direction@dossier.fr', firstName: 'Awa', lastName: 'Diallo' }],
      [],
      true,
    );

    const sent = await test.service.send('quote-1', policy(), META);

    assert.equal(test.mail.quotes.length, 1, 'le courriel a bien ete tente');
    assert.equal(sent.status, QuoteStatus.SENT);
    assert.equal(test.audit[0]!.action, 'QUOTE_SENT');
  });
});
