"use client";

/*
 * MES TÂCHES — l'espace de travail personnel.
 *
 * Une seule liste pour tout ce qui m'attend : mes tâches personnelles (privées)
 * ET les tâches de projet qui me sont assignées, chacune marquée comme telle.
 * Les données viennent de `GET /me/tasks` (le serveur la borne à « assignées à
 * moi » dans mon espace) et de `GET /me/goals` ; aucune copie, aucune liste
 * parallèle : cocher une tâche de projet ici la déplace aussi sur le tableau de
 * l'équipe, avec ses règles de transition.
 *
 *  - une case à cocher par tâche (terminer / remettre à faire / rouvrir) ;
 *  - des OBJECTIFS : un but et le groupe de tâches qui y mène, avec son
 *    avancement calculé ; cliquer un objectif filtre la liste ;
 *  - des vues « À faire », « Aujourd'hui », « En retard », « Terminées », et un
 *    filtre par nature (personnelles / projets) ;
 *  - le minuteur sur chaque tâche ouverte ;
 *  - un lien profond `?tache=<id>` (notification « une tâche vous est
 *    assignée », panneau de suivi) qui ouvre et met en avant la tâche.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Archive,
  CheckCircle2,
  CircleAlert,
  ListChecks,
  Pencil,
  Plus,
  RotateCcw,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useAllListing } from "@/lib/use-all-listing";
import { useListing } from "@/lib/use-listing";
import { goalProgressOf, goalTone } from "@/lib/goals.mjs";
import { compareTasks, dueBucket, groupByDue, isClosedStatus, isOpenStatus } from "@/lib/task-status.mjs";
import { canReadOwnTasks } from "@/lib/timer-access";
import { useShellQuery } from "@/components/softui/Shell";
import { Alert, Button } from "@/components/softui/primitives";
import { Empty } from "@/components/workspace/ui";
import PersonalTaskRow from "@/components/tasks/PersonalTaskRow";
import TaskComposer from "@/components/tasks/TaskComposer";
import { GoalCard, GoalCountdown, GoalDialog, GoalRing } from "@/components/goals/GoalParts";

const VIEWS = [
  { id: "open", label: "À faire" },
  { id: "today", label: "Aujourd’hui" },
  { id: "overdue", label: "En retard" },
  { id: "done", label: "Terminées" },
];

const SOURCES = [
  { id: "all", label: "Toutes" },
  { id: "personal", label: "Personnelles" },
  { id: "project", label: "Projets" },
];

export default function PersonalWorkspace() {
  const { user, request } = useAuth();
  const { query: shellQuery } = useShellQuery();
  const searchParams = useSearchParams();
  const focusId = searchParams.get("tache");

  const canRead = canReadOwnTasks(user);
  const canCreate = can(user, "task:write:personal");
  const canGoals = can(user, "task:read:personal");
  const canWriteGoals = canGoals && can(user, "task:write:personal");
  // Dans « Mes tâches », chaque tâche de projet m'est assignée : je peux la faire
  // avancer avec `task:write:own` (ou `any`). Sans ces droits, case et minuteur
  // sont verrouillés au lieu d'échouer au clic.
  const canWriteProject = can(user, "task:write:any") || can(user, "task:write:own");

  const tasks = useAllListing("/me/tasks?perPage=100", canRead);
  const goals = useListing(canGoals ? "/me/goals" : null);
  const [showArchived, setShowArchived] = useState(false);
  const archived = useListing(canGoals && showArchived ? "/me/goals?status=ARCHIVED" : null);

  const [now, setNow] = useState(() => Date.now());
  const [overrides, setOverrides] = useState({});
  const [overrideBase, setOverrideBase] = useState(tasks.items);

  // Une liste fraîche du serveur fait foi : les retouches optimistes s'effacent.
  if (tasks.items !== overrideBase) {
    setOverrideBase(tasks.items);
    setOverrides({});
  }
  const [view, setView] = useState("open");
  const [source, setSource] = useState("all");
  const [goalFilter, setGoalFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [goalDialog, setGoalDialog] = useState(null);
  const [confirmGoalDelete, setConfirmGoalDelete] = useState(false);
  const [focusApplied, setFocusApplied] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Données dérivées                                                       */
  /* ---------------------------------------------------------------------- */

  const goalList = useMemo(() => (Array.isArray(goals.items) ? goals.items : []), [goals.items]);
  const goalById = useMemo(() => new Map([...goalList, ...(archived.items ?? [])].map((goal) => [goal.id, goal])), [archived.items, goalList]);

  const allTasks = useMemo(
    () =>
      (tasks.items ?? []).map((task) => {
        const patch = overrides[task.id];
        if (!patch) return task;
        const merged = { ...task, ...patch };
        if ("goalId" in patch) {
          const goal = patch.goalId ? goalById.get(patch.goalId) : null;
          merged.goal = goal ? { id: goal.id, title: goal.title, color: goal.color, status: goal.status } : null;
        }
        return merged;
      }),
    [goalById, overrides, tasks.items],
  );

  const progressByGoal = useMemo(() => {
    const statuses = new Map();
    for (const task of allTasks) {
      if (!task.goal) continue;
      const list = statuses.get(task.goal.id) ?? [];
      list.push(task.status);
      statuses.set(task.goal.id, list);
    }
    return statuses;
  }, [allTasks]);

  const progressOf = useCallback(
    (goal) => (tasks.items ? goalProgressOf(progressByGoal.get(goal.id) ?? []) : goal.progress ?? goalProgressOf([])),
    [progressByGoal, tasks.items],
  );

  const q = shellQuery.trim().toLowerCase();
  const scoped = useMemo(
    () =>
      allTasks.filter((task) => {
        if (source === "personal" && !task.isPersonal) return false;
        if (source === "project" && task.isPersonal) return false;
        if (goalFilter === "none" && task.goal) return false;
        if (goalFilter !== "all" && goalFilter !== "none" && task.goal?.id !== goalFilter) return false;
        if (q) {
          const haystack = `${task.title} ${task.project?.name ?? ""} ${task.goal?.title ?? ""}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      }),
    [allTasks, goalFilter, q, source],
  );

  const counts = useMemo(() => {
    const open = scoped.filter((task) => isOpenStatus(task.status));
    return {
      open: open.length,
      today: open.filter((task) => dueBucket(task, now) === "today").length,
      overdue: open.filter((task) => dueBucket(task, now) === "overdue").length,
      done: scoped.filter((task) => isClosedStatus(task.status)).length,
    };
  }, [now, scoped]);

  const visible = useMemo(() => {
    if (view === "done") {
      return scoped
        .filter((task) => isClosedStatus(task.status))
        .sort((a, b) => String(b.completedAt ?? "").localeCompare(String(a.completedAt ?? "")));
    }
    const open = scoped.filter((task) => isOpenStatus(task.status));
    if (view === "today") return open.filter((task) => dueBucket(task, now) === "today").sort(compareTasks);
    if (view === "overdue") return open.filter((task) => dueBucket(task, now) === "overdue").sort(compareTasks);
    return open;
  }, [now, scoped, view]);

  const groups = useMemo(
    () => (view === "open" ? groupByDue(visible, now) : [{ id: view, label: null, tasks: visible }]),
    [now, view, visible],
  );

  const selectedGoal = goalFilter !== "all" && goalFilter !== "none" ? goalById.get(goalFilter) ?? null : null;

  /* ---------------------------------------------------------------------- */
  /* Lien profond ?tache=<id>                                               */
  /* ---------------------------------------------------------------------- */

  // Appliqué une seule fois, pendant le rendu (état dérivé du lien) : la vue,
  // les filtres et le dépli s'alignent sur la tâche demandée.
  if (focusId && !focusApplied && tasks.items) {
    setFocusApplied(true);
    const target = allTasks.find((task) => task.id === focusId);
    if (target) {
      setGoalFilter("all");
      setSource("all");
      setView(isClosedStatus(target.status) ? "done" : "open");
      setExpandedId(target.id);
      setHighlightId(target.id);
    } else {
      setNotice({ tone: "warning", text: "Cette tâche n’est plus dans votre liste (terminée ailleurs, réassignée ou supprimée)." });
    }
  }

  // Effet de bord DOM seulement : amener la tâche à l'écran, puis éteindre la
  // mise en avant.
  useEffect(() => {
    if (!highlightId) return undefined;
    const scroll = window.setTimeout(() => {
      document.getElementById(`tache-${highlightId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    const clear = window.setTimeout(() => setHighlightId(null), 4200);
    return () => {
      window.clearTimeout(scroll);
      window.clearTimeout(clear);
    };
  }, [highlightId]);

  /* ---------------------------------------------------------------------- */
  /* Gestes                                                                  */
  /* ---------------------------------------------------------------------- */

  const patchTask = (id, patch) => setOverrides((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  const dropPatch = (id, key) =>
    setOverrides((current) => {
      if (!current[id]) return current;
      const next = { ...current[id] };
      delete next[key];
      const all = { ...current };
      if (Object.keys(next).length) all[id] = next;
      else delete all[id];
      return all;
    });

  async function changeStatus(task, status) {
    if (!status || status === task.status) return;
    setNotice(null);
    setBusyId(task.id);
    const previous = task.status;
    patchTask(task.id, { status, completedAt: status === "DONE" ? new Date().toISOString() : null });
    try {
      const { data } = await request(`/tasks/${task.id}/status`, { method: "PATCH", body: { status } });
      patchTask(task.id, { status: data?.status ?? status, completedAt: data?.completedAt ?? null });
      // Dernière tâche d'un objectif cochée : on propose de le déclarer atteint
      // (jamais automatiquement — c'est au membre de le décider).
      if (status === "DONE" && task.goal) {
        const goal = goalById.get(task.goal.id);
        const after = goalProgressOf(
          allTasks.filter((item) => item.goal?.id === task.goal.id).map((item) => (item.id === task.id ? "DONE" : item.status)),
        );
        if (goal && goal.status === "ACTIVE" && after.open === 0 && after.done > 0) {
          setNotice({ tone: "success", text: `Toutes les tâches de « ${goal.title} » sont terminées. Objectif atteint ?`, goalId: goal.id });
        }
      }
    } catch (caught) {
      patchTask(task.id, { status: previous, completedAt: task.completedAt ?? null });
      setNotice({ tone: "error", text: `« ${task.title} » : ${messageOf(caught)}` });
    } finally {
      setBusyId(null);
    }
  }

  async function changeGoal(task, goalId) {
    const current = task.goal?.id ?? null;
    if (current === goalId) return;
    setNotice(null);
    setBusyId(task.id);
    patchTask(task.id, { goalId });
    try {
      if (goalId) await request(`/me/goals/${goalId}/tasks/${task.id}`, { method: "PUT" });
      else await request(`/me/goals/${current}/tasks/${task.id}`, { method: "DELETE" });
      await goals.reload();
    } catch (caught) {
      dropPatch(task.id, "goalId");
      setNotice({ tone: "error", text: messageOf(caught) });
    } finally {
      setBusyId(null);
    }
  }

  async function saveTask(task, form) {
    setNotice(null);
    const title = form.title.trim();
    if (title.length < 2) {
      setNotice({ tone: "error", text: "Le titre doit contenir au moins 2 caractères." });
      return;
    }
    setBusyId(task.id);
    try {
      await request(`/tasks/${task.id}`, {
        method: "PATCH",
        body: {
          title,
          description: form.description.trim() || null,
          dueDate: form.dueDate ? new Date(`${form.dueDate}T12:00:00Z`).toISOString() : null,
          priority: form.priority,
          estimateMinutes: form.estimateMinutes ? Number(form.estimateMinutes) : null,
        },
      });
      await tasks.reload();
      setNotice({ tone: "success", text: "Tâche mise à jour." });
    } catch (caught) {
      setNotice({ tone: "error", text: messageOf(caught) });
    } finally {
      setBusyId(null);
    }
  }

  async function deleteTask(task) {
    setNotice(null);
    setBusyId(task.id);
    try {
      await request(`/tasks/${task.id}`, { method: "DELETE" });
      setExpandedId(null);
      await Promise.all([tasks.reload(), goals.reload()]);
      setNotice({ tone: "success", text: `« ${task.title} » a été supprimée.` });
    } catch (caught) {
      setNotice({ tone: "error", text: messageOf(caught) });
    } finally {
      setBusyId(null);
    }
  }

  async function onCreated() {
    await Promise.all([tasks.reload(), goals.reload()]);
    if (view === "done") setView("open");
  }

  async function updateGoalStatus(goal, status) {
    setNotice(null);
    try {
      await request(`/me/goals/${goal.id}`, { method: "PATCH", body: { status } });
      await Promise.all([goals.reload(), showArchived ? archived.reload() : null, tasks.reload()]);
      if (status === "ARCHIVED") setGoalFilter("all");
      setNotice({
        tone: "success",
        text:
          status === "ACHIEVED"
            ? `Bravo : « ${goal.title} » est atteint.`
            : status === "ARCHIVED"
              ? `« ${goal.title} » est archivé.`
              : `« ${goal.title} » est de nouveau actif.`,
      });
    } catch (caught) {
      setNotice({ tone: "error", text: messageOf(caught) });
    }
  }

  async function deleteGoal(goal) {
    setNotice(null);
    try {
      await request(`/me/goals/${goal.id}`, { method: "DELETE" });
      setConfirmGoalDelete(false);
      setGoalFilter("all");
      await Promise.all([goals.reload(), showArchived ? archived.reload() : null, tasks.reload()]);
      setNotice({ tone: "success", text: `Objectif « ${goal.title} » supprimé — ses tâches sont conservées.` });
    } catch (caught) {
      setNotice({ tone: "error", text: messageOf(caught) });
    }
  }

  if (!canRead && !canCreate) {
    return <Alert icon={CircleAlert}>Votre rôle ne donne accès à aucune liste de tâches.</Alert>;
  }

  const loadError = tasks.error ?? goals.error ?? null;
  const total = allTasks.length;

  return (
    <div className="sui-mywork">
      {canCreate ? (
        <TaskComposer
          goals={goalList.filter((goal) => goal.status !== "ARCHIVED")}
          defaultGoalId={selectedGoal && selectedGoal.status !== "ARCHIVED" ? selectedGoal.id : ""}
          onCreated={onCreated}
        />
      ) : null}

      {canGoals ? (
        <section className="sui-goals" aria-labelledby="sui-goals-title">
          <div className="sui-goals__head">
            <h2 id="sui-goals-title" className="sui-section__title">
              <Target size={18} strokeWidth={1.75} aria-hidden="true" />
              Mes objectifs
              {goalList.length ? <span className="sui-section__count">{goalList.length}</span> : null}
            </h2>
            <div className="sui-goals__tools">
              <button type="button" className="sui-goals__archived" aria-pressed={showArchived} onClick={() => setShowArchived((value) => !value)}>
                <Archive size={14} strokeWidth={1.9} aria-hidden="true" />
                {showArchived ? "Masquer l’archive" : "Archive"}
              </button>
              {canWriteGoals ? (
                <Button icon={Plus} onClick={() => setGoalDialog({ goal: null })}>
                  Nouvel objectif
                </Button>
              ) : null}
            </div>
          </div>

          {goals.items === null && !goals.error ? <div className="sui-goals__skeleton" aria-hidden="true" /> : null}
          {goals.items !== null && goalList.length === 0 ? (
            <button type="button" className="sui-goal sui-goal--empty" onClick={() => canWriteGoals && setGoalDialog({ goal: null })} disabled={!canWriteGoals}>
              <span className="sui-goal__plus" aria-hidden="true">
                <Target size={20} strokeWidth={1.75} />
              </span>
              <span className="sui-goal__copy">
                <span className="sui-goal__title">Fixez-vous un objectif</span>
                <span className="sui-goal__meta">Regroupez les tâches qui y mènent — personnelles ou de projet — et suivez votre progression.</span>
              </span>
            </button>
          ) : null}
          {goalList.length ? (
            <div className="sui-goals__grid" role="list">
              {goalList.map((goal) => (
                <div key={goal.id} role="listitem">
                  <GoalCard
                    goal={goal}
                    progress={progressOf(goal)}
                    now={now}
                    selected={goalFilter === goal.id}
                    onSelect={() => setGoalFilter((value) => (value === goal.id ? "all" : goal.id))}
                  />
                </div>
              ))}
            </div>
          ) : null}

          {showArchived ? (
            <div className="sui-goals__archive">
              <p className="sui-goals__archive-title">Objectifs archivés</p>
              {archived.items === null ? <p className="sui-card__desc">Chargement…</p> : null}
              {archived.items?.length === 0 ? <p className="sui-card__desc">Aucun objectif archivé.</p> : null}
              <ul>
                {(archived.items ?? []).map((goal) => (
                  <li key={goal.id}>
                    <span className="sui-goals__archive-dot" style={{ "--tone-fill": `var(--fill-${goalTone(goal.color)})` }} aria-hidden="true" />
                    <span className="sui-goals__archive-name">{goal.title}</span>
                    {canWriteGoals ? (
                      <button type="button" className="sui-timer__link" onClick={() => updateGoalStatus(goal, "ACTIVE")}>
                        Réactiver
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {selectedGoal ? (
        <GoalFocus
          goal={selectedGoal}
          progress={progressOf(selectedGoal)}
          now={now}
          canWrite={canWriteGoals}
          confirmDelete={confirmGoalDelete}
          onEdit={() => setGoalDialog({ goal: selectedGoal })}
          onStatus={(status) => updateGoalStatus(selectedGoal, status)}
          onAskDelete={() => setConfirmGoalDelete(true)}
          onCancelDelete={() => setConfirmGoalDelete(false)}
          onDelete={() => deleteGoal(selectedGoal)}
          onClose={() => setGoalFilter("all")}
        />
      ) : null}

      {/* `data-coach-id` : cible de l'étape « faire avancer une tâche » du
          parcours personnel. Le tableau réel, pas une copie. */}
      <section className="sui-panel sui-mytasks" aria-labelledby="sui-mytasks-title" data-coach-id="taches-board">
        <div className="sui-mytasks__head">
          <h2 id="sui-mytasks-title" className="sui-section__title">
            <ListChecks size={18} strokeWidth={1.75} aria-hidden="true" />
            {selectedGoal ? `Tâches de « ${selectedGoal.title} »` : "Toutes mes tâches"}
          </h2>
          <div className="sui-seg sui-mytasks__views" role="tablist" aria-label="Vue de la liste">
            {VIEWS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={view === entry.id}
                className="sui-seg__tab"
                onClick={() => setView(entry.id)}
              >
                {view === entry.id ? <span className="sui-seg__pill" aria-hidden="true" /> : null}
                <span className="sui-mytasks__tab-label">
                  {entry.label}
                  <span className={`sui-mytasks__tab-count${entry.id === "overdue" && counts.overdue ? " is-late" : ""}`}>{counts[entry.id]}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="sui-mytasks__filters">
          <ul className="sui-filters" aria-label="Nature des tâches">
            {SOURCES.map((entry) => (
              <li key={entry.id}>
                <button type="button" className="sui-pill sui-pill--sm" aria-pressed={source === entry.id} onClick={() => setSource(entry.id)}>
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>
          {canGoals && goalList.length ? (
            <label className="sui-mytasks__goalfilter">
              <span className="sr-only">Filtrer par objectif</span>
              <Target size={14} strokeWidth={2} aria-hidden="true" />
              <select value={goalFilter} onChange={(event) => setGoalFilter(event.target.value)}>
                <option value="all">Tous les objectifs</option>
                <option value="none">Sans objectif</option>
                {goalList.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {loadError ? <Alert icon={CircleAlert}>{loadError}</Alert> : null}
        {notice ? (
          <div className={`sui-mytasks__notice is-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
            {notice.tone === "success" ? <CheckCircle2 size={16} strokeWidth={1.9} aria-hidden="true" /> : <CircleAlert size={16} strokeWidth={1.9} aria-hidden="true" />}
            <span>{notice.text}</span>
            {notice.goalId && canWriteGoals ? (
              <button
                type="button"
                className="sui-timer__link"
                onClick={() => {
                  const goal = goalById.get(notice.goalId);
                  if (goal) updateGoalStatus(goal, "ACHIEVED");
                }}
              >
                Marquer comme atteint
              </button>
            ) : null}
            <button type="button" className="sui-mytasks__notice-close" aria-label="Masquer" onClick={() => setNotice(null)}>
              <X size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {tasks.items === null && !tasks.error ? (
          <div className="sui-mytasks__skeleton" aria-label="Chargement de vos tâches" role="status">
            <span />
            <span />
            <span />
          </div>
        ) : null}

        {tasks.items !== null && visible.length === 0 ? (
          <Empty icon={view === "done" ? CheckCircle2 : ListChecks}>
            {total === 0
              ? canCreate
                ? "Aucune tâche pour l’instant : ajoutez la première ci-dessus, ou attendez qu’on vous en confie une."
                : "Aucune tâche ne vous est assignée pour le moment."
              : view === "done"
                ? "Aucune tâche terminée dans cette sélection."
                : view === "today"
                  ? "Rien d’échu aujourd’hui dans cette sélection."
                  : view === "overdue"
                    ? "Aucun retard : tout est à jour."
                    : "Tout est fait dans cette sélection. Bravo !"}
          </Empty>
        ) : null}

        {groups.map((group) =>
          group.tasks.length ? (
            <div key={group.id} className="sui-mytasks__group">
              {group.label ? (
                <p className={`sui-mytasks__group-title${group.id === "overdue" ? " is-late" : ""}`}>
                  {group.label}
                  <span>{group.tasks.length}</span>
                </p>
              ) : null}
              <ul className="sui-mytasks__list">
                {group.tasks.map((task) => (
                  <PersonalTaskRow
                    key={task.id}
                    task={task}
                    goals={goalList}
                    now={now}
                    expanded={expandedId === task.id}
                    focused={highlightId === task.id}
                    busy={busyId === task.id}
                    canEditPersonal={canCreate}
                    canLinkGoals={canWriteGoals}
                    canWriteProject={canWriteProject}
                    onToggleExpand={(id) => setExpandedId((value) => (value === id ? null : id))}
                    onStatus={changeStatus}
                    onGoal={changeGoal}
                    onSave={saveTask}
                    onDelete={deleteTask}
                  />
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </section>

      {goalDialog ? (
        <GoalDialog
          goal={goalDialog.goal}
          onClose={() => setGoalDialog(null)}
          onSaved={async (saved) => {
            setGoalDialog(null);
            await Promise.all([goals.reload(), tasks.reload()]);
            if (!goalDialog.goal && saved?.id) setGoalFilter(saved.id);
          }}
        />
      ) : null}
    </div>
  );
}

/** En-tête de l'objectif sélectionné : description, avancement, gestes. */
function GoalFocus({ goal, progress, now, canWrite, confirmDelete, onEdit, onStatus, onAskDelete, onCancelDelete, onDelete, onClose }) {
  const tone = goalTone(goal.color);
  const achieved = goal.status === "ACHIEVED";
  const countable = progress.total - progress.cancelled;
  return (
    <section
      className={`sui-goalfocus${achieved ? " is-achieved" : ""}`}
      style={{ "--tone-bg": `var(--${tone})`, "--tone-fill": `var(--fill-${tone})` }}
      aria-label={`Objectif ${goal.title}`}
    >
      <GoalRing percent={progress.percent} tone={tone} size={76} stroke={8} />
      <div className="sui-goalfocus__copy">
        <p className="sui-goalfocus__eyebrow">
          {achieved ? "Objectif atteint" : "Objectif en cours"}
          <GoalCountdown targetDate={goal.targetDate} now={now} achieved={achieved} />
        </p>
        <h2 className="sui-goalfocus__title">{goal.title}</h2>
        {goal.description ? <p className="sui-goalfocus__desc">{goal.description}</p> : null}
        <div className="sui-goalfocus__bar" aria-hidden="true">
          <span style={{ width: `${progress.percent}%` }} />
        </div>
        <p className="sui-goalfocus__stats">
          {countable > 0
            ? `${progress.done} terminée${progress.done > 1 ? "s" : ""} sur ${countable} · ${progress.open} à faire`
            : "Ajoutez des tâches à cet objectif : depuis le formulaire ci-dessus, ou le détail d’une tâche."}
          {progress.cancelled ? ` · ${progress.cancelled} annulée${progress.cancelled > 1 ? "s" : ""}` : ""}
        </p>
      </div>
      <div className="sui-goalfocus__actions">
        {canWrite ? (
          confirmDelete ? (
            <span className="sui-goalfocus__confirm" role="alert">
              Supprimer l’objectif ? Ses tâches restent.
              <button type="button" className="sui-btn" onClick={onCancelDelete}>
                Garder
              </button>
              <button type="button" className="sui-btn sui-timer__danger" onClick={onDelete}>
                Supprimer
              </button>
            </span>
          ) : (
            <>
              {achieved ? (
                <Button icon={RotateCcw} onClick={() => onStatus("ACTIVE")}>
                  Rouvrir
                </Button>
              ) : (
                <Button variant="dark" icon={CheckCircle2} onClick={() => onStatus("ACHIEVED")}>
                  Objectif atteint
                </Button>
              )}
              <button type="button" className="sui-iconbtn" aria-label="Modifier l’objectif" title="Modifier" onClick={onEdit}>
                <Pencil size={17} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button type="button" className="sui-iconbtn" aria-label="Archiver l’objectif" title="Archiver" onClick={() => onStatus("ARCHIVED")}>
                <Archive size={17} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button type="button" className="sui-iconbtn" aria-label="Supprimer l’objectif" title="Supprimer" onClick={onAskDelete}>
                <Trash2 size={17} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </>
          )
        ) : null}
        <button type="button" className="sui-iconbtn sui-iconbtn--ghost" aria-label="Revenir à toutes les tâches" title="Toutes les tâches" onClick={onClose}>
          <X size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
