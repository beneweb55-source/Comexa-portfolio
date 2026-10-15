"use client";

/*
 * En-tête de page : grand titre + icône lucide dans une pastille pastel,
 * sous-titre gris, recherche en pilule. La recherche alimente le contexte partagé
 * du Shell (`useShellQuery`) : les pages qui exposent un paramètre `search`
 * l'utilisent pour filtrer côté API.
 */

import { Search } from "lucide-react";

export default function PageHeader({ title, subtitle, icon: Icon, breadcrumb, query, onQueryChange, searchPlaceholder = "Rechercher dans cet espace…", actions, searchLabel }) {
  return (
    <div className="sui-head">
      <div className="sui-head__left">
        {Icon ? (
          <span className="sui-head__icon" aria-hidden="true">
            <Icon size={24} strokeWidth={1.75} />
          </span>
        ) : null}
        <div>
          {breadcrumb ? <p className="sui-head__crumb">{breadcrumb}</p> : null}
          <h1 className="sui-head__title">{title}</h1>
          {subtitle ? <p className="sui-head__sub">{subtitle}</p> : null}
        </div>
      </div>

      <div className="sui-head__left" style={{ gap: 10 }}>
        {actions}
        <label className="sui-search">
          <Search size={17} strokeWidth={1.75} aria-hidden="true" />
          <span className="sui-visually-hidden">{searchLabel ?? "Rechercher dans la page"}</span>
          <input
            type="search"
            value={query ?? ""}
            placeholder={searchPlaceholder}
            onChange={(event) => onQueryChange?.(event.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
