import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_SHARED_RESOURCES_PER_MESSAGE,
  SHAREABLE_RESOURCE_TYPES,
  availableCard,
  cardFromClient,
  cardFromDocument,
  cardFromInvoice,
  cardFromQuote,
  normalizeSharedResourceRefs,
  sharedResourceKey,
  sharedResourceLink,
  sharedResourcesPreview,
  unavailableCard,
  type SharedResourceRef,
} from './shared-resource-card.js';

/**
 * LES REGLES DES RESSOURCES PARTAGEES, VERIFIEES SANS BASE.
 *
 *  1. UNE CARTE NE DIT QUE CE QUI EST CITE. Les modeles Prisma grossissent —
 *     un jour une colonne `notes`, le lendemain un `vatNumber`. Si la carte
 *     etait construite par etalement de la ligne, chacune de ces colonnes
 *     entrerait dans le chat SANS qu'aucune revue de code ne le remarque. Les
 *     tests d'ici ASSERTISSENT la liste EXHAUSTIVE des cles d'une carte : la
 *     seule facon de la faire grossir est de venir modifier cette regle, ici.
 *
 *  2. LA REFERENCE EST UN IDENTIFIANT, PAS UN TEXTE. La normalisation
 *     doit debiter les doublons, les espaces, les types inconnus — un partage
 *     a moitie accepte serait un mensonge poli.
 *
 *  3. LE LIEN EST UNE GRAMMAIRE, PAS UNE ROUTE. Les liens courts suivent la
 *     grammaire des notifications (`/projets/:id`…) que le frontend traduit
 *     par espace ; un `espace-equipe/…` grave cote serveur casserait l'espace
 *     client comme l'espace personnel.
 */

describe('normalizeSharedResourceRefs — la reference avant tout', () => {
  it('garde les couples valides et compte les rejets', () => {
    const { refs, rejected } = normalizeSharedResourceRefs([
      { resourceType: 'PROJECT', resourceId: ' p1 ' },
      { resourceType: 'SECRET', resourceId: 'x' },
      { resourceType: 'TASK', resourceId: '   ' },
      { resourceType: 'INVOICE', resourceId: 'i1' },
    ]);

    assert.equal(rejected, 2);
    assert.deepEqual(refs, [
      { resourceType: 'PROJECT', resourceId: 'p1' },
      { resourceType: 'INVOICE', resourceId: 'i1' },
    ]);
  });

  it('dedoublee la meme ressource citee deux fois', () => {
    const { refs, rejected } = normalizeSharedResourceRefs([
      { resourceType: 'TASK', resourceId: 't1' },
      { resourceType: 'TASK', resourceId: 't1' },
      { resourceType: 'PROJECT', resourceId: 't1' },
    ]);

    // Deux TYPES differents avec le MEME id ne sont pas des doublons : ce sont
    // deux ressources distinctes (la cle est le couple, pas l'id).
    assert.equal(rejected, 0);
    assert.equal(refs.length, 2);
    assert.equal(refs[1]?.resourceType, 'PROJECT');
  });

  it('accepte null et vide sans exception', () => {
    assert.deepEqual(normalizeSharedResourceRefs(undefined), { refs: [], rejected: 0 });
    assert.deepEqual(normalizeSharedResourceRefs([]), { refs: [], rejected: 0 });
  });

  it("refuse une entree qui n'est pas un objet", () => {
    const { refs, rejected } = normalizeSharedResourceRefs([
      null,
      'PROJECT:abc',
      { resourceType: 'PROJECT', resourceId: 42 },
    ] as never);

    assert.equal(refs.length, 0);
    assert.equal(rejected, 3);
  });
});

