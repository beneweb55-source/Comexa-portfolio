"use client";

/*
 * Shell — la coque noire arrondie qui porte tout le dashboard.
 *
 * Assemblage : navbar noire, languette à rayon inversé, rail gauche, panneau clair
 * scrollable, panneau droit « Admin Desk » (défilement indépendant) et dock
 * flottant. Le Shell ne connaît que trois choses : l'espace (`space`), les
 * rubriques autorisées (`groups`, déjà filtrées par les permissions dans le
 * layout) et les enfants rendus par la page.
 *
 * Les données affichées dans le chrome — compteur de la cloche, cartes de l'Admin
 * Desk — viennent de deux ressources déjà exposées par l'API, `/notifications` et
 * `/me/tasks`, et seulement si le porteur détient la permission correspondante :
 * aucun appel inutile pour un utilisateur qui n'y a pas droit.
 *
 * Le contenu de page reçoit la recherche du bandeau via `useShellQuery()`.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  BookPlus,
  CalendarDays,
  ChartNoAxesColumn,
  Check,
  Clock,
  CreditCard,
  Download,
  Eye,
  FilePlus,
  FileText,
  FolderKanban,
  History,
  Inbox,
  LayoutDashboard,
  LayoutTemplate,
  ListChecks,
  Megaphone,
  MessageSquare,
  Pencil,
  Plus,
  ReceiptText,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  SquareKanban,
  Target,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { can, canAny, hasTeamAccess } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { resolveLink } from "@/components/workspace/NotificationsPanel";
import AdminDeskPanel from "./AdminDeskPanel";
import Dock from "./Dock";
import Navbar from "./Navbar";
import PageHeader from "./PageHeader";
import SideRail from "./SideRail";
import Tooltip from "./Tooltip";
import { SoftMotionProvider, motion as softMotion, pageTransition } from "./motion";
import { StatusPill } from "./primitives";
import { notificationMeta } from "./notification-map";
import { formatRelativeTime } from "./time";

const ShellQueryContext = createContext({ query: "", setQuery: () => {} });

/** Recherche du bandeau, consommée par les pages qui filtrent côté API. */
export function useShellQuery() {
  return useContext(ShellQueryContext);
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

/*
 * Rubrique → icône lucide. Les icônes de l'ancienne barre latérale étaient
 * incohérentes (camembert pour les cours, boîte de réception pour les
 * événements) : chaque rubrique porte désormais l'icône qui décrit son contenu.
 */
const NAV_ICONS = {
  home: LayoutDashboard,
  bell: Bell,
  contact: Inbox,
  target: Target,
  quote: FileText,
  invoice: ReceiptText,
  cart: ShoppingCart,
  inbox: Inbox,
  users: Users,
  folder: FolderKanban,
  kanban: SquareKanban,
  calendar: CalendarDays,
  clock: Clock,
  doc: FileText,
  message: MessageSquare,
  chart: ChartNoAxesColumn,
  layout: LayoutTemplate,
  shield: ShieldCheck,
  history: History,
  edit: Pencil,
  settings: Settings2,
};

/** Ordre de priorité des onglets de la navbar (les rubriques absentes sont ignorées). */
const NAV_PRIORITY = [
  "/espace-equipe/tableau-de-bord",
  "/espace-client/tableau-de-bord",
  "/espace-client",
  "/espace-equipe/clients",
  "/espace-equipe/projets",
  "/espace-equipe/commandes",
  "/espace-equipe/devis",
  "/espace-equipe/taches",
  "/espace-equipe/factures",
  "/espace-equipe/calendrier",
  "/espace-equipe/messagerie",
  "/espace-equipe/analytique",
  "/espace-equipe/membres",
  "/espace-equipe/contenu",
  "/espace-equipe/parametres",
  "/espace-client/projets",
  "/espace-client/devis",
  "/espace-client/commandes",
  "/espace-client/messagerie",
  "/espace-client/notifications",
];

const FALLBACK_ICON = LayoutDashboard;

/** 6 à 8 onglets visibles : les rubriques les plus utilisées du porteur. */
function buildNavItems(groups, max = 8) {
  const flat = groups.flatMap((group) => group.items);
  const unique = [];
  for (const item of flat) {
    if (!unique.some((entry) => entry.href === item.href)) unique.push(item);
  }
  return unique
    .sort((a, b) => {
      const rankA = NAV_PRIORITY.indexOf(a.href);
      const rankB = NAV_PRIORITY.indexOf(b.href);
      return (rankA === -1 ? 999 : rankA) - (rankB === -1 ? 999 : rankB);
    })
    .slice(0, max)
    .map((item) => ({ href: item.href, label: item.label, icon: NAV_ICONS[item.icon] ?? FALLBACK_ICON }));
}

function isActiveHref(pathname, href) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function activeEntry(pathname, groups) {
  const items = groups.flatMap((group) => group.items);
  const direct = items.find((item) => pathname === item.href);
  if (direct) return direct;
  return items.find((item) => item.nested && pathname.startsWith(`${item.href}/`)) ?? null;
}

/** Titres des écrans de détail, qui n'ont pas de rubrique propre. */
const DETAIL_TITLES = [
  ["/espace-equipe/devis/nouveau", "Nouveau devis"],
  ["/espace-equipe/devis/", "Détail du devis"],
  ["/espace-equipe/factures/", "Détail de la facture"],
  ["/espace-equipe/prospects/", "Fiche prospect"],
  ["/espace-equipe/clients/", "Fiche client"],
  ["/espace-equipe/commandes/", "Détail de la commande"],
  ["/espace-equipe/projets/", "Fiche projet"],
  ["/espace-client/devis/", "Détail du devis"],
  ["/espace-client/projets/", "Détail du projet"],
];

const PAGE_ICONS = {
  "/espace-equipe/tableau-de-bord": LayoutDashboard,
  "/espace-client/tableau-de-bord": LayoutDashboard,
  "/espace-equipe/clients": Users,
  "/espace-equipe/projets": FolderKanban,
  "/espace-equipe/taches": SquareKanban,
  "/espace-equipe/commandes": CreditCard,
  "/espace-equipe/devis": ReceiptText,
  "/espace-equipe/factures": ReceiptText,
  "/espace-equipe/calendrier": CalendarDays,
  "/espace-equipe/analytique": ChartNoAxesColumn,
  "/espace-equipe/membres": Users,
  "/espace-equipe/parametres": Settings2,
};

/* ------------------------------------------------------------------ */
/* Préférence locale : densité du panneau                              */
/* ------------------------------------------------------------------ */

const ZOOM_KEY = "comexa-shell-zoom";
const ZOOM_CHANGE_EVENT = "comexa-shell-zoom-change";
const ZOOM_STEPS = [0.9, 1, 1.1, 1.2];
let volatileZoom = 1;

/*
 * La densité est une préférence locale lue hors de React (`useSyncExternalStore`) :
 * pas d'effet, pas de rendu en cascade, et l'onglet reste synchronisé avec le
 * stockage si l'utilisateur change la valeur dans une autre fenêtre.
 */
function getZoomPreference() {
  try {
    const stored = Number(window.localStorage.getItem(ZOOM_KEY));
    return ZOOM_STEPS.includes(stored) ? stored : 1;
  } catch {
    return volatileZoom;
  }
}

function getServerZoomPreference() {
  return 1;
}

function subscribeToZoom(onChange) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  window.addEventListener(ZOOM_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(ZOOM_CHANGE_EVENT, onChange);
  };
}

