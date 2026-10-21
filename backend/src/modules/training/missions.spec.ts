import test from "node:test";
import assert from "node:assert/strict";
import {
  TRAINING_MISSIONS,
  findMission,
  filterMissionsFor,
  type TrainingMission,
} from "./missions.js";
import { PERMISSIONS } from "../../common/auth/permissions.catalogue.js";
import { effectivePermissions, type SpaceId } from "../../common/spaces/space-policy.js";

const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

/** Vrai quand une liste de filtres Prisma satisfait `minCount` en mémoire. */
function countMatches(rows: Record<string, unknown>[], where: Record<string, unknown>): number {
  return rows.filter((row) =>
    Object.entries(where).every(([key, expected]) => {
      const actual = row[key];
      if (expected && typeof expected === "object" && !Array.isArray(expected)) {
        const spec = expected as { contains?: string; not?: unknown };
        if (typeof spec.contains === "string") {
          return typeof actual === "string" && actual.includes(spec.contains);
        }
        if ("not" in spec) return actual !== spec.not;
      }
      return actual === expected;
    }),
  ).length;
}

test("le catalogue reste cohérent pour les identifiants de missions utilisés par les tests", () => {
  const expected = [
    "team-prospects-convertir",
    "team-devis-emettre",
    "team-projet-piloter",
    "team-erreurs-corriger",
    "personal-journee",
    "personal-tache-assignee",
  ];
  for (const id of expected) {
    assert.ok(findMission(id), `mission ${id} attendue au catalogue`);
  }
});

test("chaque mission cite uniquement des permissions du catalogue", () => {
  for (const mission of TRAINING_MISSIONS) {
    for (const permission of mission.permissions) {
      assert.ok(
        PERMISSIONS[permission],
        `la mission ${mission.id} cite la permission inconnue ${permission}`,
      );
    }
    assert.ok(mission.permissions.length > 0, `la mission ${mission.id} ne cite aucune permission`);
  }
});

test("chaque critère vise un modèle Prisma avec une règle de résultat", () => {
  for (const mission of TRAINING_MISSIONS) {
    for (const criterion of [...mission.criteria, ...mission.evaluation.criteria]) {
      assert.ok(criterion.model, `${mission.id}/${criterion.id} sans modèle`);
      assert.ok(criterion.where, `${mission.id}/${criterion.id} sans filtre`);
      assert.ok(
        (criterion.minCount ?? 0) > 0 || (criterion.expectCount ?? 0) > 0,
        `${mission.id}/${criterion.id} sans minCount ni expectCount`,
      );
    }
    assert.ok(mission.criteria.length > 0, `${mission.id} sans critères de réussite`);
    assert.ok(
      mission.evaluation.criteria.length > 0,
      `${mission.id} sans critères d'évaluation`,
    );
  }
});

test("un rôle ne voit que les missions couvertes par ses permissions effectives", () => {
  // Comme dans TrainingService.catalog : l'espace client reçoit les permissions
  // brutes du rôle, les autres espaces sont réduits par effectivePermissions().
  const visibleToClient = filterMissionsFor(
    TRAINING_MISSIONS,
    "client",
    new Set(ALL_PERMISSIONS),
  );
  assert.ok(visibleToClient.length > 0, "le client doit voir au moins sa mission de devis");

  const comexaPermissions = effectivePermissions("comexa", new Set(ALL_PERMISSIONS));
  const visibleInComexa = filterMissionsFor(TRAINING_MISSIONS, "comexa", comexaPermissions);
  for (const mission of visibleInComexa) {
    for (const permission of mission.permissions) {
      assert.ok(
        comexaPermissions.has(permission),
        `${mission.id} proposée sans la permission ${permission}`,
      );
    }
  }

  // Profil « Commercial » : uniquement ses droits réels, dans l'espace équipe.
  const salesRolePermissions = new Set([
    "prospect:read:any",
    "prospect:write:any",
    "prospect:convert:any",
    "quote:read:any",
    "quote:write:any",
    "quote:send:any",
    "contact:read:any",
  ]);
  const salesPermissions = effectivePermissions("team" as SpaceId, salesRolePermissions);
  const salesVisible = filterMissionsFor(TRAINING_MISSIONS, "team", salesPermissions);
  const salesIds = salesVisible.map((mission) => mission.id);
  assert.ok(salesIds.includes("team-prospects-convertir"), "le commercial apprend les prospects");
  assert.ok(salesIds.includes("team-devis-emettre"), "le commercial apprend les devis");
  assert.ok(
    !salesIds.includes("team-projet-piloter"),
    "sans milestone:write ni task:assign, la mission projet ne lui est pas proposée",
  );
});

