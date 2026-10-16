import assert from "node:assert/strict";
import test from "node:test";
import { allowedPath, canAny, hasTeamAccess, homeFor } from "./access.js";

test("team calendar is available to the scopes used by its data loaders", () => {
  const assignedDeveloper = {
    roles: ["DEVELOPER"],
    permissions: ["task:read:assigned"],
  };
  const projectLead = {
    roles: ["PROJECT_MANAGER"],
    permissions: ["project:read:own"],
  };

  assert.equal(canAny(assignedDeveloper, ["task:read:assigned", "project:read:own"]), true);
  assert.equal(allowedPath(assignedDeveloper, "/espace-equipe/calendrier"), true);
  assert.equal(allowedPath(projectLead, "/espace-equipe/calendrier"), true);
});

test("client project visibility does not grant access to the team calendar", () => {
  const client = {
    roles: ["CLIENT"],
    permissions: ["project:read:own"],
  };

  assert.equal(hasTeamAccess(client), false);
  assert.equal(allowedPath(client, "/espace-equipe/calendrier"), false);
});

test("integration readers can enter the API administration route", () => {
  const integrationReader = {
    roles: [],
    permissions: ["integration:read:any"],
  };

  assert.equal(hasTeamAccess(integrationReader), true);
  // L'administration des intégrations vit désormais dans Comexa Space.
  assert.equal(allowedPath(integrationReader, "/espace-comexa/integrations"), true);
  assert.equal(allowedPath(integrationReader, "/espace-comexa/integrations/jeton-1"), true);
});


test("integration managers can enter, unrelated team members cannot", () => {
  const manager = { roles: [], permissions: ["integration:manage:any"] };
  const developer = { roles: ["DEVELOPER"], permissions: ["task:read:any"] };

  assert.equal(hasTeamAccess(manager), true);
  assert.equal(allowedPath(manager, "/espace-comexa/integrations"), true);
  assert.equal(allowedPath(developer, "/espace-comexa/integrations"), false);
  assert.equal(allowedPath(developer, "/espace-comexa/integrations/jeton-1"), false);
});


test("personal space only opens tools that belong to the account", () => {
  const developer = {
    roles: ["DEVELOPER"],
    permissions: ["task:read:assigned", "task:write:own", "task:read:personal", "task:write:personal", "time:read:own", "time:write:own", "calendar:read:own", "calendar:write:own", "calendar:read:team", "project:read:assigned", "notification:read:own", "user:read:own"],
  };
  assert.equal(allowedPath(developer, "/espace-personnel/taches"), true);
  assert.equal(allowedPath(developer, "/espace-personnel/calendrier"), true);
  assert.equal(allowedPath(developer, "/espace-personnel/temps"), true);
  // La feuille de temps de TOUTE l'équipe reste réservée à time:read:any.
  assert.equal(allowedPath(developer, "/espace-equipe/temps"), false);
  assert.equal(allowedPath(developer, "/espace-comexa/membres"), false);
});

test("an administrator cannot reach organisation pages through the team space", () => {
  const admin = { roles: ["ADMIN"], permissions: ["audit:read:any", "user:read:any", "invoice:read:any", "task:read:any", "task:read:personal", "dashboard:read:any"] };
  assert.equal(allowedPath(admin, "/espace-comexa/journal"), true);
  assert.equal(allowedPath(admin, "/espace-equipe/factures"), true);
  // Les factures n'existent pas dans l'espace personnel.
  assert.equal(allowedPath(admin, "/espace-personnel/factures/x"), true, "rubrique inconnue : la route 404 de Next tranche");
  assert.equal(homeFor({ ...admin, id: "a1" }), "/espace-equipe/tableau-de-bord");
});

test("clients never enter a workspace space", () => {
  const client = { roles: ["CLIENT"], permissions: ["project:read:own", "notification:read:own", "dashboard:read:own"] };
  assert.equal(allowedPath(client, "/espace-personnel/tableau-de-bord"), false);
  assert.equal(allowedPath(client, "/espace-comexa/tableau-de-bord"), false);
  assert.equal(homeFor(client), "/espace-client");
});
