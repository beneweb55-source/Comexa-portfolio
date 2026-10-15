"use client";

/*
 * Control Center — tableau de bord de l'espace équipe, habillé en « soft UI
 * pastel dans une coque noire ».
 *
 * La logique est strictement celle de l'ancien tableau de bord : mêmes appels
 * (`/dashboard`, `/dashboard/me`, `/projects`, `/me/tasks`, `/time-entries`,
 * `/invoices`, `/quotes`, `/prospects`, `/orders`, plus les tâches
 * et jalons par projet), mêmes garde-fous `can(user, "…")`, même mémo de calcul.
 * Seule la couche visuelle change :
 *   1. quatre KPI pastel, dont une carte « fantôme » en pointillés pour ce qui
 *      attend une décision ;
 *   2. accès direct en pilules + bascule « Vue agence / Ma journée » ;
 *   3. file de validation : cartes blanches aux statuts pastel (impayés,
 *      projets, devis, échéances) ;
 *   4. activité récente + santé de l'espace ;
 *   5. en bas, repliés, les données détaillées (facturation, échéances,
 *      minuteur, encaissements, pipeline, vues agence/journée).
 *
 * Aucun emoji : chaque symbole est une icône `lucide-react` (16-20 px, trait
 * 1,75, couleur héritée).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  CircleAlert,
  Compass,
  CreditCard,
  FileCheck2,
  FileText,
  FolderKanban,
  Hourglass,
  Pause,
  Play,
  Radio,
  ReceiptText,
  Sparkles,
  Square,
  TriangleAlert,
  Users,
  Wallet,
} from "lucide-react";
import { formatDateOnly, formatMoney, messageOf } from "@/lib/api";
import { isDeadlinePassed } from "@/lib/date-utils.mjs";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { canReadOwnTasks, canUseTimer } from "@/lib/timer-access";
import { useAllListing } from "@/lib/use-all-listing";
import { useObject } from "@/lib/use-object";
import { fetchAllPages } from "@/lib/pagination.mjs";
import { formatElapsed, useTimer } from "@/lib/timer";
import {
  INVOICE_STATUS,
  PROSPECT_COLUMNS,
  PROSPECT_STATUS,
  QUOTE_STATUS,
  remainingDue,
} from "@/lib/commercial";
import { PROJECT_STATUS, TASK_STATUS } from "@/lib/labels";
import {
  Alert,
  Button,
  FilterPills,
  ItemCard,
  ItemGrid,
  KpiGrid,
  Panel,
  Pill,
  SectionHead,
  StatusPill,
  toneBackground,
} from "@/components/softui";
import { HealthList } from "@/components/softui/panels";
import { Empty } from "@/components/workspace/ui";
import { AgencyView, MyDayView } from "./TeamViews";

const ACTIVE_PROJECT = ["PLANNED", "IN_PROGRESS", "IN_REVIEW"];
const OPEN_TASK = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"];
const CLOSED_TASK = ["DONE", "CANCELLED"];
const UNPAID_INVOICE = ["SENT", "PARTIALLY_PAID", "OVERDUE"];
const OPEN_QUOTE = ["DRAFT", "SENT", "VIEWED"];
const MONTH_FMT = new Intl.DateTimeFormat("fr-FR", { month: "short" });
const EMPTY = [];

/** Journée métier au format AAAA-MM-JJ dans le fuseau local (bornes de l'API). */
const isoDay = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/* Santé des projets : mêmes clés que l'API, libellés français et ratios. */
const HEALTH_LABEL = {
  ON_TRACK: "Dans les temps",
  AT_RISK: "À risque",
  DELAYED: "En retard",
  ON_HOLD: "En pause",
};
const HEALTH_HINT = {
  ON_TRACK: "projets alignés",
  AT_RISK: "projets à surveiller",
  DELAYED: "échéances dépassées",
  ON_HOLD: "projets suspendus",
};

