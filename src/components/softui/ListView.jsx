"use client";

/*
 * Affichage « Cartes / Liste » des pages de collection (projets, factures…).
 *
 *  - `useViewMode(key, défaut)` : préférence mémorisée par page dans le
 *    navigateur (aucune donnée métier) ;
 *  - `ViewToggle` : contrôle segmenté accessible (`aria-pressed`) ;
 *  - `ListTable` : tableau soft UI, lignes cliquables par leur lien principal,
 *    défilement horizontal contenu dans la carte sur petit écran (jamais la page).
 */

import Link from "next/link";
import { useCallback, useState } from "react";
import { LayoutGrid, List } from "lucide-react";

export function useViewMode(key, fallback = "cards") {
  const storageKey = `comexa:view:${key}`;
  const [mode, setMode] = useState(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const value = window.localStorage.getItem(storageKey);
      return value === "cards" || value === "list" ? value : fallback;
    } catch {
      return fallback;
    }
  });
  const update = useCallback(
    (next) => {
      setMode(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // préférence non mémorisée : valable pour la session
      }
    },
    [storageKey],
  );
  return [mode, update];
}

export function ViewToggle({ value, onChange, label = "Affichage" }) {
  const options = [
    { id: "cards", label: "Cartes", icon: LayoutGrid },
    { id: "list", label: "Liste", icon: List },
  ];
  return (
    <div className="sui-viewtoggle" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="sui-viewtoggle__btn"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          title={option.label}
        >
          <option.icon size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * `columns` : [{ key, label, render(row), align?, className? }].
 * `rowHref(row)` : lien principal de la ligne (rendu sur la première colonne).
 */
export function ListTable({ columns, rows, rowHref, label, rowKey = (row) => row.id }) {
  return (
    <div className="sui-table-wrap">
      <table className="sui-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.align === "end" ? "is-end" : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column, index) => {
                const content = column.render(row);
                return (
                  <td key={column.key} className={[column.align === "end" ? "is-end" : "", column.className ?? ""].filter(Boolean).join(" ") || undefined}>
                    {index === 0 && rowHref ? (
                      <Link href={rowHref(row)} className="sui-table__link">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
