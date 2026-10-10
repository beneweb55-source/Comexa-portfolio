"use client";

import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate, formatMoney } from "@/lib/api";
import { TASK_STATUS } from "@/lib/labels";
import { formatElapsed, useTimer } from "@/lib/timer";
import GlassCard, { GlowIcon } from "@/components/dashboard/GlassCard";
import Icon from "@/components/dashboard/icons";

/*
 * Tuiles du tableau de bord. Chaque tuile reçoit SON état (chargement, erreur, données) :
 * une erreur sur un appel ne masque jamais les autres tuiles.
 */

export const HEALTH_LABEL = { ON_TRACK: "Dans les temps", AT_RISK: "À risque", DELAYED: "En retard", ON_HOLD: "En pause" };
const HEALTH_COLOR = { ON_TRACK: "#6ee7b7", AT_RISK: "#fcd34d", DELAYED: "#fb7185", ON_HOLD: "#94a3b8" };
const SERIES_COLOR = ["#4fb0f0", "#1e86e0", "#6ee7b7", "#fcd34d", "#fb7185", "#93c7f5", "#a78bfa"];

/** Squelette pendant le premier chargement. */
export function TileSkeleton({ className = "" }) {
  return (
    <GlassCard className={`flex min-h-[150px] flex-col gap-3 p-6 ${className}`}>
      <div className="h-3 w-1/3 animate-pulse rounded-full bg-white/10" />
      <div className="h-7 w-2/3 animate-pulse rounded-full bg-white/10" />
      <div className="h-3 w-1/2 animate-pulse rounded-full bg-white/10" />
    </GlassCard>
  );
}

/** Erreur à l'intérieur d'une tuile, avec relance. */
export function TileError({ message, onRetry, className = "" }) {
  return (
    <GlassCard className={`flex min-h-[150px] flex-col justify-between gap-3 p-6 ${className}`}>
      <p role="alert" className="text-[13.5px] text-rose-200">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="self-start rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[12.5px] text-white/85 transition hover:bg-white/10">
          Réessayer
        </button>
      ) : null}
    </GlassCard>
  );
}

