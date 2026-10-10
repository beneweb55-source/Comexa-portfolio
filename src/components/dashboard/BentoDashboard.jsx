"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { useListing } from "@/lib/use-listing";
import { useTimer, formatElapsed } from "@/lib/timer";
import { ACTIVITY_DEMO, KPI_DEMO, PROJECTS_DEMO, dailySeries } from "@/lib/dashboard-mock";
import MeshBackground from "@/components/dashboard/MeshBackground";
import GlassCard, { GlowIcon } from "@/components/dashboard/GlassCard";
import Icon from "@/components/dashboard/icons";

/*
 * Tableau de bord « bento » de l'espace équipe.
 *   Ligne 1-2 : analytics (grand) | 4 KPI carrés
 *   Ligne 3   : minuteur | actions rapides | chronologie (verticale, 2 lignes)
 *   Ligne 4   : avancement des projets
 * Les chiffres sont de démonstration (voir lib/dashboard-mock) sauf le minuteur, réel.
 */
export default function BentoDashboard() {
  const { user } = useAuth();
  const name = user?.firstName ?? "";
  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <section aria-label="Tableau de bord" className="relative isolate overflow-hidden rounded-[36px] bg-[#071a33] p-5 text-white md:p-8">
      <MeshBackground />

      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12.5px] font-medium uppercase tracking-[0.18em] text-sky-300/80">{today}</p>
          <h2 className="mt-2 bg-gradient-to-b from-white to-white/70 bg-clip-text text-[30px] font-semibold tracking-tight text-transparent md:text-[36px]">
            Bonjour{name ? `, ${name}` : ""}
          </h2>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[12px] text-white/60 backdrop-blur-xl">
          Données de démonstration
        </span>
      </header>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-12 lg:auto-rows-[minmax(170px,auto)]">
        <AnalyticsWidget className="md:col-span-2 lg:col-span-8 lg:row-span-2" />
        <KpiSquares className="md:col-span-2 lg:col-span-4 lg:row-span-2" />
        <TimerWidget className="md:col-span-1 lg:col-span-4" />
        <QuickActions className="md:col-span-1 lg:col-span-4" />
        <Timeline className="md:col-span-2 lg:col-span-4 lg:row-span-2" />
        <ProjectsWidget className="md:col-span-2 lg:col-span-8" />
      </div>
    </section>
  );
}

/* ---------- Analytics : grand graphique ---------- */

function GlassTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-white/15 bg-[#0b2545]/80 px-4 py-3 text-[13px] shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-2xl">
      <p className="mb-1 font-medium text-white">{label}</p>
      {payload.map((item) => (
        <p key={item.dataKey} className="text-white/70">
          <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: item.color }} />
          {item.name} : <span className="font-semibold text-white">{item.value}</span>
        </p>
      ))}
    </div>
  );
}