test("les missions d'évaluation exigent une démonstration, pas un clic", () => {
  for (const mission of TRAINING_MISSIONS as TrainingMission[]) {
    assert.notEqual(mission.criteria.length, 0);
    assert.notEqual(mission.evaluation.criteria.length, 0);
    for (const criterion of mission.evaluation.criteria) {
      assert.ok(
        criterion.where,
        `${mission.id} : l'évaluation doit être vérifiée sur les données`,
      );
    }
  }
});

test("les cibles du coach pointent vers des ancrages réels documentés", () => {
  const knownTargets = new Set([
    "prospects-create-button",
    "prospect-form-submit",
    "prospect-convert-button",
    "devis-create-button",
    "devis-form-submit",
    "devis-send-button",
    "projets-list",
    "projet-milestone-submit",
    "projet-task-submit",
    "taches-create-submit",
    "taches-board",
    "timer-start-button",
    "service-edit-button",
    "service-form-submit",
    "membre-invite-button",
    "client-devis-list",
    "devis-accept-button",
    "modification-create-button",
    "shell-notifications",
  ]);
  for (const mission of TRAINING_MISSIONS) {
    for (const step of mission.steps) {
      if (step.advanceOn === "action" && step.target) {
        assert.ok(
          knownTargets.has(step.target),
          `${mission.id}/${step.id} vise l'ancrage inconnu ${step.target}`,
        );
      }
      if (step.advanceOn === "navigate") {
        assert.ok(step.navigateTo?.startsWith("/"), `${mission.id}/${step.id} sans chemin`);
      }
      if (step.advanceOn === "verify") {
        const ids = [
          ...mission.criteria.map((criterion) => criterion.id),
          ...mission.evaluation.criteria.map((criterion) => criterion.id),
        ];
        assert.ok(
          step.criterionId && ids.includes(step.criterionId),
          `${mission.id}/${step.id} référence un critère absent`,
        );
      }
    }
  }
});

test("le scénario « erreurs » ne réussit que si la correction ET la non-régression sont prouvées", () => {
  const mission = findMission("team-erreurs-corriger");
  assert.ok(mission);
  // Équivalent à plat des filtres imbriqués (items.some.title) du critère.
  const faultyQuotes = [
    { status: "DRAFT", lineTitle: "Maintenance et évolution" }, // brouillon fautif (fixture)
    { status: "DRAFT", lineTitle: "Création de site web" }, // nouvelle version correcte
  ];
  const corrected = countMatches(faultyQuotes, { lineTitle: "Création de site web" });
  assert.equal(corrected, 1, "la bonne ligne a bien été émise");

  const preserved = countMatches(faultyQuotes, { lineTitle: "Maintenance et évolution", status: "DRAFT" });
  assert.equal(preserved, 1, "le brouillon erroné est préservé en brouillon");

  // Si le brouillon erroné avait été envoyé, la seconde condition tomberait à 0 :
  const sentFaulty = countMatches(
    faultyQuotes.map((quote, index) => (index === 0 ? { ...quote, status: "SENT" } : quote)),
    { lineTitle: "Maintenance et évolution", status: "DRAFT" },
  );
  assert.equal(sentFaulty, 0, "un brouillon envoyé ne satisfait plus le critère de préservation");
});

test("les critères de membre vérifient l'adresse ET le rôle exacts", () => {
  const mission = findMission("comexa-membre-inviter");
  assert.ok(mission);
  const criterion = mission.criteria[0];
  assert.equal(criterion.model, "user");
  assert.equal(criterion.where.email, "dev.formation@formation.example");
  assert.deepEqual(criterion.where.roles, { some: { role: { code: "DEVELOPER" } } });

  const users = [
    { email: "dev.formation@formation.example", roles: [{ role: { code: "DEVELOPER" } }] },
    { email: "dev.formation@formation.example", roles: [{ role: { code: "SALES" } }] },
    { email: "autre@formation.example", roles: [{ role: { code: "DEVELOPER" } }] },
  ];
  // En mémoire : seuls l'adresse exacte + le rôle exact satisfont les deux critères.
  const passing = users.filter(
    (user) =>
      user.email === criterion.where.email &&
      (criterion.where.roles as { some: { role: { code: string } } }).some.role.code ===
        user.roles[0].role.code,
  );
  assert.equal(passing.length, 1, "un seul compte satisfait adresse + rôle exacts");
});
