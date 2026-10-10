"use client";

import { formatDate, formatMoney } from "@/lib/api";

/*
 * Rendu générique de données agrégées (tableaux de bord, résultats de rapports).
 * Les formes varient selon le type : on lit les clés pour décider du format.
 *  - nombres : indicateurs ; clés « minutes » : durée en heures ;
 *    clés « amount/total/revenue/…» : montant (devise du même objet, ou `currency`) ;
 *  - dates ISO : date lisible ; tableaux d'objets : tableau ; sous-objets : section.
 */

const LABELS = {
  asOf: "Relevé au", periodStart: "Début", periodEnd: "Fin", total: "Total", open: "En cours", active: "Actifs",
  overdue: "En retard", createdInPeriod: "Créés sur la période", averageProgress: "Avancement moyen (%)",
  byStatus: "Par statut", unread: "Non lues", recent: "Récentes", todayMinutes: "Aujourd’hui", monthMinutes: "Ce mois",
  monthEntries: "Saisies ce mois", count: "Nombre", amount: "Montant", currency: "Devise", revenue: "Chiffre d’affaires",
  outstanding: "Reste à encaisser", paid: "Encaissé", due: "À payer", tasks: "Tâches", timeEntries: "Temps",
  notifications: "Notifications", projects: "Projets", invoices: "Factures", quotes: "Devis", prospects: "Prospects",
  documents: "Documents", sections: "Sections", period: "Période", client: "Client", items: "Éléments", upcoming: "Échéances",
  billableMinutes: "Facturable", nonBillableMinutes: "Non facturable", minutes: "Durée",
};

const MONEY_KEY = /amount|total|revenue|outstanding|paid|due|cost|value|balance/i;
const MINUTES_KEY = /minutes/i;
const DATE_KEY = /(At|Date|Start|End|Start|start|end|from|to|asOf)$/;
const ISO = /^\d{4}-\d{2}-\d{2}T/;

export function labelOf(key) {
  if (LABELS[key]) return LABELS[key];
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatValue(key, value, siblings = {}) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && ISO.test(value) && DATE_KEY.test(key)) return formatDate(value);
  if (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)))) {
    if (MINUTES_KEY.test(key)) {
      const minutes = Math.round(Number(value));
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return hours > 0 ? `${hours} h ${String(rest).padStart(2, "0")}` : `${rest} min`;
    }
    if (MONEY_KEY.test(key) && !/count|percent|progress|status/i.test(key)) {
      const currency = siblings.currency ?? "DZD";
      return formatMoney(value, currency);
    }
    return new Intl.NumberFormat("fr-FR").format(Number(value));
  }
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  return String(value);
}

/** Un bloc : indicateurs, puis sous-sections et tableaux. */
export function DataView({ value, title, depth = 0 }) {
  if (value === null || value === undefined) return <p className="cx-small">Aucune donnée.</p>;
  if (typeof value !== "object") return <p className="text-[15px] text-[var(--comexa-ink)]">{formatValue(title ?? "", value)}</p>;

  const entries = Object.entries(value);
  const scalars = entries.filter(([, v]) => v === null || typeof v !== "object" || v instanceof Date);
  const nested = entries.filter(([, v]) => v !== null && typeof v === "object" && !Array.isArray(v));
  const lists = entries.filter(([, v]) => Array.isArray(v));
  const siblings = { currency: value.currency };

  return (
    <div className="flex flex-col gap-6">
      {scalars.filter(([k]) => k !== "currency").length > 0 ? (
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {scalars
            .filter(([k]) => k !== "currency")
            .map(([k, v]) => (
              <div key={k} className="rounded-lg border border-[var(--comexa-border-soft)] p-4">
                <dt className="text-[12.5px] text-[var(--comexa-ink-muted)]">{labelOf(k)}</dt>
                <dd className="mt-1 text-[20px] font-semibold text-[var(--comexa-ink)]">{formatValue(k, v, siblings)}</dd>
              </div>
            ))}
        </dl>
      ) : null}

      {nested.map(([k, v]) => (
        <section key={k} className="flex flex-col gap-3">
          <h5 className="text-[15px] font-semibold text-[var(--comexa-ink)]">{labelOf(k)}</h5>
          <DataView value={v} title={k} depth={depth + 1} />
        </section>
      ))}

      {lists.map(([k, v]) => (
        <section key={k} className="flex flex-col gap-3">
          <h5 className="text-[15px] font-semibold text-[var(--comexa-ink)]">{labelOf(k)} ({v.length})</h5>
          <ListTable rows={v} />
        </section>
      ))}
    </div>
  );
}

function ListTable({ rows }) {
  if (rows.length === 0) return <p className="cx-small">Aucun élément.</p>;
  if (rows.every((r) => r === null || typeof r !== "object")) {
    return (
      <ul className="flex flex-wrap gap-2 text-[14px]">
        {rows.map((r, i) => (
          <li key={i} className="rounded-full border border-[var(--comexa-border-soft)] px-3 py-1">{String(r)}</li>
        ))}
      </ul>
    );
  }
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r ?? {})))].filter((k) => rows.some((r) => r && (typeof r[k] !== "object" || r[k] === null || r[k] instanceof Date))).slice(0, 7);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-left text-[13.5px]">
        <thead>
          <tr className="border-b border-[var(--comexa-border-soft)] text-[var(--comexa-ink-muted)]">
            {columns.map((c) => (
              <th key={c} className="py-2 pr-4 font-medium">{labelOf(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((row, i) => (
            <tr key={row?.id ?? i} className="border-b border-[var(--comexa-border-soft)] align-top">
              {columns.map((c) => (
                <td key={c} className="py-2 pr-4">{formatValue(c, row?.[c], row ?? {})}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
