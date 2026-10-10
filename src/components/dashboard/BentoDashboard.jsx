"use client";

import Link from "next/link";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { canLogTime, canUseTimer } from "@/lib/timer-access";
import { PROSPECT_STATUS } from "@/lib/commercial";
import { TASK_STATUS } from "@/lib/labels";
import ProspectBoard from "@/components/workspace/ProspectBoard";
import MeshBackground from "@/components/dashboard/MeshBackground";
import GlassCard from "@/components/dashboard/GlassCard";
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

/*
 * Tableau de bord « bento » de l'espace équipe. Toutes les valeurs viennent de l'API.
 *
 *   Ligne 1 : 4 indicateurs (agence, ou « mes » indicateurs si pas de vue agence)
 *   Ligne 2 : minuteur (si autorisé) | répartition par statut
 *   Ligne 3 : facturation | santé des projets | échéances        (vue agence)
 *   Ligne 4 : pipeline commercial en Kanban (si autorisé)
 *
 * Chaque tuile est conditionnée par les droits du porteur ET par les sections
 * renvoyées par `/dashboard/me` : une tuile sans droit n'est jamais demandée.
 */
export default function BentoDashboard({ me, agency, canSeeAgency }) {
  const { user } = useAuth();
  const name = user?.firstName ?? "";
  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const asOf = agency.data?.asOf ?? me.data?.asOf ?? null;

  const canSeePipeline = can(user, "prospect:read:any") || can(user, "prospect:read:own");
  const prospects = useListing(canSeePipeline ? "/prospects?perPage=100" : null);
  const timerTasks = useListing(canUseTimer(user) ? "/me/tasks?perPage=50" : null);

  function reloadAll() {
    me.reload();
    if (canSeeAgency) agency.reload();
    if (canSeePipeline) prospects.reload();
    if (canUseTimer(user)) timerTasks.reload();
  }

  return (
    <section aria-label="Tableau de bord" className="relative isolate overflow-hidden rounded-[36px] bg-[#071a33] p-5 text-white md:p-8">
      <MeshBackground />

      <header className="mb-7 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[12.5px] font-medium uppercase tracking-[0.18em] text-sky-300/80">{today}</p>
          <h2 className="mt-2 bg-gradient-to-b from-white to-white/70 bg-clip-text text-[30px] font-semibold tracking-tight text-transparent md:text-[36px]">
            Bonjour{name ? `, ${name}` : ""}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QuickActions user={user} />
          <button
            type="button"
            onClick={reloadAll}
            className="rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-[12.5px] text-white/75 backdrop-blur-xl transition hover:bg-white/10 hover:text-white"
          >
            Actualiser{asOf ? ` · ${formatTime(asOf)}` : ""}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Ligne 1 : indicateurs */}
        <Kpis me={me} agency={agency} canSeeAgency={canSeeAgency} />

        {/* Ligne 2 */}
        {canUseTimer(user) ? (
          <div className="lg:col-span-4">
            <TimerTile tasks={timerTasks} />
          </div>
        ) : null}
        {canSeeAgency ? (
          <AgencyDistribution agency={agency} className={canUseTimer(user) ? "lg:col-span-8" : "lg:col-span-12"} />
        ) : (
          <MyDistribution me={me} className={canUseTimer(user) ? "lg:col-span-8" : "lg:col-span-12"} />
        )}

        {/* Ligne 3 */}
        {canSeeAgency ? (
          <>
            <AgencyFinance agency={agency} className="lg:col-span-4" />
            <AgencyHealth agency={agency} className="lg:col-span-4" />
            <AgencyDue agency={agency} className="lg:col-span-4" />
          </>
        ) : (
          <MyDue me={me} className="lg:col-span-12" />
        )}

        {/* Ligne 4 : pipeline */}
        {canSeePipeline ? (
          <GlassCard className="flex flex-col gap-5 p-6 md:p-7 lg:col-span-12">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-4">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300 shadow-[0_0_24px_rgba(30,134,224,0.6)]"><Icon name="kanban" /></span>
                <div>
                  <h3 className="!text-[17px] !font-bold !text-white">Pipeline commercial</h3>
                  <p className="text-[12.5px] text-white/55">Glissez une fiche pour changer son étape</p>
                </div>
              </div>
              <Link href="/espace-equipe/prospects" className="text-[12.5px] text-sky-300 hover:underline">Ouvrir la vue complète →</Link>
            </div>
            {prospects.error ? <TileError message={prospects.error} onRetry={prospects.reload} /> : null}
            {prospects.items === null && !prospects.error ? <TileSkeleton /> : null}
            {prospects.items !== null ? <ProspectBoard items={prospects.items} onChanged={prospects.reload} tone="glass" /> : null}
          </GlassCard>
        ) : null}
      </div>
    </section>
  );
}

/* ---------- Actions rapides : seulement celles que le porteur peut utiliser ---------- */

