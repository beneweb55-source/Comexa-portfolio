"use client";

/*
 * Ajout rapide d'une tâche personnelle : une phrase et Entrée suffisent.
 *
 * La reconnaissance est DÉTERMINISTE (`parseQuickAddPhrase`) : aucun LLM, aucun
 * appel réseau avant la création. Chaque valeur reconnue est affichée dans une
 * puce et alimente un contrôle visible et modifiable. Les conflits et objectifs
 * ambigus ne sont jamais devinés : ils sont signalés.
 *
 * Les champs envoyés restent exactement ceux du DTO existant `POST /me/tasks` :
 * titre, priorité, échéance (jour), estimation et objectif ACTIF. Aucun statut,
 * projet ou assigné n'est fabriqué côté navigateur.
 *
 * Ancre `#nouvelle-tache` : le raccourci « Nouvelle tâche personnelle » du dock
 * y mène et place le curseur dans le champ.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, CircleAlert, Clock3, Flag, Plus, Target, Zap } from "lucide-react";
import { messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { localDay } from "@/lib/task-status.mjs";
import {
  QUICK_ADD_MAX_ESTIMATE_MINUTES,
  parseQuickAddPhrase,
  personalTaskPayload,
  quickAddFormError,
} from "@/lib/task-quick-add.mjs";

const PRIORITY_LABEL = { LOW: "Basse", NORMAL: "Normale", HIGH: "Haute", URGENT: "Urgente" };
const ESTIMATES = [15, 30, 60, 120, 240];
const EMPTY_RECOGNITION = Object.freeze({ dueDate: null, priority: null, estimateMinutes: null, goalId: null });

function shiftDay(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDay(date);
}

export default function TaskComposer({ goals = [], defaultGoalId = "", onCreated }) {
  const { request } = useAuth();
  const inputRef = useRef(null);
  const recognitionRef = useRef(EMPTY_RECOGNITION);
  const [title, setTitle] = useState("");
  const [goalId, setGoalId] = useState(defaultGoalId);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [estimate, setEstimate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [syncWarning, setSyncWarning] = useState(null);
  const [lastGoal, setLastGoal] = useState(defaultGoalId);
  const [now, setNow] = useState(() => Date.now());
  const helpId = useId();
  const notesId = useId();
  const estimatesId = useId();

  // L'objectif ouvert dans la liste devient l'objectif par défaut.
  if (defaultGoalId !== lastGoal) {
    setLastGoal(defaultGoalId);
    setGoalId(defaultGoalId);
  }

  // Le parseur relit la liste des objectifs quand elle change ; il n'accepte que
  // les objectifs ACTIFS, comme le fait déjà l'API.
  const parsed = useMemo(() => parseQuickAddPhrase(title, { now, goals }), [goals, now, title]);

  useEffect(() => {
    const next = {
      dueDate: parsed.dueDate ?? null,
      priority: parsed.priority ?? null,
      estimateMinutes: parsed.estimateMinutes ?? null,
      goalId: parsed.goalId ?? null,
    };
    const previous = recognitionRef.current;
    // Une correction manuelle n'est pas écrasée à chaque frappe : seule une
    // valeur reconnue qui APPARAÎT, CHANGE ou DISPARAÎT met à jour le contrôle.
    if (next.dueDate !== previous.dueDate) setDueDate(next.dueDate ?? "");
    if (next.priority !== previous.priority) setPriority(next.priority ?? "NORMAL");
    if (next.estimateMinutes !== previous.estimateMinutes) setEstimate(next.estimateMinutes ? String(next.estimateMinutes) : "");
    if (next.goalId !== previous.goalId) setGoalId(next.goalId ?? defaultGoalId);
    recognitionRef.current = next;
  }, [defaultGoalId, parsed]);

  useEffect(() => {
    function focusFromHash() {
      if (window.location.hash === "#nouvelle-tache") {
        inputRef.current?.focus();
        inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    function refreshRelativeDay() {
      setNow(Date.now());
    }
    focusFromHash();
    window.addEventListener("hashchange", focusFromHash);
    window.addEventListener("focus", refreshRelativeDay);
    return () => {
      window.removeEventListener("hashchange", focusFromHash);
      window.removeEventListener("focus", refreshRelativeDay);
    };
  }, []);

  const today = shiftDay(0);
  const tomorrow = shiftDay(1);
  const cleanTitle = parsed.title.trim();
  const notes = [...parsed.warnings, ...parsed.assumptions, ...(syncWarning ? [syncWarning] : [])];

  async function submit(event) {
    event.preventDefault();
    const formError = quickAddFormError({ title: cleanTitle, dueDate, estimateMinutes: estimate });
    if (formError) {
      setError(formError);
      return;
    }
    const payload = personalTaskPayload({ title: cleanTitle, dueDate, priority, estimateMinutes: estimate, goalId });
    setBusy(true);
    setError(null);
    setSuccess(null);
    setSyncWarning(null);
    try {
      await request("/me/tasks", { method: "POST", body: payload });
      setTitle("");
      setDueDate("");
      setPriority("NORMAL");
      setEstimate("");
      setGoalId(defaultGoalId);
      recognitionRef.current = EMPTY_RECOGNITION;
      setSuccess(`Tâche « ${payload.title} » ajoutée.`);
      // La tâche existe déjà : un échec de rechargement ne doit jamais être
      // présenté comme un échec de création.
      try {
        await onCreated?.();
      } catch {
        setSyncWarning("Tâche ajoutée, mais la liste n’a pas pu être actualisée. Rechargez la page.");
      }
      inputRef.current?.focus();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      id="nouvelle-tache"
      className="sui-composer"
      onSubmit={submit}
      aria-label="Ajouter une tâche personnelle"
    >
      <div className="sui-composer__line">
        <span className="sui-composer__plus" aria-hidden="true">
          <Plus size={18} strokeWidth={2.2} />
        </span>
        <label htmlFor="composer-title" className="sr-only">
          Nouvelle tâche personnelle (Entrée pour l’ajouter)
        </label>
        <input
          ref={inputRef}
          id="composer-title"
          className="sui-composer__input"
          maxLength={300}
          value={title}
          placeholder="Réviser le chapitre 3 demain pendant 2 h, priorité haute…"
          aria-describedby={[helpId, notes.length ? notesId : null].filter(Boolean).join(" ") || undefined}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
            setSuccess(null);
            setSyncWarning(null);
          }}
        />
        <button
          type="submit"
          className="sui-btn sui-btn--dark sui-composer__submit"
          disabled={busy || cleanTitle.length < 2}
        >
          {busy ? "Ajout…" : "Ajouter"}
        </button>
      </div>

      <p className="sui-quickadd__help" id={helpId}>
        <Zap size={13} strokeWidth={2} aria-hidden="true" />
        Une phrase suffit. Les valeurs reconnues s’affichent ci-dessus et restent modifiables avant l’ajout.
      </p>

      {parsed.detected.length ? (
        <ul className="sui-quickadd__chips" aria-label="Informations reconnues" role="status">
          {parsed.detected.map((item) => (
            <li key={item.field} className="sui-quickadd__chip" title={`Reconnu depuis « ${item.raw.trim() } »`}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </li>
          ))}
        </ul>
      ) : null}

      {notes.length ? (
        <div className="sui-quickadd__notes" id={notesId} role="status">
          <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
          <ul>
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="sui-composer__options">
        {goals.length ? (
          <label className="sui-composer__option">
            <Target size={14} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Objectif</span>
            <select value={goalId} onChange={(event) => setGoalId(event.target.value)}>
              <option value="">Sans objectif</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="sui-composer__days" role="group" aria-label="Échéance">
          <button type="button" aria-pressed={dueDate === today} onClick={() => setDueDate(dueDate === today ? "" : today)}>
            Aujourd’hui
          </button>
          <button type="button" aria-pressed={dueDate === tomorrow} onClick={() => setDueDate(dueDate === tomorrow ? "" : tomorrow)}>
            Demain
          </button>
          <label className={`sui-composer__option${dueDate && dueDate !== today && dueDate !== tomorrow ? " is-set" : ""}`}>
            <CalendarDays size={14} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Date d’échéance</span>
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
        </div>

        <label className="sui-composer__option">
          <Flag size={14} strokeWidth={2} aria-hidden="true" />
          <span className="sr-only">Priorité</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value)}>
            {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                Priorité {label.toLowerCase()}
              </option>
            ))}
          </select>
        </label>

        <label className="sui-composer__option sui-quickadd__estimate">
          <Clock3 size={14} strokeWidth={2} aria-hidden="true" />
          <span className="sr-only">Estimation en minutes</span>
          <input
            type="number"
            min={1}
            max={QUICK_ADD_MAX_ESTIMATE_MINUTES}
            step={1}
            inputMode="numeric"
            list={estimatesId}
            value={estimate}
            placeholder="—"
            aria-label="Estimation en minutes"
            onChange={(event) => setEstimate(event.target.value)}
          />
          <span aria-hidden="true">min</span>
          <datalist id={estimatesId}>
            {ESTIMATES.map((minutes) => (
              <option key={minutes} value={minutes} label={minutes < 60 ? `${minutes} min` : `${minutes / 60} h`} />
            ))}
          </datalist>
        </label>
      </div>

      {error ? (
        <p className="sui-composer__error" role="alert">
          <CircleAlert size={15} strokeWidth={1.9} aria-hidden="true" />
          {error}
        </p>
      ) : null}
      {success ? <p className="sui-quickadd__success" role="status">{success}</p> : null}
    </form>
  );
}
