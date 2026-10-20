/*
 * Languette noire de la navbar.
 *
 * C'est LA silhouette qui descend de la barre noire sous l'onglet actif
 * (« Mon temps », « Projets »…) : un seul chemin SVG continu, du bord de la
 * navbar jusqu'aux coins du bas. Aucun masque CSS, donc aucun raccord à
 * recoller, aucune pointe décalée, aucune couture visible.
 *
 * Forme « à la Apple » (aucun angle droit visible) :
 *
 *   ─────╮                                              ╭─────   ← bord de la navbar
 *        ╰──╮        corps = largeur de l'onglet     ╭──╯        ← congés concaves
 *           ╰───────────────────────────────────────╯           ← coins bas arrondis
 *
 *  - `shoulder` : rayon des congés concaves qui évasent la languette jusqu'au
 *    bord de la barre (raccord doux, jamais un coin carré) ;
 *  - `foot` : rayon des deux coins du bas (l'arrondi « continu » de la forme) ;
 *  - `flare` : place réservée à chaque extrémité pour ces congés. Le corps de la
 *    languette (les deux côtés verticaux) mesure donc `largeur − 2 × flare`,
 *    ce qui le rend EXACTEMENT aussi large que la pilule de l'onglet actif ;
 *  - `height` : profondeur sous la navbar (le dessin chevauche la barre de 1 px,
 *    `y = 0` étant la dernière rangée noire, pour que les deux noirs se soudent).
 *
 * Fonctions pures : sans dépendance à React ni à l'API.
 */

export const NOTCH = Object.freeze({
  height: 19,
  shoulder: 7,
  foot: 10,
  flare: 12,
  minWidth: 72,
  maxWidth: 184,
});

/**
 * Largeur totale du dessin pour la pilule d'un onglet de largeur `pillWidth`.
 * Le corps reste collé aux bords de la pilule ; les congés débordent de `flare`
 * de chaque côté. Un onglet réduit à son icône (40 px) garde une languette
 * lisible grâce au plancher `minWidth`.
 */
export function notchWidth(pillWidth, geometry = NOTCH) {
  const { flare, minWidth, maxWidth } = geometry;
  const pill = Number(pillWidth);
  const body = Number.isFinite(pill) && pill > 0 ? pill : minWidth - flare * 2;
  const total = Math.round(body + flare * 2);
  return Math.min(maxWidth, Math.max(minWidth, total));
}

/**
 * Chemin SVG de la silhouette pour une largeur totale `width`.
 * Repère SVG : `x` vers la droite, `y` vers le bas, origine au bord gauche de la
 * languette (dernière rangée de la navbar).
 *
 * Parcours horaire unique : haut → épaule droite → côté droit → coin bas droit →
 * bas → coin bas gauche → côté gauche → épaule gauche → retour au bord gauche.
 * Les congés sont tracés `sweep-flag=0` (arc court, vers l'extérieur), les coins
 * du bas `sweep-flag=1` : la silhouette ne présente aucune cassure de tangente.
 */
export function notchPath(width, geometry = NOTCH) {
  const { height, shoulder, foot, flare } = geometry;
  const total = Math.max(4, Math.round(Number(width) || 0));
  /* Le corps garde toujours au moins 2 px : sur une largeur minuscule, les
     congés se resserrent au lieu de produire un chemin dégénéré. */
  const flareEff = Math.min(flare, Math.max(1, (total - 4) / 2));
  const body = Math.max(2, total - 2 * flareEff);
  const maxRadius = Math.max(1, Math.min(body / 2, flareEff));
  const r = Math.min(shoulder, Math.max(1, height - 2 - foot), maxRadius);
  const f = Math.min(foot, Math.max(1, height - 2 - r), maxRadius);
  const left = round(flareEff);
  const right = round(left + body);
  const shoulderEnd = 1 + r; // bas du congé, sur le côté vertical
  const footStart = height - f; // haut du coin bas, sur le côté vertical
  const side = Math.max(0, footStart - shoulderEnd);

  const parts = [
    "M0 0",
    `H${total}`,
    "V1",
    `H${round(right + r)}`,
    /* Épaule droite : quart de cercle concave (arc court, vers l'extérieur). */
    `A${r} ${r} 0 0 0 ${round(right)} ${round(shoulderEnd)}`,
    `V${round(shoulderEnd + side)}`,
    /* Coin bas droit : arrondi convexe. */
    `A${f} ${f} 0 0 1 ${round(right - f)} ${round(height)}`,
    `H${round(left + f)}`,
    /* Coin bas gauche. */
    `A${f} ${f} 0 0 1 ${round(left)} ${round(footStart)}`,
    `V${round(shoulderEnd)}`,
    /* Épaule gauche. */
    `A${r} ${r} 0 0 0 ${round(left - r)} 1`,
    "H0",
    "Z",
  ];
  return parts.join(" ");
}

function round(value) {
  return Math.round(value * 100) / 100;
}
