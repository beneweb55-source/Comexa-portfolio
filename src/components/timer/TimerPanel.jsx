"use client";

/*
 * Panneau du minuteur — le même partout : dans le dock (`popover`), sur « Ma
 * journée » (`card`) et sur le tableau de bord de l'équipe (`compact`).
 *
 * À L'ARRÊT : le temps du jour, la dernière saisie enregistrée, le sélecteur
 * de tâches (récentes, les miennes, et pour un chef de projet toutes les
 * tâches de projet), et le démarrage rapide sans tâche.
 *
 * EN COURS : le cadran, la tâche (modifiable sans perdre le temps), une note
 * « sur quoi je travaille » enregistrée au fil de l'eau (elle devient la
 * description de la saisie), pause/reprise, terminer, ou abandonner — ce
 * dernier geste demande une confirmation, puisqu'il n'enregistre rien.
 */

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  ArrowLeftRight,
  Check,
  CircleAlert,
  Clock3,
  FolderKanban,
  Lock,
  Pause,
  Play,
  Square,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { useTimer } from "@/lib/timer";
import { formatElapsed, formatMinutes, isLongRunning, timerProgress } from "@/lib/timer-format.mjs";
import TimerDial from "./TimerDial";
import TaskPicker from "./TaskPicker";

const DIAL_SIZE = { popover: 184, card: 156, compact: 128 };

export default function TimerPanel({ variant = "popover", onClose = null, titleId }) {
  const { timer } = useTimer();
  const fallbackId = useId();
  const headingId = titleId ?? fallbackId;
  return (
    <div className={`sui-timer sui-timer--${variant}${timer ? ` is-${timer.status.toLowerCase()}` : " is-idle"}`}>
      {timer ? (
        <RunningView key={timer.id} variant={variant} headingId={headingId} onClose={onClose} />
      ) : (
        <IdleView variant={variant} headingId={headingId} onClose={onClose} />
      )}
    </div>
  );
}

function TodayTotal({ extraSeconds = 0 }) {
  const { summary } = useTimer();
  if (!summary) return null;
  const minutes = (summary.todayMinutes ?? 0) + Math.floor(extraSeconds / 60);
  return (
    <span className="sui-timer__today" title={`Cette semaine : ${formatMinutes(summary.weekMinutes ?? 0)}`}>
      <Clock3 size={14} strokeWidth={2} aria-hidden="true" />
      Aujourd’hui · <strong>{formatMinutes(minutes)}</strong>
    </span>
  );
}

function CloseButton({ onClose }) {
  if (!onClose) return null;
  return (
    <button type="button" className="sui-timer__close" aria-label="Fermer le minuteur" onClick={onClose}>
      <X size={17} strokeWidth={1.9} aria-hidden="true" />
    </button>
  );
}

function TaskMeta({ task }) {
  if (!task) return <span className="sui-timer__chip is-soft">Sans tâche · non facturable</span>;
  if (task.isPersonal) {
    return (
      <span className="sui-timer__chip">
        <Lock size={12} strokeWidth={2} aria-hidden="true" /> Tâche personnelle
      </span>
    );
  }
  return task.project ? (
    <span className="sui-timer__chip">
      <FolderKanban size={12} strokeWidth={2} aria-hidden="true" /> {task.project.name}
    </span>
  ) : null;
}

/* -------------------------------------------------------------------------- */
/* En cours                                                                    */
/* -------------------------------------------------------------------------- */

