"use client";

/*
 * Boîte de dialogue soft UI (carte blanche 28 px sur voile sombre).
 *
 * Accessibilité : `role="dialog"`, `aria-modal`, titre relié, focus piégé
 * (Tab / Maj+Tab), Échap pour fermer, focus rendu à l'élément d'origine, défilement
 * de la page bloqué pendant l'ouverture. Rendue dans un portail pour échapper
 * au `overflow: hidden` de la coque.
 */

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Dialog({ title, eyebrow, description, icon: Icon, iconNode, tone = "blue", onClose, children, footer, size = "md", as = "div", onSubmit }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const previous = document.activeElement;
    const focusables = () => Array.from(panel.querySelectorAll(FOCUSABLE));
    const autofocus = panel.querySelector("[data-autofocus]") ?? focusables()[0] ?? panel;
    autofocus.focus();

    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const Panel = as;
  return createPortal(
    <div className="sui-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <Panel
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`sui-dialog sui-dialog--${size}`}
        tabIndex={-1}
        onSubmit={onSubmit}
        noValidate={as === "form" ? true : undefined}
      >
        <div className="sui-dialog__head">
          {Icon || iconNode ? (
            <span className="sui-dialog__icon" style={{ "--tone-bg": `var(--${tone})` }} aria-hidden="true">
              {iconNode ?? <Icon size={20} strokeWidth={1.75} />}
            </span>
          ) : null}
          <div className="sui-dialog__titles">
            {eyebrow ? <p className="sui-dialog__eyebrow">{eyebrow}</p> : null}
            <h2 className="sui-dialog__title" id={titleId}>{title}</h2>
            {description ? <p className="sui-dialog__desc" id={descriptionId}>{description}</p> : null}
          </div>
          <button type="button" className="sui-iconbtn sui-iconbtn--ghost" aria-label="Fermer" onClick={onClose}>
            <X size={19} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="sui-dialog__body">{children}</div>
        {footer ? <div className="sui-dialog__foot">{footer}</div> : null}
      </Panel>
    </div>,
    document.body,
  );
}
