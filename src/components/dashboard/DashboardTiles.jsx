"use client";

import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate, formatMoney } from "@/lib/api";
import { TASK_STATUS } from "@/lib/labels";
import { formatElapsed, useTimer } from "@/lib/timer";
import GlassCard, { GlowIcon } from "@/components/dashboard/GlassCard";
import Icon from "@/components/dashboard/icons";
import { Pagination } from "@/components/workspace/ui";

/*
 * Tuiles du tableau de bord. Chaque tuile reçoit SON état (chargement, erreur, données) :
 * une erreur sur un appel ne masque jamais les autres tuiles.
 */

export const HEALTH_LABEL = { ON_TRACK: "Dans les temps", AT_RISK: "À risque", DELAYED: "En retard", ON_HOLD: "En pause" };
const HEALTH_COLOR = { ON_TRACK: "#159a69", AT_RISK: "#bd7a05", DELAYED: "#cf4652", ON_HOLD: "#64748b" };
const SERIES_COLOR = ["#1e86e0", "#0f4e8a", "#0e7a4a", "#a85b0a", "#c0271f", "#4fb0f0", "#7864b8"];

/** Squelette pendant le premier chargement. */
export function TileSkeleton({ className = "" }) {
  return (
    <GlassCard className={`cx-dashboard__tile-skeleton flex min-h-[146px] flex-col gap-3 p-5 ${className}`} aria-hidden="true">
      <div className="h-3 w-1/3 animate-pulse rounded-full bg-slate-100" />
      <div className="h-7 w-2/3 animate-pulse rounded-full bg-slate-100" />
      <div className="h-3 w-1/2 animate-pulse rounded-full bg-slate-100" />
    </GlassCard>
  );
}

/** Erreur à l'intérieur d'une tuile, avec relance. */
export function TileError({ message, onRetry, className = "" }) {
  return (
    <GlassCard className={`flex min-h-[146px] flex-col justify-between gap-3 p-5 ${className}`}>
      <p role="alert" className="text-[13.5px] text-[var(--comexa-error)]">{message}</p>
      {onRetry ? <button type="button" onClick={onRetry} className="cx-dashboard__retry">Réessayer</button> : null}
    </GlassCard>
  );
}

/** Indicateur chiffré : icône lumineuse, valeur, sous-texte, barre optionnelle. */
export function KpiTile({ href, label, value, sub, icon, tone = "sky", bar, className = "" }) {
  return (
    <GlassCard as={href ? Link : "section"} href={href} className={`cx-dashboard__kpi ${href ? "cx-dashboard__kpi--link" : ""} ${className}`}>
      <div className="cx-dashboard__kpi-top">
        <p className="cx-dashboard__muted">{label}</p>
        <GlowIcon tone={tone} className="h-10 w-10 rounded-xl [&>svg]:h-[18px] [&>svg]:w-[18px]"><Icon name={icon} /></GlowIcon>
      </div>
      <div className="cx-dashboard__kpi-body">
        <p className="cx-dashboard__kpi-value">{value}</p>
        {sub ? <p className="cx-dashboard__muted cx-dashboard__kpi-sub">{sub}</p> : null}
        {bar !== undefined ? (
          <div className="cx-dashboard__progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bar}>
            <div className="cx-dashboard__progress-bar" style={{ width: `${bar}%` }} />
          </div>
        ) : null}
      </div>
      {href ? <span className="cx-dashboard__kpi-link-hint">Voir le détail <span aria-hidden="true">↗</span></span> : null}
    </GlassCard>
  );
}

function GlassTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-white/15 bg-[#0b2545]/85 px-4 py-2.5 text-[13px] shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-2xl">
      <p className="text-white">{label}</p>
      <p className="text-white/70">Nombre : <span className="font-semibold text-white">{payload[0].value}</span></p>
    </div>
  );
}

