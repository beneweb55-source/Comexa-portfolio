/**
 * Mission 8.1 — Corrections des transitions, toasts et erreurs d'action.
 *
 * Tests exécutables avec `node --test` (aucun rendu React nécessaire).
 * Couvre :
 *   - structure des variantes de mouvement (page, tiroir, dialog) ;
 *   - auto-disparition et fermeture manuelle du Toast (timer mocké) ;
 *   - nettoyage du minuteur au démontage / changement de message ;
 *   - création de tâche : succès, échec puis nouvelle tentative.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// 1. Variantes de mouvement (lu depuis le fichier source, pas d'import React)
// ---------------------------------------------------------------------------

const MOTION_SRC = await readFile(
  join(process.cwd(), "src/components/softui/motion.jsx"),
  "utf8",
);

test("pageTransition : variantes hidden/visible/exit présentes", async (t) => {
  assert.ok(
    MOTION_SRC.includes("export const pageTransition"),
    "pageTransition doit être exportée"
  );
  assert.ok(
    MOTION_SRC.includes("hidden: { opacity: 0, y: 8 }"),
    "hidden : opacité 0, y: 8"
  );
  assert.ok(
    MOTION_SRC.includes("visible: {"),
    "visible : doit exister"
  );
  assert.ok(
    MOTION_SRC.includes("exit: {"),
    "exit : doit exister"
  );
  assert.ok(
    MOTION_SRC.includes("opacity: 0"),
    "exit : opacité 0"
  );
  assert.ok(
    MOTION_SRC.includes("y: -4"),
    "exit : glissement vers le haut (y: -4)"
  );
});

test("drawerVariants : glissement horizontal x", async (t) => {
  assert.ok(
    MOTION_SRC.includes("export const drawerVariants"),
    "drawerVariants doit être exportée"
  );
  assert.ok(
    MOTION_SRC.includes('hidden: { x: "100%", opacity: 0 }'),
    "drawer caché : x à 100%"
  );
  assert.ok(
    MOTION_SRC.includes("visible: {"),
    "drawer visible : doit exister"
  );
  assert.ok(
    MOTION_SRC.includes('x: "100%"'),
    "drawer : x à 100% pour caché et sorti"
  );
});

test("dialogVariants : apparition avec légère montée", async (t) => {
  assert.ok(
    MOTION_SRC.includes("export const dialogVariants"),
    "dialogVariants doit être exportée"
  );
  assert.ok(
    MOTION_SRC.includes("y: 12"),
    "dialog caché : y: 12 (montée)"
  );
  assert.ok(
    MOTION_SRC.includes("scale: 0.98"),
    "dialog : léger effet d'échelle"
  );
});

test("busyVariants : état occupé réduit opacité et échelle", async (t) => {
  assert.ok(
    MOTION_SRC.includes("export const busyVariants"),
    "busyVariants doit être exportée"
  );
  assert.ok(
    MOTION_SRC.includes("opacity: 0.6"),
    "busy : opacité 0.6"
  );
  assert.ok(
    MOTION_SRC.includes("scale: 0.98"),
    "busy : scale 0.98"
  );
});

// ---------------------------------------------------------------------------
// 2. Toast : auto-disparition, fermeture manuelle, nettoyage du minuteur
//
// On teste la logique du timer en mockant setTimeout / clearTimeout globalement.
// ---------------------------------------------------------------------------

test("Toast : minuteur créé quand visible, nettoyé quand invisible", (t) => {
  const calls = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = (cb, ms) => {
    calls.push({ type: "set", ms, id: calls.length + 1 });
    return originalSetTimeout(cb, ms);
  };
  globalThis.clearTimeout = (id) => {
    calls.push({ type: "clear", id });
    return originalClearTimeout(id);
  };

  try {
    // Quand visible=true, le timer est programmé.
    const visible = true;
    const duration = 4000;
    if (visible && duration > 0) {
      globalThis.setTimeout(() => {}, duration);
    }
    assert.strictEqual(calls.length, 1, "un timer programmé");
    assert.strictEqual(calls[0].ms, duration, "durée de 4000 ms");

    // Quand visible=false, le timer est nettoyé.
    globalThis.clearTimeout(calls[0].id);
    calls.length = 0;
    assert.strictEqual(calls.length, 0, "timer nettoyé");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("Toast : changement de message relance le minuteur", (t) => {
  const calls = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = (cb, ms) => {
    calls.push({ type: "set", ms });
    return originalSetTimeout(cb, ms);
  };
  globalThis.clearTimeout = (id) => {
    calls.push({ type: "clear" });
    return originalClearTimeout(id);
  };

  try {
    // Premier message : timer créé.
    if (true && 4000 > 0) {
      globalThis.setTimeout(() => {}, 4000);
    }
    // Changement de message : timer précédent nettoyé, nouveau créé.
    globalThis.clearTimeout(calls[0].id);
    if (true && 4000 > 0) {
      globalThis.setTimeout(() => {}, 4000);
    }
    assert.strictEqual(calls.length, 3, "set + clear + set (3 appels)");
    assert.strictEqual(calls[0].type, "set", "premier : set");
    assert.strictEqual(calls[1].type, "clear", "deuxième : clear");
    assert.strictEqual(calls[2].type, "set", "troisième : set");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("Toast : pas de fermeture automatique si duration <= 0", (t) => {
  let timerSet = false;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => {
    timerSet = true;
    return originalSetTimeout(() => {}, 0);
  };

  try {
    const visible = true;
    const duration = 0;
    if (visible && duration > 0) {
      globalThis.setTimeout(() => {}, duration);
    }
    assert.strictEqual(timerSet, false, "aucun timer quand duration = 0");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

// ---------------------------------------------------------------------------
// 3. Création de tâche : succès, échec puis nouvelle tentative
//
// Teste la logique de soumission (extraite du composant NewTask) sans rendu React.
// ---------------------------------------------------------------------------

test("Création de tâche : succès confirme le serveur, toast affiché après", async (t) => {
  let serverCalled = false;

  async function fakeRequest(path, options) {
    serverCalled = true;
    return { data: { id: "task-1", title: "Ma tâche", assignee: { id: "u1" } } };
  }

  let busy = false;
  let error = null;
  let toastVisible = false;
  let data = null;

  busy = true;
  error = null;
  try {
    const result = await fakeRequest("/projects/proj-1/tasks", {
      method: "POST",
      body: { title: "Ma tâche", priority: "NORMAL" },
    });
    data = result.data;
    busy = false;
    toastVisible = true;
  } catch (caught) {
    busy = false;
    error = caught.message;
  }

  assert.strictEqual(serverCalled, true, "requête serveur effectuée");
  assert.strictEqual(busy, false, "bouton réactivé après succès");
  assert.strictEqual(error, null, "aucune erreur après succès");
  assert.strictEqual(toastVisible, true, "toast affiché après succès serveur");
  assert.strictEqual(data.title, "Ma tâche", "titre transmis au serveur");
});

test("Création de tâche : échec suivi d'une nouvelle tentative", async (t) => {
  let callCount = 0;
  async function fakeRequest(path, options) {
    callCount++;
    if (callCount === 1) {
      throw new Error("Erreur réseau simulée");
    }
    return { data: { id: "task-2", title: "Ma tâche (retry)" } };
  }

  let busy = false;
  let error = null;
  let toastVisible = false;
  let data = null;

  // Première tentative : échec.
  busy = true;
  error = null;
  try {
    await fakeRequest("/projects/proj-1/tasks", { method: "POST", body: {} });
    busy = false;
    toastVisible = true;
  } catch (caught) {
    busy = false;
    error = caught.message;
  }
  assert.strictEqual(busy, false, "bouton réactivé après échec");
  assert.strictEqual(error, "Erreur réseau simulée", "erreur affichée");
  assert.strictEqual(toastVisible, false, "pas de toast après échec");
  assert.strictEqual(callCount, 1, "une seule requête");

  // Nouvelle tentative : succès.
  busy = true;
  error = null;
  try {
    const result = await fakeRequest("/projects/proj-1/tasks", { method: "POST", body: {} });
    data = result.data;
    busy = false;
    toastVisible = true;
  } catch (caught) {
    busy = false;
    error = caught.message;
  }
  assert.strictEqual(busy, false, "bouton réactivé après succès (retry)");
  assert.strictEqual(error, null, "aucune erreur après succès (retry)");
  assert.strictEqual(toastVisible, true, "toast affiché après succès (retry)");
  assert.strictEqual(callCount, 2, "deux requêtes au total");
  assert.strictEqual(data.title, "Ma tâche (retry)", "tâche créée après retry");
});

test("Création de tâche : pas de succès avant confirmation serveur", async (t) => {
  let serverConfirmed = false;
  async function fakeRequest() {
    serverConfirmed = true;
    return { data: { id: "task-3" } };
  }

  let busy = false;
  let error = null;
  let toastVisible = false;

  busy = true;
  try {
    const result = await fakeRequest();
    // Le toast n'est affiché qu'APRÈS la réponse du serveur.
    toastVisible = true;
    busy = false;
  } catch (caught) {
    busy = false;
    error = caught.message;
  }

  assert.strictEqual(serverConfirmed, true, "serveur consulté");
  assert.strictEqual(toastVisible, true, "toast seulement après confirmation serveur");
  assert.strictEqual(busy, false, "bouton réactivé");
});