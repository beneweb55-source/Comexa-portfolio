import assert from "node:assert/strict";
import test from "node:test";
import { accessibleSpaces, effectivePermissions, equivalentPath, spaceForPath } from "./spaces.js";

/*
 * Miroir de la politique serveur (backend/src/common/spaces/space-policy.ts) :
 * mêmes cas que `space-policy.spec.ts`, pour que l'interface ne propose jamais
 * un espace ou une action que l'API refuserait.
 */

const DEVELOPER = {
  roles: ["DEVELOPER"],
  permissions: ["user:read:own", "project:read:assigned", "milestone:read:any", "task:read:assigned", "task:write:own", "time:read:own", "time:write:own", "activity:read:any", "document:read:any", "conversation:read:own", "notification:read:own", "dashboard:read:own", "report:read:own", "task:read:personal", "task:write:personal", "calendar:read:own", "calendar:write:own", "calendar:read:team"],
};
const SALES = {
  roles: ["SALES"],
  permissions: ["user:read:own", "prospect:read:any", "client:read:any", "quote:read:any", "invoice:read:any", "task:read:own", "time:read:own", "time:write:own", "task:read:personal", "task:write:personal", "calendar:read:own", "calendar:write:own", "calendar:read:team", "report:read:any", "notification:read:own"],
};
const ADMIN = {
  roles: ["ADMIN"],
  permissions: ["user:read:any", "user:manage:any", "audit:read:any", "integration:manage:any", "telegram:link:any", "invoice:read:any", "task:read:any", "task:write:any", "task:read:personal", "time:read:any", "calendar:read:own", "calendar:read:team", "faq:write:any", "faq:read:any", "dashboard:read:any"],
};

test("l'espace se lit dans l'URL", () => {
  assert.equal(spaceForPath("/espace-personnel/taches"), "personal");
  assert.equal(spaceForPath("/espace-equipe"), "team");
  assert.equal(spaceForPath("/espace-comexa/membres/1"), "comexa");
  assert.equal(spaceForPath("/espace-client"), null);
  assert.equal(spaceForPath("/espace-equipement"), null);
});

test("changer d'espace garde la rubrique quand elle existe", () => {
  const personal = ["/espace-personnel/calendrier", "/espace-personnel/taches"];
  assert.equal(equivalentPath("/espace-equipe/calendrier", "personal", personal), "/espace-personnel/calendrier");
  assert.equal(equivalentPath("/espace-equipe/factures/12", "personal", personal), "/espace-personnel/tableau-de-bord");
});

test("accès aux espaces selon le rôle", () => {
  assert.deepEqual(accessibleSpaces(DEVELOPER), ["personal", "team"]);
  assert.deepEqual(accessibleSpaces(SALES), ["personal", "team"]);
  assert.deepEqual(accessibleSpaces(ADMIN), ["personal", "team", "comexa"]);
  assert.deepEqual(accessibleSpaces({ roles: ["CLIENT"], permissions: ["project:read:own"] }), []);
});

test("espace personnel : rien que des portées « à moi »", () => {
  const personal = effectivePermissions("personal", ADMIN.permissions);
  for (const code of personal) assert.match(code, /:(own|assigned|personal)$/);
  assert.ok(personal.has("task:read:assigned"));
  assert.ok(!personal.has("invoice:read:any"));
});

test("espace équipe : ni administration, ni données privées ; Comexa : ni facturation ni tâches", () => {
  const team = effectivePermissions("team", ADMIN.permissions);
  assert.ok(team.has("invoice:read:any"));
  assert.ok(!team.has("audit:read:any"));
  assert.ok(!team.has("task:read:personal"));
  assert.ok(!team.has("calendar:read:own"));
  const comexa = effectivePermissions("comexa", ADMIN.permissions);
  assert.ok(comexa.has("audit:read:any"));
  assert.ok(comexa.has("faq:write:any"));
  assert.ok(!comexa.has("invoice:read:any"));
  assert.ok(!comexa.has("telegram:link:any"));
});
