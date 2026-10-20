/**
 * Calcul de repli des zones sûres (safe areas) pour WebView Android plein écran.
 *
 * Sur iOS Safari, Chrome mobile et un APK Android corrigé (conteneur natif
 * rembourré par `WindowInsets.Type.systemBars() | displayCutout()`), soit le
 * navigateur renseigne `env(safe-area-inset-*)`, soit la vue native réduit déjà
 * `window.innerHeight` sous `window.screen.height`.
 *
 * En revanche, une WebView Android bord à bord non rembourrée (`; wv)`) étire
 * le viewport sur tout l'écran (`screen.height - innerHeight < 20`) tout en
 * exposant `env(safe-area-inset-top) === 0` : la barre haute passe alors sous
 * l'horloge, l'encoche caméra et les icônes réseau/batterie, et la barre basse
 * sous la barre de navigation système.
 */

export const ANDROID_WEBVIEW_UA_RE = /Android[\s\S]*(?:;\s*wv\)|\bwv\b)/i;

export function isAndroidWebView(userAgent = "") {
  return ANDROID_WEBVIEW_UA_RE.test(String(userAgent));
}

export function computeWebViewFallbackInsets({
  userAgent = "",
  envTopPx = 0,
  envBottomPx = 0,
  screenWidth = 0,
  screenHeight = 0,
  innerWidth = 0,
  innerHeight = 0,
} = {}) {
  if (!isAndroidWebView(userAgent)) {
    return { top: 0, bottom: 0 };
  }

  const safeTop = Number(envTopPx) || 0;
  const safeBottom = Number(envBottomPx) || 0;
  if (safeTop > 0 || safeBottom > 0) {
    return { top: 0, bottom: 0 };
  }

  const sw = Number(screenWidth) || 0;
  const sh = Number(screenHeight) || 0;
  const iw = Number(innerWidth) || 0;
  const ih = Number(innerHeight) || 0;
  if (sh <= 0 || ih <= 0) {
    return { top: 0, bottom: 0 };
  }

  const portrait = ih >= iw;
  const verticalChrome = sh - ih;
  const horizontalChrome = sw - iw;

  // En portrait, si le conteneur natif absorbe déjà les barres système, l'écart
  // vertical dépasse largement 20 px : n'ajouter aucun rembourrage supplémentaire.
  if (portrait) {
    if (verticalChrome >= 20) return { top: 0, bottom: 0 };
    return { top: 28, bottom: 24 };
  }

  // En paysage plein écran non rembourré, préserver une marge haute/basse sobre.
  if (verticalChrome < 16 && horizontalChrome < 20) {
    return { top: 24, bottom: 16 };
  }

  return { top: 0, bottom: 0 };
}
