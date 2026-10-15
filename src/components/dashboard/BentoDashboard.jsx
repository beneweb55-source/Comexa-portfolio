"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight,
  CalendarDays,
  CheckSquare,
  Clock,
  Compass,
  FileCheck2,
  FileText,
  FolderKanban,
  Plus,
  ReceiptText,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { formatDate, formatMoney, messageOf } from "@/lib/api";
import { isDeadlinePassed } from "@/lib/date-utils.mjs";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { canReadOwnTasks, canUseTimer } from "@/lib/timer-access";
import { useAllListing } from "@/lib/use-all-listing";
import { useListing } from "@/lib/use-listing";
import { useObject } from "@/lib/use-object";
import { fetchAllPages } from "@/lib/pagination.mjs";
import { INVOICE_STATUS, PROSPECT_COLUMNS, PROSPECT_STATUS, remainingDue } from "@/lib/commercial";
import { PROJECT_STATUS, TASK_STATUS } from "@/lib/labels";
import { Notice } from "@/components/workspace/ui";
import GlassCard, { GlowIcon } from "./GlassCard";
import Icon from "./icons";
import { DueTile, FinanceTile, HealthTile, KpiTile, TimerTile } from "./DashboardTiles";
import { AgencyView, MyDayView } from "./TeamViews";

const ACTIVE_PROJECT = ["PLANNED", "IN_PROGRESS", "IN_REVIEW"];
const OPEN_TASK = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"];
const CLOSED_TASK = ["DONE", "CANCELLED"];
const UNPAID_INVOICE = ["SENT", "PARTIALLY_PAID", "OVERDUE"];
const OPEN_QUOTE = ["DRAFT", "SENT", "VIEWED"];
const MONTH_FMT = new Intl.DateTimeFormat("fr-FR", { month: "short" });
const EMPTY = [];

const isoDay = (date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function MiniSparkline({ points = [], color = "#1e86e0" }) {
  const safe = points.length >= 2 ? points : [12, 18, 15, 24, 22, 30];
  const max = Math.max(...safe, 1);
  const min = Math.min(...safe, 0);
  const range = Math.max(max - min, 1);
  const width = 88;
  const height = 28;
  const coords = safe.map((val, idx) => {
    const x = (idx / (safe.length - 1)) * width;
    const y = height - 4 - ((val - min) / range) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="shrink-0 overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={coords.join(" ")}
      />
    </svg>
  );
}

function BentoSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12" role="status" aria-label="Chargement des indicateurs">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="cx-panel flex flex-col gap-3 p-5 xl:col-span-3">
          <div className="flex items-center justify-between">
            <div className="cx-skeleton h-10 w-10 rounded-xl" />
            <div className="cx-skeleton h-6 w-20 rounded-full" />
          </div>
          <div className="cx-skeleton mt-2 h-8 w-36" />
          <div className="cx-skeleton h-3.5 w-44" />
        </div>
      ))}
    </div>
  );
}

/**
 * Tableau de bord Bento de l'espace équipe (Plein Écran — 10x Meilleur).
 * Hiérarchie claire :
 *  1. Bandeau de 4 KPIs primaires (grands chiffres tabulaires, variation/statut, mini sparklines).
 *  2. Barre d'actions rapides en 1 clic.
 *  3. Grille Bento modulaire : graphiques Recharts épurés (Encaissements 6 mois, Pipeline CRM),
 *     Minuteur en direct, Trésorerie, Santé des projets et Échéances à 7 jours.
 *  4. Vues opérationnelles par onglets (« Vue d'ensemble de l'agence » & « Ma journée ») directement accessibles.
 */
