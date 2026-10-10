"use client";

import { useState } from "react";
import { formatDate, formatMoney } from "@/lib/api";
import { PROJECT_STATUS, TASK_STATUS } from "@/lib/labels";
import { INVOICE_STATUS, INVOICE_STATUS_TONE, PAYMENT_METHOD, PROSPECT_STATUS } from "@/lib/commercial";
import { Badge, Card, Empty } from "@/components/workspace/ui";

const HEALTH = { ON_TRACK: "Dans les temps", AT_RISK: "À risque", DELAYED: "En retard", ON_HOLD: "En pause" };
const HEALTH_TONE = { ON_TRACK: "success", AT_RISK: "warning", DELAYED: "danger", ON_HOLD: "neutral" };
const TASK_TONE = { TODO: "neutral", IN_PROGRESS: "info", BLOCKED: "danger", IN_REVIEW: "warning", DONE: "success", CANCELLED: "neutral" };
const PRIORITY = { LOW: "Basse", NORMAL: "Normale", HIGH: "Haute", URGENT: "Urgente" };

const label = (map, key) => map?.[key] ?? key ?? "—";
const hm = (minutes) => {
  const m = Number(minutes) || 0;
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
};

/** Carte de chiffre : libellé, valeur, précision facultative. */
export function Stat({ label: text, value, hint }) {
  return (
    <div className="rounded-2xl border border-[var(--comexa-border-soft)] bg-white p-4">
      <p className="text-[12.5px] text-[var(--comexa-ink-muted)]">{text}</p>
      <p className="mt-1 text-[22px] font-semibold tracking-tight text-[var(--comexa-ink)]">{value}</p>
      {hint ? <p className="mt-0.5 text-[12.5px] text-[var(--comexa-ink-muted)]">{hint}</p> : null}
    </div>
  );
}

