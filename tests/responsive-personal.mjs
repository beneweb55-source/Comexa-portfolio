/**
 * Test responsive réel de l'Espace personnel, avec API simulée dans le navigateur.
 *
 * Prérequis :
 *   1. `npm run dev -- --hostname 0.0.0.0 --port 3000` ;
 *   2. un exécutable Chromium accessible, fourni par `CHROMIUM_EXECUTABLE` ;
 *   3. si Chromium embarque ses bibliothèques à part, `CHROMIUM_LIB_PATH`.
 *
 * Exemple :
 *   CHROMIUM_EXECUTABLE=/tmp/chromium-bin \
 *   CHROMIUM_LIB_PATH=/tmp/chromium-libs/lib \
 *   npm run test:responsive:personal
 *
 * Ce test ouvre les VRAIES pages Next, intercepte `/api/**` avec un jeu de
 * données déterministe, puis mesure le rendu à 360/390/768/1024/1440 px. Il ne
 * remplace pas une recette avec le backend PostgreSQL et un compte réel.
 */

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = (process.env.COMEXA_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const SHOTS_DIR = process.env.RESPONSIVE_SHOTS_DIR ?? null;
if (SHOTS_DIR) mkdirSync(SHOTS_DIR, { recursive: true });
const executablePath = process.env.CHROMIUM_EXECUTABLE;
if (!executablePath) {
  throw new Error("CHROMIUM_EXECUTABLE est requis pour exécuter le test responsive.");
}

const WIDTHS = [
  { width: 360, height: 780, label: "téléphone compact" },
  { width: 390, height: 844, label: "téléphone courant" },
  { width: 768, height: 1024, label: "tablette portrait" },
  { width: 1024, height: 768, label: "tablette paysage" },
  { width: 1440, height: 900, label: "ordinateur" },
];

// Jour de référence déterministe : évite qu'un test lancé à minuit change de
// jour entre le navigateur (Afrique/Alger) et le processus Node.
const REFERENCE_NOW = Date.parse("2026-10-27T10:00:00.000Z");

function isoDay(offset = 0) {
  const date = new Date(REFERENCE_NOW);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function atNoon(day) {
  return `${day}T12:00:00.000Z`;
}

const USER = {
  id: "user-personal-qa",
  email: "qa.personnel@comexa.test",
  firstName: "Amine",
  lastName: "QA",
  roles: ["DEVELOPER"],
  permissions: [
    "task:read:personal",
    "task:write:personal",
    "task:read:assigned",
    "task:read:own",
    "task:write:own",
    "time:read:own",
    "time:write:own",
    "calendar:read:own",
    "calendar:write:own",
    "notification:read:own",
    "notification:manage:own",
    "dashboard:read:own",
    "user:read:own",
  ],
};

function makeState({ empty = false } = {}) {
  const today = isoDay();
  const tasks = empty
    ? []
    : [
        {
          id: "task-overdue",
          title: "Corriger le devoir en retard avec un titre volontairement long",
          description: null,
          status: "TODO",
          priority: "HIGH",
          dueDate: atNoon(isoDay(-1)),
          completedAt: null,
          estimateMinutes: 90,
          projectId: null,
          isPersonal: true,
          parentTaskId: null,
          assigneeId: USER.id,
          project: null,
          milestone: null,
          reporter: { id: USER.id, firstName: USER.firstName, lastName: USER.lastName },
          goal: { id: "goal-examen", title: "Examen final", color: "blue", status: "ACTIVE" },
        },
        {
          id: "task-today",
          title: "Réviser le chapitre 3",
          description: null,
          status: "IN_PROGRESS",
          priority: "URGENT",
          dueDate: atNoon(today),
          completedAt: null,
          estimateMinutes: 60,
          projectId: null,
          isPersonal: true,
          parentTaskId: null,
          assigneeId: USER.id,
          project: null,
          milestone: null,
          reporter: { id: USER.id, firstName: USER.firstName, lastName: USER.lastName },
          goal: null,
        },
        {
          id: "task-project",
          title: "Préparer la recette projet",
          description: null,
          status: "TODO",
          priority: "NORMAL",
          dueDate: atNoon(today),
          completedAt: null,
          estimateMinutes: null,
          projectId: "project-qa",
          isPersonal: false,
          parentTaskId: null,
          assigneeId: USER.id,
          project: { id: "project-qa", reference: "PRJ-QA", name: "Projet QA" },
          milestone: null,
          reporter: { id: USER.id, firstName: USER.firstName, lastName: USER.lastName },
          goal: null,
        },
        {
          id: "task-done",
          title: "Envoyer le rapport",
          description: null,
          status: "DONE",
          priority: "NORMAL",
          dueDate: atNoon(today),
          completedAt: atNoon(today),
          estimateMinutes: 30,
          projectId: null,
          isPersonal: true,
          parentTaskId: null,
          assigneeId: USER.id,
          project: null,
          milestone: null,
          reporter: { id: USER.id, firstName: USER.firstName, lastName: USER.lastName },
          goal: null,
        },
        {
          id: "task-tomorrow",
          title: "Classer les notes",
          description: null,
          status: "TODO",
          priority: "LOW",
          dueDate: atNoon(isoDay(1)),
          completedAt: null,
          estimateMinutes: 15,
          projectId: null,
          isPersonal: true,
          parentTaskId: null,
          assigneeId: USER.id,
          project: null,
          milestone: null,
          reporter: { id: USER.id, firstName: USER.firstName, lastName: USER.lastName },
          goal: null,
        },
      ];
  const events = empty
    ? []
    : [
        {
          id: "event-a",
          title: "Réunion de suivi",
          description: null,
          kind: "EVENT",
          visibility: "PRIVATE",
          startsAt: `${today}T09:00:00.000Z`,
          endsAt: `${today}T10:30:00.000Z`,
          allDay: false,
          location: null,
          taskId: null,
          taskTitle: null,
          projectId: null,
          projectName: null,
          projectReference: null,
          owner: { id: USER.id, firstName: USER.firstName, lastName: USER.lastName },
          isOwn: true,
          canEdit: true,
          participants: [],
          createdAt: atNoon(today),
          updatedAt: atNoon(today),
        },
        {
          id: "event-b",
          title: "Atelier",
          description: null,
          kind: "EVENT",
          visibility: "SHARED",
          startsAt: `${today}T10:00:00.000Z`,
          endsAt: `${today}T11:00:00.000Z`,
          allDay: false,
          location: null,
          taskId: null,
          taskTitle: null,
          projectId: null,
          projectName: null,
          projectReference: null,
          owner: { id: USER.id, firstName: USER.firstName, lastName: USER.lastName },
          isOwn: true,
          canEdit: true,
          participants: [],
          createdAt: atNoon(today),
          updatedAt: atNoon(today),
        },
        {
          id: "event-overnight",
          title: "Garde de nuit",
          description: null,
          kind: "EVENT",
          visibility: "PRIVATE",
          startsAt: `${isoDay(-1)}T23:00:00.000Z`,
          endsAt: `${today}T01:00:00.000Z`,
          allDay: false,
          location: null,
          taskId: null,
          taskTitle: null,
          projectId: null,
          projectName: null,
          projectReference: null,
          owner: { id: USER.id, firstName: USER.firstName, lastName: USER.lastName },
          isOwn: true,
          canEdit: true,
          participants: [],
          createdAt: atNoon(today),
          updatedAt: atNoon(today),
        },
        {
          id: "event-allday",
          title: "Journée d'examen",
          description: null,
          kind: "REMINDER",
          visibility: "PRIVATE",
          startsAt: `${today}T00:00:00.000Z`,
          endsAt: `${today}T23:59:00.000Z`,
          allDay: true,
          location: null,
          taskId: null,
          taskTitle: null,
          projectId: null,
          projectName: null,
          projectReference: null,
          owner: { id: USER.id, firstName: USER.firstName, lastName: USER.lastName },
          isOwn: true,
          canEdit: true,
          participants: [],
          createdAt: atNoon(today),
          updatedAt: atNoon(today),
        },
      ];
  return {
    tasks,
    events,
    goals: [
      {
        id: "goal-examen",
        title: "Examen final",
        description: "Préparer l'examen",
        targetDate: atNoon(isoDay(14)),
        color: "blue",
        status: "ACTIVE",
        achievedAt: null,
        progress: { total: 2, done: 1, cancelled: 0, open: 1, percent: 50 },
        needsReopen: false,
      },
    ],
    requests: [],
  };
}

function envelope(data, meta = undefined) {
  return { success: true, data, ...(meta ? { meta } : {}) };
}

function paginationMeta(rows) {
  return { page: 1, perPage: 100, total: rows.length, totalPages: 1 };
}

async function installMockApi(context, { empty = false, error = false } = {}) {
  const state = makeState({ empty });
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method().toUpperCase();
    let body = null;
    try {
      body = request.postData() ? JSON.parse(request.postData()) : null;
    } catch {
      body = null;
    }
    state.requests.push({ path, method, body });

    if (path === "/api/health") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            status: "ok",
            contract: {
              version: "2026-10-21.2",
              features: {
                timer: true,
                personalTasks: true,
                calendar: true,
                taskCreators: true,
                goals: true,
                timerTasks: true,
                taskAssignees: true,
              },
            },
          }),
        ),
      });
    }
    if (path === "/api/auth/refresh" && method === "POST") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(envelope({ accessToken: "qa-access-token", user: USER })),
      });
    }
    if (path === "/api/me/spaces") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          envelope({
            spaces: [
              { id: "personal", permissions: USER.permissions },
              { id: "team", permissions: USER.permissions },
            ],
          }),
        ),
      });
    }
    if (path === "/api/notifications/summary") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(envelope({ unreadBySpace: { personal: 0, team: 0 } })),
      });
    }
    if (path === "/api/timer" && method === "GET") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope(null)) });
    }
    if (path === "/api/timer/summary") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(envelope({ todayMinutes: 0, weekMinutes: 0 })),
      });
    }
    if (path === "/api/me/tasks" && method === "GET") {
      if (error) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "API indisponible" } }) });
      }
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(envelope(state.tasks, paginationMeta(state.tasks))),
      });
    }
    if (path === "/api/me/tasks" && method === "POST") {
      const created = {
        ...state.tasks[0],
        id: `task-created-${state.tasks.length}`,
        title: body?.title ?? "Nouvelle tâche",
        description: null,
        status: "TODO",
        priority: body?.priority ?? "NORMAL",
        dueDate: body?.dueDate ?? null,
        estimateMinutes: body?.estimateMinutes ?? null,
        completedAt: null,
        goal: body?.goalId ? state.goals[0] : null,
      };
      state.tasks.unshift(created);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope(created)) });
    }
    if (/^\/api\/tasks\/[^/]+\/status$/.test(path) && method === "PATCH") {
      const id = path.split("/")[3];
      const task = state.tasks.find((item) => item.id === id);
      if (task) task.status = body?.status ?? task.status;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope(task ?? {})) });
    }
    if (/^\/api\/tasks\/[^/]+$/.test(path) && method === "PATCH") {
      const id = path.split("/")[3];
      const task = state.tasks.find((item) => item.id === id);
      if (task && "dueDate" in (body ?? {})) task.dueDate = body.dueDate;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope(task ?? {})) });
    }
    if (path === "/api/me/goals") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(envelope(state.goals, paginationMeta(state.goals))),
      });
    }
    if (path === "/api/me/calendar/events" && method === "GET") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope(state.events)) });
    }
    if (path === "/api/time-entries") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope([], paginationMeta([]))) });
    }
    if (path === "/api/daily-reports/mine") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope([], paginationMeta([]))) });
    }
    if (method !== "GET") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope({ ok: true })) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope([])) });
  });
  return state;
}

