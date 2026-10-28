/**
 * Test responsive reel de Comexa Space, avec API simulee.
 *
 * Prerequis :
 *   1. `npm run dev -- --hostname 0.0.0.0 --port 3000` ;
 *   2. `CHROMIUM_EXECUTABLE` (et `CHROMIUM_LIB_PATH` si besoin).
 *
 * Il ouvre les vraies pages Next avec un compte ADMIN, verifie les cinq
 * largeurs, le journal et ses details, les dialogues de jetons / suspension,
 * la matrice des permissions, les reglages et les etats charge/vide/erreur.
 * Aucun secret reel n'est genere ni affiche.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = (process.env.COMEXA_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const SHOTS_DIR = process.env.RESPONSIVE_SHOTS_DIR ?? null;
if (SHOTS_DIR) mkdirSync(SHOTS_DIR, { recursive: true });
const APP_DIALOG = '[role="dialog"]:not([data-nextjs-dialog])';
const executablePath = process.env.CHROMIUM_EXECUTABLE;
if (!executablePath) throw new Error("CHROMIUM_EXECUTABLE est requis pour le test responsive Comexa Space.");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const WIDTHS = [
  { width: 360, height: 780, label: "téléphone compact" },
  { width: 390, height: 844, label: "téléphone courant" },
  { width: 768, height: 1024, label: "tablette portrait" },
  { width: 1024, height: 768, label: "tablette paysage" },
  { width: 1440, height: 900, label: "ordinateur" },
];

const FAKE_SECRET = "cxi_QA_SECRET_NE_DOIT_PAS_APPARAILTRE";
const LONG_ID = "clx8f2p0k5m9n2q7r4t6v8w0y1z3a5b7c9d0e2f4g6h8";
const QUOTE_ID = "clxquote2p0k5m9n2q7r4t6v8w0y1z3a5b7c9d0e2f4";
const REFERENCE_NOW = "2026-10-28T09:00:00.000Z";

const catalogueSource = readFileSync(new URL("../backend/src/common/auth/permissions.catalogue.ts", import.meta.url), "utf8");
const PERMISSION_CODES = [...new Set(
  [...catalogueSource.matchAll(/^\s*'([a-z_]+:[a-z_]+:[a-z_]+)'\s*:/gm)].map((match) => match[1]),
)];
assert.ok(PERMISSION_CODES.length > 40, "Le catalogue des permissions doit etre lisible pour le test.");

const PERMISSION_CATALOGUE = PERMISSION_CODES.slice(0, 46).map((code) => {
  const [resource, action, scope] = code.split(":");
  return { code, resource, action, scope, description: `Droit de test ${code}` };
});

const USER = {
  id: "user-admin-qa",
  email: "admin.qa@comexa.test",
  firstName: "Amina",
  lastName: "Administratrice",
  phone: "+213555000001",
  roles: ["ADMIN"],
  clientId: null,
  permissions: [...PERMISSION_CODES],
};

const SPACES = [
  { id: "personal", permissions: [...PERMISSION_CODES] },
  { id: "team", permissions: [...PERMISSION_CODES] },
  { id: "comexa", permissions: [...PERMISSION_CODES] },
];

const FEATURES = {
  timer: true,
  personalTasks: true,
  calendar: true,
  taskCreators: true,
  goals: true,
  timerTasks: true,
  taskAssignees: true,
};

const ROLES = [
  { code: "ADMIN", name: "Administrateur", permissionCount: PERMISSION_CODES.length, isSystem: true },
  { code: "DEVELOPER", name: "Développeur", permissionCount: 3, isSystem: false },
];
const ROLE_DETAILS = {
  ADMIN: { ...ROLES[0], permissions: PERMISSION_CATALOGUE.slice(0, 5) },
  DEVELOPER: { ...ROLES[1], permissions: PERMISSION_CATALOGUE.slice(0, 3) },
};

const USERS = [
  {
    id: "user-member-long-technical-identifier-1234567890",
    email: "lina.membre@comexa.test",
    firstName: "Lina",
    lastName: "Membre",
    phone: "+213555000002",
    status: "ACTIVE",
    roles: [{ code: "DEVELOPER" }],
    mustChangePassword: false,
    lastLoginAt: "2026-10-27T08:30:00.000Z",
  },
  {
    id: "user-suspended-qa-2",
    email: "sami.suspendu@comexa.test",
    firstName: "Sami",
    lastName: "Suspendu",
    phone: null,
    status: "SUSPENDED",
    roles: [{ code: "SALES" }],
    mustChangePassword: true,
    lastLoginAt: null,
  },
];

const TOKENS = [
  {
    id: LONG_ID,
    name: "n8n-agent-pilote",
    prefix: "cxi_qaonly",
    scopes: ["task:read:any", "quote:read:any"],
    active: true,
    expiresAt: "2026-12-31T00:00:00.000Z",
    revokedAt: null,
    lastUsedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    createdBy: { email: "admin.qa@comexa.test" },
  },
  {
    id: "token-old-qa-2",
    name: "veille-inactive-90j",
    prefix: "cxi_qaold",
    scopes: ["report:read:any"],
    active: true,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: "2000-01-01T00:00:00.000Z",
    createdAt: "2000-01-01T00:00:00.000Z",
    createdBy: { email: "admin.qa@comexa.test" },
  },
];

const AUDIT_LOGS = [
  {
    id: "audit-quote-change",
    actorId: LONG_ID,
    actorEmail: "admin.qa@comexa.test",
    action: "QUOTE_STATUS_CHANGED",
    entityType: "Quote",
    entityId: QUOTE_ID,
    before: {
      status: "DRAFT",
      profile: { city: "Alger", note: "Brouillon" },
      password: "[masque]",
      sessionJwt: "[masque]",
    },
    after: {
      status: "SENT",
      profile: { city: "Oran", note: "Brouillon" },
      password: "[masque]",
      freeNote: "[masque]",
    },
    ipAddress: "2001:db8:0:0:0:0:0:1",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/153.0.8010.0 Safari/537.36 ComexaQA/LongUserAgent",
    createdAt: REFERENCE_NOW,
  },
  {
    id: "audit-user-suspend",
    actorId: "user-admin-qa",
    actorEmail: "admin.qa@comexa.test",
    action: "USER_SUSPENDED",
    entityType: "UnknownLegacyEntity",
    entityId: null,
    before: { status: "ACTIVE" },
    after: { status: "SUSPENDED" },
    ipAddress: null,
    userAgent: "ComexaQA/1.0",
    createdAt: "2026-10-27T16:45:00.000Z",
  },
];

const SETTINGS = [
  { key: "company.name", value: "Comexa QA", description: "Nom de l'organisation" },
  { key: "company.email", value: "contact@comexa.test", description: "Adresse de contact" },
  { key: "company.legal.address", value: "Alger, Algérie", description: "Adresse légale" },
];

function envelope(data, meta = undefined) {
  return { success: true, data, ...(meta ? { meta } : {}) };
}
function paginationMeta(rows, perPage = 100) {
  return { page: 1, perPage, total: rows.length, totalPages: 1 };
}

async function installMockApi(context, options = {}) {
  const state = { requests: [], options };
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
    state.requests.push({ path, method, body, query: url.search });
    const json = (data, meta, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(meta === undefined ? envelope(data) : envelope(data, meta)),
    });
    const list = (rows) => json(rows, paginationMeta(rows));
    const failure = (status, message) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: { code: "QA_ERROR", message } }),
    });

    if (path === "/api/health") {
      if (options.error) return failure(503, "Sonde API indisponible en mode QA.");
      return json({
        status: "ok",
        database: "up",
        databaseTarget: "autre",
        uptimeSeconds: 3600,
        timestamp: REFERENCE_NOW,
        contract: { version: "2026-10-21.2", features: FEATURES },
      });
    }
    if (path === "/api/auth/refresh" && method === "POST") return json({ accessToken: "qa-admin-token", user: USER });
    if (path === "/api/auth/me") return json(USER);
    if (path === "/api/me/spaces") return json({ spaces: SPACES });
    if (path === "/api/notifications/summary") return json({ unreadBySpace: {} });
    if (path === "/api/timer" && method === "GET") return json(null);
    if (path === "/api/timer/summary") return json({ todayMinutes: 0, weekMinutes: 0 });

    if (path === "/api/permissions") return list(PERMISSION_CATALOGUE);
    if (path === "/api/roles" && method === "GET") return list(ROLES);
    if (/^\/api\/roles\/[^/]+$/.test(path) && method === "GET") {
      const code = path.split("/").pop();
      return json(ROLE_DETAILS[code] ?? ROLE_DETAILS.DEVELOPER);
    }

    if (path === "/api/users" && method === "GET") {
      const status = url.searchParams.get("status");
      return list(status ? USERS.filter((user) => user.status === status) : USERS);
    }
    if (path.startsWith("/api/users/")) return json({ ok: true });

    if (path === "/api/integrations/tokens" && method === "GET") return list(options.empty ? [] : TOKENS);
    if (path.startsWith("/api/integrations/tokens/")) return json({ ok: true });

    if (path === "/api/audit-logs" && method === "GET") {
      if (options.error) return failure(500, "Journal indisponible en mode QA.");
      if (options.loadingAudit) await sleep(700);
      return list(options.empty ? [] : AUDIT_LOGS);
    }

    if (path === "/api/settings") {
      if (method === "GET") return list(SETTINGS);
      return json({ settings: body?.settings ?? [] });
    }

    if (path === "/api/auth/sessions") return list([]);
    if (path === "/api/notifications") return list([]);
    if (path.startsWith("/api/content/")) return list([]);
    if (path.startsWith("/api/currencies")) return list([]);
    if (path.startsWith("/api/exchange-rates")) return list([]);

    if (method !== "GET") return json({ ok: true });
    return list([]);
  });
  return state;
}

async function preparePage(context, summary, label) {
  const page = await context.newPage();
  page.on("pageerror", (error) => summary.errors.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/socket\.io|Failed to load resource/i.test(message.text())) {
      summary.errors.push(`${label} console: ${message.text()}`);
    }
  });
  return page;
}

async function open(page, screen) {
  await page.goto(`${BASE_URL}${screen.path}`, { waitUntil: "domcontentloaded" });
  await page.locator("main.sui-main").first().waitFor({ state: "visible", timeout: 30_000 });
  if (screen.after) await screen.after(page);
  await page.locator(screen.ready).first().waitFor({ state: "visible", timeout: 30_000 });
  await sleep(120);
}

const SCREENS = [
  { name: "tableau-de-bord", path: "/espace-comexa/tableau-de-bord", ready: '[data-testid="admin-health-panel"]' },
  { name: "journal", path: "/espace-comexa/journal", ready: '[data-testid="audit-page"]' },
  {
    name: "journal-detail",
    path: "/espace-comexa/journal",
    ready: '[data-testid="audit-detail"]',
    after: async (page) => {
      await page.locator('[data-testid="audit-open"]').first().click();
    },
  },
  { name: "parametres-organisation", path: "/espace-comexa/parametres", ready: '[data-testid="settings-impact"]' },
  { name: "parametres-avances", path: "/espace-comexa/parametres?onglet=advanced", ready: '[data-testid="settings-impact"]' },
  { name: "parametres-temps", path: "/espace-comexa/parametres?onglet=time", ready: '[data-testid="settings-impact"]' },
  {
    name: "roles-matrice",
    path: "/espace-comexa/roles",
    ready: 'input[type="checkbox"]',
    after: async (page) => {
      await page.getByRole("button", { name: /Développeur/ }).first().click();
    },
  },
  { name: "integrations", path: "/espace-comexa/integrations", ready: "text=Jetons existants" },
  {
    name: "integrations-revocation",
    path: "/espace-comexa/integrations",
    ready: APP_DIALOG,
    after: async (page) => {
      await page.getByRole("button", { name: "Révoquer", exact: true }).first().click();
    },
  },
  { name: "membres", path: "/espace-comexa/membres", ready: "text=Lina Membre" },
  {
    name: "membres-suspension",
    path: "/espace-comexa/membres",
    ready: APP_DIALOG,
    after: async (page) => {
      await page.getByRole("button", { name: /Actions pour le membre/ }).first().click();
      await page.getByRole("menuitem", { name: /Suspendre le compte/ }).first().click();
    },
  },
  { name: "notifications", path: "/espace-comexa/notifications", ready: "main.sui-main" },
  { name: "contenu", path: "/espace-comexa/contenu", ready: "main.sui-main" },
  { name: "compte", path: "/espace-comexa/compte", ready: "main.sui-main" },
];

const TARGET_SELECTOR = [
  ".cx-audit-row__open",
  ".cx-audit-filters button",
  ".cx-health-refresh",
  ".cx-health-actions a",
  ".cx-audit-copy",
  ".cx-audit-drawer .sui-dialog__foot a",
  ".sui-btn:not(.sui-btn--sm)",
  ".sui-shortcut",
  `${APP_DIALOG} .sui-btn`,
  "main button[aria-current]",
].join(", ");

const COMPONENT_SELECTOR = [
  ".cx-audit-filters",
  ".cx-audit-row",
  ".cx-health-panel",
  ".cx-health-check",
  ".cx-settings-impact",
  ".cx-audit-drawer",
  ".cx-audit-diff__row",
  ".cx-redesign__hero",
  ".sui-card",
  ".sui-kpi",
  APP_DIALOG,
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
const summary = { browser: browser.version(), baseUrl: BASE_URL, widths: [], interactions: {}, states: {}, errors: [] };

try {
  const context = await browser.newContext({
    viewport: WIDTHS[0],
    locale: "fr-FR",
    timezoneId: "Africa/Algiers",
    reducedMotion: "reduce",
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
  const state = await installMockApi(context);
  const page = await preparePage(context, summary, "principal");

  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const screen of SCREENS) {
      await open(page, screen);
      const metrics = await measure(page);
      assertMetrics(metrics, `${screen.name} à ${size.width}px`);
      summary.widths.push({ ...size, screen: screen.name, ...metrics });
      if (SHOTS_DIR) await page.screenshot({ path: join(SHOTS_DIR, `comexa-${screen.name}-${size.width}.png`), fullPage: true });
    }
  }

  // --- Interactions metier a 390 px -----------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });

  await open(page, SCREENS[0]);
  const healthText = await page.locator('[data-testid="admin-health-panel"]').textContent();
  assert.match(healthText, /Ce qui est réellement vérifié/);
  assert.match(healthText, /Vérification non configurée/);
  assert.match(healthText, /État inconnu/);
  assert.match(healthText, /Risque confirmé par le code/);
  assert.match(healthText, /jamais utilisé\(s\)|sans usage depuis 90 jours/);
  assert.doesNotMatch(healthText, /E-mails.*Opérationnel|Stockage.*Opérationnel/i);
  summary.interactions.healthChecks = await page.locator(".cx-health-check").count();
  summary.interactions.healthRisks = await page.locator(".cx-health-risks li").count();

  await open(page, SCREENS[1]);
  await page.locator('input[list="audit-action-options"]').fill("QUOTE_STATUS_CHANGED");
  await page.locator('input[list="audit-entity-options"]').fill("Quote");
  await page.locator('input[placeholder="Identifiant technique"]').fill(QUOTE_ID);
  await page.locator('input[placeholder="Identifiant du compte"]').fill(LONG_ID);
  await page.locator('input[type="date"]').first().fill("2026-10-01");
  await page.locator('input[type="date"]').last().fill("2026-10-31");
  await page.locator('[data-testid="audit-apply"]').click();
  await sleep(250);
  const applied = state.requests.findLast((item) => item.path === "/api/audit-logs" && item.query.includes("entityId="));
  assert.ok(applied, "Les filtres doivent appeler /api/audit-logs avec entityId.");
  const appliedParams = new URLSearchParams(applied.query);
  assert.equal(appliedParams.get("action"), "QUOTE_STATUS_CHANGED");
  assert.equal(appliedParams.get("entityType"), "Quote");
  assert.equal(appliedParams.get("entityId"), QUOTE_ID);
  assert.equal(appliedParams.get("actorId"), LONG_ID);
  const fromIso = appliedParams.get("from") ?? "";
  const toIso = appliedParams.get("to") ?? "";
  assert.match(fromIso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(toIso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  // Le navigateur est en Afrique/Alger : minuit local = 23 h UTC la veille.
  assert.ok(Date.parse(fromIso) >= Date.parse("2026-09-30T00:00:00.000Z"));
  assert.ok(Date.parse(fromIso) <= Date.parse("2026-10-01T00:00:00.000Z"));
  assert.ok(Date.parse(toIso) > Date.parse("2026-10-31T00:00:00.000Z"));
  assert.ok(Date.parse(toIso) <= Date.parse("2026-11-01T00:00:00.000Z"));
  summary.interactions.filterQuery = applied.query;

  await page.locator('[data-testid="audit-open"]').first().click();
  await page.locator('[data-testid="audit-detail"]').waitFor({ state: "visible" });
  assert.equal(
    await page.locator(`${APP_DIALOG}[aria-modal="true"]:has([data-testid="audit-detail"])`).count(),
    1,
    "Le detail d'audit doit etre un dialogue modal.",
  );
  assert.equal(await page.locator('[data-testid="audit-diff-row"]').count() > 0, true);
  assert.match(await page.locator('[data-testid="audit-detail"]').textContent(), /Masqué par sécurité/);
  assert.equal(await page.locator('[data-testid="audit-detail-link"]').getAttribute("href"), `/espace-equipe/devis/${QUOTE_ID}`);
  await page.locator('[data-testid="audit-copy-id"]').click();
  await page.getByText("ID copié", { exact: false }).waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), QUOTE_ID);
  const detailText = await page.locator("body").textContent();
  assert.doesNotMatch(detailText, new RegExp(FAKE_SECRET));
  assert.doesNotMatch(detailText, /eyJ[A-Za-z0-9_-]{8,}\./);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="audit-detail"]').waitFor({ state: "detached", timeout: 5000 });
  summary.interactions.auditDetail = "diff masqué, lien autorisé, copie, Escape OK";

  const accessibility = await page.evaluate(() => {
    const unnamed = [...document.querySelectorAll('main button, [role="dialog"]:not([data-nextjs-dialog]) button')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return !(element.textContent?.trim() || element.getAttribute("aria-label") || element.getAttribute("title"));
      })
      .map((element) => element.outerHTML.slice(0, 120));
    return { unnamed };
  });
  assert.deepEqual(accessibility.unnamed, [], "Boutons sans nom accessible.");
  summary.interactions.accessibility = "boutons nommés, dialogue aria-modal, Escape";

  for (const [index, expected] of [
    [3, /Enregistré, effet non confirmé/],
    [4, /Effet non vérifié/],
    [5, /Actif, mais local au navigateur/],
  ]) {
    await open(page, SCREENS[index]);
    assert.match(await page.locator('[data-testid="settings-impact"]').textContent(), expected);
  }
  summary.interactions.settingsImpact = 3;

  await open(page, SCREENS[6]);
  const matrixTargets = await page.evaluate(() => [...document.querySelectorAll('input[type="checkbox"]')].filter((element) => element.getBoundingClientRect().width > 0).length);
  assert.ok(matrixTargets > 0, "La matrice des permissions doit afficher des cases.");
  summary.interactions.permissionCheckboxes = matrixTargets;

  await open(page, SCREENS[7]);
  await page.getByRole("button", { name: "Révoquer", exact: true }).first().click();
  await page.locator(APP_DIALOG).waitFor({ state: "visible" });
  assert.match(await page.locator(APP_DIALOG).textContent(), /Révoquer ce jeton immédiatement/);
  await page.getByRole("button", { name: "Révoquer", exact: true }).last().click();
  await page.getByText(/est révoqué/).waitFor({ state: "visible", timeout: 10_000 });
  summary.interactions.revoke = await state.requests.filter((item) => item.method === "POST" && item.path.includes("/revoke")).length;

  await open(page, SCREENS[9]);
  await page.getByRole("button", { name: /Actions pour le membre/ }).first().click();
  await page.getByRole("menuitem", { name: /Suspendre le compte/ }).first().click();
  await page.locator(APP_DIALOG).waitFor({ state: "visible" });
  assert.match(await page.locator(APP_DIALOG).textContent(), /Suspendre ce membre/);
  summary.interactions.suspendDialog = true;

  const allText = await page.locator("body").textContent();
  assert.doesNotMatch(allText, new RegExp(FAKE_SECRET));
  summary.interactions.noSecretsInDom = true;
  await context.close();

  // --- Etats chargement, vide et erreur -------------------------------------
  for (const [name, options, expected] of [
    ["loading", { loadingAudit: true }, /Chargement du journal/],
    ["empty", { empty: true }, /Aucun événement ne correspond/],
    ["error", { error: true }, /Sonde API indisponible|Journal indisponible/],
  ]) {
    const stateContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "fr-FR",
      timezoneId: "Africa/Algiers",
      reducedMotion: "reduce",
    });
    await installMockApi(stateContext, options);
    const statePage = await preparePage(stateContext, summary, name);
    await statePage.goto(`${BASE_URL}/espace-comexa/journal`, { waitUntil: "domcontentloaded" });
    if (name === "loading") {
      await statePage.locator('[aria-label="Chargement du journal"]').waitFor({ state: "visible", timeout: 5000 });
      await statePage.locator('[data-testid="audit-row"]').first().waitFor({ state: "visible", timeout: 10_000 });
    } else {
      await statePage.getByText(expected).first().waitFor({ state: "visible", timeout: 15_000 });
    }
    if (name === "error") {
      await statePage.goto(`${BASE_URL}/espace-comexa/tableau-de-bord`, { waitUntil: "domcontentloaded" });
      await statePage.locator('[data-testid="admin-health-panel"]').waitFor({ state: "visible" });
      await statePage.locator(".cx-health-check").first().waitFor({ state: "visible", timeout: 10_000 });
      assert.match(await statePage.locator('[data-testid="admin-health-panel"]').textContent(), /Indisponible/);
      assert.match(await statePage.locator('[data-testid="admin-health-panel"]').textContent(), /Les contrôles non vérifiés restent affichés/);
    }
    assertMetrics(await measure(statePage), `${name} 390px`);
    summary.states[name] = name === "loading" ? "squelette puis liste" : name === "empty" ? "message vide, aucun compteur trompeur" : "erreur visible, controles non verifies";
    await stateContext.close();
  }

  assert.deepEqual(summary.errors, [], `Erreurs navigateur : ${summary.errors.join(" | ")}`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
