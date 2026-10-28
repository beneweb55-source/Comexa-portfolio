"use client";

/*
 * MENU D'ACTIONS D'UN ÉLÉMENT (« ⋯ ») — renommer, supprimer, et toute option
 * supplémentaire fournie par la page.
 *
 * Le même composant sert aux cartes, aux tableaux et aux listes : projets,
 * clients, devis, factures, commandes, tâches, jalons, prospects, contacts,
 * documents, membres… C'est la règle « fais-le pour tout » du cahier des
 * charges : aucune page ne réimplémente sa suppression ni sa fenêtre de
 * renommage, donc aucune ne peut oublier la permission, la confirmation ou le
 * rafraîchissement de la liste.
 *
 * SÉCURITÉ
 *  - La permission est vérifiée AVANT d'afficher l'entrée : `canRename` et
 *    `canDelete` viennent de `can(user, …)`. Une entrée absente n'est pas une
 *    protection (le serveur garde la sienne), c'est une interface honnête.
 *  - Une suppression demande TOUJOURS confirmation, avec le nom de l'élément.
 *  - Le serveur reste l'arbitre : une erreur (409, 403, 404) est affichée telle
 *    quelle dans la fenêtre, et la liste déjà affichée n'est pas modifiée.
 *
 * ACCESSIBILITÉ
 *  - `aria-haspopup="menu"`, `role="menu"` / `role="menuitem"`, flèches,
 *    Début/Fin, Échap, Tab ferme et rend le focus au déclencheur.
 *  - Le panneau est rendu dans un portail : il n'est jamais rogné par le
 *    `overflow: hidden` d'une carte ou d'un tableau.
 */

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Check, CircleAlert, Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/session";
import { messageOf } from "@/lib/api";
import { WORKSPACE_UPDATED } from "@/lib/workspace-updates.mjs";
import Dialog from "./Dialog";

/* ------------------------------------------------------------------------- */
/* Panneau déroulant                                                          */
/* ------------------------------------------------------------------------- */

