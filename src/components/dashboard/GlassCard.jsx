"use client";

/** Surface claire du dashboard : contraste dense, reflet discret et blur modéré. */
export const GLASS = "cx-glass-card";

export default function GlassCard({ as: Tag = "section", className = "", children, ...props }) {
  return (
    <Tag className={`${GLASS} ${className}`} {...props}>
      {children}
    </Tag>
  );
}

/** Icône sur un fond pastel Comexa, sans halo lumineux agressif. */
export function GlowIcon({ children, tone = "sky", className = "" }) {
  const tones = {
    sky: "cx-dashboard__icon cx-dashboard__icon--sky",
    accent: "cx-dashboard__icon cx-dashboard__icon--accent",
    mint: "cx-dashboard__icon cx-dashboard__icon--mint",
    violet: "cx-dashboard__icon cx-dashboard__icon--violet",
    amber: "cx-dashboard__icon cx-dashboard__icon--amber",
  };
  return (
    <span className={`${tones[tone] ?? tones.sky} ${className}`}>
      {children}
    </span>
  );
}