export default function ControlCenter() {
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

  const canAgency = can(user, "dashboard:read:any");
  const canReadProjects = ["project:read:any", "project:read:assigned", "project:read:own"].some((p) => can(user, p));
  const canReadOwnTaskList = canReadOwnTasks(user);
  const canReadTeamTasks = can(user, "project:read:any") && can(user, "task:read:any");
  const canReadMilestones = can(user, "milestone:read:any");
  const canReadTime = can(user, "time:read:any") || can(user, "time:read:own");
  const canTime = canUseTimer(user);
  const canReadInvoices = can(user, "invoice:read:any");
  const canReadQuotes = can(user, "quote:read:any");
  const canReadProspects = can(user, "prospect:read:any") || can(user, "prospect:read:own");
  const canReadOrders = can(user, "order:read:any");

  const agency = useObject("/dashboard", canAgency);
  const me = useObject("/dashboard/me", true);
  const projects = useAllListing("/projects?perPage=100", canReadProjects);
  const myTasks = useAllListing("/me/tasks?perPage=100", canReadOwnTaskList);
  const timeEntries = useAllListing(`/time-entries?from=${weekAgo}&to=${todayIso}&perPage=100`, canReadTime);
  const invoices = useAllListing("/invoices?perPage=100", canReadInvoices);
  const quotes = useAllListing("/quotes?perPage=100", canReadQuotes);
  const prospects = useAllListing("/prospects?perPage=100", canReadProspects);
  const orders = useAllListing("/orders?perPage=100", canReadOrders);
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
    const healthCounts = activeProjects.reduce((counts, project) => {
      const health = project.health ?? (project.overdue ? "DELAYED" : "ON_TRACK");
      counts[health] = (counts[health] ?? 0) + 1;
      return counts;
    }, {});
    const projectHealth = Object.entries(healthCounts).map(([status, count]) => ({ status, count }));
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
      projectHealth,
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
    : Number.isFinite(Number(agency.data?.projects?.active ?? agencyCounters.activeProjects))
      ? Number(agency.data?.projects?.active ?? agencyCounters.activeProjects)
      : null;
  const openTasksCount = myTasksReady
    ? computed.myOpenTasks.length
    : Number.isFinite(Number(me.data?.tasks?.open ?? meCounters.openTasks))
      ? Number(me.data?.tasks?.open ?? meCounters.openTasks)
      : null;

  const errors = [...new Set([
    canAgency ? agency.error : null,
    me.error,
    projects.error,
    myTasks.error,
    timeEntries.error,
    invoices.error,
    quotes.error,
    prospects.error,
    extrasError,
  ].filter(Boolean))];

  const initialLoading =
    (canReadProjects && projects.items === null && projects.loading) ||
    (canReadInvoices && invoices.items === null && invoices.loading);

  const finance = agency.data ? {
    ...agency.data.invoices,
    collected: agency.data.collected,
    rate: Math.round((agency.data.collectionRate ?? 0) * 100),
  } : invoicesReady ? {
    open: { total: computed.outstanding, currency: computed.currency, count: computed.unpaidInvoices.length },
    overdue: {
      total: computed.unpaidInvoices.filter((invoice) => invoice.overdue).reduce((sum, invoice) => sum + invoice.remaining, 0),
      currency: computed.currency,
      count: computed.overdueInvoicesCount,
    },
    collected: { total: computed.collectedTotal, currency: computed.currency },
  } : {};

  /* Taux d'encaissement affiché dans le volet détaillé. */
  const rate = Number.isFinite(Number(finance.rate)) ? Number(finance.rate) : null;

  /* Devis ouverts (mêmes critères que le mémo) pour la file de validation. */
  const openQuotes = quotesReady ? (quotes.items ?? EMPTY).filter((quote) => OPEN_QUOTE.includes(quote.status)) : EMPTY;

  /* Carte fantôme : ce qui attend réellement une décision de l'équipe. */
  const waitingDecision = useMemo(() => {
    const sources = [
      invoicesReady ? computed.unpaidInvoices.length : null,
      projectsDataReady ? computed.lateProjects : null,
      myTasksReady ? computed.myOverdue : null,
    ];
    if (sources.every((value) => value === null)) return null;
    return sources.reduce((sum, value) => sum + (value ?? 0), 0);
  }, [
    computed.lateProjects,
    computed.myOverdue,
    computed.unpaidInvoices.length,
    invoicesReady,
    myTasksReady,
    projectsDataReady,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Préparation de l'affichage (aucune requête supplémentaire)              */
  /* ---------------------------------------------------------------------- */

  const money = (value) => (Number.isFinite(Number(value)) ? formatMoney(value, computed.currency) : "—");

  /* Accès direct : uniquement des rubriques réellement autorisées. */
  const quickLinks = [
    canReadProspects ? { id: "prospects", label: "Pipeline", href: "/espace-equipe/prospects", icon: Compass } : null,
    canReadQuotes ? { id: "quotes", label: "Devis ouverts", href: "/espace-equipe/devis", icon: FileText } : null,
    canReadInvoices ? { id: "invoices", label: "Factures", href: "/espace-equipe/factures", icon: CreditCard } : null,
    canReadOrders ? { id: "orders", label: "Commandes", href: "/espace-equipe/commandes", icon: ReceiptText } : null,
    canReadOwnTaskList ? { id: "tasks", label: "Mes tâches", href: "/espace-equipe/taches", icon: CheckSquare } : null,
    canReadTime ? { id: "daily", label: "Rapport du jour", href: "/espace-equipe/rapports-journaliers", icon: FileCheck2 } : null,
    { id: "calendar", label: "Calendrier", href: "/espace-equipe/calendrier", icon: CalendarDays },
  ].filter(Boolean);

  /* Indicateurs : trois pastels + la carte fantôme « à traiter ». */
  const kpis = [
    {
      id: "collected",
      tone: "green",
      deco: true,
      decoIcon: Sparkles,
      badge: canReadInvoices && invoicesReady ? `+ ${money(computed.collectedMonth)} ce mois` : "En direct",
      value: canReadInvoices
        ? invoicesReady
          ? money(computed.collectedTotal)
          : "…"
        : activeProjectsCount !== null
          ? String(activeProjectsCount)
          : "—",
      label: canReadInvoices ? "Chiffre d’affaires encaissé" : "Projets suivis",
      href: canReadInvoices ? "/espace-equipe/factures" : "/espace-equipe/projets",
    },
    {
      id: "outstanding",
      tone: "yellow",
      badge: quotesReady ? `${computed.openQuotesCount} devis ouverts` : "Suivi",
      value: canReadInvoices
        ? invoicesReady
          ? money(computed.outstanding)
          : "…"
        : openTasksCount !== null
          ? String(openTasksCount)
          : "—",
      label: canReadInvoices ? "Reste à encaisser" : "Mes tâches ouvertes",
      href: canReadInvoices ? "/espace-equipe/factures" : "/espace-equipe/taches",
    },
    {
      id: "production",
      tone: "blue",
      badge: projectsDataReady ? `Avancement ${computed.avgProgress} %` : "Production",
      value: activeProjectsCount !== null ? String(activeProjectsCount) : "…",
      label: "Projets actifs",
      href: "/espace-equipe/projets",
    },
    {
      id: "waiting",
      tone: "ghost",
      value: waitingDecision === null ? "…" : String(waitingDecision),
      label: "À traiter : impayés, retards et tâches échues",
      href: "/espace-equipe/taches",
    },
  ];

  /* File de validation : impayés, projets, devis et échéances au même endroit. */
  const queue = [
    ...computed.unpaidInvoices.slice(0, 3).map((invoice) => ({
      id: `invoice-${invoice.id}`,
      cornerIcon: invoice.overdue ? TriangleAlert : CreditCard,
      cornerTone: invoice.overdue ? "pink" : "blue",
      title: `Facture ${invoice.reference}`,
      description: invoice.clientName ?? "Client à rattacher",
      meta: [
        { icon: Wallet, label: money(invoice.remaining) },
        {
          icon: CalendarClock,
          label: invoice.dueDate ? `Échéance ${formatDateOnly(invoice.dueDate)}` : "Sans échéance",
        },
      ],
      info: money(invoice.remaining),
      status: invoice.overdue ? "En retard" : (INVOICE_STATUS[invoice.status] ?? invoice.status),
      statusIcon: invoice.overdue ? TriangleAlert : Hourglass,
      statusTone: invoice.overdue ? "pink" : "yellow",
      actions: [
        { icon: ReceiptText, label: `Ouvrir la facture ${invoice.reference}`, href: `/espace-equipe/factures/${invoice.id}` },
        { icon: BadgeCheck, label: "Suivre les encaissements", href: "/espace-equipe/factures", variant: "dark" },
      ],
    })),

    ...computed.activeProjects.slice(0, 3).map((project) => ({
      id: `project-${project.id}`,
      cornerIcon: FolderKanban,
      cornerTone: project.overdue ? "pink" : "green",
      title: project.name,
      description: project.reference ? `Référence ${project.reference}` : "Projet sans référence",
      meta: [
        { icon: Users, label: project.clientName ?? project.client?.companyName ?? "Client" },
        {
          icon: CalendarClock,
          label: project.dueDate ? `Échéance ${formatDateOnly(project.dueDate)}` : "Sans échéance",
        },
      ],
      progress: {
        value: Number(project.progressPercent) || 0,
        ratio: `${Number(project.progressPercent) || 0} %`,
      },
      status: project.overdue ? "Retard" : (PROJECT_STATUS[project.status] ?? project.status),
      statusIcon: project.overdue ? TriangleAlert : Radio,
      statusTone: project.overdue ? "pink" : "yellow",
      actions: [
        { icon: CheckSquare, label: `Voir les tâches de ${project.name}`, href: "/espace-equipe/taches" },
        { icon: FolderKanban, label: `Ouvrir le projet ${project.name}`, href: `/espace-equipe/projets/${project.id}`, variant: "dark" },
      ],
    })),

    ...openQuotes.slice(0, 3).map((quote) => ({
      id: `quote-${quote.id}`,
      cornerIcon: FileText,
      cornerTone: "lilac",
      title: quote.subject || quote.reference,
      description: quote.clientName ?? "Client à rattacher",
      meta: [
        { icon: Wallet, label: money(quote.total) },
        {
          icon: CalendarClock,
          label: quote.validUntil ? `Valable jusqu’au ${formatDateOnly(quote.validUntil)}` : "Sans limite",
        },
      ],
      info: money(quote.total),
      status: QUOTE_STATUS[quote.status] ?? quote.status,
      statusIcon: Hourglass,
      statusTone: quote.status === "VIEWED" ? "yellow" : "plain",
      actions: [
        { icon: FileText, label: `Ouvrir le devis ${quote.reference}`, href: `/espace-equipe/devis/${quote.id}`, variant: "dark" },
      ],
    })),

    ...computed.dueSoon.slice(0, 3).map((entry) => ({
      id: `due-${entry.id}`,
      cornerIcon: CalendarClock,
      cornerTone: entry.overdue ? "pink" : "yellow",
      title: entry.title,
      description: entry.context,
      meta: [
        {
          icon: CalendarDays,
          label: `${entry.overdue ? "Dépassée le" : "Échéance le"} ${formatDateOnly(entry.dueDate)}`,
        },
      ],
      status: entry.overdue ? "En retard" : "À venir",
      statusIcon: entry.overdue ? TriangleAlert : Hourglass,
      statusTone: entry.overdue ? "pink" : "yellow",
      actions: [{ icon: FolderKanban, label: `Ouvrir ${entry.title}`, href: entry.href, variant: "dark" }],
    })),
  ];

  /* Santé de l'espace : barre 4 px, piste claire, remplissage vert, ratio à droite. */
  const healthTotal = computed.projectHealth.reduce((sum, row) => sum + row.count, 0);
  const healthItems = computed.projectHealth.map((row) => ({
    id: row.status,
    label: HEALTH_LABEL[row.status] ?? row.status,
    hint: `${HEALTH_HINT[row.status] ?? "projets"}`,
    value: healthTotal ? Math.round((row.count / healthTotal) * 100) : 0,
    ratio: `${row.count} / ${healthTotal}`,
  }));

  return (
    <div className="flex flex-col gap-6">
      {errors.length > 0 ? (
        <div className="flex flex-col gap-2">
          {errors.map((err, index) => (
            <Alert key={`${index}-${err}`} icon={CircleAlert}>
              {err}
            </Alert>
          ))}
        </div>
      ) : null}

      {/* 1. Indicateurs pastel, dont la carte fantôme « à traiter ». */}
      {initialLoading ? (
        <KpiSkeleton />
      ) : (
        <KpiGrid
          label="Indicateurs clés de l’espace équipe"
          items={kpis.map((kpi) => ({
            id: kpi.id,
            tone: kpi.tone,
            badge: kpi.badge,
            deco: kpi.deco,
            decoIcon: kpi.decoIcon,
            label: kpi.label,
            value: kpi.href ? (
              <Link href={kpi.href} className="sui-kpi__link">
                {kpi.value}
              </Link>
            ) : (
              kpi.value
            ),
          }))}
        />
      )}

      {/* 2. Accès direct + bascule de vue. */}
      <section className="sui-section" aria-label="Accès direct">
        <div className="sui-toolbar">
          <FilterPills
            label="Accès direct aux rubriques"
            items={quickLinks.map((link) => ({ id: link.id, label: link.label, href: link.href, icon: link.icon }))}
          />
          {canAgency ? (
            <div className="sui-filters" role="group" aria-label="Mode du tableau de bord" style={{ marginLeft: "auto" }}>
              <Pill active={currentView === "agency"} onClick={() => setView("agency")}>
                Vue agence
              </Pill>
              <Pill active={currentView === "day"} onClick={() => setView("day")}>
                Ma journée
              </Pill>
            </div>
          ) : null}
        </div>
      </section>

      {/* 3. File de validation. */}
      <section className="sui-section" aria-label="File de validation">
        <SectionHead icon={FolderKanban} title="File de validation" count={queue.length}>
          <div className="flex flex-wrap items-center gap-2">
            {waitingDecision !== null ? (
              <StatusPill
                tone={waitingDecision > 0 ? "yellow" : "green"}
                icon={waitingDecision > 0 ? Hourglass : BadgeCheck}
                label={waitingDecision > 0 ? `${waitingDecision} en attente de décision` : "Rien en attente"}
              />
            ) : null}
            <Button href="/espace-equipe/projets" icon={FolderKanban}>
              Tous les projets
            </Button>
          </div>
        </SectionHead>

        {!projectsDataReady && projects.loading ? (
          <p className="sui-card__desc">Chargement de la file de validation…</p>
        ) : null}
        {queue.length === 0 && projectsDataReady ? <Empty icon={BadgeCheck}>Rien à valider pour le moment.</Empty> : null}
        {queue.length > 0 ? (
          <ItemGrid label="Éléments à valider">
            {queue.map((card) => (
              <ItemCard key={card.id} {...card} />
            ))}
          </ItemGrid>
        ) : null}
      </section>

      {/* 4. Activité récente + santé de l'espace. */}
      <section className="sui-section" aria-label="Activité et santé de l’espace">
        <div className="sui-split">
          <Panel
            title="Activité récente"
            action={
              can(user, "audit:read:any") ? (
                <Button href="/espace-equipe/journal" icon={FileText}>
                  Journal complet
                </Button>
              ) : null
            }
          >
            <p className="sui-card__desc">
              Le fil d’activité transversal n’est pas exposé par l’API. Le journal d’audit conserve
              l’historique des actions de l’espace.
            </p>
          </Panel>

          <Panel
            title="Santé de l’espace"
            action={
              can(user, "report:read:any") ? (
                <Button href="/espace-equipe/analytique" icon={Sparkles}>
                  Ouvrir l’analytique
                </Button>
              ) : null
            }
          >
            {projects.error ? (
              <Alert icon={CircleAlert}>{projects.error}</Alert>
            ) : healthItems.length === 0 ? (
              <p className="sui-card__desc">
                {projectsDataReady ? "Aucun projet actif à suivre." : "Chargement des projets…"}
              </p>
            ) : (
              <HealthList items={healthItems} />
            )}
          </Panel>
        </div>
      </section>

      {/* 5. Données détaillées, repliées : mêmes chiffres, présentation tabulaire. */}
      <details className="sui-details">
        <summary className="sui-details__summary">
          <ChevronDown size={18} strokeWidth={1.75} aria-hidden="true" />
          Explorer les données détaillées
        </summary>

        <div className="sui-details__body">
          <div className="sui-split">
            {canReadInvoices ? (
              <Panel title="Facturation" action={<span className="sui-section__count">{rate == null ? "—" : `${rate} % encaissé`}</span>}>
                <dl className="sui-money">
                  <div>
                    <dt>Encours</dt>
                    <dd>{money(finance.open?.total)}</dd>
                  </div>
                  <div>
                    <dt>En retard</dt>
                    <dd>{money(finance.overdue?.total)}</dd>
                  </div>
                  <div>
                    <dt>Encaissé</dt>
                    <dd>{money(finance.collected?.total)}</dd>
                  </div>
                </dl>
                <Button href="/espace-equipe/factures" icon={ReceiptText}>
                  Toutes les factures
                </Button>
              </Panel>
            ) : (
              <Panel title="Temps enregistré">
                <p className="sui-money__big">{timeReady ? computed.weekHours : timeEntries.loading ? "…" : "—"}</p>
                <p className="sui-card__desc">
                  {timeReady ? `${computed.myEntries.length} saisie(s) sur les 7 derniers jours` : "Feuille de temps personnelle."}
                </p>
                {canReadTime ? (
                  <Button href="/espace-equipe/temps" icon={CalendarClock}>
                    Ouvrir la feuille de temps
                  </Button>
                ) : null}
              </Panel>
            )}

            <Panel title="Échéances à 7 jours" action={<span className="sui-section__count">{computed.dueSoon.length}</span>}>
              {!dueSoonReady ? (
                <p className="sui-card__desc">Chargement des échéances…</p>
              ) : computed.dueSoon.length === 0 ? (
                <p className="sui-card__desc">Aucune échéance à venir dans votre périmètre.</p>
              ) : (
                <ul className="sui-lines">
                  {computed.dueSoon.map((entry) => (
                    <li key={entry.id}>
                      <Link href={entry.href}>
                        <span
                          className="sui-lines__icon"
                          style={{ "--tone-bg": toneBackground(entry.overdue ? "pink" : "blue") }}
                          aria-hidden="true"
                        >
                          <CalendarClock size={16} strokeWidth={1.75} />
                        </span>
                        <span className="sui-lines__copy">
                          <strong>{entry.title}</strong>
                          <span>{entry.context}</span>
                        </span>
                        <span className={`sui-lines__end${entry.overdue ? " sui-lines__end--late" : ""}`}>
                          {formatDateOnly(entry.dueDate)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Button href="/espace-equipe/calendrier" icon={CalendarDays}>
                Voir le calendrier
              </Button>
            </Panel>

            {canTime ? <TimerPanel tasks={myTasks} /> : null}

            {canReadInvoices ? (
              <Panel title="Encaissements mensuels" action={<span className="sui-section__count">6 mois</span>}>
                <BarList
                  rows={computed.revenueMonths.map((month) => ({
                    id: month.key,
                    label: month.mois,
                    value: month.encaisse,
                    text: invoicesReady ? money(month.encaisse) : "…",
                  }))}
                  empty="Aucun encaissement sur la période."
                />
                <Button href="/espace-equipe/factures" icon={ReceiptText}>
                  Détail des factures
                </Button>
              </Panel>
            ) : null}

            {canReadProspects ? (
              <Panel
                title="Pipeline de prospection"
                action={<span className="sui-section__count">{prospectsReady ? computed.prospectList.length : "…"}</span>}
              >
                <BarList
                  tone="lilac"
                  rows={computed.pipelineStages.map((stage, index) => ({
                    id: `${stage.etape}-${index}`,
                    label: stage.etape,
                    value: stage.prospects,
                    text: `${stage.prospects}`,
                  }))}
                  empty="Aucun prospect dans le pipeline."
                />
                <Button href="/espace-equipe/prospects" icon={Compass}>
                  Ouvrir le pipeline
                </Button>
              </Panel>
            ) : null}
          </div>

          <Panel title={currentView === "agency" ? "Vue d’ensemble de l’agence" : "Ma journée"}>
            {currentView === "agency" && canAgency ? (
              agency.data ? (
                <AgencyView data={agency.data} />
              ) : (
                <p className="sui-card__desc">
                  {agency.loading ? "Chargement de la vue agence…" : "La vue agence est indisponible pour le moment."}
                </p>
              )
            ) : me.data ? (
              <MyDayView data={me.data} />
            ) : (
              <p className="sui-card__desc">
                {me.loading ? "Chargement de votre journée…" : "Votre journée est indisponible pour le moment."}
              </p>
            )}
          </Panel>
        </div>
      </details>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Blocs de présentation (aucune logique métier)                               */
/* -------------------------------------------------------------------------- */

/** Barres horizontales pastel en `div` : mêmes données, aucune librairie. */
function BarList({ rows = [], empty = "Aucune donnée.", tone = "green" }) {
  const max = Math.max(...rows.map((row) => Number(row.value) || 0), 1);
  if (!rows.length) return <p className="sui-card__desc">{empty}</p>;
  return (
    <ul className="sui-bars">
      {rows.map((row) => (
        <li key={row.id}>
          <span className="sui-bars__label">{row.label}</span>
          <span className="sui-bars__track" aria-hidden="true">
            <span
              className="sui-bars__fill"
              style={{
                width: `${Math.round(((Number(row.value) || 0) / max) * 100)}%`,
                "--tone-bg": toneBackground(row.tone ?? tone),
              }}
            />
          </span>
          <span className="sui-bars__value">{row.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Minuteur : même contexte que le reste de l'application (état persisté). */
function TimerPanel({ tasks }) {
  const { timer, elapsedSeconds, start, pause, resume, stop, saving, error } = useTimer();
  const list = (tasks.items ?? []).filter((task) => !CLOSED_TASK.includes(task.status)).slice(0, 8);

  return (
    <Panel title="Minuteur" action={<span className="sui-section__count">{timer ? formatElapsed(elapsedSeconds) : "inactif"}</span>}>
      {timer ? (
        <>
          <p className="sui-card__desc">
            {timer.title}
            {timer.taskIsPersonal ? " · personnel" : ""} — {timer.status === "PAUSED" ? "en pause" : "enregistrement en cours"}
          </p>
          <div className="flex flex-wrap gap-2">
            {timer.status === "PAUSED" ? (
              <Button variant="dark" icon={Play} onClick={() => resume()} disabled={saving}>
                Reprendre
              </Button>
            ) : (
              <Button icon={Pause} onClick={() => pause()} disabled={saving}>
                Pause
              </Button>
            )}
            <Button variant="dark" icon={Square} onClick={() => stop()} disabled={saving}>
              {saving ? "Enregistrement…" : "Arrêter et enregistrer"}
            </Button>
          </div>
        </>
      ) : (
        <>
          {tasks.error ? <Alert icon={CircleAlert}>{tasks.error}</Alert> : null}
          {tasks.items === null && !tasks.error ? <p className="sui-card__desc">Chargement des tâches…</p> : null}
          {tasks.items !== null && list.length === 0 && !tasks.error ? (
            <p className="sui-card__desc">Aucune tâche ouverte assignée.</p>
          ) : null}
          {list.length > 0 ? (
            <ul className="sui-pills-list">
              {list.map((task) => (
                <li key={task.id}>
                  <button type="button" className="sui-pill" onClick={() => start(task)}>
                    <Play size={16} strokeWidth={1.75} aria-hidden="true" />
                    {task.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      {error ? <Alert icon={CircleAlert}>{error}</Alert> : null}
      <Button href="/espace-equipe/taches" icon={CheckSquare}>
        Voir toutes les tâches
      </Button>
    </Panel>
  );
}

/** Squelette de la rangée d'indicateurs pendant le premier chargement. */
function KpiSkeleton() {
  return (
    <div className="sui-kpis" role="status" aria-label="Chargement des indicateurs">
      {[0, 1, 2, 3].map((index) => (
        <div className="sui-kpi sui-skeleton" key={index} style={{ minHeight: 132 }} />
      ))}
    </div>
  );
}