/** Indicateur chiffré : icône lumineuse, valeur, sous-texte, barre optionnelle. */
export function KpiTile({ label, value, sub, icon, tone = "sky", bar, className = "" }) {
  return (
    <GlassCard className={`flex min-h-[150px] flex-col justify-between p-5 md:p-6 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-white/55">{label}</p>
        <GlowIcon tone={tone} className="h-9 w-9 rounded-xl [&>svg]:h-4 [&>svg]:w-4"><Icon name={icon} /></GlowIcon>
      </div>
      <div>
        <p className="bg-gradient-to-b from-white to-white/65 bg-clip-text text-[clamp(22px,2.2vw,30px)] font-semibold leading-tight tracking-tight text-transparent tabular-nums">{value}</p>
        {sub ? <p className="mt-1 text-[12px] text-white/50">{sub}</p> : null}
        {bar !== undefined ? (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bar}>
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-sky-300 transition-[width] duration-700" style={{ width: `${bar}%` }} />
          </div>
        ) : null}
      </div>
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
          <h3 className="text-[16px] font-semibold">{title}</h3>
          <p className="text-[12.5px] text-white/55">{subtitle ?? `${total} au total`}</p>
        </div>
      </div>
      {data.length === 0 ? (
        <p className="text-[13.5px] text-white/55">Aucune donnée pour le moment.</p>
      ) : (
        <div className="h-[220px] w-full" role="img" aria-label={`${title} : ${data.map((row) => `${row.name} ${row.count}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fill: "rgba(255,255,255,0.75)", fontSize: 12.5 }} axisLine={false} tickLine={false} />
              <Tooltip content={<GlassTooltip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
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
          <h3 className="text-[16px] font-semibold">Santé des projets</h3>
          <p className="text-[12.5px] text-white/55">{total} projet(s) suivis</p>
        </div>
      </div>
      {rows.length === 0 ? <p className="text-[13.5px] text-white/55">Aucun projet pour le moment.</p> : null}
      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const color = HEALTH_COLOR[row.status] ?? "#4fb0f0";
          const pct = total ? Math.round((row.count / total) * 100) : 0;
          return (
            <li key={row.status}>
              <div className="mb-1.5 flex justify-between text-[13px]">
                <span className="text-white/85">{HEALTH_LABEL[row.status] ?? row.status}</span>
                <span className="tabular-nums text-white">{row.count}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 12px ${color}66` }} />
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
    { label: "Encours", amount: open, tone: "text-sky-200" },
    { label: "En retard", amount: overdue, tone: "text-rose-200" },
    { label: "Encaissé", amount: collected, tone: "text-emerald-200" },
  ];
  return (
    <GlassCard className={`flex flex-col gap-4 p-6 md:p-7 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <GlowIcon tone="amber"><Icon name="money" /></GlowIcon>
          <h3 className="text-[16px] font-semibold">Facturation</h3>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[12px] tabular-nums text-white/70">{rate} % encaissé</span>
      </div>
      <dl className="flex flex-col divide-y divide-white/10">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 py-3">
            <dt className="text-[13.5px] text-white/60">{row.label}</dt>
            <dd className={`text-[15px] font-semibold tabular-nums ${row.tone}`}>
              {row.amount?.total != null ? formatMoney(row.amount.total, row.amount.currency) : "—"}
              <span className="ml-2 text-[12px] font-normal text-white/45">{row.amount?.count ?? 0}</span>
            </dd>
          </div>
        ))}
      </dl>
    </GlassCard>
  );
}

/** Échéances : tâches (et factures, pour l'agence) à venir. */
export function DueTile({ tasks = [], invoices = null, className = "" }) {
  // Instant figé au montage : évite un appel impur pendant le rendu.
  const [now] = useState(() => Date.now());
  const empty = tasks.length === 0 && !(invoices && invoices.length);
  return (
    <GlassCard className={`flex flex-col gap-4 p-6 md:p-7 ${className}`}>
      <div className="flex items-center gap-4">
        <GlowIcon tone="accent"><Icon name="calendar" /></GlowIcon>
        <div>
          <h3 className="text-[16px] font-semibold">Échéances à venir</h3>
          <p className="text-[12.5px] text-white/55">Tâches{invoices ? " et factures" : ""} avec une date limite</p>
        </div>
      </div>
      {empty ? <p className="text-[13.5px] text-white/55">Rien à échéance pour le moment.</p> : null}
      <ul className="flex flex-col gap-2">
        {tasks.slice(0, 6).map((task) => {
          const late = task.dueDate && new Date(task.dueDate).getTime() < now && task.status !== "DONE";
          return (
            <li key={task.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-[14px] text-white/90">{task.title}</p>
                <p className="truncate text-[12px] text-white/50">{task.projectName ?? "Sans projet"}{task.assigneeName ? ` · ${task.assigneeName}` : ""}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`text-[12.5px] tabular-nums ${late ? "text-rose-300" : "text-white/75"}`}>{formatDate(task.dueDate)}</p>
                <p className="text-[11.5px] text-white/45">{TASK_STATUS[task.status] ?? task.status}</p>
              </div>
            </li>
          );
        })}
        {(invoices ?? []).slice(0, 3).map((invoice) => (
          <li key={invoice.reference} className="flex items-center justify-between gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/[0.04] px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-[14px] text-white/90">Facture {invoice.reference}</p>
              <p className="truncate text-[12px] text-white/50">{invoice.clientName ?? "Client"}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[12.5px] tabular-nums text-amber-200">{formatMoney(invoice.outstanding, invoice.currency)}</p>
              <p className="text-[11.5px] text-white/45">{formatDate(invoice.dueDate)}</p>
            </div>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

/**
 * Minuteur : état réel du contexte (persisté dans le navigateur, enregistré côté API à l'arrêt).
 * La permission est vérifiée par l'appelant : cette tuile n'est rendue que si l'utilisateur peut s'en servir.
 */
export function TimerTile({ tasks, className = "" }) {
  const { timer, elapsedSeconds, start, stop, saving, error } = useTimer();
  const list = (tasks.items ?? []).filter((t) => t.status !== "DONE" && t.status !== "CANCELLED");

  return (
    <GlassCard className={`flex flex-col gap-4 p-6 md:p-7 ${className}`}>
      <div className="flex items-center gap-4">
        <GlowIcon tone={timer ? "mint" : "sky"}><Icon name={timer ? "clock" : "bolt"} /></GlowIcon>
        <div>
          <h3 className="text-[16px] font-semibold">Minuteur</h3>
          <p className="text-[12.5px] text-white/55">{timer ? "Enregistrement en cours" : "Aucun minuteur actif"}</p>
        </div>
      </div>

      {timer ? (
        <>
          <p className="font-mono text-[34px] font-semibold tabular-nums tracking-tight">{formatElapsed(elapsedSeconds)}</p>
          <p className="truncate text-[13.5px] text-white/65" title={timer.title}>{timer.title}</p>
          <button type="button" onClick={() => stop()} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-500/90 px-4 py-2.5 text-[14px] font-medium text-white shadow-[0_0_24px_rgba(244,63,94,0.35)] transition hover:bg-rose-500 disabled:opacity-60">
            <Icon name="stop" className="h-4 w-4" />
            {saving ? "Enregistrement…" : "Arrêter et enregistrer"}
          </button>
        </>
      ) : (
        <>
          {tasks.error ? <p role="alert" className="text-[12.5px] text-rose-300">{tasks.error}</p> : null}
          {tasks.items === null && !tasks.error ? <p className="text-[13px] text-white/55">Chargement des tâches…</p> : null}
          {tasks.items !== null && list.length === 0 && !tasks.error ? <p className="text-[13px] text-white/55">Aucune tâche ouverte assignée.</p> : null}
          {list.length > 0 ? <p className="text-[12.5px] text-white/50">Touchez une tâche pour la chronométrer.</p> : null}
          <ul className="flex max-h-44 flex-col gap-2 overflow-y-auto pr-1">
            {list.slice(0, 8).map((task) => (
              <li key={task.id}>
                <button type="button" onClick={() => start(task)} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-left text-[13.5px] text-white/90 transition hover:border-sky-300/40 hover:bg-white/[0.09]">
                  <span className="truncate">{task.title}</span>
                  <Icon name="play" className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {error ? <p role="alert" className="text-[12.5px] text-rose-300">{error}</p> : null}
      <Link href="/espace-equipe/taches" className="self-start text-[12.5px] text-sky-300 hover:underline">Voir toutes les tâches →</Link>
    </GlassCard>
  );
}
