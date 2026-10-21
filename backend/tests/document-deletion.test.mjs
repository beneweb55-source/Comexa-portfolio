import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { QuotesService } from '../dist/modules/quotes/quotes.service.js';
import { InvoicesService } from '../dist/modules/invoices/invoices.service.js';
import { DocumentsService } from '../dist/modules/documents/documents.service.js';
import { AccessPolicy } from '../dist/common/auth/principal.js';
import { QuoteStatus, InvoiceStatus } from '../dist/generated/prisma/enums.js';
import { QuotesController } from '../dist/modules/quotes/quotes.controller.js';
import { InvoicesController } from '../dist/modules/invoices/invoices.controller.js';
import { DocumentsController } from '../dist/modules/documents/documents.controller.js';

const user = (permissions) => ({ id: 'actor', roles: ['ADMIN'], clientId: null, permissions: new Set(permissions) });
for (const [resource, Service, statuses] of [['quote', QuotesService, QuoteStatus], ['invoice', InvoicesService, InvoiceStatus]]) {
  for (const status of Object.values(statuses)) {
    test(`${resource}: suppression persistée du statut ${status}, relations conservées`, async () => {
      let persisted = false, activity = false, audit = false;
      const row = { id: 'doc', reference: 'REF', status };
      const prisma = {
        [resource]: { findFirst: async ({where}) => { assert.equal(where.deletedAt, null); return row; } },
        $transaction: async (fn) => fn({ [resource]: { updateMany: async ({where, data}) => {
          assert.equal(where.deletedAt, null); assert.ok(data.deletedAt instanceof Date); persisted = true; return { count: 1 };
        } } }),
      };
      const service = new Service(prisma, {}, { record: async () => { activity = true; } }, {}, { record: async () => { audit = true; } }, {}, {});
      assert.deepEqual(await service.remove('doc', new AccessPolicy(user([`${resource}:delete:any`])), {}), { deleted: true });
      assert.ok(persisted && activity && audit);
    });
  }
  test(`${resource}: refus sans permission, avant toute lecture`, async () => {
    const service = new Service({}, {}, {}, {}, {}, {}, {});
    await assert.rejects(service.remove('doc', new AccessPolicy(user([])), {}));
  });
  test(`${resource}: document absent ou déjà supprimé`, async () => {
    const service = new Service({ [resource]: { findFirst: async () => null } }, {}, {}, {}, {}, {}, {});
    await assert.rejects(service.remove('doc', new AccessPolicy(user([`${resource}:delete:any`])), {}));
  });
  test(`${resource}: course de suppression, aucune activité fantôme`, async () => {
    const prisma = { [resource]: { findFirst: async () => ({ id: 'doc' }) }, $transaction: async (fn) => fn({ [resource]: { updateMany: async () => ({ count: 0 }) } }) };
    const service = new Service(prisma, {}, { record: () => assert.fail('activité indue') }, {}, {}, {}, {});
    await assert.rejects(service.remove('doc', new AccessPolicy(user([`${resource}:delete:any`])), {}));
  });
}
test('documents: suppression persistée, même expiré, puis suppression du fichier', async () => {
  let persisted = false, fileDeleted = false;
  const prisma = {
    document: { findFirst: async ({ where }) => {
      assert.ok(!JSON.stringify(where).includes('expiresAt'));
      return { id: 'doc', storageKey: 'file', name: 'PDF' };
    } },
    $transaction: async (fn) => fn({ document: { updateMany: async () => { persisted = true; return { count: 1 }; } } }),
  };
  const service = new DocumentsService(prisma, { record: async () => {} }, { delete: async (key) => { assert.ok(persisted); assert.equal(key, 'file'); fileDeleted = true; } }, {});
  await service.remove(user(['document:delete:any', 'document:read:any']), 'doc');
  assert.ok(fileDeleted);
});
test('documents: refus sans permission', async () => {
  await assert.rejects(new DocumentsService({}, {}, {}, {}).remove(user([]), 'doc'));
});
test('routes DELETE: permissions explicites conservées', () => {
  for (const [Controller, resource] of [[QuotesController, 'quote'], [InvoicesController, 'invoice'], [DocumentsController, 'document']]) {
    assert.deepEqual(Reflect.getMetadata('requiredPermissionsAll', Controller.prototype.remove), [`${resource}:delete:any`]);
  }
});
