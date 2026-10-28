/**
 * Mission 6 — cohérence transversale des notifications.
 *
 * Ces tests décrivent les défauts confirmés dans le code courant :
 *  - `SYSTEM` était classé dans Comexa Space alors que tous ses producteurs
 *    décrivent des événements de l'Espace équipe ;
 *  - `/prospects/:id` n'avait aucune route de notification dans l'Espace équipe ;
 *  - `notifyMany()` relisait les lignes par type+titre+entityId et pouvait
 *    publier en temps réel une ANCIENNE notification non lue à la place de la
 *    nouvelle (cas réel : plusieurs messages dans la même conversation) ;
 *  - la boîte de réception doit continuer à filtrer par porteur et par espace.
 *
 * Aucune base PostgreSQL : faux Prisma, vraies décisions des services.
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preparePrismaStubs } from "./helpers/prisma-stubs.mjs";

preparePrismaStubs();

const { resolveNotificationHref, notificationsPageFor } = await import("../../src/lib/notification-links.js");
const { NOTIFICATION_TYPES_BY_SPACE, spaceOfNotificationType } = await import("../src/common/spaces/space-policy.ts");
const { AccessPolicy } = await import("../src/common/auth/principal.ts");
const { NotificationService, NOTIFICATION_CREATED } = await import("../src/modules/notifications/notification.service.ts");
const { NotificationInboxService } = await import("../src/modules/notifications/notification-inbox.service.ts");

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.resolve(backendRoot, "..");
const routeFile = (relative) => path.join(frontendRoot, "src", "app", "(session)", relative);

const FIXED_TIME = new Date("2026-10-28T10:00:00.000Z");

/**
 * Liens réellement écrits par les producteurs backend, avec l'espace où le
 * destinataire interne ou client les consulte. Les cas `client` n'ont pas
 * d'en-tête X-Comexa-Space : la boîte n'est pas filtrée côté serveur.
 */
const PRODUCER_LINKS = [
  { link: "/taches/t1", type: "TASK_ASSIGNED", area: "personal", expected: "/espace-personnel/taches?tache=t1" },
  { link: "/taches/t1", type: "TASK_COMPLETED", area: "team", expected: "/espace-equipe/taches?tache=t1" },
  { link: "/projets/p1", type: "PROJECT_STATUS_CHANGED", area: "team", expected: "/espace-equipe/projets/p1" },
  { link: "/projets/p1", type: "MILESTONE_REACHED", area: "team", expected: "/espace-equipe/projets/p1" },
  { link: "/projets/p1", type: "SYSTEM", area: "team", expected: "/espace-equipe/projets/p1" },
  { link: "/prospects/pr1", type: "SYSTEM", area: "team", expected: "/espace-equipe/prospects/pr1" },
  { link: "/clients/c1", type: "SYSTEM", area: "team", expected: "/espace-equipe/clients/c1" },
  { link: "/admin/demandes/cr1", type: "CONTACT_REQUEST_RECEIVED", area: "team", expected: "/espace-equipe/demandes" },
  { link: "/admin/projets/p1", type: "MODIFICATION_REQUESTED", area: "team", expected: "/espace-equipe/projets/p1" },
  { link: "/devis/q1", type: "QUOTE_SENT", area: "team", expected: "/espace-equipe/devis/q1" },
  { link: "/factures/i1", type: "INVOICE_ISSUED", area: "team", expected: "/espace-equipe/factures/i1" },
  { link: "/espace/messages/c1", type: "MESSAGE_RECEIVED", area: "team", expected: "/espace-equipe/messagerie" },
  { link: "/devis/q1", type: "QUOTE_SENT", area: "client", expected: "/espace-client/devis/q1" },
  { link: "/factures/i1", type: "INVOICE_ISSUED", area: "client", expected: "/espace-client/factures" },
  { link: "/projets/p1", type: "SYSTEM", area: "client", expected: "/espace-client/projets/p1" },
  { link: "/espace/demandes/m1", type: "SYSTEM", area: "client", expected: "/espace-client/modifications" },
  { link: "/espace/messages/c1", type: "MESSAGE_RECEIVED", area: "client", expected: "/espace-client/messagerie" },
];