function RunningView({ variant, headingId, onClose }) {
  const { timer, elapsedSeconds, pause, resume, stop, discard, setTask, saveNote, saving, error, clearError } = useTimer();
  const noteId = useId();
  const [picking, setPicking] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [note, setNote] = useState(timer.note ?? "");
  const [savedNote, setSavedNote] = useState(timer.note ?? "");
  const [syncedNote, setSyncedNote] = useState(timer.note ?? "");
  const [noteState, setNoteState] = useState("idle");

  // La note a changé ailleurs (autre panneau, autre onglet) : on l'adopte, sauf
  // si une saisie locale est en cours — elle ne doit jamais être écrasée.
  const serverNote = timer.note ?? "";
  if (serverNote !== syncedNote) {
    setSyncedNote(serverNote);
    if (note === savedNote) {
      setNote(serverNote);
      setSavedNote(serverNote);
    }
  }
  const paused = timer.status === "PAUSED";
  const task = timer.task;
  const progress = timerProgress({
    elapsedSeconds,
    estimateMinutes: task?.estimateMinutes,
    loggedMinutes: task?.loggedMinutes,
  });

  // La note s'enregistre seule, une seconde après la dernière frappe.
  useEffect(() => {
    if (note === savedNote) return undefined;
    const id = window.setTimeout(async () => {
      setNoteState("saving");
      const result = await saveNote(note.trim() ? note.trim() : null);
      if (result) {
        setSavedNote(note);
        setNoteState("saved");
      } else setNoteState("idle");
    }, 900);
    return () => window.clearTimeout(id);
  }, [note, savedNote, saveNote]);

  const startedAt = timer.startedAt ? new Date(timer.startedAt) : null;
  const since =
    startedAt && Number.isFinite(startedAt.getTime())
      ? `Depuis ${startedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
      : "En cours";
  const caption = progress.mode === "estimate" ? progress.label : paused ? "En pause" : since;

  return (
    <>
      <div className="sui-timer__head">
        <span className={`sui-timer__state${paused ? " is-paused" : " is-running"}`}>
          <span className="sui-timer__pulse" aria-hidden="true" />
          {paused ? "En pause" : "En cours"}
        </span>
        <TodayTotal extraSeconds={elapsedSeconds} />
        <CloseButton onClose={onClose} />
      </div>

      <h2 id={headingId} className="sr-only">
        Minuteur {paused ? "en pause" : "en cours"} sur {timer.title} : {formatElapsed(elapsedSeconds)}
      </h2>

      {picking ? (
        <div className="sui-timer__picking">
          <div className="sui-timer__picking-head">
            <p className="sui-timer__label">
              Changer de tâche · <span className="sui-timer__picking-time">{formatElapsed(elapsedSeconds)}</span> conservées
            </p>
            <button type="button" className="sui-timer__link" onClick={() => setPicking(false)}>
              Annuler
            </button>
          </div>
          <TaskPicker
            autoFocus
            compact
            excludeId={timer.taskId}
            onPick={async (picked) => {
              const result = await setTask(picked);
              if (result) setPicking(false);
            }}
            footer={
              timer.taskId ? (
                <button
                  type="button"
                  className="sui-timer__link"
                  onClick={async () => {
                    const result = await setTask(null);
                    if (result) setPicking(false);
                  }}
                >
                  Continuer sans tâche
                </button>
              ) : null
            }
          />
        </div>
      ) : (
        <>
          <div className="sui-timer__body">
            <TimerDial elapsedSeconds={elapsedSeconds} status={timer.status} progress={progress} size={DIAL_SIZE[variant] ?? 184} caption={caption} />
            <div className="sui-timer__detail">
              <div className="sui-timer__task">
                <div className="sui-timer__task-copy">
                  <p className={`sui-timer__task-title${task ? "" : " is-empty"}`}>{task ? task.title : "Aucune tâche choisie"}</p>
                  <TaskMeta task={task} />
                </div>
                <button type="button" className="sui-timer__switch" onClick={() => setPicking(true)} disabled={saving}>
                  <ArrowLeftRight size={15} strokeWidth={1.9} aria-hidden="true" />
                  {task ? "Changer" : "Choisir"}
                </button>
              </div>
            </div>
          </div>

          <div className="sui-timer__notefield">
            <label htmlFor={noteId} className="sui-timer__label">
              Sur quoi travaillez-vous ?
              <span className="sui-timer__note-state" aria-live="polite">
                {noteState === "saving" ? "Enregistrement…" : noteState === "saved" && note === savedNote ? "Enregistré" : ""}
              </span>
            </label>
            <textarea
              id={noteId}
              className="sui-timer__note"
              rows={2}
              maxLength={500}
              value={note}
              placeholder="Ex. Intégration de la page produit, corrections de la recette…"
              onChange={(event) => {
                setNote(event.target.value);
                setNoteState("idle");
              }}
            />
          </div>
        </>
      )}

      {isLongRunning(elapsedSeconds) ? (
        <p className="sui-timer__notice is-warning" role="status">
          <TriangleAlert size={15} strokeWidth={1.9} aria-hidden="true" />
          Le minuteur tourne depuis plus de 8 h : vérifiez qu’il n’a pas été oublié.
        </p>
      ) : null}

      {confirmDiscard ? (
        <div className="sui-timer__confirm" role="alertdialog" aria-label="Abandonner la session">
          <p>
            Abandonner cette session ? <strong>{formatElapsed(elapsedSeconds)}</strong> ne seront pas enregistrées.
          </p>
          <div className="sui-timer__confirm-actions">
            <button type="button" className="sui-btn" onClick={() => setConfirmDiscard(false)} disabled={saving}>
              Garder
            </button>
            <button
              type="button"
              className="sui-btn sui-timer__danger"
              disabled={saving}
              onClick={async () => {
                await discard();
                setConfirmDiscard(false);
              }}
            >
              <Trash2 size={16} strokeWidth={1.9} aria-hidden="true" />
              Abandonner
            </button>
          </div>
        </div>
      ) : (
        <div className="sui-timer__controls">
          <button
            type="button"
            className={`sui-timer__round${paused ? " is-resume" : ""}`}
            onClick={() => (paused ? resume() : pause())}
            disabled={saving}
            aria-label={paused ? "Reprendre le minuteur" : "Mettre en pause"}
            title={paused ? "Reprendre" : "Pause"}
          >
            {paused ? <Play size={20} strokeWidth={2} aria-hidden="true" /> : <Pause size={20} strokeWidth={2} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="sui-btn sui-btn--dark sui-timer__stop"
            onClick={() => stop({ description: note })}
            disabled={saving}
          >
            <Square size={15} strokeWidth={2.4} aria-hidden="true" />
            {saving ? "Enregistrement…" : "Terminer et enregistrer"}
          </button>
          <button
            type="button"
            className="sui-timer__ghost"
            onClick={() => setConfirmDiscard(true)}
            disabled={saving}
            aria-label="Abandonner sans enregistrer"
            title="Abandonner sans enregistrer"
          >
            <Trash2 size={17} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      )}

      {error ? (
        <p className="sui-timer__notice is-error" role="alert">
          <CircleAlert size={15} strokeWidth={1.9} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" className="sui-timer__link" onClick={clearError}>
            OK
          </button>
        </p>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* À l'arrêt                                                                   */
/* -------------------------------------------------------------------------- */

function IdleView({ variant, headingId, onClose }) {
  const { start, startFree, saving, error, clearError, lastResult, clearResult, summary } = useTimer();
  const entries = (summary?.entries ?? []).slice(0, variant === "card" ? 4 : 3);

  return (
    <>
      <div className="sui-timer__head">
        <h2 id={headingId} className="sui-timer__title">
          <span className="sui-timer__title-icon" aria-hidden="true">
            <Clock3 size={16} strokeWidth={2} />
          </span>
          Minuteur
        </h2>
        <TodayTotal />
        <CloseButton onClose={onClose} />
      </div>

      {lastResult ? (
        <div className={`sui-timer__result${lastResult.kind === "discarded" ? " is-discarded" : ""}`} role="status">
          <span className="sui-timer__result-icon" aria-hidden="true">
            {lastResult.kind === "discarded" ? <Trash2 size={15} strokeWidth={2} /> : <Check size={15} strokeWidth={2.4} />}
          </span>
          <span className="sui-timer__result-copy">
            {lastResult.kind === "discarded" ? (
              <>Session abandonnée — rien n’a été enregistré.</>
            ) : (
              <>
                <strong>{formatMinutes(lastResult.savedMinutes)}</strong> enregistrées sur « {lastResult.title} ».
                {lastResult.overflowMinutes > 0 ? ` Plafond de 24 h atteint : corrigez ${lastResult.overflowMinutes} min à la main.` : ""}
              </>
            )}
          </span>
          {lastResult.kind === "saved" ? (
            <Link href="/espace-personnel/temps" className="sui-timer__link">
              Mon temps
            </Link>
          ) : null}
          <button type="button" className="sui-timer__result-close" aria-label="Masquer ce message" onClick={clearResult}>
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <TaskPicker
        compact={variant !== "card"}
        onPick={(task) => start(task)}
        footer={
          <button type="button" className="sui-timer__quick" onClick={() => startFree()} disabled={saving}>
            <Zap size={15} strokeWidth={2} aria-hidden="true" />
            Démarrer sans tâche
            <span>vous choisirez la tâche en cours de route</span>
          </button>
        }
      />

      {entries.length ? (
        <div className="sui-timer__log">
          <p className="sui-timer__label">Saisi aujourd’hui</p>
          <ul>
            {entries.map((entry) => (
              <li key={entry.id}>
                <span className="sui-timer__log-title">{entry.task?.title ?? entry.description ?? "Temps sans tâche"}</span>
                <span className="sui-timer__log-minutes">{formatMinutes(entry.minutes)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p className="sui-timer__notice is-error" role="alert">
          <CircleAlert size={15} strokeWidth={1.9} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" className="sui-timer__link" onClick={clearError}>
            OK
          </button>
        </p>
      ) : null}
    </>
  );
}
