"use client";

/*
 * Cartes KPI pastel, sans bordure et très arrondies (28 px). Une seule carte
 * « fantôme » (pointillés, sans remplissage) est admise par vue : elle sert aux
 * éléments à traiter (en attente, à vérifier). Aucun emoji : la décoration vient
 * d'une icône lucide (Sparkles par défaut sur la carte verte).
 */

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { staggerItem } from "./motion";
import { toneBackground } from "./primitives";

export function KpiCard({ value, secondary, label, tone = "blue", badge, deco, decoIcon: Deco = Sparkles, toneBg, className = "" }) {
  return (
    <motion.article
      variants={staggerItem}
      className={`sui-kpi ${tone === "ghost" ? "sui-kpi--ghost" : ""} ${className}`.trim()}
      style={tone === "ghost" ? undefined : { "--tone-bg": toneBg ?? toneBackground(tone) }}
    >
      <div className="sui-kpi__top">
        {badge ? <span className="sui-kpi__badge">{badge}</span> : <span />}
        {deco && tone !== "ghost" ? (
          <span className="sui-kpi__deco" aria-hidden="true">
            <Deco size={20} strokeWidth={1.75} />
          </span>
        ) : null}
      </div>
      <p className="sui-kpi__value">{value}</p>
      {secondary ? <p className="sui-kpi__secondary">{secondary}</p> : null}
      <p className="sui-kpi__label">{label}</p>
    </motion.article>
  );
}

/** Rangée de 4 indicateurs, apparition échelonnée (40 ms). */
export function KpiGrid({ items, label = "Indicateurs clés" }) {
  return (
    <motion.div
      className="sui-kpis"
      role="list"
      aria-label={label}
      initial="hidden"
      animate="visible"
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
    >
      {items.map((item) => (
        <div role="listitem" key={item.id ?? item.label} style={{ display: "contents" }}>
          <KpiCard {...item} />
        </div>
      ))}
    </motion.div>
  );
}

export default KpiCard;