export default function BentoDashboard() {
  const { user, request } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  const today = useMemo(() => new Date(now), [now]);
  const weekAgo = useMemo(() => {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    return isoDay(d);
  }, [now]);
  const todayIso = useMemo(() => isoDay(today), [today]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const canAgency = can(user, "dashboard:read:agency");
  const canReadProjects = ["project:read:any", "project:read:assigned", "project:read:own"].some((p) => can(user, p));
  const canReadOwnTaskList = canReadOwnTasks(user);
  const canReadTeamTasks = can(user, "project:read:any") && can(user, "task:read:any");
  const canReadMilestones = can(user, "milestone:read:any");
  const canReadTime = can(user, "time:read:any") || can(user, "time:read:own");
  const canTime = canUseTimer(user);
  const canReadInvoices = can(user, "invoice:read:any");
  const canReadQuotes = can(user, "quote:read:any");
  const canReadProspects = can(user, "prospect:read:any") || can(user, "prospect:read:own");
  const canReadActivity = can(user, "activity:read:any") || can(user, "activity:read:client");
  const canReadOrders = can(user, "order:read:any");

  const agency = useObject("/dashboard/agency", canAgency);
  const me = useObject("/dashboard/me", true);
  const projects = useAllListing("/projects?perPage=100", canReadProjects);
  const myTasks = useAllListing("/me/tasks?perPage=100", canReadOwnTaskList);
  const timeEntries = useAllListing(`/time-entries?from=${weekAgo}&to=${todayIso}&perPage=100`, canReadTime);
  const invoices = useAllListing("/invoices?perPage=100", canReadInvoices);
  const quotes = useAllListing("/quotes?perPage=100", canReadQuotes);
  const prospects = useAllListing("/prospects?perPage=100", canReadProspects);
  const orders = useAllListing("/orders?perPage=100", canReadOrders);
  const activity = useListing(canReadActivity ? "/activity?page=1&perPage=25" : null);
  const [projectExtras, setProjectExtras] = useState({ tasks: EMPTY, milestones: EMPTY, error: null, projectKey: null });

  const [view, setView] = useState(null);
  const currentView = view ?? (canAgency ? "agency" : "day");

  const projectItems = projects.items ?? EMPTY;
  const projectKey = JSON.stringify(projectItems.map(({ id, name, reference }) => [id, name, reference]));
  const loadProjectExtras = canReadProjects && (canReadTeamTasks || canReadMilestones);

  useEffect(() => {
    if (!loadProjectExtras || projects.loading || projects.items === null || projects.error || projectItems.length === 0) {
      return undefined;
    }

    const controller = new AbortController();
    async function loadExtras() {
      try {
        const tasks = [];
        const milestones = [];
        for (let index = 0; index < projectItems.length; index += 6) {
          const batch = projectItems.slice(index, index + 6);
          const chunk = await Promise.all(
            batch.map(async (project) => {
              const id = encodeURIComponent(project.id);
              const [projectTasks, projectMilestones] = await Promise.all([
                canReadTeamTasks ? fetchAllPages(request, `/projects/${id}/tasks?perPage=100`, { signal: controller.signal }) : { items: [] },
                canReadMilestones ? fetchAllPages(request, `/projects/${id}/milestones?perPage=100`, { signal: controller.signal }) : { items: [] },
              ]);
              return {
                tasks: projectTasks.items.map((task) => ({
                  ...task,
                  projectId: project.id,
                  project: task.project ?? { id: project.id, name: project.name, reference: project.reference },
                })),
                milestones: projectMilestones.items.map((milestone) => ({
                  ...milestone,
                  projectId: project.id,
                  projectName: project.name,
                })),
              };
            }),
          );
          for (const item of chunk) {
            tasks.push(...item.tasks);
            milestones.push(...item.milestones);
          }
        }
        if (!controller.signal.aborted) setProjectExtras({ tasks, milestones, error: null, projectKey });
      } catch (caught) {
        if (!controller.signal.aborted) setProjectExtras({ tasks: EMPTY, milestones: EMPTY, error: messageOf(caught), projectKey });
      }
    }
    loadExtras();
    return () => controller.abort();
  }, [canReadMilestones, canReadTeamTasks, loadProjectExtras, projectItems, projectKey, projects.error, projects.items, projects.loading, request]);

  const extrasAreCurrent = projectExtras.projectKey === projectKey;
  const extrasLoading =
    loadProjectExtras && !projects.error && (projects.loading || projects.items === null || (projectItems.length > 0 && !extrasAreCurrent));
  const extraTasks = !canReadTeamTasks || projectItems.length === 0 || projects.error || !extrasAreCurrent ? EMPTY : projectExtras.tasks;
  const extraMilestones = !canReadMilestones || projectItems.length === 0 || projects.error || !extrasAreCurrent ? EMPTY : projectExtras.milestones;
  const extrasError = extrasAreCurrent ? projectExtras.error : null;

  const computed = useMemo(() => {
    const projectList = projects.items ?? EMPTY;
    const myTaskList = myTasks.items ?? EMPTY;
    const taskSource = canReadTeamTasks ? extraTasks : myTaskList;
    const invoiceList = invoices.items ?? EMPTY;
    const quoteList = quotes.items ?? EMPTY;
    const prospectList = prospects.items ?? EMPTY;
    const entryList = timeEntries.items ?? EMPTY;

    const activeProjects = projectList
      .filter((p) => ACTIVE_PROJECT.includes(p.status))
      .map((p) => ({
        ...p,
        statusLabel: PROJECT_STATUS[p.status] ?? p.status,
        overdue: Boolean(p.dueDate && isDeadlinePassed(p.dueDate, now)),
      }));
    const onHoldProjects = projectList.filter((p) => p.status === "ON_HOLD").length;
    const lateProjects = activeProjects.filter((p) => p.overdue).length;
    const avgProgress = activeProjects.length
      ? Math.round(activeProjects.reduce((sum, p) => sum + (Number(p.progressPercent) || 0), 0) / activeProjects.length)
      : 0;

    const myEntries = entryList.filter((e) => !e.userId || e.userId === user?.id);
    const weekMinutes = myEntries.reduce((sum, e) => sum + (Number(e.minutes) || 0), 0);
    const weekHours = `${(weekMinutes / 60).toFixed(1).replace(".0", "")} h`;

    const myOpenTasks = myTaskList
      .filter((t) => OPEN_TASK.includes(t.status))
      .map((t) => ({
        ...t,
        statusLabel: TASK_STATUS[t.status] ?? t.status,
        overdue: Boolean(t.dueDate && isDeadlinePassed(t.dueDate, now)),
      }))
      .sort((a, b) => new Date(a.dueDate ?? "9999") - new Date(b.dueDate ?? "9999"));
    const myOverdue = myOpenTasks.filter((t) => t.overdue).length;

    const in7Days = new Date(today);
    in7Days.setDate(in7Days.getDate() + 7);
    const dueCandidateTasks = taskSource.filter((t) => !CLOSED_TASK.includes(t.status) && t.dueDate);
    const dueCandidateMilestones = extraMilestones.filter((m) => !["REACHED", "CANCELLED"].includes(m.status) && m.dueDate);
    const dueSoon = [
      ...dueCandidateTasks.map((t) => ({
        id: `task-${t.id}`,
        title: t.title,
        dueDate: t.dueDate,
        overdue: isDeadlinePassed(t.dueDate, now),
        href: t.projectId ? `/espace-equipe/projets/${t.projectId}` : "/espace-equipe/taches",
        context: `Tâche · ${t.project?.name || TASK_STATUS[t.status] || ""}`,
      })),
      ...dueCandidateMilestones.map((m) => ({
        id: `milestone-${m.id}`,
        title: m.title,
        dueDate: m.dueDate,
        overdue: isDeadlinePassed(m.dueDate, now),
        href: `/espace-equipe/projets/${m.projectId}`,
        context: `Jalon · ${m.projectName}`,
      })),
    ]
      .filter((item) => new Date(item.dueDate) <= in7Days)
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
      .slice(0, 8);
    const dueOverdue = dueSoon.filter((d) => d.overdue).length;

    const currency = invoiceList[0]?.currency ?? quoteList[0]?.currency ?? "EUR";
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    let collectedTotal = 0;
    let collectedMonth = 0;
    let outstanding = 0;
    for (const inv of invoiceList) {
      const paid = Number(inv.amountPaid) || 0;
      collectedTotal += paid;
      const refDate = inv.paidAt ?? inv.issueDate ?? inv.createdAt;
      if (refDate && new Date(refDate) >= monthStart) collectedMonth += paid;
      if (UNPAID_INVOICE.includes(inv.status)) outstanding += remainingDue(inv);
    }
    const unpaidInvoices = invoiceList
      .filter((inv) => UNPAID_INVOICE.includes(inv.status) && remainingDue(inv) > 0)
      .map((inv) => ({
        ...inv,
        remaining: remainingDue(inv),
        statusLabel: INVOICE_STATUS[inv.status] ?? inv.status,
        overdue: inv.status === "OVERDUE" || Boolean(inv.dueDate && isDeadlinePassed(inv.dueDate, now)),
      }))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.remaining - a.remaining);
    const overdueInvoicesCount = unpaidInvoices.filter((i) => i.overdue).length;

    const openQuotes = quoteList.filter((q) => OPEN_QUOTE.includes(q.status));
    const openQuotesTotal = openQuotes.reduce((sum, q) => sum + (Number(q.total) || 0), 0);

    const revenueMonths = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      revenueMonths.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        mois: MONTH_FMT.format(d).replace(".", ""),
        encaisse: 0,
      });
    }
    for (const inv of invoiceList) {
      const paid = Number(inv.amountPaid) || 0;
      const ref = inv.paidAt ?? inv.issueDate ?? inv.createdAt;
      if (!paid || !ref) continue;
      const d = new Date(ref);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const bucket = revenueMonths.find((m) => m.key === key);
      if (bucket) bucket.encaisse = Math.round((bucket.encaisse + paid) * 100) / 100;
    }

    const pipelineStages = PROSPECT_COLUMNS.map((status) => ({
      etape: PROSPECT_STATUS[status],
      prospects: prospectList.filter((p) => p.status === status).length,
    }));

    const milestonesTotal = extraMilestones.length;
    const milestonesReached = extraMilestones.filter((m) => m.status === "REACHED").length;

    return {
      currency,
      activeProjects,
      onHoldProjects,
      lateProjects,
      avgProgress,
      weekHours,
      myOpenTasks,
      myOverdue,
      myEntries: myEntries.slice(0, 8),
      dueSoon,
      dueOverdue,
      collectedTotal,
      collectedMonth,
      outstanding,
      unpaidInvoices,
      overdueInvoicesCount,
      openQuotesCount: openQuotes.length,
      openQuotesTotal,
      revenueMonths,
      pipelineStages,
      prospectList,
      milestonesTotal,
      milestonesReached,
      ordersCount: (orders.items ?? EMPTY).length,
    };
  }, [
    canReadTeamTasks,
    extraMilestones,
    extraTasks,
    invoices.items,
    myTasks.items,
    now,
    orders.items,
    projects.items,
    prospects.items,
    quotes.items,
    timeEntries.items,
    today,
    user?.id,
  ]);

  const agencyCounters = agency.data?.counters ?? agency.data ?? {};
  const meCounters = me.data?.counters ?? me.data ?? {};

  const projectsDataReady = canReadProjects && projects.items !== null && !projects.loading && !projects.error;
  const myTasksReady = canReadOwnTaskList && myTasks.items !== null && !myTasks.loading && !myTasks.error;
  const timeReady = canReadTime && timeEntries.items !== null && !timeEntries.loading && !timeEntries.error;
  const invoicesReady = canReadInvoices && invoices.items !== null && !invoices.loading && !invoices.error;
  const quotesReady = canReadQuotes && quotes.items !== null && !quotes.loading && !quotes.error;
  const prospectsReady = canReadProspects && prospects.items !== null && !prospects.loading && !prospects.error;
  const dueSoonReady = (canReadTeamTasks || canReadMilestones ? !extrasLoading && !extrasError : myTasksReady) && !projects.error;

  const activeProjectsCount = projectsDataReady
    ? computed.activeProjects.length
    : Number.isFinite(Number(agencyCounters.activeProjects))
      ? Number(agencyCounters.activeProjects)
      : null;
  const openTasksCount = myTasksReady
    ? computed.myOpenTasks.length
    : Number.isFinite(Number(meCounters.openTasks))
      ? Number(meCounters.openTasks)
      : null;

  const errors = [
    canAgency ? agency.error : null,
    me.error,
    projects.error,
    myTasks.error,
    timeEntries.error,
    invoices.error,
    quotes.error,
    prospects.error,
    activity.error,
    extrasError,
  ].filter(Boolean);

  const initialLoading =
    (canReadProjects && projects.items === null && projects.loading) ||
    (canReadInvoices && invoices.items === null && invoices.loading);

  const sparkRevenue = computed.revenueMonths.map((m) => m.encaisse);

  return (
    <div className="cx-bento flex flex-col gap-6">
      {errors.length > 0 ? (
        <div className="flex flex-col gap-2">
          {errors.map((err, index) => (
            <Notice key={`${index}-${err}`}>{err}</Notice>
          ))}
        </div>
      ) : null}

      {/* ====================================================================
          1. HERO BENTO KPI ROW (4 Indicateurs Primaires + Sparklines)
         ==================================================================== */}
      {initialLoading ? (
        <BentoSkeleton />
      ) : (
        <section
          aria-label="Indicateurs clés de performance"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {/* KPI 1 : Chiffre d'affaires / Trésorerie */}
          <Link
            href={canReadInvoices ? "/espace-equipe/factures" : "/espace-equipe/projets"}
            className="cx-card cx-card--interactive group flex flex-col justify-between gap-4 !p-5 no-underline"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e6f7ef] text-[#0d7a52] shadow-xs">
                  <Wallet size={20} strokeWidth={1.85} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[12.5px] font-semibold text-[#4a607a]">
                    {canReadInvoices ? "Chiffre d’affaires encaissé" : "Projets suivis"}
                  </p>
                  <p className="cx-tabular mt-0.5 text-[24px] font-bold tracking-tight text-[#0b2545]">
                    {canReadInvoices
                      ? invoicesReady
                        ? formatMoney(computed.collectedTotal, computed.currency)
                        : "…"
                      : activeProjectsCount !== null
                        ? String(activeProjectsCount)
                        : "—"}
                  </p>
                </div>
              </div>
              {canReadInvoices && invoicesReady ? (
                <MiniSparkline points={sparkRevenue} color="#0d7a52" />
              ) : null}
            </div>
            <div className="flex items-center justify-between border-t border-[rgba(15,52,96,0.065)] pt-3 text-[12px]">
              <span className="cx-badge cx-badge--success">
                {canReadInvoices && invoicesReady
                  ? `+ ${formatMoney(computed.collectedMonth, computed.currency)} ce mois`
                  : "En direct"}
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-[#1568b4] group-hover:translate-x-0.5 transition-transform">
                Détails <ArrowUpRight size={13} />
              </span>
            </div>
          </Link>

          {/* KPI 2 : Reste à encaisser & Devis ouverts */}
          <Link
            href={canReadInvoices ? "/espace-equipe/factures" : "/espace-equipe/taches"}
            className="cx-card cx-card--interactive group flex flex-col justify-between gap-4 !p-5 no-underline"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fef4e2] text-[#9a5406] shadow-xs">
                  <ReceiptText size={20} strokeWidth={1.85} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[12.5px] font-semibold text-[#4a607a]">
                    {canReadInvoices ? "Reste à encaisser" : "Mes tâches ouvertes"}
                  </p>
                  <p className="cx-tabular mt-0.5 text-[24px] font-bold tracking-tight text-[#0b2545]">
                    {canReadInvoices
                      ? invoicesReady
                        ? formatMoney(computed.outstanding, computed.currency)
                        : "…"
                      : openTasksCount !== null
                        ? String(openTasksCount)
                        : "—"}
                  </p>
                </div>
              </div>
              {canReadInvoices && computed.overdueInvoicesCount > 0 ? (
                <span className="cx-badge cx-badge--danger">
                  {computed.overdueInvoicesCount} en retard
                </span>
              ) : (
                <span className="cx-badge cx-badge--info">
                  {quotesReady ? `${computed.openQuotesCount} devis ouverts` : "Suivi"}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-[rgba(15,52,96,0.065)] pt-3 text-[12px] text-[#4a607a]">
              <span className="truncate">
                {canReadInvoices && quotesReady
                  ? `Devis en attente : ${formatMoney(computed.openQuotesTotal, computed.currency)}`
                  : myTasksReady
                    ? `${computed.myOverdue} tâche(s) en retard`
                    : "Suivi opérationnel"}
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-[#1568b4] group-hover:translate-x-0.5 transition-transform">
                Voir <ArrowUpRight size={13} />
              </span>
            </div>
          </Link>

          {/* KPI 3 : Projets actifs & Avancement moyen */}
          <Link
            href="/espace-equipe/projets"
            className="cx-card cx-card--interactive group flex flex-col justify-between gap-4 !p-5 no-underline"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e8f3fe] text-[#1568b4] shadow-xs">
                  <FolderKanban size={20} strokeWidth={1.85} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[12.5px] font-semibold text-[#4a607a]">Projets actifs</p>
                  <p className="cx-tabular mt-0.5 text-[24px] font-bold tracking-tight text-[#0b2545]">
                    {activeProjectsCount !== null ? String(activeProjectsCount) : "…"}
                  </p>
                </div>
              </div>
              <span
                className={`cx-badge ${
                  computed.lateProjects > 0 ? "cx-badge--warning" : "cx-badge--info"
                }`}
              >
                {projectsDataReady ? `Avancement ${computed.avgProgress}%` : "Production"}
              </span>
            </div>
            <div className="flex flex-col gap-2 border-t border-[rgba(15,52,96,0.065)] pt-3">
              <div className="cx-progress !h-1.5">
                <div className="cx-progress__bar" style={{ width: `${computed.avgProgress}%` }} />
              </div>
              <div className="flex items-center justify-between text-[12px] text-[#4a607a]">
                <span>
                  {computed.lateProjects > 0
                    ? `${computed.lateProjects} échéance(s) dépassée(s)`
                    : `${computed.onHoldProjects} en pause · ${computed.milestonesReached}/${computed.milestonesTotal} jalons`}
                </span>
                <span className="inline-flex items-center gap-1 font-semibold text-[#1568b4]">
                  Projets <ArrowUpRight size={13} />
                </span>
              </div>
            </div>
          </Link>

          {/* KPI 4 : Charge & Temps de la semaine */}
          <Link
            href={canReadTime ? "/espace-equipe/temps" : "/espace-equipe/taches"}
            className="cx-card cx-card--interactive group flex flex-col justify-between gap-4 !p-5 no-underline"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f0edfe] text-[#5b3cc4] shadow-xs">
                  <Clock size={20} strokeWidth={1.85} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[12.5px] font-semibold text-[#4a607a]">Temps (7 jours)</p>
                  <p className="cx-tabular mt-0.5 text-[24px] font-bold tracking-tight text-[#0b2545]">
                    {timeReady ? computed.weekHours : timeEntries.loading ? "…" : "0 h"}
                  </p>
                </div>
              </div>
              <span
                className={`cx-badge ${
                  computed.dueOverdue > 0 ? "cx-badge--danger" : "cx-badge--neutral"
                }`}
              >
                {openTasksCount !== null ? `${openTasksCount} tâche(s)` : "Kanban"}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-[rgba(15,52,96,0.065)] pt-3 text-[12px] text-[#4a607a]">
              <span>
                {dueSoonReady
                  ? `${computed.dueSoon.length} échéance(s) à 7 jours`
                  : "Feuille de temps personnelle"}
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-[#1568b4] group-hover:translate-x-0.5 transition-transform">
                Ouvrir <ArrowUpRight size={13} />
              </span>
            </div>
          </Link>
        </section>
      )}

      {/* ====================================================================
          2. QUICK ACTIONS WIDGET BAR (Actions Courantes en <= 1 clic)
         ==================================================================== */}
      <section
        aria-label="Actions rapides"
        className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-white/85 bg-white/80 px-4 py-3 shadow-xs backdrop-blur-xl"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.07em] text-[#4a607a]">
            <Sparkles size={14} className="text-[#1e86e0]" aria-hidden="true" />
            Accès direct
          </span>
          {can(user, "quote:write:any") ? (
            <Link href="/espace-equipe/devis/nouveau" className="cx-btn cx-btn--primary cx-btn--sm">
              <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
              Nouveau devis
            </Link>
          ) : null}
          {canReadProspects ? (
            <Link href="/espace-equipe/prospects" className="cx-btn cx-btn--secondary cx-btn--sm">
              <Compass size={14} strokeWidth={1.85} aria-hidden="true" />
              Pipeline CRM ({computed.prospectList.length})
            </Link>
          ) : null}
          <Link href="/espace-equipe/taches" className="cx-btn cx-btn--secondary cx-btn--sm">
            <CheckSquare size={14} strokeWidth={1.85} aria-hidden="true" />
            Kanban des tâches
          </Link>
          {canReadTime ? (
            <Link href="/espace-equipe/rapports-journaliers" className="cx-btn cx-btn--secondary cx-btn--sm">
              <FileCheck2 size={14} strokeWidth={1.85} aria-hidden="true" />
              Rapport du jour
            </Link>
          ) : null}
          <Link href="/espace-equipe/calendrier" className="cx-btn cx-btn--secondary cx-btn--sm">
            <CalendarDays size={14} strokeWidth={1.85} aria-hidden="true" />
            Calendrier
          </Link>
        </div>

        {/* Sélecteur de mode d'inspection opérationnelle */}
        {canAgency ? (
          <div
            role="tablist"
            aria-label="Mode du tableau de bord"
            className="sui-filter-pills"
          >
            <button
              type="button"
              role="tab"
              aria-selected={currentView === "agency"}
              onClick={() => setView("agency")}
              className={`sui-filter-pill ${currentView === "agency" ? "sui-filter-pill--active" : ""}`}
            >
              Vue agence
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={currentView === "day"}
              onClick={() => setView("day")}
              className={`sui-filter-pill ${currentView === "day" ? "sui-filter-pill--active" : ""}`}
            >
              Ma journée
            </button>
          </div>
        ) : null}
      </section>

      {/* ====================================================================
          3. BENTO GRID : GRAPHIQUES ÉPURÉS + WIDGETS TEMPS RÉEL
         ==================================================================== */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {canReadInvoices ? (
          <FinanceTile
            currency={computed.currency}
            collectedMonth={invoicesReady ? computed.collectedMonth : null}
            outstanding={invoicesReady ? computed.outstanding : null}
            overdueCount={invoicesReady ? computed.overdueInvoicesCount : 0}
            openQuotesCount={quotesReady ? computed.openQuotesCount : null}
            openQuotesTotal={quotesReady ? computed.openQuotesTotal : 0}
          />
        ) : (
          <KpiTile
            span="xl:col-span-4"
            tone="sky"
            icon="clock"
            eyebrow="Cette semaine"
            value={timeReady ? computed.weekHours : timeEntries.loading ? "…" : "—"}
            label="Temps enregistré sur les 7 derniers jours"
            chip={
              timeReady
                ? {
                    tone: "neutral",
                    label: `${computed.myEntries.length} ${
                      computed.myEntries.length > 1 ? "saisies" : "saisie"
                    }`,
                  }
                : null
            }
            href={canReadTime ? "/espace-equipe/temps" : undefined}
          />
        )}

        <HealthTile
          activeCount={projectsDataReady ? computed.activeProjects.length : null}
          avgProgress={projectsDataReady ? computed.avgProgress : null}
          lateCount={projectsDataReady ? computed.lateProjects : 0}
          onHoldCount={projectsDataReady ? computed.onHoldProjects : 0}
          milestonesReached={canReadMilestones && !extrasLoading ? computed.milestonesReached : 0}
          milestonesTotal={canReadMilestones && !extrasLoading ? computed.milestonesTotal : 0}
        />

        <DueTile items={dueSoonReady ? computed.dueSoon : EMPTY} loading={!dueSoonReady} />

        {canTime ? (
          <TimerTile
            tasks={myTasksReady ? computed.myOpenTasks : EMPTY}
            weekHours={timeReady ? computed.weekHours : "—"}
          />
        ) : null}

        {canReadInvoices ? (
          <RevenueChartTile
            data={computed.revenueMonths}
            currency={computed.currency}
            ready={invoicesReady}
            loading={invoices.loading}
            span={canTime ? "xl:col-span-4" : "xl:col-span-6"}
          />
        ) : null}

        {canReadProspects ? (
          <PipelineChartTile
            data={computed.pipelineStages}
            total={prospectsReady ? computed.prospectList.length : null}
            ready={prospectsReady}
            loading={prospects.loading}
            span={canTime && canReadInvoices ? "xl:col-span-4" : "xl:col-span-6"}
          />
        ) : null}
      </div>

      {/* ====================================================================
          4. VUES OPÉRATIONNELLES DÉTAILLÉES (Toujours visibles, sans <details>)
         ==================================================================== */}
      {currentView === "agency" && canAgency ? (
        <AgencyView
          activeProjects={computed.activeProjects}
          unpaidInvoices={computed.unpaidInvoices}
          prospects={computed.prospectList}
          activity={activity.items ?? EMPTY}
          currency={computed.currency}
          onProspectsChanged={prospects.reload}
          permissions={{
            projects: canReadProjects,
            invoices: canReadInvoices,
            prospects: canReadProspects,
            activity: canReadActivity,
          }}
        />
      ) : (
        <MyDayView
          tasks={computed.myOpenTasks}
          projects={computed.activeProjects}
          entries={computed.myEntries}
          onTasksChanged={myTasks.reload}
          permissions={{
            tasks: canReadOwnTaskList,
            projects: canReadProjects,
            time: canReadTime,
            timer: canTime,
          }}
        />
      )}
    </div>
  );
}

function RevenueChartTile({ data, currency, ready, loading, span = "xl:col-span-4" }) {
  return (
    <GlassCard className={`flex flex-col justify-between gap-4 p-6 ${span}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <GlowIcon tone="mint">
            <Icon name="chart" />
          </GlowIcon>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#4a607a]">
              6 derniers mois
            </p>
            <h3 className="text-[16px] font-bold text-[#0b2545]">Encaissements mensuels</h3>
          </div>
        </div>
        <Link
          href="/espace-equipe/factures"
          className="text-[12.5px] font-semibold text-[#1568b4] hover:underline"
        >
          Factures →
        </Link>
      </div>
      <div className="h-[190px]">
        {ready ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="cxRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1e86e0" stopOpacity={0.42} />
                  <stop offset="100%" stopColor="#1e86e0" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(15,52,96,0.06)" />
              <XAxis
                dataKey="mois"
                tick={{ fill: "#5c738e", fontSize: 11.5 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide />
              <Tooltip
                content={<MoneyTooltip currency={currency} />}
                cursor={{ stroke: "rgba(30, 134, 224, 0.25)", strokeWidth: 1.5 }}
              />
              <Area
                type="monotone"
                dataKey="encaisse"
                name="Encaissé"
                stroke="#1e86e0"
                strokeWidth={2.5}
                fill="url(#cxRevenueGrad)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-[13px] text-[#5c738e]" role="status">
              {loading ? "Chargement des encaissements…" : "Données non disponibles."}
            </p>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function PipelineChartTile({ data, total, ready, loading, span = "xl:col-span-4" }) {
  return (
    <GlassCard className={`flex flex-col justify-between gap-4 p-6 ${span}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <GlowIcon tone="accent">
            <Icon name="target" />
          </GlowIcon>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#4a607a]">
              Prospection CRM
            </p>
            <h3 className="text-[16px] font-bold text-[#0b2545]">
              Pipeline ({total === null ? "…" : total})
            </h3>
          </div>
        </div>
        <Link
          href="/espace-equipe/prospects"
          className="text-[12.5px] font-semibold text-[#1568b4] hover:underline"
        >
          Pipeline →
        </Link>
      </div>
      <div className="h-[190px]">
        {ready ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(15,52,96,0.06)" />
              <XAxis
                dataKey="etape"
                tick={{ fill: "#5c738e", fontSize: 10.5 }}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <YAxis allowDecimals={false} hide />
              <Tooltip
                content={<CountTooltip />}
                cursor={{ fill: "rgba(30, 134, 224, 0.06)" }}
              />
              <Bar
                dataKey="prospects"
                name="Prospects"
                fill="url(#cxPipeGrad)"
                radius={[8, 8, 2, 2]}
                isAnimationActive={false}
              />
              <defs>
                <linearGradient id="cxPipeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1e86e0" />
                  <stop offset="100%" stopColor="#0f4e8a" />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-[13px] text-[#5c738e]" role="status">
              {loading ? "Chargement du pipeline…" : "Données non disponibles."}
            </p>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function MoneyTooltip({ active, payload, label, currency }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-white/20 bg-[#0b2545]/92 px-3.5 py-2.5 text-[12.5px] text-white shadow-xl backdrop-blur-xl">
      <p className="font-medium text-white/75 capitalize">{label}</p>
      <p className="cx-tabular mt-0.5 text-[14px] font-bold text-white">
        {formatMoney(payload[0].value, currency)}
      </p>
    </div>
  );
}

function CountTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const n = payload[0].value;
  return (
    <div className="rounded-2xl border border-white/20 bg-[#0b2545]/92 px-3.5 py-2.5 text-[12.5px] text-white shadow-xl backdrop-blur-xl">
      <p className="font-medium text-white/75">{label}</p>
      <p className="cx-tabular mt-0.5 text-[14px] font-bold text-white">
        {n} {n > 1 ? "prospects" : "prospect"}
      </p>
    </div>
  );
}