async function waitForDashboard(page, { requirePlan = true } = {}) {
  await page.clock.install({ time: new Date(REFERENCE_NOW) });
  await page.goto(`${BASE_URL}/espace-personnel/tableau-de-bord`, { waitUntil: "domcontentloaded" });
  await page.locator("#composer-title").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByText("Plan du jour", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  if (requirePlan) {
    await page.getByText("Charge connue", { exact: false }).waitFor({ state: "visible", timeout: 30_000 });
  }
}

async function measure(page) {
  return page.evaluate(() => {
    const viewport = window.innerWidth;
    const components = [...document.querySelectorAll(".sui-composer, .sui-dayplan, .sui-lines__task-actions")];
    const offenders = components
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { className: element.className, left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((rect) => rect.right > viewport + 1 || rect.left < -1);
    const targets = [...document.querySelectorAll("#composer-title, .sui-composer__submit, .sui-lines__tomorrow, .sui-lines--tasks .sui-ttb--sm")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.id, width: rect.width, height: rect.height };
      })
      .filter((rect) => rect.width > 0 && rect.height > 0);
    return {
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      overflow: document.documentElement.scrollWidth - viewport,
      offenders,
      minTargetWidth: Math.min(...targets.map((target) => target.width)),
      minTargetHeight: Math.min(...targets.map((target) => target.height)),
      targetCount: targets.length,
    };
  });
}