function saveZoomPreference(value) {
  volatileZoom = value;
  try {
    window.localStorage.setItem(ZOOM_KEY, String(value));
  } catch {
    /* préférence non persistée : la densité reste active pour la session */
  }
  window.dispatchEvent(new Event(ZOOM_CHANGE_EVENT));
}

/* ------------------------------------------------------------------ */

export default function Shell({ space, groups, children }) {
  const { user, request } = useAuth();
  const pathname = usePathname() ?? "/";
  const team = hasTeamAccess(user);
  const base = team ? "/espace-equipe" : "/espace-client";

  const navItems = useMemo(() => buildNavItems(groups), [groups]);
  const entry = useMemo(() => activeEntry(pathname, groups), [groups, pathname]);
  const activeHref = useMemo(() => {
    const exact = navItems.find((item) => isActiveHref(pathname, item.href));
    if (exact) return exact.href;
    return navItems.find((item) => entry?.href?.startsWith(item.href))?.href ?? null;
  }, [entry, navItems, pathname]);

  const title = useMemo(() => {
    const detail = DETAIL_TITLES.find(([prefix]) => pathname.startsWith(prefix));
    return detail ? detail[1] : entry?.label ?? space;
  }, [entry, pathname, space]);

  const subtitle = useMemo(() => {
    const group = groups.find((item) => item.items.some((navItem) => navItem.href === entry?.href));
    return group?.description ?? "Votre espace de travail Comexa.";
  }, [entry, groups]);

  const PageIcon = PAGE_ICONS[entry?.href] ?? NAV_ICONS[entry?.icon] ?? LayoutDashboard;

  /* --- Recherche du bandeau -------------------------------------------- */
  const [query, setQuery] = useState("");
  const shellContext = useMemo(() => ({ query, setQuery }), [query]);

  /* --- Densité --------------------------------------------------------- */
  const zoom = useSyncExternalStore(subscribeToZoom, getZoomPreference, getServerZoomPreference);
  const changeZoom = useCallback((direction) => {
    const index = ZOOM_STEPS.indexOf(getZoomPreference());
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (index === -1 ? 1 : index) + direction))];
    saveZoomPreference(next);
  }, []);

  /* --- Données du chrome ------------------------------------------------ */
  const canReadNotifications = canAny(user, ["notification:read:own"]);
  const canReadTasks = canAny(user, ["task:read:personal", "task:read:own", "task:read:any", "task:read:assigned"]);

  const unread = useListing(canReadNotifications ? "/notifications?read=false&page=1&perPage=1" : null);
  const recent = useListing(canReadNotifications ? "/notifications?page=1&perPage=6" : null);
  const personalTasks = useListing(canReadTasks ? "/me/tasks?personalOnly=true&page=1&perPage=3" : null);

  const reloadUnread = unread.reload;
  const reloadRecent = recent.reload;
  const reloadTasks = personalTasks.reload;
  const unreadCount = Number.isFinite(Number(unread.meta?.total)) ? Number(unread.meta.total) : 0;

  const [busyNotification, setBusyNotification] = useState(null);
  const [notice, setNotice] = useState(null);

  const refreshChrome = useCallback(async () => {
    await Promise.all([reloadUnread(), reloadRecent(), reloadTasks()]);
  }, [reloadRecent, reloadTasks, reloadUnread]);

  const markRead = useCallback(
    async (id) => {
      setBusyNotification(id);
      try {
        await request(`/notifications/${id}/read`, { method: "POST" });
        await refreshChrome();
      } finally {
        setBusyNotification(null);
      }
    },
    [refreshChrome, request],
  );

  const removeNotification = useCallback(
    async (id) => {
      setBusyNotification(id);
      try {
        await request(`/notifications/${id}`, { method: "DELETE" });
        await refreshChrome();
      } finally {
        setBusyNotification(null);
      }
    },
    [refreshChrome, request],
  );

  const recentItems = recent.items;
  const taskItems = personalTasks.items;

  const deskItems = useMemo(() => {
    const notifications = (recentItems ?? []).map((item) => {
      const meta = notificationMeta(item.type);
      const href = resolveLink(item.link, team) ?? `${base}/notifications`;
      return {
        id: `notification-${item.id}`,
        tab: item.readAt ? "history" : "queue",
        tone: meta.tone,
        icon: meta.icon,
        type: meta.label,
        date: formatRelativeTime(item.createdAt),
        lines: [item.title, item.body ?? "Aucun détail fourni.", item.readAt ? "Déjà lue" : "Non lue"],
        cta: { label: "Ouvrir", href, icon: Eye },
        actions: [
          { label: "Marquer comme lue", icon: Check, onClick: () => markRead(item.id) },
          { label: "Supprimer", icon: Trash2, onClick: () => removeNotification(item.id) },
        ],
      };
    });

    const tasks = (taskItems ?? []).map((task) => ({
      id: `task-${task.id}`,
      tab: "tasks",
      tone: "lilac",
      icon: ListChecks,
      type: "Tâche",
      date: formatRelativeTime(task.dueDate ?? task.createdAt),
      lines: [task.title, task.description ?? "Sans description.", task.project?.name ?? "Tâche personnelle"],
      cta: { label: "Ouvrir la liste", href: `${base}/taches`, icon: SquareKanban },
      actions: [{ label: "Voir la tâche", icon: Eye, href: `${base}/taches` }],
    }));

    return [...tasks, ...notifications];
  }, [base, markRead, recentItems, removeNotification, taskItems, team]);

  const waitingCount = deskItems.filter((item) => item.tab === "queue").length;
  const taskCount = deskItems.filter((item) => item.tab === "tasks").length;

  const deskTabs = useMemo(() => {
    const tabs = [];
    if (taskCount) tabs.push({ id: "tasks", label: "Mes tâches" });
    if (waitingCount) tabs.push({ id: "queue", label: "À traiter" });
    if (deskItems.some((item) => item.tab === "history")) tabs.push({ id: "history", label: "Historique" });
    return tabs;
  }, [deskItems, taskCount, waitingCount]);

  /* --- Tiroirs ---------------------------------------------------------- */
  const [navOpen, setNavOpen] = useState(false);
  const [deskVisible, setDeskVisible] = useState(true);
  const [deskDrawerOpen, setDeskDrawerOpen] = useState(false);
  const [compactViewport, setCompactViewport] = useState(false);
  const navDrawerRef = useRef(null);
  const navButtonRef = useRef(null);
  const deskTriggerRef = useRef(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const sync = () => setCompactViewport(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!navOpen) return undefined;
    const trigger = navButtonRef.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () => Array.from(navDrawerRef.current?.querySelectorAll("a[href], button:not(:disabled)") ?? []);
    focusables()[0]?.focus();

    function onKeyDown(event) {
      if (event.key === "Escape") {
        setNavOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [navOpen]);

  useEffect(() => {
    if (!deskDrawerOpen) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") setDeskDrawerOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deskDrawerOpen]);

  async function handleShare() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Comexa — ${title}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNotice("Lien de la page copié dans le presse-papiers.");
    } catch {
      setNotice("Partage annulé.");
    }
  }

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /* --- Dock : actions rapides réellement autorisées -------------------- */
  const dockItems = useMemo(() => {
    const known = new Set(groups.flatMap((group) => group.items.map((item) => item.href)));
    const candidates = [
      { label: "Nouvel utilisateur", href: "/espace-equipe/membres", icon: UserPlus, tone: "blue", any: ["user:read:any"], teamOnly: true },
      { label: "Nouveau contenu", href: "/espace-equipe/contenu", icon: BookPlus, tone: "lilac", any: ["service:read:any", "package:read:any", "casestudy:read:any"], teamOnly: true },
      { label: "Nouveau devis", href: "/espace-equipe/devis/nouveau", icon: FilePlus, tone: "yellow", any: ["quote:read:any"], teamOnly: true },
      { label: "Nouvelle demande", href: "/espace-equipe/demandes", icon: Megaphone, tone: "pink", any: ["project_request:read:any"], teamOnly: true },
      { label: "Nouveau projet", href: "/espace-equipe/projets", icon: FolderKanban, tone: "green", any: ["project:read:any", "project:read:own", "project:read:assigned"], teamOnly: true },
      { label: "Voir les rapports", href: "/espace-equipe/analytique", icon: Download, tone: "blue", any: ["report:read:any"], teamOnly: true },
      { label: "Mes commandes", href: "/espace-client/commander", icon: CreditCard, tone: "green", any: ["order:read:own", "dashboard:read:own"], teamOnly: false },
      { label: "Mon espace", href: "/espace-client", icon: Users, tone: "lilac", any: ["user:read:own", "dashboard:read:own"], teamOnly: false },
    ];

    return candidates
      .filter((item) => (item.teamOnly ? team : !team))
      .filter((item) => item.any.some((permission) => can(user, permission)))
      .filter((item) => item.href === "/espace-client" || item.href === "/espace-client/commander" || known.has(item.href))
      .slice(0, 5)
      .map(({ label, href, icon, tone }) => ({ label, href, icon, tone }))
      .concat([{ label: "Plus d’actions", icon: Plus, tone: "ink", onClick: () => setNavOpen(true) }]);
  }, [groups, team, user]);

  const notificationsHref = canReadNotifications ? `${base}/notifications` : null;
  const homeHref = team ? "/espace-equipe" : "/espace-client";
  const showDesk = deskItems.length > 0;
  const deskSubtitleText = deskSubtitle(waitingCount, taskCount, unreadCount);

  return (
    <SoftMotionProvider>
      <ShellQueryContext.Provider value={shellContext}>
        <div className="sui-viewport">
          <a className="sui-skip" href="#sui-main">
            Passer à la zone de travail
          </a>

          <div className="sui-shell">
            <Navbar items={navItems} activeHref={activeHref} roleLabel={team ? "admin" : "client"} homeHref={homeHref} />

            <div className="sui-shell__body">
              <SideRail
                navigationButtonRef={navButtonRef}
                onOpenNavigation={() => setNavOpen(true)}
                onToggleDesk={() => (compactViewport ? setDeskDrawerOpen(true) : setDeskVisible((value) => !value))}
                deskOpen={compactViewport ? deskDrawerOpen : deskVisible}
                onShare={handleShare}
                unreadCount={unreadCount}
                notificationsHref={notificationsHref}
                onZoomIn={() => changeZoom(1)}
                onZoomOut={() => changeZoom(-1)}
                zoom={zoom}
                canZoomIn={zoom < ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                canZoomOut={zoom > ZOOM_STEPS[0]}
              />

              <main
                className="sui-main"
                id="sui-main"
                tabIndex={-1}
                style={{ "--sui-zoom": zoom }}
              >
                <span className="sui-notch" aria-hidden="true">
                  <span className="sui-notch__fillet sui-notch__fillet--left" />
                  <span className="sui-notch__fillet sui-notch__fillet--right" />
                </span>

                <div className="sui-main__scroll">
                  {compactViewport && showDesk ? (
                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                      <button
                        ref={deskTriggerRef}
                        type="button"
                        className="sui-btn sui-btn--dark"
                        onClick={() => setDeskDrawerOpen(true)}
                        aria-label={`Ouvrir l’Admin Desk (${deskSubtitleText})`}
                      >
                        <ListChecks size={17} strokeWidth={1.75} aria-hidden="true" />
                        Admin Desk
                        {waitingCount ? <StatusPill tone="green" label={waitingCount} /> : null}
                      </button>
                    </div>
                  ) : null}

                  <PageHeader
                    title={title}
                    subtitle={subtitle}
                    icon={PageIcon}
                    breadcrumb={`${space}${entry && entry.label !== title ? ` · ${entry.label}` : ""}`}
                    query={query}
                    onQueryChange={setQuery}
                    searchLabel={`Rechercher — ${title}`}
                  />

                  <AnimatePresence mode="wait" initial={false}>
                    <softMotion.div key={pathname} variants={pageTransition} initial="hidden" animate="visible" exit="exit">
                      {children}
                    </softMotion.div>
                  </AnimatePresence>
                </div>
              </main>

              {!compactViewport && showDesk && deskVisible ? (
                <AdminDeskPanel
                  subtitle={deskSubtitleText}
                  tabs={deskTabs}
                  items={deskItems}
                  onClose={() => setDeskVisible(false)}
                />
              ) : null}
            </div>

            {compactViewport && deskDrawerOpen ? (
              <>
                <button type="button" className="sui-scrim" aria-label="Fermer le panneau Admin Desk" onClick={() => setDeskDrawerOpen(false)} />
                <div className="sui-drawer">
                  <AdminDeskPanel
                    mode="drawer"
                    subtitle={deskSubtitleText}
                    tabs={deskTabs}
                    items={deskItems}
                    onClose={() => {
                      setDeskDrawerOpen(false);
                      deskTriggerRef.current?.focus();
                    }}
                  />
                </div>
              </>
            ) : null}

            {navOpen ? (
              <>
                <button type="button" className="sui-scrim" aria-label="Fermer la navigation" onClick={() => setNavOpen(false)} />
                <div className="sui-drawer sui-drawer--nav" ref={navDrawerRef} role="dialog" aria-modal="true" aria-label={`Toutes les rubriques — ${space}`}>
                  <div className="sui-drawer__head">
                    <h2 className="sui-drawer__title">Toutes les rubriques</h2>
                    <button type="button" className="sui-iconbtn" aria-label="Fermer la navigation" onClick={() => setNavOpen(false)}>
                      <X size={18} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="sui-drawer__scroll">
                    {groups.map((group) => (
                      <section className="sui-navgroup" key={group.label} aria-label={group.label}>
                        <h3 className="sui-navgroup__title">{group.label}</h3>
                        <ul>
                          {group.items.map((item) => {
                            const ItemIcon = NAV_ICONS[item.icon] ?? FALLBACK_ICON;
                            const active = isActiveHref(pathname, item.href);
                            return (
                              <li key={item.href}>
                                <Link href={item.href} className="sui-navgroup__link" aria-current={active ? "page" : undefined} onClick={() => setNavOpen(false)}>
                                  <ItemIcon size={18} strokeWidth={1.75} aria-hidden="true" />
                                  {item.label}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ))}
                  </div>
                </div>
              </>
            ) : null}

            <Dock items={dockItems} />
          </div>

          {notice ? (
            <p className="sui-tip" role="status" style={{ left: "50%", bottom: 28, top: "auto", transform: "translateX(-50%)" }}>
              {notice}
            </p>
          ) : null}
        </div>
      </ShellQueryContext.Provider>
    </SoftMotionProvider>
  );
}

function deskSubtitle(waitingCount, taskCount, unreadCount) {
  const parts = [`${waitingCount} à traiter`];
  if (taskCount) parts.push(`${taskCount} tâche${taskCount > 1 ? "s" : ""} en cours`);
  if (unreadCount) parts.push(`${unreadCount} non lue${unreadCount > 1 ? "s" : ""}`);
  return parts.join(" · ");
}
