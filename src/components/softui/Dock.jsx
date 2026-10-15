"use client";

/*
 * Dock noir flottant, centré en bas de la coque, avec découpe à rayon inversé
 * (les congés concaves épousent le bord du panneau clair). Cinq boutons ronds
 * pastel + un « + » noir cerclé. Infobulle au survol et au focus clavier.
 */

import Link from "next/link";
import Tooltip from "./Tooltip";

export default function Dock({ items = [], label = "Actions rapides" }) {
  if (!items.length) return null;

  return (
    <div className="sui-dockwrap">
      <div className="sui-dock" role="toolbar" aria-label={label} aria-orientation="horizontal">
        <span className="sui-dock__fillet sui-dock__fillet--left" aria-hidden="true" />
        <span className="sui-dock__fillet sui-dock__fillet--right" aria-hidden="true" />
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
      </div>
    </div>
  );
}
