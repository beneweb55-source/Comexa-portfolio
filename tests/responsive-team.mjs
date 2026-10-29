/**
 * Test responsive réel de la première tranche Espace équipe, avec API simulée.
 *
 * Prérequis :
 *   1. `npm run dev -- --hostname 0.0.0.0 --port 3000` ;
 *   2. un exécutable Chromium dans `CHROMIUM_EXECUTABLE` ;
 *   3. si besoin, ses bibliothèques dans `CHROMIUM_LIB_PATH`.
 *
 * Exemple :
 *   CHROMIUM_EXECUTABLE=/tmp/chromium-bin \
 *   CHROMIUM_LIB_PATH=/tmp/chromium-libs/lib \
 *   npm run test:responsive:team
 *
 * Le test ouvre les VRAIES pages Next, intercepte `/api/**` avec un jeu
 * déterministe, puis vérifie 360/390/768/1024/1440 px, les transitions de
 * statut, les permissions, les conflits serveur et les états vide/erreur. Il ne
 * remplace pas une recette avec le backend PostgreSQL et de vrais rôles.
 */

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = (process.env.COMEXA_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const SHOTS_DIR = process.env.RESPONSIVE_SHOTS_DIR ?? null;
if (SHOTS_DIR) mkdirSync(SHOTS_DIR, { recursive: true });
const executablePath = process.env.CHROMIUM_EXECUTABLE;
if (!executablePath) throw new Error("CHROMIUM_EXECUTABLE est requis pour exécuter le test responsive.");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const WIDTHS = [
  { width: 360, height: 780, label: "téléphone compact" },
  { width: 390, height: 844, label: "téléphone courant" },
  { width: 768, height: 1024, label: "tablette portrait" },
  { width: 1024, height: 768, label: "tablette paysage" },
  { width: 1440, height: 900, label: "ordinateur" },
];

const KANBAN = "/espace-equipe/taches";
const DEVIS = "/espace-equipe/devis";
const DASHBOARD = "/espace-equipe/tableau-de-bord";
const REFERENCE_NOW = Date.parse("2026-10-28T10:00:00.000Z");

function isoDay(offset = 0) {
  const date = new Date(REFERENCE_NOW);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function atMidnight(day) {
  return `${day}T00:00:00.000Z`;
}

function atNoon(day) {
  return `${day}T12:00:00.000Z`;
}

const PERMISSIONS = [
  "user:read:own",
  "user:read:any",
  "notification:read:own",
  "notification:manage:own",
  "dashboard:read:any",
  "dashboard:read:own",
  "project:read:any",
  "project:read:assigned",
  "project:write:any",
  "task:read:any",
  "task:read:assigned",
  "task:read:own",
  "task:write:any",
  "task:write:own",
  "task:assign:any",
  "task:delete:any",
  "task:read:personal",
  "task:write:personal",
  "milestone:read:any",
  "activity:read:any",
  "time:read:any",
  "time:read:own",
  "time:write:own",
  "calendar:read:own",
  "calendar:read:team",
  "quote:read:any",
  "quote:write:any",
  "quote:send:any",
  "quote:delete:any",
  "invoice:read:any",
  "invoice:write:any",
  "prospect:read:any",
  "client:read:any",
  "order:read:any",
  "project_request:read:any",
  "contactrequest:read:any",
  "report:read:any",
  "conversation:read:own",
  "modificationrequest:decide:any",
  "balance:read:own",
  "distribution:read:any",
];

const USER = {
  id: "user-team-qa",
  email: "qa.equipe@comexa.test",
  firstName: "Amine",
  lastName: "QA",
  roles: ["ADMIN"],
  permissions: PERMISSIONS,
};

function userFor({ readonly = false } = {}) {
  if (!readonly) return USER;
  const denied = ["task:write", "task:assign", "task:delete", "quote:write", "quote:send", "quote:delete", "project:write", "invoice:write", "time:write"];
  return {
    ...USER,
    permissions: PERMISSIONS.filter((permission) => !denied.some((prefix) => permission.startsWith(prefix))),
  };
}

function profile() {
  return { id: USER.id, firstName: USER.firstName, lastName: USER.lastName, email: USER.email };
}

function makeTask(id, status, title, dueOffset = null) {
  return {
    id,
    title,
    description: null,
    status,
    priority: "NORMAL",
    dueDate: dueOffset === null ? null : atNoon(isoDay(dueOffset)),
    completedAt: status === "DONE" ? atNoon(isoDay()) : null,
    estimateMinutes: 60,
    projectId: "project-qa",
    isPersonal: false,
    isClientVisible: false,
    parentTaskId: null,
    assigneeId: USER.id,
    assignee: profile(),
    reporter: profile(),
    project: { id: "project-qa", reference: "PRJ-QA", name: "Projet QA" },
    milestone: null,
    goal: null,
    createdAt: atNoon(isoDay(-2)),
    updatedAt: atNoon(isoDay()),
  };
}

function makeQuote(id, reference, status, offset, subject) {
  return {
    id,
    reference,
    subject,
    status,
    validUntil: offset === null ? null : atMidnight(isoDay(offset)),
    total: 1200,
    currency: "EUR",
    client: { id: `client-${id}`, companyName: "Client QA" },
    prospect: null,
    createdAt: atNoon(isoDay(-2)),
    updatedAt: atNoon(isoDay(-1)),
  };
}

function makeState({ empty = false } = {}) {
  const tasks = empty
    ? []
    : [
        makeTask("task-todo", "TODO", "Préparer la recette", 1),
        makeTask("task-blocked", "BLOCKED", "Attendre la validation client", 2),
        makeTask("task-cancelled", "CANCELLED", "Ancienne piste abandonnée", null),
        makeTask("task-done", "DONE", "Envoyer le rapport", null),
        makeTask("task-conflict", "TODO", "Tâche modifiée par un collègue", 3),
        makeTask("task-forbidden", "TODO", "Tâche refusée par le serveur", 4),
      ];
  const quotes = empty
    ? []
    : [
        makeQuote("quote-today", "D-101", "SENT", 0, "Refonte urgente"),
        makeQuote("quote-tomorrow", "D-102", "VIEWED", 1, "Campagne prochaine"),
        makeQuote("quote-3days", "D-103", "SENT", 3, "Maintenance trimestrielle"),
        makeQuote("quote-4days", "D-104", "SENT", 4, "Prestation lointaine"),
        makeQuote("quote-draft", "D-105", "DRAFT", 0, "Brouillon non envoyé"),
        makeQuote("quote-expired", "D-106", "EXPIRED", -1, "Offre échue"),
        makeQuote("quote-accepted", "D-107", "ACCEPTED", 0, "Offre acceptée"),
      ];
  const projects = empty
    ? []
    : [{
        id: "project-qa",
        reference: "PRJ-QA",
        name: "Projet QA",
        status: "IN_PROGRESS",
        health: "ON_TRACK",
        progressPercent: 45,
        dueDate: atNoon(isoDay(10)),
        client: { id: "client-qa", companyName: "Client QA" },
        createdAt: atNoon(isoDay(-10)),
        updatedAt: atNoon(isoDay()),
      }];
  const invoices = empty
    ? []
    : [{
        id: "invoice-qa",
        reference: "F-2026-001",
        subject: "Acompte projet",
        status: "SENT",
        total: 500,
        amountPaid: 100,
        currency: "EUR",
        dueDate: atNoon(isoDay(5)),
        issueDate: atNoon(isoDay(-2)),
        createdAt: atNoon(isoDay(-2)),
        paidAt: null,
        payments: [],
        client: { id: "client-qa", companyName: "Client QA" },
      }];
  return { tasks, quotes, projects, invoices, requests: [] };
}

function envelope(data, meta = undefined) {
  return { success: true, data, ...(meta ? { meta } : {}) };
}

function paginationMeta(rows) {
  return { page: 1, perPage: 100, total: rows.length, totalPages: 1 };
}

async function installMockApi(context, options = {}) {
  const user = userFor(options);
  const state = makeState(options);
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

    const json = (data, meta, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(meta === undefined ? envelope(data) : envelope(data, meta)),
    });
    const list = (rows) => json(rows, paginationMeta(rows));

    if (path === "/api/health") {
      return json({
        status: "ok",
        contract: {
          version: "2026-10-28.1",
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
      });
    }
    if (path === "/api/auth/refresh" && method === "POST") {
      return json({ accessToken: "qa-access-token", user });
    }
    if (path === "/api/me/spaces") {
      return json({
        spaces: [
          { id: "personal", permissions: user.permissions },
          { id: "team", permissions: user.permissions },
          { id: "comexa", permissions: user.permissions },
        ],
      });
    }
    if (path === "/api/notifications/summary") {
      return json({ unreadBySpace: { personal: 0, team: 0, comexa: 0 } });
    }
    if (path === "/api/timer" && method === "GET") return json(null);
    if (path === "/api/timer/summary") return json({ todayMinutes: 0, weekMinutes: 0 });
    if (path === "/api/dashboard/me") {
      return json({
        tasks: { open: state.tasks.filter((task) => ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"].includes(task.status)).length, overdue: 0 },
        timeEntries: { todayMinutes: 0, weekMinutes: 0 },
        notifications: { unread: 0 },
        upcoming: [],
      });
    }
    if (path === "/api/dashboard") {
      return json({
        prospects: { open: 0, createdInPeriod: 0 },
        projects: { active: state.projects.length, overdue: 0, total: state.projects.length, averageProgress: 45 },
        tasks: { open: state.tasks.length, overdue: 0 },
        invoices: { open: { count: 0 }, overdue: { count: 0 }, issuedInPeriod: { count: 0 } },
        collected: { count: 0 },
        collectionRate: 0,
        period: { periodStart: atMidnight(isoDay(-7)), periodEnd: atMidnight(isoDay()) },
        upcoming: { tasks: [], invoices: [] },
      });
    }
    if (path === "/api/quotes" && method === "GET") {
      if (options.error) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "API devis indisponible" } }) });
      return list(state.quotes);
    }
    if (path === "/api/invoices" && method === "GET") return list(state.invoices);
    if (path === "/api/projects" && method === "GET") return list(state.projects);
    if (/^\/api\/projects\/[^/]+$/.test(path) && method === "GET") return json(state.projects[0] ?? {});
    if (/^\/api\/projects\/[^/]+\/tasks\/creators$/.test(path)) {
      return json([{ ...profile(), taskCount: state.tasks.length }]);
    }
    if (/^\/api\/projects\/[^/]+\/tasks\/assignees$/.test(path)) {
      return json([{ ...profile(), isMe: true, isMember: true, projectRole: "LEAD" }]);
    }
    if (/^\/api\/projects\/[^/]+\/tasks$/.test(path) && method === "GET") {
      if (options.error) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "API tâches indisponible" } }) });
      return list(state.tasks);
    }
    if (/^\/api\/projects\/[^/]+\/milestones$/.test(path)) return list([]);
    if (/^\/api\/projects\/[^/]+\/activities$/.test(path)) return list([]);
    if (/^\/api\/tasks\/[^/]+\/status$/.test(path) && method === "PATCH") {
      const id = path.split("/")[3];
      const task = state.tasks.find((item) => item.id === id);
      if (options.statusDelay) await sleep(options.statusDelay);
      if (options.serverDecisions && id === "task-conflict") {
        if (task) task.status = "IN_REVIEW";
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "Le statut a changé entre-temps." } }) });
      }
      if (options.serverDecisions && id === "task-forbidden") {
        return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "Droits insuffisants sur cette tâche." } }) });
      }
      if (task) task.status = body?.status ?? task.status;
      return json(task ?? {});
    }
    if (/^\/api\/tasks\/[^/]+$/.test(path) && method === "GET") {
      const id = path.split("/")[3];
      return json(state.tasks.find((task) => task.id === id) ?? {});
    }
    if (path === "/api/me/tasks" && method === "GET") return list(state.tasks);
    if (path === "/api/time-entries" && method === "GET") return list([]);
    if (path === "/api/daily-reports/mine") return list([]);
    if (path === "/api/me/goals") return list([]);
    if (path === "/api/me/calendar/events") return json([]);
    if (method !== "GET") return json({ ok: true });
    return list([]);
  });
  return { state, user };
}

