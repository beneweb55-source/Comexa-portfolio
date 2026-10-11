"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import logo from "../../../public/comexa-logo-horizontal-transparent.png";
import Icon from "@/components/dashboard/icons";
import UserMenu from "@/components/workspace/UserMenu";
import { hasTeamAccess } from "@/lib/access";
import { useAuth } from "@/lib/session";

const SIDEBAR_STORAGE_KEY = "comexa-workspace-sidebar";
const SIDEBAR_CHANGE_EVENT = "comexa-workspace-sidebar-change";
let volatileCompactPreference = false;

function getCompactPreference() {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "compact";
  } catch {
    return volatileCompactPreference;
  }
}

function getServerCompactPreference() {
  return false;
}

function subscribeToCompactPreference(onChange) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  window.addEventListener(SIDEBAR_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SIDEBAR_CHANGE_EVENT, onChange);
  };
}

function saveCompactPreference(value) {
  volatileCompactPreference = value;
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, value ? "compact" : "expanded");
  } catch {
    // La préférence reste temporairement disponible si le stockage est désactivé.
  }
  window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
}

function activeItemFor(pathname, groups) {
  const items = groups.flatMap((group) => group.items);
  return items.find((item) => pathname === item.href || (item.nested && pathname.startsWith(`${item.href}/`))) ?? null;
}

function pageTitle(pathname, activeItem, space) {
  if (pathname?.endsWith("/compte")) return "Mon compte";
  if (pathname?.endsWith("/devis/nouveau")) return "Nouveau devis";
  if (pathname?.startsWith("/espace-equipe/devis/")) return "Détail du devis";
  if (pathname?.startsWith("/espace-equipe/factures/")) return "Détail de la facture";
  if (pathname?.startsWith("/espace-equipe/prospects/")) return "Fiche prospect";
  if (pathname?.startsWith("/espace-equipe/clients/")) return "Fiche client";
  if (pathname?.startsWith("/espace-equipe/commandes/")) return "Détail de la commande";
  if (pathname?.startsWith("/espace-equipe/projets/")) return "Fiche projet";
  if (pathname?.startsWith("/espace-client/devis/")) return "Détail du devis";
  if (pathname?.startsWith("/espace-client/projets/")) return "Détail du projet";
  return activeItem?.label ?? space;
}

function pageSubtitle(activeItem, groups, pathname) {
  if (pathname?.endsWith("/compte")) return "Votre identité, votre mot de passe et vos sessions ouvertes.";
  const group = groups.find((item) => item.items.some((navItem) => navItem.href === activeItem?.href));
  return group?.description ?? "Votre espace de travail Comexa.";
}

function initialsOf(user) {
  const initials = `${user?.firstName?.trim()?.[0] ?? ""}${user?.lastName?.trim()?.[0] ?? ""}`.toLocaleUpperCase("fr-FR");
  return initials || user?.email?.trim()?.slice(0, 2)?.toLocaleUpperCase("fr-FR") || "?";
}

function nameOf(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "Votre compte";
}

/** App shell commun, navigation regroupée, compacte sur bureau et en tiroir sur mobile. */
export default function WorkspaceShell(props) {
  const pathname = usePathname() ?? "/";
  return <WorkspaceShellContent key={pathname} {...props} pathname={pathname} />;
}

