"use client";

/*
 * Petits panneaux de contenu : liste d'activité (icône dans un cercle clair,
 * phrase en gras, horodatage gris), santé de l'espace (barres de progression
 * vertes + ratio à droite) et panneau générique.
 */

import { motion } from "framer-motion";
import { staggerItem } from "./motion";
import { ProgressBar } from "./ItemCard";

export function Panel({ title, action, children, className = "", style }) {
  return (
    <section className={`sui-panel ${className}`.trim()} style={style}>
      {title ? (
        <div className="sui-section__head">
          <h2 className="sui-section__title">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Liste d'activité : `{ id, icon, sentence, time, tone }`. */
export function ActivityList({ items, empty = "Aucune activité récente." }) {
  if (!items?.length) return <p className="sui-card__desc">{empty}</p>;
  return (
    <motion.ul className="sui-activity" initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}>
      {items.map((item, index) => (
        <motion.li key={item.id ?? `${item.sentence}-${index}`} variants={staggerItem} className="sui-activity__row">
          <span className="sui-activity__icon" style={{ "--tone-bg": `var(--${item.tone ?? "blue"})` }} aria-hidden="true">
            {item.icon ? <item.icon size={17} strokeWidth={1.75} /> : null}
          </span>
          <span className="sui-activity__copy">
            <p>{item.sentence}</p>
          </span>
          <span className="sui-activity__time">{item.time}</span>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/** Santé de l'espace : `{ id, label, hint, value, ratio }`. */
export function HealthList({ items }) {
  return (
    <ul className="sui-health">
      {items.map((item) => (
        <li key={item.id ?? item.label}>
          <p className="sui-health__label">
            <span>{item.label}</span>
            <span className="sui-health__hint">{item.hint}</span>
          </p>
          <ProgressBar value={item.value} ratio={item.ratio} />
        </li>
      ))}
    </ul>
  );
}