describe('les listes de la regle', () => {
  it("les types partageables sont les sept de l'enum Prisma, dans son ordre", async (t) => {
    // Le miroir LITTERAL de `shared-resource-card.ts` et l'enum GENERÉ du client
    // ne doivent jamais diverger : un type ajoute au schema sans carte
    // correspondante produirait des partages refuses par le garde DTO mais
    // acceptes par la normalisation (ou l'inverse). Ce test est la couture.
    //
    // Le client genere est absent tant que `prisma generate` n'a pas tourne
    // (artefact ignore par Git) : sans lui, il n'y a rien a coudre, et le test
    // se met en attente plutot qu'au rouge — la CI, qui genere, l'execute.
    const { existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const generatedHere = (file: string) =>
      existsSync(fileURLToPath(new URL(`../../generated/prisma/${file}`, import.meta.url)));
    if (!generatedHere('enums.js') && !generatedHere('enums.ts')) {
      t.skip('client Prisma non généré');
      return;
    }

    const { SharedResourceType } = await import('../../generated/prisma/enums.js');
    assert.deepEqual(
      [...SHAREABLE_RESOURCE_TYPES].sort(),
      [...Object.values(SharedResourceType)].sort(),
    );
  });

  it('une cle, un format : TYPE:id', () => {
    assert.equal(sharedResourceKey({ resourceType: 'PROJECT', resourceId: 'abc' }), 'PROJECT:abc');
  });
});

describe('sharedResourceLink — la grammaire des notifications', () => {
  const cases: Array<[SharedResourceRef['resourceType'], string]> = [
    ['PROJECT', '/projets/p1'],
    ['TASK', '/taches/t1'],
    ['CLIENT', '/clients/c1'],
    ['QUOTE', '/devis/q1'],
    ['INVOICE', '/factures/i1'],
    ['PAYMENT', '/paiements/pay1'],
    ['DOCUMENT', '/documents/d1'],
  ];

  for (const [type, expected] of cases) {
    it(`${type} → ${expected}`, () => {
      assert.equal(sharedResourceLink(type, expected.split('/').pop()!), expected);
    });
  }
});

describe("les cartes — ce qui est cite existe, ce qui n'est pas cite n'existe pas", () => {
  it('la carte CLIENT ne connaît ni contacts, ni numeros legaux, ni notes', () => {
    const row = {
      id: 'c1',
      companyName: 'SARL Alpha',
      status: 'ACTIVE',
      sector: 'BTP',
      // Ces champs existent sur le modele ; la carte ne doit JAMAIS les voir
      // passer, même si le chargeur les a lus pour d'autres besoins.
      email: 'contact@alpha.dz',
      phone: '+213 555 00 11 22',
      vatNumber: '000213000112233',
      addressLine1: 'Cite 200 logements, Bat 4',
      notes: 'Negociation en cours, remise possible',
    };

    const card = availableCard({ resourceType: 'CLIENT', resourceId: 'c1' }, cardFromClient(row));

    // FORME STABLE : toute carte porte les memes cles — une carte CLIENT au
    // meme gabarit qu'une carte FACTURE, `amount: null` a defaut. C'est ce
    // que le frontend rend sans brancher de cas par type.
    assert.deepEqual(Object.keys(card).sort(), [
      'amount',
      'available',
      'link',
      'resourceId',
      'resourceType',
      'statusKey',
      'subtitle',
      'title',
    ]);
    assert.equal(card.title, 'SARL Alpha');
    assert.equal(card.statusKey, 'ACTIVE');
    const serialized = JSON.stringify(card);
    for (const secret of [row.email, row.phone, row.vatNumber, row.addressLine1, row.notes]) {
      assert.ok(!serialized.includes(secret), `la carte fuiterait « ${secret} »`);
    }
  });

  it("la carte FACTURE porte reference, statut, echeance — pas l'objet ni les notes", () => {
    const card = availableCard(
      { resourceType: 'INVOICE', resourceId: 'i1' },
      cardFromInvoice({
        id: 'i1',
        reference: 'FAC-2026-0042',
        status: 'SENT',
        total: '150000.00',
        currency: 'DZD',
        dueDate: new Date('2026-11-02T00:00:00.000Z'),
        client: { companyName: 'SARL Alpha' },
        notes: 'Retard de paiement signale au directeur',
        terms: 'Penalites de retard a 5%',
      }),
    );

    assert.equal(card.title, 'FAC-2026-0042');
    assert.equal(card.statusKey, 'SENT');
    assert.match(card.subtitle ?? '', /2026-11-02/);
    assert.match(card.amount ?? '', /^150000\.00 DZD$/);
    assert.ok(!(card.subtitle ?? '').includes('Retard de paiement'));
    assert.equal(card.link, '/factures/i1');
  });

  it("la carte DEVIS n'existe que si elle est citee : aucun etalement", () => {
    const card = availableCard(
      { resourceType: 'QUOTE', resourceId: 'q1' },
      cardFromQuote({
        id: 'q1',
        reference: 'DEV-2026-0007',
        subject: 'Refonte du site',
        status: 'SENT',
        total: 90000,
        currency: 'DZD',
        rejectionReason: 'Trop cher pour le client',
      }),
    );

    assert.equal(card.title, 'DEV-2026-0007 — Refonte du site');
    assert.ok(!JSON.stringify(card).includes('Trop cher'));
    assert.deepEqual(Object.keys(card).sort(), [
      'amount',
      'available',
      'link',
      'resourceId',
      'resourceType',
      'statusKey',
      'subtitle',
      'title',
    ]);
  });

  it("la carte DOCUMENT n'affiche jamais la visibilite ; elle relie le projet", () => {
    const card = availableCard(
      { resourceType: 'DOCUMENT', resourceId: 'd1' },
      cardFromDocument({
        id: 'd1',
        name: 'Cahier des charges.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 300 * 1024,
        category: 'SPECIFICATION',
        visibility: 'INTERNAL',
        projectId: 'p1',
        updatedAt: new Date('2026-10-01T12:00:00.000Z'),
      }),
    );

    assert.equal(card.title, 'Cahier des charges.pdf');
    assert.ok(!(card.subtitle ?? '').includes('INTERNAL'));
    assert.equal(card.link, '/projets/p1?document=d1');
  });

  it('la carte muette ne distingue pas « supprime » de « hors perimetre »', () => {
    const card = unavailableCard({ resourceType: 'PROJECT', resourceId: 'gone' });
    assert.equal(card.available, false);
    assert.equal(card.title, null);
    assert.equal(card.subtitle, null);
    assert.equal(card.statusKey, null);
    assert.equal(card.link, null);
  });

  it('la limite par message est annoncee, pas devinee', () => {
    assert.equal(MAX_SHARED_RESOURCES_PER_MESSAGE, 10);
  });
});

describe("sharedResourcesPreview — l'apercu de liste quand le corps est vide", () => {
  it('resume deux cartes, sans inventer de titre', () => {
    const preview = sharedResourcesPreview([
      availableCard(
        { resourceType: 'PROJECT', resourceId: 'p1' },
        {
          title: 'Refonte du site',
          subtitle: null,
          statusKey: null,
          link: null,
          amount: null,
        },
      ),
      unavailableCard({ resourceType: 'TASK', resourceId: 't2' }),
      availableCard(
        { resourceType: 'CLIENT', resourceId: 'c3' },
        {
          title: 'SARL Alpha',
          subtitle: null,
          statusKey: null,
          link: null,
          amount: null,
        },
      ),
      availableCard(
        { resourceType: 'CLIENT', resourceId: 'c4' },
        {
          title: 'Autre',
          subtitle: null,
          statusKey: null,
          link: null,
          amount: null,
        },
      ),
    ]);

    assert.equal(preview, '📎 Refonte du site, SARL Alpha…');
  });

  it('une page sans carte lisible dit le partage sans le dramatiser', () => {
    const preview = sharedResourcesPreview([
      unavailableCard({ resourceType: 'PROJECT', resourceId: 'p1' }),
    ]);
    assert.equal(preview, 'Ressource partagée');
  });
});
