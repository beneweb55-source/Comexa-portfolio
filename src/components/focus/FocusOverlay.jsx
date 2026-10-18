"use client";

/*
 * MODE CONCENTRATION — l'écran.
 *
 * Trois états, un seul composant :
 *   - RÉGLAGE : la durée, la tâche, la note, « ne pas déranger ». On ne
 *     démarre rien avant le geste explicite ;
 *   - EN COURS : le décompte, la tâche, la note qui s'enregistre au fil de
 *     l'eau, et trois gestes seulement — pause, terminer, abandonner ;
 *   - BILAN : ce qui vient d'être enregistré, et la porte vers la feuille de
 *     temps.
 *
 * POURQUOI PLEIN ÉCRAN. Le mode concentration se jugera à une chose : est-ce
 * qu'on voit autre chose que sa tâche et son temps ? Un panneau latéral ne
 * trompe personne. L'écran est donc volontairement nu — pas de navigation, pas
 * de raccourcis, une seule action à la fois.
 *
 * LE TEMPS AFFICHÉ EST CELUI DU MINUTEUR. Le décompte se calcule depuis
 * `elapsedSeconds` ; rien n'est recompté ici. Si deux onglets sont ouverts, les
 * deux affichent la même chose.
 */

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import {
  BellOff,
  BellRing,
  Check,
  CircleAlert,
  Clock3,
  Flame,
  Pause,
  Play,
  Square,
  Target,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import TimerDial from "@/components/timer/TimerDial";
import TaskPicker from "@/components/timer/TaskPicker";
import { formatElapsed } from "@/lib/timer-format.mjs";
import { FOCUS_PRESETS, formatFocus, formatPlanned } from "@/lib/focus-store.mjs";
import { useFocus } from "./FocusProvider";

export default function FocusOverlay() {
  const focus = useFocus();
  if (!focus.open) return null;

  /* L'ambiance suit l'etat : le fond n'est pas decore, il informe. Setup reste
     neutre, la session en cours respire le bleu de l'app, la pause passe a
     l'ambre, le depassement au rose, le bilan au vert. Tout le reste (couleurs
     du cadran, liseres) se lit sur ce seul attribut. */
  const phase = !focus.session
    ? "setup"
    : !focus.running
      ? "paused"
      : focus.over
        ? "over"
        : "running";

  /* Le REGLAGE est plus long que les autres etats : sur un grand ecran, il
     se lit en deux colonnes (duree a gauche, tache a droite), et le geste
     principal reste colle en bas. Sur un telephone, il reste une colonne et
     defile — mais « Demarrer » ne bouge pas. */
  const setup = !focus.justFinished && !focus.session;
  const running = Boolean(focus.session) && !focus.justFinished;

  return (
    <div
      className="sui-focus"
      data-phase={focus.justFinished ? "done" : phase}
      role="dialog"
      aria-modal="true"
      aria-label="Mode concentration"
    >
      <div
        className={`sui-focus__inner${setup ? " sui-focus__inner--setup" : ""}${
          running ? " sui-focus__inner--running" : ""
        }`}
      >
        {focus.justFinished ? (
          <FinishedView />
        ) : focus.session ? (
          <RunningView />
        ) : (
          <SetupView />
        )}
      </div>
    </div>
  );
}

/* Le cadran se dimensionne sur la fenetre, pas sur un 320 fixe : sur un
   ordinateur portable en height 720, un cadran de 320 poussait les commandes
   hors ecran — le geste « terminer » devenait une chasse au scroll. */
function useDialSize() {
  const [size, setSize] = useState(320);
  useEffect(() => {
    function measure() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Le cadran doit laisser la place au titre, a la note et aux commandes :
      // sur un ecran de 720 px de haut, un cadran de 360 px poussait les
      // statistiques hors du champ. On reserve donc la hauteur du reste de
      // l'ecran, et le cadran suit.
      setSize(Math.round(Math.max(216, Math.min(340, Math.min(vw, vh) - 420, vw - 88))));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return size;
}

/* -------------------------------------------------------------------------- */
/* Réglage                                                                    */
/* -------------------------------------------------------------------------- */

function SetupView() {
  const focus = useFocus();
  const [minutes, setMinutes] = useState(focus.plannedMinutes);
  const [custom, setCustom] = useState("");
  const [task, setTask] = useState(null);
  const [note, setNote] = useState("");
  const [dnd, setDnd] = useState(true);
  const noteId = useId();
  const customId = useId();

  const planned = custom.trim() ? Number(custom) : minutes;

  async function begin() {
    const ok = await focus.startSession({ task, plannedMinutes: planned, note, dnd });
    if (ok) setCustom("");
  }

  return (
    <>
      {/* L'EN-TETE DU REGLAGE est une colonne : l'eyebrow, le titre et la
          phrase se lisent de haut en bas, dans cet ordre. En rangee, le titre
          se retrouvait serre entre l'eyebrow et la phrase — trois colonnes
          qui se disputaient la meme ligne. La croix, elle, reste en haut a
          droite, a sa place sur tous les etats. */}
      <header className="sui-focus__head sui-focus__head--intro">
        <span className="sui-focus__eyebrow">
          <Target size={14} strokeWidth={2.2} aria-hidden="true" />
          Mode concentration
        </span>
        <h1 className="sui-focus__title">Combien de temps, sur quoi&nbsp;?</h1>
        <p className="sui-focus__lead">
          Une session démarre le minuteur et enregistre le temps à la fin. Rien ne part dans la feuille de temps si vous
          abandonnez.
        </p>
        <button type="button" className="sui-focus__close" onClick={focus.closeFocus} aria-label="Fermer le mode concentration">
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      <section className="sui-focus__block" aria-labelledby="duree">
        <h2 id="duree" className="sui-focus__label">
          Durée du bloc
        </h2>
        <div className="sui-focus__presets">
          {FOCUS_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`sui-focus__preset${!custom.trim() && Number(minutes) === preset ? " is-active" : ""}`}
              aria-pressed={!custom.trim() && Number(minutes) === preset}
              onClick={() => {
                setMinutes(preset);
                setCustom("");
              }}
            >
              <strong>{preset}</strong>
              <span>minutes</span>
            </button>
          ))}
        </div>
        <div className="sui-focus__custom">
          <label htmlFor={customId} className="sui-focus__label">
            Ou une autre durée (5 à 240 minutes)
          </label>
          <input
            id={customId}
            className="sui-input"
            type="number"
            min={5}
            max={240}
            step={5}
            inputMode="numeric"
            placeholder="Ex. 35"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
        </div>
      </section>

      <section className="sui-focus__block" aria-labelledby="tache">
        <h2 id="tache" className="sui-focus__label">
          La tâche <span className="sui-focus__label-hint">facultative</span>
        </h2>
        {task ? (
          <div className="sui-focus__chosen">
            <span className="sui-focus__chosen-copy">
              <strong>{task.title}</strong>
              {task.project?.name ? <span>{task.project.name}</span> : null}
            </span>
            <button type="button" className="sui-focus__chosen-clear" onClick={() => setTask(null)}>
              Retirer
            </button>
          </div>
        ) : (
          <TaskPicker
            compact
            onPick={setTask}
            footer={
              <p className="sui-focus__note">
                Sans tâche, le temps est enregistré sur votre feuille sans rattachement de projet.
              </p>
            }
          />
        )}
      </section>

      <section className="sui-focus__block">
        <label htmlFor={noteId} className="sui-focus__label">
          Sur quoi travaillez-vous&nbsp;?
        </label>
        <textarea
          id={noteId}
          className="sui-input"
          rows={2}
          maxLength={500}
          placeholder="Ex. Intégration de la page produit, corrections de la recette…"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </section>

      <section className="sui-focus__block">
        <button
          type="button"
          className={`sui-focus__toggle${dnd ? " is-on" : ""}`}
          aria-pressed={dnd}
          onClick={() => setDnd((value) => !value)}
        >
          <span className="sui-focus__toggle-icon" aria-hidden="true">
            {dnd ? <BellOff size={16} strokeWidth={2} /> : <BellRing size={16} strokeWidth={2} />}
          </span>
          <span className="sui-focus__toggle-copy">
            <strong>Ne pas déranger</strong>
            <span>Les alertes entrantes restent silencieuses pendant la session.</span>
          </span>
        </button>
      </section>

      {/* Le geste principal reste colle au bas de l'ecran : le reglage est
          long, et « Demarrer » ne doit jamais se chercher au scroll. */}
      <div className="sui-focus__sticky">
        <button type="button" className="sui-btn sui-btn--dark sui-focus__start" onClick={begin} disabled={focus.saving}>
          <Play size={17} strokeWidth={2.2} aria-hidden="true" />
          Démarrer {formatPlanned(planned)}
        </button>
      </div>

      <footer className="sui-focus__foot">
        <FocusStats />
      </footer>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* En cours                                                                   */
/* -------------------------------------------------------------------------- */

function RunningView() {
  const focus = useFocus();
  const dialSize = useDialSize();
  const noteId = useId();
  const session = focus.session;
  const task = focus.task;
  const paused = focus.timerStatus === "PAUSED";
  const [note, setNote] = useState(session.note ?? "");
  const [savedNote, setSavedNote] = useState(session.note ?? "");
  const [confirmQuit, setConfirmQuit] = useState(false);

  // La note s'enregistre seule, une seconde après la dernière frappe.
  useEffect(() => {
    if (note === savedNote) return undefined;
    const id = window.setTimeout(async () => {
      await focus.saveNote(note.trim() ? note.trim() : null);
      setSavedNote(note);
    }, 900);
    return () => window.clearTimeout(id);
  }, [note, savedNote, focus]);

  const progress = {
    ratio: session.plannedMinutes > 0 ? Math.min(1, focus.elapsed / (session.plannedMinutes * 60)) : 0,
    over: focus.over,
    mode: "estimate",
    label: focus.over ? "Temps dépassé" : `Reste ${formatElapsed(focus.remaining)}`,
  };

  return (
    <>
      <header className="sui-focus__head">
        {/* aria-live : « En pause » / « Concentration » s'annoncent au lecteur
            d'ecran — l'etat change sans que le focus bouge, rien d'autre ne
            le dirait. */}
        <span className={`sui-focus__state${paused ? " is-paused" : " is-running"}`} aria-live="polite">
          <span className="sui-focus__pulse" aria-hidden="true" />
          {paused ? "En pause" : "Concentration"}
        </span>
        {focus.dnd ? (
          <span className="sui-focus__dnd">
            <BellOff size={13} strokeWidth={2.2} aria-hidden="true" />
            Ne pas déranger
          </span>
        ) : null}
        <button type="button" className="sui-focus__close" onClick={focus.closeFocus} aria-label="Réduire le mode concentration">
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      <div className="sui-focus__stage">
        <TimerDial
          elapsedSeconds={focus.remaining}
          status={paused ? "PAUSED" : "RUNNING"}
          progress={progress}
          size={dialSize}
          caption={focus.over ? "Temps dépassé" : "Reste"}
        />
      </div>

      <div className="sui-focus__task">
        <p className="sui-focus__task-title">{task?.title ?? session.taskTitle}</p>
        <p className="sui-focus__task-meta">
          {task?.project?.name ?? session.projectName ?? "Sans projet"}
          {" · "}
          bloc de {formatPlanned(session.plannedMinutes)}
          {" · "}
          {formatElapsed(focus.elapsed)} écoulées
        </p>
      </div>

      <div className="sui-focus__block">
        <label htmlFor={noteId} className="sui-focus__label">
          Sur quoi travaillez-vous&nbsp;?
        </label>
        <textarea
          id={noteId}
          className="sui-input"
          rows={2}
          maxLength={500}
          placeholder="Ex. Intégration de la page produit…"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      {focus.error ? (
        <p className="sui-focus__notice is-error" role="alert">
          <CircleAlert size={15} strokeWidth={2} aria-hidden="true" />
          {focus.error}
        </p>
      ) : null}

      {confirmQuit ? (
        <div className="sui-focus__confirm" role="alertdialog" aria-label="Abandonner la session">
          <p>
            Abandonner la session&nbsp;? Les {formatElapsed(focus.elapsed)} écoulées ne seront <strong>pas</strong>{" "}
            enregistrées.
          </p>
          <div className="sui-focus__confirm-actions">
            <button type="button" className="sui-btn" onClick={() => setConfirmQuit(false)}>
              Garder
            </button>
            <button
              type="button"
              className="sui-btn sui-btn--danger"
              disabled={focus.saving}
              onClick={async () => {
                await focus.abandonSession();
                setConfirmQuit(false);
              }}
            >
              <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
              Abandonner
            </button>
          </div>
        </div>
      ) : (
        <div className="sui-focus__controls sui-focus__sticky">
          <button
            type="button"
            className="sui-focus__round"
            onClick={() => (paused ? focus.resume() : focus.pause())}
            disabled={focus.saving}
            aria-label={paused ? "Reprendre la concentration" : "Mettre en pause"}
            title={paused ? "Reprendre" : "Pause"}
          >
            {paused ? <Play size={22} strokeWidth={2} aria-hidden="true" /> : <Pause size={22} strokeWidth={2} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="sui-btn sui-btn--dark sui-focus__finish"
            onClick={focus.finishSession}
            disabled={focus.saving}
          >
            <Square size={15} strokeWidth={2.4} aria-hidden="true" />
            {focus.saving ? "Enregistrement…" : "Terminer et enregistrer"}
          </button>
          <button
            type="button"
            className="sui-focus__ghost"
            onClick={() => setConfirmQuit(true)}
            disabled={focus.saving}
            aria-label="Abandonner sans enregistrer"
            title="Abandonner sans enregistrer"
          >
            <Trash2 size={17} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      )}

      <footer className="sui-focus__foot">
        <FocusStats compact />
      </footer>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Bilan                                                                      */
/* -------------------------------------------------------------------------- */

function FinishedView() {
  const focus = useFocus();
  const entry = focus.justFinished;
  /* UNE SESSION COURTE S'AFFICHE EN SECONDES : « 0 min » pour vingt secondes
     de travail dit le contraire de la verite. Au-dela d'une minute, on
     repasse en minutes ou en heures, comme le reste de l'application. */
  const seconds = Math.max(0, Math.round(entry.focusedSeconds || 0));
  const value = seconds > 0 && seconds < 60 ? `${seconds} s` : formatFocus(seconds);
  return (
    <>
      <header className="sui-focus__head">
        <span className="sui-focus__state is-done">
          <Check size={13} strokeWidth={2.6} aria-hidden="true" />
          Session terminée
        </span>
        <button type="button" className="sui-focus__close" onClick={focus.closeFocus} aria-label="Fermer le bilan">
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      <div className="sui-focus__done">
        <span className="sui-focus__done-icon" aria-hidden="true">
          <Check size={30} strokeWidth={2.4} />
        </span>
        <p className="sui-focus__done-value">{value}</p>
        <p className="sui-focus__done-copy">
          de concentration sur «&nbsp;{entry.taskTitle}&nbsp;»
          {entry.completed ? " — bloc tenu jusqu'au bout." : " — arrêté avant la fin du bloc."}
        </p>
      </div>

      <footer className="sui-focus__foot">
        <Link href="/espace-personnel/temps" className="sui-btn" onClick={focus.closeFocus}>
          <Clock3 size={16} strokeWidth={2} aria-hidden="true" />
          Voir ma feuille de temps
        </Link>
        <button type="button" className="sui-btn sui-btn--dark" onClick={focus.closeFocus}>
          <Target size={16} strokeWidth={2.2} aria-hidden="true" />
          Nouvelle session
        </button>
      </footer>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Statistiques                                                               */
/* -------------------------------------------------------------------------- */

function FocusStats({ compact = false }) {
  const focus = useFocus();
  const stats = focus.stats;

  /* PENDANT LE BLOC, les statistiques tiennent sur UNE LIGNE : en cartes, elles
     prenaient quatre-vingts pixels et repoussaient le bas de l'ecran hors du
     champ sur un portable. En ligne, elles se lisent d'un coup d'oeil et
     l'ecran respire. */
  if (compact) {
    return (
      <p className="sui-focus__stats-line">
        <span>
          <Flame size={13} strokeWidth={2.2} aria-hidden="true" />
          {stats.streak} j de série
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <Clock3 size={13} strokeWidth={2.2} aria-hidden="true" />
          Aujourd&rsquo;hui {formatFocus(stats.todaySeconds)}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <TrendingUp size={13} strokeWidth={2.2} aria-hidden="true" />
          7 jours {formatFocus(stats.weekSeconds)}
        </span>
      </p>
    );
  }

  return (
    <dl className="sui-focus__stats">
      <div>
        <dt>
          <Flame size={13} strokeWidth={2.2} aria-hidden="true" />
          Série
        </dt>
        <dd>{stats.streak} j</dd>
      </div>
      <div>
        <dt>
          <Clock3 size={13} strokeWidth={2.2} aria-hidden="true" />
          Aujourd&rsquo;hui
        </dt>
        <dd>{formatFocus(stats.todaySeconds)}</dd>
      </div>
      <div>
        <dt>
          <TrendingUp size={13} strokeWidth={2.2} aria-hidden="true" />
          7 jours
        </dt>
        <dd>{formatFocus(stats.weekSeconds)}</dd>
      </div>
    </dl>
  );
}
