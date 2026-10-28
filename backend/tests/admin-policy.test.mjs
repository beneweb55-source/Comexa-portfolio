/**
 * Mission 5 — Comexa Space : permissions, identite, jetons et masquage d'audit.
 *
 * Tests unitaires des VRAIES regles backend. Aucune base, aucun serveur HTTP :
 * ici on verifie que les invariants qui protegent l'administration restent
 * fermes, et que le journal ne devient pas un canal de fuite de secrets.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { preparePrismaStubs } from "./helpers/prisma-stubs.mjs";
import { RoleCode } from "../src/generated/prisma/enums.js";

// Garantir la présence des stubs hors ligne même si cette suite est lancée
// en dehors de `npm run test:invariants` (pretest:invariants). Idempotent :
// si un vrai client Prisma généré est présent, rien n'est créé.
preparePrismaStubs();
import {
  accessibleSpaces,
  canEnterSpace,
  COMEXA_ONLY,
  effectivePermissions,
  isSpaceId,
  spaceOfNotificationType,
  SPACE_IDS,
} from "../src/common/spaces/space-policy.ts";
import {
  ALL_PERMISSION_CODES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
} from "../src/common/auth/permissions.catalogue.ts";
import {
  assertAdministratorRemains,
  assertClientScopeDetachedBeforeRoleChange,
  assertClientScopeRequiresClientRole,
  assertNotLastActiveAdministrator,
  assertNotSelfAccount,
  assertRoleIsMutable,
  assertRolesKnown,
  isKnownRoleCode,
  unknownCodes,
} from "../src/modules/users/identity-rules.ts";
import {
  MASK,
  looksLikeCredential,
  isSensitiveKey,
  redactPayload,
} from "../src/modules/audit/redact.ts";
import {
  displayPrefixOf,
  generateIntegrationToken,
  hashIntegrationToken,
  integrationTokenMatches,
  isIntegrationTokenExpired,
  looksLikeIntegrationToken,
  normalizeIntegrationScopes,
} from "../src/common/auth/integration-token.ts";

function errorCode(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error?.code ?? null;
  }
}

test("Catalogue : chaque permission de chaque role existe, ADMIN reste le role 'ALL'", () => {
  const known = new Set(ALL_PERMISSION_CODES);
  assert.equal(ROLE_PERMISSIONS[RoleCode.ADMIN], "ALL");
  assert.equal(ALL_PERMISSION_CODES.length, Object.keys(PERMISSIONS).length);
  for (const [role, list] of Object.entries(ROLE_PERMISSIONS)) {
    if (list === "ALL") continue;
    for (const code of list) {
      assert.equal(known.has(code), true, `${role} reference un code inconnu : ${code}`);
    }
  }
  assert.equal(known.has("integration:manage:any"), true);
  assert.equal(known.has("audit:read:any"), true);
});

test("Espaces : un espace ne cree jamais de droit et n'enleve pas Comexa a ADMIN", () => {
  const all = new Set(ALL_PERMISSION_CODES);
  const comexa = effectivePermissions("comexa", all);
  const team = effectivePermissions("team", all);
  const personal = effectivePermissions("personal", all);

  assert.equal(comexa.has("audit:read:any"), true);
  assert.equal(comexa.has("setting:read:any"), true);
  assert.equal(comexa.has("quote:read:any"), false, "Les donnees commerciales ne sont pas des droits d'administration.");
  assert.equal(comexa.has("telegram:link:any"), false, "Lier Telegram pour autrui reste propre aux machines.");
  for (const code of COMEXA_ONLY) {
    assert.equal(team.has(code), false, `${code} ne doit pas sortir dans l'espace equipe.`);
  }
  assert.equal(personal.has("task:read:personal"), true);
  assert.equal(personal.has("quote:read:any"), false);
  assert.deepEqual([...SPACE_IDS], ["personal", "team", "comexa"]);
  assert.equal(isSpaceId("comexa"), true);
  assert.equal(isSpaceId("client"), false);
});

test("Espaces : client, machine et faux roles n'entrent pas dans l'administration", () => {
  const client = {
    roles: [RoleCode.CLIENT],
    permissions: new Set(ALL_PERMISSION_CODES),
    clientId: "client-a",
  };
  const machine = {
    roles: [RoleCode.ADMIN],
    permissions: new Set(ALL_PERMISSION_CODES),
    isIntegration: true,
  };
  assert.deepEqual(accessibleSpaces(client), []);
  assert.deepEqual(accessibleSpaces(machine), []);
  assert.equal(canEnterSpace("comexa", client), false);
  assert.equal(canEnterSpace("comexa", machine), false);

  const admin = { roles: [RoleCode.ADMIN], permissions: new Set(ALL_PERMISSION_CODES) };
  assert.deepEqual(accessibleSpaces(admin), ["personal", "team", "comexa"]);
  const limited = {
    roles: [RoleCode.COMMUNICATION_MANAGER],
    permissions: new Set(["service:read:any", "setting:read:any", "task:read:personal"]),
  };
  assert.equal(canEnterSpace("comexa", limited), true);
  assert.equal(canEnterSpace("team", limited), false);
});

test("Notifications : SYSTEM métier reste dans l'Espace équipe, un type inconnu aussi", () => {
  assert.equal(spaceOfNotificationType("SYSTEM"), "team");
  assert.equal(spaceOfNotificationType("TASK_ASSIGNED"), "personal");
  assert.equal(spaceOfNotificationType("QUOTE_SENT"), "team");
  assert.equal(spaceOfNotificationType("TYPE_FUTUR_INCONNU"), "team");
});

test("Identite : auto-suspension, role ADMIN et dernier administrateur sont proteges", () => {
  assert.equal(errorCode(() => assertNotSelfAccount("a", "a", "DELETE")), "SELF_DELETE_FORBIDDEN");
  assert.equal(errorCode(() => assertNotSelfAccount("a", "a", "SUSPEND")), "SELF_SUSPEND_FORBIDDEN");
  assert.equal(errorCode(() => assertNotSelfAccount("a", "b", "DELETE")), null);
  assert.equal(errorCode(() => assertRoleIsMutable(RoleCode.ADMIN)), "ROLE_IMMUTABLE");
  assert.equal(errorCode(() => assertRoleIsMutable(RoleCode.DEVELOPER)), null);
  assert.equal(errorCode(() => assertRolesKnown(["ADMIN", "INCONNU"], ["ADMIN"])), "UNKNOWN_ROLE");
  assert.deepEqual(unknownCodes(["a", "b", "c"], ["a", "c"]), ["b"]);
  assert.equal(isKnownRoleCode("ADMIN"), true);
  assert.equal(isKnownRoleCode("SUPERUSER"), false);

  assert.equal(
    errorCode(() =>
      assertAdministratorRemains({
        actorId: "a",
        targetId: "a",
        currentRoles: ["ADMIN"],
        nextRoles: ["DEVELOPER"],
        targetIsActive: true,
        activeAdminCount: 5,
      }),
    ),
    "SELF_ADMIN_REMOVAL_FORBIDDEN",
  );
  assert.equal(
    errorCode(() =>
      assertAdministratorRemains({
        actorId: "a",
        targetId: "b",
        currentRoles: ["ADMIN"],
        nextRoles: ["DEVELOPER"],
        targetIsActive: true,
        activeAdminCount: 1,
      }),
    ),
    "LAST_ADMIN_PROTECTED",
  );
  assert.equal(
    errorCode(() =>
      assertAdministratorRemains({
        actorId: "a",
        targetId: "b",
        currentRoles: ["ADMIN"],
        nextRoles: ["DEVELOPER"],
        targetIsActive: true,
        activeAdminCount: 2,
      }),
    ),
    null,
  );
  assert.equal(errorCode(() => assertNotLastActiveAdministrator(true, 1, "dernier")), "LAST_ADMIN_PROTECTED");
  assert.equal(errorCode(() => assertNotLastActiveAdministrator(false, 1, "inactif")), null);
});

test("Identite : un rattachement client exige le role CLIENT dans les deux sens", () => {
  assert.equal(
    errorCode(() => assertClientScopeRequiresClientRole("client-a", ["DEVELOPER"])),
    "CLIENT_ROLE_REQUIRED",
  );
  assert.equal(errorCode(() => assertClientScopeRequiresClientRole("client-a", ["CLIENT"])), null);
  assert.equal(errorCode(() => assertClientScopeRequiresClientRole(null, ["DEVELOPER"])), null);
  assert.equal(
    errorCode(() => assertClientScopeDetachedBeforeRoleChange("client-a", ["DEVELOPER"])),
    "CLIENT_SCOPE_STILL_ATTACHED",
  );
  assert.equal(errorCode(() => assertClientScopeDetachedBeforeRoleChange("client-a", ["CLIENT"])), null);
  assert.equal(errorCode(() => assertClientScopeDetachedBeforeRoleChange(null, ["DEVELOPER"])), null);
});

test("Audit : un secret cxi_, un JWT ou un bearer sont masques meme sous une cle anodine", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.c2lnbmF0dXJl";
  const token = `cxi_${"a".repeat(43)}`;
  assert.equal(looksLikeCredential(jwt), true);
  assert.equal(looksLikeCredential(token), true);
  assert.equal(looksLikeCredential("Bearer abc.def.ghi"), true);
  assert.equal(looksLikeCredential("simple note"), false);
  assert.equal(isSensitiveKey("passwordHash"), true);
  assert.equal(isSensitiveKey("x-api-key"), true);
  assert.equal(isSensitiveKey("role"), false);

  const redacted = redactPayload({
    role: "ADMIN",
    note: token,
    comment: jwt,
    authorizationText: "Bearer abc.def.ghi",
    nested: { user: { password: "secret", accessToken: "abc" } },
  });
  assert.equal(redacted.role, "ADMIN");
  assert.equal(redacted.note, MASK);
  assert.equal(redacted.comment, MASK);
  assert.equal(redacted.authorizationText, MASK);
  assert.equal(redacted.nested.user.password, MASK);
  assert.equal(redacted.nested.user.accessToken, MASK);
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes(jwt), false);
  assert.equal(serialized.includes("secret"), false);
});

test("Jetons d'integration : hash, forme, expiration et portées refusees", () => {
  const token = generateIntegrationToken();
  assert.equal(looksLikeIntegrationToken(token), true);
  assert.equal(displayPrefixOf(token).length, 12);
  const hash = hashIntegrationToken(token);
  assert.equal(hash.length, 64);
  assert.equal(integrationTokenMatches(token, hash), true);
  assert.equal(integrationTokenMatches(`${token}x`, hash), false);
  assert.equal(looksLikeIntegrationToken("cxi_trop-court"), false);

  const now = new Date("2026-10-28T00:00:00.000Z");
  assert.equal(isIntegrationTokenExpired("2026-10-28T00:00:00.000Z", now), true, "A l'instant exact, le jeton ne passe plus.");
  assert.equal(isIntegrationTokenExpired("2026-10-29T00:00:00.000Z", now), false);
  assert.equal(isIntegrationTokenExpired(null, now), false);
  assert.equal(isIntegrationTokenExpired("date-invalide", now), true);

  const known = new Set(ALL_PERMISSION_CODES);
  assert.deepEqual(normalizeIntegrationScopes(["task:read:any", "task:read:any"], known), {
    ok: true,
    scopes: ["task:read:any"],
  });
  const refused = normalizeIntegrationScopes(["integration:manage:any", "code:inconnu:any"], known);
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.forbidden, ["integration:manage:any"]);
  assert.deepEqual(refused.unknown, ["code:inconnu:any"]);
});
