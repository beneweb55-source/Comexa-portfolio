import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  QUICK_ADD_MAX_ESTIMATE_MINUTES,
  parseQuickAddPhrase,
  personalTaskPayload,
  quickAddFormError,
  quickAddRecognitionKey,
  formatQuickMinutes,
} from "../src/lib/task-quick-add.mjs";
import { addDaysToDay, dueDateForLocalDay, isIsoDay } from "../src/lib/day-utils.mjs";
import {
  buildDayPlan,
  canPostponeTask,
  eventOverlapsDay,
  postponePayload,
  timedEventMinutesOn,
} from "../src/lib/day-plan.mjs";
import { localDay } from "../src/lib/task-status.mjs";

const sourceRoot = process.env.COMEXA_TEST_SOURCE_ROOT ?? process.cwd();
const read = (path) => readFileSync(join(sourceRoot, path), "utf8");

// Midi local : les tests restent valables quel que soit le fuseau du runner.
const NOW = new Date(2026, 9, 27, 12, 0, 0);
const TODAY = localDay(NOW);
const TOMORROW = addDaysToDay(TODAY, 1);
const GOALS = [
  { id: "g-examen", title: "Examen final", status: "ACTIVE" },
  { id: "g-archive", title: "Projet ancien", status: "ARCHIVED" },
];

function task(id, overrides = {}) {
  return {
    id,
    title: `Tâche ${id}`,
    status: "TODO",
    priority: "NORMAL",
    dueDate: dueDateForLocalDay(TODAY),
    estimateMinutes: null,
    isPersonal: true,
    project: null,
    goal: null,
    completedAt: null,
    ...overrides,
  };
}

test("saisie rapide : l'exemple métier complet est reconnu sans appel IA", () => {
  const parsed = parseQuickAddPhrase(
    "Réviser le chapitre 3 demain pendant 2 h, priorité haute, objectif:examen-final",
    { now: NOW, goals: GOALS },
  );
  assert.equal(parsed.title, "Réviser le chapitre 3");
  assert.equal(parsed.dueDate, TOMORROW);
  assert.equal(parsed.priority, "HIGH");
  assert.equal(parsed.estimateMinutes, 120);
  assert.equal(parsed.goalId, "g-examen");
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(parsed.detected.map((item) => item.field), [
    "dueDate",
    "priority",
    "estimateMinutes",
    "goalId",
  ]);
});

test("saisie rapide : les valeurs reconnues ont une étiquette visible", () => {
  const parsed = parseQuickAddPhrase("Relire notes aujourd’hui pour 1h30 p1 #examen-final", { now: NOW, goals: GOALS });
  assert.equal(parsed.title, "Relire notes");
  assert.equal(parsed.dueDate, TODAY);
  assert.equal(parsed.priority, "URGENT");
  assert.equal(parsed.estimateMinutes, 90);
  assert.equal(parsed.goalId, "g-examen");
  assert.equal(parsed.detected.find((item) => item.field === "estimateMinutes")?.value, "1 h 30 min");
  assert.equal(parsed.detected.find((item) => item.field === "dueDate")?.raw, "aujourd’hui");
});

test("saisie rapide : dates explicites et année déduite explicitement", () => {
  const numeric = parseQuickAddPhrase("Rendre devoir le 12/11", { now: NOW, goals: GOALS });
  assert.equal(numeric.title, "Rendre devoir");
  assert.equal(numeric.dueDate, `${TODAY.slice(0, 4)}-11-12`);
  const past = parseQuickAddPhrase("Archiver dossier 12/09", { now: NOW, goals: GOALS });
  assert.equal(past.dueDate, `${Number(TODAY.slice(0, 4)) + 1}-09-12`);
  assert.equal(past.assumptions.length, 1);
  assert.match(past.assumptions[0], /sans année/);
  const iso = parseQuickAddPhrase("Réunion 2026-10-29", { now: NOW, goals: GOALS });
  assert.equal(iso.dueDate, "2026-10-29");
  const named = parseQuickAddPhrase("Envoyer rapport 3 novembre", { now: NOW, goals: GOALS });
  assert.equal(named.dueDate, `${TODAY.slice(0, 4)}-11-03`);
});

