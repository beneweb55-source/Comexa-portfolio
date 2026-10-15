"use client";

/*
 * Comexa Full-Viewport App-Shell (10x Workspace Shell — Apple / Linear / Vercel Grade)
 *
 * Architecture :
 *  - Plein écran 100vw × 100dvh, défilement indépendant de la zone de contenu (`.sui-canvas-scroll`).
 *  - Barre latérale Liquid Glass rétractable (268 px ouverte / 78 px réduite, persistée dans localStorage)
 *    organisant toutes les rubriques autorisées par pôles métiers clairs (aucune rubrique cachée).
 *  - Bandeau supérieur Liquid Glass avec fil d'Ariane, filtre instantané de vue (`useShellQuery`),
 *    déclencheur de Palette de Commandes Globale (`⌘K` / `Ctrl+K`), bouton Console IA (`Alt+C`),
 *    tiroir latéral Activité & Notifications (`AdminDeskPanel`) et menu compte (`UserMenu`).
 *  - Barre d'onglets basse mobile (< 768 px) avec cibles tactiles >= 44 px et gestion de `safe-area`.
 */

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Command,
  Compass,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Folder,
  Globe,
  Home,
  Inbox,
  KeyRound,
  Layers,
  LayoutGrid,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ReceiptText,
  ScrollText,
  Search,
  Settings,
  Shield,
  ShoppingCart,
  Sparkles,
  Terminal,
  User,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import UserMenu from "@/components/workspace/UserMenu";
import PageHeader from "./PageHeader";
import AdminDeskPanel from "./AdminDeskPanel";
import Tooltip from "./Tooltip";
import { resolveNotificationHref } from "./notification-map";
import { relativeFr } from "./time";

const ShellQueryContext = createContext({
  query: "",
  setQuery: () => {},
  openCommandPalette: () => {},
  openAiConsole: () => {},
});

/**
 * Permet à une page enfant de lire (et modifier) la recherche du bandeau
 * ou d'ouvrir la palette de commandes / console IA.
 */
export function useShellQuery() {
  return useContext(ShellQueryContext);
}

const ROUTE_META = {
  // Espace équipe
  "/espace-equipe/tableau-de-bord": { icon: Home, group: "Pilotage", shortLabel: "Tableau de bord" },
  "/espace-equipe/analytique": { icon: BarChart3, group: "Pilotage", shortLabel: "Analytique" },
  "/espace-equipe/calendrier": { icon: CalendarDays, group: "Pilotage", shortLabel: "Calendrier" },
  "/espace-equipe/rapports": { icon: FileSpreadsheet, group: "Pilotage", shortLabel: "Rapports" },
  "/espace-equipe/rapports-journaliers": { icon: FileCheck2, group: "Pilotage", shortLabel: "Rapports journaliers" },

  "/espace-equipe/contacts": { icon: Inbox, group: "Commercial & CRM", shortLabel: "Demandes de contact" },
  "/espace-equipe/demandes": { icon: Layers, group: "Commercial & CRM", shortLabel: "Demandes de projet" },
  "/espace-equipe/prospects": { icon: Compass, group: "Commercial & CRM", shortLabel: "Prospects (Pipeline)" },
  "/espace-equipe/clients": { icon: Users, group: "Commercial & CRM", shortLabel: "Clients" },
  "/espace-equipe/commandes": { icon: ShoppingCart, group: "Commercial & CRM", shortLabel: "Commandes" },

  "/espace-equipe/projets": { icon: Folder, group: "Production", shortLabel: "Projets" },
  "/espace-equipe/taches": { icon: CheckSquare, group: "Production", shortLabel: "Tâches & Kanban" },
  "/espace-equipe/modifications": { icon: Wrench, group: "Production", shortLabel: "Modifications" },
  "/espace-equipe/temps": { icon: Clock, group: "Production", shortLabel: "Feuille de temps" },

  "/espace-equipe/devis": { icon: FileText, group: "Facturation", shortLabel: "Devis" },
  "/espace-equipe/factures": { icon: ReceiptText, group: "Facturation", shortLabel: "Factures" },

  "/espace-equipe/messagerie": { icon: MessageSquare, group: "Communication", shortLabel: "Messagerie" },
  "/espace-equipe/notifications": { icon: Bell, group: "Communication", shortLabel: "Notifications" },
  "/espace-equipe/contenu": { icon: Globe, group: "Communication", shortLabel: "Contenu du site" },

  "/espace-equipe/membres": { icon: Users, group: "Administration", shortLabel: "Membres" },
  "/espace-equipe/roles": { icon: Shield, group: "Administration", shortLabel: "Rôles & droits" },
  "/espace-equipe/parametres": { icon: Settings, group: "Administration", shortLabel: "Paramètres" },
  "/espace-equipe/integrations": { icon: KeyRound, group: "Administration", shortLabel: "API & Intégrations" },
  "/espace-equipe/journal": { icon: ScrollText, group: "Administration", shortLabel: "Journal d’audit" },
  "/espace-equipe/compte": { icon: User, group: "Administration", shortLabel: "Mon compte" },

  // Espace client
  "/espace-client": { icon: Home, group: "Mon espace", shortLabel: "Vue d’ensemble" },
  "/espace-client/tableau-de-bord": { icon: BarChart3, group: "Mon espace", shortLabel: "Tableau de bord" },
  "/espace-client/commander": { icon: ShoppingCart, group: "Mon espace", shortLabel: "Commander un pack" },
  "/espace-client/modifications": { icon: Wrench, group: "Suivi & Échanges", shortLabel: "Modifications" },
  "/espace-client/messagerie": { icon: MessageSquare, group: "Suivi & Échanges", shortLabel: "Messagerie" },
  "/espace-client/notifications": { icon: Bell, group: "Suivi & Échanges", shortLabel: "Notifications" },
  "/espace-client/compte": { icon: User, group: "Suivi & Échanges", shortLabel: "Mon compte" },
};

