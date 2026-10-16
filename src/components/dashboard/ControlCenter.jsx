"use client";

/*
 * Control Center — tableau de bord de l'ESPACE ÉQUIPE, habillé en « soft UI
 * pastel dans une coque noire ».
 *
 * Mêmes sources que l'ancien tableau de bord (`/dashboard`, `/dashboard/me`,
 * `/projects`, `/me/tasks`, `/time-entries`, `/invoices`, `/quotes`,
 * `/prospects`, `/orders`, tâches et jalons par projet) et mêmes garde-fous
 * `can(user, "…")`. Les requêtes partent avec l'en-tête d'espace « team » :
 * aucune donnée personnelle (tâches privées, agenda privé) n'y figure.
 *
 *   1. quatre indicateurs pastel, dont la carte « fantôme » des points
 *      d'attention (impayés, projets en retard, tâches échues) ;
 *   2. accès direct aux rubriques autorisées ;
 *   3. « À suivre » : factures ouvertes, projets actifs, devis, échéances ;
 *   4. activité récente des projets (fil réel `/projects/:id/activities`) et
 *      santé des projets ;
 *   5. repliées, les données détaillées (facturation, échéances, minuteur,
 *      encaissements mensuels, pipeline, vue agence).
 *
 * « Ma journée » n'est plus ici : elle vit dans l'Espace personnel.
 * Aucun emoji : chaque symbole est une icône `lucide-react`.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock,
  Compass,
  CreditCard,
  FileCheck2,
  FileText,
  FileUp,
  Flag,
  FolderKanban,
  Hash,
  Hourglass,
  Info,
  ListPlus,
  MessageSquare,
  Pause,
  Play,
  Radio,
  ReceiptText,
  RefreshCw,
  Sparkles,
  Square,
  StickyNote,
  TriangleAlert,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { formatDateOnly, formatMoney, messageOf } from "@/lib/api";
import { activitySentence } from "@/lib/activity-labels.mjs";
import { isDeadlinePassed } from "@/lib/date-utils.mjs";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { canReadOwnTasks, canUseTimer } from "@/lib/timer-access";
import { useAllListing } from "@/lib/use-all-listing";
import { useObject } from "@/lib/use-object";
import { fetchAllPages } from "@/lib/pagination.mjs";
import TimerPanel from "@/components/timer/TimerPanel";
import {
  INVOICE_STATUS,
  PROSPECT_COLUMNS,
  PROSPECT_STATUS,
  QUOTE_STATUS,
  quoteRecipient,
  remainingDue,
} from "@/lib/commercial";
import { PROJECT_STATUS, TASK_STATUS } from "@/lib/labels";
import {
  ActivityList,
  Alert,
  Button,
  FilterPills,
  ItemCard,
  ItemGrid,
  KpiGrid,
  Panel,
  SectionHead,
  StatusPill,
  formatRelativeTime,
  toneBackground,
} from "@/components/softui";
import { HealthList } from "@/components/softui/panels";
import { Empty } from "@/components/workspace/ui";
import { AgencyView } from "./TeamViews";

const ACTIVE_PROJECT = ["PLANNED", "IN_PROGRESS", "IN_REVIEW"];
const OPEN_TASK = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"];
const CLOSED_TASK = ["DONE", "CANCELLED"];
const UNPAID_INVOICE = ["SENT", "PARTIALLY_PAID", "OVERDUE"];
const OPEN_QUOTE = ["DRAFT", "SENT", "VIEWED"];
const MONTH_FMT = new Intl.DateTimeFormat("fr-FR", { month: "short" });
const EMPTY = [];

/** Accord en nombre (0 et 1 au singulier, comme en français). */
const plural = (count, singular, pluralForm = `${singular}s`) => `${count} ${count > 1 ? pluralForm : singular}`;