/** Répartition par statut, en barres horizontales. `rows` = [{ status, count }]. */
export function DistributionTile({ title, subtitle, rows = [], labels, icon = "chart", className = "" }) {
  const data = rows.map((row, index) => ({
    name: labels[row.status] ?? row.status,
    count: row.count,
    fill: SERIES_COLOR[index % SERIES_COLOR.length],
  }));
  const total = data.reduce((sum, row) => sum + row.count, 0);
  return (
    <GlassCard className={`flex flex-col gap-5 p-6 md:p-7 ${className}`}>
      <div className="flex items-center gap-4">
        <GlowIcon tone="sky"><Icon name={icon} /></GlowIcon>
        <div>
          <h3 className="!text-[16px] !font-bold !text-[#152f4d]">{title}</h3>
          <p className="cx-dashboard__muted">{subtitle ?? `${total} au total`}</p>
        </div>
      </div>
      {data.length === 0 ? (
        <p className="cx-dashboard__muted">Aucune donnée pour le moment.</p>
      ) : (
        <div className="h-[220px] w-full" role="img" aria-label={`${title} : ${data.map((row) => `${row.name} ${row.count}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(27,58,95,0.09)" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: "#8292a5", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fill: "#526980", fontSize: 12.5 }} axisLine={false} tickLine={false} />
              <Tooltip content={<GlassTooltip />} cursor={{ fill: "rgba(30,134,224,0.06)" }} />
              <Bar dataKey="count" radius={[0, 10, 10, 0]} barSize={16}>
                {data.map((row) => <Cell key={row.name} fill={row.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </GlassCard>
  );
}

/** Santé des projets (agence) : une barre par niveau, valeurs réelles. */
export function HealthTile({ rows = [], className = "" }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <GlassCard className={`flex flex-col gap-4 p-6 md:p-7 ${className}`}>
      <div className="flex items-center gap-4">
        <GlowIcon tone="mint"><Icon name="folder" /></GlowIcon>
        <div>
          <h3 className="!text-[16px] !font-bold !text-[#152f4d]">Santé des projets</h3>
          <p className="cx-dashboard__muted">{total} projet(s) suivis</p>
        </div>
      </div>
      {rows.length === 0 ? <p className="cx-dashboard__muted">Aucun projet pour le moment.</p> : null}
      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const color = HEALTH_COLOR[row.status] ?? "#4fb0f0";
          const pct = total ? Math.round((row.count / total) * 100) : 0;
          return (
            <li key={row.status}>
              <div className="cx-dashboard__health-label-row">
                <span className="text-[#526980]">{HEALTH_LABEL[row.status] ?? row.status}</span>
                <span className="tabular-nums font-semibold text-[#213d5d]">{row.count} <span className="font-normal text-[#71849a]">· {pct} %</span></span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={`${HEALTH_LABEL[row.status] ?? row.status} : ${row.count} projet(s)`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={row.count} aria-valuetext={`${row.count} projet(s), ${pct} %`}>
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
              </div>
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}

/** Montants (agence) : encours, en retard, encaissé. Les montants sont par devise, jamais additionnés. */
export function FinanceTile({ open, overdue, collected, rate, className = "" }) {
  const rows = [
    { label: "Encours", amount: open, tone: "text-[#0f5f9f]" },
    { label: "En retard", amount: overdue, tone: "text-[#b7312a]" },
    { label: "Encaissé", amount: collected, tone: "text-[#14784e]" },
  ];
  return (
    <GlassCard className={`flex flex-col gap-4 p-6 md:p-7 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <GlowIcon tone="amber"><Icon name="money" /></GlowIcon>
          <h3 className="!text-[16px] !font-bold !text-[#152f4d]">Facturation</h3>
        </div>
        <span className="cx-dashboard__rate">{rate} % encaissé</span>
      </div>
      <dl className="flex flex-col divide-y divide-slate-100">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 py-3">
            <dt className="text-[13.5px] text-[#667b92]">{row.label}</dt>
            <dd className={`text-[14px] font-semibold tabular-nums ${row.tone}`}>
              {row.amount?.total != null ? formatMoney(row.amount.total, row.amount.currency) : "—"}
              <span className="ml-2 text-[11px] font-normal text-[#8b9aab]">{row.amount?.count ?? 0}</span>
            </dd>
          </div>
        ))}
      </dl>
    </GlassCard>
  );
}

/** Échéances : tâches (et factures, pour l'agence) à venir. */
export function DueTile({ tasks = [], invoices = null, taskHref, invoiceHref, tasksHref, tasksLinkLabel = "Toutes les tâches", invoicesHref, className = "" }) {
  const [now] = useState(() => Date.now());
  const invoiceRows = invoices ?? [];
  const empty = tasks.length === 0 && invoiceRows.length === 0;
  const summary = [
    tasks.length ? `${tasks.length} tâche${tasks.length > 1 ? "s" : ""}` : null,
    invoiceRows.length ? `${invoiceRows.length} facture${invoiceRows.length > 1 ? "s" : ""}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <GlassCard className={`cx-dashboard__due flex flex-col gap-4 p-5 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <GlowIcon tone="accent"><Icon name="calendar" /></GlowIcon>
          <div className="min-w-0">
            <h3 className="!text-[16px] !font-bold !text-[#152f4d]">Échéances à venir</h3>
            <p className="cx-dashboard__muted">{summary || `Tâches${invoices ? " et factures" : ""} avec une date limite`}</p>
          </div>
        </div>
        {!empty ? <span className="cx-dashboard__due-count" aria-label={`${tasks.length + invoiceRows.length} échéances`}>{tasks.length + invoiceRows.length}</span> : null}
      </div>

      {empty ? (
        <div className="cx-dashboard__due-empty">
          <span className="cx-dashboard__due-empty-icon"><Icon name="check" /></span>
          <p>Aucune échéance à venir dans votre périmètre.</p>
        </div>
      ) : null}

      <ul className="cx-dashboard__due-list">
        {tasks.slice(0, 6).map((task) => {
          const open = task.status !== "DONE" && task.status !== "CANCELLED";
          const late = task.dueDate && new Date(task.dueDate).getTime() < now && open;
          const href = typeof taskHref === "function" ? taskHref(task) : null;
          const content = (
            <>
              <div className="min-w-0">
                <p className="cx-dashboard__due-title">{task.title}</p>
                <p className="cx-dashboard__muted cx-dashboard__due-meta">{task.projectName ?? "Sans projet"}{task.assigneeName ? ` · ${task.assigneeName}` : ""}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`cx-dashboard__due-date${late ? " is-late" : ""}`}>{formatDate(task.dueDate)}</p>
                <p className="cx-dashboard__muted cx-dashboard__due-status">{TASK_STATUS[task.status] ?? task.status}</p>
              </div>
            </>
          );
          return (
            <li key={task.id}>
              {href ? <Link href={href} className="cx-dashboard__due-row" aria-label={`${task.title}, échéance ${formatDate(task.dueDate)}`}>{content}</Link> : <div className="cx-dashboard__due-row">{content}</div>}
            </li>
          );
        })}
        {invoiceRows.slice(0, 3).map((invoice) => {
          const content = (
            <>
              <div className="min-w-0">
                <p className="cx-dashboard__due-title">Facture {invoice.reference}</p>
                <p className="cx-dashboard__muted cx-dashboard__due-meta">{invoice.clientName ?? "Client"}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="cx-dashboard__due-date is-attention">{formatMoney(invoice.outstanding, invoice.currency)}</p>
                <p className="cx-dashboard__muted cx-dashboard__due-status">{formatDate(invoice.dueDate)}</p>
              </div>
            </>
          );
          const href = typeof invoiceHref === "function" ? invoiceHref(invoice) : null;
          return (
            <li key={invoice.id}>
              {href ? <Link href={href} className="cx-dashboard__due-row cx-dashboard__due-row--invoice" aria-label={`Facture ${invoice.reference}, échéance ${formatDate(invoice.dueDate)}`}>{content}</Link> : <div className="cx-dashboard__due-row cx-dashboard__due-row--invoice">{content}</div>}
            </li>
          );
        })}
      </ul>

      {(tasksHref || invoicesHref) ? (
        <div className="cx-dashboard__due-actions">
          {tasksHref ? <Link href={tasksHref} className="cx-dashboard__text-link">{tasksLinkLabel} <span aria-hidden="true">→</span></Link> : null}
          {invoicesHref ? <Link href={invoicesHref} className="cx-dashboard__text-link">Toutes les factures <span aria-hidden="true">→</span></Link> : null}
        </div>
      ) : null}
    </GlassCard>
  );
}

/**
 * Minuteur : état réel du contexte (persisté dans le navigateur, enregistré côté API à l'arrêt).
 * La permission est vérifiée par l'appelant : cette tuile n'est rendue que si l'utilisateur peut s'en servir.
 */
export function TimerTile({ tasks, onTaskPageChange, className = "" }) {
  const { timer, elapsedSeconds, start, stop, saving, error } = useTimer();
  const list = (tasks.items ?? []).filter((t) => t.status !== "DONE" && t.status !== "CANCELLED");

  return (
    <GlassCard className={`cx-dashboard__timer flex flex-col gap-4 p-5 ${className}`}>
      <div className="flex items-center gap-3">
        <GlowIcon tone={timer ? "mint" : "sky"}><Icon name={timer ? "clock" : "bolt"} /></GlowIcon>
        <div>
          <h3 className="!text-[16px] !font-bold !text-[#152f4d]">Minuteur</h3>
          <p className="cx-dashboard__muted">{timer ? "Enregistrement en cours" : "Aucun minuteur actif"}</p>
        </div>
      </div>

      {timer ? (
        <>
          <p className="cx-dashboard__timer-value">{formatElapsed(elapsedSeconds)}</p>
          <p className="truncate text-[13.5px] text-[#526980]" title={timer.title}>{timer.title}</p>
          <button type="button" onClick={() => stop()} disabled={saving} className="cx-dashboard__timer-stop">
            <Icon name="stop" className="h-4 w-4" />
            {saving ? "Enregistrement…" : "Arrêter et enregistrer"}
          </button>
        </>
      ) : (
        <>
          {tasks.error ? <p role="alert" className="text-[12.5px] text-[var(--comexa-error)]">{tasks.error}</p> : null}
          {tasks.items === null && !tasks.error ? <p className="cx-dashboard__muted">Chargement des tâches…</p> : null}
          {tasks.items !== null && list.length === 0 && !tasks.error ? <p className="cx-dashboard__muted">Aucune tâche ouverte assignée.</p> : null}
          {list.length > 0 ? <p className="cx-dashboard__muted">Sélectionnez une tâche pour démarrer le minuteur.</p> : null}
          <ul className="flex max-h-44 flex-col gap-2 overflow-y-auto pr-1">
            {list.map((task) => (
              <li key={task.id}>
                <button type="button" onClick={() => start(task)} className="cx-dashboard__task-button">
                  <span className="truncate">{task.title}</span>
                  <Icon name="play" className="h-3.5 w-3.5 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
          <Pagination meta={tasks.meta} onPageChange={onTaskPageChange} loading={tasks.loading} label="Pagination des tâches du minuteur" />
        </>
      )}

      {error ? <p role="alert" className="text-[12.5px] text-[var(--comexa-error)]">{error}</p> : null}
      <Link href="/espace-equipe/taches" className="cx-dashboard__text-link self-start">Voir toutes les tâches <span aria-hidden="true">→</span></Link>
    </GlassCard>
  );
}