function WorkspaceShellContent({ space, groups, children, pathname }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const compact = useSyncExternalStore(subscribeToCompactPreference, getCompactPreference, getServerCompactPreference);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileToggleRef = useRef(null);
  const sidebarRef = useRef(null);
  const mobileWasOpen = useRef(false);
  const isTeam = hasTeamAccess(user);
  const accountHref = isTeam ? "/espace-equipe/compte" : "/espace-client/compte";
  const activeItem = useMemo(() => activeItemFor(pathname, groups), [pathname, groups]);
  const title = pageTitle(pathname, activeItem, space);
  const subtitle = pageSubtitle(activeItem, groups, pathname);
  const showNotifications = groups.some((group) => group.items.some((item) => item.href.endsWith("/notifications")));


  useEffect(() => {
    const mobileToggle = mobileToggleRef.current;
    if (!mobileOpen) {
      if (mobileWasOpen.current) {
        mobileWasOpen.current = false;
        if (mobileToggle?.isConnected) mobileToggle.focus();
      }
      return undefined;
    }

    mobileWasOpen.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const getFocusable = () => Array.from(sidebarRef.current?.querySelectorAll("a[href], button:not(:disabled)") ?? []);
    getFocusable()[0]?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !sidebarRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sidebarRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      if (mobileWasOpen.current) {
        mobileWasOpen.current = false;
        if (mobileToggle?.isConnected) mobileToggle.focus();
      }
    };
  }, [mobileOpen]);

  async function handleLogout() {
    await logout();
    router.replace("/connexion");
    router.refresh();
  }

  return (
    <div className="cx-app cx-workspace">
      <a className="cx-workspace__skip-link" href="#workspace-main">Passer à la zone de travail</a>
      <div className={`cx-workspace__frame${compact ? " is-compact" : ""}`}>
        {mobileOpen ? (
          <button type="button" className="cx-workspace__scrim" aria-label="Fermer la navigation" onClick={() => setMobileOpen(false)} />
        ) : null}

        <aside
          ref={sidebarRef}
          id="workspace-navigation"
          role={mobileOpen ? "dialog" : undefined}
          aria-modal={mobileOpen ? "true" : undefined}
          className={`cx-workspace__sidebar${compact ? " is-compact" : ""}${mobileOpen ? " is-mobile-open" : ""}`}
          aria-label={space}
        >
          <div className="cx-workspace__brand">
            <Link href={isTeam ? "/espace-equipe" : "/espace-client"} aria-label="Comexa, accueil de l'espace" className="cx-workspace__brand-link">
              <Image src={logo} alt="Comexa" width={134} height={32} className="cx-workspace__brand-logo" priority />
              <span className="cx-workspace__brand-mark" aria-hidden="true">C</span>
            </Link>
            <button
              type="button"
              className="cx-workspace__compact-toggle"
              aria-label={compact ? "Développer la navigation" : "Réduire la navigation"}
              aria-expanded={!compact}
              title={compact ? "Développer la navigation" : "Réduire la navigation"}
              onClick={() => saveCompactPreference(!compact)}
            >
              <Icon name="chevron-left" />
            </button>
            <button type="button" className="cx-workspace__mobile-close" aria-label="Fermer la navigation" onClick={() => setMobileOpen(false)}>
              <Icon name="close" />
            </button>
          </div>

          <div className="cx-workspace__space-label">
            <span className="cx-workspace__space-dot" aria-hidden="true" />
            <span>{space}</span>
          </div>

          <nav className="cx-workspace__nav" aria-label={`Rubriques ${space.toLocaleLowerCase("fr-FR")}`}>
            {groups.map((group) => (
              <section className="cx-workspace__nav-group" key={group.label} aria-label={group.label}>
                <h2 className="cx-workspace__nav-heading">{group.label}</h2>
                <ul>
                  {group.items.map((item) => {
                    const active = pathname === item.href || (item.nested && pathname.startsWith(`${item.href}/`));
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          title={compact ? item.label : undefined}
                          aria-label={compact ? item.label : undefined}
                          aria-current={active ? "page" : undefined}
                          className={`cx-workspace__nav-link${active ? " is-active" : ""}`}
                          onClick={() => setMobileOpen(false)}
                        >
                          <Icon name={item.icon} />
                          <span className="cx-workspace__nav-label">{item.label}</span>
                          {active ? <span className="cx-workspace__active-dot" aria-hidden="true" /> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </nav>

          <div className="cx-workspace__sidebar-footer">
            <Link href={accountHref} className="cx-workspace__profile" aria-current={pathname === accountHref ? "page" : undefined} title={compact ? `Mon compte — ${nameOf(user)}` : undefined}>
              <span className="cx-workspace__profile-avatar" aria-hidden="true">{initialsOf(user)}</span>
              <span className="cx-workspace__profile-copy">
                <strong>{nameOf(user)}</strong>
                <span>Mon compte</span>
              </span>
            </Link>
            <button type="button" className="cx-workspace__logout" onClick={handleLogout} title={compact ? "Se déconnecter" : undefined}>
              <Icon name="logout" />
              <span>Se déconnecter</span>
            </button>
          </div>
        </aside>

        <div className="cx-workspace__main-column">
          <header className="cx-workspace__topbar">
            <button
              ref={mobileToggleRef}
              type="button"
              className="cx-workspace__mobile-toggle"
              aria-label={mobileOpen ? "Fermer la navigation" : "Ouvrir la navigation"}
              aria-expanded={mobileOpen}
              aria-controls="workspace-navigation"
              onClick={() => setMobileOpen((value) => !value)}
            >
              <Icon name={mobileOpen ? "close" : "menu"} />
            </button>
            <div className="cx-workspace__page-context">
              <div className="cx-workspace__breadcrumbs" aria-label="Fil d’Ariane">
                <span>{space}</span>
                {activeItem ? <><span aria-hidden="true">/</span><span>{activeItem.label}</span></> : null}
              </div>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            <div className="cx-workspace__topbar-actions">
              {showNotifications ? (
                <Link
                  href={isTeam ? "/espace-equipe/notifications" : "/espace-client/notifications"}
                  className="cx-workspace__icon-action"
                  aria-label="Notifications"
                  title="Notifications"
                >
                  <Icon name="bell" />
                </Link>
              ) : null}
              <UserMenu variant="workspace" />
            </div>
          </header>

          <main id="workspace-main" className="cx-workspace__content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
