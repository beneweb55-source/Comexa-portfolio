import assert from "node:assert/strict";
import test from "node:test";
import { fetchAllPages } from "./pagination.mjs";

test("fetchAllPages parcourt toutes les pages annoncées et conserve les filtres", async () => {
  const paths = [];
  const request = async (path) => {
    paths.push(path);
    const page = Number(new URLSearchParams(path.split("?")[1]).get("page"));
    return {
      data: page === 1 ? [{ id: "a" }, { id: "b" }] : [{ id: "c" }],
      meta: { page, perPage: 2, total: 3, totalPages: 2 },
    };
  };

  const result = await fetchAllPages(request, "/projects?status=ACTIVE&page=9&perPage=2");

  assert.deepEqual(result.items.map(({ id }) => id), ["a", "b", "c"]);
  assert.equal(result.meta.total, 3);
  assert.deepEqual(paths, [
    "/projects?status=ACTIVE&page=1&perPage=2",
    "/projects?status=ACTIVE&page=2&perPage=2",
  ]);
});

test("fetchAllPages plafonne perPage à la limite API et s'arrête sur une page courte", async () => {
  const paths = [];
  const request = async (path) => {
    paths.push(path);
    return { data: [{ id: paths.length }], meta: undefined };
  };

  const result = await fetchAllPages(request, "/users", { perPage: 1000 });

  assert.equal(result.items.length, 1);
  assert.match(paths[0], /perPage=100/);
  assert.match(paths[0], /page=1/);
  assert.equal(paths.length, 1);
});

test("fetchAllPages refuse un résultat partiel si les pages ne couvrent pas le total annoncé", async () => {
  let calls = 0;
  await assert.rejects(
    fetchAllPages(async () => {
      calls += 1;
      return { data: [{ id: String(calls) }], meta: { total: 4, totalPages: 2 } };
    }, "/tasks", { perPage: 2 }),
    /annonce 4 éléments, mais seulement 2 ont été récupérés/,
  );
  assert.equal(calls, 2);
});

test("fetchAllPages signale les métadonnées qui dépassent son garde-fou", async () => {
  const request = async () => ({ data: Array.from({ length: 2 }, (_, id) => ({ id })), meta: { totalPages: 4 } });

  await assert.rejects(
    fetchAllPages(request, "/tasks", { perPage: 2, maxPages: 3 }),
    /contient 4 pages.*limite de sécurité : 3/,
  );
});

test("fetchAllPages propage l'annulation aux requêtes et refuse les réponses non paginées", async () => {
  const controller = new AbortController();
  let receivedSignal;
  const result = await fetchAllPages(async (_path, options) => {
    receivedSignal = options.signal;
    return { data: [], meta: { totalPages: 0 } };
  }, "/tasks", { signal: controller.signal });

  assert.deepEqual(result.items, []);
  assert.equal(receivedSignal, controller.signal);

  const interrupted = new AbortController();
  let calls = 0;
  await assert.rejects(fetchAllPages(async () => {
    calls += 1;
    interrupted.abort();
    return { data: [{ id: "partial-1" }, { id: "partial-2" }], meta: { total: 4, totalPages: 2 } };
  }, "/tasks?perPage=2", { signal: interrupted.signal }), { name: "AbortError" });
  assert.equal(calls, 1);
  await assert.rejects(fetchAllPages(async () => ({ data: {} }), "/tasks"), /n'a pas renvoyé une liste/);
});
