"use client";

/*
 * Primitives du design system : `IconButton`, `StatusPill`, `Pill`, `FilterPills`,
 * `Button`, `Toolbar`. Chacune reste sans logique métier : elles reçoivent des
 * libellés, des tonalités et des actions, jamais des données d'API.
 */

import Link from "next/link";
import { Loader } from "lucide-react";
import Tooltip from "./Tooltip";
import { statusTone } from "./tokens";

const TONE_BG = {
  blue: "var(--blue)",
  green: "var(--green)",
  yellow: "var(--yellow)",
  lilac: "var(--lilac)",
  "lilac-strong": "var(--lilac-strong)",
  pink: "var(--pink)",
  plain: "var(--surface)",
  ghost: "transparent",
};

export function toneBackground(tone) {
  return TONE_BG[tone] ?? TONE_BG.plain;
}

/**
 * Bouton icône seul. Le libellé est obligatoire : il devient `aria-label`, `title`
 * et infobulle. Cible tactile de 40 px minimum, sauf `size="sm"` (34 px) réservé aux
 * actions secondaires à l'intérieur d'une carte.
 */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  href,
  tone = "neutral",
  size = "md",
  tooltip = true,
  tooltipPlacement = "top",
  busy = false,
  className = "",
  ...rest
}) {
  const classes = [
    "sui-iconbtn",
    tone === "dark" ? "sui-iconbtn--dark" : "",
    tone === "white" ? "sui-iconbtn--white" : "",
    tone === "ghost" ? "sui-iconbtn--ghost" : "",
    size === "sm" ? "sui-iconbtn--sm" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const content = busy ? <Loader size={18} strokeWidth={1.75} className="sui-spin" /> : <Icon size={size === "sm" ? 17 : 19} strokeWidth={1.75} aria-hidden="true" />;

  const control = href && !onClick ? (
    <Link href={href} className={classes} aria-label={label} title={label} {...rest}>
      {content}
    </Link>
  ) : (
    <button type="button" className={classes} aria-label={label} title={label} onClick={onClick} disabled={busy || rest.disabled} {...rest}>
      {content}
    </button>
  );

  return tooltip ? <Tooltip label={label} placement={tooltipPlacement}>{control}</Tooltip> : control;
}

/**
 * Pilule de statut : texte foncé sur pastel, jamais l'inverse.
 * `variant="white"` pour une pilule blanche posée sur une carte mise en avant.
 */
export function StatusPill({ tone = "plain", icon: Icon, label, variant, className = "" }) {
  const flat = !TONE_BG[tone] || tone === "plain" || tone === "ghost";
  const classes = ["sui-status", flat ? "sui-status--plain" : "", variant === "white" ? "sui-status--white" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} style={flat ? undefined : { "--tone-bg": TONE_BG[tone] }}>
      {Icon ? <Icon size={14} strokeWidth={2} aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

/** Statut piloté par une clé métier (`ACTIVE`, `FAILED`…). */
export function StatusPillFor({ status, label, icon, variant }) {
  return <StatusPill tone={statusTone(status)} label={label ?? status} icon={icon} variant={variant} />;
}

/** Pilule cliquable : filtres, sélecteurs rapides. L'état actif est un noir plein. */
export function Pill({ active = false, onClick, children, count, href, className = "", ...rest }) {
  const classes = ["sui-pill", className].filter(Boolean).join(" ");
  const content = (
    <>
      {children}
      {count !== undefined && count !== null ? <span className="sui-pill__count">{count}</span> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes} aria-current={active ? "page" : undefined} {...rest}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={classes} aria-pressed={active} onClick={onClick} {...rest}>
      {content}
    </button>
  );
}

/**
 * Barre de filtres : pilules avec état actif, puis actions de droite
 * (bouton secondaire gris + bouton principal noir).
 */
export function FilterPills({ items, value, onChange, label = "Filtres", actions, className = "" }) {
  return (
    <div className={`sui-toolbar ${className}`.trim()}>
      <ul className="sui-filters" aria-label={label} role="list">
        {items.map((item) => (
          <li key={item.id}>
            <Pill active={item.id === value} onClick={() => onChange?.(item.id)} count={item.count}>
              {item.icon ? <item.icon size={16} strokeWidth={1.75} aria-hidden="true" /> : null}
              {item.label}
            </Pill>
          </li>
        ))}
      </ul>
      {actions ? <div className="sui-card__actions" style={{ marginLeft: "auto" }}>{actions}</div> : null}
    </div>
  );
}

/** Bouton texte : `ghost` (gris) ou `dark` (action principale). */
export function Button({ variant = "ghost", icon: Icon, children, href, className = "", ...rest }) {
  const classes = ["sui-btn", variant === "dark" ? "sui-btn--dark" : "", className].filter(Boolean).join(" ");
  const content = (
    <>
      {Icon ? <Icon size={17} strokeWidth={1.75} aria-hidden="true" /> : null}
      {children}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes} {...rest}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} {...rest}>
      {content}
    </button>
  );
}

/**
 * Message d'erreur ou de confirmation, en pastel : jamais de rouge saturé sur la
 * coque claire, et la même forme partout (rôle ARIA selon la gravité).
 */
export function Alert({ tone = "error", children, icon: Icon }) {
  const palette = tone === "success" ? "var(--green)" : tone === "warning" ? "var(--yellow)" : "var(--pink)";
  return (
    <p
      role={tone === "success" ? "status" : "alert"}
      className="sui-status"
      style={{ "--tone-bg": palette, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600 }}
    >
      {Icon ? <Icon size={16} strokeWidth={1.75} aria-hidden="true" /> : null}
      <span>{children}</span>
    </p>
  );
}

/** Rangée titre + actions d'une section (compteur optionnel). */
export function SectionHead({ icon: Icon, title, count, children }) {
  return (
    <div className="sui-section__head">
      <h2 className="sui-section__title">
        {Icon ? <Icon size={18} strokeWidth={1.75} aria-hidden="true" /> : null}
        {title}
        {count !== undefined && count !== null ? <span className="sui-section__count">{count}</span> : null}
      </h2>
      {children}
    </div>
  );
}
