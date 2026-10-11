"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useAllListing } from "@/lib/use-all-listing";
import { fetchAllPages } from "@/lib/pagination.mjs";
import { buildAnalytics } from "@/lib/analytics-utils.mjs";
import GlassCard, { GlowIcon } from "@/components/dashboard/GlassCard";
import Icon from "@/components/dashboard/icons";
import { Notice } from "@/components/workspace/ui";

const STATUS_COLOR = { TODO: "#93c7f5", IN_PROGRESS: "#1e86e0", BLOCKED: "#f87171", IN_REVIEW: "#fbbf24", DONE: "#34d399", CANCELLED: "#8098b2" };

const EMPTY = [];
const isoDay = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/**
 * Analytique de l'équipe : données réelles (saisies de temps sur 30 jours, tâches par statut,
 * avancement des projets). Requiert `report:read:any`, filtré dans le menu et côté API.
 */
export default function AnalytiquePage() {
  const { user, request } = useAuth();
  const to = useMemo(() => isoDay(new Date()), []);
  const from = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return isoDay(d);
  }, []);
  const [asOf, setAsOf] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setAsOf(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const canReadTeamTime = can(user, "time:read:any");
  const canReadTeamProjects = can(user, "project:read:any");
  const canReadTeamTasks = can(user, "task:read:any");
  const canReadMemberNames = can(user, "user:read:any");
  const entries = useAllListing(`/time-entries?from=${from}&to=${to}&perPage=100`, canReadTeamTime);
  const projects = useAllListing("/projects?perPage=100", canReadTeamProjects);
  const users = useAllListing("/users?perPage=100", canReadMemberNames);
  const [tasks, setTasks] = useState({ items: null, error: null, projectKey: null });
  const projectItems = projects.items ?? EMPTY;
  const projectKey = JSON.stringify(projectItems.map(({ id, name, reference }) => [id, name, reference]));

  // Tous les projets visibles, puis toutes leurs tâches, par lots pour borner la concurrence.
  useEffect(() => {
    if (!canReadTeamProjects || !canReadTeamTasks || projects.loading || projects.items === null || projects.error || projectItems.length === 0) {
      return undefined;
    }

    const controller = new AbortController();
    async function loadProjectTasks() {
      try {
        const allTasks = [];
        for (let index = 0; index < projectItems.length; index += 6) {
          const batch = projectItems.slice(index, index + 6);
          const lists = await Promise.all(batch.map(async (project) => {
            const { items } = await fetchAllPages(
              request,
              `/projects/${encodeURIComponent(project.id)}/tasks?perPage=100`,
              { signal: controller.signal },
            );
            return items;
          }));
          allTasks.push(...lists.flat());
        }
        if (!controller.signal.aborted) setTasks({ items: allTasks, error: null, projectKey });
      } catch (caught) {
        if (!controller.signal.aborted) setTasks({ items: null, error: messageOf(caught), projectKey });
      }
    }
    loadProjectTasks();
    return () => controller.abort();
  }, [canReadTeamProjects, canReadTeamTasks, projectItems, projectKey, projects.error, projects.items, projects.loading, request]);

  const hasTaskAccess = canReadTeamProjects && canReadTeamTasks;
  const tasksAreCurrent = tasks.projectKey === projectKey;
  const taskItems = !hasTaskAccess || projectItems.length === 0 || projects.error ? EMPTY : tasksAreCurrent ? tasks.items ?? EMPTY : EMPTY;
  const taskError = tasksAreCurrent ? tasks.error : null;
  const tasksLoading = hasTaskAccess && !projects.error && (projects.loading || projects.items === null || (projectItems.length > 0 && !tasksAreCurrent));
  const timeDataReady = canReadTeamTime && entries.items !== null && !entries.loading && !entries.error;
  const projectsDataReady = canReadTeamProjects && projects.items !== null && !projects.loading && !projects.error;
  const tasksDataReady = hasTaskAccess && projectsDataReady && (projectItems.length === 0 || (tasksAreCurrent && tasks.items !== null && !taskError));
  const data = useMemo(() => buildAnalytics(entries.items ?? EMPTY, projectItems, taskItems, users.items ?? EMPTY, from, to, asOf), [entries.items, projectItems, taskItems, users.items, from, to, asOf]);
  // Les noms des membres sont distincts des droits de rapport ; à défaut, « Membre ».
  const errors = [entries.error, projects.error, taskError, canReadMemberNames ? users.error : null].filter(Boolean);
  const permissionHints = [
    !canReadTeamTime ? "Le détail des heures requiert le droit time:read:any." : null,
    !canReadTeamProjects ? "Les projets d’agence requièrent le droit project:read:any." : null,
    !hasTaskAccess ? "Les statistiques de tâches requièrent les droits project:read:any et task:read:any." : null,
  ].filter(Boolean);
  const loading = entries.loading || projects.loading || tasksLoading;

  return (
    <div className="cx-analytics">
      <header className="mb-7">
        <p className="cx-analytics__eyebrow">30 derniers jours</p>
        <h2 className="cx-analytics__title">Analytique de l’équipe</h2>
      </header>

      {loading && errors.length === 0 ? <div className="mb-5"><Notice tone="info">Chargement de l’ensemble des données accessibles…</Notice></div> : null}
      {permissionHints.length ? <div className="mb-5 flex flex-col gap-2">{permissionHints.map((hint) => <Notice key={hint} tone="info">{hint}</Notice>)}</div> : null}
      {errors.length ? <div className="mb-5 flex flex-col gap-2">{errors.map((error, index) => <Notice key={`${index}-${error}`}>{error}</Notice>)}</div> : null}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Temps sur 7 jours"
          value={timeDataReady ? `${data.weekHours.toFixed(1)} h` : entries.loading ? "…" : "—"}
          sub={timeDataReady ? `${data.totalHours.toFixed(1)} h sur 30 jours` : "Données non disponibles pour ce compte."}
          icon="clock"
          tone="sky"
        />
        <Kpi
          label="Tâches complétées"
          value={tasksDataReady ? `${data.completionRate}%` : tasksLoading ? "…" : "—"}
          sub={tasksDataReady ? `${data.doneCount} terminées · ${data.lateCount} en retard` : "Données non disponibles pour ce compte."}
          icon="check"
          tone="mint"
        />
        <Kpi label="Projets actifs" value={projectsDataReady ? String(data.activeProjects) : projects.loading ? "…" : "—"} icon="folder" tone="accent" />
        <Kpi label="Avancement moyen" value={projectsDataReady ? `${data.avgProgress}%` : projects.loading ? "…" : "—"} icon="chart" tone="amber" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-12">
        <GlassCard className="flex flex-col p-6 xl:col-span-8">
          <h3 className="!text-[16px] !font-bold !text-[#152f4d]">Temps travaillé par jour</h3>
          <p className="text-[13px] text-[#71849a]">Somme des saisies de l’équipe</p>
          <div className="mt-4 h-[280px]">
            {timeDataReady ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.daily} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gHours" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4fb0f0" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#1e86e0" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" tick={{ fill: "#8292a5", fontSize: 11 }} axisLine={false} tickLine={false} interval={4} />
                  <YAxis hide />
                  <Tooltip content={<DarkTooltip unit="h" />} />
                  <Area type="monotone" dataKey="heures" name="Heures" stroke="#4fb0f0" strokeWidth={2.5} fill="url(#gHours)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <p className="pt-24 text-center text-[13px] text-[#71849a]" role="status">{entries.loading ? "Chargement des heures…" : "Données non disponibles pour ce compte."}</p>}
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col p-6 xl:col-span-12">
          <h3 className="!text-[16px] !font-bold !text-[#152f4d]">Tâches : complétées contre en retard</h3>
          <p className="text-[13px] text-[#71849a]">Hors tâches annulées, tous projets confondus</p>
          {tasksDataReady ? (
            <>
              <div className="mt-5 flex h-4 overflow-hidden rounded-full bg-[#edf2f7]" role="img" aria-label={`${data.doneCount} terminées, ${data.openCount} en cours, ${data.lateCount} en retard`}>
                {data.total ? (
                  <>
                    <div className="h-full bg-[#179567] transition-[width] duration-700" style={{ width: `${(data.doneCount / data.total) * 100}%` }} />
                    <div className="h-full bg-[#2e92e6] transition-[width] duration-700" style={{ width: `${(data.openCount / data.total) * 100}%` }} />
                    <div className="h-full bg-[#c0271f] transition-[width] duration-700" style={{ width: `${(data.lateCount / data.total) * 100}%` }} />
                  </>
                ) : null}
              </div>
              <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-[#526980]">
                <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#179567]" aria-hidden="true" />Terminées · <span className="font-semibold text-[#152f4d]">{data.doneCount}</span></li>
                <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#2e92e6]" aria-hidden="true" />En cours · <span className="font-semibold text-[#152f4d]">{data.openCount}</span></li>
                <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#c0271f]" aria-hidden="true" />En retard · <span className="font-semibold text-[#152f4d]">{data.lateCount}</span></li>
              </ul>
            </>
          ) : <p className="mt-8 text-[13px] text-[#71849a]" role="status">{tasksLoading ? "Chargement des tâches…" : "Données non disponibles pour ce compte."}</p>}
        </GlassCard>

        <GlassCard className="flex flex-col p-6 xl:col-span-4">
          <h3 className="!text-[16px] !font-bold !text-[#152f4d]">Répartition des tâches</h3>
          <p className="text-[13px] text-[#71849a]">Par statut, tous projets confondus</p>
          <div className="mt-4 h-[200px]">
            {!tasksDataReady ? (
              <p className="pt-16 text-center text-[13px] text-[#71849a]" role="status">{tasksLoading ? "Chargement des tâches…" : "Données non disponibles pour ce compte."}</p>
            ) : data.statusSlices.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.statusSlices} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3} stroke="none" isAnimationActive={false}>
                    {data.statusSlices.map((slice) => <Cell key={slice.key} fill={STATUS_COLOR[slice.key]} />)}
                  </Pie>
                  <Tooltip content={<DarkTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="pt-16 text-center text-[13px] text-[#71849a]">Aucune tâche.</p>}
          </div>
          {tasksDataReady ? (
            <ul className="mt-3 grid grid-cols-2 gap-1.5 text-[12.5px] text-[#526980]">
              {data.statusSlices.map((slice) => (
                <li key={slice.key} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[slice.key] }} />
                  {slice.name} · {slice.value}
                </li>
              ))}
            </ul>
          ) : null}
        </GlassCard>

        <GlassCard className="flex flex-col p-6 xl:col-span-6">
          <div className="flex items-center gap-3">
            <GlowIcon tone="accent"><Icon name="users" /></GlowIcon>
            <div>
              <h3 className="!text-[16px] !font-bold !text-[#152f4d]">Heures par membre</h3>
              <p className="text-[13px] text-[#71849a]">Sur la période</p>
            </div>
          </div>
          <div className="mt-4 h-[260px]">
            {data.byMember.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byMember} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fill: "#8292a5", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fill: "#526980", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<DarkTooltip unit="h" />} cursor={{ fill: "rgba(30,134,224,0.05)" }} />
                  <Bar dataKey="heures" name="Heures" fill="url(#barGrad)" radius={[0, 10, 10, 0]} isAnimationActive={false} />
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#1e86e0" />
                      <stop offset="100%" stopColor="#4fb0f0" />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="pt-16 text-center text-[13px] text-[#71849a]">Aucune saisie sur la période.</p>}
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col p-6 xl:col-span-6">
          <h3 className="!text-[16px] !font-bold !text-[#152f4d]">Avancement des projets</h3>
          <p className="text-[13px] text-[#71849a]">Progression déclarée</p>
          <ul className="mt-5 flex flex-col gap-4">
            {data.projects.length ? data.projects.map((p) => (
              <li key={p.id}>
                <div className="mb-1.5 flex justify-between text-[13.5px]">
                  <span className="truncate text-[#284663]">{p.name}</span>
                  <span className="font-semibold tabular-nums">{p.progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#edf2f7]" role="progressbar" aria-label={p.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.progress}>
                  <div className="h-full rounded-full bg-gradient-to-r from-sky-300 to-blue-500" style={{ width: `${p.progress}%` }} />
                </div>
              </li>
            )) : <p className="text-center text-[13px] text-[#71849a]">Aucun projet.</p>}
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
        <p className="text-[12.5px] text-[#71849a]">{label}</p>
        <p className="text-[24px] font-semibold tracking-tight">{value}</p>
        {sub ? <p className="mt-0.5 text-[12px] text-[#71849a]">{sub}</p> : null}
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
