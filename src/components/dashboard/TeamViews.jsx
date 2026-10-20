"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { formatDate, formatMoney } from "@/lib/api";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { CurrencyAmounts } from "@/components/softui";
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
const percentFromRatio = (ratio) => {
  const value = Number(ratio);
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format((Number.isFinite(value) ? value : 0) * 100);
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
      <table className="cx-stack-table w-full text-left text-[14px]">
        <thead className="text-[12.5px] text-[var(--comexa-ink-muted)]">
          <tr>{columns.map((c) => <th key={c.key} className="pb-2 pr-4 font-medium">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id ?? row.reference} className="border-t border-[var(--comexa-border-soft)]">
              {columns.map((c) => <td key={c.key} data-label={c.label} className="py-2.5 pr-4 align-middle">{c.render(row)}</td>)}
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
  const instanceId = useId();
  const tabRefs = useRef([]);

  function focusTab(index) {
    const next = (index + tabs.length) % tabs.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  function handleKeyDown(event, index) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusTab(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusTab(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusTab(tabs.length - 1);
    }
  }

  return (
    <div>
      <div role="tablist" aria-label="Sections détaillées du tableau de bord" aria-orientation="horizontal" className="cx-dashboard__tabs">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(node) => { tabRefs.current[i] = node; }}
            id={`${instanceId}-tab-${tab.id}`}
            type="button"
            role="tab"
            tabIndex={active === i ? 0 : -1}
            aria-selected={active === i}
            aria-controls={`${instanceId}-panel-${tab.id}`}
            onClick={() => setActive(i)}
            onKeyDown={(event) => handleKeyDown(event, i)}
            className={`cx-dashboard__tab${active === i ? " is-active" : ""}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div key={tab.id} id={`${instanceId}-panel-${tab.id}`} role="tabpanel" tabIndex={0} aria-labelledby={`${instanceId}-tab-${tab.id}`} hidden={active !== i}>
          {active === i ? tab.content : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Montants d'une section du tableau de bord agence.
 *
 * Le backend expose `byCurrency` pour chaque agrégat : c'est la seule forme qui
 * permette d'afficher les deux monnaies sans les additionner. Les anciennes
 * réponses (ou un agrégat vide) n'ont que `currency` / `total` : on retombe
 * alors sur ce couple, jamais sur un total supposé commun.
 */
function amountsOf(section) {
  if (Array.isArray(section?.byCurrency) && section.byCurrency.length > 0) {
    return section.byCurrency;
  }
  if (section?.currency) {
    return [{ currency: section.currency, total: section.total ?? 0 }];
  }
  return [];
}

/** Vue de l'agence : données de GET /dashboard, réparties en trois onglets. */
export function AgencyView({ data, scope = DEFAULT_CURRENCY }) {
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
      <Stat label="Taux d’encaissement" value={`${percentFromRatio(d.collectionRate)} %`} hint={`Période du ${formatDate(d.period?.periodStart)} au ${formatDate(d.period?.periodEnd)}`} />
    </div>
  );

  const projectsFinance = (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <h3 className="text-[15px] font-semibold">Projets & prospects</h3>
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
          <Stat label="Encours" value={<CurrencyAmounts amounts={amountsOf(openInvoices)} scope={scope} />} hint={`${openInvoices.count ?? 0} facture(s)`} />
          <Stat label="En retard" value={<CurrencyAmounts amounts={amountsOf(overdue)} scope={scope} />} hint={`${overdue.count ?? 0} facture(s)`} />
          <Stat label="Émis sur la période" value={<CurrencyAmounts amounts={amountsOf(issued)} scope={scope} />} hint={`${issued.count ?? 0} facture(s)`} />
          <Stat label="Encaissé" value={<CurrencyAmounts amounts={amountsOf(collected)} scope={scope} />} hint={`${collected.count ?? 0} paiement(s)`} />
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

  const deadlines = (
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
          { id: "finance", label: "Activité & finances", content: projectsFinance },
          { id: "team", label: "Échéances", content: deadlines },
        ]}
      />
    </Card>
  );
}

/** Ma journée : données de GET /dashboard/me. */
export function MyDayView({ data }) {
  const sections = data.sections ?? {
    tasks: data.tasks != null,
    timeEntries: data.timeEntries != null,
    notifications: data.notifications != null,
  };
  const tasks = data.tasks ?? {};
  const time = data.timeEntries ?? {};
  const notif = data.notifications ?? {};
  const upcoming = Array.isArray(data.upcoming) ? data.upcoming : [];
  const stats = [];

  if (sections.tasks) stats.push(<Stat key="tasks" label="Tâches ouvertes" value={tasks.open ?? 0} hint={`${tasks.overdue ?? 0} en retard`} />);
  if (sections.timeEntries) {
    stats.push(<Stat key="time-today" label="Temps aujourd’hui" value={hm(time.todayMinutes)} />);
    stats.push(<Stat key="time-month" label="Temps ce mois" value={hm(time.monthMinutes)} hint={`${time.monthEntries ?? 0} saisie(s)`} />);
  }
  if (sections.notifications) stats.push(<Stat key="notifications" label="Notifications non lues" value={notif.unread ?? 0} />);

  const recentNotifications = sections.notifications ? (notif.recent ?? []).slice(0, 4) : [];
  return (
    <div className="flex flex-col gap-6">
      {stats.length ? <div className="cx-dashboard__detail-stats">{stats}</div> : <Empty title="Aucune donnée personnelle disponible" />}

      {sections.tasks ? (
        <section className="cx-dashboard__detail-section" aria-labelledby="cx-myday-deadlines-title">
          <div className="cx-dashboard__detail-section-head">
            <div>
              <h3 id="cx-myday-deadlines-title" className="text-[15px] font-semibold">Mes prochaines échéances</h3>
              <p className="cx-dashboard__muted">Les tâches qui approchent selon votre périmètre.</p>
            </div>
            <Link href="/espace-equipe/taches" className="cx-dashboard__text-link">Voir les tâches <span aria-hidden="true">→</span></Link>
          </div>
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
        </section>
      ) : null}

      {sections.notifications ? (
        <section className="cx-dashboard__detail-section" aria-labelledby="cx-myday-notifications-title">
          <div className="cx-dashboard__detail-section-head">
            <div>
              <h3 id="cx-myday-notifications-title" className="text-[15px] font-semibold">Notifications récentes</h3>
              <p className="cx-dashboard__muted">Les dernières alertes associées à votre compte.</p>
            </div>
            <Link href="/espace-equipe/notifications" className="cx-dashboard__text-link">Ouvrir les notifications <span aria-hidden="true">→</span></Link>
          </div>
          {recentNotifications.length ? (
            <ul className="cx-dashboard__notification-list">
              {recentNotifications.map((notification) => (
                <li key={notification.id} className="cx-dashboard__notification-item">
                  <span className="cx-dashboard__notification-dot" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="cx-dashboard__notification-title">{notification.title}</p>
                    <p className="cx-dashboard__muted">{formatDate(notification.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty title="Aucune notification récente." />}
        </section>
      ) : null}
    </div>
  );
}
