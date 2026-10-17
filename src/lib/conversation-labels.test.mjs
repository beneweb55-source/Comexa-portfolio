import assert from "node:assert/strict";
import test from "node:test";
import { conversationTitle, isGroupConversation, participantName } from "./conversation-labels.js";

/*
 * Libelles des conversations — l'API ne renvoie ni `isGroup` ni `groupName` :
 * elle donne un `type` et les participants. Ces tests verrouillent la
 * traduction, parce que c'est elle qui decide de ce que la liste affiche.
 */

const participant = (userId, firstName, lastName, email) => ({
  userId,
  firstName,
  lastName,
  email,
});

test("le nom d'un participant prefere le nom complet", () => {
  assert.equal(participantName(participant("1", "Nadia", "Benali", "nadia@comexa.dz")), "Nadia Benali");
  assert.equal(participantName(participant("2", "", "", "leo@comexa.dz")), "leo@comexa.dz");
  assert.equal(participantName(null), "");
});

test("une conversation est collective selon son type ou son nombre de participants", () => {
  assert.equal(isGroupConversation({ type: "DIRECT", participants: [participant("1"), participant("2")] }), false);
  assert.equal(isGroupConversation({ type: "PROJECT", participants: [participant("1")] }), true);
  assert.equal(isGroupConversation({ type: "DIRECT", participants: [participant("1"), participant("2"), participant("3")] }), true);
  assert.equal(isGroupConversation(null), false);
});

test("le sujet gagne toujours", () => {
  const conversation = {
    type: "DIRECT",
    subject: "Refonte du site",
    participants: [participant("1", "Nadia", "Benali", "nadia@comexa.dz")],
  };
  assert.equal(conversationTitle(conversation, "2"), "Refonte du site");
});

test("sans sujet, la conversation porte le nom de l'interlocuteur", () => {
  const conversation = {
    type: "DIRECT",
    participants: [
      participant("1", "Nadia", "Benali", "nadia@comexa.dz"),
      participant("2", "Me", "Moi", "me@comexa.dz"),
    ],
  };
  assert.equal(conversationTitle(conversation, "2"), "Nadia Benali");
});

test("a plusieurs interlocuteurs, le titre les resume", () => {
  const conversation = {
    type: "DIRECT",
    participants: [
      participant("1", "Nadia", "Benali", "nadia@comexa.dz"),
      participant("2", "Me", "Moi", "me@comexa.dz"),
      participant("3", "Léo", "Mansouri", "leo@comexa.dz"),
    ],
  };
  assert.equal(conversationTitle(conversation, "2"), "Nadia Benali et 1 autre");
});

test("une conversation sans interlocuteur porte un titre neutre", () => {
  assert.equal(conversationTitle({ type: "DIRECT", participants: [] }, "2"), "Sans sujet");
  assert.equal(conversationTitle(null, "2"), "");
});