const REQUIRED_ROUTE_FILES = [
  "espace-personnel/taches/page.jsx",
  "espace-equipe/taches/page.jsx",
  "espace-equipe/projets/[id]/page.jsx",
  "espace-equipe/prospects/[id]/page.jsx",
  "espace-equipe/prospects/page.jsx",
  "espace-equipe/clients/[id]/page.jsx",
  "espace-equipe/demandes/page.jsx",
  "espace-equipe/devis/[id]/page.jsx",
  "espace-equipe/factures/[id]/page.jsx",
  "espace-equipe/messagerie/page.jsx",
  "espace-client/devis/[id]/page.jsx",
  "espace-client/factures/page.jsx",
  "espace-client/projets/[id]/page.jsx",
  "espace-client/modifications/page.jsx",
  "espace-client/messagerie/page.jsx",
];

function rowMatches(row, where) {
  for (const [key, value] of Object.entries(where ?? {})) {
    if (key === "userId" && value?.in) {
      if (!value.in.includes(row.userId)) return false;
      continue;
    }
    if (value === null) {
      if (row[key] !== null) return false;
      continue;
    }
    if (value && typeof value === "object" && "in" in value) {
      if (!value.in.includes(row[key])) return false;
      continue;
    }
    if (row[key] !== value) return false;
  }
  return true;
}

/** Faux Prisma qui simule le piège de la relecture `createMany` + `findMany`. */
function makeNotifyManyHarness() {
  const rows = [{
    // Trié avant les lignes créées quand createdAt est identique : reproduit le
    // cas réel où PostgreSQL peut renvoyer une ancienne notification non lue.
    id: "a-old-unread",
    userId: "u1",
    type: "MESSAGE_RECEIVED",
    title: "Nouveau message",
    body: "ancien",
    link: "/espace/messages/c1",
    entityType: "Conversation",
    entityId: "c1",
    readAt: null,
    createdAt: FIXED_TIME,
  }];
  const published = [];
  const state = { sequence: 0, createManyCalls: 0, findManyCalls: 0 };

  const notification = {
    create: async ({ data }) => {
      const row = { id: `new-${++state.sequence}`, ...data, readAt: null, createdAt: FIXED_TIME };
      rows.push(row);
      return row;
    },
    createMany: async ({ data }) => {
      state.createManyCalls += 1;
      for (const item of data) {
        rows.push({ id: `batch-${++state.sequence}`, ...item, readAt: null, createdAt: FIXED_TIME });
      }
      return { count: data.length };
    },
    findMany: async ({ where, take }) => {
      state.findManyCalls += 1;
      return rows
        .filter((row) => rowMatches(row, where))
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id))
        .slice(0, take ?? rows.length);
    },
  };
  const tx = { notification };
  const prisma = {
    notification,
    $transaction: async (argument) => (typeof argument === "function" ? argument(tx) : Promise.all(argument)),
  };
  const events = { emit: (name, payload) => published.push({ name, payload }) };
  return { service: new NotificationService(prisma, events), tx, published, state };
}

const MESSAGE_INPUT = {
  type: "MESSAGE_RECEIVED",
  title: "Nouveau message",
  body: "nouveau",
  link: "/espace/messages/c1",
  entityType: "Conversation",
  entityId: "c1",
};

function makeInboxHarness({ owned = true } = {}) {
  const seen = { list: [], readAll: null, read: [], remove: null, summary: null };
  const row = {
    id: "n1",
    userId: "u1",
    type: "SYSTEM",
    title: "Tâche modifiée",
    body: null,
    link: "/taches/t1",
    entityType: "Task",
    entityId: "t1",
    readAt: null,
    createdAt: FIXED_TIME,
  };
  const notification = {
    findMany: async ({ where }) => {
      seen.list.push(where);
      return [];
    },
    count: async () => 0,
    updateMany: async ({ where }) => {
      if (seen.readAll === null) seen.readAll = where;
      else seen.read.push(where);
      return { count: 1 };
    },
    findFirst: async ({ where }) => {
      seen.read.push(where);
      return owned && where.userId === "u1" ? row : null;
    },
    deleteMany: async ({ where }) => {
      seen.remove = where;
      return { count: owned ? 1 : 0 };
    },
    groupBy: async ({ where }) => {
      seen.summary = where;
      return [{ type: "SYSTEM", _count: { _all: 2 } }];
    },
  };
  const prisma = {
    notification,
    $transaction: async (argument) => (typeof argument === "function" ? argument({ notification }) : Promise.all(argument)),
  };
  return { service: new NotificationInboxService(prisma), seen };
}

const policyFor = (space = "team") => new AccessPolicy({
  id: "u1",
  email: "membre@comexa.test",
  firstName: "Lina",
  lastName: "Membre",
  roles: [],
  permissions: new Set(["notification:read:own", "notification:manage:own"]),
  clientId: null,
  mustChangePassword: false,
  space,
});

