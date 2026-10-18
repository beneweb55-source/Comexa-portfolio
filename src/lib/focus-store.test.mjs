import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FOCUS_PRESETS,
  FOCUS_MIN_MINUTES,
  FOCUS_MAX_MINUTES,
  clampMinutes,
  dayKey,
  focusStats,
  formatFocus,
  formatPlanned,
  readFocusState,
  writeFocusState,
} from "./focus-store.mjs";

/** Stockage en mémoire, fidèle à l'interface utilisée (getItem/setItem). */
function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    map,
  };
}

const DAY = 86_400_000;
const AT = new Date("2026-03-10T09:00:00").getTime();

function entry(daysAgo, seconds, { taskTitle = "Tâche", completedAt = null } = {}) {
  return {
    completedAt: completedAt ?? new Date(AT - daysAgo * DAY).toISOString(),
    focusedSeconds: seconds,
    taskTitle,
  };
}

test("un stockage vide rend un état vierge", () => {
  const state = readFocusState(memoryStorage());
  assert.equal(state.session, null);
  assert.deepEqual(state.history, []);
  assert.equal(state.dnd, false);
});

test("un stockage qui explose ne fait pas tomber la page", () => {
  const state = readFocusState(memoryStorage({ "comexa.focus.v1": "{pas du json" }));
  assert.equal(state.session, null);
  assert.deepEqual(state.history, []);
});

test("un contenu étranger est écarté, pas propagé", () => {
  const state = readFocusState(
    memoryStorage({
      "comexa.focus.v1": JSON.stringify({
        session: { plannedMinutes: "beaucoup", startedAt: 42 },
        history: [{ completedAt: "x" }, entry(0, 60)],
        dnd: null,
        lastMinutes: 999,
      }),
    }),
  );
  assert.equal(state.session, null);
  assert.equal(state.history.length, 1);
  assert.equal(state.dnd, false);
  // 999 minutes n'est pas une durée raisonnable : elle est ramenée au plafond.
  assert.equal(state.lastMinutes, FOCUS_MAX_MINUTES);
});

test("les indicateurs sont forcés en booléen, jamais en chaîne", () => {
  const state = readFocusState(
    memoryStorage({ "comexa.focus.v1": JSON.stringify({ dnd: "oui", session: null, history: [] }) }),
  );
  // `Boolean()` est volontaire : un `if (state.dnd)` en aval ne doit jamais
  // dépendre de la forme stockée.
  assert.equal(state.dnd, true);
  assert.equal(typeof state.dnd, "boolean");
});

test("écrire puis relire rend la même session", () => {
  const storage = memoryStorage();
  const session = {
    taskId: "tsk_1",
    taskTitle: "Intégration du catalogue",
    projectName: "Boutique Vasseur",
    plannedMinutes: 50,
    note: "page produit",
    startedAt: new Date(AT).toISOString(),
  };
  assert.equal(writeFocusState(storage, { session, history: [], dnd: true, lastMinutes: 90 }), true);

  const back = readFocusState(storage);
  assert.deepEqual(back.session, session);
  assert.equal(back.dnd, true);
  assert.equal(back.lastMinutes, 90);
});

test("les durées sont bornées des deux côtés", () => {
  assert.equal(clampMinutes(1), FOCUS_MIN_MINUTES);
  assert.equal(clampMinutes(10_000), FOCUS_MAX_MINUTES);
  assert.equal(clampMinutes(50), 50);
  assert.equal(clampMinutes("25"), 25);
  assert.equal(clampMinutes(Number.NaN), FOCUS_PRESETS[1]);
});

test("la clé de jour est locale, pas UTC", () => {
  // 23 h 30 à Alger tombe le lendemain en UTC : la journée doit rester locale.
  assert.equal(dayKey(new Date("2026-03-10T23:30:00").getTime()), "2026-03-10");
});

test("le total du jour ne compte que la journée en cours", () => {
  const stats = focusStats([entry(0, 3600), entry(1, 7200), entry(2, 600)], AT);
  assert.equal(stats.todaySeconds, 3600);
  assert.equal(stats.todayCount, 1);
  assert.equal(stats.totalSeconds, 3600 + 7200 + 600);
});

test("la semaine glissante couvre sept jours, pas un calendrier", () => {
  const stats = focusStats([entry(0, 60), entry(6, 60), entry(7, 60)], AT);
  assert.equal(stats.weekSeconds, 120);
  assert.equal(stats.weekCount, 2);
});

test("la série survit à une journée encore vide", () => {
  const stats = focusStats([entry(1, 60), entry(2, 60)], AT);
  assert.equal(stats.streak, 2);
});

test("la série casse sur un jour manqué", () => {
  const stats = focusStats([entry(2, 60), entry(3, 60)], AT);
  assert.equal(stats.streak, 0);
});

test("le meilleur jour est le maximum, pas la moyenne", () => {
  const stats = focusStats([entry(0, 600), entry(1, 3600), entry(2, 1200)], AT);
  assert.equal(stats.bestSeconds, 3600);
});

test("l'historique est plafonné pour rester lisible", () => {
  const storage = memoryStorage();
  const history = Array.from({ length: 900 }, (_, index) => entry(index % 400, 60));
  writeFocusState(storage, { session: null, history, dnd: false, lastMinutes: 25 });
  assert.ok(readFocusState(storage).history.length <= 500);
});

test("formatage des durées", () => {
  assert.equal(formatFocus(0), "0 min");
  assert.equal(formatFocus(45 * 60), "45 min");
  assert.equal(formatFocus(3600), "1 h");
  assert.equal(formatFocus(85 * 60), "1 h 25");
  assert.equal(formatPlanned(50), "50 minutes");
  assert.equal(formatPlanned(90), "1 h 30");
  assert.equal(formatPlanned(120), "2 h");
});
