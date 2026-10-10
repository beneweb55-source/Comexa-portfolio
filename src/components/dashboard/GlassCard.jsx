"use client";

/*
 * Carte « verre dépoli » réutilisable pour les widgets du tableau de bord.
 * Le style est centralisé ici (blur, bordure, ombre, reflet interne) : les widgets
 * ne redéfinissent jamais ces classes, ils passent seulement leur mise en page.
 */
export const GLASS =
  "bg-white/5 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_0_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.12)]";

export default function GlassCard({ as: Tag = "section", className = "", children, ...props }) {
  return (
    <Tag className={`relative isolate overflow-hidden rounded-3xl ${GLASS} ${className}`} {...props}>
      {/* Reflet lumineux haut de carte : donne le volume sans ombre portée lourde. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-24 bg-gradient-to-b from-white/[0.08] to-transparent" />
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-6 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
      {children}
    </Tag>
  );
}

/** Icône lumineuse : un halo coloré derrière le pictogramme. */
export function GlowIcon({ children, tone = "sky", className = "" }) {
  const tones = {
    sky: "bg-sky-400/15 text-sky-300 shadow-[0_0_24px_rgba(79,176,240,0.55)]",
    accent: "bg-blue-500/15 text-blue-300 shadow-[0_0_24px_rgba(30,134,224,0.6)]",
    mint: "bg-emerald-400/15 text-emerald-300 shadow-[0_0_24px_rgba(52,211,153,0.5)]",
    violet: "bg-fuchsia-400/15 text-fuchsia-300 shadow-[0_0_24px_rgba(192,132,252,0.55)]",
    amber: "bg-amber-400/15 text-amber-300 shadow-[0_0_24px_rgba(251,191,36,0.45)]",
  };
  return (
    <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${tones[tone] ?? tones.sky} ${className}`}>
      {children}
    </span>
  );
}
