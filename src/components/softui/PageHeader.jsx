"use client";

import Link from "next/link";
import { Search } from "lucide-react";

function HeaderAction({ action, primary = false }) {
  if (!action) return null;
  const Icon = action.icon;
  const className = `cx-btn ${primary ? "cx-btn--primary" : "cx-btn--secondary"}`;
  const content = <>{Icon ? <Icon size={16} aria-hidden="true" /> : null}{action.label}</>;
  return action.href ? (
    <Link href={action.href} className={className}>{content}</Link>
  ) : (
    <button type="button" className={className} onClick={action.onClick}>{content}</button>
  );
}

/** La recherche n'apparaît que si un filtre est réellement branché. */
export default function PageHeader({ title, subtitle, icon: Icon, breadcrumb, query, onQueryChange, searchPlaceholder = "Rechercher dans cet espace…", actions, primaryAction, secondaryAction, searchLabel }) {
  return (
    <div className="sui-head">
      <div className="sui-head__left">
        {Icon ? <span className="sui-head__icon" aria-hidden="true"><Icon size={24} strokeWidth={1.75} /></span> : null}
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
