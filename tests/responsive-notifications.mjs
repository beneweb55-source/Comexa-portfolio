/**
 * Mission 6 — validation navigateur de la boîte de notifications partagée.
 *
 * Prerequis : `npm run dev -- --hostname 0.0.0.0 --port 3000`,
 * `CHROMIUM_EXECUTABLE`, `CHROMIUM_LIB_PATH`.
 *
 * API simulée : ce test vérifie le rendu, la résolution des liens, les cibles
 * tactiles, les doubles clics, une erreur serveur et un refus de permission.
 * Il ne remplace pas une recette PostgreSQL / Socket.IO réelle.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = (process.env.COMEXA_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const SHOTS_DIR = process.env.RESPONSIVE_SHOTS_DIR ?? null;
if (SHOTS_DIR) mkdirSync(SHOTS_DIR, { recursive: true });
const executablePath = process.env.CHROMIUM_EXECUTABLE;
if (!executablePath) throw new Error("CHROMIUM_EXECUTABLE est requis.");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const WIDTHS = [
  { width: 360, height: 780, label: "téléphone compact" },
  { width: 390, height: 844, label: "téléphone courant" },
  { width: 768, height: 1024, label: "tablette portrait" },
  { width: 1024, height: 768, label: "tablette paysage" },
  { width: 1440, height: 900, label: "ordinateur" },
];

const catalogue = readFileSync(new URL("../backend/src/common/auth/permissions.catalogue.ts", import.meta.url), "utf8");
const ALL_PERMISSIONS = [...new Set([...catalogue.matchAll(/^\s*'([a-z_]+:[a-z_]+:[a-z_]+)'\s*:/gm)].map((match) => match[1]))];
assert.ok(ALL_PERMISSIONS.length > 40, "Catalogue de permissions illisible.");
const CLIENT_PERMISSIONS = [
  "user:read:own",
  "notification:read:own",
  "notification:manage:own",
  "quote:read:own",
  "invoice:read:own",
  "project:read:own",
  "milestone:read:any",
  "document:read:client",
  "conversation:read:own",
  "message:read:own",
  "message:write:own",
  "modificationrequest:read:own",
  "modificationrequest:write:own",
  "dashboard:read:own",
];

const INTERNAL_USER = {
  id: "user-admin-notif",
  email: "admin.notif@comexa.test",
  firstName: "Amina",
  lastName: "Admin",
  roles: ["ADMIN"],
  clientId: null,
  permissions: [...ALL_PERMISSIONS],
};
const CLIENT_USER = {
  id: "user-client-notif",
  email: "client.notif@comexa.test",
  firstName: "Camille",
  lastName: "Client",
  roles: ["CLIENT"],
  clientId: "client-notif",
  permissions: [...CLIENT_PERMISSIONS],
};

const FEATURES = {
  timer: true,
  personalTasks: true,
  calendar: true,
  taskCreators: true,
  goals: true,
  timerTasks: true,
  taskAssignees: true,
};
const SPACES = ["personal", "team", "comexa"].map((id) => ({ id, permissions: [...ALL_PERMISSIONS] }));

const NOW = "2026-10-28T10:00:00.000Z";
const row = (id, type, title, link, entityType, entityId, extra = {}) => ({
  id, type, title, link, entityType, entityId,
  body: extra.body ?? null,
  readAt: extra.readAt ?? null,
  createdAt: NOW,
});

function makeRows(kind) {
  if (kind === "client") {
    return [
      row("c-quote", "QUOTE_SENT", "Devis Q-2026-001", "/devis/q1", "Quote", "q1", { body: "Un devis vous a été adressé." }),
      row("c-invoice", "INVOICE_ISSUED", "Facture F-2026-001", "/factures/i1", "Invoice", "i1", { body: "Une facture vous a été adressée." }),
      row("c-modification", "SYSTEM", "Votre demande MOD-001 a été traitée", "/espace/demandes/m1", "ModificationRequest", "m1", { body: "Nouvel état : APPROVED" }),
      row("c-message", "MESSAGE_RECEIVED", "Nouveau message", "/espace/messages/c1", "Conversation", "c1", { body: "Bonjour" }),
    ];
  }
  return {
    personal: [
      row("p-task", "TASK_ASSIGNED", "Nouvelle tâche : Préparer le point", "/taches/p1", "Task", "p1", { body: "Confiee par Amina" }),
    ],
    team: [
      row("t-prospect", "SYSTEM", "Nouvelle piste issue du formulaire de contact", "/prospects/pr1", "Prospect", "pr1", { body: "La demande CR-1 est devenue un prospect." }),
      row("t-task", "SYSTEM", "Tâche « Refonte » : En cours", "/taches/t1", "Task", "t1", { body: "Projet « Site »" }),
      row("t-message", "MESSAGE_RECEIVED", "Nouveau message", "/espace/messages/c1", "Conversation", "c1", { body: "Point client" }),
      row("n-broken", "TASK_COMPLETED", "Notification cassée", "/taches/t2", "Task", "t2", { body: "Erreur serveur simulée" }),
      row("n-foreign", "TASK_COMPLETED", "Notification d'un autre compte", "/taches/t3", "Task", "t3", { body: "Refus de permission simulé" }),
    ],
    comexa: [],
  };
}

function envelope(data, meta = undefined) {
  return { success: true, data, ...(meta ? { meta } : {}) };
}
function pagination(rows) {
  return { page: 1, perPage: 100, total: rows.length, totalPages: 1 };
}

async function installMockApi(context, kind) {
  const state = {
    kind,
    requests: [],
    rows: makeRows(kind),
    readAllCalls: [],
  };
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method().toUpperCase();
    const headers = request.headers();
    const space = headers["x-comexa-space"] ?? null;
    let body = null;
    try {
      body = request.postData() ? JSON.parse(request.postData()) : null;
    } catch {
      body = null;
    }
    state.requests.push({ path, method, space, query: url.search, body });
    const json = (data, meta, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(meta === undefined ? envelope(data) : envelope(data, meta)),
    });
    const list = (rows) => json(rows, pagination(rows));
    const failure = (status, code, message) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: { code, message } }),
    });

    if (path === "/api/health") {
      return json({ status: "ok", database: "up", databaseTarget: "autre", uptimeSeconds: 3600, timestamp: NOW, contract: { version: "2026-10-21.2", features: FEATURES } });
    }
    if (path === "/api/auth/refresh" && method === "POST") {
      const user = kind === "client" ? CLIENT_USER : INTERNAL_USER;
      return json({ accessToken: `qa-${kind}-token`, user });
    }
    if (path === "/api/auth/me") return json(kind === "client" ? CLIENT_USER : INTERNAL_USER);
    if (path === "/api/me/spaces") return json({ spaces: SPACES });
    if (path === "/api/notifications/summary") {
      const unread = kind === "client"
        ? state.rows.filter((item) => !item.readAt).length
        : Object.values(state.rows).flat().filter((item) => !item.readAt).length;
      return json({ unread, unreadBySpace: { personal: kind === "client" ? 0 : 1, team: kind === "client" ? 0 : 5, comexa: 0 } });
    }
    if (path === "/api/timer" && method === "GET") return json(null);
    if (path === "/api/timer/summary") return json({ todayMinutes: 0, weekMinutes: 0 });

    if (path === "/api/notifications" && method === "GET") {
      const rows = kind === "client" ? state.rows : (state.rows[space ?? "team"] ?? []);
      const read = url.searchParams.get("read");
      const filtered = read === "false" ? rows.filter((item) => !item.readAt) : read === "true" ? rows.filter((item) => item.readAt) : rows;
      return list(filtered);
    }
    if (path === "/api/notifications/read-all" && method === "POST") {
      const rows = kind === "client" ? state.rows : (state.rows[space ?? "team"] ?? []);
      let updated = 0;
      for (const item of rows) {
        if (!item.readAt) {
          item.readAt = NOW;
          updated += 1;
        }
      }
      state.readAllCalls.push({ space, updated });
      return json({ updated });
    }
    const readMatch = /^\/api\/notifications\/([^/]+)\/read$/.exec(path);
    if (readMatch && method === "POST") {
      const id = readMatch[1];
      if (id === "n-broken") return failure(500, "QA_READ_ERROR", "Lecture impossible : erreur serveur simulée.");
      if (id === "n-foreign") return failure(403, "FORBIDDEN", "Droits insuffisants : cette notification ne vous appartient pas.");
      const rows = kind === "client" ? state.rows : Object.values(state.rows).flat();
      const item = rows.find((candidate) => candidate.id === id);
      if (item) item.readAt = NOW;
      return json(item ?? {});
    }
    const deleteMatch = /^\/api\/notifications\/([^/]+)$/.exec(path);
    if (deleteMatch && method === "DELETE") {
      return json({ deleted: true });
    }

    if (method !== "GET") return json({ ok: true });
    return list([]);
  });
  return state;
}

async function preparePage(context, summary, label) {
  const page = await context.newPage();
  page.on("pageerror", (error) => summary.errors.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/socket\.io|Failed to load resource|ECONNREFUSED/i.test(message.text())) {
      summary.errors.push(`${label} console: ${message.text()}`);
    }
  });
  return page;
}

async function open(page, path) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  await page.locator("main.sui-main").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(".cx-notifications").first().waitFor({ state: "visible", timeout: 30_000 });
  await sleep(120);
}

const SCREENS = [
  { name: "equipe", kind: "internal", path: "/espace-equipe/notifications" },
  { name: "personnel", kind: "internal", path: "/espace-personnel/notifications" },
  { name: "comexa", kind: "internal", path: "/espace-comexa/notifications" },
  { name: "client", kind: "client", path: "/espace-client/notifications" },
];

const TARGET_SELECTOR = [
  ".cx-notifications .sui-btn",
  ".cx-notifications .sui-pill",
  ".cx-notifications .sui-notif__actions .sui-iconbtn",
  ".cx-notifications .sui-notif__title a",
].join(", ");
const COMPONENT_SELECTOR = [
  ".cx-notifications",
  ".sui-notif",
  ".sui-filters",
  ".sui-notif__actions",
].join(", ");

async function measure(page) {
  return page.evaluate(({ targetSelector, componentSelector }) => {
    const viewport = window.innerWidth;
    const offenders = [...document.querySelectorAll(componentSelector)]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { className: String(element.className).slice(0, 100), left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((rect) => rect.width > 0 && (rect.right > viewport + 1 || rect.left < -1));
    const targets = [...document.querySelectorAll(targetSelector)]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: (element.textContent ?? element.getAttribute("aria-label") ?? element.tagName).trim().slice(0, 60), width: rect.width, height: rect.height };
      })
      .filter((rect) => rect.width > 0 && rect.height > 0);
    return {
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      overflow: document.documentElement.scrollWidth - viewport,
      offenders,
      minTargetWidth: targets.length ? Math.min(...targets.map((target) => target.width)) : null,
      minTargetHeight: targets.length ? Math.min(...targets.map((target) => target.height)) : null,
      targetCount: targets.length,
    };
  }, { targetSelector: TARGET_SELECTOR, componentSelector: COMPONENT_SELECTOR });
}

function assertMetrics(metrics, contextLabel) {
  assert.ok(metrics.overflow <= 1, `Débordement horizontal ${contextLabel} : ${metrics.overflow}px`);
  assert.deepEqual(metrics.offenders, [], `Composants hors cadre ${contextLabel}`);
  assert.ok(metrics.targetCount >= 1, `Aucune cible mesurable ${contextLabel}`);
  assert.ok(metrics.minTargetHeight >= 44, `Cible trop basse ${contextLabel} : ${metrics.minTargetHeight}`);
  assert.ok(metrics.minTargetWidth >= 44, `Cible trop étroite ${contextLabel} : ${metrics.minTargetWidth}`);
}

const launchEnv = { ...process.env };
if (process.env.CHROMIUM_LIB_PATH) launchEnv.LD_LIBRARY_PATH = process.env.CHROMIUM_LIB_PATH;
const browser = await chromium.launch({
  executablePath,
  headless: true,
  env: launchEnv,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const summary = { browser: browser.version(), baseUrl: BASE_URL, widths: [], interactions: {}, errors: [] };

try {
  const internalContext = await browser.newContext({ viewport: WIDTHS[0], locale: "fr-FR", timezoneId: "Africa/Algiers", reducedMotion: "reduce" });
  const clientContext = await browser.newContext({ viewport: WIDTHS[0], locale: "fr-FR", timezoneId: "Africa/Algiers", reducedMotion: "reduce" });
  const internalState = await installMockApi(internalContext, "internal");
  const clientState = await installMockApi(clientContext, "client");
  const internalPage = await preparePage(internalContext, summary, "interne");
  const clientPage = await preparePage(clientContext, summary, "client");
  const pages = { internal: internalPage, client: clientPage };

  for (const size of WIDTHS) {
    await internalPage.setViewportSize({ width: size.width, height: size.height });
    await clientPage.setViewportSize({ width: size.width, height: size.height });
    for (const screen of SCREENS) {
      const page = pages[screen.kind];
      await open(page, screen.path);
      const metrics = await measure(page);
      assertMetrics(metrics, `${screen.name} à ${size.width}px`);
      summary.widths.push({ ...size, screen: screen.name, ...metrics });
      if (SHOTS_DIR) await page.screenshot({ path: join(SHOTS_DIR, `notifications-${screen.name}-${size.width}.png`), fullPage: true });
    }
  }

  // --- Équipe : liens, doubles clics, erreur et refus de permission ----------
  await internalPage.setViewportSize({ width: 390, height: 844 });
  await open(internalPage, "/espace-equipe/notifications");
  const teamHrefs = await internalPage.locator(".cx-notifications .sui-notif__title a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  assert.ok(teamHrefs.includes("/espace-equipe/prospects/pr1"), `Lien prospect manquant : ${JSON.stringify(teamHrefs)}`);
  assert.ok(teamHrefs.includes("/espace-equipe/taches?tache=t1"), `Lien tâche manquant : ${JSON.stringify(teamHrefs)}`);
  assert.ok(teamHrefs.includes("/espace-equipe/messagerie"), `Lien messagerie manquant : ${JSON.stringify(teamHrefs)}`);
  summary.interactions.teamHrefs = teamHrefs;

  await internalPage.evaluate(() => {
    const button = document.querySelector('.cx-notifications .sui-notif__actions button[aria-label^="Marquer"]');
    button.click();
    button.click();
  });
  await sleep(300);
  const readCalls = internalState.requests.filter((item) => item.method === "POST" && item.path === "/api/notifications/t-prospect/read");
  assert.equal(readCalls.length, 1, "Un double clic ne doit produire qu'un POST de lecture.");
  summary.interactions.doubleClickReadPosts = readCalls.length;

  await internalPage.getByRole("button", { name: /Marquer « Notification cassée » comme lue/ }).click();
  await internalPage.getByText(/Lecture impossible/).waitFor({ state: "visible", timeout: 10_000 });
  summary.interactions.serverError = "erreur visible, aucune réussite fictive";

  await internalPage.getByRole("button", { name: /Marquer « Notification d'un autre compte » comme lue/ }).click();
  await internalPage.getByText(/Vous n'avez pas les droits|Droits insuffisants/).waitFor({ state: "visible", timeout: 10_000 });
  summary.interactions.permissionRefusal = "403 visible, notification non marquée";

  await internalPage.evaluate(() => {
    const button = [...document.querySelectorAll(".cx-notifications button")].find((candidate) => /Tout marquer comme lu/.test(candidate.textContent ?? ""));
    button.click();
    button.click();
  });
  await sleep(300);
  const teamReadAll = internalState.requests.filter((item) => item.method === "POST" && item.path === "/api/notifications/read-all");
  assert.equal(teamReadAll.length, 1, "Un double clic sur « tout lire » ne doit produire qu'un POST.");
  assert.equal(teamReadAll[0].space, "team", "Le marquage global doit rester dans l'espace équipe.");
  summary.interactions.teamReadAll = teamReadAll.length;

  // --- Personnel : tâche assignée + espace de lecture globale ----------------
  await open(internalPage, "/espace-personnel/notifications");
  const personalHrefs = await internalPage.locator(".cx-notifications .sui-notif__title a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  assert.ok(personalHrefs.includes("/espace-personnel/taches?tache=p1"));
  await internalPage.getByRole("button", { name: /Tout marquer comme lu/ }).click();
  await sleep(200);
  const personalReadAll = internalState.requests.filter((item) => item.method === "POST" && item.path === "/api/notifications/read-all" && item.space === "personal");
  assert.equal(personalReadAll.length, 1);
  summary.interactions.personalReadAll = personalReadAll.length;

  // --- Comexa Space : plus aucun SYSTEM métier -------------------------------
  await open(internalPage, "/espace-comexa/notifications");
  assert.match(await internalPage.locator(".cx-notifications").textContent(), /Aucune notification pour l’instant/);
  summary.interactions.comexaEmpty = true;

  // --- Client : liens profonds + lecture globale sans en-tête d'espace -------
  await clientPage.setViewportSize({ width: 390, height: 844 });
  await open(clientPage, "/espace-client/notifications");
  const clientHrefs = await clientPage.locator(".cx-notifications .sui-notif__title a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  assert.ok(clientHrefs.includes("/espace-client/devis/q1"));
  assert.ok(clientHrefs.includes("/espace-client/factures"));
  assert.ok(clientHrefs.includes("/espace-client/modifications"));
  assert.ok(clientHrefs.includes("/espace-client/messagerie"));
  summary.interactions.clientHrefs = clientHrefs;
  await clientPage.getByRole("button", { name: /Tout marquer comme lu/ }).click();
  await sleep(200);
  const clientReadAll = clientState.requests.filter((item) => item.method === "POST" && item.path === "/api/notifications/read-all");
  assert.equal(clientReadAll.length, 1);
  assert.equal(clientReadAll[0].space, null, "L'Espace client n'annonce aucun X-Comexa-Space.");
  summary.interactions.clientReadAll = clientReadAll.length;

  assert.deepEqual(summary.errors, [], `Erreurs navigateur : ${summary.errors.join(" | ")}`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