test("saisie rapide : aucun chiffre du titre n'est pris pour une durée", () => {
  const parsed = parseQuickAddPhrase("Réviser le chapitre 3 et l'histoire demain", { now: NOW, goals: GOALS });
  assert.equal(parsed.title, "Réviser le chapitre 3 et l'histoire");
  assert.equal(parsed.dueDate, TOMORROW);
  assert.equal(parsed.estimateMinutes, null);
  assert.deepEqual(parsed.warnings, []);
});

test("saisie rapide : conflits -> aucune valeur imposée, avertissements actionnables", () => {
  const parsed = parseQuickAddPhrase(
    "Préparer soutenance demain 12/11 pendant 2 h pendant 30 min priorité haute priorité basse",
    { now: NOW, goals: GOALS },
  );
  assert.equal(parsed.title, "Préparer soutenance");
  assert.equal(parsed.dueDate, null);
  assert.equal(parsed.priority, null);
  assert.equal(parsed.estimateMinutes, null);
  assert.equal(parsed.detected.length, 0);
  assert.equal(parsed.warnings.length, 3);
  assert.ok(parsed.warnings.every((warning) => /choisissez/i.test(warning)));
});

test("saisie rapide : objectif inconnu, archivé ou ambigu n'est jamais lié en silence", () => {
  const unknown = parseQuickAddPhrase("Lire cours #inconnu", { now: NOW, goals: GOALS });
  assert.equal(unknown.goalId, null);
  assert.match(unknown.warnings[0], /introuvable ou non actif/);

  const archived = parseQuickAddPhrase("Lire cours #projet-ancien", { now: NOW, goals: GOALS });
  assert.equal(archived.goalId, null);
  assert.match(archived.warnings[0], /introuvable ou non actif/);

  const ambiguousGoals = [
    { id: "g1", title: "Examen final", status: "ACTIVE" },
    { id: "g2", title: "Examen-Final", status: "ACTIVE" },
  ];
  const ambiguous = parseQuickAddPhrase("Lire cours #examen-final", { now: NOW, goals: ambiguousGoals });
  assert.equal(ambiguous.goalId, null);
  assert.match(ambiguous.warnings[0], /Plusieurs objectifs/);
});

test("saisie rapide : objectif entre guillemets et durée fractionnaire", () => {
  const parsed = parseQuickAddPhrase('Relire le cours pendant 1,5 h objectif:"Examen final"', { now: NOW, goals: GOALS });
  assert.equal(parsed.title, "Relire le cours");
  assert.equal(parsed.estimateMinutes, 90);
  assert.equal(parsed.goalId, "g-examen");
});

test("saisie rapide : durée invalide, estimation maximale et formatage", () => {
  const invalid = parseQuickAddPhrase("Tâche pendant 0 h", { now: NOW, goals: GOALS });
  assert.equal(invalid.estimateMinutes, null);
  assert.match(invalid.warnings[0], /invalide/);
  assert.equal(formatQuickMinutes(90), "1 h 30 min");
  assert.equal(formatQuickMinutes(120), "2 h");
  assert.equal(QUICK_ADD_MAX_ESTIMATE_MINUTES, 60_000);
});

test("saisie rapide : validation locale et corps API sans statut ni projet", () => {
  assert.match(quickAddFormError({ title: "x", estimateMinutes: "" }), /2 caractères/);
  assert.match(quickAddFormError({ title: "Tâche", estimateMinutes: "0" }), /1 à 60000/);
  assert.equal(quickAddFormError({ title: "Tâche", dueDate: TODAY, estimateMinutes: "45" }), null);

  const payload = personalTaskPayload({
    title: "  Réviser  ",
    dueDate: TOMORROW,
    priority: "HIGH",
    estimateMinutes: "45",
    goalId: "g-examen",
  });
  assert.deepEqual(payload, {
    title: "Réviser",
    priority: "HIGH",
    dueDate: dueDateForLocalDay(TOMORROW),
    estimateMinutes: 45,
    goalId: "g-examen",
  });
  assert.ok(!("status" in payload));
  assert.ok(!("projectId" in payload));
  assert.ok(!("assigneeId" in payload));
  assert.equal(isIsoDay(TOMORROW), true);
});

