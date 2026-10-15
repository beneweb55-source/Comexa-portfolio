"use client";

import { Search } from "lucide-react";
import { Button } from "./primitives";

/** Action d'en-tête : bouton gris secondaire ou noir principal (soft UI). */
function HeaderAction({ action, primary = false }) {
  if (!action) return null;
  return (
    <Button
      variant={primary ? "dark" : "ghost"}
      icon={action.icon}
      href={action.href}
      onClick={action.onClick}
    >
      {action.label}
    </Button>
  );
}

/** La recherche n'apparaît que si un filtre est réellement branché. */
export default function PageHeader({ title, subtitle, icon: Icon, iconTone, breadcrumb, query, onQueryChange, searchPlaceholder = "Rechercher dans cet espace…", actions, primaryAction, secondaryAction, searchLabel }) {
  return (
    <div className="sui-head">
      <div className="sui-head__left">
        {Icon ? (
          <span
            className="sui-head__icon"
            aria-hidden="true"
            style={iconTone ? { "--tone-bg": `var(--${iconTone})` } : undefined}
          >
            <Icon size={24} strokeWidth={1.75} />
          </span>
        ) : null}
        <div className="min-w-0">
          {breadcrumb ? <p className="sui-head__crumb">{breadcrumb}</p> : null}
          <h1 className="sui-head__title">{title}</h1>
          {subtitle ? <p className="sui-head__sub">{subtitle}</p> : null}
        </div>
      </div>
      {(actions || primaryAction || secondaryAction || onQueryChange) ? (
        <div className="sui-head__actions">
          {actions}
          <HeaderAction action={secondaryAction} />
          <HeaderAction action={primaryAction} primary />
          {onQueryChange ? (
            <label className="sui-search">
              <Search size={17} strokeWidth={1.75} aria-hidden="true" />
              <span className="sui-visually-hidden">{searchLabel ?? "Rechercher dans la page"}</span>
              <input type="search" value={query ?? ""} placeholder={searchPlaceholder} onChange={(event) => onQueryChange(event.target.value)} />
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
