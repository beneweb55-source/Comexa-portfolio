import assert from "node:assert/strict";
import test from "node:test";
import { allowedPath, canAny, hasTeamAccess } from "./access.js";

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
  assert.equal(allowedPath(integrationReader, "/espace-equipe/integrations"), true);
  assert.equal(allowedPath(integrationReader, "/espace-equipe/integrations/jeton-1"), true);
});


test("integration managers can enter, unrelated team members cannot", () => {
  const manager = { roles: [], permissions: ["integration:manage:any"] };
  const developer = { roles: ["DEVELOPER"], permissions: ["task:read:any"] };

  assert.equal(hasTeamAccess(manager), true);
  assert.equal(allowedPath(manager, "/espace-equipe/integrations"), true);
  assert.equal(allowedPath(developer, "/espace-equipe/integrations"), false);
  assert.equal(allowedPath(developer, "/espace-equipe/integrations/jeton-1"), false);
});
