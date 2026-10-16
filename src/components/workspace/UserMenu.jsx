"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/dashboard/icons";
import { can, canOpenSpace, hasTeamAccess, homeFor } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { SPACES, spaceForPath } from "@/lib/spaces";

function initialsOf(user) {
  const first = user?.firstName?.trim()?.[0] ?? "";
  const last = user?.lastName?.trim()?.[0] ?? "";
  const initials = `${first}${last}`.toLocaleUpperCase("fr-FR");
  if (initials) return initials;
  return user?.email?.trim()?.slice(0, 2)?.toLocaleUpperCase("fr-FR") ?? "?";
}

function nameOf(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "Votre compte";
}

/**
 * Menu de compte alimenté uniquement par le profil réellement renvoyé par l'API.
 *
 * `variant="softui"` adapte uniquement l'habillage (navbar noire de la coque :
 * avatar lilas, nom, courriel, chevron) — l'état, les liens et la déconnexion
 * restent identiques quel que soit le variant.
 */
export default function UserMenu({ variant = "workspace", compact = false, redirectTo }) {
  const soft = variant === "softui";
  // Dans un espace, `user` porte les droits réduits de l'espace : le menu de
  // compte raisonne sur le compte complet (`baseUser`).
  const { status, user: scopedUser, baseUser, logout, space } = useAuth();
  const user = baseUser ?? scopedUser;
  const router = useRouter();
  const menuId = useId();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;

    function closeOutside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (status === "loading") {
    return soft ? (
      <span className="sui-profile__avatar" role="status" aria-label="Chargement du compte" />
    ) : (
      <span className={`cx-user-menu cx-user-menu--${variant} cx-user-menu__loading`} role="status" aria-label="Chargement du compte" />
    );
  }
  if (status !== "authenticated" || !user) return null;

  const team = hasTeamAccess(user);
  const name = nameOf(user);
  const workspaceHref = homeFor(user);
  const homeSpace = space ?? spaceForPath(workspaceHref);
  const accountHref = team && SPACES[homeSpace] ? `${SPACES[homeSpace].prefix}/compte` : "/espace-client/compte";
  const workspaceLabel = team ? (SPACES[spaceForPath(workspaceHref)]?.label ?? "Mon espace de travail") : "Espace client";
  const canOpenSettings = team && canOpenSpace(user, "comexa") && can(user, "setting:read:any");

  async function signOut() {
    setOpen(false);
    await logout();
    router.replace(redirectTo ?? (variant === "public" ? "/" : "/connexion"));
    router.refresh();
  }

  if (soft) {
    return (
      <div ref={rootRef} className="sui-profile">
        <button
          ref={triggerRef}
          type="button"
          className="sui-profile__trigger"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={`Compte de ${name}`}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="sui-profile__avatar" aria-hidden="true">{initialsOf(user)}</span>
          <span className="sui-profile__id">
            <span className="sui-profile__name">{name}</span>
            <span className="sui-profile__mail">{user.email}</span>
          </span>
          <Icon name="chevron-down" className="sui-profile__chevron" />
        </button>

        {open ? (
          <div id={menuId} className="sui-popover" aria-label="Menu du compte">
            <div className="sui-popover__summary">
              <span className="sui-profile__avatar" aria-hidden="true">{initialsOf(user)}</span>
              <span>
                <strong>{name}</strong>
                <span>{user.email}</span>
              </span>
            </div>
            <div className="sui-popover__links">
              <Link href={accountHref} onClick={() => setOpen(false)}>
                <Icon name="user" />
                Mon compte
              </Link>
              {canOpenSettings ? (
                <Link href="/espace-comexa/parametres" onClick={() => setOpen(false)}>
                  <Icon name="settings" />
                  Paramètres de l’organisation
                </Link>
              ) : null}
              {variant !== "softui" ? (
                <Link href={workspaceHref} onClick={() => setOpen(false)}>
                  <Icon name={team ? "home" : "briefcase"} />
                  {workspaceLabel}
                </Link>
              ) : null}
            </div>
            <button type="button" className="sui-popover__signout" onClick={signOut}>
              <Icon name="logout" />
              Se déconnecter
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`cx-user-menu cx-user-menu--${variant}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`cx-user-menu__trigger${compact ? " cx-user-menu__trigger--compact" : ""}`}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Compte de ${name}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="cx-user-menu__avatar" aria-hidden="true">{initialsOf(user)}</span>
        <span className="cx-user-menu__identity">
          <span className="cx-user-menu__name">{name}</span>
          {variant === "workspace" ? <span className="cx-user-menu__hint">Mon compte</span> : null}
        </span>
        <Icon name="chevron-down" className="cx-user-menu__chevron" />
      </button>

      {open ? (
        <div id={menuId} className="cx-user-menu__popover" aria-label="Menu du compte">
          <div className="cx-user-menu__summary">
            <span className="cx-user-menu__avatar cx-user-menu__avatar--large" aria-hidden="true">{initialsOf(user)}</span>
            <span className="cx-user-menu__summary-copy">
              <strong>{name}</strong>
              <span>{user.email}</span>
            </span>
          </div>
          <div className="cx-user-menu__links">
            <Link href={accountHref} onClick={() => setOpen(false)}>
              <Icon name="user" />
              Mon compte
            </Link>
            {canOpenSettings ? (
              <Link href="/espace-comexa/parametres" onClick={() => setOpen(false)}>
                <Icon name="settings" />
                Paramètres de l’organisation
              </Link>
            ) : null}
            <Link href={workspaceHref} onClick={() => setOpen(false)}>
              <Icon name={team ? "home" : "briefcase"} />
              {workspaceLabel}
            </Link>
          </div>
          <button type="button" className="cx-user-menu__signout" onClick={signOut}>
            <Icon name="logout" />
            Se déconnecter
          </button>
        </div>
      ) : null}
    </div>
  );
}