async function preparePage(context, summary, label) {
  const page = await context.newPage();
  await page.clock.install({ time: new Date(REFERENCE_NOW) });
  page.on("pageerror", (error) => summary.errors.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/socket\.io|Failed to load resource/i.test(message.text())) {
      summary.errors.push(`${label} console: ${message.text()}`);
    }
  });
  return page;
}

async function open(page, path, selector) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 30_000 });
}

async function measure(page) {
  return page.evaluate(() => {
    const viewport = window.innerWidth;
    const components = [...document.querySelectorAll(".sui-kcard, .sui-newtask, .sui-kanban-others, .sui-queue-followup")];
    const offenders = components
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { className: String(element.className).slice(0, 100), left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((rect) => rect.right > viewport + 1 || rect.left < -1);
    const targets = [
      ...document.querySelectorAll(
        '[data-testid="task-status-select"], [data-testid="task-status-readonly"], [data-testid="task-drag-handle"], .sui-kanban-others > summary, .sui-note .sui-link, .sui-queue-followup a.sui-link',
      ),
    ]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.getAttribute("aria-label") ?? element.getAttribute("data-testid") ?? element.textContent?.trim()?.slice(0, 50) ?? element.tagName,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((rect) => rect.width > 0 && rect.height > 0);
    const card = document.querySelector(".sui-kcard");
    return {
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      overflow: document.documentElement.scrollWidth - viewport,
      offenders,
      minTargetWidth: targets.length ? Math.min(...targets.map((target) => target.width)) : null,
      minTargetHeight: targets.length ? Math.min(...targets.map((target) => target.height)) : null,
      targetCount: targets.length,
      cardTouchAction: card ? getComputedStyle(card).touchAction : null,
    };
  });
}

function assertMetrics(metrics, contextLabel) {
  assert.ok(metrics.overflow <= 1, `Débordement horizontal ${contextLabel} : ${metrics.overflow}px`);
  assert.deepEqual(metrics.offenders, [], `Composants hors cadre ${contextLabel}`);
  assert.ok(metrics.targetCount >= 1, `Aucune cible mesurable ${contextLabel}`);
  assert.ok(metrics.minTargetHeight >= 40, `Cible trop basse ${contextLabel} : ${metrics.minTargetHeight}`);
  assert.ok(metrics.minTargetWidth >= 34, `Cible trop étroite ${contextLabel} : ${metrics.minTargetWidth}`);
  if (metrics.cardTouchAction !== null) {
    assert.notEqual(metrics.cardTouchAction, "none", `La carte entière bloque le tactile ${contextLabel}`);
  }
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
  const { state } = await installMockApi(context, { statusDelay: 350 });
  const page = await preparePage(context, summary, "principal");

  // Les trois écrans modifiés sont mesurés à chaque largeur, pas seulement la
  // page Kanban : un media query global ne suffit pas avec le panneau latéral.
  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const [name, path, selector] of [
      ["kanban", KANBAN, '[data-testid="task-status-select"]'],
      ["devis", DEVIS, '[data-testid="quote-followup-banner"]'],
      ["tableau-de-bord", DASHBOARD, '[data-testid="quote-followup-banner"]'],
    ]) {
      await open(page, path, selector);
      const metrics = await measure(page);
      assertMetrics(metrics, `${name} à ${size.width}px`);
      summary.widths.push({ ...size, screen: name, ...metrics });
      if (SHOTS_DIR) {
        await page.screenshot({ path: join(SHOTS_DIR, `equipe-${name}-${size.width}.png`), fullPage: true });
      }
    }
  }

  // Clavier : le select de statut est focusable et porte un nom accessible.
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, KANBAN, '[data-testid="task-status-select"]');
  const firstSelect = page.locator('[data-testid="task-status-select"]').first();
  await firstSelect.focus();
  const focusedId = await page.evaluate(() => document.activeElement?.id ?? null);
  assert.match(focusedId ?? "", /^task-status-/, "Le select de statut doit être focusable au clavier.");
  assert.match(await firstSelect.getAttribute("aria-label") ?? "", /Changer le statut/);
  await page.keyboard.press("Tab");
  const afterTabId = await page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName ?? null);
  assert.notEqual(afterTabId, focusedId, "Tab doit avancer vers une autre commande focusable.");

  // Transitions réelles : les options viennent de la machine à états backend.
  const blocked = page.locator('[data-task-id="task-blocked"]');
  assert.deepEqual(await blocked.locator("option").allTextContents(), [
    "Bloquée (actuel)",
    "À faire",
    "En cours",
    "Annulée",
  ]);
  const todo = page.locator('[data-task-id="task-todo"]');
  await todo.selectOption("IN_PROGRESS");
  await page.waitForFunction(() => document.querySelector('[data-task-id="task-todo"]')?.disabled === true);
  // Même si un second événement arrive pendant la requête, un seul PATCH part.
  await page.evaluate(() => {
    const select = document.querySelector('[data-task-id="task-todo"]');
    select.value = "DONE";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.getByText(/Statut enregistré/).waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => document.querySelector('[data-task-id="task-todo"]')?.disabled === false);
  const todoPatches = state.requests.filter((item) => item.method === "PATCH" && item.path === "/api/tasks/task-todo/status");
  assert.equal(todoPatches.length, 1, "Un seul changement de statut doit être envoyé.");
  assert.deepEqual(todoPatches[0].body, { status: "IN_PROGRESS" });
  assert.equal(await todo.inputValue(), "IN_PROGRESS");
  summary.interactions.statusPatch = todoPatches[0].body;

  // CANCELLED n'a pas de colonne mais reste visible et rouvrable.
  const others = page.locator('[data-testid="kanban-other-statuses"]');
  await others.locator("summary").click();
  const cancelled = page.locator('[data-task-id="task-cancelled"]');
  assert.equal(await cancelled.inputValue(), "CANCELLED");
  await cancelled.selectOption("TODO");
  await page.getByText(/Statut enregistré/).waitFor({ state: "visible", timeout: 15_000 });
  const cancelPatch = state.requests.findLast((item) => item.method === "PATCH" && item.path === "/api/tasks/task-cancelled/status");
  assert.deepEqual(cancelPatch.body, { status: "TODO" });
  summary.interactions.cancelledReopen = cancelPatch.body;

  // Devis : 3 signaux d'attention, aucun pour brouillon/expiré/accepté/>+3 j.
  await open(page, DEVIS, '[data-testid="quote-followup-banner"]');
  assert.match(await page.locator('[data-testid="quote-followup-banner"]').textContent(), /3 devis envoyés arrivent/);
  const devisLabels = page.locator('[data-testid="quote-followup-label"]');
  assert.equal(await devisLabels.count(), 3);
  assert.deepEqual(await devisLabels.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-days"))), ["0", "1", "3"]);
  summary.interactions.quoteFollowupDays = await devisLabels.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-days")));

  await open(page, DASHBOARD, '[data-testid="quote-followup-banner"]');
  assert.match(await page.locator('[data-testid="quote-followup-banner"]').textContent(), /3 devis envoyés arrivent/);
  assert.equal(await page.locator('[data-testid="quote-followup-label"]').count(), 3);
  await context.close();

  // Lecture seule : aucune action d'écriture proposée, aucune requête PATCH.
  const readonlyContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fr-FR", timezoneId: "Africa/Algiers", reducedMotion: "reduce" });
  const readonlyMock = await installMockApi(readonlyContext, { readonly: true });
  const readonlyPage = await preparePage(readonlyContext, summary, "lecture-seule");
  await open(readonlyPage, KANBAN, '[data-testid="task-status-readonly"]');
  assert.equal(await readonlyPage.locator('[data-testid="task-status-select"]').count(), 0);
  assert.equal(await readonlyPage.locator('[data-testid="task-drag-handle"]').count(), 0);
  assert.ok((await readonlyPage.locator('[data-testid="task-status-readonly"]').count()) >= 1);
  assert.equal(readonlyMock.state.requests.filter((item) => item.method === "PATCH").length, 0);
  assertMetrics(await measure(readonlyPage), "lecture seule 390px");
  summary.states.readonly = "aucun select ni poignée d'écriture";
  await readonlyContext.close();

  // Le serveur reste l'autorité : 409 sur état concurrent, 403 sur permission.
  const decisionsContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fr-FR", timezoneId: "Africa/Algiers", reducedMotion: "reduce" });
  const decisionsMock = await installMockApi(decisionsContext, { serverDecisions: true });
  const decisionsPage = await preparePage(decisionsContext, summary, "décisions-serveur");
  await open(decisionsPage, KANBAN, '[data-testid="task-status-select"]');
  await decisionsPage.locator('[data-task-id="task-conflict"]').selectOption("DONE");
  await decisionsPage.getByText(/Statut restauré/).waitFor({ state: "visible", timeout: 15_000 });
  assert.equal(await decisionsPage.locator('[data-task-id="task-conflict"]').inputValue(), "IN_REVIEW");
  await decisionsPage.locator('[data-task-id="task-forbidden"]').selectOption("DONE");
  await decisionsPage.getByText(/Droits insuffisants/).waitFor({ state: "visible", timeout: 15_000 });
  assert.equal(await decisionsPage.locator('[data-task-id="task-forbidden"]').inputValue(), "TODO");
  assert.equal(decisionsMock.state.requests.filter((item) => item.method === "PATCH" && /\/status$/.test(item.path)).length, 2);
  summary.states.serverDecisions = { conflict: "IN_REVIEW", forbidden: "TODO" };
  await decisionsContext.close();

  // États vide et erreur : données absentes ≠ zéro, erreur ≠ chargement.
  for (const [name, options] of [
    ["empty", { empty: true }],
    ["error", { error: true }],
  ]) {
    const stateContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fr-FR", timezoneId: "Africa/Algiers", reducedMotion: "reduce" });
    await installMockApi(stateContext, options);
    const statePage = await preparePage(stateContext, summary, name);
    await open(statePage, DASHBOARD, "#a-suivre");
    if (name === "empty") {
      await statePage.getByText("Rien à suivre pour le moment.").waitFor({ state: "visible", timeout: 15_000 });
      assert.equal(await statePage.locator('[data-testid="quote-followup-banner"]').count(), 0);
      summary.states.empty = "Rien à suivre pour le moment.";
    } else {
      await statePage.getByText(/API devis indisponible|API tâches indisponible/).first().waitFor({ state: "visible", timeout: 15_000 });
      assert.equal(await statePage.locator('[data-testid="quote-followup-banner"]').count(), 0);
      summary.states.error = "erreurs API visibles, aucun signal de relance";
    }
    await stateContext.close();
  }

  assert.deepEqual(summary.errors, [], `Erreurs navigateur : ${summary.errors.join(" | ")}`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
