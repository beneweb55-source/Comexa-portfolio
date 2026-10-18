import test from "node:test";
import assert from "node:assert/strict";

import { conversationMatches, foldText, highlightParts } from "./chat-search.mjs";

/*
 * REGLES DE RECHERCHE DE LA MESSAGERIE — testees sans navigateur, sans DOM,
 * sans API. Ce sont elles qui decident de ce qui « correspond » et de la facon
 * dont le texte est decoupe pour le surlignage ; le composant ne fait que les
 * appliquer.
 */

test("foldText normalise casse et blancs, pas les accents", () => {
  assert.equal(foldText("  ÉChéance  "), "échéance");
  assert.equal(foldText("TODO"), "todo");
  assert.equal(foldText(null), "");
});

test("conversationMatches est insensible a la casse", () => {
  const conversation = { subject: "Refonte VITRINE", participants: [] };
  assert.equal(conversationMatches(conversation, "vitrine"), true);
  assert.equal(conversationMatches(conversation, "REFONTE"), true);
});

test("conversationMatches respecte les accents", () => {
  const conversation = { subject: "Échéance client Dupont", participants: [] };
  assert.equal(conversationMatches(conversation, "échéance"), true);
  // « cureur » ne doit pas trouver « curseur » : pas de transliteration.
  const avecAccent = { subject: "Curseur marketing", participants: [] };
  assert.equal(conversationMatches(avecAccent, "curseur"), true);
  assert.equal(conversationMatches({ subject: "Écurie", participants: [] }, "ecurie"), false);
});

test("conversationMatches balaie participants et apercu", () => {
  const conversation = {
    subject: null,
    lastMessagePreview: "Je pousse la facture 2026-14 demain",
    participants: [{ firstName: "Nadia", lastName: "Belkacem", email: "nadia@agence.fr" }],
  };
  assert.equal(conversationMatches(conversation, "nadia"), true);
  assert.equal(conversationMatches(conversation, "belkacem nadia"), true);
  assert.equal(conversationMatches(conversation, "nadia@agence.fr"), true);
  assert.equal(conversationMatches(conversation, "facture 2026-14"), true);
  assert.equal(conversationMatches(conversation, "karim"), false);
});

test("terme vide = tout passe ; conversation vide = rien ne fauxse", () => {
  assert.equal(conversationMatches({ subject: "X", participants: [] }, "   "), true);
  assert.equal(conversationMatches(null, "x"), false);
  assert.equal(conversationMatches({}, "x"), false);
});

test("highlightParts encadre chaque correspondance, dans l'ordre", () => {
  assert.deepEqual(highlightParts("Factorie Factoriel", "facto"), [
    { text: "Facto", hit: true },
    { text: "rie ", hit: false },
    { text: "Facto", hit: true },
    { text: "riel", hit: false },
  ]);
});

test("highlightParts sans terme = un seul bloc, sans frime", () => {
  assert.deepEqual(highlightParts("Rien à surligner", "  "), [{ text: "Rien à surligner", hit: false }]);
  assert.deepEqual(highlightParts("", "abc"), [{ text: "", hit: false }]);
});

test("highlightParts ne depasse jamais le texte : la somme des morceaux est exacte", () => {
  const source = "Devis DEVIS devis pour devis";
  const parts = highlightParts(source, "devis");
  assert.equal(parts.map((part) => part.text).join(""), source);
  assert.equal(parts.filter((part) => part.hit).length, 4);
});

test("highlightParts echappe par structure : du HTML reste du texte", () => {
  const parts = highlightParts('<img onerror="alert(1)">', "img");
  assert.equal(parts.map((p) => p.text).join(""), '<img onerror="alert(1)">');
  assert.ok(parts.every((p) => typeof p.text === "string"));
});
