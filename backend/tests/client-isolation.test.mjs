/**
 * Mission 4 — isolation du role CLIENT, sans base de donnees.
 *
 * Ces tests executent les vraies fonctions pures du backend (avec `tsx`) :
 * perimetre projet, visibilite documentaire, fil d'activite et politique
 * d'espaces. Ils ne remplacent pas un test d'integration HTTP, mais ils
 * verifient que les regles les plus sensibles restent fermees.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { preparePrismaStubs } from "./helpers/prisma-stubs.mjs";
import { projectScopeWhere } from "../src/modules/projects/project-scope.ts";

// Garantir la présence des stubs hors ligne même si cette suite est lancée
// en dehors de `npm run test:invariants` (pretest:invariants). Idempotent :
// si un vrai client Prisma généré est présent, rien n'est créé.
preparePrismaStubs();
import {
  CLIENT_VISIBILITIES,
  narrowVisibilities,
  resolveDocumentAccess,
} from "../src/modules/documents/document-visibility.ts";
import { ActivityService } from "../src/modules/activity/activity.service.ts";
import { accessibleSpaces, effectivePermissions } from "../src/common/spaces/space-policy.ts";

function activityPrismaStub() {
  const whereSeen = [];
  const prisma = {
    activity: {
      findMany: async ({ where }) => {
        whereSeen.push(where);
        return [];
      },
      count: async ({ where }) => {
        whereSeen.push(where);
        return 0;
      },
    },
    $transaction: async (promises) => Promise.all(promises),
  };
  return { prisma, whereSeen };
}

test("Projet : un client ne voit que le dossier client de son jeton", () => {
  const clientA = { userId: "user-a", clientId: "client-a", isClient: true };
  const clientB = { userId: "user-b", clientId: "client-b", isClient: true };
  assert.deepEqual(projectScopeWhere("own", clientA), { clientId: "client-a" });
  assert.deepEqual(projectScopeWhere("own", clientB), { clientId: "client-b" });
  assert.notDeepEqual(projectScopeWhere("own", clientA), projectScopeWhere("own", clientB));
  assert.deepEqual(projectScopeWhere("own", { userId: "u", clientId: null, isClient: true }), { id: { in: [] } });
  assert.deepEqual(projectScopeWhere("any", clientA), {});
});

test("Document : un client ne voit jamais INTERNAL, meme avec un droit trop large", () => {
  const scope = resolveDocumentAccess({
    isClient: true,
    clientId: "client-a",
    permissions: new Set(["document:read:any", "document:read:client"]),
  });
  assert.equal(scope.scope, "client");
  assert.equal(scope.clientId, "client-a");
  assert.deepEqual([...scope.visibilities], [...CLIENT_VISIBILITIES]);
  assert.equal(scope.visibilities.includes("INTERNAL"), false);
  assert.throws(() => narrowVisibilities(CLIENT_VISIBILITIES, "INTERNAL"));
  assert.deepEqual(narrowVisibilities(CLIENT_VISIBILITIES, "CLIENT"), ["CLIENT"]);
  assert.throws(() => resolveDocumentAccess({ isClient: true, clientId: null, permissions: new Set(["document:read:client"]) }));
});

test("Activite : asClient force isClientVisible:true cote serveur", async () => {
  const { prisma, whereSeen } = activityPrismaStub();
  const service = new ActivityService(prisma);
  await service.listForProject("project-a", { perPage: 5 }, { asClient: true });
  assert.equal(whereSeen.length, 2, "findMany et count doivent porter le meme filtre.");
  for (const where of whereSeen) {
    assert.equal(where.projectId, "project-a");
    assert.equal(where.isClientVisible, true);
  }
});

test("Activite : listForClient filtre aussi sur le dossier client", async () => {
  const { prisma, whereSeen } = activityPrismaStub();
  const service = new ActivityService(prisma);
  await service.listForClient("client-a", { perPage: 5 });
  for (const where of whereSeen) {
    assert.equal(where.clientId, "client-a");
    assert.equal(where.isClientVisible, true);
  }
});

test("Espaces : un compte CLIENT n'entre dans aucun espace interne", () => {
  const client = {
    roles: ["CLIENT"],
    permissions: new Set([
      "project:read:own",
      "quote:read:own",
      "invoice:read:own",
      "document:read:client",
      "notification:read:own",
      "dashboard:read:own",
    ]),
    clientId: "client-a",
  };
  assert.deepEqual(accessibleSpaces(client), []);
  const teamEffective = effectivePermissions("team", client.permissions);
  assert.equal(teamEffective.has("project:write:any"), false);
  assert.equal(teamEffective.has("document:read:any"), false);
});
