import test from "node:test";
import assert from "node:assert/strict";
import { consoleLink, operationDetails } from "./console-display.mjs";

test("sources internes relatives et correction du lien tâche sans page détail", () => {
  assert.deepEqual(consoleLink("https://comexa-portfolio.vercel.app/espace-equipe/projets/123"), { href: "/espace-equipe/projets/123", internal: true });
  assert.equal(consoleLink("/espace-equipe/taches/abc").href, "/espace-equipe/taches?tache=abc");
  assert.equal(consoleLink("https://example.org/source").internal, false);
});
test("refuse les protocoles actifs, identifiants et URL ambiguës", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "//evil.org", "/\\evil.org", "https://user:secret@example.org", "java\nscript:alert(1)", null]) assert.equal(consoleLink(value), null);
});
test("cartes enrichies et ancien contrat compatibles sans données inventées", () => {
  assert.deepEqual(operationDetails({ summary: "Terminer", entity: { name: "Audit" }, consequences: "TODO → DONE" }), { label: "Terminer", entityName: "Audit", consequences: "TODO → DONE" });
  assert.deepEqual(operationDetails({ description: "Ancienne proposition" }), { label: "Ancienne proposition", entityName: null, consequences: null });
  assert.equal(operationDetails("action123").label, null);
});
