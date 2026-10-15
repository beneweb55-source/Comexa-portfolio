"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDate } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { canLogTime, canUseTimer } from "@/lib/timer-access";
import { PROSPECT_STATUS } from "@/lib/commercial";
import { TASK_STATUS } from "@/lib/labels";
import ProspectBoard from "@/components/workspace/ProspectBoard";
import { Pagination } from "@/components/workspace/ui";
import GlassCard from "@/components/dashboard/GlassCard";
import MeshBackground from "@/components/dashboard/MeshBackground";
import Icon from "@/components/dashboard/icons";
import {
  DistributionTile,
  DueTile,
  FinanceTile,
  HealthTile,
  KpiTile,
  TileError,
  TileSkeleton,
  TimerTile,
} from "@/components/dashboard/DashboardTiles";

const AGENCY_PERIOD_OPTIONS = [
  ["TODAY", "Aujourd’hui"],
  ["LAST_7_DAYS", "7 derniers jours"],
  ["LAST_30_DAYS", "30 derniers jours"],
  ["THIS_MONTH", "Ce mois"],
  ["LAST_MONTH", "Mois dernier"],
  ["THIS_QUARTER", "Ce trimestre"],
  ["THIS_YEAR", "Cette année"],
  ["LAST_YEAR", "Année dernière"],
];

/*
 * Tableau de bord « bento » de l'espace équipe. Toutes les valeurs viennent de l'API.
 *
 *   Accueil : salutation, contexte de vue, raccourcis et fraîcheur des données.
 *   Repères clés : quatre indicateurs d'agence ou les indicateurs personnels autorisés.
 *   Activité : répartition par statut et minuteur, si le rôle le permet.
 *   À surveiller : facturation, santé des projets, tâches et factures à échéance.
 *   Pipeline : synthèse compacte, Kanban complet repliable et paginé.
 *
 * Chaque tuile respecte les droits du porteur et les sections renvoyées par
 * `/dashboard/me` ; aucune valeur métier n'est remplacée ou simulée ici.
 */
