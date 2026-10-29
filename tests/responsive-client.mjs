/**
 * Test responsive reel de l'Espace client, avec API simulee.
 *
 * Prerequis :
 *   1. `npm run dev -- --hostname 0.0.0.0 --port 3000` ;
 *   2. `CHROMIUM_EXECUTABLE` (et `CHROMIUM_LIB_PATH` si besoin).
 *
 * Le test ouvre les vraies pages Next avec un compte CLIENT, verifie les cinq
 * largeurs, les decisions, l'isolation entre deux clients et les etats
 * vide/erreur. Il ne remplace pas une recette avec le backend PostgreSQL.
 */

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = (process.env.COMEXA_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const SHOTS_DIR = process.env.RESPONSIVE_SHOTS_DIR ?? null;
if (SHOTS_DIR) mkdirSync(SHOTS_DIR, { recursive: true });
const executablePath = process.env.CHROMIUM_EXECUTABLE;
if (!executablePath) throw new Error("CHROMIUM_EXECUTABLE est requis pour le test responsive client.");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const WIDTHS = [
  { width: 360, height: 780, label: "téléphone compact" },
  { width: 390, height: 844, label: "téléphone courant" },
  { width: 768, height: 1024, label: "tablette portrait" },
  { width: 1024, height: 768, label: "tablette paysage" },
  { width: 1440, height: 900, label: "ordinateur" },
];

const REFERENCE_NOW = Date.parse("2026-10-28T10:00:00.000Z");
const HOME = "/espace-client";
const DASHBOARD = "/espace-client/tableau-de-bord";
const PROJECT = "/espace-client/projets/project-client-a";
const OTHER_PROJECT = "/espace-client/projets/project-client-b";
const QUOTE = "/espace-client/devis/quote-open";
const EXPIRED_QUOTE = "/espace-client/devis/quote-expired";
const INVOICES = "/espace-client/factures";
const MODIFICATIONS = "/espace-client/modifications";

const SCREENS = [
  ["accueil", HOME, '[data-testid="client-focus-board"]'],
  ["tableau-de-bord", DASHBOARD, '[data-testid="client-focus-board"]'],
  ["projet", PROJECT, '[data-testid="client-project-story"]'],
  ["devis", QUOTE, '[data-testid="client-quote-decision"]'],
  ["factures", INVOICES, '[data-testid="client-payment-help"]'],
  ["modifications", MODIFICATIONS, '[data-testid="client-modification-advice"]'],
];

function isoDay(offset = 0) {
  const date = new Date(REFERENCE_NOW);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
const day = (offset) => `${isoDay(offset)}T00:00:00.000Z`;
const noon = (offset) => `${isoDay(offset)}T12:00:00.000Z`;

const USER = {
  id: "user-client-a",
  email: "client.a@comexa.test",
  firstName: "Camille",
  lastName: "Client",
  roles: ["CLIENT"],
  clientId: "client-a",
  permissions: [
    "user:read:own",
    "client:read:own",
    "project:read:own",
    "milestone:read:any",
    "quote:read:own",
    "quote:accept:own",
    "order:read:own",
    "invoice:read:own",
    "payment:read:own",
    "document:read:client",
    "conversation:read:own",
    "message:read:own",
    "message:write:own",
    "notification:read:own",
    "notification:manage:own",
    "modificationrequest:read:own",
    "modificationrequest:write:own",
    "dashboard:read:own",
  ],
};

function quote(id, status, offset, subject) {
  return {
    id,
    reference: `D-${id}`,
    subject,
    status,
    issueDate: day(-5),
    validUntil: day(offset),
    acceptedAt: null,
    rejectedAt: null,
    currency: "DZD",
    subtotal: "100000",
    taxRate: "19",
    taxAmount: "19000",
    total: "119000",
    notes: "Prestations decrites dans le detail ci-dessous.",
    terms: "Devis valable jusqu'a la date indiquee.",
    items: [
      { id: `line-${id}`, title: "Conception", description: "Cadrage et maquette", quantity: 1, unitPrice: "100000", lineTotal: "100000" },
    ],
  };
}

function makeState({ empty = false, error = false } = {}) {
  const quotes = empty
    ? []
    : [
        quote("quote-open", "SENT", 1, "Refonte du site"),
        quote("quote-expired", "EXPIRED", -1, "Ancienne proposition"),
        quote("quote-accepted", "ACCEPTED", 1, "Prestation acceptee"),
      ];
  const invoices = empty
    ? []
    : [
        {
          id: "invoice-open",
          reference: "F-2026-001",
          subject: "Acompte refonte",
          status: "SENT",
          total: "60000",
          amountPaid: "20000",
          currency: "DZD",
          issueDate: day(-4),
          dueDate: day(5),
          payments: [],
        },
        {
          id: "invoice-paid",
          reference: "F-2026-002",
          subject: "Solde campagne",
          status: "PAID",
          total: "30000",
          amountPaid: "30000",
          currency: "DZD",
          issueDate: day(-10),
          dueDate: day(-1),
          payments: [],
        },
      ];
  const projects = empty
    ? []
    : [
        {
          id: "project-client-a",
          reference: "PRJ-2026-001",
          name: "Refonte du site web",
          status: "IN_PROGRESS",
          progressPercent: 55,
          dueDate: noon(15),
          createdAt: noon(-20),
          updatedAt: noon(),
          counts: { tasks: 0, milestones: 3, members: 0 },
        },
      ];
  const milestones = [
    { id: "milestone-1", title: "Cadrage", description: "Atelier de cadrage", status: "REACHED", dueDate: day(-10), reachedAt: day(-9), order: 1 },
    { id: "milestone-2", title: "Maquette à valider", description: "Proposition de maquette", status: "IN_PROGRESS", dueDate: day(2), reachedAt: null, order: 2 },
    { id: "milestone-3", title: "Mise en ligne", description: "Publication", status: "PENDING", dueDate: day(12), reachedAt: null, order: 3 },
  ];
  const modifications = empty
    ? []
    : [
        {
          id: "mod-approved",
          reference: "MOD-001",
          title: "Ajouter une page",
          description: "Ajouter une page presentation supplementaire.",
          status: "APPROVED",
          priority: "NORMAL",
          extraCost: "25000",
          extraCostCurrency: "DZD",
          decisionNote: "Deux maquettes supplementaires incluses.",
          decidedAt: noon(-1),
          createdAt: noon(-3),
        },
        {
          id: "mod-submitted",
          reference: "MOD-002",
          title: "Changer une couleur",
          description: "Utiliser le bleu de la charte.",
          status: "SUBMITTED",
          priority: "LOW",
          extraCost: null,
          extraCostCurrency: "DZD",
          decisionNote: null,
          decidedAt: null,
          createdAt: noon(-1),
        },
      ];
  const conversations = empty
    ? []
    : [{ id: "conv-a", subject: "Projet refonte", unreadCount: 2, lastMessageAt: noon(), lastMessagePreview: "Bonjour", isArchived: false, type: "PROJECT", participants: [] }];
  const documents = [
    { id: "doc-shared", name: "Maquette v1.pdf", originalName: "Maquette-v1.pdf", version: 1, visibility: "CLIENT", createdAt: noon(-2), mimeType: "application/pdf" },
    { id: "doc-internal", name: "NOTE-INTERNE-CONFIDENTIELLE.pdf", originalName: "interne.pdf", version: 1, visibility: "INTERNAL", createdAt: noon(-2), mimeType: "application/pdf" },
  ];
  return { quotes, invoices, projects, milestones, modifications, conversations, documents, requests: [], error, decisions: 0 };
}

function envelope(data, meta = undefined) {
  return { success: true, data, ...(meta ? { meta } : {}) };
}
function paginationMeta(rows, perPage = 100) {
  return { page: 1, perPage, total: rows.length, totalPages: 1 };
}

async function installMockApi(context, options = {}) {
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
    state.requests.push({ path, method, body, query: url.search });
    const json = (data, meta, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(meta === undefined ? envelope(data) : envelope(data, meta)),
    });
    const list = (rows) => json(rows, paginationMeta(rows));

    if (path === "/api/health") {
      return json({
        status: "ok",
        contract: { version: "2026-10-28.2", features: { timer: true, personalTasks: true, calendar: true, taskCreators: true, goals: true, timerTasks: true, taskAssignees: true, clientPortal: true } },
      });
    }
    if (path === "/api/auth/refresh" && method === "POST") return json({ accessToken: "qa-client-token", user: USER });
    if (path === "/api/me/spaces") return json({ spaces: [] });
    if (path === "/api/notifications/summary") return json({ unreadBySpace: {} });
    if (path === "/api/timer" && method === "GET") return json(null);
    if (path === "/api/timer/summary") return json({ todayMinutes: 0, weekMinutes: 0 });

    if (path === "/api/dashboard/client") {
      if (options.error) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "API tableau de bord indisponible" } }) });
      return json({
        asOf: noon(),
        client: { id: "client-a", reference: "CLI-001", companyName: "Client A" },
        sections: {},
        projects: { total: state.projects.length, active: state.projects.length, averageProgress: 55, items: state.projects },
        milestones: { total: state.milestones.length, reached: 1, overdue: 0, byStatus: [] },
        invoices: { open: { count: 1, currency: "DZD", total: "40000", byCurrency: [] }, overdue: { count: 0 }, paid: { count: 1 }, items: state.invoices },
        quotes: { total: state.quotes.length, pending: 1, accepted: 1, byStatus: [] },
        documents: { total: 1, items: state.documents.filter((doc) => doc.visibility !== "INTERNAL") },
        notifications: { unread: options.empty ? 0 : 1 },
      });
    }

    if (path === "/api/quotes" && method === "GET") {
      if (options.error) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "API devis indisponible" } }) });
      return list(state.quotes);
    }
    if (/^\/api\/quotes\/[^/]+\/view$/.test(path) && method === "POST") {
      const id = path.split("/")[3];
      const item = state.quotes.find((quote) => quote.id === id);
      if (item && item.status === "SENT") item.status = "VIEWED";
      return json(item ?? {});
    }
    if (/^\/api\/quotes\/[^/]+\/accept$/.test(path) && method === "POST") {
      const id = path.split("/")[3];
      if (id === "quote-client-b") return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "Devis introuvable." } }) });
      if (options.acceptDelay) await sleep(options.acceptDelay);
      state.decisions += 1;
      const item = state.quotes.find((quote) => quote.id === id);
      if (item) item.status = "ACCEPTED";
      return json({ quoteId: id, status: "ACCEPTED", projectId: "project-client-a" });
    }
    if (/^\/api\/quotes\/[^/]+\/refuse$/.test(path) && method === "POST") return json({ ok: true });
    if (/^\/api\/quotes\/[^/]+$/.test(path) && method === "GET") {
      const id = path.split("/")[3];
      if (id === "quote-client-b") return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "Devis introuvable." } }) });
      const item = state.quotes.find((quote) => quote.id === id);
      return item ? json(item) : route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "Devis introuvable." } }) });
    }

    if (path === "/api/invoices" && method === "GET") return list(state.invoices);
    if (path === "/api/modification-requests" && method === "GET") return list(state.modifications);
    if (path === "/api/conversations" && method === "GET") return list(state.conversations);
    if (path === "/api/projects" && method === "GET") return list(state.projects);
    if ((path === "/api/projects/project-client-b" || path === "/api/quotes/quote-client-b") && method === "GET") {
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "Ressource introuvable." } }) });
    }
    if (/^\/api\/projects\/[^/]+\/milestones$/.test(path) && method === "GET") {
      const projectId = path.split("/")[3];
      if (projectId !== "project-client-a") return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "Projet introuvable." } }) });
      return list(state.milestones);
    }
    if (/^\/api\/projects\/[^/]+\/activities$/.test(path)) {
      return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "Activité interne non autorisée." } }) });
    }
    if (/^\/api\/projects\/[^/]+\/tasks$/.test(path)) {
      return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "Tâches internes non autorisées." } }) });
    }
    if (/^\/api\/projects\/[^/]+$/.test(path) && method === "GET") {
      const id = path.split("/")[3];
      const item = state.projects.find((project) => project.id === id);
      return item ? json(item) : route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "Projet introuvable." } }) });
    }
    if (path === "/api/documents" && method === "GET") {
      const projectId = url.searchParams.get("projectId");
      if (projectId && projectId !== "project-client-a") {
        return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "Projet introuvable." } }) });
      }
      return list(state.documents.filter((doc) => doc.visibility !== "INTERNAL"));
    }
    if (/^\/api\/documents\/doc-internal(?:\/|$)/.test(path)) {
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "Document introuvable." } }) });
    }
    if (/^\/api\/documents\/[^/]+\/content$/.test(path)) {
      return route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4 test" });
    }
    if (path.startsWith("/api/pdf/")) return route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4 test" });
    if (method !== "GET") return json({ ok: true });
    return list([]);
  });
  return state;
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

