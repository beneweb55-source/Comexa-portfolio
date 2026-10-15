"use client";

/*
 * Coque du tableau de bord — « soft UI pastel dans une coque noire ».
 *
 * Ce fichier n'est que la couche visuelle et la mise en page : les routes, les
 * appels d'API (`useListing`), les permissions (`can`) et les libellés métier
 * viennent des layouts et des pages, exactement comme avant.
 *
 * Structure (desktop) :
 *   1. coque noire arrondie (32 px) posée sur le halo bleu glacé `--backdrop` ;
 *   2. navbar noire 64 px : marque + badge de rôle, onglets autorisés dont seul
 *      l'onglet actif déplie sa pilule (framer-motion `layoutId`), profil ;
 *   3. panneau clair avec sa languette noire centrée (découpe à rayon inversé) ;
 *   4. rail gauche 56 px : partage, toutes les rubriques, Admin Desk, cloche
 *      avec compteur, boutons + / − (densité du texte) ;
 *   5. zone principale scrollable (en-tête, contenu de la page) ;
 *   6. Admin Desk à droite (~25 %, scroll indépendant), alimenté par l'API ;
 *   7. dock noir flottant en bas, aux actions autorisées.
 *
 * Responsive : < 1024 px le rail disparaît et l'Admin Desk devient un tiroir ;
 * < 768 px la navbar devient une barre d'icônes en bas, les grilles passent à
 * une colonne et le dock se compacte.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Bell,
  Briefcase,
  CalendarDays,
  CheckSquare,
  CreditCard,
  Download,
  FilePlus,
  FileText,
  FolderKanban,
  Globe,
  LayoutDashboard,
  Mail,
  Megaphone,
  Plus,
  Search,
  Settings2,
  ShoppingCart,
  Sparkles,
  TriangleAlert,
  UserPlus,
  Users,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { canReadOwnTasks } from "@/lib/timer-access";
import { TASK_STATUS } from "@/lib/labels";
import { formatDate, messageOf } from "@/lib/api";
import AdminDeskPanel from "./AdminDeskPanel";
import Dock from "./Dock";
import Navbar from "./Navbar";
import PageHeader from "./PageHeader";
import SideRail from "./SideRail";
import { SoftMotionProvider, pageTransition } from "./motion";
import { motion } from "framer-motion";
import { notificationMeta, resolveNotificationHref } from "./notification-map";
import { Button } from "./primitives";
import { relativeFr } from "./time";

/* -------------------------------------------------------------------------- */
/* Recherche du bandeau + raccourcis globaux, exposés aux pages                */
/* -------------------------------------------------------------------------- */

const ShellQueryContext = createContext({
  query: "",
  setQuery: () => {},
  openCommandPalette: () => {},
  openAiConsole: () => {},
});

/**
 * Permet à une page enfant de lire (et modifier) la recherche du bandeau, ou
 * d'ouvrir la palette de commandes / la console IA.
 */
export function useShellQuery() {
  return useContext(ShellQueryContext);
}

function triggerAiConsole() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("comexa:open-ai-console"));
  }
}

/* -------------------------------------------------------------------------- */
/* Métadonnées de navigation                                                   */
/* -------------------------------------------------------------------------- */

/*
 * Une seule source d'icônes (lucide-react) et des pictogrammes cohérents avec
 * le métier : un tableau de bord pour le pilotage, un dossier pour les projets,
 * un calendrier pour l'agenda — jamais de camembert ni de boîte de réception
 * hors de leur sens.
 */
