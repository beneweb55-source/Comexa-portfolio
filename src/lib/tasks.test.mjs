import assert from "node:assert/strict";
import test from "node:test";
import {
  EVERY_CREATOR,
  creatorAvatarUrlOf,
  creatorInitialsOf,
  creatorNameOf,
  taskCreatorsPath,
  taskListPath,
  tasksPayloadIsOutdated,
} from "./tasks.mjs";

test("taskListPath ouvre toutes les tâches du projet quand le filtre vaut « Tous »", () => {
  const path = taskListPath("prj-1", { page: 2, perPage: 100, reporterId: EVERY_CREATOR });

  assert.equal(path, "/projects/prj-1/tasks?page=2&perPage=100");
  assert.equal(path.includes("reporterId"), false);
});

test("taskListPath filtre avec l'identifiant du compte, jamais avec un nom", () => {
  const path = taskListPath("prj-1", { reporterId: "user-1" });
  const params = new URLSearchParams(path.split("?")[1]);

  assert.equal(params.get("reporterId"), "user-1");
  assert.equal(params.get("page"), "1");
  assert.equal(params.get("perPage"), "100");
});

test("taskListPath n'ajoute rien pour un filtre vide ou non textuel", () => {
  for (const reporterId of ["", null, undefined, 42]) {
    assert.equal(taskListPath("prj-1", { reporterId }).includes("reporterId"), false);
  }
});

test("taskListPath encode l'identifiant de projet et reste dans son préfixe", () => {
  const path = taskListPath("prj/1 2");

  assert.ok(path.startsWith("/projects/prj%2F1%202/tasks?"), path);
});

test("taskCreatorsPath vise les créateurs du projet", () => {
  assert.equal(taskCreatorsPath("prj-1"), "/projects/prj-1/tasks/creators");
});

test("creatorNameOf rend « Prénom Nom », puis un repli lisible", () => {
  assert.equal(creatorNameOf({ firstName: "Nadia", lastName: "Belkacem" }), "Nadia Belkacem");
  assert.equal(creatorNameOf({ firstName: "Nadia" }), "Nadia");
  assert.equal(creatorNameOf({ email: "nadia@comexa.example" }), "nadia@comexa.example");
  assert.equal(creatorNameOf(null), "Créateur inconnu");
});

test("creatorInitialsOf ne dépasse jamais deux lettres", () => {
  assert.equal(creatorInitialsOf({ firstName: "Nadia", lastName: "Belkacem" }), "NB");
  assert.equal(creatorInitialsOf({ firstName: "nadia" }), "N");
  assert.equal(creatorInitialsOf({ email: "nadia@comexa.example" }), "NA");
  assert.equal(creatorInitialsOf(null), "?");
});

test("creatorAvatarUrlOf n'accepte qu'une adresse affichable, sinon null", () => {
  assert.equal(creatorAvatarUrlOf({ avatarUrl: "https://cdn.example/nadia.png" }), "https://cdn.example/nadia.png");
  assert.equal(creatorAvatarUrlOf({ avatarUrl: "/api/users/user-1/avatar" }), "/api/users/user-1/avatar");
  // Clé de stockage : le binaire n'est pas joignable par le navigateur.
  assert.equal(creatorAvatarUrlOf({ avatarKey: "avatars/2026/09/uuid.png" }), null);
  assert.equal(creatorAvatarUrlOf({ avatarKey: "   " }), null);
  assert.equal(creatorAvatarUrlOf({}), null);
  assert.equal(creatorAvatarUrlOf(null), null);
});

test("tasksPayloadIsOutdated signale une reponse d'API anterieure au filtre par personne", () => {
  assert.equal(tasksPayloadIsOutdated([{ id: "t1", title: "Cadrage", project: { id: "p1" }, reporter: { id: "u1" } }]), false);
  assert.equal(tasksPayloadIsOutdated([{ id: "t1", title: "Cadrage", reporter: null }]), true);
  assert.equal(tasksPayloadIsOutdated([{ id: "t1", title: "Cadrage", project: null }]), true);
  assert.equal(tasksPayloadIsOutdated([null, undefined]), false);
  assert.equal(tasksPayloadIsOutdated(null), false);
  assert.equal(tasksPayloadIsOutdated([]), false);
});