/** Répartition « statut → nombre » sous forme de badges. */
function Breakdown({ rows, map, tones }) {
  if (!rows?.length) return <p className="cx-small">Aucun élément.</p>;
  return (
    <ul className="flex flex-wrap gap-2">
      {rows.map((row) => (
        <li key={row.status} className="flex items-center gap-2">
          <Badge tone={tones?.[row.status] ?? "neutral"}>{label(map, row.status)}</Badge>
          <span className="text-[13px] tabular-nums text-[var(--comexa-ink-soft)]">{row.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** Tableau simple : colonnes [{ key, label, render }]. */
function Table({ columns, rows, empty }) {
  if (!rows.length) return <Empty title={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[14px]">
        <thead className="text-[12.5px] text-[var(--comexa-ink-muted)]">
          <tr>{columns.map((c) => <th key={c.key} className="pb-2 pr-4 font-medium">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id ?? row.reference} className="border-t border-[var(--comexa-border-soft)]">
              {columns.map((c) => <td key={c.key} className="py-2.5 pr-4 align-middle">{c.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Onglets accessibles (rôles tablist/tab) : une seule vue visible à la fois. */
export function Tabs({ tabs, initial = 0 }) {
  const [active, setActive] = useState(initial);
  return (
    <div>
      <div role="tablist" aria-label="Sections du tableau de bord" className="mb-5 flex flex-wrap gap-1 rounded-2xl bg-[var(--comexa-neutral-100)] p-1">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === i}
            aria-controls={`panel-${tab.id}`}
            onClick={() => setActive(i)}
            className={`rounded-xl px-4 py-2 text-[13.5px] font-medium ${active === i ? "bg-white text-[var(--comexa-ink)] shadow-sm" : "text-[var(--comexa-ink-soft)] hover:text-[var(--comexa-ink)]"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div key={tab.id} id={`panel-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`} hidden={active !== i}>
          {active === i ? tab.content : null}
        </div>
      ))}
    </div>
  );
}

/** Vue de l'agence : données de GET /dashboard, réparties en trois onglets. */
export function AgencyView({ data }) {
  const d = data;
  const openInvoices = d.invoices?.open ?? {};
  const overdue = d.invoices?.overdue ?? {};
  const issued = d.invoices?.issuedInPeriod ?? {};
  const collected = d.collected ?? {};
  const upcomingTasks = d.upcoming?.tasks ?? [];
  const upcomingInvoices = d.upcoming?.invoices ?? [];

  const overview = (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Prospects ouverts" value={d.prospects?.open ?? 0} hint={`${d.prospects?.createdInPeriod ?? 0} créés sur la période`} />
      <Stat label="Projets actifs" value={d.projects?.active ?? 0} hint={`${d.projects?.overdue ?? 0} en retard`} />
      <Stat label="Tâches ouvertes" value={d.tasks?.open ?? 0} hint={`${d.tasks?.overdue ?? 0} en retard`} />
      <Stat label="Taux d’encaissement" value={`${Number(d.collectionRate ?? 0)} %`} hint={`Période du ${formatDate(d.period?.periodStart)} au ${formatDate(d.period?.periodEnd)}`} />
    </div>
  );

  const projectsFinance = (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <h3 className="text-[15px] font-semibold">Projets</h3>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Total" value={d.projects?.total ?? 0} />
          <Stat label="Avancement moyen" value={`${d.projects?.averageProgress ?? 0} %`} />
        </div>
        <div>
          <p className="mb-2 text-[12.5px] text-[var(--comexa-ink-muted)]">Par statut</p>
          <Breakdown rows={d.projects?.byStatus} map={PROJECT_STATUS} tones={{ IN_PROGRESS: "info", COMPLETED: "success", ON_HOLD: "warning" }} />
        </div>
        <div>
          <p className="mb-2 text-[12.5px] text-[var(--comexa-ink-muted)]">Santé</p>
          <Breakdown rows={d.projects?.byHealth} map={HEALTH} tones={HEALTH_TONE} />
        </div>
        <div>
          <p className="mb-2 text-[12.5px] text-[var(--comexa-ink-muted)]">Prospects par statut</p>
          <Breakdown rows={d.prospects?.byStatus} map={PROSPECT_STATUS} />
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <h3 className="text-[15px] font-semibold">Facturation</h3>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Encours" value={formatMoney(openInvoices.total, openInvoices.currency)} hint={`${openInvoices.count ?? 0} facture(s)`} />
          <Stat label="En retard" value={formatMoney(overdue.total, overdue.currency)} hint={`${overdue.count ?? 0} facture(s)`} />
          <Stat label="Émis sur la période" value={formatMoney(issued.total, issued.currency)} hint={`${issued.count ?? 0} facture(s)`} />
          <Stat label="Encaissé" value={formatMoney(collected.total, collected.currency)} hint={`${collected.count ?? 0} paiement(s)`} />
        </div>
        {collected.byMethod?.length ? (
          <div>
            <p className="mb-2 text-[12.5px] text-[var(--comexa-ink-muted)]">Encaissements par mode</p>
            <ul className="flex flex-col gap-1 text-[14px]">
              {collected.byMethod.map((m) => (
                <li key={m.method} className="flex justify-between">
                  <span>{label(PAYMENT_METHOD, m.method)}</span>
                  <span className="tabular-nums">{formatMoney(m.total, m.currency ?? collected.currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );

  const teamTime = (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <h3 className="text-[15px] font-semibold">Tâches à venir</h3>
        <Table
          empty="Aucune tâche à venir."
          rows={upcomingTasks}
          columns={[
            { key: "title", label: "Tâche", render: (t) => <span className="font-medium">{t.title}</span> },
            { key: "project", label: "Projet", render: (t) => t.projectName ?? "—" },
            { key: "who", label: "Assignée à", render: (t) => t.assigneeName ?? "Non assignée" },
            { key: "due", label: "Échéance", render: (t) => formatDate(t.dueDate) },
            { key: "status", label: "Statut", render: (t) => <Badge tone={TASK_TONE[t.status] ?? "neutral"}>{label(TASK_STATUS, t.status)}</Badge> },
          ]}
        />
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="text-[15px] font-semibold">Factures à échéance</h3>
        <Table
          empty="Aucune facture à échéance."
          rows={upcomingInvoices}
          columns={[
            { key: "ref", label: "Référence", render: (i) => <span className="font-medium">{i.reference}</span> },
            { key: "client", label: "Client", render: (i) => i.clientName ?? "—" },
            { key: "due", label: "Échéance", render: (i) => formatDate(i.dueDate) },
            { key: "due2", label: "Reste dû", render: (i) => formatMoney(i.outstanding, i.currency) },
            { key: "status", label: "Statut", render: (i) => <Badge tone={INVOICE_STATUS_TONE[i.status] ?? "neutral"}>{label(INVOICE_STATUS, i.status)}</Badge> },
          ]}
        />
      </div>
    </div>
  );

  return (
    <Card title="Vue de l’agence">
      <Tabs
        tabs={[
          { id: "overview", label: "Vue d’ensemble", content: overview },
          { id: "finance", label: "Projets & finances", content: projectsFinance },
          { id: "team", label: "Équipe & temps", content: teamTime },
        ]}
      />
    </Card>
  );
}

/** Ma journée : données de GET /dashboard/me. */
export function MyDayView({ data }) {
  const tasks = data.tasks ?? {};
  const time = data.timeEntries ?? {};
  const notif = data.notifications ?? {};
  const upcoming = data.upcoming ?? [];
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tâches ouvertes" value={tasks.open ?? 0} hint={`${tasks.overdue ?? 0} en retard`} />
        <Stat label="Temps aujourd’hui" value={hm(time.todayMinutes)} />
        <Stat label="Temps ce mois" value={hm(time.monthMinutes)} hint={`${time.monthEntries ?? 0} saisie(s)`} />
        <Stat label="Notifications non lues" value={notif.unread ?? 0} />
      </div>
      <div>
        <h3 className="mb-2 text-[15px] font-semibold">Mes prochaines échéances</h3>
        <Table
          empty="Aucune échéance à venir."
          rows={upcoming}
          columns={[
            { key: "title", label: "Tâche", render: (t) => <span className="font-medium">{t.title}</span> },
            { key: "project", label: "Projet", render: (t) => t.projectName ?? "—" },
            { key: "due", label: "Échéance", render: (t) => formatDate(t.dueDate) },
            { key: "priority", label: "Priorité", render: (t) => PRIORITY[t.priority] ?? "—" },
            { key: "status", label: "Statut", render: (t) => <Badge tone={TASK_TONE[t.status] ?? "neutral"}>{label(TASK_STATUS, t.status)}</Badge> },
          ]}
        />
      </div>
    </div>
  );
}
