"use client";

/*
 * Carte d'item (utilisateur, cours/projet, événement, devis, commande…) :
 * titre gras, description grise, ligne de méta, pilule de statut, 2 à 3 boutons
 * icône ronds — le dernier étant l'action principale en noir plein. Une pastille
 * ronde colorée peut chevaucher le coin haut-droit (initiales ou icône).
 *
 * Le composant ne connaît aucune donnée d'API : les pages composent `meta`,
 * `actions` et `corner`, ce qui garantit que la logique métier reste dans la page.
 */

import { motion } from "framer-motion";
import { cardHover, cardRest, staggerItem } from "./motion";
import { IconButton, StatusPill } from "./primitives";

/*
 * `actions` accepte deux formes : des nœuds React prêts à l'emploi, ou des
 * descripteurs `{ icon, label, href, onClick, variant }` que la carte convertit
 * en boutons icône ronds. Le dernier descripteur porte l'action principale
 * (`variant: "dark"`), comme le demande la charte des cartes.
 */
function renderActions(actions) {
  if (!actions?.length) return null;
  if (!Array.isArray(actions)) return actions;
  return actions.map((action, index) => {
    if (action && typeof action === "object" && (action.icon || action.label)) {
      return (
        <IconButton
          key={action.label ?? index}
          icon={action.icon}
          label={action.label}
          href={action.href}
          onClick={action.onClick}
          tone={action.variant ?? (index === actions.length - 1 ? "dark" : "neutral")}
          tooltipPlacement="top"
        />
      );
    }
    return <span key={index}>{action}</span>;
  });
}

export function ProgressBar({ value, ratio }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="sui-progress">
      <div className="sui-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={safe}>
        <div className="sui-progress__bar" style={{ width: `${safe}%` }} />
      </div>
      <span className="sui-progress__value">{ratio ?? `${safe} %`}</span>
    </div>
  );
}

export function ItemCard({
  title,
  titleHref,
  description,
  meta = [],
  status,
  statusIcon,
  statusTone,
  statusVariant,
  corner,
  cornerTone = "blue",
  cornerLabel,
  cornerIcon: CornerIcon,
  actions,
  footer,
  highlight = false,
  ghost = false,
  info,
  play,
  progress,
  children,
}) {
  const classes = ["sui-card", highlight ? "sui-card--highlight" : "", ghost ? "sui-card--ghost" : ""].join(" ").trim();

  return (
    <motion.li
      variants={staggerItem}
      whileHover={ghost ? undefined : cardHover}
      animate={cardRest}
      className={classes}
      style={{ listStyle: "none" }}
    >
      {corner || cornerLabel || CornerIcon ? (
        <span
          className="sui-card__corner"
          aria-hidden={cornerLabel ? undefined : "true"}
          style={{ "--tone-bg": `var(--${cornerTone})` }}
        >
          {CornerIcon ? <CornerIcon size={17} strokeWidth={1.75} /> : corner ?? cornerLabel}
        </span>
      ) : null}

      {title ? (
        <h3 className="sui-card__title">
          {titleHref ? <a href={titleHref}>{title}</a> : title}
        </h3>
      ) : null}

      {info ? <span className="sui-card__pill">{info}</span> : null}
      {description ? <p className="sui-card__desc">{description}</p> : null}

      {meta.length ? (
        <ul className="sui-card__meta">
          {meta.map((entry, index) => (
            <li key={`${entry.label}-${index}`}>
              {entry.icon ? <entry.icon size={14} strokeWidth={1.75} aria-hidden="true" /> : null}
              {entry.label}
            </li>
          ))}
        </ul>
      ) : null}

      {children}

      {progress ? <ProgressBar value={progress.value} ratio={progress.ratio} /> : null}

      {status || actions || footer || play ? (
        <div className="sui-card__foot" style={status && actions ? undefined : { justifyContent: "flex-start" }}>
          {status ? (
            <StatusPill tone={statusTone} icon={statusIcon} label={status} variant={statusVariant} />
          ) : null}
          {play ? <span style={{ marginLeft: "auto" }}>{play}</span> : null}
          {actions ? <div className="sui-card__actions">{renderActions(actions)}</div> : null}
          {footer}
        </div>
      ) : null}
    </motion.li>
  );
}

/** Grille de cartes (3 colonnes desktop, 2 en tablette, 1 sur mobile). */
export function ItemGrid({ children, label }) {
  return (
    <motion.ul
      className="sui-grid"
      aria-label={label}
      initial="hidden"
      animate="visible"
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
    >
      {children}
    </motion.ul>
  );
}

export default ItemCard;
