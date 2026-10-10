"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import GlassCard, { GlowIcon } from "@/components/dashboard/GlassCard";
import MeshBackground from "@/components/dashboard/MeshBackground";
import Icon from "@/components/dashboard/icons";
import { Notice } from "@/components/workspace/ui";

const STATUS_LABEL = { TODO: "À faire", IN_PROGRESS: "En cours", BLOCKED: "Bloquées", IN_REVIEW: "En revue", DONE: "Terminées", CANCELLED: "Annulées" };
const STATUS_COLOR = { TODO: "#93c7f5", IN_PROGRESS: "#1e86e0", BLOCKED: "#f87171", IN_REVIEW: "#fbbf24", DONE: "#34d399", CANCELLED: "#8098b2" };

const EMPTY = [];
const isoDay = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/**
 * Analytique de l'équipe : données réelles (saisies de temps sur 30 jours, tâches par statut,
 * avancement des projets). Requiert `report:read:any`, filtré dans le menu et côté API.
 */
export default function AnalytiquePage() {
  const { request } = useAuth();
  const to = useMemo(() => isoDay(new Date()), []);
  const from = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return isoDay(d);
  }, []);
  const [entries, setEntries] = useState({ items: null, error: null });
  const projects = useListing("/projects?perPage=100");
  const users = useListing("/users?perPage=100");
  const [tasks, setTasks] = useState({ items: null, error: null });

  // Saisies de temps : lecture page par page (100 max par page, 10 pages au plus = 1 000 lignes).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = [];
      try {
        for (let page = 1; page <= 10; page += 1) {
          const res = await request(`/time-entries?perPage=100&page=${page}&from=${from}&to=${to}`);
          const rows = res.data ?? [];
          all.push(...rows);
          if (rows.length < 100) break;
        }
        if (!cancelled) setEntries({ items: all, error: null });
      } catch (caught) {
        if (!cancelled) setEntries({ items: all, error: messageOf(caught) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, request]);

  // Tâches par statut : une lecture par projet (plafonnée), agrégée ici.
  const projectIds = (projects.items ?? []).slice(0, 15).map((p) => p.id).join(",");
  useEffect(() => {
    let cancelled = false;
    if (!projectIds) return undefined;
    Promise.all(projectIds.split(",").map((id) => request(`/projects/${id}/tasks?perPage=100`).then((r) => r.data ?? [])))
      .then((lists) => !cancelled && setTasks({ items: lists.flat(), error: null }))
      .catch((caught) => !cancelled && setTasks({ items: [], error: messageOf(caught) }));
    return () => {
      cancelled = true;
    };
  }, [projectIds, request]);

  const taskItems = projectIds ? (tasks.items ?? EMPTY) : EMPTY;
  const data = useMemo(() => buildAnalytics(entries.items ?? EMPTY, projects.items ?? EMPTY, taskItems, users.items ?? EMPTY, from, to), [entries.items, projects.items, taskItems, users.items, from, to]);
  // Les noms des membres (réservés aux administrateurs) ne sont pas bloquants : à défaut, « Membre ».
  const errors = [entries.error, projects.error, tasks.error].filter(Boolean);

  return (
    <div className="relative isolate overflow-hidden rounded-[36px] bg-[#071a33] p-5 text-white md:p-8">
      <MeshBackground />
      <header className="mb-7">
        <p className="text-[12.5px] font-medium uppercase tracking-[0.18em] text-sky-300/80">30 derniers jours</p>
        <h2 className="mt-2 bg-gradient-to-b from-white to-white/70 bg-clip-text text-[30px] font-semibold tracking-tight text-transparent">Analytique de l’équipe</h2>
      </header>

      {errors.length ? <div className="mb-5"><Notice>{errors[0]}</Notice></div> : null}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Temps cette semaine" value={`${data.weekHours.toFixed(1)} h`} sub={`${data.totalHours.toFixed(1)} h sur 30 jours`} icon="clock" tone="sky" />
        <Kpi label="Tâches complétées" value={`${data.completionRate}%`} sub={`${data.doneCount} terminées · ${data.lateCount} en retard`} icon="check" tone="mint" />
        <Kpi label="Projets actifs" value={String(data.activeProjects)} icon="folder" tone="accent" />
        <Kpi label="Avancement moyen" value={`${data.avgProgress}%`} icon="chart" tone="amber" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-12">
        <GlassCard className="flex flex-col p-6 xl:col-span-8">
          <h3 className="!text-[16px] !font-bold !text-white">Temps travaillé par jour</h3>
          <p className="text-[13px] text-white/55">Somme des saisies de l’équipe</p>
          <div className="mt-4 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.daily} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gHours" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4fb0f0" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#1e86e0" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} axisLine={false} tickLine={false} interval={4} />
                <YAxis hide />
                <Tooltip content={<DarkTooltip unit="h" />} />
                <Area type="monotone" dataKey="heures" name="Heures" stroke="#4fb0f0" strokeWidth={2.5} fill="url(#gHours)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col p-6 xl:col-span-12">
          <h3 className="!text-[16px] !font-bold !text-white">Tâches : complétées contre en retard</h3>
          <p className="text-[13px] text-white/55">Hors tâches annulées, tous projets confondus</p>
          <div className="mt-5 flex h-4 overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${data.doneCount} terminées, ${data.openCount} en cours, ${data.lateCount} en retard`}>
            {data.total ? (
              <>
                <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-300 transition-[width] duration-700" style={{ width: `${(data.doneCount / data.total) * 100}%` }} />
                <div className="h-full bg-gradient-to-r from-sky-400 to-blue-500 transition-[width] duration-700" style={{ width: `${(data.openCount / data.total) * 100}%` }} />
                <div className="h-full bg-gradient-to-r from-red-400 to-rose-500 transition-[width] duration-700" style={{ width: `${(data.lateCount / data.total) * 100}%` }} />
              </>
            ) : null}
          </div>
          <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-white/75">
            <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden="true" />Terminées · <span className="font-semibold text-white">{data.doneCount}</span></li>
            <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-sky-400" aria-hidden="true" />En cours · <span className="font-semibold text-white">{data.openCount}</span></li>
            <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-red-400" aria-hidden="true" />En retard · <span className="font-semibold text-white">{data.lateCount}</span></li>
          </ul>
        </GlassCard>

        <GlassCard className="flex flex-col p-6 xl:col-span-4">
          <h3 className="!text-[16px] !font-bold !text-white">Répartition des tâches</h3>
          <p className="text-[13px] text-white/55">Par statut, tous projets confondus</p>
          <div className="mt-4 h-[200px]">
            {data.statusSlices.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.statusSlices} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3} stroke="none" isAnimationActive={false}>
                    {data.statusSlices.map((slice) => <Cell key={slice.key} fill={STATUS_COLOR[slice.key]} />)}
                  </Pie>
                  <Tooltip content={<DarkTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="pt-16 text-center text-[13px] text-white/50">Aucune tâche.</p>}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-1.5 text-[12.5px] text-white/70">
            {data.statusSlices.map((slice) => (
              <li key={slice.key} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[slice.key] }} />
                {slice.name} · {slice.value}
              </li>
            ))}
          </ul>
        </GlassCard>

        <GlassCard className="flex flex-col p-6 xl:col-span-6">
          <div className="flex items-center gap-3">
            <GlowIcon tone="accent"><Icon name="users" /></GlowIcon>
            <div>
              <h3 className="!text-[16px] !font-bold !text-white">Heures par membre</h3>
              <p className="text-[13px] text-white/55">Sur la période</p>
            </div>
          </div>
          <div className="mt-4 h-[260px]">
            {data.byMember.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byMember} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fill: "rgba(255,255,255,0.8)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<DarkTooltip unit="h" />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="heures" name="Heures" fill="url(#barGrad)" radius={[0, 10, 10, 0]} isAnimationActive={false} />
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#1e86e0" />
                      <stop offset="100%" stopColor="#4fb0f0" />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="pt-16 text-center text-[13px] text-white/50">Aucune saisie sur la période.</p>}
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col p-6 xl:col-span-6">
          <h3 className="!text-[16px] !font-bold !text-white">Avancement des projets</h3>
          <p className="text-[13px] text-white/55">Progression déclarée</p>
          <ul className="mt-5 flex flex-col gap-4">
            {data.projects.length ? data.projects.map((p) => (
              <li key={p.id}>
                <div className="mb-1.5 flex justify-between text-[13.5px]">
                  <span className="truncate text-white/90">{p.name}</span>
                  <span className="font-semibold tabular-nums">{p.progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={p.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.progress}>
                  <div className="h-full rounded-full bg-gradient-to-r from-sky-300 to-blue-500" style={{ width: `${p.progress}%` }} />
                </div>
              </li>
            )) : <p className="text-center text-[13px] text-white/50">Aucun projet.</p>}
          </ul>
        </GlassCard>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, icon, tone }) {
  return (
    <GlassCard className="flex items-center gap-4 p-5">
      <GlowIcon tone={tone}><Icon name={icon} /></GlowIcon>
      <div>
        <p className="text-[12.5px] text-white/55">{label}</p>
        <p className="text-[24px] font-semibold tracking-tight">{value}</p>
        {sub ? <p className="mt-0.5 text-[12px] text-white/50">{sub}</p> : null}
      </div>
    </GlassCard>
  );
}

function DarkTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const value = typeof item.value === "number" ? (unit ? `${item.value.toFixed(1)} ${unit}` : item.value) : item.value;
  return (
    <div className="rounded-2xl border border-white/15 bg-[#0b2545]/85 px-3.5 py-2.5 text-[13px] shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-2xl">
      {label ? <p className="font-medium text-white">{label}</p> : null}
      <p className="text-white/80">{item.name ?? item.payload?.name}: <span className="font-semibold text-white">{value}</span></p>
    </div>
  );
}

/** Agrégations pures (testables) : aucune donnée inventée. */
export function buildAnalytics(entries, projects, tasks, users, from, to) {
  const dayKeys = [];
  for (let d = new Date(`${from}T12:00:00`); isoDay(d) <= to; d.setDate(d.getDate() + 1)) dayKeys.push(isoDay(d));
  const perDay = Object.fromEntries(dayKeys.map((k) => [k, 0]));
  const perUser = {};
  let totalMinutes = 0;
  for (const entry of entries) {
    const minutes = Number(entry.minutes) || 0;
    totalMinutes += minutes;
    const key = String(entry.spentOn ?? "").slice(0, 10);
    if (key in perDay) perDay[key] += minutes;
    perUser[entry.userId] = (perUser[entry.userId] ?? 0) + minutes;
  }
  const names = Object.fromEntries(users.map((u) => [u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email]));
  const byMember = Object.entries(perUser)
    .map(([id, minutes]) => ({ name: names[id] ?? "Membre", heures: Math.round((minutes / 60) * 10) / 10 }))
    .sort((a, b) => b.heures - a.heures)
    .slice(0, 8);

  const statusCount = {};
  for (const task of tasks) statusCount[task.status] = (statusCount[task.status] ?? 0) + 1;
  const statusSlices = Object.entries(statusCount)
    .filter(([key]) => key !== "CANCELLED")
    .map(([key, value]) => ({ key, name: STATUS_LABEL[key] ?? key, value }));

  const activeProjects = projects.filter((p) => !["COMPLETED", "CANCELLED", "ARCHIVED"].includes(p.status)).length;
  const avgProgress = projects.length ? Math.round(projects.reduce((s, p) => s + (p.progressPercent ?? 0), 0) / projects.length) : 0;

  // Semaine = les 7 derniers jours de la période (aujourd'hui inclus).
  const weekKeys = dayKeys.slice(-7);
  const weekMinutes = weekKeys.reduce((sum, k) => sum + perDay[k], 0);

  // Tâches : hors annulées. En retard = échéance passée et non terminée.
  const counted = tasks.filter((t) => t.status !== "CANCELLED");
  const doneCount = counted.filter((t) => t.status === "DONE").length;
  const lateCount = counted.filter((t) => t.status !== "DONE" && t.dueDate && String(t.dueDate).slice(0, 10) < to).length;
  const total = counted.length;
  const openCount = total - doneCount - lateCount;

  return {
    totalHours: totalMinutes / 60,
    weekHours: weekMinutes / 60,
    doneCount,
    lateCount,
    openCount,
    total,
    completionRate: total ? Math.round((doneCount / total) * 100) : 0,
    daily: dayKeys.map((k) => ({ day: new Date(`${k}T12:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }), heures: Math.round((perDay[k] / 60) * 10) / 10 })),
    byMember,
    tasksByStatus: statusCount,
    statusSlices,
    activeProjects,
    avgProgress,
    projects: projects.slice(0, 8).map((p) => ({ id: p.id, name: p.name, progress: p.progressPercent ?? 0 })),
  };
}
