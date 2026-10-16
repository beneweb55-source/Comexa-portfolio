import assert from "node:assert/strict";
import test from "node:test";
import { notificationsPageFor, resolveNotificationHref } from "./notification-links.js";

test("les liens du serveur deviennent des pages réelles de l'espace équipe", () => {
  assert.equal(resolveNotificationHref("/factures/inv_1", "team"), "/espace-equipe/factures/inv_1");
  assert.equal(resolveNotificationHref("/devis/q_1", "team"), "/espace-equipe/devis/q_1");
  assert.equal(resolveNotificationHref("/projets/p_1", "team"), "/espace-equipe/projets/p_1");
  assert.equal(resolveNotificationHref("/admin/projets/p_2", "team"), "/espace-equipe/projets/p_2");
  assert.equal(resolveNotificationHref("/clients/c_1", "team"), "/espace-equipe/clients/c_1");
  assert.equal(resolveNotificationHref("/taches/t_1", "team"), "/espace-equipe/taches");
  assert.equal(resolveNotificationHref("/espace/messages/conv_1", "team"), "/espace-equipe/messagerie");
  assert.equal(resolveNotificationHref("/espace/demandes/m_1", "team"), "/espace-equipe/modifications");
  assert.equal(resolveNotificationHref("/admin/demandes/r_1", "team"), "/espace-equipe/demandes");
});

test("chaque espace garde ses propres destinations", () => {
  assert.equal(resolveNotificationHref("/taches/t_1", "personal"), "/espace-personnel/taches");
  assert.equal(resolveNotificationHref("/factures/inv_1", "personal"), "/espace-personnel/notifications");
  assert.equal(resolveNotificationHref("/admin/projets/p_1", "comexa"), "/espace-comexa/notifications");
  assert.equal(resolveNotificationHref("/devis/q_1", "client"), "/espace-client/devis/q_1");
  assert.equal(resolveNotificationHref("/factures/inv_1", "client"), "/espace-client/tableau-de-bord");
  assert.equal(resolveNotificationHref("/espace/messages/conv_1", false), "/espace-client/messagerie");
});

test("liens absents, externes ou déjà front", () => {
  assert.equal(resolveNotificationHref(null, "team"), "/espace-equipe/notifications");
  assert.equal(resolveNotificationHref("https://exemple.test/x", "team"), "/espace-equipe/notifications");
  assert.equal(resolveNotificationHref("//exemple.test/x", "team"), "/espace-equipe/notifications");
  assert.equal(resolveNotificationHref("/inconnu/1", "team"), "/espace-equipe/notifications");
  assert.equal(resolveNotificationHref("/espace-equipe/factures/inv_1", "team"), "/espace-equipe/factures/inv_1");
  assert.equal(notificationsPageFor(true), "/espace-equipe/notifications");
});
