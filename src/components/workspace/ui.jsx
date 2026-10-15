"use client";

import { useEffect, useId, useRef } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Inbox,
  Info,
  X,
} from "lucide-react";

/*
 * Composants de base partagés entre l'espace client et l'espace équipe.
 * Adossés aux classes `.cx-*` définies dans `comexa.components.css` (Elevated v2).
 */

export const primaryButton = "cx-btn cx-btn--primary";
export const accentButton = "cx-btn cx-btn--accent";
export const secondaryButton = "cx-btn cx-btn--secondary";
export const ghostButton = "cx-btn cx-btn--ghost";
export const dangerButton = "cx-btn cx-btn--danger";
export const inputClass = "cx-input";
export const selectClass = "cx-select";
export const textareaClass = "cx-textarea";
export const cardClass = "cx-panel";

export function Card({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={`cx-panel ${className}`.trim()}>
      {title || action ? (
        <header className="cx-panel__header">
          <div>
            {title ? <h3 className="cx-panel__title">{title}</h3> : null}
            {subtitle ? <p className="mt-0.5 text-[13px] text-[var(--comexa-ink-muted)]">{subtitle}</p> : null}
          </div>
          {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

const BADGE_CLASS = {
  neutral: "cx-badge",
  info: "cx-badge cx-badge--info",
  success: "cx-badge cx-badge--success",
  warning: "cx-badge cx-badge--warning",
  danger: "cx-badge cx-badge--danger",
};

export function Badge({ tone = "neutral", children }) {
  return <span className={BADGE_CLASS[tone] ?? BADGE_CLASS.neutral}>{children}</span>;
}

export function ProgressBar({ value = 0 }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="cx-progress" role="progressbar" aria-valuenow={safe} aria-valuemin={0} aria-valuemax={100}>
      <div className="cx-progress__bar" style={{ width: `${safe}%` }} />
    </div>
  );
}

export function Empty({ children, icon: CustomIcon, action }) {
  const IconComponent = CustomIcon ?? Inbox;
  return (
    <div className="cx-empty">
      <span
        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--comexa-blue-50)] text-[var(--comexa-accent)] shadow-xs"
        aria-hidden="true"
      >
        <IconComponent size={19} strokeWidth={1.75} />
      </span>
      <div className="max-w-[46ch] text-[14px] leading-relaxed text-[var(--comexa-ink-muted)]">{children}</div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

const ALERT_CLASS = {
  error: "cx-alert cx-alert--error",
  success: "cx-alert cx-alert--success",
  warning: "cx-alert cx-alert--warning",
  info: "cx-alert cx-alert--info",
};

const ALERT_ICON = {
  error: CircleAlert,
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
};

export function Notice({ tone = "error", children }) {
  const IconComponent = ALERT_ICON[tone] ?? CircleAlert;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={ALERT_CLASS[tone] ?? ALERT_CLASS.error}>
      <IconComponent size={18} strokeWidth={1.9} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Skeleton({ className = "h-5 w-full" }) {
  return <div className={`cx-skeleton ${className}`} aria-hidden="true" />;
}

export function SkeletonList({ rows = 3 }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Chargement en cours">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--comexa-border-soft)] bg-white/70 p-4"
        >
          <div className="flex flex-1 flex-col gap-2">
            <div className="cx-skeleton h-4 w-48" />
            <div className="cx-skeleton h-3 w-72 max-w-full" />
          </div>
          <div className="cx-skeleton h-7 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * Contrôle de pagination serveur : n'apparaît que lorsque plusieurs pages existent.
 */
export function Pagination({ meta, onPageChange, loading = false, label = "Pagination" }) {
  if (!meta) return null;
  const page = Number(meta.page) || 1;
  const totalPages = Number(meta.totalPages) || 1;
  const total = Number(meta.total);
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label={label}
      className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--comexa-border-soft)] pt-3 text-[13px] text-[var(--comexa-ink-muted)]"
    >
      <span className="cx-tabular">
        Page <strong className="text-[var(--comexa-ink)]">{page}</strong> sur{" "}
        <strong className="text-[var(--comexa-ink)]">{totalPages}</strong>
        {Number.isFinite(total) ? ` · ${total} élément${total > 1 ? "s" : ""}` : ""}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className={`${secondaryButton} cx-btn--sm`}
          disabled={loading || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" />
          Précédent
        </button>
        <button
          type="button"
          className={`${secondaryButton} cx-btn--sm`}
          disabled={loading || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Suivant
          <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

export function Field({ id, label, hint, error, children }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="cx-field">
      <label htmlFor={id} className="cx-label">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={hintId} className="cx-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="cx-field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Tiroir latéral (Side Sheet sur ordinateur / Bottom Sheet sur mobile)
 * Remplace les modales lourdes et les formulaires qui poussent toute la page.
 */
export function SideSheet({ open, title, subtitle, onClose, footer, children, widthClass = "" }) {
  const titleId = useId();
  const sheetRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="cx-sheet-backdrop" role="presentation" onClick={() => onClose?.()}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`cx-sheet ${widthClass}`.trim()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="cx-sheet__header">
          <div className="min-w-0">
            <h3 id={titleId} className="cx-sheet__title">
              {title}
            </h3>
            {subtitle ? <p className="mt-0.5 text-[13px] text-[var(--comexa-ink-muted)]">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            className="sui-icon-btn !h-9 !w-9 shrink-0"
            aria-label="Fermer le panneau"
          >
            <X size={16} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
        <div className="cx-sheet__body">{children}</div>
        {footer ? <div className="cx-sheet__footer">{footer}</div> : null}
      </div>
    </div>
  );
}

/**
 * Fenêtre de confirmation accessible (rôle dialog, Échap pour annuler).
 */
export function ConfirmDialog({
  open,
  title,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  tone = "accent",
  busy = false,
  onConfirm,
  onCancel,
  children,
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === "Escape" && !busy) onCancel?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="cx-dialog-backdrop" role="presentation" onClick={() => !busy && onCancel?.()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="cx-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId} className="cx-dialog__title">
          {title}
        </h3>
        <div>{children}</div>
        <div className="cx-dialog__actions">
          <button type="button" className={secondaryButton} disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === "danger" ? dangerButton : primaryButton}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "En cours…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const ORDER_FLOW = [
  { key: "ORDERED", label: "Commandée" },
  { key: "IN_PREPARATION", label: "Validée" },
  { key: "IN_PROGRESS", label: "En cours" },
  { key: "COMPLETED", label: "Terminée" },
];

export function OrderSteps({ status }) {
  if (status === "CANCELLED") return <Badge tone="neutral">Commande annulée</Badge>;
  const current = status === "IN_REVIEW" ? 0 : ORDER_FLOW.findIndex((step) => step.key === status);
  return (
    <ol className="cx-steps" aria-label="Avancement de la commande">
      {ORDER_FLOW.map((step, index) => {
        const done = index <= current;
        return (
          <li key={step.key} className={`cx-step ${done ? "cx-step--done" : ""}`}>
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}
