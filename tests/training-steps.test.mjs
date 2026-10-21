/**
 * TESTS DU CONTRAT D'ÉTAPE côté navigateur.
 *
 * Ces trois fonctions ont été écrites après une panne réelle : le catalogue
 * servait `navigateTo`, l'interface lisait `step.page` (toujours `undefined`).
 * Résultat : « ÉTAPE NaN SUR 5 », un bouton « Aller à l'étape » qui renvoyait
 * sur la même page, et dans la console
 * « Cannot read properties of undefined (reading 'startsWith') ».
 *
 * Le test fige la tolérance : forme actuelle (`navigateTo`, `hint.text`), forme
 * normalisée (`page`), et valeurs corrompues (null, chaîne, NaN).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isOnPage,
  pageLabel,
  stepHintText,
  stepPage,
  toStepIndex,
} from "../src/lib/training/mission-steps.mjs";

describe("stepPage", () => {
  const mission = { realModuleHref: "/espace-personnel/taches" };

  it("lit la forme normalisée du serveur", () => {
    assert.equal(stepPage({ page: "/espace-personnel/temps" }, mission), "/espace-personnel/temps");
  });

  it("lit l'ancien catalogue (`navigateTo`)", () => {
    assert.equal(stepPage({ navigateTo: "/espace-personnel/temps" }, mission), "/espace-personnel/temps");
  });

  it("retombe sur le module réel de la mission, jamais sur undefined", () => {
    assert.equal(stepPage({}, mission), "/espace-personnel/taches");
    assert.equal(stepPage(null, mission), "/espace-personnel/taches");
    assert.equal(stepPage({ navigateTo: "pas-un-chemin" }, mission), "/espace-personnel/taches");
  });

  it("rend null plutôt qu'une valeur qui ferait planter le routeur", () => {
    assert.equal(stepPage({}, {}), null);
    assert.equal(stepPage(undefined, undefined), null);
  });
});

describe("stepHintText", () => {
  it("accepte un indice structuré (contrat actuel)", () => {
    assert.equal(stepHintText({ hint: { text: "Menu de gauche" } }), "Menu de gauche");
  });

  it("accepte un indice chaîne (ancien contrat)", () => {
    assert.equal(stepHintText({ hint: "Menu de gauche" }), "Menu de gauche");
  });

  it("rend null quand il n'y a rien — React refuserait un objet", () => {
    assert.equal(stepHintText({}), null);
    assert.equal(stepHintText({ hint: { docPath: "docs/FORMATION.md" } }), null);
  });
});

describe("toStepIndex", () => {
  it("borne un instantané corrompu au lieu d'afficher NaN", () => {
    assert.equal(toStepIndex(undefined, 5), 0);
    assert.equal(toStepIndex(null, 5), 0);
    assert.equal(toStepIndex("deux", 5), 0);
    assert.equal(toStepIndex(Number.NaN, 5), 0);
  });

  it("borne dans les limites de la mission", () => {
    assert.equal(toStepIndex(-3, 5), 0);
    assert.equal(toStepIndex(12, 5), 4);
    assert.equal(toStepIndex(2.7, 5), 2);
    assert.equal(toStepIndex(1, 0), 0);
  });
});

describe("isOnPage", () => {
  it("reconnaît la page et ses sous-pages", () => {
    assert.equal(isOnPage("/espace-equipe/devis", "/espace-equipe/devis"), true);
    assert.equal(isOnPage("/espace-equipe/devis/42", "/espace-equipe/devis"), true);
    assert.equal(isOnPage("/espace-equipe/projets", "/espace-equipe/devis"), false);
  });

  it("ne confond jamais une page inconnue avec n'importe quelle route", () => {
    assert.equal(isOnPage("/espace-personnel/taches", null), false);
    assert.equal(isOnPage(undefined, "/espace-personnel/taches"), false);
    assert.equal(isOnPage("/espace-equipe/devisx", "/espace-equipe/devis"), false);
  });
});

describe("pageLabel", () => {
  it("nomme les écrans réels du parcours", () => {
    assert.equal(pageLabel("/espace-personnel/taches"), "Mes tâches");
    assert.equal(pageLabel("/espace-personnel/temps"), "Mon temps");
    assert.equal(pageLabel("/espace-client"), "Mes devis");
  });

  it("reste lisible sur une route inconnue", () => {
    assert.equal(pageLabel("/espace-equipe/nouveau-module"), "Nouveau module");
    assert.equal(pageLabel(null), "l’espace de travail");
  });
});
