"use client";

/*
 * Control Center (tableau de bord de l'équipe).
 *
 * Mise en page refondue en « soft UI pastel » : rangée de 4 KPI (dont une carte
 * fantôme pour ce qui reste à traiter), filtres en pilules pour la période, file
 * de validation en cartes, puis deux panneaux — activité récente et santé de
 * l'espace.
 *
 * AUCUNE donnée n'est inventée : tout vient des deux appels existants
 * (`/dashboard/me` et `/dashboard?preset=…`), chargés seulement si le porteur a
 * la permission correspondante. Les tableaux détaillés restent accessibles,
 * repliés, en bas de page : la refonte est visuelle, pas fonctionnelle.
 */

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  CircleAlert,
  Eye,
  Flag,
  ListChecks,
  RefreshCw,
  ReceiptText,
  Sparkles,
  SquareKanban,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { can } from "@/lib/access";
import { formatDate, formatMoney } from "@/lib/api";
import { TASK_STATUS } from "@/lib/labels";
import { useAuth } from "@/lib/session";
import { useObject } from "@/lib/use-object";
import { AgencyView, MyDayView } from "@/components/dashboard/TeamViews";
import {
  ActivityList,
  Alert,
  Button,
  FilterPills,
  HealthList,
  ItemCard,
  ItemGrid,
  KpiGrid,
  Panel,
  SectionHead,
  StatusPill,
} from "@/components/softui";
import { notificationMeta } from "@/components/softui/notification-map";
import { formatRelativeTime } from "@/components/softui/time";

const PERIOD_OPTIONS = [
  ["TODAY", "Aujourd’hui"],
  ["LAST_7_DAYS", "7 jours"],
  ["LAST_30_DAYS", "30 jours"],
  ["THIS_MONTH", "Ce mois"],
  ["LAST_MONTH", "Mois dernier"],
  ["THIS_QUARTER", "Trimestre"],
  ["THIS_YEAR", "Année"],
];

const HEALTH_LABEL = {
  ON_TRACK: "Dans les temps",
  AT_RISK: "À risque",
  DELAYED: "En retard",
  ON_HOLD: "En pause",
};

const PRIORITY_LABEL = { LOW: "Basse", NORMAL: "Normale", HIGH: "Haute", URGENT: "Urgente" };

const TASK_TONE = { TODO: "plain", IN_PROGRESS: "yellow", BLOCKED: "pink", IN_REVIEW: "lilac", DONE: "green", CANCELLED: "plain" };
const INVOICE_TONE = { DRAFT: "plain", ISSUED: "blue", SENT: "blue", PARTIALLY_PAID: "yellow", PAID: "green", OVERDUE: "pink", CANCELLED: "plain" };

