/**
 * GUIDE DE DÉMARRAGE — fonctions d'affichage (node --test, sans navigateur).
 *
 * Le bug qui a coûté une session entière (« ÉTAPE NAN SUR 5 ») venait d'un
 * calcul d'index fait dans le composant, à partir d'une session absente. Ces
 * règles vivent maintenant dans un module pur, et c'est ici qu'on vérifie
 * qu'elles ne peuvent plus produire `NaN`, ni « 0 sur 0 », ni une URL de guide
 * hors espace de travail.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  guideHrefFor,
  nextStep,
  progressLabel,
  spaceOfPathname,
  spotlightSelector,
  stepPosition,
} from "../src/lib/guide/guide-format.mjs";

const STEPS = [
  { id: "personal:premiere-tache", done: true },
  { id: "personal:faire-avancer", done: false },
  { id: "personal:chronometrer", done: false },
];

describe("prochaine étape", () => {
  it("prend la première non faite", () => {
    assert.equal(nextStep(STEPS)?.id, "personal:faire-avancer");
  });

  it("retombe sur la dernière quand tout est fait (jamais `null` sans liste vide)", () => {
    const all = STEPS.map((step) => ({ ...step, done: true }));
    assert.equal(nextStep(all)?.id, "personal:chronometrer");
  });

  it("accepte une liste vide ou absente sans lever", () => {
    assert.equal(nextStep([]), null);
    assert.equal(nextStep(undefined), null);
    assert.equal(nextStep([null]), null);
  });
});

describe("rang d’une étape", () => {
  it("compte à partir de 1", () => {
    assert.equal(stepPosition(STEPS, "personal:premiere-tache"), 1);
    assert.equal(stepPosition(STEPS, "personal:chronometrer"), 3);
  });

  it("renvoie 0 pour une étape inconnue — l’écran affiche alors le total, pas « NaN »", () => {
    assert.equal(stepPosition(STEPS, "inconnue"), 0);
    assert.equal(stepPosition(undefined, "personal:premiere-tache"), 0);
  });
});

describe("libellé de progression", () => {
  it("reste lisible avec des valeurs absurdes", () => {
    assert.equal(progressLabel(2, 5), "2 sur 5");
    assert.equal(progressLabel(NaN, undefined), "Aucune étape");
    assert.equal(progressLabel(undefined, 5), "0 sur 5");
    assert.equal(progressLabel(9, 5), "5 sur 5");
    assert.equal(progressLabel(-3, 5), "0 sur 5");
  });
});

describe("lien vers la page du guide", () => {
  it("suit l’espace courant", () => {
    assert.equal(guideHrefFor("/espace-personnel/taches"), "/espace-personnel/guide");
    assert.equal(guideHrefFor("/espace-equipe/devis/42"), "/espace-equipe/guide");
    assert.equal(guideHrefFor("/espace-client"), "/espace-client/guide");
  });

  it("ne propose rien hors espace de travail", () => {
    assert.equal(guideHrefFor("/"), null);
    assert.equal(guideHrefFor("/tarifs"), null);
    assert.equal(guideHrefFor(undefined), null);
  });
});

describe("espace d’un chemin", () => {
  it("reconnaît les quatre espaces de travail", () => {
    assert.equal(spaceOfPathname("/espace-personnel/taches"), "personal");
    assert.equal(spaceOfPathname("/espace-equipe/devis/42"), "team");
    assert.equal(spaceOfPathname("/espace-comexa/contenu"), "comexa");
    assert.equal(spaceOfPathname("/espace-client"), "client");
  });

  it("ne confond pas une page publique avec un espace", () => {
    assert.equal(spaceOfPathname("/services"), null);
    assert.equal(spaceOfPathname("/"), null);
    assert.equal(spaceOfPathname(undefined), null);
  });
});

describe("sélecteur du contrôle à montrer", () => {
  it("échappe les caractères spéciaux du catalogue", () => {
    assert.equal(spotlightSelector("taches-create-form"), '[data-coach-id="taches-create-form"]');
    assert.equal(spotlightSelector('a"b'), '[data-coach-id="a\\"b"]');
  });

  it("ignore une cible absente", () => {
    assert.equal(spotlightSelector(""), null);
    assert.equal(spotlightSelector(undefined), null);
  });
});
