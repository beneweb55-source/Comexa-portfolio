"use client";

/*
 * Dock flottant de la coque : une seule barre, détachée du bord inférieur.
 *
 * Ce qui a changé, et pourquoi :
 *  - l'ancien dock était « vissé » au bord bas avec deux congés concaves qui ne
 *    s'appuyaient sur rien (le bas de la coque est le panneau clair) : il
 *    paraissait coupé, et il recouvrait en permanence le bas des cartes ;
 *  - il flotte désormais à 14 px du bord, en pilule complète, et se REPLIE
 *    pendant que l'on fait défiler le contenu vers le bas (il revient dès que
 *    l'on remonte, au survol du bas de l'écran ou au focus clavier). La zone de
 *    défilement réserve sa hauteur : la dernière carte n'est jamais masquée ;
 *  - le minuteur et la console Comexa, qui flottaient chacun dans un coin et
 *    débordaient de la coque, y trouvent leur place (segment de droite).
 *
 * Infobulle au survol ET au focus clavier, `role="toolbar"`.
 */

import Link from "next/link";
import Tooltip from "./Tooltip";

export default function Dock({ items = [], end = null, label = "Actions rapides", hidden = false, onReveal }) {
  if (!items.length && !end) return null;

  return (
    <div className={`sui-dockwrap${hidden ? " sui-dockwrap--hidden" : ""}`} onMouseEnter={onReveal} onFocusCapture={onReveal}>
      <div className="sui-dock" role="toolbar" aria-label={label} aria-orientation="horizontal">
        {items.map((item) => {
          const classes = ["sui-dock__btn", item.tone === "ink" ? "sui-dock__btn--ink" : ""].filter(Boolean).join(" ");
          const style = item.tone === "ink" ? undefined : { "--tone-bg": `var(--${item.tone ?? "blue"})` };
          const content = <item.icon size={19} strokeWidth={1.75} aria-hidden="true" />;
          return (
            <Tooltip key={item.label} label={item.label} placement="top">
              {item.href ? (
                <Link href={item.href} className={classes} style={style} aria-label={item.label} title={item.label}>
                  {content}
                </Link>
              ) : (
                <button type="button" className={classes} style={style} aria-label={item.label} title={item.label} onClick={item.onClick}>
                  {content}
                </button>
              )}
            </Tooltip>
          );
        })}
        {end ? (
          <>
            {items.length ? <span className="sui-dock__sep" aria-hidden="true" /> : null}
            <div className="sui-dock__end">{end}</div>
          </>
        ) : null}
      </div>
    </div>
  );
}
