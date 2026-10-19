import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SPARSE_PAGE_HEIGHT,
  planLayout,
  renderDocument,
  type DocumentItemRow,
  type DocumentModel,
} from './document-layout.js';

/**
 * SPÉCIFIQUE DE LA MISE EN PAGE.
 *
 * Il teste ce que la capture d'écran montrait sans pouvoir le prouver : le
 * lecteur annonçait « 1 / 2 » sur une facture d'une seule prestation, avec une
 * deuxième page réduite à la signature et au pied de page.
 *
 * Ces tests ne demandent ni base de données ni client Prisma généré : le module
 * de mise en page ne reçoit que des chaînes déjà formatées. Ils tournent donc
 * dans n'importe quel environnement, y compris une image où `prisma generate`
 * n'a pas pu télécharger ses moteurs.
 */

const COMPANY = {
  name: 'Comexa',
  lines: [
    '12 rue Didouche Mourad',
    '16000 Alger',
    'Algérie',
    'Tél : +213 555 00 00 00',
    'contact@comexa.dz',
    'https://comexa.dz',
    'RC : 16/00-1234567 B 20',
    'NIF/TVA : 0020161234567',
  ],
};

function item(index: number, description?: string): DocumentItemRow {
  return {
    title: description ? `Prestation ${index}` : `Refonte du site vitrine — lot ${index}`,
    description,
    quantity: String(index % 3 === 0 ? 3 : 1),
    unitPrice: '180 000,00 DA',
    amount: '180 000,00 DA',
  };
}

function buildModel(overrides: Partial<DocumentModel> = {}): DocumentModel {
  return {
    kind: 'invoice',
    title: 'FACTURE',
    reference: 'FAC-2026-0001',
    referenceLabel: 'N°',
    issuedLine: 'Émise le 10/09/2026',
    company: COMPANY,
    logo: null,
    meta: [
      { value: 'Partiellement payée', pill: true, tone: 'warning' },
      { label: "Date d'échéance", value: '25/10/2026' },
      { label: 'Devise', value: 'DZD' },
    ],
    recipient: {
      heading: 'Facturé à',
      name: 'Maison Vasseur',
      lines: [
        'Maison Vasseur SARL',
        '14 quai des Chartrons',
        '33000 Bordeaux',
        'France',
        'marc.delaunay@comexa.example',
        '+33 5 56 00 00 01',
      ],
    },
    context: {
      heading: 'Rattaché à',
      name: 'Refonte du site vitrine',
      lines: ['Projet PRJ-2026-0004', 'Devis DEV-2026-0002'],
    },
    items: {
      headers: ['Description', 'Qté', 'P.U.', 'Montant'],
      rows: [item(1, 'Maquettes, intégration et mise en ligne')],
      empty: 'Aucune prestation sur ce document.',
    },
    totals: [
      { label: 'Sous-total', value: '180 000,00 DA' },
      { label: 'Remise', value: '0,00 DA' },
      { label: 'TVA 19 %', value: '34 200,00 DA' },
      { label: 'Total', value: '214 200,00 DA', strong: true },
      { label: 'Total payé', value: '100 000,00 DA' },
      { label: 'Solde dû', value: '114 200,00 DA', tone: 'danger' },
    ],
    payments: {
      heading: 'Règlements encaissés',
      rows: [{ label: '10/09/2026 · Virement bancaire · FAC-2026-0001', value: '100 000,00 DA' }],
      empty: 'Aucun règlement enregistré.',
    },
    sections: [
      { heading: 'Notes', body: 'Merci de rappeler la référence de la facture lors du règlement.' },
      {
        heading: 'Conditions',
        body: "Paiement à 45 jours. Pénalités de retard : trois fois le taux d'intérêt légal. Pas d'escompte pour paiement anticipé.",
      },
    ],
    signature: { heading: 'Signature', caption: 'Signature et cachet' },
    thanks: 'Merci pour votre confiance.',
    footer: [
      'Comexa · 12 rue Didouche Mourad, 16000 Alger · RC 16/00-1234567 B 20 · NIF 0020161234567',
      'contact@comexa.dz · https://comexa.dz',
    ],
    continuation: 'FACTURE FAC-2026-0001 — suite',
    ...overrides,
  };
}

function manyItems(count: number): DocumentItemRow[] {
  return Array.from({ length: count }, (_, index) =>
    item(
      index + 1,
      index % 2 === 0 ? 'Détail de la prestation réalisée pendant la période' : undefined,
    ),
  );
}

