"use client";

/*
 * Objectifs personnels : anneau d'avancement, carte, boîte d'édition.
 *
 * Un objectif est un but et le groupe de tâches qui y mène. Son avancement
 * n'est jamais saisi : il se déduit des tâches (une tâche annulée ne compte ni
 * pour ni contre), et la carte le montre d'un coup d'œil.
 */

import { useState } from "react";
import { CalendarClock, CircleAlert, PartyPopper, Target } from "lucide-react";
import { messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { GOAL_TONES, GOAL_TONE_LABEL, goalCountdown, goalTone } from "@/lib/goals.mjs";
import Dialog from "@/components/softui/Dialog";
import { Button } from "@/components/softui/primitives";

export function GoalRing({ percent = 0, tone = "blue", size = 48, stroke = 5, label = true }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.min(100, Math.max(0, percent)) / 100;
  return (
    <span className="sui-goalring" style={{ "--ring-size": `${size}px`, "--tone-fill": `var(--fill-${goalTone(tone)})` }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" focusable="false">
        <circle className="sui-goalring__track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
        <circle
          className="sui-goalring__arc"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {label ? <span className="sui-goalring__value">{Math.round(percent)}%</span> : null}
    </span>
  );
}

export function GoalCountdown({ targetDate, now, achieved = false }) {
  const countdown = goalCountdown(targetDate, now);
  if (!countdown) return null;
  return (
    <span className={`sui-goal__due${achieved ? "" : ` is-${countdown.tone}`}`}>
      <CalendarClock size={12} strokeWidth={2} aria-hidden="true" />
      {countdown.label}
    </span>
  );
}

/** Carte d'objectif : bouton bascule du filtre « tâches de cet objectif ». */
export function GoalCard({ goal, progress, selected = false, onSelect, now }) {
  const tone = goalTone(goal.color);
  const achieved = goal.status === "ACHIEVED";
  const countable = progress.total - progress.cancelled;
  return (
    <button
      type="button"
      className={`sui-goal${selected ? " is-selected" : ""}${achieved ? " is-achieved" : ""}`}
      style={{ "--tone-bg": `var(--${tone})`, "--tone-fill": `var(--fill-${tone})` }}
      aria-pressed={selected}
      // Ancien objectif « atteint » sans tâche terminée : on n'invente pas un
      // 100 % (avant correction l'anneau était forcé), on explique. Les données
      // historiques ne sont pas réécrites : le détail propose de rouvrir.
      title={goal.needsReopen ? "Objectif déclaré atteint sans tâche terminée : rouvrez-le pour le remettre à jour." : undefined}
      onClick={onSelect}
    >
      <GoalRing percent={progress.percent} tone={tone} />
      <span className="sui-goal__copy">
        <span className="sui-goal__title">{goal.title}</span>
        <span className="sui-goal__meta">
          {countable > 0 ? `${progress.done}/${countable} tâche${countable > 1 ? "s" : ""}` : "Aucune tâche"}
          {achieved ? (
            <span className="sui-goal__badge">
              <PartyPopper size={12} strokeWidth={2} aria-hidden="true" /> Atteint
            </span>
          ) : null}
        </span>
      </span>
      <GoalCountdown targetDate={goal.targetDate} now={now} achieved={achieved} />
    </button>
  );
}

/** Création ou modification d'un objectif. */
export function GoalDialog({ goal = null, onClose, onSaved }) {
  const { request } = useAuth();
  const [form, setForm] = useState({
    title: goal?.title ?? "",
    description: goal?.description ?? "",
    targetDate: goal?.targetDate ? String(goal.targetDate).slice(0, 10) : "",
    color: goalTone(goal?.color),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    const title = form.title.trim();
    if (title.length < 2) {
      setError("Donnez un nom à votre objectif (2 caractères au moins).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        title,
        description: form.description.trim() || (goal ? null : undefined),
        targetDate: form.targetDate || (goal ? null : undefined),
        color: form.color,
      };
      const { data } = await request(goal ? `/me/goals/${goal.id}` : "/me/goals", {
        method: goal ? "PATCH" : "POST",
        body,
      });
      await onSaved?.(data);
    } catch (caught) {
      setError(messageOf(caught));
      setBusy(false);
    }
  }

  return (
    <Dialog
      as="form"
      onSubmit={submit}
      title={goal ? "Modifier l’objectif" : "Nouvel objectif"}
      eyebrow="Mes objectifs"
      icon={Target}
      tone={form.color}
      description="Un objectif regroupe les tâches qui y mènent : cochez-les, la progression se calcule toute seule."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="dark" disabled={busy}>
            {busy ? "Enregistrement…" : goal ? "Enregistrer" : "Créer l’objectif"}
          </Button>
        </>
      }
    >
      <div className="sui-form">
        {error ? (
          <p className="sui-form__error" role="alert">
            <CircleAlert size={16} strokeWidth={1.9} aria-hidden="true" />
            {error}
          </p>
        ) : null}
        <label className="sui-field">
          <span className="sui-field__label">Objectif</span>
          <input
            className="sui-input"
            data-autofocus
            maxLength={160}
            required
            value={form.title}
            placeholder="Ex. Livrer la boutique Maison Vasseur"
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </label>
        <label className="sui-field">
          <span className="sui-field__label">Pourquoi, ou à quoi on reconnaît la réussite</span>
          <textarea
            className="sui-input"
            rows={3}
            maxLength={2000}
            value={form.description}
            placeholder="Facultatif"
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </label>
        <div className="sui-field-row">
          <label className="sui-field">
            <span className="sui-field__label">Date cible</span>
            <input
              type="date"
              className="sui-input"
              value={form.targetDate}
              onChange={(event) => setForm({ ...form, targetDate: event.target.value })}
            />
          </label>
          <fieldset className="sui-fieldset">
            <legend className="sui-field__label">Couleur</legend>
            <div className="sui-goal-tones" role="radiogroup" aria-label="Couleur de l’objectif">
              {GOAL_TONES.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  role="radio"
                  aria-checked={form.color === tone}
                  aria-label={GOAL_TONE_LABEL[tone]}
                  title={GOAL_TONE_LABEL[tone]}
                  className="sui-goal-tone"
                  style={{ "--tone-bg": `var(--${tone})`, "--tone-fill": `var(--fill-${tone})` }}
                  onClick={() => setForm({ ...form, color: tone })}
                />
              ))}
            </div>
          </fieldset>
        </div>
      </div>
    </Dialog>
  );
}