test("saisie rapide : la signature ne change pas quand une valeur reconnue est stable", () => {
  const first = parseQuickAddPhrase("Tâche demain", { now: NOW, goals: GOALS });
  const second = parseQuickAddPhrase("Tâche demain !", { now: NOW, goals: GOALS });
  assert.equal(quickAddRecognitionKey(first), quickAddRecognitionKey(second));
});

test("plan du jour : une estimation absente n'est pas une estimation de zéro", () => {
  const plan = buildDayPlan({
    tasks: [
      task("a", { estimateMinutes: 90 }),
      task("b", { estimateMinutes: null }),
      task("c", { estimateMinutes: 0 }),
    ],
    events: [],
    now: NOW,
  });
  assert.equal(plan.dueTasks.length, 3);
  assert.equal(plan.estimatedMinutes, 90);
  assert.equal(plan.unestimatedCount, 2);
  assert.equal(plan.knownLoadMinutes, 90);
  assert.equal(plan.hasLoadData, true);
});

test("plan du jour : prochaine action, retards et tâches terminées aujourd'hui", () => {
  const yesterday = addDaysToDay(TODAY, -1);
  const plan = buildDayPlan({
    tasks: [
      task("normal", { title: "Aujourd'hui", priority: "LOW" }),
      task("late", { title: "En retard", dueDate: dueDateForLocalDay(yesterday), priority: "LOW" }),
      task("done", { status: "DONE", completedAt: `${TODAY}T15:00:00Z` }),
      task("done-other-day", { status: "DONE", completedAt: `${yesterday}T15:00:00Z` }),
      task("later", { dueDate: dueDateForLocalDay(addDaysToDay(TODAY, 3)) }),
    ],
    events: [],
    now: NOW,
  });
  assert.equal(plan.nextTask.id, "late");
  assert.equal(plan.overdueCount, 1);
  assert.equal(plan.doneToday, 1);
  assert.deepEqual(plan.decisionTasks.map((item) => item.id), ["late", "normal"]);
});

test("plan du jour : événements chevauchants fusionnés, journée entière non inventée", () => {
  const events = [
    { id: "e1", startsAt: `${TODAY}T09:00:00Z`, endsAt: `${TODAY}T11:00:00Z`, allDay: false },
    { id: "e2", startsAt: `${TODAY}T10:00:00Z`, endsAt: `${TODAY}T12:00:00Z`, allDay: false },
    { id: "e3", startsAt: `${TODAY}T00:00:00Z`, endsAt: `${TODAY}T23:59:00Z`, allDay: true },
  ];
  assert.equal(timedEventMinutesOn(events, NOW), 180);
  const plan = buildDayPlan({ tasks: [], events, now: NOW });
  assert.equal(plan.eventMinutes, 180);
  assert.equal(plan.timedEventCount, 2);
  assert.equal(plan.allDayEventCount, 1);
  assert.equal(plan.hasLoadData, true);
});

test("plan du jour : un événement commencé la veille compte pour sa partie d'aujourd'hui", () => {
  const yesterday = addDaysToDay(TODAY, -1);
  const overnight = {
    id: "overnight",
    startsAt: `${yesterday}T23:00:00Z`,
    endsAt: `${TODAY}T02:00:00Z`,
    allDay: false,
  };
  assert.equal(eventOverlapsDay(overnight, NOW), true);
  const plan = buildDayPlan({ tasks: [], events: [overnight], now: NOW });
  // Jour local Africa/Algiers : minuit UTC = 01:00, donc une heure encore
  // aujourd'hui. Le test accepte aussi un runner UTC (deux heures).
  assert.ok(plan.eventMinutes === 60 || plan.eventMinutes === 120);
  assert.equal(plan.timedEventCount, 1);
  assert.equal(plan.allDayEventCount, 0);
});

