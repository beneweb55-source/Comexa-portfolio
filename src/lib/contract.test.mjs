/**
 * Tests du diagnostic de contrat (node --test, sans navigateur).
 *
 * Trois cas, trois messages attendus : la banniere ne doit JAMAIS accuser le
 * serveur de ne pas servir une fonctionnalite qu'il sert — c'est exactement ce
 * genre de faux diagnostic qui fait ignorer la vraie alerte.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REQUIRED_FEATURES, checkApiContract } from "./contract.js";

function fakeFetch(payload, { status = 200, throwNetwork = false, invalidJson = false } = {}) {
  return async () => {
    if (throwNetwork) throw new TypeError("network down");
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (invalidJson) throw new SyntaxError("not json");
        return payload;
      },
    };
  };
}

const healthOf = (contract) => ({ success: true, data: { status: "ok", contract } });

describe("diagnostic du contrat API", () => {
  it("valide quand toutes les fonctionnalites requises sont servies", async () => {
    const result = await checkApiContract(
      fakeFetch(healthOf({ version: "2026-10-12.3", features: { timer: true, personalTasks: true, calendar: true } })),
    );
    assert.equal(result.ok, true);
    assert.equal(result.kind, "ok");
  });

  it("nomme EXACTEMENT les fonctionnalites manquantes (pas plus, pas moins)", async () => {
    const result = await checkApiContract(
      fakeFetch(healthOf({ version: "2026-10-12.3", features: { timer: true, personalTasks: true } })),
    );
    assert.equal(result.ok, false);
    assert.equal(result.kind, "missing");
    assert.ok(result.reason.includes("calendar"), result.reason);
    assert.ok(!result.reason.includes("timer,"), "les fonctionnalites servies ne doivent pas etre accusees");
    assert.equal(result.contract.features.timer, true);
  });

  it("distingue un build SANS poignee de main (pas de bloc contract)", async () => {
    const result = await checkApiContract(fakeFetch({ success: true, data: { status: "ok" } }));
    assert.equal(result.ok, false);
    assert.equal(result.kind, "no-contract");
    assert.ok(result.reason.includes("poignée de main"), result.reason);
    assert.equal(result.contract, null);
  });

  it("reste silencieux sur une API injoignable ou illisible", async () => {
    const network = await checkApiContract(fakeFetch(null, { throwNetwork: true }));
    assert.equal(network.kind, "unreachable");
    assert.equal(network.contract, null);

    const html = await checkApiContract(fakeFetch(null, { invalidJson: true }));
    assert.equal(html.kind, "unreachable");

    const error500 = await checkApiContract(fakeFetch({ success: false }, { status: 500 }));
    assert.equal(error500.kind, "unreachable");
  });

  it("la liste des fonctionnalites requises ne devient jamais vide", () => {
    assert.ok(REQUIRED_FEATURES.length >= 3);
    assert.ok(REQUIRED_FEATURES.includes("calendar"));
  });
});
