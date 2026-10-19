"use client";

/*
 * Boîte de dialogue soft UI (carte blanche 28 px sur voile sombre).
 *
 * Accessibilité : `role="dialog"`, `aria-modal`, titre relié, focus piégé
 * (Tab / Maj+Tab), Échap pour fermer, focus rendu à l'élément d'origine, défilement
 * de la page bloqué pendant l'ouverture. Rendue dans un portail pour échapper
 * au `overflow: hidden` de la coque.
 *
 * Le comportement clavier et le focus vivent dans `useDialogBehavior`, partagé
 * avec le lecteur de document : c'est là que se règle le cas des volets empilés.
 */

import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import useDialogBehavior from "./useDialogBehavior";

export default function Dialog({ title, eyebrow, description, icon: Icon, iconNode, tone = "blue", onClose, children, footer, size = "md", as = "div", onSubmit }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);

  const portalReady = typeof document !== "undefined";
  useDialogBehavior({ panelRef, onClose, enabled: portalReady });

  if (!portalReady) return null;

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
