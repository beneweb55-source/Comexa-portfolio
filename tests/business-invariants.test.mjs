/**
 * Miroir frontend des invariants metier — `node --test tests/business-invariants.test.mjs`
 *
 * Le frontend ne DECIDE pas : ces regles ne servent qu'a ne pas proposer un
 * geste que l'API refuse (`goalCanBeAchieved`) et a ne plus afficher un
 * pourcentage invente (anneau force a 100 % sur un objectif « atteint » vide).
 * Le contrat cote serveur est teste dans
 * `backend/tests/business-invariants.test.mjs`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { goalCanBeAchieved, goalProgressOf } from "../src/lib/goals.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

test("objectif: le miroir frontend applique le meme invariant que le serveur", () => {
  // Oracle independant : au moins une tache DONE, aucune tache ouverte, et
  // aucune tache annulee ne doit etre prise pour du travail fait.
  const cases = [
    [[], false],
    [["TODO"], false],
    [["CANCELLED"], false],
    [["DONE", "CANCELLED"], true],
    [["DONE", "TODO"], false],
    [["DONE", "IN_PROGRESS", "CANCELLED"], false],
    [["DONE", "DONE"], true],
  ];
  for (const [statuses, expected] of cases) {
    const progress = goalProgressOf(statuses);
    const counted = statuses.filter((status) => status !== "CANCELLED");
    const oracle = counted.length > 0 && counted.every((status) => status === "DONE");
    assert.equal(oracle, expected, `oracle ${statuses.join(",")}`);
    assert.equal(
      goalCanBeAchieved(progress),
      expected,
      `goalCanBeAchieved(${statuses.join(",") || "vide"})`,
    );
  }
  assert.equal(goalCanBeAchieved(null), false);
});

test("objectif: aucun faux 100 % n'est fabrique cote interface", () => {
  const card = read("src/components/goals/GoalParts.jsx");
  assert.ok(
    !card.includes("countable === 0 ? 100"),
    "l'anneau ne doit plus etre force a 100 % pour un objectif atteint vide",
  );
  assert.match(card, /<GoalRing percent=\{progress\.percent\}/);
  assert.match(card, /needsReopen/, "les objectifs historiques incoherents sont expliques");
});

test("objectif: les ecrans n'offrent pas un geste que l'API refuse", () => {
  const workspace = read("src/components/workspace/PersonalWorkspace.jsx");
  assert.match(workspace, /goalCanBeAchieved\(after\)/);
  assert.match(workspace, /goalCanBeAchieved\(progress\)/);
  assert.match(workspace, /disabled=\{!achievable\}/);
  assert.match(workspace, /goal\.status === "ACTIVE"/);

  const row = read("src/components/tasks/PersonalTaskRow.jsx");
  assert.match(row, /goal\.status === "ACTIVE"/);
  assert.match(row, /linkedClosedGoal/);
  assert.match(row, /Rouvrez cet objectif avant de détacher une tâche/);
});

test("devis: le statut Expiré a un libelle, une teinte et un message client", () => {
  const commercial = read("src/lib/commercial.js");
  assert.match(commercial, /EXPIRED: "Expiré"/);
  assert.match(commercial, /QUOTE_STATUS_TONE = \{[^}]*EXPIRED:/s);
  const page = read("src/app/(session)/espace-client/devis/[id]/page.jsx");
  assert.match(page, /data\.status === "EXPIRED"/);
  assert.match(page, /Ce devis est arrivé à échéance/);
});