const GROUP_ORDER_TEAM = [
  "Pilotage",
  "Commercial & CRM",
  "Production",
  "Facturation",
  "Communication",
  "Administration",
];

const GROUP_ORDER_CLIENT = ["Mon espace", "Suivi & Échanges"];

function iconForHref(href) {
  return ROUTE_META[href]?.icon ?? Briefcase;
}

function isActivePath(pathname, href) {
  if (!pathname || !href) return false;
  if (href === "/espace-client" || href === "/espace-equipe") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initialsOf(person) {
  if (!person) return "CX";
  const a = person.firstName?.[0] ?? "";
  const b = person.lastName?.[0] ?? "";
  const pair = `${a}${b}`.trim();
  if (pair) return pair.toLocaleUpperCase("fr-FR");
  return (person.email?.slice(0, 2) ?? "CX").toLocaleUpperCase("fr-FR");
}

function triggerAiConsole() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("comexa:open-ai-console"));
  }
}

export function WorkspaceSoftShell({ area, title, subtitle, links = [], children }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { user, request } = useAuth();
  const isTeam = area === "equipe";

  const [query, setQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        return window.localStorage.getItem("comexa:sidebar-collapsed") === "1";
      } catch {
        // ignore storage errors
      }
    }
    return false;
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [deskOpen, setDeskOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("comexa:sidebar-collapsed", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Fermeture automatique des tiroirs au changement de route
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMobileMenuOpen(false);
    setCmdkOpen(false);
    setQuery("");
  }

  // Raccourcis clavier globaux : ⌘K / Ctrl+K (Palette de commandes), Alt+B (Barre latérale)
  useEffect(() => {
    function onKeyDown(event) {
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      const meta = event.metaKey || event.ctrlKey;
      if (meta && !event.shiftKey && !event.altKey && key === "k") {
        event.preventDefault();
        setCmdkOpen((open) => !open);
        return;
      }
      if (event.altKey && key === "b") {
        event.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  // Compteur de notifications non lues + données du tiroir Activité
  const unreadProbe = useListing("/notifications?read=false&page=1&perPage=1");
  const recentNotifications = useListing("/notifications?page=1&perPage=5");
  const canReadActivity = isTeam && (can(user, "activity:read:any") || can(user, "activity:read:client"));
  const canReadMembers = isTeam && can(user, "user:read:any");
  const recentActivity = useListing(canReadActivity ? "/activity?page=1&perPage=4" : null);
  const activeMembers = useListing(canReadMembers ? "/users?status=ACTIVE&page=1&perPage=5" : null);

  const unreadCount = Number.isFinite(Number(unreadProbe.meta?.total))
    ? Number(unreadProbe.meta.total)
    : 0;

  // Groupement des liens dans la barre latérale (aucune rubrique cachée !)
  const groupedLinks = useMemo(() => {
    const order = isTeam ? GROUP_ORDER_TEAM : GROUP_ORDER_CLIENT;
    const buckets = new Map(order.map((g) => [g, []]));
    buckets.set("Autres", []);

    for (const link of links) {
      const meta = ROUTE_META[link.href];
      const groupName = meta?.group && buckets.has(meta.group) ? meta.group : order[0];
      const IconComponent = meta?.icon ?? iconForHref(link.href);
      buckets.get(groupName).push({
        ...link,
        icon: IconComponent,
        shortLabel: meta?.shortLabel ?? link.label,
        active: isActivePath(pathname, link.href),
        badge: link.href.endsWith("/notifications") && unreadCount > 0 ? unreadCount : null,
      });
    }

    return [...buckets.entries()]
      .filter(([, groupItems]) => groupItems.length > 0)
      .map(([group, items]) => ({ group, items }));
  }, [isTeam, links, pathname, unreadCount]);

  // Rubrique courante pour le fil d'Ariane et l'en-tête
  const activeLink = useMemo(() => {
    const exact = links.find((link) => link.href === pathname);
    if (exact) return { ...exact, group: ROUTE_META[exact.href]?.group };
    const prefix = links
      .filter((link) => link.href !== "/espace-client" && link.href !== "/espace-equipe")
      .find((link) => pathname.startsWith(`${link.href}/`));
    if (prefix) return { ...prefix, group: ROUTE_META[prefix.href]?.group };
    return links[0] ? { ...links[0], group: ROUTE_META[links[0].href]?.group } : null;
  }, [links, pathname]);

  const isDashboard = pathname === "/espace-equipe/tableau-de-bord";
  const pageHeading = activeLink?.label ?? title;
  const pageGroup = activeLink?.group ?? (isTeam ? "Espace équipe" : "Espace client");

  // Action principale contextuelle
  const canCreateQuote = isTeam && can(user, "quote:write:any");
  const primaryAction = useMemo(() => {
    if (isTeam) {
      if (canCreateQuote) {
        return { label: "Nouveau devis", href: "/espace-equipe/devis/nouveau", icon: Plus };
      }
      return null;
    }
    return { label: "Commander un pack", href: "/espace-client/commander", icon: ShoppingCart };
  }, [canCreateQuote, isTeam]);

  // Sections du tiroir Activité & Notifications (AdminDeskPanel)
  const deskSections = useMemo(() => {
    const out = [];
    const notifItems = (recentNotifications.items ?? []).slice(0, 4).map((n) => ({
      id: n.id,
      avatar: "!",
      title: n.title || "Notification",
      subtitle: [n.body, relativeFr(n.createdAt)].filter(Boolean).join(" · "),
      href: resolveNotificationHref(n.link, isTeam),
    }));
    out.push({
      id: "notifications",
      tone: "blue",
      title: "Notifications",
      tag: unreadCount > 0 ? `${unreadCount} non lue${unreadCount > 1 ? "s" : ""}` : "À jour",
      items: notifItems,
      emptyText: recentNotifications.loading ? "Chargement…" : "Aucune notification récente.",
    });

    if (canReadActivity) {
      const actItems = (recentActivity.items ?? []).slice(0, 4).map((a) => ({
        id: a.id,
        avatar: initialsOf(a.actor),
        title: a.summary || a.type || "Activité",
        subtitle: relativeFr(a.createdAt),
      }));
      out.push({
        id: "activite",
        tone: "lilac",
        title: "Activité récente",
        tag: actItems.length ? `${actItems.length}` : undefined,
        items: actItems,
        emptyText: recentActivity.loading ? "Chargement…" : "Aucune activité récente.",
      });
    }

    if (canReadMembers) {
      const memberItems = (activeMembers.items ?? []).slice(0, 4).map((m) => ({
        id: m.id,
        avatar: initialsOf(m),
        title: `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || m.email,
        subtitle: m.email,
      }));
      out.push({
        id: "equipe",
        tone: "yellow",
        title: "Équipe active",
        tag: activeMembers.meta?.total ? `${activeMembers.meta.total}` : undefined,
        items: memberItems,
        emptyText: activeMembers.loading ? "Chargement…" : "Aucun membre actif.",
      });
    }
    return out;
  }, [
    activeMembers.items,
    activeMembers.loading,
    activeMembers.meta,
    canReadActivity,
    canReadMembers,
    isTeam,
    recentActivity.items,
    recentActivity.loading,
    recentNotifications.items,
    recentNotifications.loading,
    unreadCount,
  ]);

  // Onglets rapides pour la barre mobile (< 768 px)
  const mobileTabs = useMemo(() => {
    const preferred = isTeam
      ? [
          { href: "/espace-equipe/tableau-de-bord", label: "Accueil", icon: Home },
          { href: "/espace-equipe/projets", label: "Projets", icon: Folder },
          { href: "/espace-equipe/taches", label: "Tâches", icon: CheckSquare },
          { href: "/espace-equipe/messagerie", label: "Messages", icon: MessageSquare },
        ]
      : [
          { href: "/espace-client", label: "Accueil", icon: Home },
          { href: "/espace-client/tableau-de-bord", label: "Tableau", icon: BarChart3 },
          { href: "/espace-client/commander", label: "Commander", icon: ShoppingCart },
          { href: "/espace-client/messagerie", label: "Messages", icon: MessageSquare },
        ];
    const allowedHrefs = new Set(links.map((l) => l.href));
    const filtered = preferred.filter((item) => allowedHrefs.has(item.href));
    return filtered.slice(0, 4);
  }, [isTeam, links]);

  const contextValue = useMemo(
    () => ({
      query,
      setQuery,
      openCommandPalette: () => setCmdkOpen(true),
      openAiConsole: triggerAiConsole,
    }),
    [query],
  );

  return (
    <ShellQueryContext.Provider value={contextValue}>
      <div className="sui-viewport">
        <div className="sui-shell">
          {/* ================================================================
              1. BARRE LATÉRALE LIQUID GLASS (Desktop & Tablette >= 768px)
             ================================================================ */}
          <aside
            className={`sui-sidebar ${sidebarCollapsed ? "sui-sidebar--collapsed" : ""}`}
            aria-label={title}
          >
            <div className="sui-sidebar__brand">
              <Link
                href={isTeam ? "/espace-equipe/tableau-de-bord" : "/espace-client"}
                className="sui-sidebar__logo-link"
                title="Retour à l’accueil de l’espace"
              >
                <span className="sui-sidebar__monogram" aria-hidden="true">
                  CX
                </span>
                {!sidebarCollapsed ? (
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[16px] font-bold tracking-tight text-[#0b2545]">
                      Comexa
                    </span>
                    <span className="sui-sidebar__space-badge">
                      {isTeam ? "Espace Équipe" : "Espace Client"}
                    </span>
                  </div>
                ) : null}
              </Link>
              {!sidebarCollapsed ? (
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="sui-icon-btn !h-8 !w-8 !rounded-lg"
                  aria-label="Réduire la barre latérale"
                  title="Réduire la barre latérale (Alt+B)"
                >
                  <PanelLeftClose size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setCmdkOpen(true)}
              className="sui-sidebar__cmdk-btn"
              aria-label="Ouvrir la recherche rapide et palette de commandes"
              title="Recherche globale & commandes (⌘K)"
            >
              <span className="inline-flex items-center gap-2 truncate">
                <Search size={15} strokeWidth={1.9} aria-hidden="true" />
                {!sidebarCollapsed ? <span>Rechercher…</span> : null}
              </span>
              {!sidebarCollapsed ? <kbd className="sui-kbd">⌘K</kbd> : null}
            </button>

            <nav className="sui-sidebar__nav" aria-label={`Navigation ${title}`}>
              {groupedLinks.map(({ group, items }) => (
                <div key={group} className="sui-sidebar__group">
                  {!sidebarCollapsed ? (
                    <span className="sui-sidebar__group-label">{group}</span>
                  ) : (
                    <span className="sui-sidebar__group-label" aria-hidden="true">
                      •••
                    </span>
                  )}
                  {items.map((item) => {
                    const Icon = item.icon;
                    const linkNode = (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={item.active ? "page" : undefined}
                        className={`sui-sidebar__link ${item.active ? "sui-sidebar__link--active" : ""}`}
                      >
                        <Icon
                          size={18}
                          strokeWidth={1.85}
                          className="sui-sidebar__link-icon"
                          aria-hidden="true"
                        />
                        {!sidebarCollapsed ? (
                          <>
                            <span className="sui-sidebar__link-text">{item.shortLabel}</span>
                            {item.badge ? (
                              <span className="sui-sidebar__link-badge">{item.badge}</span>
                            ) : null}
                          </>
                        ) : null}
                      </Link>
                    );

                    return sidebarCollapsed ? (
                      <Tooltip key={item.href} label={item.label}>
                        {linkNode}
                      </Tooltip>
                    ) : (
                      linkNode
                    );
                  })}
                </div>
              ))}
            </nav>

            <div className="sui-sidebar__footer">
              <Link
                href="/"
                className="sui-sidebar__link !min-h-[34px] !text-[12.5px]"
                title="Voir le site public Comexa"
              >
                <Globe size={16} strokeWidth={1.75} className="sui-sidebar__link-icon" aria-hidden="true" />
                {!sidebarCollapsed ? <span className="sui-sidebar__link-text">Site public Comexa</span> : null}
              </Link>
              {sidebarCollapsed ? (
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="sui-sidebar__collapse-btn"
                  aria-label="Déployer la barre latérale"
                  title="Déployer la barre latérale (Alt+B)"
                >
                  <PanelLeftOpen size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </aside>

          {/* ================================================================
              2. COLONNE PRINCIPALE : TOPBAR LIQUID GLASS + ZONE SCROLLABLE
             ================================================================ */}
          <div className="sui-workspace-column">
            <header className="sui-topbar">
              <div className="sui-topbar__left">
                {/* Bouton menu sur mobile */}
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(true)}
                  className="sui-icon-btn md:!hidden"
                  aria-label="Ouvrir le menu des rubriques"
                >
                  <Menu size={18} strokeWidth={1.85} aria-hidden="true" />
                </button>

                <div className="sui-topbar__breadcrumb">
                  <span className="sui-topbar__eyebrow">
                    <span>{isTeam ? "Comexa Équipe" : "Comexa Client"}</span>
                    <ChevronRight size={11} strokeWidth={2.2} aria-hidden="true" />
                    <span>{pageGroup}</span>
                  </span>
                  <p className="sui-topbar__title">{pageHeading}</p>
                </div>
              </div>

              <div className="sui-topbar__center">
                <div className="sui-topbar__search" role="search">
                  <Search
                    size={15}
                    strokeWidth={1.9}
                    className="sui-topbar__search-icon"
                    aria-hidden="true"
                  />
                  {isDashboard ? (
                    <button type="button" className="sui-topbar__search-input sui-topbar__command" onClick={() => setCmdkOpen(true)}>
                      Rechercher une rubrique ou une action…
                    </button>
                  ) : (
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Filtrer la vue…"
                      aria-label="Filtrer la vue courante"
                      className="sui-topbar__search-input"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setCmdkOpen(true)}
                    className="sui-topbar__search-kbd"
                    title="Ouvrir la palette de commandes globale (⌘K)"
                  >
                    <Command size={11} strokeWidth={2} aria-hidden="true" />
                    <span>K</span>
                  </button>
                </div>
              </div>

              <div className="sui-topbar__right">
                {isTeam ? (
                  <button
                    type="button"
                    onClick={triggerAiConsole}
                    className="sui-pill-btn hidden lg:inline-flex"
                    title="Ouvrir la Console IA Comexa (Alt+C)"
                  >
                    <Terminal size={15} strokeWidth={1.85} className="text-[#1e86e0]" aria-hidden="true" />
                    <span>Console IA</span>
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => setCmdkOpen(true)}
                  className="sui-icon-btn md:!hidden"
                  aria-label="Recherche globale"
                >
                  <Search size={17} strokeWidth={1.85} aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={() => setDeskOpen(true)}
                  className="sui-icon-btn"
                  aria-label={
                    unreadCount > 0
                      ? `Activité et notifications (${unreadCount} non lues)`
                      : "Activité et notifications"
                  }
                  title="Ouvrir le centre d’activité et notifications"
                >
                  <Bell size={17} strokeWidth={1.85} aria-hidden="true" />
                  {unreadCount > 0 ? (
                    <span className="sui-icon-btn__badge" aria-hidden="true">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  ) : null}
                </button>

                <UserMenu area={area} />
              </div>
            </header>

            <main className="sui-canvas-scroll" aria-label={pageHeading}>
              <div className="sui-canvas-inner">
                <PageHeader
                  title={pageHeading}
                  subtitle={isDashboard ? "Une vue claire sur votre activité, vos projets et vos priorités." : subtitle}
                  breadcrumb={isDashboard ? "Votre espace de pilotage" : undefined}
                  secondaryAction={
                    isDashboard ? null : isTeam
                      ? { label: "Recherche globale (⌘K)", onClick: () => setCmdkOpen(true), icon: Search }
                      : { label: "Messagerie", href: "/espace-client/messagerie", icon: MessageSquare }
                  }
                  primaryAction={primaryAction}
                />
                {children}
              </div>
            </main>
          </div>
        </div>

        {/* ================================================================
            3. BARRE D'ONGLETS BASSE MOBILE (< 768px)
           ================================================================ */}
        <nav className="sui-mobile-tabbar" aria-label="Navigation rapide mobile">
          {mobileTabs.map((tab) => {
            const Icon = tab.icon;
            const active = isActivePath(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`sui-mobile-tab ${active ? "sui-mobile-tab--active" : ""}`}
              >
                <Icon size={20} strokeWidth={active ? 2.1 : 1.75} aria-hidden="true" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-expanded={mobileMenuOpen}
            className={`sui-mobile-tab ${mobileMenuOpen ? "sui-mobile-tab--active" : ""}`}
          >
            <LayoutGrid size={20} strokeWidth={1.8} aria-hidden="true" />
            <span>Rubriques</span>
          </button>
        </nav>

        {/* ================================================================
            4. TIROIR LATÉRAL ACTIVITÉ & NOTIFICATIONS (Slide-Over Sheet)
           ================================================================ */}
        {deskOpen ? (
          <div
            className="cx-sheet-backdrop"
            role="presentation"
            onClick={() => setDeskOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Centre d’activité et notifications"
              className="cx-sheet !w-[min(420px,100vw)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="cx-sheet__header">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#1e86e0]">
                    En direct
                  </p>
                  <h2 className="cx-sheet__title">Activité &amp; Notifications</h2>
                </div>
                <button
                  type="button"
                  className="sui-icon-btn !h-9 !w-9"
                  aria-label="Fermer le panneau"
                  onClick={() => setDeskOpen(false)}
                >
                  <X size={16} strokeWidth={1.85} aria-hidden="true" />
                </button>
              </div>
              <div className="cx-sheet__body flex flex-col gap-4">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={isTeam ? "/espace-equipe/notifications" : "/espace-client/notifications"}
                    onClick={() => setDeskOpen(false)}
                    className="cx-btn cx-btn--secondary cx-btn--sm w-full justify-between"
                  >
                    <span>Voir toutes les notifications</span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </div>
                <AdminDeskPanel label="Centre d’activité" sections={deskSections} />
              </div>
            </div>
          </div>
        ) : null}

        {/* ================================================================
            5. TIROIR DE NAVIGATION MOBILE (Toutes les rubriques)
           ================================================================ */}
        {mobileMenuOpen ? (
          <MobileNavDrawer
            title={title}
            groupedLinks={groupedLinks}
            onClose={() => setMobileMenuOpen(false)}
            onOpenCmdk={() => {
              setMobileMenuOpen(false);
              setCmdkOpen(true);
            }}
          />
        ) : null}

        {/* ================================================================
            6. PALETTE DE COMMANDES GLOBALE (⌘K / Ctrl+K)
           ================================================================ */}
        {cmdkOpen ? (
          <CommandPaletteModal
            isTeam={isTeam}
            groupedLinks={groupedLinks}
            request={request}
            user={user}
            onClose={() => setCmdkOpen(false)}
            onNavigate={(href) => {
              setCmdkOpen(false);
              router.push(href);
            }}
          />
        ) : null}

      </div>
    </ShellQueryContext.Provider>
  );
}

function MobileNavDrawer({ title, groupedLinks, onClose, onOpenCmdk }) {
  const titleId = useId();

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="cx-sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="cx-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="cx-sheet__header">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#1e86e0]">
              Navigation
            </p>
            <h2 id={titleId} className="cx-sheet__title">
              {title}
            </h2>
          </div>
          <button
            type="button"
            className="sui-icon-btn !h-9 !w-9"
            aria-label="Fermer"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.85} aria-hidden="true" />
          </button>
        </div>

        <div className="cx-sheet__body flex flex-col gap-5">
          <button
            type="button"
            onClick={onOpenCmdk}
            className="sui-sidebar__cmdk-btn !m-0 w-full"
          >
            <span className="inline-flex items-center gap-2">
              <Search size={16} strokeWidth={1.85} aria-hidden="true" />
              <span>Rechercher une page ou un dossier…</span>
            </span>
            <kbd className="sui-kbd">⌘K</kbd>
          </button>

          {groupedLinks.map(({ group, items }) => (
            <div key={group} className="flex flex-col gap-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b8099]">
                {group}
              </p>
              <div className="sui-drawer__grid">
                {items.map((link) => {
                  const Icon = link.icon;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={onClose}
                      aria-current={link.active ? "page" : undefined}
                      className={`sui-drawer__link ${link.active ? "sui-drawer__link--active" : ""}`}
                    >
                      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                      <span className="truncate">{link.shortLabel}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CommandPaletteModal({ isTeam, groupedLinks, request, user, onClose, onNavigate }) {
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [liveResults, setLiveResults] = useState([]);
  const [searchingLive, setSearchingLive] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(id);
  }, []);

  // Recherche en direct sur l'API (Clients, Projets, Devis, Factures) dès 2 caractères
  useEffect(() => {
    const term = search.trim();
    if (!isTeam || term.length < 2) {
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearchingLive(true);
      try {
        const queries = [];
        if (can(user, "client:read:any")) {
          queries.push(
            request(`/clients?search=${encodeURIComponent(term)}&perPage=3`, { signal: controller.signal })
              .then((res) =>
                (res?.data ?? []).map((c) => ({
                  id: `client-${c.id}`,
                  group: "Résultats directs",
                  label: c.companyName,
                  sub: `Client · ${c.reference ?? ""}`,
                  href: `/espace-equipe/clients/${c.id}`,
                  icon: Building2,
                })),
              )
              .catch(() => []),
          );
        }
        if (can(user, "project:read:any") || can(user, "project:read:assigned") || can(user, "project:read:own")) {
          queries.push(
            request(`/projects?search=${encodeURIComponent(term)}&perPage=3`, { signal: controller.signal })
              .then((res) =>
                (res?.data ?? []).map((p) => ({
                  id: `project-${p.id}`,
                  group: "Résultats directs",
                  label: p.name,
                  sub: `Projet · ${p.reference ?? ""}`,
                  href: `/espace-equipe/projets/${p.id}`,
                  icon: Folder,
                })),
              )
              .catch(() => []),
          );
        }
        if (can(user, "quote:read:any")) {
          queries.push(
            request(`/quotes?search=${encodeURIComponent(term)}&perPage=3`, { signal: controller.signal })
              .then((res) =>
                (res?.data ?? []).map((q) => ({
                  id: `quote-${q.id}`,
                  group: "Résultats directs",
                  label: q.subject || q.reference,
                  sub: `Devis · ${q.reference ?? ""}`,
                  href: `/espace-equipe/devis/${q.id}`,
                  icon: FileText,
                })),
              )
              .catch(() => []),
          );
        }
        const lists = await Promise.all(queries);
        if (!controller.signal.aborted) {
          setLiveResults(lists.flat());
          setSearchingLive(false);
        }
      } catch {
        if (!controller.signal.aborted) setSearchingLive(false);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isTeam, request, search, user]);

  // Construction de la liste unifiée d'actions et de rubriques
  const quickActions = useMemo(() => {
    const actions = [];
    if (isTeam) {
      actions.push({
        id: "act-ai-console",
        group: "Actions rapides",
        label: "Ouvrir la Console IA Comexa",
        sub: "Pilotage en langage naturel · Alt+C",
        icon: Sparkles,
        onSelect: () => {
          onClose();
          triggerAiConsole();
        },
      });
      if (can(user, "quote:write:any")) {
        actions.push({
          id: "act-new-quote",
          group: "Actions rapides",
          label: "Créer un nouveau devis",
          sub: "Facturation",
          href: "/espace-equipe/devis/nouveau",
          icon: Plus,
        });
      }
      if (can(user, "time:write:own") || can(user, "time:write:any")) {
        actions.push({
          id: "act-log-time",
          group: "Actions rapides",
          label: "Saisir du temps ou consulter ma feuille",
          sub: "Production",
          href: "/espace-equipe/temps",
          icon: Clock,
        });
      }
    } else {
      actions.push({
        id: "act-order-pack",
        group: "Actions rapides",
        label: "Commander un pack Comexa",
        sub: "Nouveau projet",
        href: "/espace-client/commander",
        icon: ShoppingCart,
      });
      actions.push({
        id: "act-mod-req",
        group: "Actions rapides",
        label: "Déposer une demande de modification",
        sub: "Suivi projet",
        href: "/espace-client/modifications",
        icon: Wrench,
      });
    }
    actions.push({
      id: "act-public-site",
      group: "Actions rapides",
      label: "Aller sur le site public Comexa",
      sub: "Vitrine publique",
      href: "/",
      icon: Globe,
    });
    return actions;
  }, [isTeam, onClose, user]);

  const flatEntries = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const match = (text) => !normalized || String(text ?? "").toLowerCase().includes(normalized);

    const out = [];
    if (normalized.length >= 2) {
      for (const item of liveResults) {
        out.push(item);
      }
    }
    for (const action of quickActions) {
      if (match(action.label) || match(action.sub)) {
        out.push(action);
      }
    }
    for (const { group, items } of groupedLinks) {
      for (const link of items) {
        if (match(link.label) || match(link.shortLabel) || match(group)) {
          out.push({
            id: `nav-${link.href}`,
            group: `Rubriques · ${group}`,
            label: link.label,
            sub: link.href,
            href: link.href,
            icon: link.icon,
          });
        }
      }
    }
    return out;
  }, [groupedLinks, liveResults, quickActions, search]);

  const clampedActiveIndex = flatEntries.length > 0 ? Math.min(activeIndex, flatEntries.length - 1) : 0;

  function executeEntry(entry) {
    if (!entry) return;
    if (entry.onSelect) {
      entry.onSelect();
    } else if (entry.href) {
      onNavigate(entry.href);
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (flatEntries.length > 0) {
        setActiveIndex((i) => (i + 1) % flatEntries.length);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (flatEntries.length > 0) {
        setActiveIndex((i) => (i - 1 + flatEntries.length) % flatEntries.length);
      }
      return;
    }
    if (event.key === "Enter" && flatEntries[clampedActiveIndex]) {
      event.preventDefault();
      executeEntry(flatEntries[clampedActiveIndex]);
    }
  }

  // Regroupement pour l'affichage
  const sections = useMemo(() => {
    const map = new Map();
    flatEntries.forEach((entry, index) => {
      if (!map.has(entry.group)) map.set(entry.group, []);
      map.get(entry.group).push({ ...entry, globalIndex: index });
    });
    return [...map.entries()];
  }, [flatEntries]);

  return (
    <div className="sui-cmdk-backdrop" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Palette de commandes et recherche globale"
        className="sui-cmdk"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="sui-cmdk__header">
          <Search size={18} strokeWidth={2} className="text-[#1e86e0]" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Aller à une rubrique, chercher un client, un projet, un devis…"
            className="sui-cmdk__input"
            aria-label="Rechercher une rubrique ou une action"
          />
          {searchingLive ? (
            <span className="text-[12px] font-medium text-[#6b8099]">Recherche…</span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="sui-kbd cursor-pointer hover:bg-[#0b2545] hover:text-white"
          >
            Échap
          </button>
        </div>

        <div className="sui-cmdk__body" role="listbox" aria-label="Résultats">
          {sections.length === 0 ? (
            <div className="py-10 text-center text-[13.5px] text-[#6b8099]">
              Aucun résultat pour « {search} ».
            </div>
          ) : (
            sections.map(([groupTitle, entries]) => (
              <div key={groupTitle} className="flex flex-col gap-1">
                <div className="sui-cmdk__group-title">{groupTitle}</div>
                {entries.map((entry) => {
                  const Icon = entry.icon ?? ArrowRight;
                  const isSelected = entry.globalIndex === clampedActiveIndex;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIndex(entry.globalIndex)}
                      onClick={() => executeEntry(entry)}
                      className={`sui-cmdk__item ${isSelected ? "sui-cmdk__item--active" : ""}`}
                    >
                      <div className="sui-cmdk__item-left">
                        <span className="sui-cmdk__item-icon" aria-hidden="true">
                          <Icon size={16} strokeWidth={1.85} />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{entry.label}</div>
                          {entry.sub ? (
                            <div className="truncate text-[12px] text-[#6b8099]">{entry.sub}</div>
                          ) : null}
                        </div>
                      </div>
                      <ArrowRight size={14} className="shrink-0 opacity-60" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="sui-cmdk__footer">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="sui-kbd">↑</kbd> <kbd className="sui-kbd">↓</kbd> Naviguer
            </span>
            <span>
              <kbd className="sui-kbd">Entrée</kbd> Ouvrir
            </span>
          </div>
          <span>Comexa Command · ⌘K</span>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceSoftShell;
