"use client";

import { useEffect } from "react";
import { computeWebViewFallbackInsets } from "@/lib/safe-area.mjs";

function readCssEnvPx(prop) {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingTop = `env(${prop}, 0px)`;
  document.documentElement.appendChild(probe);
  const px = parseFloat(window.getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return px;
}

export default function SafeAreaSync() {
  useEffect(() => {
    const sync = () => {
      const { top, bottom } = computeWebViewFallbackInsets({
        userAgent: window.navigator?.userAgent ?? "",
        envTopPx: readCssEnvPx("safe-area-inset-top"),
        envBottomPx: readCssEnvPx("safe-area-inset-bottom"),
        screenWidth: window.screen?.width ?? 0,
        screenHeight: window.screen?.height ?? 0,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      });
      const root = document.documentElement.style;
      root.setProperty("--sui-webview-safe-top", `${top}px`);
      root.setProperty("--sui-webview-safe-bottom", `${bottom}px`);
    };

    sync();
    window.addEventListener("resize", sync, { passive: true });
    window.addEventListener("orientationchange", sync, { passive: true });
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);

  return null;
}