async function open(page, path, selector, timeout = 30_000) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  await page.locator(selector).first().waitFor({ state: "visible", timeout });
}

async function measure(page) {
  return page.evaluate(() => {
    const viewport = window.innerWidth;
    const components = [...document.querySelectorAll(".client-focus, .client-action, .client-story, .client-modification, .client-document, .sui-row")];
    const offenders = components
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { className: String(element.className).slice(0, 100), left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((rect) => rect.right > viewport + 1 || rect.left < -1);
    const targets = [
      ...document.querySelectorAll(
        '.client-action__button, .client-focus__link, .client-quote__action, [data-testid="client-document-download"], [data-testid="client-modification-contact"], .client-quote__expired a',
      ),
    ]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: element.textContent?.trim()?.slice(0, 60) ?? element.tagName, width: rect.width, height: rect.height };
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
  });
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
  const state = await installMockApi(context, { acceptDelay: 300 });
  const page = await preparePage(context, summary, "principal");

  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const [name, path, selector] of SCREENS) {
      await open(page, path, selector);
      const metrics = await measure(page);
      assertMetrics(metrics, `${name} à ${size.width}px`);
      summary.widths.push({ ...size, screen: name, ...metrics });
      if (SHOTS_DIR) await page.screenshot({ path: join(SHOTS_DIR, `client-${name}-${size.width}.png`), fullPage: true });
    }
  }

  // Interactions et contenu metier a 390 px.
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, HOME, '[data-testid="client-focus-board"]');
  const actionText = await page.locator('[data-testid="client-focus-actions"]').textContent();
  assert.match(actionText, /Refonte du site/);
  assert.doesNotMatch(actionText, /Ancienne proposition/, "Un devis expire ne doit pas rester une action.");
  assert.match(actionText, /solde restant|Voir le solde/i);
  assert.doesNotMatch(await page.locator("body").textContent(), /Client B|Site confidentiel B|NOTE-INTERNE/);
  const focusBoardText = await page.locator('[data-testid="client-focus-board"]').textContent();
  assert.match(focusBoardText, /Maquette à valider/);
  assert.match(focusBoardText, /Aucune facture en attente|Solde restant/);
  summary.interactions.focusActions = await page.locator('[data-testid="client-action"]').count();

  // Projet : recit, prochaine etape, aucune donnee interne.
  await open(page, PROJECT, '[data-testid="client-project-story"]');
  assert.match(await page.locator('[data-testid="client-project-next-step"]').textContent(), /Maquette à valider/);
  assert.equal(await page.locator('[data-testid="client-project-timeline"] li').count(), 3);
  const projectText = await page.locator("body").textContent();
  assert.doesNotMatch(projectText, /NOTE-INTERNE|note interne|temps saisi|marge|budget interne/i);
  assert.equal(await page.locator('[data-testid="client-document-download"]').count(), 1);
  assert.equal(state.requests.some((item) => /\/activities$|\/tasks$|time-entries/.test(item.path)), false, "Aucune route interne ne doit etre appelee.");

  // Devis : confirmation explicite, un seul POST, succes visible.
  await open(page, QUOTE, '[data-testid="client-quote-decision"]');
  assert.match(await page.locator('[data-testid="client-quote-expiry-banner"]').textContent(), /demain/i);
  await page.getByRole("button", { name: "Accepter le devis" }).click();
  const confirm = page.getByRole("button", { name: "Confirmer l'acceptation" });
  await confirm.click();
  await page.waitForFunction(() => document.querySelector('[data-coach-id="devis-accept-confirm"]')?.disabled === true || document.body.textContent.includes("Devis accepté"));
  // Un second clic programme pendant la requete ne doit pas produire un second POST.
  await page.evaluate(() => {
    const button = document.querySelector('[data-coach-id="devis-accept-confirm"]');
    if (button) button.click();
  });
  await page.getByText(/Devis accepté/).waitFor({ state: "visible", timeout: 15_000 });
  const accepts = state.requests.filter((item) => item.method === "POST" && item.path === "/api/quotes/quote-open/accept");
  assert.equal(accepts.length, 1, "Une seule acceptation doit etre envoyee.");
  summary.interactions.quoteAccept = accepts.length;

  // Devis expire : aucune decision, lien de contact.
  await open(page, EXPIRED_QUOTE, '[data-testid="client-quote-expired"]');
  assert.equal(await page.locator('[data-testid="client-quote-decision"]').count(), 0);
  assert.equal(await page.getByRole("link", { name: /Demander une nouvelle proposition/ }).count(), 1);

  // Factures : solde, facture reglee, consigne sans inventer de RIB.
  await open(page, INVOICES, '[data-testid="client-payment-help"]');
  assert.match(await page.locator("body").textContent(), /Solde restant/);
  assert.equal(await page.locator('[data-testid="client-invoice-paid"]').count(), 1);
  assert.match(await page.locator('[data-testid="client-payment-help"]').textContent(), /Demander les modalités de paiement/);

  // Modification : reponse lisible, supplément, pas de faux bouton d'acceptation.
  await open(page, MODIFICATIONS, '[data-testid="client-modification-advice"]');
  assert.match(await page.locator('[data-testid="mod-approved"], [data-status="APPROVED"]').first().textContent(), /Supplément proposé/);
  assert.match(await page.locator("body").textContent(), /validation en ligne .* pas encore disponible/i);
  assert.equal(await page.getByRole("button", { name: /Accepter le supplément/i }).count(), 0);
  assert.equal(await page.locator('[data-testid="client-modification-contact"]').count() >= 1, true);

  // Isolation : un identifiant d'un autre client ne renvoie aucune donnee.
  await open(page, OTHER_PROJECT, "text=Retour à mon espace", 15_000);
  assert.match(await page.locator("body").textContent(), /introuvable|Ressource introuvable|Projet introuvable/i);
  assert.doesNotMatch(await page.locator("body").textContent(), /Site confidentiel B/);
  const crossClient = await page.evaluate(async () => {
    const project = await fetch("/api/projects/project-client-b");
    const quoteResponse = await fetch("/api/quotes/quote-client-b");
    const documentResponse = await fetch("/api/documents/doc-internal/content");
    return {
      statuses: [project.status, quoteResponse.status, documentResponse.status],
      bodies: [await project.text(), await quoteResponse.text(), await documentResponse.text()].join(" "),
    };
  });
  assert.deepEqual(crossClient.statuses, [404, 404, 404]);
  assert.doesNotMatch(crossClient.bodies, /Site confidentiel B|NOTE-INTERNE/);
  summary.interactions.crossClientStatuses = crossClient.statuses;
  await context.close();

  // Etats vide et erreur.
  for (const [name, options] of [["empty", { empty: true }], ["error", { error: true }]]) {
    const stateContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fr-FR", timezoneId: "Africa/Algiers", reducedMotion: "reduce" });
    await installMockApi(stateContext, options);
    const statePage = await preparePage(stateContext, summary, name);
    await open(statePage, HOME, '[data-testid="client-focus-board"]');
    if (name === "empty") {
      await statePage.getByText("Rien ne demande votre intervention pour le moment.").waitFor({ state: "visible", timeout: 15_000 });
      summary.states.empty = "aucune action, aucun compteur trompeur";
    } else {
      await statePage.getByText(/Certaines informations ne sont pas disponibles/).waitFor({ state: "visible", timeout: 15_000 });
      summary.states.error = "erreurs API visibles, autres sections conservées";
    }
    assertMetrics(await measure(statePage), `${name} 390px`);
    await stateContext.close();
  }

  assert.deepEqual(summary.errors, [], `Erreurs navigateur : ${summary.errors.join(" | ")}`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
