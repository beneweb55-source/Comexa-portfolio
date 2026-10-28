/**
 * Mission 4 — Espace client : tests purs et contrat d'ecran.
 *
 * `COMEXA_TEST_SOURCE_ROOT` permet de rejouer les contrats sur les fichiers de
 * HEAD : l'ancien `DataView` et l'absence de recit projet doivent echouer.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildClientFocus,
  buildProjectStory,
  clientModificationAdvice,
  invoiceRemaining,
  isClientQuoteDecisionable,
} from "../src/lib/client-portal.mjs";
import { resolveNotificationHref } from "../src/lib/notification-links.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = process.env.COMEXA_TEST_SOURCE_ROOT ?? REPO_ROOT;
const NOW = Date.parse("2026-10-28T10:00:00.000Z");

function isoDay(offset = 0) {
  const date = new Date(NOW);
  date.setUTCDate(date.getUTCDate() + offset);
  return `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

async function source(relativePath) {
  return readFile(join(SOURCE_ROOT, relativePath), "utf8");
}

const clientAQuote = {
  id: "quote-open",
  reference: "D-101",
  subject: "Refonte du site",
  status: "SENT",
  total: "180000",
  currency: "DZD",
  validUntil: isoDay(1),
};
const clientBQuote = {
  id: "quote-other-client",
  reference: "D-999",
  subject: "Dossier d'un autre client",
  status: "SENT",
  total: "990000",
  currency: "DZD",
  validUntil: isoDay(1),
};

test("Accueil client : seuls les devis SENT/VIEWED sont decidables", () => {
  assert.equal(isClientQuoteDecisionable(clientAQuote), true);
  assert.equal(isClientQuoteDecisionable({ ...clientAQuote, status: "EXPIRED" }), false);
  assert.equal(isClientQuoteDecisionable({ ...clientAQuote, status: "DRAFT" }), false);
  assert.equal(isClientQuoteDecisionable({ ...clientAQuote, status: "ACCEPTED" }), false);
});

test("Accueil client : un devis expire et une facture reglee ne creent aucune action", () => {
  const model = buildClientFocus({
    quotes: [
      { ...clientAQuote, status: "EXPIRED" },
      { ...clientAQuote, id: "quote-paid-decision", status: "ACCEPTED" },
    ],
    invoices: [
      { id: "inv-paid", reference: "F-1", status: "PAID", total: "1000", amountPaid: "1000", currency: "DZD" },
      { id: "inv-cancelled", reference: "F-2", status: "CANCELLED", total: "500", amountPaid: "0", currency: "DZD" },
    ],
    modifications: [],
    conversations: [],
    projects: [],
    now: NOW,
  });
  assert.equal(model.actions.length, 0);
  assert.equal(model.invoices.payable.length, 0);
  assert.equal(model.invoices.paidCount, 2);
  assert.equal(invoiceRemaining({ total: "100", amountPaid: "250" }), 0);
});

test("Accueil client : actions priorisees, sans repetition ni donnee interne", () => {
  const model = buildClientFocus({
    quotes: [
      clientAQuote,
      { ...clientAQuote, id: "quote-later", reference: "D-102", status: "VIEWED", validUntil: isoDay(3) },
    ],
    invoices: [
      { id: "inv-open", reference: "F-3", status: "SENT", total: "1000", amountPaid: "250", currency: "DZD", dueDate: isoDay(2) },
    ],
    modifications: [
      { id: "mod-approved", reference: "M-1", title: "Ajouter une page", status: "APPROVED", extraCost: "25000", extraCostCurrency: "DZD", decidedAt: isoDay(-1), decisionNote: "Supplément proposé" },
      { id: "mod-submitted", reference: "M-2", title: "Changer une couleur", status: "SUBMITTED" },
    ],
    conversations: [{ id: "conv-1", unreadCount: 2 }],
    projects: [
      { id: "project-a", name: "Site web", reference: "PRJ-1", status: "IN_PROGRESS", progressPercent: 45, dueDate: isoDay(10) },
    ],
    milestonesByProject: {
      "project-a": [
        { id: "m1", title: "Cadrage", status: "REACHED", dueDate: isoDay(-5), reachedAt: isoDay(-4), order: 1 },
        { id: "m2", title: "Maquette", status: "IN_PROGRESS", dueDate: isoDay(2), order: 2 },
        { id: "m3", title: "Recette", status: "PENDING", dueDate: isoDay(8), order: 3 },
      ],
    },
    unreadNotifications: 1,
    now: NOW,
  });

  assert.deepEqual(model.actions.map((action) => action.category), ["quote", "quote", "invoice", "message", "notification"]);
  assert.equal(model.invoices.payable[0].remaining, 750);
  assert.equal(model.invoices.totalsByCurrency[0].total, 750);
  assert.equal(model.exchanges.unreadMessages, 2);
  assert.equal(model.exchanges.decidedModificationCount, 1, "Une demande deja traitee n'est pas une action en attente.");
  assert.equal(model.projects[0].nextStep.title, "Maquette");
  assert.equal(model.projects[0].statusExplanation.includes("travaille"), true);
  const serialized = JSON.stringify(model);
  for (const forbidden of ["budget", "cost", "margin", "timeEntries", "internalNote", "quote-other-client"]) {
    assert.equal(serialized.includes(forbidden), false, `Aucune donnee interne ou d'un autre client : ${forbidden}`);
  }
});

test("Accueil client : une donnee absente n'est pas presentee comme zero", () => {
  const model = buildClientFocus({ quotes: null, invoices: null, modifications: null, conversations: null, projects: null, now: NOW });
  assert.deepEqual(model.unknown, ["quotes", "invoices", "modifications", "conversations", "projects"]);
  assert.equal(model.actions.length, 0);
  assert.equal(model.hasAnyData, false);
  assert.equal(model.invoices.payable.length, 0);
});

test("Recit projet : statut explique, etape en cours, aucune responsabilite inventee", () => {
  const story = buildProjectStory(
    { id: "p1", name: "Refonte", status: "ON_HOLD", progressPercent: 60, dueDate: isoDay(12) },
    [
      { id: "a", title: "Cadrage", status: "REACHED", dueDate: isoDay(-10), reachedAt: isoDay(-9), order: 1 },
      { id: "b", title: "Attente elements", status: "IN_PROGRESS", dueDate: isoDay(3), order: 2 },
      { id: "c", title: "Livraison", status: "PENDING", dueDate: isoDay(12), order: 3 },
    ],
    NOW,
  );
  assert.equal(story.statusLabel, "En pause");
  assert.match(story.statusExplanation, /en pause/i);
  assert.doesNotMatch(story.statusExplanation, /votre faute|client responsable|bloqué par vous/i);
  assert.equal(story.completedCount, 1);
  assert.equal(story.nextStep.title, "Attente elements");
  assert.equal(story.nextStep.isCurrent, true);
  assert.deepEqual(story.timeline.map((step) => step.status), ["REACHED", "IN_PROGRESS", "PENDING"]);
});

test("Recit projet : sans jalon, aucune date ni tache n'est inventee", () => {
  const story = buildProjectStory({ status: "PLANNED", progressPercent: 0 }, [], NOW);
  assert.equal(story.nextStep, null);
  assert.equal(story.timeline.length, 0);
  assert.equal(story.totalCount, 0);
  assert.match(story.statusExplanation, /planifié/i);
});

test("Modification : le supplement propose est explique sans faux bouton de validation", () => {
  const advice = clientModificationAdvice({
    status: "APPROVED",
    extraCost: "25000",
    extraCostCurrency: "DZD",
    decidedAt: isoDay(-1),
    decisionNote: "Ajout de deux pages",
  }, NOW);
  assert.equal(advice.extraCost, 25000);
  assert.equal(advice.needsContact, true);
  assert.match(advice.body, /validation en ligne .* pas encore disponible/i);
  assert.doesNotMatch(advice.body, /cliquez sur accepter/i);
  assert.equal(clientModificationAdvice({ status: "DONE" }, NOW).needsContact, false);
});

test("Lien profond : une notification facture ouvre la liste des factures client", () => {
  assert.equal(resolveNotificationHref("/factures/F-2026-1", "client"), "/espace-client/factures");
  assert.equal(resolveNotificationHref("/devis/quote-open", "client"), "/espace-client/devis/quote-open");
});

test("Contrat ecran : l'accueil client remplace DataView par des actions reelles", async () => {
  const home = await source("src/app/(session)/espace-client/page.jsx");
  const dashboard = await source("src/app/(session)/espace-client/tableau-de-bord/page.jsx");
  assert.match(home, /ClientFocusBoard/, "L'accueil doit utiliser le tableau d'actions client.");
  assert.match(dashboard, /ClientFocusBoard/);
  assert.doesNotMatch(dashboard, /<DataView|components\/workspace\/DataView/, "Le tableau de bord client ne doit plus afficher des cles JSON generiques.");
});

test("Contrat ecran : projet, devis, factures et modifications expliquent la situation", async () => {
  const project = await source("src/app/(session)/espace-client/projets/[id]/page.jsx");
  const quote = await source("src/app/(session)/espace-client/devis/[id]/page.jsx");
  const invoices = await source("src/app/(session)/espace-client/factures/page.jsx");
  const modifications = await source("src/app/(session)/espace-client/modifications/page.jsx");
  const css = await source("src/styles/softui.productivity.css");
  assert.match(project, /ClientProjectStory/);
  assert.match(quote, /client-quote-expiry-banner/);
  assert.match(quote, /client-quote-expired/);
  assert.match(invoices, /client-payment-help/);
  assert.match(invoices, /client-invoice-paid/);
  assert.match(modifications, /client-modification-advice/);
  assert.match(css, /\.client-focus\s*\{/);
  assert.match(css, /min-height:\s*44px/);
  assert.doesNotMatch(project, /\/activities/, "Aucune route d'activite interne n'est appelee sans permission.");
  assert.doesNotMatch(project, /time-entries|budget|margin/i);
});

test("Contrat technique : le test responsive client et le script existent", async () => {
  const packageJson = await source("package.json");
  assert.match(packageJson, /test:responsive:client/);
});
