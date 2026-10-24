"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { desktopStartupMode } = require("../config");

test("uses the embedded frontend when it is available, regardless of package mode", () => {
  assert.equal(desktopStartupMode({ packaged: true, localFrontendReady: true }), "embedded");
  assert.equal(desktopStartupMode({ packaged: false, localFrontendReady: true }), "embedded");
});

test("a packaged desktop never falls back to the hosted frontend", () => {
  assert.equal(desktopStartupMode({ packaged: true, localFrontendReady: false }), "bundle-error");
});

test("only development mode may use the hosted frontend fallback", () => {
  assert.equal(desktopStartupMode({ packaged: false, localFrontendReady: false }), "hosted");
});