function QuickActions({ user }) {
  const actions = [
    { href: "/espace-equipe/taches", label: "Tâche", show: can(user, "task:write:any") || can(user, "task:write:own") },
    { href: "/espace-equipe/temps", label: "Temps", show: canLogTime(user) },
    { href: "/espace-equipe/rapports-journaliers", label: "Rapport du jour", show: canLogTime(user) },
    { href: "/espace-equipe/calendrier", label: "Calendrier", show: can(user, "task:read:any") },
  ].filter((action) => action.show);
  if (actions.length === 0) return null;
  return (
    <nav aria-label="Actions rapides" className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Link key={action.href} href={action.href} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-2 text-[12.5px] font-medium text-white/85 backdrop-blur-xl transition hover:border-sky-300/40 hover:bg-white/[0.12]">
          <Icon name="plus" className="h-3.5 w-3.5 text-sky-300" />
          {action.label}
        </Link>
      ))}
    </nav>
  );
}

/* ---------- Ligne 1 ---------- */

function Kpis({ me, agency, canSeeAgency }) {
  const source = canSeeAgency ? agency : me;
  if (source.loading && !source.data) {
    return [0, 1, 2, 3].map((i) => <TileSkeleton key={i} className="lg:col-span-3" />);
  }
  if (source.error && !source.data) {
    return <TileError className="lg:col-span-12" message={source.error} onRetry={source.reload} />;
  }
  if (!source.data) return null;

  if (canSeeAgency) {
    const d = agency.data;
    return (
      <>
        <KpiTile className="lg:col-span-3" label="Prospects ouverts" value={d.prospects?.open ?? 0} sub={`${d.prospects?.createdInPeriod ?? 0} créés sur la période`} icon="users" tone="sky" />
        <KpiTile className="lg:col-span-3" label="Projets actifs" value={d.projects?.active ?? 0} sub={`${d.projects?.overdue ?? 0} en retard · avancement moyen ${d.projects?.averageProgress ?? 0} %`} icon="folder" tone="amber" />
        <KpiTile className="lg:col-span-3" label="Tâches ouvertes" value={d.tasks?.open ?? 0} sub={`${d.tasks?.overdue ?? 0} en retard`} icon="kanban" tone="accent" />
        <KpiTile className="lg:col-span-3" label="Taux d’encaissement" value={`${Number(d.collectionRate ?? 0)} %`} sub="Encaissé / facturé sur la période" icon="money" tone="mint" bar={clampPct(d.collectionRate)} />
      </>
    );
  }

  const d = me.data;
  const tasksShown = me.data.sections?.tasks;
  const timeShown = me.data.sections?.timeEntries;
  const notifShown = me.data.sections?.notifications;
  return (
    <>
      {tasksShown ? <KpiTile className="lg:col-span-3" label="Tâches ouvertes" value={d.tasks?.open ?? 0} sub={`${d.tasks?.overdue ?? 0} en retard`} icon="kanban" tone="accent" /> : null}
      {timeShown ? <KpiTile className="lg:col-span-3" label="Temps aujourd’hui" value={formatHours(d.timeEntries?.todayMinutes)} sub="Temps saisi depuis minuit" icon="clock" tone="mint" /> : null}
      {timeShown ? <KpiTile className="lg:col-span-3" label="Temps ce mois" value={formatHours(d.timeEntries?.monthMinutes)} sub={`${d.timeEntries?.monthEntries ?? 0} saisie(s)`} icon="chart" tone="sky" /> : null}
      {notifShown ? <KpiTile className="lg:col-span-3" label="Notifications non lues" value={d.notifications?.unread ?? 0} sub="Voir la liste dans Notifications" icon="bolt" tone="amber" /> : null}
    </>
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
      rate={Number(d.collectionRate ?? 0)}
    />
  );
}

function AgencyHealth({ agency, className }) {
  if (agency.loading && !agency.data) return <TileSkeleton className={className} />;
  if (agency.error && !agency.data) return <TileError className={className} message={agency.error} onRetry={agency.reload} />;
  if (!agency.data) return null;
  return <HealthTile className={className} rows={agency.data.projects?.byHealth ?? []} />;
}

function AgencyDue({ agency, className }) {
  if (agency.loading && !agency.data) return <TileSkeleton className={className} />;
  if (agency.error && !agency.data) return <TileError className={className} message={agency.error} onRetry={agency.reload} />;
  if (!agency.data) return null;
  return <DueTile className={className} tasks={agency.data.upcoming?.tasks ?? []} invoices={agency.data.upcoming?.invoices ?? []} />;
}

/* ---------- Ligne 3 : vue personnelle ---------- */

function MyDue({ me, className }) {
  if (me.loading && !me.data) return <TileSkeleton className={className} />;
  if (me.error && !me.data) return <TileError className={className} message={me.error} onRetry={me.reload} />;
  if (!me.data?.upcoming) return null;
  return <DueTile className={className} tasks={me.data.upcoming} />;
}

/* ---------- Utilitaires ---------- */

function clampPct(value) {
  return Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
}

function formatHours(minutes) {
  const m = Number(minutes) || 0;
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

function formatTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
