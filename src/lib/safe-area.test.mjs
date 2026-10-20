import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeWebViewFallbackInsets, isAndroidWebView } from "./safe-area.mjs";

const ANDROID_WV_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36";
const ANDROID_CHROME_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const IOS_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("safe-area WebView fallback", () => {
  it("detects Android System WebView without false positives on Chrome or iOS", () => {
    assert.equal(isAndroidWebView(ANDROID_WV_UA), true);
    assert.equal(isAndroidWebView(ANDROID_CHROME_UA), false);
    assert.equal(isAndroidWebView(IOS_SAFARI_UA), false);
  });

  it("applies safe top/bottom insets on unpadded edge-to-edge Android WebView", () => {
    assert.deepEqual(
      computeWebViewFallbackInsets({
        userAgent: ANDROID_WV_UA,
        envTopPx: 0,
        envBottomPx: 0,
        screenWidth: 412,
        screenHeight: 915,
        innerWidth: 412,
        innerHeight: 915,
      }),
      { top: 28, bottom: 24 },
    );
  });

  it("avoids double padding when native FrameLayout already insets the WebView", () => {
    assert.deepEqual(
      computeWebViewFallbackInsets({
        userAgent: ANDROID_WV_UA,
        envTopPx: 0,
        envBottomPx: 0,
        screenWidth: 412,
        screenHeight: 915,
        innerWidth: 412,
        innerHeight: 843,
      }),
      { top: 0, bottom: 0 },
    );
  });

  it("avoids double padding when CSS env(safe-area-inset-*) is already populated", () => {
    assert.deepEqual(
      computeWebViewFallbackInsets({
        userAgent: ANDROID_WV_UA,
        envTopPx: 36,
        envBottomPx: 24,
        screenWidth: 412,
        screenHeight: 915,
        innerWidth: 412,
        innerHeight: 915,
      }),
      { top: 0, bottom: 0 },
    );
  });
});
