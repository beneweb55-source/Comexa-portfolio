/**
 * Mission 5 — garde-fous du proxy `/api/agent-chat`.
 *
 * Le workflow n8n externe n'est pas dans le depot : on ne change donc pas son
 * contrat. En revanche, on verifie qu'aucun secret ne part sur un transport en
 * clair, qu'un jeton d'integration n'est jamais transmis, et qu'une valeur
 * arbitraire n'est pas acceptee comme « JWT de session ».
 *
 * A lancer avec `tests/register-loader.mjs` (voir `npm run test:comexa`).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../src/app/api/agent-chat/route.js";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.c2lnbmF0dXJl";
const HTTPS_WEBHOOK = "https://n8n.example.test/webhook/agent";

function request(body, token = JWT) {
  return new Request("http://localhost/api/agent-chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

function withRouteEnv(t, webhookUrl) {
  const originalUrl = process.env.N8N_AGENT_WEBHOOK_URL;
  const originalFetch = globalThis.fetch;
  const calls = [];
  if (webhookUrl === undefined) delete process.env.N8N_AGENT_WEBHOOK_URL;
  else process.env.N8N_AGENT_WEBHOOK_URL = webhookUrl;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ reply: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    if (originalUrl === undefined) delete process.env.N8N_AGENT_WEBHOOK_URL;
    else process.env.N8N_AGENT_WEBHOOK_URL = originalUrl;
    globalThis.fetch = originalFetch;
  });
  return calls;
}

test("Webhook non configure : 503 explicite, aucun appel reseau", async (t) => {
  const calls = withRouteEnv(t, undefined);
  const response = await POST(request({ chatInput: "Bonjour", sessionId: "s1" }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "AGENT_NOT_CONFIGURED");
  assert.equal(calls.length, 0);
});

test("Webhook HTTP externe : 503 avant lecture du jeton, aucun secret transmis", async (t) => {
  const calls = withRouteEnv(t, "http://n8n.example.test/webhook/agent");
  const response = await POST(request({ chatInput: "Bonjour", sessionId: "s1" }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "AGENT_WEBHOOK_INSECURE");
  assert.equal(calls.length, 0);
});

test("Jeton cxi_ : 403, le secret d'integration ne part jamais vers n8n", async (t) => {
  const calls = withRouteEnv(t, HTTPS_WEBHOOK);
  const response = await POST(request({ chatInput: "Bonjour" }, `cxi_${"a".repeat(43)}`));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "FORBIDDEN");
  assert.equal(calls.length, 0);
});

test("Valeur qui n'est pas un JWT de session : 401, pas de transfert arbitraire", async (t) => {
  const calls = withRouteEnv(t, HTTPS_WEBHOOK);
  const response = await POST(request({ chatInput: "Bonjour" }, "not-a-session-jwt"));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "INVALID_SESSION_TOKEN");
  assert.equal(calls.length, 0);
});

test("Contrat historique conserve sur HTTPS : metadata.jwt, mais jamais dans l'URL ni les en-tetes", async (t) => {
  const calls = withRouteEnv(t, HTTPS_WEBHOOK);
  const response = await POST(request({ chatInput: "Bonjour", sessionId: "s1" }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { reply: "ok" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, HTTPS_WEBHOOK);
  assert.equal(calls[0].url.includes(JWT), false);
  assert.equal(JSON.stringify(calls[0].options.headers).includes(JWT), false);
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.metadata.jwt, JWT, "Le contrat n8n actuel est preserve tant que la delegation n'existe pas.");
  assert.equal(payload.chatInput, "Bonjour");
});

test("Message vide : 400, aucun appel au workflow", async (t) => {
  const calls = withRouteEnv(t, HTTPS_WEBHOOK);
  const response = await POST(request({ chatInput: "   " }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "EMPTY_INPUT");
  assert.equal(calls.length, 0);
});
