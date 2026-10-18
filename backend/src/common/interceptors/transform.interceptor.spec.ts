import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lastValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { TransformInterceptor } from './transform.interceptor.js';

/**
 * TRANSFORM INTERCEPTOR — LA FORME DE LA REPONSE.
 *
 * Ce fichier ne teste pas une regle metier : il teste le CONTRAT entre le
 * serveur et `request()` (`src/lib/api.js`). Trois choses en dependent, et les
 * trois échouent en silence quand l'enveloppe dérape :
 *
 *  1. `body.success` — le test unique que le front fait pour distinguer succès
 *     et échec ;
 *  2. `body.message`, `body.redirectUrl`, `body.action` — le système de
 *     redirection post-action (`useRedirectAfterAction`, `ActionNotification`) ;
 *  3. `body.meta` — la pagination, qui doit sortir de `data`.
 *
 * Le défaut que ce fichier verrouille a existé : `buildResponse` rend
 * `{ success, message, data, redirectUrl, action }`, et l'intercepteur le
 * replaçait dans `data`. La réponse était alors
 * `{ success: true, data: { success: true, message, … } }` — valide, lu, et
 * pourtant sans aucun effet côté client. Aucune erreur, aucun test rouge.
 */

const handler = (payload: unknown): CallHandler => ({
  handle: () => of(payload),
});

const context = {} as ExecutionContext;

const run = async <T>(payload: unknown): Promise<Record<string, unknown>> =>
  (await lastValueFrom(
    new TransformInterceptor<T>().intercept(context, handler(payload)),
  )) as unknown as Record<string, unknown>;

describe('TransformInterceptor — enveloppe de base', () => {
  it('enveloppe une charge utile simple', async () => {
    const body = await run({ id: 'f-1', code: 'DZD' });

    assert.equal(body.success, true);
    assert.deepEqual(body.data, { id: 'f-1', code: 'DZD' });
  });

  it('rend `data: null` pour une route qui ne renvoie rien', async () => {
    // Un DELETEAboutit ici avec `undefined`. `data: null` reste lisible ; `data`
    // absent laisserait le front désérialiser `undefined`.
    const body = await run(undefined);

    assert.equal(body.success, true);
    assert.equal(body.data, null);
  });

  it('ne touche pas au `message` d’une donnée métier', async () => {
    // Une facture peut porter un champ `message` (note au client). Ce n'est pas
    // une enveloppe : le champ doit rester DANS `data`, pas remonter.
    const body = await run({ id: 'f-1', message: 'Merci de votre confiance' });

    assert.equal(body.message, undefined);
    assert.deepEqual(body.data, { id: 'f-1', message: 'Merci de votre confiance' });
  });
});

describe('TransformInterceptor — pagination', () => {
  it('aplatie `{ items, meta }` en `{ data: [...], meta }`', async () => {
    const body = await run({
      items: [{ id: 'a' }, { id: 'b' }],
      meta: { page: 2, perPage: 20, total: 42, totalPages: 3 },
    });

    assert.deepEqual(body.data, [{ id: 'a' }, { id: 'b' }]);
    assert.deepEqual(body.meta, { page: 2, perPage: 20, total: 42, totalPages: 3 });
  });
});

describe('TransformInterceptor — réponse de buildResponse', () => {
  it('remonte message, redirectUrl et action hors de `data`', async () => {
    // EXACTEMENT ce que rend `POST /currencies` après création.
    const body = await run({
      success: true,
      message: 'Devise créée avec succès',
      data: { id: 'c-1', code: 'GBP' },
      redirectUrl: '/espace-comexa/parametres?onglet=devises',
      action: {
        type: 'open_tab',
        url: '/espace-comexa/parametres?onglet=devises',
        target: '_blank',
      },
    });

    assert.equal(body.success, true);
    // La charge utile, et seulement elle.
    assert.deepEqual(body.data, { id: 'c-1', code: 'GBP' });
    // Les trois champs que `request()` expose à `useRedirectAfterAction`.
    assert.equal(body.message, 'Devise créée avec succès');
    assert.equal(body.redirectUrl, '/espace-comexa/parametres?onglet=devises');
    assert.deepEqual(body.action, {
      type: 'open_tab',
      url: '/espace-comexa/parametres?onglet=devises',
      target: '_blank',
    });
    // Et surtout : PAS d'enveloppe imbriquée.
    assert.equal(typeof body.data, 'object');
    assert.equal('success' in (body.data as object), false);
  });

  it('laisse `redirectUrl` et `action` absents quand la route n’en produit pas', async () => {
    const body = await run({
      success: true,
      message: 'Solde ajusté',
      data: { id: 't-1' },
    });

    assert.equal(body.message, 'Solde ajusté');
    assert.equal(body.redirectUrl, undefined);
    assert.equal(body.action, undefined);
    assert.deepEqual(body.data, { id: 't-1' });
  });

  it('aplatie une enveloppe qui porte une liste paginée', async () => {
    const body = await run({
      success: true,
      message: 'Répartition appliquée',
      data: {
        items: [{ id: 'd-1' }],
        meta: { page: 1, perPage: 20, total: 1, totalPages: 1 },
      },
    });

    assert.equal(body.message, 'Répartition appliquée');
    // `data` reste l'objet paginé du service : c'est au service de décider s'il
    // aplatit, et ici il ne le fait pas.
    assert.deepEqual(body.data, {
      items: [{ id: 'd-1' }],
      meta: { page: 1, perPage: 20, total: 1, totalPages: 1 },
    });
    assert.equal(body.meta, undefined);
  });
});
