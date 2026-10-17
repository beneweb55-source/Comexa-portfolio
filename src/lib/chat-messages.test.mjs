import assert from "node:assert/strict";
import test from "node:test";
import { appendUnique, messagesFromPage } from "./chat-messages.js";

/*
 * Messages d'une conversation — l'ordre de lecture et la deduplication.
 * Ces deux regles ont ete cassees en meme temps que la messagerie (bulle en
 * double, messages a l'envers) : elles sont donc verifiees ici.
 */

/** Une page d'API : l'enveloppe du backend, `data` + `meta` de curseur. */
const page = (rows, meta = {}) => ({ data: rows, meta });

test("la page est lue du plus ancien au plus recent", () => {
  const messages = messagesFromPage(page([{ id: "3" }, { id: "2" }, { id: "1" }]));
  assert.deepEqual(messages.map((m) => m.id), ["1", "2", "3"]);
});

test("la page de la reponse n'est pas modifiee", () => {
  const rows = [{ id: "2" }, { id: "1" }];
  messagesFromPage(page(rows));
  assert.deepEqual(rows.map((m) => m.id), ["2", "1"]);
});

test("une reponse inattendue ne casse pas l'affichage", () => {
  assert.deepEqual(messagesFromPage({}), []);
  assert.deepEqual(messagesFromPage(null), []);
  assert.deepEqual(messagesFromPage(page(null)), []);
});

test("un message deja present n'est pas ajoute deux fois", () => {
  const messages = [{ id: "1", body: "bonjour" }];
  const result = appendUnique(messages, { id: "1", body: "bonjour" });
  assert.equal(result.length, 1);
  assert.equal(result, messages, "la liste doit rester la meme quand rien ne change");
});

test("un message nouveau est ajoute a la fin", () => {
  const result = appendUnique([{ id: "1" }], { id: "2" });
  assert.deepEqual(result.map((m) => m.id), ["1", "2"]);
});

test("un message sans identifiant n'est pas ajoute", () => {
  const messages = [{ id: "1" }];
  assert.equal(appendUnique(messages, { body: "sans id" }), messages);
});
