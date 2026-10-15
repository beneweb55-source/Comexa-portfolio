"use client";

/*
 * Composants partagés des espaces. Ils s'appuient sur les classes `cx-*` de la
 * charte (src/styles/comexa.components.css). Les noms exportés sont conservés
 * pour les pages existantes.
 */

import { useEffect, useRef } from "react";

export function Notice({ tone = "error", children }) {
  const isAlert = tone === "error" || tone === "warning";
  return (
    <div role={isAlert ? "alert" : "status"} className={`cx-alert cx-alert--${tone}`}>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Panneau de section. `title` est un H4 (24 px) selon l'échelle de la charte. */
export function Card({ title, action, children, id, variant }) {
  const className = variant === "ink" ? "cx-card cx-card--ink" : "cx-panel";
  return (
    <section id={id} className={className}>
      {title ? (
        <div className="cx-panel__head">
          <h4>{title}</h4>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Badge({ tone = "neutral", children }) {
  return <span className={`cx-badge cx-badge--${tone}`}>{children}</span>;
}

export function ProgressBar({ value }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="flex items-center gap-3">
      <div className="cx-progress flex-1" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={safe}>
        <div className="cx-progress__bar" style={{ width: `${safe}%` }} />
      </div>
      <span className="w-12 text-right text-[13px] font-medium text-[var(--comexa-ink)]">{safe} %</span>
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="cx-empty">
      {title ? <span className="cx-empty__title">{title}</span> : null}
      <span>{children}</span>
    </div>
  );
}

/** Contrôle de pagination commun aux listes renvoyées par l'API. */
export function Pagination({ meta, onPageChange, loading = false, label = "Pagination des résultats" }) {
  if (!meta || meta.totalPages <= 1) return null;

  return (
    <nav className="mt-5 flex flex-wrap items-center justify-between gap-3" aria-label={label}>
      <p className="text-[12.5px] text-[var(--comexa-ink-muted)]" aria-live="polite">
        Page {meta.page} sur {meta.totalPages} · {meta.total} résultats
      </p>
      <div className="flex gap-2">
        <button type="button" className={secondaryButton} onClick={() => onPageChange(meta.page - 1)} disabled={loading || meta.page <= 1}>
          Précédent
        </button>
        <button type="button" className={secondaryButton} onClick={() => onPageChange(meta.page + 1)} disabled={loading || meta.page >= meta.totalPages}>
          Suivant
        </button>
      </div>
    </nav>
  );
}

/** Ligne de formulaire : libellé, aide et erreur, au même rythme partout. */
export function Field({ id, label, hint, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="cx-label">
        {label}
      </label>
      {children}
      {error ? <span className="cx-field-error">{error}</span> : hint ? <span className="cx-hint">{hint}</span> : null}
    </div>
  );
}

export const inputClass = "cx-input";
export const selectClass = "cx-select";
export const textareaClass = "cx-textarea";
export const primaryButton = "cx-btn cx-btn--primary";
export const accentButton = "cx-btn cx-btn--accent";
export const secondaryButton = "cx-btn cx-btn--outline cx-btn--sm";

/**
 * Confirmation d'une action sensible (suspendre, valider). Utilise l'élément
 * `<dialog>` natif : focus piégé, Échap, et `aria-modal` gérés par le navigateur.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onCancel, busy, tone = "accent" }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="cx-dialog" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel?.(); }} aria-labelledby="cx-dialog-title">
      <h4 id="cx-dialog-title">{title}</h4>
      <div className="mt-3 text-[15px] leading-relaxed">{children}</div>
      <div className="cx-dialog__actions">
        <button type="button" className="cx-btn cx-btn--ghost" onClick={onCancel} disabled={busy}>
          Annuler
        </button>
        <button type="button" className={tone === "danger" ? "cx-btn cx-btn--danger" : "cx-btn cx-btn--accent"} onClick={onConfirm} disabled={busy}>
          {busy ? "En cours…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/** Étapes d'une commande, à partir du statut serveur. */
export function OrderSteps({ steps }) {
  if (!steps) {
    return <Notice tone="warning">Cette commande a été annulée.</Notice>;
  }
  return (
    <ol className="cx-steps" style={{ "--steps": steps.length }} aria-label="Étapes de la commande">
      {steps.map((step) => (
        <li key={step.key} className={`cx-step cx-step--${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
          <span className="cx-step__dot" aria-hidden="true" />
          <span className="cx-step__label">{step.label}</span>
          <span className="cx-step__state">
            {step.state === "done" ? "Fait" : step.state === "current" ? "En cours" : "À venir"}
          </span>
        </li>
      ))}
    </ol>
  );
}
