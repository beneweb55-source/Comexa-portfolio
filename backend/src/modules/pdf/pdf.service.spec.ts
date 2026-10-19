import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { MailService } from '../../common/mail/mail.service.js';
import type { OutgoingMail } from '../../common/mail/mail.types.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { PdfService } from './pdf.service.js';

describe('PdfService — generated client and prospect fields', () => {
  // Aucune base de données n'intervient : `invoice` et `quote` renvoient des
  // objets faits à la main, par la méthode que le service appelle réellement
  // (`findFirst`). Ces maquettes pointaient encore vers `findUniqueOrThrow`,
  // abandonné lors de la reprise des flux devis/factures : les quatre tests
  // échouaient donc déjà sur `main`, avant tout travail sur le PDF.
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
          invoice: { findFirst: async () => record },
          quote: { findFirst: async () => record },
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

/**
 * PAGINATION DU DOCUMENT PRODUIT — le test de bout en bout du bug signalé.
 *
 * La capture d'écran montrait un lecteur PDF annonçant « 1 / 2 » sur une facture
 * d'apparence ordinaire, la deuxième page étant réduite à la signature et au
 * pied de page. Ce qui suit exerce le vrai chemin de production
 * (`generateInvoicePdf` → lecture Prisma → modèle → mise en page) et compte les
 * pages réellement écrites dans le fichier, pas un état interne.
 *
 * Il ne demande qu'une base de données FAITE À LA MAIN : `Decimal` vient du
 * client Prisma, le reste est un objet littéral ayant la forme de la requête
 * `include` du service.
 */

const money = (value: string) => new Prisma.Decimal(value);

function invoiceRecord(itemCount: number) {
  return {
    id: 'invoice-1',
    reference: 'FAC-2026-0001',
    status: 'PARTIALLY_PAID',
    subject: 'Refonte du site vitrine',
    notes: 'Merci de rappeler la référence de la facture lors du règlement.',
    terms:
      "Paiement à 45 jours. Pénalités de retard : trois fois le taux d'intérêt légal. Pas d'escompte pour paiement anticipé.",
    issueDate: new Date('2026-09-10T09:00:00Z'),
    dueDate: new Date('2026-10-25T09:00:00Z'),
    paidAt: null,
    currency: 'DZD',
    subtotal: money('180000'),
    discountAmount: money('0'),
    taxRate: money('19'),
    taxAmount: money('34200'),
    total: money('214200'),
    amountPaid: money('100000'),
    client: {
      companyName: 'Maison Vasseur',
      legalName: 'Maison Vasseur SARL',
      registrationNumber: '3300012345',
      vatNumber: 'FR403300012345',
      addressLine1: '14 quai des Chartrons',
      addressLine2: null,
      postalCode: '33000',
      city: 'Bordeaux',
      region: 'Gironde',
      country: 'France',
      contacts: [
        {
          firstName: 'Marc',
          lastName: 'Delaunay',
          email: 'marc.delaunay@comexa.example',
          phone: '+33 5 56 00 00 01',
          jobTitle: 'Directeur',
        },
      ],
    },
    project: { reference: 'PRJ-2026-0004', name: 'Refonte du site vitrine' },
    quote: { reference: 'DEV-2026-0002' },
    items: Array.from({ length: itemCount }, (_, index) => ({
      position: index,
      title: `Prestation ${index + 1}`,
      description: index % 2 === 0 ? 'Détail de la prestation réalisée pendant la période' : null,
      quantity: money('1'),
      unitPrice: money('20000'),
      lineTotal: money('20000'),
    })),
    payments: [
      {
        amount: money('100000'),
        currency: 'DZD',
        method: 'BANK_TRANSFER',
        reference: 'PAY-2026-0001',
        paidAt: new Date('2026-09-10T09:00:00Z'),
        status: 'SUCCEEDED',
      },
    ],
  };
}

function serviceFor(record: unknown): PdfService {
  return new PdfService(
    {
      invoice: { findFirst: async () => record },
      quote: { findFirst: async () => record },
    } as unknown as PrismaService,
    new ConfigService(),
    { send: async () => {} } as unknown as MailService,
  );
}

/** Pages réellement écrites dans le fichier (objets `/Type /Page`). */
function pagesIn(buffer: Buffer): number {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describe('PdfService — pagination du PDF de facture', () => {
  it('produit un PDF valide', async () => {
    const buffer = await serviceFor(invoiceRecord(3)).generateInvoicePdf('invoice-1');
    assert.equal(buffer.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(buffer.length > 1000);
  });

  it('tient sur une seule page une facture de trois prestations avec notes, conditions, règlement et signature', async () => {
    const buffer = await serviceFor(invoiceRecord(3)).generateInvoicePdf('invoice-1');
    assert.equal(pagesIn(buffer), 1, 'la signature ne doit plus partir seule en page 2');
  });

  it('tient sur une seule page une facture sans notes ni conditions', async () => {
    const record = {
      ...invoiceRecord(1),
      notes: null,
      terms: null,
      payments: [],
      amountPaid: money('0'),
    };
    const buffer = await serviceFor(record).generateInvoicePdf('invoice-1');
    assert.equal(pagesIn(buffer), 1);
  });

  it('pagine une longue facture sur plusieurs pages, sans page presque vide', async () => {
    const buffer = await serviceFor(invoiceRecord(30)).generateInvoicePdf('invoice-1');
    const pages = pagesIn(buffer);
    assert.ok(pages > 1, `attendu plusieurs pages, obtenu ${pages}`);
    assert.ok(pages < 6, `pagination déraisonnable : ${pages} pages pour 30 lignes`);
  });

  it("n'écrit pas le pays deux fois dans l'en-tête de l'entreprise", async () => {
    // Valeurs par défaut de la configuration, celles de la capture : sans
    // variable d'environnement, l'adresse et le pays valaient tous deux
    // « Algérie », et la ville « Algiers ».
    const service = new PdfService(
      { invoice: { findFirst: async () => invoiceRecord(1) } } as unknown as PrismaService,
      new ConfigService(),
      { send: async () => {} } as unknown as MailService,
    );
    const buffer = await service.generateInvoicePdf('invoice-1');

    // Le document est compressé : on ne peut pas y chercher du texte. On vérifie
    // donc la source du rendu — les lignes d'adresse que le service construit.
    const lines = (
      service as unknown as {
        companyLines: (
          info: { address: string; postalCode: string; city: string; country: string },
          language: 'fr',
        ) => string[];
        getCompanyInfo: () => {
          address: string;
          postalCode: string;
          city: string;
          country: string;
        };
      }
    ).companyLines(
      (
        service as unknown as {
          getCompanyInfo: () => {
            address: string;
            postalCode: string;
            city: string;
            country: string;
          };
        }
      ).getCompanyInfo(),
      'fr',
    );

    assert.deepEqual(lines, ['Alger', 'Algérie', 'contact@comexa.dz', 'https://comexa.dz']);
    assert.equal(new Set(lines).size, lines.length, 'aucune ligne ne se répète');
    assert.ok(buffer.length > 0);
  });
});
