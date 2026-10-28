/**
 * Mission 5 — Comexa Space : invariants purs du diagnostic administratif.
 *
 * Aucune base, aucun serveur, aucun secret reel. Ces tests protegent surtout
 * les deux barrieres de confidentialite : le masquage cote backend est complete
 * par un masquage cote interface avant tout affichage d'un detail d'audit.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_SESSION_JWT_FORWARDING,
  auditDateBoundary,
  auditEntityHref,
  buildAdminHealth,
  diffAuditPayload,
  HEALTH_STATE,
  isSafeAgentWebhookUrl,
  MASK_LABEL,
  safeAuditText,
  settingsImpactForTab,
  summarizeTokenReview,
} from "../src/lib/admin-diagnostics.mjs";

const REQUIRED_FEATURES = ["timer", "goals", "calendar"];
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.c2lnbmF0dXJl";
const INTEGRATION_TOKEN = `cxi_${"a".repeat(43)}`;

test("Bornes de dates : le formulaire envoie des ISO complets, pas des dates ambigues", () => {
  const from = auditDateBoundary("2026-10-01");
  const to = auditDateBoundary("2026-10-31", true);
  assert.match(from, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(to, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Date.parse(from) < Date.parse(to));
  assert.equal(auditDateBoundary("hier"), "");
  assert.equal(auditDateBoundary(""), "");
});

test("Webhook assistant : aucun secret n'est envoye sur un HTTP externe", () => {
  assert.equal(isSafeAgentWebhookUrl("https://n8n.example.com/webhook/agent"), true);
  assert.equal(isSafeAgentWebhookUrl("http://n8n.example.com/webhook/agent"), false);
  assert.equal(isSafeAgentWebhookUrl("https://n8n.example.com/webhook/agent#token=abc"), true);
  assert.equal(isSafeAgentWebhookUrl("not-a-url"), false);
  assert.equal(
    isSafeAgentWebhookUrl("http://localhost:5678/webhook", { isProduction: false }),
    true,
    "Le developpement local peut utiliser HTTP sur loopback.",
  );
  assert.equal(
    isSafeAgentWebhookUrl("http://localhost:5678/webhook", { isProduction: true }),
    false,
    "La production ne doit jamais transmettre un JWT sur HTTP.",
  );
});

test("Texte d'audit : JWT, jetons cxi_, bearer et masque backend ne rejoignent pas le DOM", () => {
  assert.equal(safeAuditText(JWT), MASK_LABEL);
  assert.equal(safeAuditText(INTEGRATION_TOKEN), MASK_LABEL);
  assert.equal(safeAuditText("Bearer abc.def.ghi"), MASK_LABEL);
  assert.equal(safeAuditText("[masque]"), MASK_LABEL);
  assert.equal(safeAuditText("ADMIN"), "ADMIN");
  assert.ok(safeAuditText("x".repeat(300)).endsWith("…"));
});

test("Detail d'audit : les changements sont lisibles sans jamais afficher les secrets", () => {
  const result = diffAuditPayload(
    {
      role: "USER",
      profile: { city: "Alger", note: "ok" },
      password: "ancien-secret",
      sessionJwt: JWT,
    },
    {
      role: "ADMIN",
      profile: { city: "Oran", note: "ok" },
      password: "nouveau-secret",
      freeNote: INTEGRATION_TOKEN,
    },
  );

  assert.equal(result.hasPayload, true);
  assert.equal(result.rows.find((row) => row.path === "role").state, "changed");
  assert.equal(result.rows.find((row) => row.path === "profile.city").before, "Alger");
  assert.equal(result.rows.find((row) => row.path === "profile.city").after, "Oran");
  assert.equal(result.rows.find((row) => row.path === "password").masked, true);
  assert.equal(result.rows.find((row) => row.path === "sessionJwt").masked, true);
  assert.equal(result.rows.find((row) => row.path === "freeNote").masked, true);

  const serialized = JSON.stringify(result);
  for (const secret of ["ancien-secret", "nouveau-secret", JWT, INTEGRATION_TOKEN]) {
    assert.equal(serialized.includes(secret), false, `Fuite potentielle : ${secret.slice(0, 12)}…`);
  }
});

test("Detail d'audit : un objet supprime ou un droit absent n'invente pas de lien", () => {
  const denied = () => false;
  const allowed = (permission) => permission === "quote:read:any";
  assert.equal(auditEntityHref({ entityType: "Quote", entityId: "q-1" }, denied), null);
  assert.deepEqual(auditEntityHref({ entityType: "Quote", entityId: "q-1" }, allowed), {
    href: "/espace-equipe/devis/q-1",
    label: "Ouvrir le devis",
  });
  assert.equal(auditEntityHref({ entityType: "Quote" }, allowed), null);
  assert.equal(auditEntityHref({ entityType: "Unknown", entityId: "x" }, () => true), null);
  assert.match(
    auditEntityHref({ entityType: "Invoice", entityId: "a/b c" }, (permission) => permission === "invoice:read:any").href,
    /a%2Fb%20c$/,
  );
});

test("Jetons : la revue basee sur lastUsedAt ne pretend pas connaitre une utilisation exacte", () => {
  const now = Date.parse("2026-10-28T00:00:00.000Z");
  const review = summarizeTokenReview(
    [
      { active: true, lastUsedAt: null, expiresAt: null },
      { active: true, lastUsedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-11-01T00:00:00.000Z" },
      { active: false, lastUsedAt: "2026-01-01T00:00:00.000Z", expiresAt: null },
    ],
    now,
  );
  assert.deepEqual(review, { known: true, active: 2, neverUsed: 1, stale: 1, expiring: 1 });
  assert.equal(summarizeTokenReview(null, now).known, false);
});

test("Sante : seuls les services reellement verifies passent operationnels", () => {
  const payload = {
    success: true,
    data: {
      status: "ok",
      database: "up",
      timestamp: "2026-10-28T09:00:00.000Z",
      contract: {
        version: "2026-10-21.2",
        features: Object.fromEntries(REQUIRED_FEATURES.map((name) => [name, true])),
      },
    },
  };
  const model = buildAdminHealth({
    responseOk: true,
    payload,
    requiredFeatures: REQUIRED_FEATURES,
    tokens: [{ active: true, lastUsedAt: "2026-10-27T09:00:00.000Z" }],
    now: Date.parse("2026-10-28T09:00:00.000Z"),
  });

  const stateOf = (key) => model.checks.find((check) => check.key === key).state;
  assert.equal(stateOf("api"), "operational");
  assert.equal(stateOf("contract"), "operational");
  assert.equal(stateOf("mail"), "notConfigured");
  assert.equal(stateOf("storage"), "unknown");
  assert.equal(stateOf("overdue-cron"), "unknown");
  assert.ok(model.summary.unverified >= 3);
  assert.equal(model.summary.label.includes("ne pas conclure"), true);
  assert.equal(model.risks[0].state, "degraded");
  assert.equal(model.risks[0].detail.includes("JWT de session"), true);
  assert.equal(AGENT_SESSION_JWT_FORWARDING, true);
  assert.equal(HEALTH_STATE[stateOf("mail")], "Vérification non configurée");
});

test("Sante : contrat incomplet et sonde indisponible ne produisent aucun faux vert", () => {
  const degraded = buildAdminHealth({
    responseOk: true,
    payload: {
      success: true,
      data: {
        status: "ok",
        database: "up",
        contract: { version: "old", features: { timer: true } },
      },
    },
    requiredFeatures: REQUIRED_FEATURES,
  });
  assert.equal(degraded.checks.find((check) => check.key === "contract").state, "degraded");
  assert.deepEqual(degraded.missingFeatures, ["goals", "calendar"]);

  const down = buildAdminHealth({ responseOk: false, error: "Sonde injoignable", requiredFeatures: REQUIRED_FEATURES });
  assert.equal(down.checks.find((check) => check.key === "api").state, "unavailable");
  assert.equal(down.checks.find((check) => check.key === "contract").state, "unknown");
  assert.equal(down.checks.every((check) => check.state !== "operational"), true);
});

test("Parametres : l'interface dit quand un reglage est inactif, local ou actif", () => {
  assert.equal(settingsImpactForTab("agency").tone, "warning");
  assert.match(settingsImpactForTab("agency").body, /PDF_COMPANY_/);
  assert.equal(settingsImpactForTab("advanced").tone, "warning");
  assert.equal(settingsImpactForTab("time").tone, "info");
  assert.match(settingsImpactForTab("time").body, /navigateur/);
  assert.equal(settingsImpactForTab("devises").tone, "success");
  assert.equal(settingsImpactForTab("taux").tone, "success");
  assert.equal(settingsImpactForTab("repartitions").tone, "info");
  assert.equal(settingsImpactForTab("inconnu"), null);
});