async function checkKeyboard(page) {
  const input = page.locator("#composer-title");
  // Un bouton désactivé sort naturellement de l'ordre de tabulation : on donne
  // donc toujours un titre valide avant de vérifier la séquence clavier.
  if ((await input.inputValue()).trim().length < 2) await input.fill("Tâche clavier");
  await input.focus();
  const focused = await page.evaluate(() => document.activeElement?.id ?? null);
  assert.equal(focused, "composer-title", "Le champ de saisie doit être focusable au clavier.");
  await page.keyboard.press("Tab");
  const next = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  assert.match(next, /Ajouter/, "Tab doit atteindre le bouton Ajouter après le champ.");
}

const launchEnv = { ...process.env };
if (process.env.CHROMIUM_LIB_PATH) launchEnv.LD_LIBRARY_PATH = process.env.CHROMIUM_LIB_PATH;

const browser = await chromium.launch({
  executablePath,
  headless: true,
  env: launchEnv,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

const summary = { browser: browser.version(), baseUrl: BASE_URL, widths: [], interactions: {}, states: {}, errors: [] };

try {
  const context = await browser.newContext({
    viewport: WIDTHS[0],
    locale: "fr-FR",
    timezoneId: "Africa/Algiers",
    reducedMotion: "reduce",
  });
  const state = await installMockApi(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => summary.errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/socket\.io|Failed to load resource/i.test(message.text())) {
      summary.errors.push(`console: ${message.text()}`);
    }
  });
  await waitForDashboard(page);

  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    if (process.env.DEBUG_RESPONSIVE) {
      console.log("DEBUG", size.width, await page.locator("#composer-title").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const parent = element.parentElement?.getBoundingClientRect();
        const composer = element.closest(".sui-composer")?.getBoundingClientRect();
        return {
          innerWidth: window.innerWidth,
          media430: window.matchMedia("(max-width: 430px)").matches,
          media640: window.matchMedia("(max-width: 640px)").matches,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          style: { display: style.display, visibility: style.visibility, opacity: style.opacity, flexBasis: style.flexBasis },
          parent: parent && { x: parent.x, y: parent.y, width: parent.width, height: parent.height },
          composer: composer && { x: composer.x, y: composer.y, width: composer.width, height: composer.height },
        };
      }));
    }
    await page.locator("#composer-title").fill(
      "Réviser le chapitre 3 demain pendant 2 h, priorité haute, objectif:examen-final",
    );
    await page.locator(".sui-quickadd__chip").first().waitFor({ state: "visible" });
    const metrics = await measure(page);
    assert.ok(metrics.overflow <= 1, `Débordement horizontal à ${size.width}px : ${metrics.overflow}px`);
    assert.deepEqual(metrics.offenders, [], `Composants hors cadre à ${size.width}px`);
    assert.ok(metrics.targetCount >= 3, `Cibles absentes à ${size.width}px`);
    assert.ok(metrics.minTargetHeight >= 40, `Cible trop basse à ${size.width}px : ${metrics.minTargetHeight}`);
    assert.ok(metrics.minTargetWidth >= 34, `Cible trop étroite à ${size.width}px : ${metrics.minTargetWidth}`);
    await checkKeyboard(page);
    summary.widths.push({ ...size, ...metrics });
    if (SHOTS_DIR) {
      await page.screenshot({ path: join(SHOTS_DIR, `tableau-de-bord-${size.width}.png`), fullPage: true });
      await page.locator(".sui-dayplan").screenshot({ path: join(SHOTS_DIR, `plan-du-jour-${size.width}.png`) });
    }

    if (size.width === 390) {
      assert.equal(await page.locator(".sui-quickadd__chip").count(), 4);
      const dateValue = await page.locator('.sui-composer__option input[type="date"]').inputValue();
      assert.equal(dateValue, isoDay(1));
      assert.equal(await page.locator(".sui-composer__option select").last().inputValue(), "HIGH");
      assert.equal(await page.getByLabel("Estimation en minutes").inputValue(), "120");

      // Correction manuelle conservée tant que la phrase ne change pas la valeur reconnue.
      await page.getByLabel("Estimation en minutes").fill("75");
      await page.locator("#composer-title").fill(
        "Réviser le chapitre 3 demain pendant 2 h, priorité haute, objectif:examen-final brouillon",
      );
      await page.locator("#composer-title").fill(
        "Réviser le chapitre 3 demain pendant 2 h, priorité haute, objectif:examen-final",
      );
      assert.equal(await page.getByLabel("Estimation en minutes").inputValue(), "75");

      await page.getByRole("button", { name: "Ajouter" }).click();
      await page.getByText(/Tâche « Réviser le chapitre 3 » ajoutée/).waitFor({ state: "visible" });
      const create = state.requests.findLast((item) => item.method === "POST" && item.path === "/api/me/tasks");
      assert.equal(create.body.title, "Réviser le chapitre 3");
      assert.equal(create.body.priority, "HIGH");
      assert.equal(create.body.estimateMinutes, 75);
      assert.equal(create.body.dueDate, atNoon(isoDay(1)));
      assert.equal(create.body.goalId, "goal-examen");
      assert.ok(!("status" in create.body));
      summary.interactions.quickAdd = create.body;

      const tomorrowButton = page.getByRole("button", { name: /Reporter .* à demain/ }).first();
      await tomorrowButton.click();
      await page.getByText(/est reportée à demain/).waitFor({ state: "visible" });
      const postpone = state.requests.findLast((item) => item.method === "PATCH" && /^\/api\/tasks\/[^/]+$/.test(item.path));
      assert.deepEqual(Object.keys(postpone.body), ["dueDate"]);
      assert.equal(postpone.body.dueDate, atNoon(isoDay(1)));
      summary.interactions.postpone = postpone.body;
    }

    if (size.width === 768) {
      await page.locator("#composer-title").fill("Tâche demain 12/11 priorité haute priorité basse");
      await page.locator(".sui-quickadd__notes").waitFor({ state: "visible" });
      assert.equal(await page.locator(".sui-quickadd__chip").count(), 0);
      summary.interactions.ambiguityWarnings = await page.locator(".sui-quickadd__notes li").allTextContents();
      assert.ok(summary.interactions.ambiguityWarnings.length >= 2);
      await page.locator("#composer-title").fill("");
    }
  }

  // « Mes tâches » utilise le même composeur et la même liste privée.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/espace-personnel/taches`, { waitUntil: "domcontentloaded" });
  await page.locator("#composer-title").waitFor({ state: "visible", timeout: 30_000 });
  const tasksMetrics = await measure(page);
  assert.ok(tasksMetrics.overflow <= 1, "Débordement horizontal sur Mes tâches à 390px");
  await checkKeyboard(page);
  summary.widths.push({ width: 390, height: 844, label: "Mes tâches", ...tasksMetrics });
  await context.close();

  // États vide et erreur : données absentes ≠ zéro, erreur ≠ chargement.
  for (const [name, options, expected] of [
    ["empty", { empty: true }, /Données insuffisantes/],
    ["error", { error: true }, /Le plan du jour est indisponible/],
  ]) {
    const stateContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "fr-FR",
      timezoneId: "Africa/Algiers",
      reducedMotion: "reduce",
    });
    await installMockApi(stateContext, options);
    const statePage = await stateContext.newPage();
    statePage.on("pageerror", (error) => summary.errors.push(`${name} pageerror: ${error.message}`));
    await waitForDashboard(statePage, { requirePlan: !options.error });
    const stateText = statePage.getByText(expected).first();
    await stateText.waitFor({ state: "visible", timeout: 15_000 });
    summary.states[name] = await stateText.textContent();
    await stateContext.close();
  }

  assert.deepEqual(summary.errors, [], `Erreurs navigateur : ${summary.errors.join(" | ")}`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