/* Fil d'activité : une icône et une teinte par type d'événement. */
const ACTIVITY_META = {
  COMMENT: { icon: MessageSquare, tone: "blue" },
  STATUS_CHANGE: { icon: RefreshCw, tone: "yellow" },
  TASK_CREATED: { icon: ListPlus, tone: "lilac" },
  TASK_COMPLETED: { icon: CircleCheck, tone: "green" },
  MILESTONE_REACHED: { icon: Flag, tone: "green" },
  FILE_UPLOADED: { icon: FileUp, tone: "blue" },
  TIME_LOGGED: { icon: Clock, tone: "yellow" },
  NOTE: { icon: StickyNote, tone: "lilac" },
  SYSTEM: { icon: Info, tone: "blue" },
};
/* Nombre de projets interrogés pour le fil (les plus récemment modifiés). */
const ACTIVITY_PROJECTS = 6;

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
  const canReadActivity = can(user, "activity:read:any") || can(user, "activity:read:own");
  /* Les feuilles de temps et rapports de l'équipe demandent `time:read:any` ;
     sinon, ses propres saisies se consultent dans l'Espace personnel. */
  const timeHref = can(user, "time:read:any") ? "/espace-equipe/temps" : "/espace-personnel/temps";
  const dailyHref = can(user, "time:read:any") ? "/espace-equipe/rapports-journaliers" : "/espace-personnel/rapports-journaliers";

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
  const [activityFeed, setActivityFeed] = useState({ items: EMPTY, error: null, key: null });

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

  /* Fil d'activité : les projets vivants (actifs d'abord, puis livrés), les
     plus récents en tête ; 5 événements chacun, fusionnés par date. Données
     réelles, dans le périmètre que le serveur accorde au porteur. */
  const activityProjects = useMemo(() => {
    if (!canReadActivity) return EMPTY;
    const rank = (project) => (ACTIVE_PROJECT.includes(project.status) || project.status === "ON_HOLD" ? 0 : 1);
    return projectItems
      .filter((project) => ACTIVE_PROJECT.includes(project.status) || ["ON_HOLD", "COMPLETED"].includes(project.status))
      .sort((a, b) => rank(a) - rank(b) || new Date(b.updatedAt ?? b.createdAt ?? 0) - new Date(a.updatedAt ?? a.createdAt ?? 0))
      .slice(0, ACTIVITY_PROJECTS);
  }, [canReadActivity, projectItems]);
  const activityKey = activityProjects.map((project) => project.id).join(",");

  useEffect(() => {
    if (!canReadActivity || !activityKey) return undefined;
    const controller = new AbortController();
    Promise.all(
      activityProjects.map(async (project) => {
        const { data } = await request(`/projects/${encodeURIComponent(project.id)}/activities?perPage=5`, { signal: controller.signal });
        return (Array.isArray(data) ? data : []).map((entry) => ({ ...entry, project }));
      }),
    )
      .then((chunks) => {
        if (controller.signal.aborted) return;
        const items = chunks
          .flat()
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 6);
        setActivityFeed({ items, error: null, key: activityKey });
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setActivityFeed({ items: EMPTY, error: messageOf(caught), key: activityKey });
      });
    return () => controller.abort();
  }, [activityKey, activityProjects, canReadActivity, request]);

  const activityReady = !activityKey || activityFeed.key === activityKey;

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
    /* Encaissements datés : chaque paiement réussi à SA date. L'ancien calcul
       datait tout le montant réglé à l'émission de la facture (ou à son solde
       complet) : un acompte reçu ce mois-ci sur une facture émise le mois
       dernier affichait « + 0,00 € ce mois ». */
    const receipts = [];
    for (const inv of invoiceList) {
      if (Array.isArray(inv.payments)) {
        for (const payment of inv.payments) {
          if (payment.status !== "SUCCEEDED" || payment.deletedAt || !payment.paidAt) continue;
          receipts.push({ amount: Number(payment.amount) || 0, date: new Date(payment.paidAt) });
        }
      } else {
        const paid = Number(inv.amountPaid) || 0;
        const ref = inv.paidAt ?? inv.issueDate ?? inv.createdAt;
        if (paid && ref) receipts.push({ amount: paid, date: new Date(ref) });
      }
    }
    let collectedTotal = 0;
    let outstanding = 0;
    for (const inv of invoiceList) {
      collectedTotal += Number(inv.amountPaid) || 0;
      if (UNPAID_INVOICE.includes(inv.status)) outstanding += remainingDue(inv);
    }
    const collectedMonth = receipts.filter((receipt) => receipt.date >= monthStart).reduce((sum, receipt) => sum + receipt.amount, 0);
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
    for (const receipt of receipts) {
      const d = receipt.date;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const bucket = revenueMonths.find((m) => m.key === key);
      if (bucket) bucket.encaisse = Math.round((bucket.encaisse + receipt.amount) * 100) / 100;
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

  /* Carte fantôme : les points d'attention réellement visibles par ce porteur
     (impayés pour qui lit la facturation, projets en retard, tâches échues). */
  const attention = useMemo(() => {
    const parts = [];
    if (invoicesReady) parts.push({ id: "unpaid", count: computed.overdueInvoicesCount, text: plural(computed.overdueInvoicesCount, "facture en retard", "factures en retard") });
    if (projectsDataReady) parts.push({ id: "late", count: computed.lateProjects, text: plural(computed.lateProjects, "projet en retard", "projets en retard") });
    if (myTasksReady) parts.push({ id: "tasks", count: computed.myOverdue, text: plural(computed.myOverdue, "tâche échue", "tâches échues") });
    if (parts.length === 0) return null;
    return { total: parts.reduce((sum, part) => sum + part.count, 0), parts };
  }, [
    computed.lateProjects,
    computed.myOverdue,
    computed.overdueInvoicesCount,
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
    canReadQuotes ? { id: "quotes", label: "Devis", href: "/espace-equipe/devis", icon: FileText } : null,
    canReadInvoices ? { id: "invoices", label: "Factures", href: "/espace-equipe/factures", icon: CreditCard } : null,
    canReadOrders ? { id: "orders", label: "Commandes", href: "/espace-equipe/commandes", icon: ReceiptText } : null,
    canReadOwnTaskList ? { id: "tasks", label: "Tâches", href: "/espace-equipe/taches", icon: CheckSquare } : null,
    canReadTime ? { id: "daily", label: "Rapport du jour", href: dailyHref, icon: FileCheck2 } : null,
    { id: "calendar", label: "Calendrier", href: "/espace-equipe/calendrier", icon: CalendarDays },
  ].filter(Boolean);

  const dueSoonCount = computed.dueSoon.length;

  /* Indicateurs : trois pastels + la carte fantôme des points d'attention.
     Sans accès à la facturation, les cartes financières laissent la place à
     des indicateurs de production (jamais deux fois le même chiffre). */
  const kpis = [
    canReadInvoices
      ? {
          id: "collected",
          tone: "green",
          deco: true,
          decoIcon: Sparkles,
          badge: invoicesReady ? `+ ${money(computed.collectedMonth)} ce mois` : "Encaissements",
          value: invoicesReady ? money(computed.collectedTotal) : "…",
          label: "Chiffre d’affaires encaissé",
          href: "/espace-equipe/factures",
        }
      : {
          id: "due-soon",
          tone: "green",
          deco: true,
          decoIcon: CalendarClock,
          badge: dueSoonReady ? (computed.dueOverdue ? `dont ${computed.dueOverdue} dépassée${computed.dueOverdue > 1 ? "s" : ""}` : "Rien de dépassé") : "Échéances",
          value: dueSoonReady ? String(dueSoonCount) : "…",
          label: dueSoonCount > 1 ? "Échéances à 7 jours" : "Échéance à 7 jours",
          href: "/espace-equipe/calendrier",
        },
    canReadInvoices
      ? {
          id: "outstanding",
          tone: "yellow",
          badge: quotesReady ? plural(computed.openQuotesCount, "devis ouvert", "devis ouverts") : "Facturation",
          value: invoicesReady ? money(computed.outstanding) : "…",
          label: "Reste à encaisser",
          href: "/espace-equipe/factures",
        }
      : {
          id: "tasks",
          tone: "yellow",
          badge: myTasksReady && computed.myOverdue ? plural(computed.myOverdue, "en retard", "en retard") : "Projets de l’équipe",
          value: openTasksCount !== null ? String(openTasksCount) : "…",
          label: openTasksCount > 1 ? "Tâches ouvertes assignées" : "Tâche ouverte assignée",
          href: "/espace-equipe/taches",
        },
    {
      id: "production",
      tone: "blue",
      badge: projectsDataReady ? `Avancement moyen ${computed.avgProgress} %` : "Production",
      value: activeProjectsCount !== null ? String(activeProjectsCount) : "…",
      label: activeProjectsCount > 1 ? "Projets actifs" : "Projet actif",
      href: "/espace-equipe/projets",
    },
    {
      id: "attention",
      tone: "ghost",
      badge: "Points d’attention",
      value: attention === null ? "…" : String(attention.total),
      label: attention === null ? "Chargement…" : attention.parts.map((part) => part.text).join(" · "),
      href: "#a-suivre",
    },
  ];

  /* « À suivre » : factures ouvertes, projets actifs, devis et échéances au
     même endroit. Le montant n'apparaît qu'une fois par carte (pastille). */
  const queue = [
    ...computed.unpaidInvoices.slice(0, 3).map((invoice) => ({
      id: `invoice-${invoice.id}`,
      cornerIcon: invoice.overdue ? TriangleAlert : CreditCard,
      cornerTone: invoice.overdue ? "pink" : "blue",
      title: `Facture ${invoice.reference}`,
      titleHref: `/espace-equipe/factures/${invoice.id}`,
      description: invoice.client?.companyName ?? "Client non renseigné",
      meta: [
        ...(invoice.subject ? [{ icon: ReceiptText, label: invoice.subject }] : []),
        {
          icon: CalendarClock,
          label: invoice.dueDate ? `${invoice.overdue ? "Échue le" : "Échéance"} ${formatDateOnly(invoice.dueDate)}` : "Sans échéance",
        },
      ],
      info: `Reste ${money(invoice.remaining)}`,
      status: invoice.overdue ? "En retard" : (INVOICE_STATUS[invoice.status] ?? invoice.status),
      statusIcon: invoice.overdue ? TriangleAlert : Hourglass,
      statusTone: invoice.overdue ? "pink" : "yellow",
      actions: [
        { icon: Wallet, label: "Suivre les encaissements", href: "/espace-equipe/factures" },
        { icon: ArrowRight, label: `Ouvrir la facture ${invoice.reference}`, href: `/espace-equipe/factures/${invoice.id}`, variant: "dark" },
      ],
    })),

    ...computed.activeProjects.slice(0, 3).map((project) => ({
      id: `project-${project.id}`,
      cornerIcon: project.overdue ? TriangleAlert : FolderKanban,
      cornerTone: project.overdue ? "pink" : "green",
      title: project.name,
      titleHref: `/espace-equipe/projets/${project.id}`,
      description: project.client?.companyName ?? project.clientName ?? "Client non renseigné",
      meta: [
        ...(project.reference ? [{ icon: Hash, label: project.reference }] : []),
        {
          icon: CalendarClock,
          label: project.dueDate ? `${project.overdue ? "En retard · " : "Échéance "}${formatDateOnly(project.dueDate)}` : "Sans échéance",
        },
      ],
      progress: {
        value: Number(project.progressPercent) || 0,
        ratio: `${Number(project.progressPercent) || 0} %`,
        label: `Avancement de ${project.name}`,
      },
      status: project.overdue ? "En retard" : (PROJECT_STATUS[project.status] ?? project.status),
      statusIcon: project.overdue ? TriangleAlert : Radio,
      statusTone: project.overdue ? "pink" : "yellow",
      actions: [
        { icon: ArrowRight, label: `Ouvrir le projet ${project.name}`, href: `/espace-equipe/projets/${project.id}`, variant: "dark" },
      ],
    })),

    ...openQuotes.slice(0, 3).map((quote) => ({
      id: `quote-${quote.id}`,
      cornerIcon: FileText,
      cornerTone: "lilac",
      title: quote.subject || quote.reference,
      titleHref: `/espace-equipe/devis/${quote.id}`,
      description: quoteRecipient(quote),
      meta: [
        { icon: Hash, label: quote.reference },
        {
          icon: CalendarClock,
          label: quote.validUntil ? `Valable jusqu’au ${formatDateOnly(quote.validUntil)}` : "Sans limite de validité",
        },
      ],
      info: money(quote.total),
      status: QUOTE_STATUS[quote.status] ?? quote.status,
      statusIcon: Hourglass,
      statusTone: quote.status === "VIEWED" ? "yellow" : "plain",
      actions: [
        { icon: ArrowRight, label: `Ouvrir le devis ${quote.reference}`, href: `/espace-equipe/devis/${quote.id}`, variant: "dark" },
      ],
    })),

    ...computed.dueSoon.slice(0, 3).map((entry) => ({
      id: `due-${entry.id}`,
      cornerIcon: CalendarClock,
      cornerTone: entry.overdue ? "pink" : "yellow",
      title: entry.title,
      titleHref: entry.href,
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
      actions: [{ icon: ArrowRight, label: `Ouvrir ${entry.title}`, href: entry.href, variant: "dark" }],
    })),
  ];

  /* Fil d'activité : phrase réelle du serveur, auteur et projet en contexte. */
  const activityItems = activityFeed.items.map((entry) => {
    const meta = ACTIVITY_META[entry.type] ?? ACTIVITY_META.SYSTEM;
    const actor = entry.actor ? `${entry.actor.firstName ?? ""} ${entry.actor.lastName ?? ""}`.trim() : "";
    return {
      id: entry.id,
      icon: meta.icon,
      tone: meta.tone,
      sentence: (
        <Link href={`/espace-equipe/projets/${entry.project.id}`} className="sui-activity__link">
          {activitySentence(entry.message)}
          <span className="sui-activity__context">
            {actor ? (
              <>
                <UserRound size={12} strokeWidth={1.75} aria-hidden="true" /> {actor} ·{" "}
              </>
            ) : null}
            {entry.project.name}
          </span>
        </Link>
      ),
      time: formatRelativeTime(entry.createdAt, now),
    };
  });

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

      {/* 1. Indicateurs pastel, dont la carte fantôme des points d'attention. */}
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

      {/* 2. Accès direct aux rubriques autorisées. */}
      <section className="sui-section" aria-label="Accès direct">
        <FilterPills
          label="Accès direct aux rubriques"
          items={quickLinks.map((link) => ({ id: link.id, label: link.label, href: link.href, icon: link.icon }))}
        />
      </section>

      {/* 3. À suivre. */}
      <section className="sui-section" aria-label="À suivre" id="a-suivre" style={{ scrollMarginTop: 24 }}>
        <SectionHead icon={FolderKanban} title="À suivre" count={queue.length}>
          <div className="flex flex-wrap items-center gap-2">
            {attention !== null ? (
              <StatusPill
                tone={attention.total > 0 ? "pink" : "green"}
                icon={attention.total > 0 ? TriangleAlert : BadgeCheck}
                label={attention.total > 0 ? plural(attention.total, "point d’attention", "points d’attention") : "Aucun retard"}
              />
            ) : null}
            <Button href="/espace-equipe/projets" icon={FolderKanban}>
              Tous les projets
            </Button>
          </div>
        </SectionHead>

        {!projectsDataReady && projects.loading ? (
          <p className="sui-card__desc">Chargement des éléments à suivre…</p>
        ) : null}
        {queue.length === 0 && projectsDataReady ? <Empty icon={BadgeCheck}>Rien à suivre pour le moment.</Empty> : null}
        {queue.length > 0 ? (
          <ItemGrid label="Éléments à suivre">
            {queue.map((card) => (
              <ItemCard key={card.id} {...card} />
            ))}
          </ItemGrid>
        ) : null}
      </section>

      {/* 4. Activité récente des projets + santé des projets. */}
      <section className="sui-section" aria-label="Activité et santé des projets">
        <div className="sui-split">
          {canReadActivity ? (
            <Panel title="Activité récente des projets">
              {activityFeed.error && activityReady ? (
                <Alert icon={CircleAlert}>{activityFeed.error}</Alert>
              ) : !projectsDataReady || !activityReady ? (
                <p className="sui-card__desc">Chargement de l’activité…</p>
              ) : (
                <ActivityList items={activityItems} empty="Aucune activité récente sur les projets suivis." />
              )}
            </Panel>
          ) : null}

          <Panel
            title="Santé des projets"
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
              <Panel title="Temps enregistré sur les projets">
                <p className="sui-money__big">{timeReady ? computed.weekHours : timeEntries.loading ? "…" : "—"}</p>
                <p className="sui-card__desc">
                  {timeReady ? `${plural(computed.myEntries.length, "saisie", "saisies")} sur les 7 derniers jours` : "Vos saisies sur les projets de l’équipe."}
                </p>
                {canReadTime ? (
                  <Button href={timeHref} icon={CalendarClock}>
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

            {canTime ? (
              <section className="sui-panel sui-timer-card sui-timer-card--compact" aria-label="Minuteur">
                <TimerPanel variant="compact" />
              </section>
            ) : null}

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

          {canAgency ? (
            <Panel title="Vue d’ensemble de l’agence">
              {agency.data ? (
                <AgencyView data={agency.data} />
              ) : (
                <p className="sui-card__desc">
                  {agency.loading ? "Chargement de la vue agence…" : "La vue agence est indisponible pour le moment."}
                </p>
              )}
            </Panel>
          ) : null}

          {/* Les priorités personnelles (tâches privées, agenda, minuteur) ne
              se mélangent pas aux chiffres de l'équipe : elles ont leur espace. */}
          <Panel title="Votre journée">
            <p className="sui-card__desc">
              Vos tâches personnelles, votre agenda privé et votre temps de la semaine sont regroupés dans votre espace personnel.
            </p>
            <Button href="/espace-personnel/tableau-de-bord" icon={ArrowRight}>
              Ouvrir Ma journée
            </Button>
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
