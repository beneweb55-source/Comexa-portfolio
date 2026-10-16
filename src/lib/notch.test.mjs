import assert from "node:assert/strict";
import test from "node:test";
import { NOTCH, notchPath, notchWidth } from "./notch.mjs";

test("notchWidth : suit la pilule de l'onglet, entre un plancher et un plafond", () => {
  // « Mon temps » : pilule de 118 px, congés de 12 px de chaque côté.
  assert.equal(notchWidth(118), 142);
  assert.equal(notchWidth(64), 88);
  // Onglet réduit à son icône (40 px) : la languette reste lisible.
  assert.equal(notchWidth(40), NOTCH.minWidth);
  assert.equal(notchWidth(0), NOTCH.minWidth);
  assert.equal(notchWidth(undefined), NOTCH.minWidth);
  // Onglet très large : plafond.
  assert.equal(notchWidth(320), NOTCH.maxWidth);
});

test("notchWidth : toujours un entier pair de marge autour du corps", () => {
  for (const pill of [41, 65, 90, 117, 140, 199]) {
    const width = notchWidth(pill);
    if (width === NOTCH.minWidth || width === NOTCH.maxWidth) continue;
    assert.equal(width - pill, NOTCH.flare * 2, `pilule ${pill} : congés symétriques`);
  }
});

test("notchPath : silhouette fermée, sans angle droit rapporté", () => {
  const d = notchPath(notchWidth(118));
  assert.ok(d.startsWith("M0 0"), "commence au bord haut gauche");
  assert.ok(d.endsWith("Z"), "chemin fermé");
  // Un seul morceau : aucune commande de sous-chemin supplémentaire.
  assert.equal(d.match(/M/g).length, 1);
  // Les deux épaulements sont des arcs courts tracés vers l'extérieur…
  assert.equal(d.match(/A7 7 0 0 0/g).length, 2, "deux congés concaves");
  // …et les deux coins du bas des arrondis convexes.
  assert.equal(d.match(/A10 10 0 0 1/g).length, 2, "deux coins bas arrondis");
  assert.ok(!d.includes("NaN"), "aucune valeur invalide");
});

test("notchPath : les coordonnées restent dans le cadre du dessin", () => {
  for (const pill of [40, 96, 118, 180, 260]) {
    const width = notchWidth(pill);
    const d = notchPath(width);
    for (const [, x] of d.matchAll(/[AHV](-?\d+(?:\.\d+)?)\b/g)) {
      const value = Number(x);
      assert.ok(value >= 0 && value <= width, `${value} hors du cadre (largeur ${width})`);
    }
    for (const [, y] of d.matchAll(/\bA\d+(?:\.\d+)? \d+(?:\.\d+)? 0 0 [01] -?\d+(?:\.\d+)? (-?\d+(?:\.\d+)?)/g)) {
      const value = Number(y);
      assert.ok(value >= 0 && value <= NOTCH.height, `${value} hors hauteur`);
    }
  }
});

test("notchPath : largeur minuscule, jamais de rayon négatif", () => {
  const d = notchPath(8);
  assert.ok(!d.includes("-"), "aucune coordonnée négative");
  assert.ok(!d.includes("NaN"));
});