function AnalyticsWidget({ className }) {
  const [range, setRange] = useState(14);
  const data = useMemo(() => dailySeries(range), [range]);
  const totalHours = data.reduce((sum, d) => sum + d.heures, 0);
  const totalDone = data.reduce((sum, d) => sum + d.tachesTerminees, 0);

  return (
    <GlassCard className={`flex min-h-[380px] flex-col p-6 md:p-7 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <GlowIcon tone="sky"><Icon name="chart" /></GlowIcon>
          <div>
            <h3 className="text-[17px] font-semibold">Activité de l’équipe</h3>
            <p className="text-[13.5px] text-white/55">{totalHours.toFixed(1)} h travaillées · {totalDone} tâches terminées</p>
          </div>
        </div>
        <div role="group" aria-label="Période" className="flex rounded-full border border-white/10 bg-white/5 p-1 text-[12.5px]">
          {[7, 14, 30].map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={range === days}
              onClick={() => setRange(days)}
              className={`rounded-full px-3 py-1 transition ${range === days ? "bg-white text-[#0b2545]" : "text-white/65 hover:text-white"}`}
            >
              {days} j
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 min-h-[260px] flex-1">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="gradHeures" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4fb0f0" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#1e86e0" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradTaches" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6ee7b7" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#6ee7b7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="day" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip content={<GlassTooltip />} cursor={{ stroke: "rgba(255,255,255,0.2)" }} />
            <Area type="monotone" dataKey="heures" name="Heures" stroke="#4fb0f0" strokeWidth={2.5} fill="url(#gradHeures)" />
            <Area type="monotone" dataKey="tachesTerminees" name="Tâches terminées" stroke="#6ee7b7" strokeWidth={2} fill="url(#gradTaches)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}

/* ---------- KPI : 4 tuiles carrées ---------- */

function KpiSquares({ className }) {
  const { revenue, tasksInProgress, hoursMonth, projectsActive } = KPI_DEMO;
  const hoursPct = Math.min(100, Math.round((hoursMonth.value / hoursMonth.target) * 100));
  const tiles = [
    { label: "Chiffre d’affaires", value: formatMoney(revenue.value, revenue.currency), sub: `+${revenue.delta}% ce mois`, icon: "money", tone: "accent" },
    { label: "Tâches en cours", value: String(tasksInProgress.value), sub: `${tasksInProgress.delta} vs semaine passée`, icon: "kanban", tone: "sky" },
    { label: "Temps travaillé", value: `${hoursMonth.value} h`, sub: `${hoursPct}% de l’objectif`, icon: "clock", tone: "mint", bar: hoursPct },
    { label: "Projets actifs", value: String(projectsActive.value), sub: `+${projectsActive.delta} ce mois`, icon: "folder", tone: "amber" },
  ];
  return (
    <div className={`grid grid-cols-2 gap-4 ${className}`}>
      {tiles.map((tile) => (
        <GlassCard key={tile.label} className="flex aspect-square flex-col justify-between p-5">
          <GlowIcon tone={tile.tone}><Icon name={tile.icon} /></GlowIcon>
          <div>
            <p className="text-[12.5px] text-white/55">{tile.label}</p>
            <p className="mt-1 bg-gradient-to-b from-white to-white/65 bg-clip-text text-[clamp(20px,2.2vw,28px)] font-semibold leading-tight tracking-tight text-transparent">
              {tile.value}
            </p>
            <p className="mt-1 text-[12px] text-white/45">{tile.sub}</p>
            {tile.bar !== undefined ? (
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-sky-300" style={{ width: `${tile.bar}%` }} />
              </div>
            ) : null}
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

/* ---------- Minuteur actif (réel) ---------- */

function TimerWidget({ className }) {
  const { timer, elapsedSeconds, start, stop, saving, error } = useTimer();
  const { user: timerUser } = useAuth();
  const canSeeTasks = can(timerUser, "task:read:any") || can(timerUser, "task:read:assigned") || can(timerUser, "task:read:own");
  const tasks = useListing(canSeeTasks ? "/me/tasks?perPage=50" : null);
  const [picked, setPicked] = useState("");
  const [localError, setLocalError] = useState(null);
  const list = (tasks.items ?? []).filter((t) => t.status !== "DONE" && t.status !== "CANCELLED");

  async function onStop() {
    setLocalError(null);
    const minutes = await stop();
    if (minutes === null) setLocalError("Enregistrement impossible : le minuteur continue.");
  }

  function onStart() {
    const task = list.find((t) => t.id === picked);
    if (task) start(task);
  }

  return (
    <GlassCard className={`flex flex-col gap-4 p-6 ${className}`}>
      <div className="flex items-center gap-3">
        <GlowIcon tone={timer ? "mint" : "sky"}><Icon name={timer ? "clock" : "bolt"} /></GlowIcon>
        <div>
          <h3 className="text-[16px] font-semibold">Minuteur</h3>
          <p className="text-[12.5px] text-white/55">{timer ? "Enregistrement en cours" : "Aucun minuteur actif"}</p>
        </div>
      </div>

      {timer ? (
        <>
          <p className="font-mono text-[34px] font-semibold tabular-nums tracking-tight" aria-live="off">{formatElapsed(elapsedSeconds)}</p>
          <p className="truncate text-[13.5px] text-white/65" title={timer.title}>{timer.title}</p>
          <button type="button" onClick={onStop} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-500/90 px-4 py-2.5 text-[14px] font-medium text-white shadow-[0_0_24px_rgba(244,63,94,0.35)] transition hover:bg-rose-500 disabled:opacity-60">
            <Icon name="stop" className="h-4 w-4" />
            {saving ? "Enregistrement…" : "Arrêter et enregistrer"}
          </button>
        </>
      ) : (
        <>
          {tasks.error ? <p className="text-[12.5px] text-rose-300">{tasks.error}</p> : null}
          <label htmlFor="timer-task" className="sr-only">Tâche à chronométrer</label>
          <select id="timer-task" value={picked} onChange={(e) => setPicked(e.target.value)} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-[14px] text-white outline-none focus:border-sky-300/60">
            <option value="" className="text-[#0b2545]">{list.length ? "Choisir une tâche…" : "Aucune tâche assignée"}</option>
            {list.map((task) => (
              <option key={task.id} value={task.id} className="text-[#0b2545]">{task.title}</option>
            ))}
          </select>
          <button type="button" onClick={onStart} disabled={!picked} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-[14px] font-medium text-[#0b2545] transition hover:bg-sky-100 disabled:opacity-40">
            <Icon name="play" className="h-4 w-4" />
            Démarrer
          </button>
        </>
      )}
      {error || localError ? <p role="alert" className="text-[12.5px] text-rose-300">{error ?? localError}</p> : null}
    </GlassCard>
  );
}

/* ---------- Actions rapides ---------- */

function QuickActions({ className }) {
  const actions = [
    { href: "/espace-equipe/taches", label: "Nouvelle tâche", icon: "plus", tone: "accent" },
    { href: "/espace-equipe/temps", label: "Saisir du temps", icon: "clock", tone: "mint" },
    { href: "/espace-equipe/rapports-journaliers", label: "Rapport du jour", icon: "doc", tone: "sky" },
    { href: "/espace-equipe/calendrier", label: "Calendrier", icon: "calendar", tone: "amber" },
  ];
  return (
    <GlassCard className={`flex flex-col gap-3 p-6 ${className}`}>
      <h3 className="text-[16px] font-semibold">Actions rapides</h3>
      <ul className="grid grid-cols-2 gap-3">
        {actions.map((action) => (
          <li key={action.href}>
            <Link href={action.href} className="flex h-full flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-[13.5px] font-medium text-white/90 transition hover:border-white/25 hover:bg-white/[0.09]">
              <GlowIcon tone={action.tone} className="h-9 w-9 rounded-xl [&>svg]:h-4 [&>svg]:w-4"><Icon name={action.icon} /></GlowIcon>
              {action.label}
            </Link>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

/* ---------- Chronologie verticale ---------- */

function Timeline({ className }) {
  const dots = { mint: "bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.8)]", sky: "bg-sky-300 shadow-[0_0_12px_rgba(125,211,252,0.8)]", accent: "bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.8)]", amber: "bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.7)]" };
  return (
    <GlassCard className={`flex flex-col p-6 ${className}`}>
      <h3 className="text-[16px] font-semibold">Activité récente</h3>
      <ol className="relative mt-5 flex flex-col gap-5 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-gradient-to-b before:from-white/30 before:to-transparent">
        {ACTIVITY_DEMO.map((item) => (
          <li key={item.id} className="relative pl-7">
            <span className={`absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full ${dots[item.tone] ?? dots.sky}`} aria-hidden="true" />
            <p className="text-[13.5px] leading-snug text-white/90">{item.title}</p>
            <p className="mt-0.5 text-[12px] text-white/50">{item.actor} · {item.when}</p>
          </li>
        ))}
      </ol>
    </GlassCard>
  );
}

/* ---------- Avancement des projets ---------- */

function ProjectsWidget({ className }) {
  const tones = { accent: "from-blue-400 to-blue-600", sky: "from-sky-300 to-blue-400", mint: "from-emerald-300 to-teal-400", amber: "from-amber-200 to-orange-400" };
  return (
    <GlassCard className={`flex flex-col gap-5 p-6 md:p-7 ${className}`}>
      <div className="flex items-center gap-4">
        <GlowIcon tone="accent"><Icon name="users" /></GlowIcon>
        <div>
          <h3 className="text-[16px] font-semibold">Avancement des projets</h3>
          <p className="text-[13px] text-white/55">Progression déclarée par les chefs de projet</p>
        </div>
      </div>
      <ul className="grid gap-5 md:grid-cols-2">
        {PROJECTS_DEMO.map((project) => (
          <li key={project.name}>
            <div className="mb-2 flex items-baseline justify-between gap-3 text-[13.5px]">
              <span className="truncate text-white/90">{project.name}</span>
              <span className="font-semibold tabular-nums">{project.progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={project.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={project.progress}>
              <div className={`h-full rounded-full bg-gradient-to-r shadow-[0_0_14px_rgba(79,176,240,0.45)] ${tones[project.tone]}`} style={{ width: `${project.progress}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