test("plan du jour : aucune donnée de charge n'est présentée comme une journée libre", () => {
  const plan = buildDayPlan({ tasks: [task("a")], events: [], now: NOW });
  assert.equal(plan.knownLoadMinutes, 0);
  assert.equal(plan.hasLoadData, false);
  assert.equal(plan.unestimatedCount, 1);
});

test("report : permission, objectif atteint et charge utile du PATCH", () => {
  const personal = task("p", { isPersonal: true });
  const project = task("q", { isPersonal: false });
  assert.equal(canPostponeTask(personal, { canWritePersonal: true }), true);
  assert.equal(canPostponeTask(personal, { canWriteProject: true }), false);
  assert.equal(canPostponeTask(project, { canWriteProject: true }), true);
  assert.equal(canPostponeTask(project, { canWritePersonal: true }), false);
  assert.equal(canPostponeTask({ ...personal, status: "DONE" }, { canWritePersonal: true }), false);
  assert.equal(
    canPostponeTask({ ...personal, goal: { status: "ACHIEVED" } }, { canWritePersonal: true }),
    false,
  );
  assert.deepEqual(postponePayload(NOW), { dueDate: dueDateForLocalDay(TOMORROW) });
});

test("contrat écran : TaskComposer expose reconnaissance, contrôles et succès", () => {
  const source = read("src/components/tasks/TaskComposer.jsx");
  assert.match(source, /parseQuickAddPhrase/);
  assert.match(source, /personalTaskPayload/);
  assert.match(source, /Informations reconnues/);
  assert.match(source, /role="status"/);
  assert.match(source, /type="number"/);
  assert.match(source, /max=\{QUICK_ADD_MAX_ESTIMATE_MINUTES\}/);
  assert.match(source, /request\("\/me\/tasks"/);
  assert.match(source, /Tâche « \$\{payload\.title\} » ajoutée/);
  assert.match(source, /la liste n’a pas pu être actualisée/);
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /agent-chat|openai|anthropic|\bLLMs?\b|generateText/i);
});

test("contrat écran : Ma journée relie saisie, charge connue et report explicite", () => {
  const source = read("src/components/dashboard/PersonalDashboard.jsx");
  assert.match(source, /<TaskComposer/);
  assert.match(source, /buildDayPlan/);
  assert.match(source, /Plan du jour/);
  assert.match(source, /Prochaine action/);
  assert.match(source, /Charge connue/);
  assert.match(source, /ne connaît pas encore vos horaires/);
  assert.match(source, /Données insuffisantes/);
  assert.match(source, /postponePayload\(now\)/);
  assert.match(source, /Reporter « \$\{task\.title\} » à demain/);
  assert.match(source, /canPostponeTask/);
  assert.doesNotMatch(source, /déplacer automatiquement/i);
});

test("contrat écran : permissions et confidentialité existantes conservées", () => {
  const dashboard = read("src/components/dashboard/PersonalDashboard.jsx");
  const workspace = read("src/components/workspace/PersonalWorkspace.jsx");
  assert.match(dashboard, /useAllListing\("\/me\/tasks\?perPage=100"/);
  assert.match(dashboard, /\/me\/calendar\/events\?from=/);
  assert.doesNotMatch(dashboard, /request\("\/tasks\?/);
  assert.match(workspace, /activeGoals/);
  assert.match(workspace, /goals=\{activeGoals\}/);
  const parser = read("src/lib/task-quick-add.mjs");
  assert.match(parser, /status === "ACTIVE"/);
});

test("contrat écran : responsive locale, cibles tactiles et absence de largeur fixe", () => {
  const css = read("src/styles/softui.productivity.css");
  assert.match(css, /\.sui-composer \.sui-composer__option[\s\S]*min-height: 40px/);
  assert.match(css, /\.sui-lines__tomorrow \{\s*min-height: 40px/);
  assert.match(css, /container-name: task-composer/);
  assert.match(css, /@container task-composer \(max-width: 820px\)/);
  assert.match(css, /@container \(max-width: 620px\)/);
  assert.match(css, /@container \(max-width: 520px\)/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /flex-wrap: wrap/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.doesNotMatch(css.slice(css.indexOf("MISSION 2")), /min-width:\s*[5-9]\d{2}px/);
});
