import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { MailService } from '../../common/mail/mail.service.js';
import type { OutgoingMail } from '../../common/mail/mail.types.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { PdfService } from './pdf.service.js';

describe('PdfService — generated client and prospect fields', () => {
  for (const [name, document, expected] of [
    ['client company', { client: { companyName: 'Entreprise Comexa' } }, 'Entreprise Comexa'],
    [
      'prospect contact',
      {
        client: null,
        prospect: {
          companyName: null,
          contactFirstName: 'Nadia',
          contactLastName: 'Test',
          email: 'nadia@example.com',
        },
      },
      'Nadia Test',
    ],
    [
      'prospect email fallback',
      {
        client: null,
        prospect: {
          companyName: null,
          contactFirstName: '',
          contactLastName: '',
          email: 'nadia@example.com',
        },
      },
      'nadia@example.com',
    ],
    ['missing recipient', { client: null, prospect: null }, 'Client'],
  ] as const) {
    it(`uses ${name} in the email greeting`, async () => {
      const mails: OutgoingMail[] = [];
      const record = {
        ...document,
        currency: 'DZD',
        total: new Prisma.Decimal('123.45'),
        reference: 'DOC-001',
      };
      const service = new PdfService(
        {
          invoice: { findUniqueOrThrow: async () => record },
          quote: { findUniqueOrThrow: async () => record },
        } as unknown as PrismaService,
        new ConfigService(),
        {
          send: async (mail: OutgoingMail) => {
            mails.push(mail);
          },
        } as unknown as MailService,
      );
      const type = name === 'client company' ? 'invoice' : 'quote';
      const result = await service.sendDocumentByEmail('doc', type, {
        to: 'recipient@example.com',
        includePdf: false,
      });
      assert.equal(result.success, true);
      assert.equal(mails.length, 1);
      assert.ok(mails[0]?.text?.startsWith(`Bonjour ${expected},`));
    });
  }
});
