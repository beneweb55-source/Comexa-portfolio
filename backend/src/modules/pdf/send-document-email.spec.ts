import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { SendDocumentEmailDto } from './dto/invoice-email.dto.js';

/**
 * Le corps que le frontend envoie réellement doit passer la validation.
 *
 * Ce test reproduit la panne invisible de l'envoi par email : le DTO exigeait
 * `documentId` et `documentType`, que le contrôleur ne lit jamais, et le
 * `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`)
 * renvoyait donc 400 sur chaque envoi. Les options de validation sont celles de
 * `src/app.setup.ts`, pour que le test rejoue le pipeline et non une version
 * édulcorée.
 */
const PIPELINE = {
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
} as const;

function check(payload: Record<string, unknown>): Promise<ValidationError[]> {
  return validate(plainToInstance(SendDocumentEmailDto, payload), PIPELINE);
}

describe("Corps de l'envoi de document par email", () => {
  it('accepte exactement ce que le lecteur PDF envoie', async () => {
    const errors = await check({
      to: 'contact@client.example',
      subject: 'Facture FAC-2026-0001',
      message: '',
      includePdf: true,
      language: 'fr',
    });

    assert.deepEqual(
      errors.map((error) => error.property),
      [],
    );
  });

  it("accepte un envoi réduit à l'adresse", async () => {
    const errors = await check({ to: 'contact@client.example' });
    assert.deepEqual(errors, []);
  });

  it("refuse une adresse qui n'en est pas une", async () => {
    const errors = await check({ to: 'pas-une-adresse' });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['to'],
    );
  });

  it('refuse un champ qui ne fait pas partie du contrat', async () => {
    // `forbidNonWhitelisted` : un client ne peut pas glisser un champ que le
    // service ne connaît pas en espérant qu'il soit recopié.
    const errors = await check({ to: 'contact@client.example', documentId: 'autre-facture' });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['documentId'],
    );
  });
});
