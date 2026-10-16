"use client";

import { Search } from "lucide-react";
import { Button } from "./primitives";
import Tooltip from "./Tooltip";

/** Action d'en-tête : bouton gris secondaire ou noir principal (soft UI). */
function HeaderAction({ action, primary = false }) {
  if (!action) return null;
  return (
    <Button variant={primary ? "dark" : "ghost"} icon={action.icon} href={action.href} onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

/**
 * En-tête de page : pastille, fil d'Ariane (espace · pôle), titre, description
 * de la rubrique, puis la barre d'outils à droite.
 *
 * Barre d'outils, dans un ordre fixe d'une page à l'autre :
 *   [recherche dans la page] [recherche globale ⌘K] [action principale]
 * La recherche locale n'apparaît que si la page consomme réellement le filtre ;
 * la recherche globale est un bouton icône (elle volait la place du champ local
 * et doublait le libellé « Rechercher » à l'écran).
 */
export default function PageHeader({
  title,
  subtitle,
  icon: Icon,
  iconTone,
  breadcrumb,
  query,
  onQueryChange,
  searchPlaceholder = "Rechercher dans cet espace…",
  searchLabel,
  onGlobalSearch,
  actions,
  primaryAction,
  secondaryAction,
}) {
  const hasTools = Boolean(actions || primaryAction || secondaryAction || onQueryChange || onGlobalSearch);
  return (
    <div className="sui-head">
      <div className="sui-head__left">
        {Icon ? (
          <span className="sui-head__icon" aria-hidden="true" style={iconTone ? { "--tone-bg": `var(--${iconTone})` } : undefined}>
            <Icon size={24} strokeWidth={1.75} />
          </span>
        ) : null}
        <div className="min-w-0">
          {breadcrumb ? <p className="sui-head__crumb">{breadcrumb}</p> : null}
          <h1 className="sui-head__title">{title}</h1>
          {subtitle ? <p className="sui-head__sub">{subtitle}</p> : null}
        </div>
      </div>
      {hasTools ? (
        <div className="sui-head__actions">
          {onQueryChange ? (
            <label className="sui-search">
              <Search size={17} strokeWidth={1.75} aria-hidden="true" />
              <span className="sui-visually-hidden">{searchLabel ?? "Rechercher dans la page"}</span>
              <input type="search" value={query ?? ""} placeholder={searchPlaceholder} onChange={(event) => onQueryChange(event.target.value)} />
            </label>
          ) : null}
          {onGlobalSearch ? (
            <Tooltip label="Recherche globale dans l’espace (Ctrl+K)" placement="bottom">
              <button type="button" className="sui-iconbtn sui-head__global" aria-label="Recherche globale dans l’espace (Ctrl+K)" aria-keyshortcuts="Control+K" onClick={onGlobalSearch}>
                <Search size={18} strokeWidth={1.75} aria-hidden="true" />
                <kbd className="sui-head__kbd">Ctrl K</kbd>
              </button>
            </Tooltip>
          ) : null}
          {actions}
          <HeaderAction action={secondaryAction} />
          <HeaderAction action={primaryAction} primary />
        </div>
      ) : null}
    </div>
  );
}