export default function BentoDashboard({ me, agency, canSeeAgency, agencyPeriod, onAgencyPeriodChange }) {
  const { user } = useAuth();
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [pipelineLoaded, setPipelineLoaded] = useState(false);
  const [prospectPage, setProspectPage] = useState(1);
  const [timerTaskPage, setTimerTaskPage] = useState(1);
  const name = user?.firstName ?? "";
  const now = new Date();
  const today = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const asOf = agency.data?.asOf ?? me.data?.asOf ?? null;

  const canSeePipeline = can(user, "prospect:read:any") || can(user, "prospect:read:own");
  const shouldLoadProspects = canSeePipeline && (!canSeeAgency || pipelineLoaded);
  const prospects = useListing(shouldLoadProspects ? `/prospects?page=${prospectPage}&perPage=35` : null);
  const timerTasks = useListing(canUseTimer(user) ? `/me/tasks?page=${timerTaskPage}&perPage=50` : null);
  const refreshing = me.loading || (canSeeAgency && agency.loading) || (shouldLoadProspects && prospects.loading) || (canUseTimer(user) && timerTasks.loading);

  function reloadAll() {
    me.reload();
    if (canSeeAgency) agency.reload();
    if (shouldLoadProspects) prospects.reload();
    if (canUseTimer(user)) timerTasks.reload();
  }

  const period = agency.data?.period;
  const periodLabel = period?.periodStart && period?.periodEnd
    ? `Du ${formatDate(period.periodStart)} au ${formatDate(period.periodEnd)}`
    : "Période en cours";

  return (
    <section aria-label="Tableau de bord" className="cx-dashboard relative">
      <MeshBackground />
      <header className={`cx-dashboard__welcome${canSeeAgency ? " is-agency" : " is-personal"}`}>
        <div className="cx-dashboard__welcome-copy">
          <div className="cx-dashboard__welcome-eyebrow">
            <span className="cx-dashboard__mode">{canSeeAgency ? "Pilotage agence" : "Votre espace"}</span>
            <time className="cx-dashboard__date" dateTime={todayIso}>{today}</time>
          </div>
          <h2 className="cx-dashboard__welcome-title">Bonjour{name ? `, ${name}` : ""}</h2>
          <p className="cx-dashboard__welcome-subtitle">
            {canSeeAgency ? "Une vue claire de l’activité, des priorités et des résultats de l’agence." : "Vos priorités, votre activité et les prochaines échéances."}
          </p>
        </div>
        <div className="cx-dashboard__welcome-actions">
          <QuickActions user={user} />
          <div className="cx-dashboard__refresh-group">
            <button type="button" onClick={reloadAll} className="cx-dashboard__refresh" disabled={refreshing}>
              <Icon name="history" className="h-4 w-4" />
              {refreshing ? "Actualisation…" : "Actualiser"}
            </button>
            <p className="cx-dashboard__freshness" aria-live="polite">
              <span className={`cx-dashboard__freshness-dot${asOf ? " is-ready" : ""}`} aria-hidden="true" />
              {asOf ? `Mis à jour le ${formatDate(asOf)} à ${formatTime(asOf)}` : "Chargement des données réelles…"}
            </p>
          </div>
        </div>
      </header>

      <section className="cx-dashboard__section" aria-labelledby="cx-dashboard-kpis-title">
        <div className="cx-dashboard__section-heading">
          <div>
            <p className="cx-dashboard__section-eyebrow">Vue d’ensemble</p>
            <h3 id="cx-dashboard-kpis-title" className="cx-dashboard__section-title">Repères clés</h3>
          </div>
          {canSeeAgency ? (
            <div className="cx-dashboard__period-control">
              <label className="cx-dashboard__period-label">
                <span>Période</span>
                <select
                  className="cx-dashboard__period-select"
                  value={agencyPeriod}
                  onChange={(event) => onAgencyPeriodChange(event.target.value)}
                  disabled={agency.loading}
                  aria-label="Période des indicateurs de l’agence"
                >
                  {AGENCY_PERIOD_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <span className="cx-dashboard__period" aria-live="polite">
                {agency.loading ? "Chargement de la période…" : agency.error ? "Période non actualisée" : periodLabel}
              </span>
            </div>
          ) : <span className="cx-dashboard__period">Données personnelles</span>}
        </div>
        <div className="cx-dashboard__kpi-grid">
          <Kpis me={me} agency={agency} canSeeAgency={canSeeAgency} user={user} />
        </div>
      </section>

      <section className="cx-dashboard__section" aria-labelledby="cx-dashboard-activity-title">
        <div className="cx-dashboard__section-heading">
          <div>
            <p className="cx-dashboard__section-eyebrow">Activité</p>
            <h3 id="cx-dashboard-activity-title" className="cx-dashboard__section-title">Répartition et suivi</h3>
          </div>
        </div>
        <div className="cx-dashboard__grid grid grid-cols-1 gap-4 lg:grid-cols-12">
          {canSeeAgency ? (
            <AgencyDistribution agency={agency} className={canUseTimer(user) ? "lg:col-span-8" : "lg:col-span-12"} />
          ) : (
            <MyDistribution me={me} className={canUseTimer(user) ? "lg:col-span-8" : "lg:col-span-12"} />
          )}
          {canUseTimer(user) ? <TimerTile tasks={timerTasks} onTaskPageChange={setTimerTaskPage} className="lg:col-span-4" /> : null}
        </div>
      </section>

      <section className="cx-dashboard__section" aria-labelledby="cx-dashboard-priorities-title">
        <div className="cx-dashboard__section-heading">
          <div>
            <p className="cx-dashboard__section-eyebrow">À surveiller</p>
            <h3 id="cx-dashboard-priorities-title" className="cx-dashboard__section-title">Prochaines échéances</h3>
          </div>
          <span className="cx-dashboard__section-note">Les éléments sont affichés selon vos autorisations</span>
        </div>
        <div className="cx-dashboard__grid grid grid-cols-1 gap-4 lg:grid-cols-12">
          {canSeeAgency ? (
            <>
              <AgencyFinance agency={agency} className="lg:col-span-4" />
              <AgencyHealth agency={agency} className="lg:col-span-4" />
              <AgencyDue agency={agency} user={user} className="lg:col-span-4" />
            </>
          ) : (
            <MyDue me={me} user={user} className="lg:col-span-12" />
          )}
        </div>
      </section>

      {canSeePipeline ? (
        <GlassCard className="cx-dashboard__pipeline flex flex-col gap-5 p-5 md:p-6">
          <div className="cx-dashboard__pipeline-head">
            <div className="flex items-center gap-4">
              <span className="cx-dashboard__pipeline-icon"><Icon name="kanban" /></span>
              <div>
                <p className="cx-dashboard__section-eyebrow">Développement commercial</p>
                <h3 className="!text-[17px] !font-bold !text-[#152f4d]">Pipeline commercial</h3>
                <p className="cx-dashboard__muted">
                  {canSeeAgency && !can(user, "prospect:read:any")
                    ? "Synthèse de l’agence ; la liste détaillée reste limitée à votre portefeuille."
                    : canSeeAgency
                      ? "Synthèse de l’activité commerciale de l’agence."
                      : "Aperçu des prospects accessibles à votre rôle."}
                </p>
              </div>
            </div>
            <div className="cx-dashboard__pipeline-actions">
              {canSeeAgency && agency.data?.prospects ? (
                <span className="cx-dashboard__pipeline-total">{agency.data.prospects.total} prospects · {agency.data.prospects.open} ouverts</span>
              ) : prospects.meta ? (
                <span className="cx-dashboard__pipeline-total">{prospects.meta.total} prospect{prospects.meta.total === 1 ? "" : "s"} dans votre périmètre</span>
              ) : null}
              <Link href="/espace-equipe/prospects" className="cx-dashboard__text-link">{can(user, "prospect:read:any") ? "Ouvrir le pipeline" : "Voir mon portefeuille"} <span aria-hidden="true">→</span></Link>
            </div>
          </div>

          {canSeeAgency && agency.data?.prospects?.byStatus ? (
            <ul className="cx-dashboard__pipeline-summary" aria-label="Répartition des prospects par étape">
              {Object.entries(PROSPECT_STATUS).map(([status, label]) => {
                const count = agency.data.prospects.byStatus.find((row) => row.status === status)?.count ?? 0;
                return (
                  <li key={status} className="cx-dashboard__pipeline-stage">
                    <span>{label}</span>
                    <strong>{count}</strong>
                  </li>
                );
              })}
            </ul>
          ) : !canSeeAgency && prospects.error ? <TileError message={prospects.error} onRetry={prospects.reload} /> : null}

          <details
            className="cx-dashboard__pipeline-details"
            open={pipelineOpen}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setPipelineOpen(open);
              if (open) setPipelineLoaded(true);
            }}
          >
            <summary>
              <span>{pipelineOpen ? "Replier le tableau Kanban" : "Afficher le tableau Kanban"}</span>
              <span className="cx-dashboard__details-hint">{pipelineOpen ? "Déplacements accessibles au clavier" : "Aperçu compact · développement détaillé à la demande"}</span>
            </summary>
            {prospects.error ? <TileError message={prospects.error} onRetry={prospects.reload} /> : null}
            {!prospects.meta && prospects.loading && !prospects.error ? <TileSkeleton /> : null}
            {prospects.meta && prospects.items ? (
              <>
                <ProspectBoard items={prospects.items} onChanged={prospects.reload} tone="light" />
                <Pagination meta={prospects.meta} onPageChange={setProspectPage} loading={prospects.loading} label="Pagination des prospects du tableau de bord" />
              </>
            ) : null}
          </details>
        </GlassCard>
      ) : null}
    </section>
  );
}