export default function TableauDeBordPage() {
  const { user } = useAuth();
  const canSeeAgency = can(user, "dashboard:read:any");
  const canSeeMe = canSeeAgency || can(user, "dashboard:read:own");
  const [agencyPeriod, setAgencyPeriod] = useState("THIS_MONTH");
  const me = useObject("/dashboard/me", canSeeMe);
  const agency = useObject(`/dashboard?preset=${agencyPeriod}`, canSeeAgency);

  if (!canSeeMe) {
    return <Alert tone="warning" icon={CircleAlert}>Votre compte n’a pas accès au tableau de bord de l’équipe.</Alert>;
  }

  const personal = me.data;
  const organisation = agency.data;

  /* --- Repères clés : quatre chiffres réels, jamais simulés -------------- */
  const kpis = canSeeAgency
    ? [
        { id: "projects", tone: "blue", value: organisation?.projects?.active ?? "—", label: "Projets actifs", badge: organisation ? `${organisation.projects.total} au total` : "Chargement…" },
        { id: "tasks", tone: "green", value: organisation?.tasks?.open ?? "—", label: "Tâches ouvertes", badge: organisation ? `${organisation.tasks.overdue} en retard` : "Chargement…", deco: true },
        { id: "invoices", tone: "yellow", value: organisation?.invoices?.open?.count ?? "—", label: "Factures en attente", badge: organisation ? `Encaissé ${Math.round((organisation.collectionRate ?? 0) * 100)} %` : "Chargement…" },
        {
          id: "waiting",
          tone: "ghost",
          value: (organisation?.projects?.overdue ?? 0) + (organisation?.invoices?.overdue?.count ?? 0),
          label: "À traiter : retards cumulés",
        },
      ]
    : [
        { id: "open", tone: "blue", value: personal?.tasks?.open ?? "—", label: "Mes tâches ouvertes", badge: personal ? `${personal.tasks.total} au total` : "Chargement…" },
        { id: "today", tone: "green", value: formatMinutes(personal?.timeEntries?.todayMinutes), label: "Temps du jour", badge: personal?.timeEntries ? `${personal.timeEntries.monthEntries} saisies ce mois` : "—", deco: true },
        { id: "unread", tone: "yellow", value: personal?.notifications?.unread ?? "—", label: "Notifications non lues", badge: personal?.notifications ? "Boîte personnelle" : "—" },
        { id: "overdue", tone: "ghost", value: personal?.tasks?.overdue ?? 0, label: "Tâches en retard" },
      ];

  /* --- File de validation : échéances réelles de l'agence ---------------- */
  const queue = [
    ...(organisation?.upcoming?.tasks ?? []).slice(0, 4).map((task) => ({
      id: `task-${task.id}`,
      tone: "blue",
      cornerIcon: SquareKanban,
      title: task.title,
      description: task.projectName ?? "Tâche sans projet",
      meta: [
        { icon: CalendarDays, label: `Échéance ${formatDate(task.dueDate)}` },
        { icon: Flag, label: PRIORITY_LABEL[task.priority] ?? task.priority },
        { icon: UserRound, label: task.assigneeName ?? "Non assignée" },
      ],
      status: TASK_STATUS[task.status] ?? task.status,
      statusTone: TASK_TONE[task.status] ?? "plain",
      actions: task.projectId ? [{ icon: Eye, label: `Voir le projet de « ${task.title} »`, href: `/espace-equipe/projets/${task.projectId}` }] : [],
      mainAction: { label: "Ouvrir les tâches", href: "/espace-equipe/taches" },
    })),
    ...(organisation?.upcoming?.invoices ?? []).slice(0, 4).map((invoice) => ({
      id: `invoice-${invoice.id}`,
      tone: "yellow",
      cornerIcon: ReceiptText,
      title: invoice.reference,
      description: invoice.clientName ?? "Client non renseigné",
      meta: [
        { icon: CalendarDays, label: `Échéance ${formatDate(invoice.dueDate)}` },
        { icon: ReceiptText, label: `${formatMoney(invoice.outstanding, invoice.currency)} restant` },
      ],
      status: invoice.status,
      statusTone: INVOICE_TONE[invoice.status] ?? "plain",
      actions: [],
      mainAction: { label: "Ouvrir la facture", href: `/espace-equipe/factures/${invoice.id}` },
    })),
  ].slice(0, 6);

  const activity = (personal?.notifications?.recent ?? []).map((item) => {
    const meta = notificationMeta(item.type);
    return {
      id: item.id,
      icon: meta.icon,
      tone: meta.tone === "plain" ? "blue" : meta.tone,
      sentence: item.title,
      time: formatRelativeTime(item.createdAt),
    };
  });

  const health = (organisation?.projects?.byHealth ?? []).map((row) => {
    const total = organisation?.projects?.total || 1;
    return {
      id: row.status,
      label: HEALTH_LABEL[row.status] ?? row.status,
      hint: `${row.count} / ${total}`,
      value: Math.round((row.count / total) * 100),
      ratio: `${row.count} / ${total}`,
    };
  });

  const asOf = organisation?.asOf ?? personal?.asOf ?? null;

  return (
    <div className="flex flex-col">
      {me.error ? <Alert icon={CircleAlert}>{me.error}</Alert> : null}
      {agency.error ? <Alert icon={CircleAlert}>{agency.error}</Alert> : null}

      <KpiGrid items={kpis} label="Repères clés" />

      <section className="sui-section" aria-label="Période et actions">
        {canSeeAgency ? (
          <FilterPills
            label="Période analysée"
            value={agencyPeriod}
            onChange={setAgencyPeriod}
            items={PERIOD_OPTIONS.map(([id, label]) => ({ id, label }))}
            actions={
              <>
                <Button variant="ghost" icon={RefreshCw} onClick={() => { me.reload(); if (canSeeAgency) agency.reload(); }} disabled={me.loading || agency.loading}>
                  {me.loading || agency.loading ? "Actualisation…" : "Actualiser"}
                </Button>
                {can(user, "quote:write:any") ? (
                  <Button variant="dark" href="/espace-equipe/devis/nouveau">
                    Nouveau devis
                  </Button>
                ) : null}
              </>
            }
          />
        ) : (
          <div className="sui-toolbar">
            <Button variant="ghost" icon={RefreshCw} onClick={me.reload} disabled={me.loading}>
              {me.loading ? "Actualisation…" : "Actualiser"}
            </Button>
          </div>
        )}
        <p className="sui-head__sub" style={{ marginTop: 10 }} aria-live="polite">
          {asOf ? `Données mises à jour le ${formatDate(asOf)}.` : "Chargement des données réelles…"}
        </p>
      </section>

      <section className="sui-section" aria-labelledby="sui-queue-title">
        <SectionHead
          icon={ListChecks}
          title="File de validation"
          count={queue.length}
        >
          <div className="sui-card__actions">
            <StatusPill tone="green" icon={BadgeCheck} label={`${organisation?.tasks?.open ?? 0} tâches ouvertes`} />
            <Link className="sui-pill" href="/espace-equipe/commandes">
              Toutes les commandes
            </Link>
          </div>
        </SectionHead>

        {queue.length === 0 ? (
          <p className="sui-card__desc">
            {organisation ? "Rien à valider sur cette période." : "Chargement de la file de validation…"}
          </p>
        ) : (
          <ItemGrid label="File de validation">
            {queue.map((item) => (
              <ItemCard
                key={item.id}
                cornerIcon={item.cornerIcon}
                cornerTone={item.tone}
                title={item.title}
                description={item.description}
                meta={item.meta}
                status={item.status}
                statusTone={item.statusTone}
                actions={[
                  ...item.actions.map((action) => ({ ...action, variant: "ghost" })),
                  { icon: ArrowUpRight, label: item.mainAction.label, href: item.mainAction.href, variant: "dark" },
                ]}
              />
            ))}
          </ItemGrid>
        )}
      </section>

      <section className="sui-section">
        <div className="sui-split">
          <Panel
            title={
              <>
                <Sparkles size={18} strokeWidth={1.75} aria-hidden="true" />
                Activité récente
              </>
            }
          >
            <ActivityList items={activity} empty="Aucune activité récente pour votre compte." />
          </Panel>

          <Panel
            title={
              <>
                <TriangleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
                Santé de l’espace
              </>
            }
          >
            {canSeeAgency && health.length ? (
              <HealthList items={health} />
            ) : (
              <p className="sui-card__desc">
                {canSeeAgency ? "Aucun projet suivi sur cette période." : "Cette vue est réservée aux profils qui pilotent l’agence."}
              </p>
            )}
            {canSeeAgency ? (
              <Button variant="ghost" href="/espace-equipe/analytique" style={{ marginTop: 14, width: "100%" }}>
                Ouvrir l’analytique
              </Button>
            ) : null}
          </Panel>
        </div>
      </section>

      <section className="sui-section">
        <details className="sui-panel">
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            Explorer les données détaillées (tableaux d’origine)
          </summary>
          <div className="mt-6 flex flex-col gap-8">
            <div>
              <SectionHead icon={ListChecks} title="Ma journée" />
              {me.error ? <Alert icon={CircleAlert}>{me.error}</Alert> : null}
              {me.loading && !me.data ? <p className="sui-card__desc">Chargement…</p> : null}
              {me.data ? <MyDayView data={me.data} /> : null}
            </div>
            {canSeeAgency ? (
              <div>
                <SectionHead icon={TriangleAlert} title="Vue de l’agence" />
                {agency.loading && !agency.data ? <p className="sui-card__desc">Chargement…</p> : null}
                {agency.data ? <AgencyView data={agency.data} /> : null}
              </div>
            ) : null}
          </div>
        </details>
      </section>
    </div>
  );
}

function formatMinutes(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value)) return "—";
  if (value >= 60) return `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, "0")}`;
  return `${value} min`;
}
