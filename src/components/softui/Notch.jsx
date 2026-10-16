"use client";

/*
 * Languette noire de la navbar — la signature du design.
 *
 * Elle descend de la barre noire sous l'onglet actif et épouse la largeur de sa
 * pilule : silhouette SVG continue (aucun masque CSS, donc aucun raccord à
 * recoller), congés concaves en haut, coins arrondis en bas. La géométrie vient
 * de `src/lib/notch.mjs` (testée) ; ce composant ne s'occupe que du rendu.
 *
 * `center` est le centre horizontal de l'onglet actif, exprimé DANS LE REPÈRE DE
 * LA COQUE (la languette est positionnée en absolu à l'intérieur de `.sui-shell`).
 */

import { NOTCH, notchPath, notchWidth } from "@/lib/notch.mjs";

export default function Notch({ center, pillWidth, className = "" }) {
  if (!Number.isFinite(center)) return null;
  const width = notchWidth(pillWidth);
  const height = NOTCH.height;
  return (
    <svg
      className={`sui-notch ${className}`.trim()}
      aria-hidden="true"
      style={{ left: `${center}px`, width: `${width}px`, height: `${height}px` }}
      viewBox={`0 0 ${width} ${height}`}
      fill="currentColor"
    >
      <path d={notchPath(width)} />
    </svg>
  );
}
