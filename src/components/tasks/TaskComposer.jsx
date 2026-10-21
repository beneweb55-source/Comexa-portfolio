"use client";

/*
 * Ajout rapide d'une tâche personnelle : un titre et Entrée suffisent.
 *
 * Les options utiles sont à portée de main sans alourdir la saisie : objectif
 * (pré-rempli avec l'objectif ouvert dans la liste), échéance en un clic
 * (aujourd'hui, demain) ou au calendrier, priorité et estimation.
 *
 * Ancre `#nouvelle-tache` : le raccourci « Nouvelle tâche personnelle » du dock
 * y mène et place le curseur dans le champ.
 */

import { useEffect, useRef, useState } from "react";
import { CalendarDays, CircleAlert, Clock3, Flag, Plus, Target } from "lucide-react";
import { messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { localDay } from "@/lib/task-status.mjs";

const PRIORITY_LABEL = { LOW: "Basse", NORMAL: "Normale", HIGH: "Haute", URGENT: "Urgente" };
const ESTIMATES = [15, 30, 60, 120, 240];

function shiftDay(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDay(date);
}

export default function TaskComposer({ goals = [], defaultGoalId = "", onCreated }) {
  const { request } = useAuth();
  const inputRef = useRef(null);
  const [title, setTitle] = useState("");
  const [goalId, setGoalId] = useState(defaultGoalId);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [estimate, setEstimate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lastGoal, setLastGoal] = useState(defaultGoalId);

  // L'objectif ouvert dans la liste devient l'objectif par défaut.
  if (defaultGoalId !== lastGoal) {
    setLastGoal(defaultGoalId);
    setGoalId(defaultGoalId);
  }

  useEffect(() => {
    function focusFromHash() {
      if (window.location.hash === "#nouvelle-tache") {
        inputRef.current?.focus();
        inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    focusFromHash();
    window.addEventListener("hashchange", focusFromHash);
    return () => window.removeEventListener("hashchange", focusFromHash);
  }, []);

  const today = shiftDay(0);
  const tomorrow = shiftDay(1);

  async function submit(event) {
    event.preventDefault();
    const value = title.trim();
    if (value.length < 2) {
      setError("Le titre doit contenir au moins 2 caractères.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request("/me/tasks", {
        method: "POST",
        body: {
          title: value,
          priority,
          ...(dueDate ? { dueDate: new Date(`${dueDate}T12:00:00Z`).toISOString() } : {}),
          ...(estimate ? { estimateMinutes: Number(estimate) } : {}),
          ...(goalId ? { goalId } : {}),
        },
      });
      setTitle("");
      setDueDate("");
      setPriority("NORMAL");
      setEstimate("");
      await onCreated?.();
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
          placeholder="Nouvelle tâche personnelle…"
          onChange={(event) => {
            setTitle(event.target.value);
            if (error) setError(null);
          }}
        />
        <button
          type="submit"
          className="sui-btn sui-btn--dark sui-composer__submit"
          disabled={busy || title.trim().length < 2}
        >
          {busy ? "Ajout…" : "Ajouter"}
        </button>
      </div>

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

        <label className="sui-composer__option">
          <Clock3 size={14} strokeWidth={2} aria-hidden="true" />
          <span className="sr-only">Estimation</span>
          <select value={estimate} onChange={(event) => setEstimate(event.target.value)}>
            <option value="">Sans estimation</option>
            {ESTIMATES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="sui-composer__error" role="alert">
          <CircleAlert size={15} strokeWidth={1.9} aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </form>
  );
}