const ROUTE_META = {
  // Espace équipe
  "/espace-equipe/tableau-de-bord": { icon: LayoutDashboard, group: "Pilotage", shortLabel: "Tableau de bord" },
  "/espace-equipe/analytique": { icon: BarChart3, group: "Pilotage", shortLabel: "Analytique" },
  "/espace-equipe/calendrier": { icon: CalendarDays, group: "Pilotage", shortLabel: "Calendrier" },
  "/espace-equipe/rapports": { icon: FileText, group: "Pilotage", shortLabel: "Rapports" },
  "/espace-equipe/rapports-journaliers": { icon: FilePlus, group: "Pilotage", shortLabel: "Rapports journaliers" },

  "/espace-equipe/contacts": { icon: Mail, group: "Commercial & CRM", shortLabel: "Demandes de contact" },
  "/espace-equipe/demandes": { icon: Briefcase, group: "Commercial & CRM", shortLabel: "Demandes de projet" },
  "/espace-equipe/prospects": { icon: Users, group: "Commercial & CRM", shortLabel: "Prospects (pipeline)" },
  "/espace-equipe/clients": { icon: Users, group: "Commercial & CRM", shortLabel: "Clients" },
  "/espace-equipe/commandes": { icon: ShoppingCart, group: "Commercial & CRM", shortLabel: "Commandes" },

  "/espace-equipe/projets": { icon: FolderKanban, group: "Production", shortLabel: "Projets" },
  "/espace-equipe/taches": { icon: CheckSquare, group: "Production", shortLabel: "Tâches & Kanban" },
  "/espace-equipe/modifications": { icon: Wrench, group: "Production", shortLabel: "Modifications" },
  "/espace-equipe/temps": { icon: BarChart3, group: "Production", shortLabel: "Feuille de temps" },

  "/espace-equipe/devis": { icon: FileText, group: "Facturation", shortLabel: "Devis" },
  "/espace-equipe/factures": { icon: CreditCard, group: "Facturation", shortLabel: "Factures" },

  "/espace-equipe/messagerie": { icon: Mail, group: "Communication", shortLabel: "Messagerie" },
  "/espace-equipe/notifications": { icon: Bell, group: "Communication", shortLabel: "Notifications" },
  "/espace-equipe/contenu": { icon: Globe, group: "Communication", shortLabel: "Contenu du site" },

  "/espace-equipe/membres": { icon: UserPlus, group: "Administration", shortLabel: "Membres" },
  "/espace-equipe/roles": { icon: Users, group: "Administration", shortLabel: "Rôles & droits" },
  "/espace-equipe/parametres": { icon: Settings2, group: "Administration", shortLabel: "Paramètres" },
  "/espace-equipe/integrations": { icon: Settings2, group: "Administration", shortLabel: "API & intégrations" },
  "/espace-equipe/journal": { icon: FileText, group: "Administration", shortLabel: "Journal d’audit" },
  "/espace-equipe/compte": { icon: Settings2, group: "Administration", shortLabel: "Mon compte" },

  // Espace client
  "/espace-client": { icon: LayoutDashboard, group: "Mon espace", shortLabel: "Vue d’ensemble" },
  "/espace-client/tableau-de-bord": { icon: BarChart3, group: "Mon espace", shortLabel: "Tableau de bord" },
  "/espace-client/commander": { icon: ShoppingCart, group: "Mon espace", shortLabel: "Commander un pack" },
  "/espace-client/modifications": { icon: Wrench, group: "Suivi & échanges", shortLabel: "Modifications" },
  "/espace-client/messagerie": { icon: Mail, group: "Suivi & échanges", shortLabel: "Messagerie" },
  "/espace-client/notifications": { icon: Bell, group: "Suivi & échanges", shortLabel: "Notifications" },
  "/espace-client/compte": { icon: Settings2, group: "Suivi & échanges", shortLabel: "Mon compte" },
};

const GROUP_ORDER_TEAM = [
  "Pilotage",
  "Commercial & CRM",
  "Production",
  "Facturation",
  "Communication",
  "Administration",
];

const GROUP_ORDER_CLIENT = ["Mon espace", "Suivi & échanges"];

/*
 * Onglets affichés sur la navbar (6 à 8, dans cet ordre de priorité) : ce sont
 * les rubriques les plus utilisées, parmi celles que le porteur a le droit de
 * voir. Les autres restent accessibles par le tiroir « Toutes les rubriques ».
 */
const PREFERRED_TEAM_TABS = [
  "/espace-equipe/tableau-de-bord",
  "/espace-equipe/projets",
  "/espace-equipe/taches",
  "/espace-equipe/clients",
  "/espace-equipe/devis",
  "/espace-equipe/factures",
  "/espace-equipe/commandes",
  "/espace-equipe/messagerie",
];

const PREFERRED_CLIENT_TABS = [
  "/espace-client",
  "/espace-client/tableau-de-bord",
  "/espace-client/commander",
  "/espace-client/modifications",
  "/espace-client/messagerie",
  "/espace-client/notifications",
];

/* Pastel de la pastille d'en-tête, déduit du pôle de la rubrique : les
   catégories gardent la même couleur d'une page à l'autre. */
const GROUP_TONE = {
  Pilotage: "blue",
  "Commercial & CRM": "green",
  Production: "yellow",
  Facturation: "lilac",
  Communication: "pink",
  Administration: "lilac",
  "Mon espace": "blue",
  "Suivi & échanges": "green",
  Autres: "blue",
};

function metaFor(href) {
  return ROUTE_META[href] ?? { icon: Briefcase, group: "Autres", shortLabel: href };
}

