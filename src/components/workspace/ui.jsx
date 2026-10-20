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
import { createPortal } from "react-dom";
import Dialog from "@/components/softui/Dialog";
import { toneBackground } from "@/components/softui/primitives";

/*
 * Composants de base partagés entre l'espace client, l'espace équipe et
 * Comexa Space.
 *
 * Depuis la refonte, ils sont habillés par le design system « soft UI pastel
 * dans une coque noire » (`src/components/softui` + `softui.components.css`) :
 * MEME aesthetic que le tableau de bord de Comexa Space — panneaux blancs très
 * arrondis, pastels, un seul accent noir pour les actions principales.
 *
 * Les noms d'export et les props sont inchangés : les pages qui importent
 * `Card`, `Notice`, `Field`… n'ont rien à modifier.
 */

/* --- Classes utilitaires -------------------------------------------------- */
/* Un seul accent noir (le shell) pour l'action principale ; le reste est du
   pastel ou du gris clair. Voir la charte en tête de `softui.tokens.css`. */
export const primaryButton = "sui-btn sui-btn--dark";
export const accentButton = "sui-btn sui-btn--dark";
export const secondaryButton = "sui-btn";
export const ghostButton = "sui-btn sui-btn--ghost";
export const dangerButton = "sui-btn sui-btn--danger";
export const inputClass = "sui-input";
export const selectClass = "sui-input";
export const textareaClass = "sui-input";
export const cardClass = "sui-panel";

/* Tonalités des pilules : les clés métier des pages (`info`, `success`…)
   pointent vers les pastels de la charte. */
const BADGE_TONE = {
  neutral: "plain",
  info: "blue",
  success: "green",
  warning: "yellow",
  danger: "pink",
};

const ALERT_TONE = {
  error: "pink",
  success: "green",
  warning: "yellow",
  info: "blue",
};

const ALERT_ICON = {
  error: CircleAlert,
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
};

/**
 * Panneau de contenu — la « carte » du design system : surface blanche, coins
 * 24 px, ombre douce, en-tée séparée du corps.
 */
export function Card({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={`sui-panel ${className}`.trim()}>
      {title || action ? (
        <div className="sui-section__head">
          <div className="min-w-0">
            {title ? <h3 className="sui-section__title">{title}</h3> : null}
            {subtitle ? <p className="sui-panel__sub">{subtitle}</p> : null}
          </div>
          {action ? <div className="sui-card__actions">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Pilule de statut : texte foncé sur pastel, jamais l'inverse. */
export function Badge({ tone = "neutral", children }) {
  const flat = tone === "neutral";
  return (
    <span
      className={`sui-status${flat ? " sui-status--plain" : ""}`}
      style={flat ? undefined : { "--tone-bg": toneBackground(BADGE_TONE[tone] ?? "plain") }}
    >
      {children}
    </span>
  );
}

/** Barre de progression : piste grise, remplissage vert doux. */
export function ProgressBar({ value = 0, ratio }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="sui-progress" role="progressbar" aria-valuenow={safe} aria-valuemin={0} aria-valuemax={100}>
      <span className="sui-progress__track" aria-hidden="true">
        <span className="sui-progress__bar" style={{ width: `${safe}%` }} />
      </span>
      {ratio !== undefined && ratio !== null ? <span className="sui-progress__value">{ratio}</span> : null}
    </div>
  );
}

/** État vide : icône dans un cercle pastel, phrase explicative, action facultative. */
export function Empty({ children, icon: CustomIcon, action }) {
  const IconComponent = CustomIcon ?? Inbox;
  return (
    <div className="sui-empty">
      <span className="sui-empty__icon" aria-hidden="true">
        <IconComponent size={18} strokeWidth={1.8} />
      </span>
      <div className="sui-empty__copy">{children}</div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** Message d'erreur ou de confirmation, en pastel (jamais de rouge saturé). */
export function Notice({ tone = "error", children }) {
  const IconComponent = ALERT_ICON[tone] ?? CircleAlert;
  return (
    <div role={tone === "error" ? "alert" : "status"} className="sui-note" style={{ "--tone-bg": toneBackground(ALERT_TONE[tone] ?? "pink") }}>
      <IconComponent size={16} strokeWidth={1.9} aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Skeleton({ className = "h-5 w-full" }) {
  return <div className={`sui-skeleton ${className}`.trim()} aria-hidden="true" />;
}

export function SkeletonList({ rows = 3 }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Chargement en cours">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="sui-skeleton-row">
          <div className="flex flex-1 flex-col gap-2">
            <div className="sui-skeleton h-4 w-48" />
            <div className="sui-skeleton h-3 w-72 max-w-full" />
          </div>
          <div className="sui-skeleton h-7 w-20 rounded-full" />
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
      className="sui-pagination"
    >
      <span className="sui-pagination__count">
        Page <strong>{page}</strong> sur <strong>{totalPages}</strong>
        {Number.isFinite(total) ? ` · ${total} élément${total > 1 ? "s" : ""}` : ""}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="sui-btn sui-btn--sm"
          disabled={loading || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" />
          Précédent
        </button>
        <button
          type="button"
          className="sui-btn sui-btn--sm"
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
    <div className="sui-field">
      <label htmlFor={id} className="sui-field__label">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={hintId} className="sui-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="sui-field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Tiroir latéral (feuille sur ordinateur, bandeau bas sur mobile).
 * Rendu dans un portail pour échapper aux débordements de la coque.
 */
export function SideSheet({ open, title, subtitle, onClose, footer, children, widthClass = "" }) {
  const titleId = useId();

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

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="sui-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`sui-drawer sui-drawer--right ${widthClass}`.trim()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sui-drawer__head">
          <div className="min-w-0">
            <h3 id={titleId} className="sui-drawer__title">
              {title}
            </h3>
            {subtitle ? <p className="sui-panel__sub">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={() => onClose?.()} className="sui-iconbtn sui-iconbtn--ghost" aria-label="Fermer le panneau">
            <X size={19} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="sui-drawer__body">{children}</div>
        {footer ? <div className="sui-dialog__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Fenêtre de confirmation accessible (rôle dialog, Échap pour annuler).
 * Réutilise la boîte de dialogue du design system : voile sombre, carte 28 px,
 * focus piégé et focus rendu à l'élément d'origine.
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
  if (!open) return null;
  return (
    <Dialog
      title={title}
      tone={tone === "danger" ? "pink" : "blue"}
      onClose={() => !busy && onCancel?.()}
      footer={
        <>
          <button type="button" className="sui-btn" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === "danger" ? "sui-btn sui-btn--danger" : "sui-btn sui-btn--dark"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "En cours…" : confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Dialog>
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
    <ol className="sui-steps" aria-label="Avancement de la commande">
      {ORDER_FLOW.map((step, index) => {
        const done = index <= current;
        return (
          <li key={step.key} className={`sui-step${done ? " sui-step--done" : ""}`}>
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}