/* ---------- Actions rapides : seulement celles que le porteur peut utiliser ---------- */

function QuickActions({ user }) {
  const actions = [
    { href: "/espace-equipe/taches", label: "Tâches", icon: "kanban", show: can(user, "task:write:any") || can(user, "task:write:own") },
    { href: "/espace-equipe/temps", label: "Saisir du temps", icon: "clock", show: can(user, "time:write:own") || can(user, "time:read:own") || can(user, "time:read:any") },
    { href: "/espace-equipe/rapports-journaliers", label: "Rapport du jour", icon: "doc", show: can(user, "time:write:own") || can(user, "time:read:any") },
    { href: "/espace-equipe/calendrier", label: "Calendrier", icon: "calendar", show: can(user, "task:read:any") },
  ].filter((action) => action.show);
  if (actions.length === 0) return null;
  return (
    <nav aria-label="Actions rapides" className="cx-dashboard__quick-actions">
      {actions.map((action) => (
        <Link key={action.href} href={action.href} className="cx-dashboard__quick-action">
          <Icon name={action.icon} className="h-4 w-4" />
          <span>{action.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/* ---------- Ligne 1 ---------- */

function Kpis({ me, agency, canSeeAgency, user }) {
  const source = canSeeAgency ? agency : me;
  if (source.loading && !source.data) {
    return [0, 1, 2, 3].map((i) => <TileSkeleton key={i} className="cx-dashboard__kpi-item" />);
  }
  if (source.error && !source.data) {
    return <TileError className="cx-dashboard__kpi-error" message={source.error} onRetry={source.reload} />;
  }
  if (!source.data) return null;

  const cardClass = "cx-dashboard__kpi-item";
  if (canSeeAgency) {
    const d = agency.data;
    return (
      <>
        <KpiTile href={can(user, "prospect:read:any") ? "/espace-equipe/prospects" : undefined} className={cardClass} label="Prospects ouverts" value={d.prospects?.open ?? 0} sub={`${d.prospects?.createdInPeriod ?? 0} créés sur la période`} icon="users" tone="sky" />
        <KpiTile href={can(user, "project:read:any") ? "/espace-equipe/projets" : undefined} className={cardClass} label="Projets actifs" value={d.projects?.active ?? 0} sub={`${d.projects?.overdue ?? 0} en retard · avancement moyen ${d.projects?.averageProgress ?? 0} %`} icon="folder" tone="amber" />
        <KpiTile href={can(user, "task:read:any") ? "/espace-equipe/taches" : undefined} className={cardClass} label="Tâches ouvertes" value={d.tasks?.open ?? 0} sub={`${d.tasks?.overdue ?? 0} en retard`} icon="kanban" tone="accent" />
        <KpiTile href={can(user, "invoice:read:any") ? "/espace-equipe/factures" : undefined} className={cardClass} label="Taux d’encaissement" value={`${formatPercent(d.collectionRate)} %`} sub="Encaissé / facturé sur la période" icon="money" tone="mint" bar={clampPct(Number(d.collectionRate ?? 0) * 100)} />
      </>
    );
  }

  const d = me.data;
  const cards = [];
  if (me.data.sections?.tasks) {
    cards.push(<KpiTile key="tasks" href={can(user, "task:read:any") || can(user, "task:read:assigned") || can(user, "task:read:own") ? "/espace-equipe/taches" : undefined} className={cardClass} label="Tâches ouvertes" value={d.tasks?.open ?? 0} sub={`${d.tasks?.overdue ?? 0} en retard`} icon="kanban" tone="accent" />);
  }
  if (me.data.sections?.timeEntries) {
    const timeHref = can(user, "time:read:any") || can(user, "time:read:own") || canLogTime(user) ? "/espace-equipe/temps" : undefined;
    cards.push(<KpiTile key="time-today" href={timeHref} className={cardClass} label="Temps aujourd’hui" value={formatHours(d.timeEntries?.todayMinutes)} sub="Saisi depuis minuit" icon="clock" tone="mint" />);
    cards.push(<KpiTile key="time-month" href={timeHref} className={cardClass} label="Temps ce mois" value={formatHours(d.timeEntries?.monthMinutes)} sub={`${d.timeEntries?.monthEntries ?? 0} saisie(s)`} icon="chart" tone="sky" />);
  }
  if (me.data.sections?.notifications) {
    cards.push(<KpiTile key="notifications" href={can(user, "notification:read:own") ? "/espace-equipe/notifications" : undefined} className={cardClass} label="Notifications non lues" value={d.notifications?.unread ?? 0} sub="Votre boîte de notifications" icon="bolt" tone="amber" />);
  }
  return cards.length ? cards : (
    <GlassCard className="cx-dashboard__kpi-empty">
      <span className="cx-dashboard__kpi-empty-icon"><Icon name="chart" /></span>
      <div>
        <p className="cx-dashboard__kpi-empty-title">Aucun indicateur disponible</p>
        <p className="cx-dashboard__muted">Les statistiques apparaîtront ici lorsque votre rôle donnera accès aux données correspondantes.</p>
      </div>
    </GlassCard>
  );
}

/* ---------- Ligne 2 ---------- */

function AgencyDistribution({ agency, className }) {
  if (agency.loading && !agency.data) return <TileSkeleton className={className} />;
  if (agency.error && !agency.data) return <TileError className={className} message={agency.error} onRetry={agency.reload} />;
  if (!agency.data) return null;
  return <DistributionTile className={className} title="Prospects par étape" rows={agency.data.prospects?.byStatus ?? []} labels={PROSPECT_STATUS} />;
}

function MyDistribution({ me, className }) {
  if (me.loading && !me.data) return <TileSkeleton className={className} />;
  if (me.error && !me.data) return <TileError className={className} message={me.error} onRetry={me.reload} />;
  if (!me.data?.tasks) return null;
  return <DistributionTile className={className} title="Mes tâches par statut" rows={me.data.tasks.byStatus ?? []} labels={TASK_STATUS} />;
}

/* ---------- Ligne 3 : vue agence ---------- */

function AgencyFinance({ agency, className }) {
  if (agency.loading && !agency.data) return <TileSkeleton className={className} />;
  if (agency.error && !agency.data) return <TileError className={className} message={agency.error} onRetry={agency.reload} />;
  if (!agency.data) return null;
  const d = agency.data;
  return (
    <FinanceTile
      className={className}
      open={d.invoices?.open}
      overdue={d.invoices?.overdue}
      collected={d.collected}
      rate={formatPercent(d.collectionRate)}
    />
  );
}

function AgencyHealth({ agency, className }) {
  if (agency.loading && !agency.data) return <TileSkeleton className={className} />;
  if (agency.error && !agency.data) return <TileError className={className} message={agency.error} onRetry={agency.reload} />;
  if (!agency.data) return null;
  return <HealthTile className={className} rows={agency.data.projects?.byHealth ?? []} />;
}

function taskDestination(task, user, agencyScope = false) {
  if (agencyScope) {
    if (task.projectId && can(user, "project:read:any")) return `/espace-equipe/projets/${task.projectId}`;
    return can(user, "task:read:any") ? "/espace-equipe/taches" : null;
  }

  const canOpenProject = can(user, "project:read:any") || can(user, "project:read:own") || can(user, "project:read:assigned");
  if (task.projectId && canOpenProject) return `/espace-equipe/projets/${task.projectId}`;
  const canOpenTasks = ["task:read:any", "task:read:assigned", "task:read:own", "task:write:any", "task:write:own"].some((permission) => can(user, permission));
  return canOpenTasks ? "/espace-equipe/taches" : null;
}

function AgencyDue({ agency, user, className }) {
  if (agency.loading && !agency.data) return <TileSkeleton className={className} />;
  if (agency.error && !agency.data) return <TileError className={className} message={agency.error} onRetry={agency.reload} />;
  if (!agency.data) return null;
  const canReadTasks = ["task:read:any", "task:read:assigned", "task:read:own"].some((permission) => can(user, permission));
  const canReadInvoices = can(user, "invoice:read:any");
  return (
    <DueTile
      className={className}
      tasks={agency.data.upcoming?.tasks ?? []}
      invoices={agency.data.upcoming?.invoices ?? []}
      taskHref={(task) => taskDestination(task, user, true)}
      invoiceHref={(invoice) => canReadInvoices ? `/espace-equipe/factures/${invoice.id}` : null}
      tasksHref={canReadTasks ? "/espace-equipe/taches" : null}
      tasksLinkLabel={can(user, "task:read:any") ? "Toutes les tâches" : "Mes tâches"}
      invoicesHref={canReadInvoices ? "/espace-equipe/factures" : null}
    />
  );
}

/* ---------- Ligne 3 : vue personnelle ---------- */

function MyDue({ me, user, className }) {
  if (me.loading && !me.data) return <TileSkeleton className={className} />;
  if (me.error && !me.data) return <TileError className={className} message={me.error} onRetry={me.reload} />;
  if (!me.data?.upcoming) return null;
  const canReadTasks = ["task:read:any", "task:read:assigned", "task:read:own", "task:write:any", "task:write:own"].some((permission) => can(user, permission));
  return (
    <DueTile
      className={className}
      tasks={me.data.upcoming}
      taskHref={(task) => taskDestination(task, user)}
      tasksHref={canReadTasks ? "/espace-equipe/taches" : null}
      tasksLinkLabel="Mes tâches"
    />
  );
}

/* ---------- Utilitaires ---------- */

function clampPct(value) {
  return Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
}

function formatPercent(ratio) {
  const value = Number(ratio);
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format((Number.isFinite(value) ? value : 0) * 100);
}

function formatHours(minutes) {
  const m = Number(minutes) || 0;
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

function formatTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
