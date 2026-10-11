import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lastValueFrom, of, throwError } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { PublicCacheInterceptor } from './public-cache.interceptor.js';
import { PublicCacheService } from './public-cache.service.js';
import { PUBLIC_CONTENT_PATHS, PUBLIC_CONTENT_TAG } from './public-cache.js';

function contextFor(method: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method }) }),
  } as unknown as ExecutionContext;
}

function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('PublicCacheInterceptor', () => {
  it('ne purge pas sur une lecture', async () => {
    let purges = 0;
    const interceptor = new PublicCacheInterceptor({
      purgePublicSite: () => purges++,
    } as unknown as PublicCacheService);
    await lastValueFrom(interceptor.intercept(contextFor('GET'), handlerReturning({ ok: true })));
    assert.equal(purges, 0);
  });

  it('purge après une écriture réussie', async () => {
    let purges = 0;
    const interceptor = new PublicCacheInterceptor({
      purgePublicSite: () => purges++,
    } as unknown as PublicCacheService);
    await lastValueFrom(interceptor.intercept(contextFor('PATCH'), handlerReturning({ id: '1' })));
    assert.equal(purges, 1);
  });

  it('ne purge pas quand l’écriture échoue', async () => {
    let purges = 0;
    const interceptor = new PublicCacheInterceptor({
      purgePublicSite: () => purges++,
    } as unknown as PublicCacheService);
    const failing: CallHandler = { handle: () => throwError(() => new Error('422')) };
    await assert.rejects(lastValueFrom(interceptor.intercept(contextFor('POST'), failing)));
    assert.equal(purges, 0);
  });
});

describe('PublicCacheService', () => {
  function serviceWith(env: Record<string, string | undefined>) {
    const config = { get: (key: string) => env[key] } as never;
    return new PublicCacheService(config);
  }

  it('sans secret : aucun appel, la purge est ignorée sans erreur', () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    try {
      serviceWith({ FRONTEND_URL: 'http://localhost:3000' }).purgePublicSite();
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('avec secret : envoie le secret et le tag public au frontend', async () => {
    const originalFetch = globalThis.fetch;
    let seen: { url: string; headers: Record<string, string>; body: string } | null = null;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = {
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: String(init?.body),
      };
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    try {
      serviceWith({
        FRONTEND_URL: 'http://localhost:3000/',
        REVALIDATE_SECRET: 'x'.repeat(32),
      }).purgePublicSite();
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(seen);
      const captured = seen as unknown as {
        url: string;
        headers: Record<string, string>;
        body: string;
      };
      assert.equal(captured.url, 'http://localhost:3000/api/revalidate');
      assert.equal(captured.headers['x-revalidate-secret'], 'x'.repeat(32));
      const body = JSON.parse(captured.body) as { tags: string[]; paths: string[] };
      assert.deepEqual(body.tags, [PUBLIC_CONTENT_TAG]);
      assert.deepEqual(body.paths, [...PUBLIC_CONTENT_PATHS]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('frontend injoignable : la purge ne lève pas d’exception', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    try {
      assert.doesNotThrow(() =>
        serviceWith({ REVALIDATE_SECRET: 'x'.repeat(32) }).purgePublicSite(),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