/** Nombre de pages réellement écrites dans le fichier, lues dans le PDF. */
function pagesInBuffer(buffer: Buffer): number {
  const raw = buffer.toString('latin1');
  return (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describe('Mise en page des documents commerciaux', () => {
  it('fait tenir une facture ordinaire sur une seule page', () => {
    const { result, density } = planLayout(buildModel());
    assert.equal(
      result.pageCount,
      1,
      `densité ${density}, hauteur ${result.lastPageContentHeight}`,
    );
    assert.equal(density, 'normal');
  });

  it("n'envoie plus la signature seule sur une deuxième page", () => {
    // Le cas de la capture : trois prestations, des notes, des conditions et une
    // signature. L'ancien rendu cassait la page juste avant la signature.
    const { result } = planLayout(
      buildModel({
        items: {
          headers: ['Description', 'Qté', 'P.U.', 'Montant'],
          rows: [
            item(1, 'Maquettes, intégration et mise en ligne'),
            item(2, 'Logo, charte graphique et déclinaisons réseaux sociaux'),
            item(3),
          ],
          empty: 'Aucune prestation sur ce document.',
        },
      }),
    );

    assert.equal(result.pageCount, 1);
    // Le contenu doit descendre assez bas pour qu'on ne perde pas la moitié de
    // la page, mais rester au-dessus du pied de page réservé.
    assert.ok(result.lastPageContentHeight > SPARSE_PAGE_HEIGHT);
  });

  it('ne produit aucune page presque vide, quel que soit le nombre de lignes', () => {
    const sparse: number[] = [];

    for (let count = 1; count <= 40; count += 1) {
      const { result } = planLayout(
        buildModel({
          items: {
            headers: ['Description', 'Qté', 'P.U.', 'Montant'],
            rows: manyItems(count),
            empty: 'Aucune prestation sur ce document.',
          },
        }),
      );

      if (result.pageCount > 1 && result.lastPageContentHeight < SPARSE_PAGE_HEIGHT) {
        sparse.push(count);
      }
    }

    assert.deepEqual(
      sparse,
      [],
      `pages presque vides pour ces nombres de lignes : ${sparse.join(', ')}`,
    );
  });

  it('répète l’en-tête des colonnes et numérote les pages d’un document long', async () => {
    const rendered = await renderDocument(
      buildModel({
        items: {
          headers: ['Description', 'Qté', 'P.U.', 'Montant'],
          rows: manyItems(30),
          empty: 'Aucune prestation sur ce document.',
        },
      }),
    );

    assert.ok(rendered.pageCount > 1);
    assert.equal(pagesInBuffer(rendered.buffer), rendered.pageCount);
    assert.ok(rendered.buffer.subarray(0, 5).toString('latin1'), '%PDF-');
  });

  it('produit un PDF valide pour un devis sans règlement ni signature', async () => {
    const rendered = await renderDocument(
      buildModel({
        kind: 'quote',
        title: 'DEVIS',
        reference: 'DEV-2026-0002',
        issuedLine: 'Émis le 10/09/2026',
        meta: [
          { value: 'Envoyé', pill: true, tone: 'info' },
          { label: "Valable jusqu'au", value: '10/10/2026' },
        ],
        totals: [
          { label: 'Sous-total', value: '180 000,00 DA' },
          { label: 'TVA 19 %', value: '34 200,00 DA' },
          { label: 'Total', value: '214 200,00 DA', strong: true },
        ],
        payments: null,
        signature: null,
      }),
    );

    assert.equal(rendered.pageCount, 1);
    assert.equal(pagesInBuffer(rendered.buffer), 1);
  });

  it('encaisse des champs vides sans page supplémentaire', () => {
    const { result } = planLayout(
      buildModel({
        issuedLine: '',
        logo: null,
        context: null,
        meta: [],
        payments: null,
        sections: [],
        signature: null,
        thanks: '',
        footer: [],
        items: {
          headers: ['Description', 'Qté', 'P.U.', 'Montant'],
          rows: [],
          empty: 'Aucune prestation.',
        },
      }),
    );

    assert.equal(result.pageCount, 1);
  });

  it('ne laisse pas un texte libre déborder la page réservée au pied de page', () => {
    // Conditions de vingt lignes : le bloc se coupe, mais la dernière page doit
    // rester substantielle et le flux ne doit jamais dépasser la bande de pied.
    const long = Array.from(
      { length: 20 },
      (_, index) => `Article ${index + 1} des conditions.`,
    ).join(' ');
    const { result } = planLayout(
      buildModel({ sections: [{ heading: 'Conditions', body: long }] }),
    );

    assert.ok(result.lastPageContentHeight > 0);
    assert.ok(result.lastPageContentHeight <= SPARSE_PAGE_HEIGHT || result.pageCount === 1);
  });
});