function MenuPanel({ items, label, menuId, pos, menuRef, onSelect, onClose }) {
  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Tab") {
      onClose(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const nodes = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') ?? []);
    if (!nodes.length) return;
    event.preventDefault();
    const index = nodes.indexOf(document.activeElement);
    let next = 0;
    if (event.key === "End") next = nodes.length - 1;
    else if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % nodes.length;
    else if (event.key === "ArrowUp") next = index < 0 ? nodes.length - 1 : (index - 1 + nodes.length) % nodes.length;
      nodes[next].focus({ preventScroll: true });
  }

  return (
    <div onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <div className="fixed inset-0 z-[997]" aria-hidden="true" onClick={() => onClose()} />
      <ul
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label={label}
        data-theme="team-glass"
        onKeyDown={onKeyDown}
        style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
        className="sui-record-menu"
      >
        {items.map((item, index) =>
          item.separator ? (
            <li key={`sep-${index}`} role="separator" className="sui-record-menu__sep" />
          ) : (
            <li key={item.key ?? index} role="none">
              {item.href ? (
                <Link
                  href={item.href}
                  role="menuitem"
                  className={`sui-record-menu__item${item.tone === "danger" ? " is-danger" : ""}`}
                  onClick={() => onSelect(item)}
                >
                  <MenuIcon item={item} />
                  <span>{item.label}</span>
                </Link>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className={`sui-record-menu__item${item.tone === "danger" ? " is-danger" : ""}`}
                  disabled={item.disabled}
                  onClick={() => onSelect(item)}
                >
                  <MenuIcon item={item} />
                  <span>{item.label}</span>
                </button>
              )}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function MenuIcon({ item }) {
  const Icon = item.icon;
  if (!Icon) return <span className="sui-record-menu__bullet" aria-hidden="true" />;
  return <Icon size={16} strokeWidth={1.9} aria-hidden="true" />;
}

/**
 * Déclencheur + panneau. Exporté pour les rares pages qui veulent un menu
 * entièrement sur mesure sans passer par les fenêtres standard.
 */
export function ActionMenu({ items = [], label = "Actions", size = "sm", align = "end", className = "", icon: Icon = MoreHorizontal, trigger }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const ready = items.filter(Boolean);

  const close = useCallback((restore = true) => {
    setOpen(false);
    if (restore) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    // Sans preventScroll, le navigateur fait defiler la page pour exposer le
    // premier item ; l'ecouteur de defilement ci-dessous le prenait pour un
    // defilement exterieur et refermait le menu des son ouverture.
    menuRef.current?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
    const dismiss = () => setOpen(false);
    // Un défilement DANS le menu (liste longue) ne doit pas le refermer : on
    // ignore les événements dont la cible est le panneau lui-même.
    const onScroll = (event) => {
      // Un defilement provoque par le focus ou par l'alignement d'un item est
      // un defilement INTERNE au menu, meme si l'evenement cible le document.
      // Le verifier uniquement sur event.target refermait le menu au premier
      // clic dans Chromium.
      if (menuRef.current?.contains(event.target) || menuRef.current?.contains(document.activeElement)) return;
      dismiss();
    };
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function toggle(event) {
    event.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 236;
    const viewportWidth = window.innerWidth || 360;
    const rawLeft = align === "start" ? rect.left : rect.right - width;
    const left = Math.min(Math.max(8, rawLeft), Math.max(8, viewportWidth - width - 8));
    const estimated = Math.min(360, ready.length * 42 + 18);
    const flip = rect.bottom + 8 + estimated > window.innerHeight && rect.top - estimated - 8 > 8;
    const top = flip ? rect.top - estimated - 8 : rect.bottom + 8;
    setPos({ top, left, width, maxHeight: Math.max(160, Math.min(360, window.innerHeight - 24)) });
    setOpen(true);
  }

  if (!ready.length) return null;

  return (
    <>
      {trigger ? (
        <span
          ref={buttonRef}
          role="button"
          tabIndex={0}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={label}
          className={className}
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggle(event);
            }
          }}
        >
          {trigger}
        </span>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          aria-label={label}
          title={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={toggle}
          className={`sui-iconbtn sui-iconbtn--ghost${size === "sm" ? " sui-iconbtn--sm" : ""} ${className}`.trim()}
        >
          <Icon size={size === "sm" ? 17 : 19} strokeWidth={1.9} aria-hidden="true" />
        </button>
      )}
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <MenuPanel
              items={ready}
              label={label}
              menuId={menuId}
              pos={pos}
              menuRef={menuRef}
              onClose={close}
              onSelect={(item) => {
                setOpen(false);
                item.onSelect?.();
              }}
            />,
            document.body,
          )
        : null}
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Messages                                                                   */
/* ------------------------------------------------------------------------- */

function Toast({ message, tone = "success", onClose }) {
  useEffect(() => {
    if (!message) return undefined;
    const id = window.setTimeout(onClose, 4500);
    return () => window.clearTimeout(id);
  }, [message, onClose]);

  if (!message || typeof document === "undefined") return null;
  /* Portail : la notification est rendue dans `document.body`. Sinon, un
     ancêtre transformé (carte animée) la repositionnerait par rapport à la
     carte au lieu de la fenêtre. */
  return createPortal(
    <div className="sui-toast" role="status" aria-live="polite">
      <div className="sui-toast__card">
        <span className="sui-toast__icon" style={{ "--tone-bg": tone === "error" ? "var(--pink)" : "var(--green)" }} aria-hidden="true">
          {tone === "error" ? <CircleAlert size={18} strokeWidth={1.9} /> : <Check size={18} strokeWidth={1.9} />}
        </span>
        <p className="sui-toast__message">{message}</p>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------------- */
/* Composant principal                                                        */
/* ------------------------------------------------------------------------- */

function nounOf(entityLabel) {
  return entityLabel || "élément";
}

function capitalize(value) {
  const text = String(value ?? "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * `fields` : [{ name, label, value, required, maxLength, type, placeholder }]
 *   → fenêtre « Renommer » (une ligne par champ). `value` est facultatif : on
 *     lit `record[name]` à défaut.
 *
 * `extraActions` : [{ key, label, icon, tone, disabled, href, confirm,
 *                    run: async ({ request, id, record }), success, when }]
 *   → entrées supplémentaires propres à la page (changer le statut, envoyer,
 *     archiver…). `confirm` accepte `{ title, description, confirmLabel, danger }`.
 */
export default function RecordActions({
  resource,
  id,
  record,
  entityLabel = "élément",
  displayName,
  fields = null,
  canRename = false,
  canDelete = false,
  renameTitle,
  deleteTitle,
  deleteWarning,
  extraActions = [],
  href,
  onChanged,
  onDeleted,
  label,
  align = "end",
  size = "sm",
  trigger,
  className = "",
}) {
  const { request } = useAuth();
  const [dialog, setDialog] = useState(null); // { kind: "rename" | "delete" | "extra", action? }
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [doneMessage, setDoneMessage] = useState("");
  const [toast, setToast] = useState(null);

  const noun = nounOf(entityLabel);
  const name = displayName ?? record?.name ?? record?.title ?? record?.reference ?? `cet ${noun}`;
  const endpoint = `${resource}/${encodeURIComponent(id)}`;

  function refresh(path, method) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(WORKSPACE_UPDATED, { detail: { path, method } }));
  }

  function openRename() {
    const initial = {};
    for (const field of fields ?? []) {
      initial[field.name] = String(record?.[field.name] ?? field.value ?? "");
    }
    setForm(initial);
    setError(null);
    setDone(false);
    setDialog({ kind: "rename" });
  }

  function openDelete() {
    setError(null);
    setDone(false);
    setDialog({ kind: "delete" });
  }

  function openExtra(action) {
    setError(null);
    setDone(false);
    if (action.confirm) setDialog({ kind: "extra", action });
    else runExtra(action);
  }

  async function runExtra(action) {
    setBusy(true);
    setError(null);
    setDialog({ kind: "extra", action });
    try {
      await action.run({ request, id, record, endpoint });
      await onChanged?.();
      refresh(endpoint, "PATCH");
      setDoneMessage(action.success ?? "Modification enregistrée.");
      setDone(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitRename(event) {
    event.preventDefault();
    if (busy) return;
    const body = {};
    for (const field of fields ?? []) {
      const value = String(form[field.name] ?? "").trim();
      if (field.required && !value) {
        setError(`${field.label} est obligatoire.`);
        return;
      }
      const previous = String(record?.[field.name] ?? field.value ?? "").trim();
      if (value === previous) continue;
      body[field.name] = value === "" && field.nullable ? null : value;
    }
    if (Object.keys(body).length === 0) {
      setDialog(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request(endpoint, { method: "PATCH", body });
      await onChanged?.();
      refresh(endpoint, "PATCH");
      setDoneMessage("Modifications enregistrées.");
      setDone(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitDelete() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await request(endpoint, { method: "DELETE" });
      refresh(endpoint, "DELETE");
      // Le rechargement de la liste attend la fermeture de la fenêtre : sinon
      // la ligne disparaît et ce composant est démonté avant que l'utilisateur
      // ait pu lire la confirmation.
      setDoneMessage(`${capitalize(noun)} : suppression effectuée.`);
      setDone(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  function confirmExtra() {
    const action = dialog?.action;
    if (!action) return;
    setBusy(true);
    setError(null);
    Promise.resolve(action.run({ request, id, record, endpoint }))
      .then(async () => {
        await onChanged?.();
        refresh(endpoint, "PATCH");
        setDoneMessage(action.success ?? "Modification enregistrée.");
        setDone(true);
      })
      .catch((caught) => setError(messageOf(caught)))
      .finally(() => setBusy(false));
  }

  function close() {
    if (busy) return;
    const wasDelete = dialog?.kind === "delete" && done;
    setDialog(null);
    setError(null);
    setDone(false);
    if (wasDelete) {
      onChanged?.();
      if (onDeleted) onDeleted();
      else setToast({ message: doneMessage, tone: "success" });
    } else if (done && dialog?.kind !== "delete") {
      setToast({ message: doneMessage, tone: "success" });
    }
  }

  const items = [];
  if (href) items.push({ key: "open", label: `Ouvrir`, icon: ArrowUpRight, href });
  if (href && typeof navigator !== "undefined") {
    items.push({
      key: "copy",
      label: "Copier le lien",
      icon: Copy,
      onSelect: async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}${href}`);
          setToast({ message: "Lien copié dans le presse-papiers.", tone: "success" });
        } catch {
          setToast({ message: "Impossible de copier le lien.", tone: "error" });
        }
      },
    });
  }
  if (canRename && fields?.length) items.push({ key: "rename", label: "Renommer", icon: Pencil, onSelect: openRename });
  for (const action of extraActions.filter(Boolean)) {
    if (action.when === false) continue;
    if (action.separator) items.push({ separator: true, key: action.key });
    else
      items.push({
        key: action.key,
        label: action.label,
        icon: action.icon,
        tone: action.tone,
        href: action.href,
        disabled: action.disabled,
        onSelect: () => (action.href ? undefined : openExtra(action)),
      });
  }
  if (canDelete) {
    if (items.length) items.push({ separator: true, key: "sep-delete" });
    items.push({ key: "delete", label: "Supprimer", icon: Trash2, tone: "danger", onSelect: openDelete });
  }

  if (!items.length) return null;

  const dialogTitle = dialog?.kind === "rename" ? renameTitle ?? `Renommer ${name}` : null;

  return (
    <>
      <ActionMenu items={items} label={label ?? `Actions pour ${name}`} align={align} size={size} trigger={trigger} className={className} />

      {dialog?.kind === "rename" ? (
        <Dialog
          as="form"
          onSubmit={submitRename}
          title={done ? "Modifications enregistrées" : dialogTitle}
          eyebrow="Renommer"
          icon={Pencil}
          tone="blue"
          onClose={close}
          description={done ? null : `Les changements sont enregistrés immédiatement.`}
          footer={
            done ? (
              <button type="button" className="sui-btn sui-btn--dark" onClick={close}>
                Fermer
              </button>
            ) : (
              <>
                <button type="button" className="sui-btn" disabled={busy} onClick={close}>
                  Annuler
                </button>
                <button type="submit" className="sui-btn sui-btn--dark" disabled={busy}>
                  {busy ? "Enregistrement…" : "Enregistrer"}
                </button>
              </>
            )
          }
        >
          {done ? (
            <p role="status">Les modifications de « {name} » ont été enregistrées.</p>
          ) : (
            <div className="sui-form">
              {(fields ?? []).map((field) => (
                <label key={field.name} className="sui-field">
                  <span className="sui-field__label">{field.label}</span>
                  <input
                    className="sui-input"
                    type={field.type ?? "text"}
                    required={field.required}
                    maxLength={field.maxLength}
                    placeholder={field.placeholder}
                    autoFocus={field.autoFocus}
                    value={form[field.name] ?? ""}
                    onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))}
                  />
                </label>
              ))}
              {error ? (
                <p className="sui-field__error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          )}
        </Dialog>
      ) : null}

      {dialog?.kind === "delete" ? (
        <Dialog
          title={done ? "Suppression effectuée" : deleteTitle ?? `Supprimer ${name} ?`}
          eyebrow="Suppression"
          icon={Trash2}
          tone="pink"
          onClose={close}
          footer={
            done ? (
              <button type="button" className="sui-btn sui-btn--dark" onClick={close}>
                Fermer
              </button>
            ) : (
              <>
                <button type="button" className="sui-btn" disabled={busy} onClick={close}>
                  Annuler
                </button>
                <button type="button" className="sui-btn sui-btn--danger" disabled={busy} onClick={submitDelete}>
                  {busy ? "Suppression…" : "Confirmer la suppression"}
                </button>
              </>
            )
          }
        >
          {done ? (
            <p role="status">{doneMessage}</p>
          ) : (
            <>
              <p>
                {deleteWarning ??
                  `« ${name} » sera retiré des listes et des totaux. Les éléments liés restent conservés pour leur traçabilité.`}
              </p>
              <p className="sui-field__hint">Cette action est définitive depuis l’interface.</p>
              {error ? (
                <p className="sui-field__error" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </Dialog>
      ) : null}

      {dialog?.kind === "extra" ? (
        <Dialog
          title={done ? dialog.action.success ?? "Modification enregistrée" : dialog.action.confirm?.title ?? dialog.action.label}
          eyebrow="Action"
          icon={dialog.action.icon ?? Pencil}
          tone={dialog.action.confirm?.danger ? "pink" : "blue"}
          onClose={close}
          footer={
            done ? (
              <button type="button" className="sui-btn sui-btn--dark" onClick={close}>
                Fermer
              </button>
            ) : (
              <>
                <button type="button" className="sui-btn" disabled={busy} onClick={close}>
                  Annuler
                </button>
                <button
                  type="button"
                  className={dialog.action.confirm?.danger ? "sui-btn sui-btn--danger" : "sui-btn sui-btn--dark"}
                  disabled={busy}
                  onClick={confirmExtra}
                >
                  {busy ? "En cours…" : dialog.action.confirm?.confirmLabel ?? dialog.action.label}
                </button>
              </>
            )
          }
        >
          {done ? (
            <p role="status">{doneMessage}</p>
          ) : (
            <>
              <p>{dialog.action.confirm?.description ?? `Confirmer « ${dialog.action.label} » pour « ${name} » ?`}</p>
              {error ? (
                <p className="sui-field__error" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </Dialog>
      ) : null}

      {toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
    </>
  );
}