test("Espaces : les notifications SYSTEM métier appartiennent à l'Espace équipe", () => {
  assert.equal(spaceOfNotificationType("SYSTEM"), "team");
  assert.equal(NOTIFICATION_TYPES_BY_SPACE.comexa.includes("SYSTEM"), false);
  assert.equal(NOTIFICATION_TYPES_BY_SPACE.team.includes("SYSTEM"), true);
  assert.equal(spaceOfNotificationType("TASK_ASSIGNED"), "personal");
  assert.equal(spaceOfNotificationType("TYPE_FUTUR_INCONNU"), "team");
  for (const { type, area } of PRODUCER_LINKS.filter((item) => item.area !== "client")) {
    assert.equal(spaceOfNotificationType(type), area, `${type} doit être classé dans ${area}`);
  }
});

test("Liens : chaque lien producteur ouvre une vraie rubrique, pas la page Notifications", () => {
  for (const { link, area, expected } of PRODUCER_LINKS) {
    const href = resolveNotificationHref(link, area);
    assert.equal(href, expected, `${link} dans ${area}`);
    assert.notEqual(href, notificationsPageFor(area), `${link} ne doit pas retomber sur la boîte`);
  }
  for (const relative of REQUIRED_ROUTE_FILES) {
    assert.equal(existsSync(routeFile(relative)), true, `Route Next manquante : ${relative}`);
  }
});

test("Temps réel : notifyMany publie les lignes créées, pas une ancienne non lue", async () => {
  const harness = makeNotifyManyHarness();
  const created = await harness.service.notifyMany(["u1", "u2", "u1"], MESSAGE_INPUT);
  assert.deepEqual(created.map((row) => row.id), ["new-1", "new-2"]);
  assert.equal(created.every((row) => row.body === "nouveau"), true);
  assert.deepEqual(harness.published.map((event) => event.payload.notification.id), ["new-1", "new-2"]);
  assert.equal(harness.published.every((event) => event.payload.notification.body === "nouveau"), true);
  assert.equal(harness.published.every((event) => event.name === NOTIFICATION_CREATED), true);
  assert.equal(harness.state.createManyCalls, 0, "La relecture createMany est supprimée.");
  assert.equal(harness.state.findManyCalls, 0, "Aucune relecture ambiguë ne doit rester.");
});

test("Temps réel : notifyMany dans une transaction existante publie aussi les bonnes lignes", async () => {
  const harness = makeNotifyManyHarness();
  const created = await harness.service.notifyMany(["u1"], MESSAGE_INPUT, harness.tx);
  assert.deepEqual(created.map((row) => row.id), ["new-1"]);
  assert.deepEqual(harness.published.map((event) => event.payload.notification.id), ["new-1"]);
});

test("Boîte : liste, lecture globale et résumé restent filtrés par porteur et espace", async () => {
  const harness = makeInboxHarness();
  const policy = policyFor("team");
  await harness.service.list(policy, { page: 1, perPage: 30 });
  assert.equal(harness.seen.list[0].userId, "u1");
  assert.equal(harness.seen.list[0].type.in.includes("SYSTEM"), true);

  const readAll = await harness.service.markAllRead(policy);
  assert.deepEqual(readAll, { updated: 1 });
  assert.equal(harness.seen.readAll.userId, "u1");
  assert.equal(harness.seen.readAll.readAt, null);
  assert.equal(harness.seen.readAll.type.in.includes("SYSTEM"), true);

  const summary = await harness.service.summary(policy);
  assert.equal(summary.unread, 2);
  assert.equal(summary.unreadBySpace.team, 2);
  assert.equal(summary.unreadBySpace.comexa, 0);
  assert.equal(harness.seen.summary.userId, "u1");
});

test("Boîte : lecture/suppression d'une notification d'autrui reste impossible", async () => {
  const harness = makeInboxHarness({ owned: false });
  const policy = policyFor("team");
  await assert.rejects(
    harness.service.markRead(policy, "n-autrui"),
    (error) => error?.code === "NOTIFICATION_NOT_FOUND",
  );
  await assert.rejects(
    harness.service.remove(policy, "n-autrui"),
    (error) => error?.code === "NOTIFICATION_NOT_FOUND",
  );
  assert.ok(harness.seen.read.every((where) => where.userId === "u1"));
  assert.equal(harness.seen.remove.userId, "u1");
});