function isActivePath(pathname, href) {
  if (!pathname || !href) return false;
  if (href === "/espace-client" || href === "/espace-equipe") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initialsOf(person) {
  if (!person) return "CX";
  const pair = `${person.firstName?.[0] ?? ""}${person.lastName?.[0] ?? ""}`.trim();
  if (pair) return pair.toLocaleUpperCase("fr-FR");
  return (person.email?.slice(0, 2) ?? "CX").toLocaleUpperCase("fr-FR");
}

/** Densité du panneau principal, mémorisée localement (boutons + / − du rail). */
const ZOOM_STEPS = [0.9, 1, 1.1, 1.2];
const ZOOM_KEY = "comexa:panel-zoom";

function readZoom() {
  if (typeof window === "undefined") return 1;
  try {
    const raw = window.localStorage.getItem(ZOOM_KEY);
    const value = Number(raw);
    return ZOOM_STEPS.includes(value) ? value : 1;
  } catch {
    return 1;
  }
}

/** Largeur réellement disponible (le rail et l'Admin Desk changent de forme). */
function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/* -------------------------------------------------------------------------- */
/* Coque                                                                       */
/* -------------------------------------------------------------------------- */

export function WorkspaceSoftShell({ area, title, subtitle, links = [], children }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { user, request } = useAuth();
  const isTeam = area === "equipe";
  const skipId = useId();

  const [query, setQuery] = useState("");
  const [zoomIndex, setZoomIndex] = useState(() => ZOOM_STEPS.indexOf(readZoom()));
  const [navOpen, setNavOpen] = useState(false);
  const [deskOpen, setDeskOpen] = useState(false);
  const [deskHidden, setDeskHidden] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const mainRef = useRef(null);

  const isCompact = useMediaQuery("(max-width: 1023px)");
  const isMobile = useMediaQuery("(max-width: 767px)");

  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;

  const setZoom = useCallback((index) => {
    const clamped = Math.max(0, Math.min(ZOOM_STEPS.length - 1, index));
    setZoomIndex(clamped);
    try {
      window.localStorage.setItem(ZOOM_KEY, String(ZOOM_STEPS[clamped]));
    } catch {
      // stockage indisponible : la préférence reste valable pour la session
    }
  }, []);

  /* Fermeture des tiroirs au changement de route. */
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setNavOpen(false);
    setDeskOpen(false);
    setCmdkOpen(false);
    setQuery("");
  }

  /* Raccourcis clavier : ⌘K / Ctrl+K (palette), Échap (tiroirs). */
  useEffect(() => {
    function onKeyDown(event) {
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      const meta = event.metaKey || event.ctrlKey;
      if (meta && !event.shiftKey && !event.altKey && key === "k") {
        event.preventDefault();
        setCmdkOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /* Données réelles du panneau droit et du compteur de la cloche. */
  const unreadProbe = useListing("/notifications?read=false&page=1&perPage=1");
  const recentNotifications = useListing("/notifications?page=1&perPage=6");
  const canReadActivity = isTeam && (can(user, "activity:read:any") || can(user, "activity:read:client"));
  const canReadTasks = canReadOwnTasks(user);
  const myTasks = useListing(canReadTasks ? "/me/tasks?page=1&perPage=20" : null);

  const unreadCount = Number.isFinite(Number(unreadProbe.meta?.total)) ? Number(unreadProbe.meta.total) : 0;

  /* Toutes les rubriques autorisées, groupées comme dans les layouts. */
  const groupedLinks = useMemo(() => {
    const order = isTeam ? GROUP_ORDER_TEAM : GROUP_ORDER_CLIENT;
    const buckets = new Map(order.map((group) => [group, []]));
    buckets.set("Autres", []);

    for (const link of links) {
      const meta = metaFor(link.href);
      const groupName = buckets.has(meta.group) ? meta.group : order[0];
      buckets.get(groupName).push({
        ...link,
        icon: meta.icon,
        shortLabel: meta.shortLabel ?? link.label,
        active: isActivePath(pathname, link.href),
        badge: link.href.endsWith("/notifications") && unreadCount > 0 ? unreadCount : null,
      });
    }

    return [...buckets.entries()]
      .filter(([, items]) => items.length > 0)
      .map(([group, items]) => ({ group, items }));
  }, [isTeam, links, pathname, unreadCount]);

  const allowedLinks = useMemo(() => groupedLinks.flatMap((group) => group.items), [groupedLinks]);

  /* Onglets de la navbar : 6 à 8 rubriques autorisées, priorité fixe. */
  const navItems = useMemo(() => {
    const preferred = isTeam ? PREFERRED_TEAM_TABS : PREFERRED_CLIENT_TABS;
    const byHref = new Map(allowedLinks.map((link) => [link.href, link]));
    const picked = preferred.filter((href) => byHref.has(href)).map((href) => byHref.get(href));
    const rest = allowedLinks.filter((link) => !preferred.includes(link.href));
    return [...picked, ...rest].slice(0, 8).map((link) => ({
      href: link.href,
      label: link.shortLabel,
      shortLabel: link.label,
      icon: link.icon,
    }));
  }, [allowedLinks, isTeam]);

  const activeHref = useMemo(() => {
    const exact = navItems.find((item) => item.href === pathname);
    if (exact) return exact.href;
    const prefix = navItems.find((item) => isActivePath(pathname, item.href));
    return prefix?.href ?? navItems[0]?.href ?? pathname;
  }, [navItems, pathname]);

  /* Rubrique courante : titre, sous-titre et icône de l'en-tête de page. */
  const activeLink = useMemo(() => {
    const exact = allowedLinks.find((link) => link.href === pathname);
    if (exact) return exact;
    const prefix = allowedLinks.find((link) => isActivePath(pathname, link.href));
    return prefix ?? null;
  }, [allowedLinks, pathname]);

  const isDashboard = pathname === "/espace-equipe/tableau-de-bord" || pathname === "/espace-client/tableau-de-bord";
  const pageHeading = activeLink?.label ?? title;
  const pageIcon = activeLink?.icon ?? (isTeam ? LayoutDashboard : Briefcase);
  const pageBreadcrumb = `${title} · ${activeLink ? metaFor(activeLink.href).group : "Vue courante"}`;
  const pageTone = GROUP_TONE[activeLink ? metaFor(activeLink.href).group : "Autres"] ?? "blue";
  const pageSubtitle =
    subtitle ??
    (isDashboard
      ? "Vos priorités, vos chiffres et ce qui attend une décision."
      : activeLink?.label
        ? `${metaFor(activeLink.href).group} — ${title}`
        : title);

  /* Recherche du bandeau : utile seulement si la page la consomme. */
  const searchWired = !isDashboard && Boolean(activeLink);

  /* Action principale contextuelle (aucun bouton mort : droits vérifiés).
     Sur la page de création elle-même, le bouton pointerait sur la page
     courante : on le masque. Sur la liste des devis, c'est CE bouton qui fait
     office de CTA unique (la page ne le double plus dans ses filtres). */
  const primaryAction = useMemo(() => {
    if (isTeam) {
      if (pathname === "/espace-equipe/devis/nouveau") return null;
      if (can(user, "quote:write:any")) {
        return { label: "Nouveau devis", href: "/espace-equipe/devis/nouveau", icon: FilePlus };
      }
      return null;
    }
    return { label: "Commander un pack", href: "/espace-client/commander", icon: ShoppingCart };
  }, [isTeam, pathname, user]);

  /* ---------------------------------------------------------------------- */
  /* Admin Desk : onglets et cartes teintées issus de l'API                  */
  /* ---------------------------------------------------------------------- */

  const desk = useMemo(() => {
    const tabs = [];
    const items = [];

    const openTasks = (myTasks.items ?? []).filter((task) =>
      ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"].includes(task.status),
    );

    if (canReadTasks) {
      tabs.push({ id: "taches", label: "Mes tâches" });
      openTasks.slice(0, 6).forEach((task) => {
        items.push({
          id: `task-${task.id}`,
          tab: "taches",
          tone: task.status === "BLOCKED" ? "pink" : "blue",
          icon: task.status === "BLOCKED" ? TriangleAlert : FolderKanban,
          type: TASK_STATUS[task.status] ?? "Tâche",
          date: task.dueDate ? formatDate(task.dueDate) : "Sans échéance",
          lines: [
            task.title,
            task.project?.name ?? "Hors projet",
            task.priority ? `Priorité ${String(task.priority).toLowerCase()}` : "À traiter",
          ],
          cta: {
            label: "Ouvrir la tâche",
            icon: CheckSquare,
            href: task.projectId ? `/espace-equipe/projets/${task.projectId}` : "/espace-equipe/taches",
          },
        });
      });
    }

    tabs.push({ id: "notifications", label: "À traiter" });
    (recentNotifications.items ?? []).slice(0, 6).forEach((notification) => {
      const meta = notificationMeta(notification.type);
      items.push({
        id: `notification-${notification.id}`,
        tab: "notifications",
        tone: meta.tone === "plain" ? "yellow" : meta.tone,
        icon: meta.icon,
        type: meta.label,
        date: relativeFr(notification.createdAt),
        lines: [
          notification.title || "Notification",
          notification.body ?? "Aucun détail supplémentaire.",
          notification.read ? "Lue" : "Non lue",
        ],
        cta: {
          label: notification.read ? "Voir" : "Traiter",
          icon: notification.read ? Search : Bell,
          href: resolveNotificationHref(notification.link, isTeam),
        },
      });
    });

    const waiting = openTasks.length + unreadCount;
    const live = (recentNotifications.items ?? []).filter((n) => !n.read).length;
    const subtitleParts = [];
    if (canReadTasks) subtitleParts.push(`${openTasks.length} tâche${openTasks.length > 1 ? "s" : ""} à traiter`);
    subtitleParts.push(`${unreadCount} notification${unreadCount > 1 ? "s" : ""} non lue${unreadCount > 1 ? "s" : ""}`);
    if (canReadActivity && live) subtitleParts.push(`${live} nouveauté${live > 1 ? "s" : ""}`);

    const error = myTasks.error || recentNotifications.error;
    /* Tant qu'une source charge et que rien n'est encore arrivé, le panneau
       affiche « Chargement… » plutôt qu'un « Rien à traiter » mensonger. */
    const loading =
      items.length === 0 && (myTasks.loading || recentNotifications.loading);

    return { tabs, items, subtitle: subtitleParts.join(" · "), waiting, error: error ? messageOf(error) : null, loading };
  }, [canReadActivity, canReadTasks, isTeam, myTasks, recentNotifications, unreadCount]);

  /* ---------------------------------------------------------------------- */
  /* Dock : cinq boutons pastel autorisés + le « + » noir cerclé             */
  /* ---------------------------------------------------------------------- */

  const dockItems = useMemo(() => {
    const items = [];
    if (isTeam) {
      if (can(user, "user:write:any") || can(user, "user:invite:any")) {
        items.push({ label: "Ajouter un membre", href: "/espace-equipe/membres", icon: UserPlus, tone: "blue" });
      }
      if (can(user, "quote:write:any")) {
        items.push({ label: "Créer un devis", href: "/espace-equipe/devis/nouveau", icon: FilePlus, tone: "lilac" });
      }
      if (can(user, "task:read:any") || can(user, "task:read:assigned") || can(user, "task:read:own")) {
        items.push({ label: "Planifier un événement", href: "/espace-equipe/calendrier", icon: CalendarDays, tone: "pink" });
      }
      if (can(user, "conversation:read:own")) {
        items.push({ label: "Écrire à un client", href: "/espace-equipe/messagerie", icon: Megaphone, tone: "yellow" });
      }
      if (can(user, "report:read:any")) {
        items.push({ label: "Exporter les rapports", href: "/espace-equipe/rapports", icon: Download, tone: "green" });
      }
      if (can(user, "activity:read:any") || can(user, "activity:read:client")) {
        items.push({ label: "Console IA Comexa", icon: Sparkles, tone: "blue", onClick: triggerAiConsole });
      }
    } else {
      items.push({ label: "Commander un pack", href: "/espace-client/commander", icon: ShoppingCart, tone: "blue" });
      if (can(user, "modificationrequest:write:own") || can(user, "modificationrequest:read:own")) {
        items.push({ label: "Demander une modification", href: "/espace-client/modifications", icon: Wrench, tone: "lilac" });
      }
      if (can(user, "conversation:read:own")) {
        items.push({ label: "Écrire à l’équipe", href: "/espace-client/messagerie", icon: Mail, tone: "pink" });
      }
      items.push({ label: "Voir mes notifications", href: "/espace-client/notifications", icon: Bell, tone: "yellow" });
      items.push({ label: "Imprimer cette vue", icon: Download, tone: "green", onClick: () => window.print() });
    }

    items.push({ label: "Toutes les rubriques", icon: Plus, tone: "ink", onClick: () => setNavOpen(true) });
    return items.slice(-6);
  }, [isTeam, user]);

  /* ---------------------------------------------------------------------- */
  /* Actions du rail                                                         */
  /* ---------------------------------------------------------------------- */

  const shareScreen = useCallback(async () => {
    if (typeof navigator === "undefined") return;
    try {
      if (navigator.share) {
        await navigator.share({ title, url: window.location.href });
        return;
      }
      await navigator.clipboard?.writeText(window.location.href);
    } catch {
      // partage refusé ou presse-papiers indisponible : on ne fait rien
    }
  }, [title]);

  /* Le même bouton a deux comportements cohérents : il masque l'Admin Desk
     intégré sur grand écran, il l'ouvre en tiroir sous 1024 px. */
  const toggleDesk = useCallback(() => {
    if (isCompact) setDeskOpen((open) => !open);
    else setDeskHidden((hidden) => !hidden);
  }, [isCompact]);

  const contextValue = useMemo(
    () => ({ query, setQuery, openCommandPalette: () => setCmdkOpen(true), openAiConsole: triggerAiConsole }),
    [query],
  );

  const deskElement = (
    <AdminDeskPanel
      key={desk.tabs.map((tab) => tab.id).join("-")}
      title="Admin Desk"
      subtitle={desk.subtitle}
      error={desk.error}
      loading={desk.loading}
      onRetry={() => {
        myTasks.reload();
        recentNotifications.reload();
      }}
      tabs={desk.tabs}
      items={desk.items}
      mode={isCompact ? "drawer" : "inline"}
      onClose={isCompact ? () => setDeskOpen(false) : undefined}
    />
  );

  return (
    <ShellQueryContext.Provider value={contextValue}>
      <SoftMotionProvider>
        <div className="sui-viewport">
          <a className="sui-skip" href={`#${skipId}`}>
            Passer à la zone de travail
          </a>

          <div className="sui-shell">
            <Navbar
              items={navItems}
              activeHref={activeHref}
              roleLabel={isTeam ? "admin" : "client"}
              homeHref={isTeam ? "/espace-equipe/tableau-de-bord" : "/espace-client"}
            />

            <div className="sui-shell__body">
              <SideRail
                onShare={shareScreen}
                onOpenNavigation={() => setNavOpen(true)}
                onToggleDesk={toggleDesk}
                deskOpen={isCompact ? deskOpen : !deskHidden}
                unreadCount={unreadCount}
                notificationsHref={isCompact ? undefined : (isTeam ? "/espace-equipe/notifications" : "/espace-client/notifications")}
                onZoomIn={() => setZoom(zoomIndex + 1)}
                onZoomOut={() => setZoom(zoomIndex - 1)}
                canZoomIn={zoomIndex < ZOOM_STEPS.length - 1}
                canZoomOut={zoomIndex > 0}
                zoom={zoom}
                extra={
                  isCompact ? (
                    <button
                      type="button"
                      className="sui-rail__btn"
                      aria-label={unreadCount ? `Notifications, ${unreadCount} non lues` : "Notifications"}
                      onClick={() => setDeskOpen(true)}
                    >
                      <Bell size={18} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  ) : null
                }
              />

              <main className="sui-main" id={skipId} ref={mainRef} aria-label={pageHeading}>
                <span className="sui-notch" aria-hidden="true">
                  <span className="sui-notch__fillet sui-notch__fillet--left" />
                  <span className="sui-notch__fillet sui-notch__fillet--right" />
                </span>

                <div className="sui-main__scroll" style={{ "--zoom": zoom }}>
                  <motion.div
                    key={pathname}
                    className="sui-canvas-inner"
                    initial="hidden"
                    animate="visible"
                    variants={pageTransition}
                  >
                    <PageHeader
                      title={pageHeading}
                      subtitle={pageSubtitle}
                      icon={pageIcon}
                      iconTone={pageTone}
                      breadcrumb={pageBreadcrumb}
                      query={query}
                      onQueryChange={searchWired ? setQuery : undefined}
                      searchPlaceholder={`Rechercher dans ${pageHeading.toLowerCase()}…`}
                      searchLabel={`Rechercher dans ${pageHeading}`}
                      actions={
                        isTeam ? (
                          <Button
                            icon={Search}
                            className="sui-global-search"
                            aria-label="Recherche globale (Ctrl+K)"
                            title="Recherche globale (Ctrl+K)"
                            onClick={() => setCmdkOpen(true)}
                          >
                            Recherche globale
                          </Button>
                        ) : null
                      }
                      primaryAction={isMobile ? null : primaryAction}
                    />
                    {children}
                  </motion.div>
                </div>
              </main>

              {!isCompact && !deskHidden ? deskElement : null}
            </div>

            <Dock items={dockItems} label={isTeam ? "Actions rapides de l’espace équipe" : "Actions rapides de mon espace"} />

            {/* Barre d'icônes mobile : la navbar descend en bas de la coque. */}
            {isMobile ? (
              <nav className="sui-mobile-tabbar" aria-label="Navigation principale">
                {navItems.slice(0, 4).map((item) => {
                  const active = item.href === activeHref;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`sui-mobile-tab${active ? " sui-mobile-tab--active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      aria-label={item.label}
                      title={item.label}
                    >
                      <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />
                      <span>{item.shortLabel ?? item.label}</span>
                    </Link>
                  );
                })}
                <button
                  type="button"
                  className={`sui-mobile-tab${navOpen ? " sui-mobile-tab--active" : ""}`}
                  aria-expanded={navOpen}
                  aria-label="Toutes les rubriques"
                  onClick={() => setNavOpen(true)}
                >
                  <Settings2 size={20} strokeWidth={1.75} aria-hidden="true" />
                  <span>Rubriques</span>
                </button>
              </nav>
            ) : null}

            {/* Tiroir Admin Desk (< 1024 px). */}
            {isCompact && deskOpen ? (
              <>
                <div className="sui-scrim" role="presentation" onClick={() => setDeskOpen(false)} />
                <div className="sui-drawer sui-drawer--right" role="dialog" aria-modal="true" aria-label="Admin Desk">
                  {deskElement}
                </div>
              </>
            ) : null}

            {/* Tiroir « Toutes les rubriques » : aucune route n'est cachée. */}
            {navOpen ? (
              <>
                <div className="sui-scrim" role="presentation" onClick={() => setNavOpen(false)} />
                <NavDrawer
                  title={title}
                  groupedLinks={groupedLinks}
                  accountHref={isTeam ? "/espace-equipe/compte" : "/espace-client/compte"}
                  onClose={() => setNavOpen(false)}
                  onOpenCommandPalette={() => {
                    setNavOpen(false);
                    setCmdkOpen(true);
                  }}
                />
              </>
            ) : null}

            {/* Palette de commandes globale (⌘K / Ctrl+K). */}
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
        </div>
      </SoftMotionProvider>
    </ShellQueryContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* Tiroir de navigation                                                        */
/* -------------------------------------------------------------------------- */

function NavDrawer({ title, groupedLinks, accountHref, onClose, onOpenCommandPalette }) {
  const titleId = useId();
  const firstLinkRef = useRef(null);

  useEffect(() => {
    firstLinkRef.current?.focus();
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sui-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="sui-drawer__head">
        <div>
          <h2 className="sui-drawer__title" id={titleId}>
            {title}
          </h2>
          <p className="sui-desk__sub">Toutes les rubriques autorisées, groupées par pôle.</p>
        </div>
        <button type="button" className="sui-iconbtn" aria-label="Fermer les rubriques" onClick={onClose}>
          <X size={19} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <button type="button" className="sui-btn sui-btn--dark" onClick={onOpenCommandPalette}>
        <Search size={17} strokeWidth={1.75} aria-hidden="true" />
        Rechercher une rubrique ou une donnée
      </button>

      <div className="sui-drawer__body">
        {groupedLinks.map(({ group, items }) => (
          <div className="sui-drawer__group" key={group}>
            <span className="sui-drawer__group-label">{group}</span>
            <div className="sui-drawer__grid">
              {items.map((item, index) => (
                <Link
                  key={item.href}
                  ref={index === 0 && group === groupedLinks[0]?.group ? firstLinkRef : undefined}
                  href={item.href}
                  className={`sui-drawer__link${item.active ? " sui-drawer__link--active" : ""}`}
                  aria-current={item.active ? "page" : undefined}
                  onClick={onClose}
                >
                  <item.icon size={18} strokeWidth={1.75} aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.badge ? <span className="sui-drawer__badge">{item.badge}</span> : null}
                </Link>
              ))}
            </div>
          </div>
        ))}

        <div className="sui-drawer__group">
          <span className="sui-drawer__group-label">Comexa</span>
          <div className="sui-drawer__grid">
            {/* Sous 768 px la navbar (et donc le menu compte) disparaît : le
                tiroir reste le seul point d'accès au compte. */}
            <Link href={accountHref} className="sui-drawer__link" onClick={onClose}>
              <UserRound size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>Mon compte</span>
            </Link>
            <Link href="/" className="sui-drawer__link" onClick={onClose}>
              <Globe size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>Site public Comexa</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Palette de commandes (⌘K) — inchangée sur le fond, rhabillée soft UI        */
/* -------------------------------------------------------------------------- */

function CommandPaletteModal({ isTeam, groupedLinks, request, user, onClose, onNavigate }) {
  const inputRef = useRef(null);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const term = search.trim();
  /*
   * Résultats directs (clients, projets, devis) : l'état porte le terme auquel
   * il correspond, donc aucun `setState` n'est nécessaire pour les vider quand
   * la saisie redevient trop courte — l'affichage est dérivé, pas synchronisé.
   */
  const [live, setLive] = useState({ term: "", results: [], pending: false });
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (term.length < 2 || !isTeam) return undefined;

    const controller = new AbortController();
    let disposed = false;
    /* Le drapeau « recherche en cours » est posé après l'anti-rebond : l'effet
       reste une simple souscription à une source externe (l'API). */
    const timer = setTimeout(() => {
      if (disposed || controller.signal.aborted) return;
      setLive((current) => (current.pending ? current : { ...current, pending: true }));

      const queries = [];
      if (can(user, "client:read:any")) {
        queries.push(
          request(`/clients?search=${encodeURIComponent(term)}&perPage=3`, { signal: controller.signal })
            .then((res) =>
              (res?.data ?? []).map((client) => ({
                id: `client-${client.id}`,
                group: "Résultats directs",
                label: client.companyName,
                sub: `Client · ${client.reference ?? ""}`,
                href: `/espace-equipe/clients/${client.id}`,
                icon: Users,
              })),
            )
            .catch(() => []),
        );
      }
      if (can(user, "project:read:any") || can(user, "project:read:assigned") || can(user, "project:read:own")) {
        queries.push(
          request(`/projects?search=${encodeURIComponent(term)}&perPage=3`, { signal: controller.signal })
            .then((res) =>
              (res?.data ?? []).map((project) => ({
                id: `project-${project.id}`,
                group: "Résultats directs",
                label: project.name,
                sub: `Projet · ${project.reference ?? ""}`,
                href: `/espace-equipe/projets/${project.id}`,
                icon: FolderKanban,
              })),
            )
            .catch(() => []),
        );
      }
      if (can(user, "quote:read:any")) {
        queries.push(
          request(`/quotes?search=${encodeURIComponent(term)}&perPage=3`, { signal: controller.signal })
            .then((res) =>
              (res?.data ?? []).map((quote) => ({
                id: `quote-${quote.id}`,
                group: "Résultats directs",
                label: quote.subject || quote.reference,
                sub: `Devis · ${quote.reference ?? ""}`,
                href: `/espace-equipe/devis/${quote.id}`,
                icon: FileText,
              })),
            )
            .catch(() => []),
        );
      }

      Promise.all(queries)
        .then((lists) => {
          if (disposed || controller.signal.aborted) return;
          setLive({ term, results: lists.flat(), pending: false });
        })
        .catch(() => {
          if (disposed || controller.signal.aborted) return;
          setLive((current) => ({ ...current, pending: false }));
        });
    }, 220);

    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [isTeam, request, term, user]);

  const quickActions = useMemo(() => {
    const actions = [];
    if (isTeam) {
      actions.push({
        id: "act-ai-console",
        group: "Actions rapides",
        label: "Ouvrir la console IA Comexa",
        sub: "Pilotage en langage naturel",
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
          icon: FilePlus,
        });
      }
      if (can(user, "time:write:own") || can(user, "time:write:any")) {
        actions.push({
          id: "act-log-time",
          group: "Actions rapides",
          label: "Saisir du temps ou consulter ma feuille",
          sub: "Production",
          href: "/espace-equipe/temps",
          icon: BarChart3,
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

    if (normalized.length >= 2 && live.term === normalized) out.push(...live.results);
    for (const action of quickActions) {
      if (match(action.label) || match(action.sub)) out.push(action);
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
  }, [groupedLinks, live, quickActions, search]);

  const clampedActiveIndex = flatEntries.length > 0 ? Math.min(activeIndex, flatEntries.length - 1) : 0;

  function executeEntry(entry) {
    if (!entry) return;
    if (entry.onSelect) entry.onSelect();
    else if (entry.href) onNavigate(entry.href);
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (flatEntries.length > 0) setActiveIndex((index) => (index + 1) % flatEntries.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (flatEntries.length > 0) setActiveIndex((index) => (index - 1 + flatEntries.length) % flatEntries.length);
      return;
    }
    if (event.key === "Enter" && flatEntries[clampedActiveIndex]) {
      executeEntry(flatEntries[clampedActiveIndex]);
    }
  }

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
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="sui-cmdk__header">
          <Search size={18} strokeWidth={1.75} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="Aller à une rubrique, chercher un client, un projet, un devis…"
            className="sui-cmdk__input"
            aria-label="Rechercher une rubrique ou une action"
          />
          {live.pending ? <span className="sui-desk__sub">Recherche…</span> : null}
          <button type="button" onClick={onClose} className="sui-kbd">
            Échap
          </button>
        </div>

        <div className="sui-cmdk__body" role="listbox" aria-label="Résultats">
          {sections.length === 0 ? (
            <p className="sui-card__desc">Aucun résultat pour « {search} ».</p>
          ) : (
            sections.map(([groupTitle, entries]) => (
              <div key={groupTitle}>
                <div className="sui-cmdk__group-title">{groupTitle}</div>
                {entries.map((entry) => {
                  const Icon = entry.icon ?? Search;
                  const selected = entry.globalIndex === clampedActiveIndex;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setActiveIndex(entry.globalIndex)}
                      onClick={() => executeEntry(entry)}
                      className={`sui-cmdk__item${selected ? " sui-cmdk__item--active" : ""}`}
                    >
                      <span className="sui-cmdk__item-left">
                        <span className="sui-cmdk__item-icon" aria-hidden="true">
                          <Icon size={16} strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-bold">{entry.label}</span>
                          {entry.sub ? <span className="block truncate sui-desk__sub">{entry.sub}</span> : null}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="sui-cmdk__footer">
          <span>
            <kbd className="sui-kbd">↑</kbd>
            <kbd className="sui-kbd">↓</kbd>
            Naviguer · <kbd className="sui-kbd">Entrée</kbd> Ouvrir
          </span>
          <span>Commandes Comexa · ⌘K</span>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceSoftShell;
