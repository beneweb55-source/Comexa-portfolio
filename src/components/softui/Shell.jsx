"use client";

/*
 * Coque des espaces — « soft UI pastel dans une coque noire ».
 *
 * Ce fichier est la couche visuelle et la mise en page : les routes, les appels
 * d'API, les permissions et les libellés métier viennent des layouts (rubriques
 * déjà filtrées par les droits de l'espace) et des pages.
 *
 * Structure (desktop) :
 *   1. coque noire arrondie (32 px) posée sur le halo bleu glacé `--backdrop` ;
 *   2. navbar noire 64 px : marque, SÉLECTEUR D'ESPACE, onglets de l'espace
 *      (la rubrique courante est toujours représentée), profil ;
 *   3. languette noire alignée sur l'onglet actif (elle le suit) ;
 *   4. rail gauche 56 px : partage, toutes les rubriques, panneau de suivi,
 *      cloche (compteur de l'espace), boutons + / − (densité du texte) ;
 *   5. zone principale scrollable (en-tête, contenu de la page) ;
 *   6. panneau de suivi à droite (~25 %), alimenté par l'API de l'espace ;
 *   7. dock flottant : actions de l'espace, minuteur et console Comexa.
 *
 * Responsive : < 1024 px le rail disparaît et le panneau devient un tiroir ;
 * < 768 px (et téléphone à l'horizontale) la navbar et le dock laissent place
 * à une barre d'application (espace, recherche, minuteur) et à des onglets
 * en bas. Les actions rapides du dock vivent dans le tiroir « Plus ».
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
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  CheckSquare,
  ChevronDown,
  FileText,
  FolderKanban,
  Globe,
  LayoutGrid,
  Search,
  Target,
  TriangleAlert,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import { useOptionalFocus } from "@/components/focus/FocusProvider";
import { can as canFor } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { useAllListing } from "@/lib/use-all-listing";
import { WORKSPACE_UPDATED } from "@/lib/workspace-updates.mjs";
import LiveNotification from "@/components/workspace/LiveNotification";
import { canReadOwnTasks } from "@/lib/timer-access";
import { TASK_STATUS } from "@/lib/labels";
import { formatDate, messageOf } from "@/lib/api";
import { SPACES, SPACE_IDS } from "@/lib/spaces";
import { useSpaces } from "@/lib/spaces-context";
import { DocumentDeletionFeedback } from "@/components/workspace/DeleteDocumentButton";
import AdminDeskPanel from "./AdminDeskPanel";
import Dock from "./Dock";
import Navbar from "./Navbar";
import Notch from "./Notch";
import PageHeader from "./PageHeader";
import PageTransition from "./PageTransition";
import SideRail from "./SideRail";
import { SpaceSwitcherList } from "./SpaceSwitcher";
import { SoftMotionProvider } from "./motion";
import { notificationMeta, resolveNotificationHref } from "./notification-map";
import { relativeFr } from "./time";
import {
  PREFERRED_TABS,
  SEARCH_SOURCES,
  defaultPrimaryAction,
  dockActions,
  paletteActions,
  sectionMeta,
  sectionOf,
} from "./space-config";
import logoLight from "../../../public/comexa-logo-horizontal-clair-transparent.png";

/* -------------------------------------------------------------------------- */
/* Contexte exposé aux pages : recherche du bandeau, action principale         */
/* -------------------------------------------------------------------------- */

const ShellQueryContext = createContext({
  query: "",
  setQuery: () => {},
  openCommandPalette: () => {},
  openAiConsole: () => {},
  setPageAction: () => {},
  registerSearch: () => () => {},
});

/**
 * Permet à une page enfant de lire (et modifier) la recherche du bandeau,
 * d'ouvrir la palette de commandes / la console IA, ou de déclarer l'action
 * principale de l'en-tête (`setPageAction({ label, icon, onClick | href })`).
 *
 * Appeler ce hook DÉCLARE que la page consomme la recherche : le champ du
 * bandeau n'apparaît que sur ces pages. Il s'affichait auparavant partout, y
 * compris là où la saisie ne filtrait rien (calendrier, journal, compte…).
 */
export function useShellQuery() {
  const context = useContext(ShellQueryContext);
  const { registerSearch } = context;
  useEffect(() => registerSearch(), [registerSearch]);
  return context;
}

/**
 * Déclare l'action principale de l'en-tête tant que la page est montée.
 * `action` doit être mémoïsée par l'appelant (ou `null`).
 */
export function usePageAction(action) {
  const { setPageAction } = useContext(ShellQueryContext);
  useEffect(() => {
    setPageAction(action ?? null);
    return () => setPageAction(null);
  }, [action, setPageAction]);
}

function triggerAiConsole() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("comexa:open-ai-console"));
  }
}

/* -------------------------------------------------------------------------- */
/* Outils                                                                      */
/* -------------------------------------------------------------------------- */

function isActivePath(pathname, href) {
  if (!pathname || !href) return false;
  if (href === "/espace-client") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Libellés courts des onglets du bas — jamais le titre desktop tronqué. */
const MOBILE_TAB = {
  "": "Accueil",
  "tableau-de-bord": "Accueil",
  taches: "Tâches",
  calendrier: "Agenda",
  temps: "Temps",
  "rapports-journaliers": "Rapports",
  notifications: "Alertes",
  projets: "Projets",
  clients: "Clients",
  devis: "Devis",
  factures: "Factures",
  commandes: "Commandes",
  commander: "Packs",
  modifications: "Demandes",
  messagerie: "Messages",
  contenu: "Contenu",
  membres: "Membres",
  roles: "Rôles",
  integrations: "Jetons",
  journal: "Journal",
  parametres: "Réglages",
  contacts: "Contacts",
  prospects: "Prospects",
  demandes: "Demandes",
  analytique: "Stats",
  repartition: "Parts",
  rapports: "Rapports",
};

function mobileTabLabel(href, fallback) {
  if (href === "/espace-client/tableau-de-bord") return "Synthèse";
  const mapped = MOBILE_TAB[sectionOf(href)];
  if (mapped) return mapped;
  const word = String(fallback ?? "Page").split(" ")[0];
  return word.length > 9 ? `${word.slice(0, 8)}…` : word;
}

/** `dockEnd` est un nœud ou une fonction, pour pouvoir le monter deux fois
 *  (dock bureau + barre mobile) sans partager la même instance React. */
function DockEnd({ end }) {
  if (!end) return null;
  return typeof end === "function" ? end() : end;
}

/** Densité du panneau principal, mémorisée localement (boutons + / − du rail). */
const ZOOM_STEPS = [0.9, 1, 1.1, 1.2];
const ZOOM_KEY = "comexa:panel-zoom";

function readZoom() {
  if (typeof window === "undefined") return 1;
  try {
    const value = Number(window.localStorage.getItem(ZOOM_KEY));
    return ZOOM_STEPS.includes(value) ? value : 1;
  } catch {
    return 1;
  }
}

/** Largeur réellement disponible (le rail et le panneau changent de forme). */
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

const GROUP_TONE_FALLBACK = ["blue", "green", "yellow", "lilac", "pink"];
const PRIORITY_LABEL = { LOW: "basse", NORMAL: "normale", HIGH: "haute", URGENT: "urgente" };

/* -------------------------------------------------------------------------- */
/* Coque                                                                       */
/* -------------------------------------------------------------------------- */

/* Rubriques atteintes par le menu du compte ou par un lien de fiche, et non par
   la navigation : elles gardent leur propre titre (sinon celui de l'espace). */
const OFF_NAV_PAGES = {
  projets: {
    label: "Suivi de projet",
    description: "Avancement, jalons et livrables partagés par l’équipe.",
    icon: FolderKanban,
  },
  devis: {
    label: "Devis",
    description: "Le détail de la proposition commerciale et sa décision.",
    icon: FileText,
  },
  compte: {
    label: "Mon compte",
    description: "Votre profil, votre mot de passe, vos sessions ouvertes et la liaison au bot Telegram.",
    clientDescription: "Votre profil, votre mot de passe et vos sessions ouvertes.",
    icon: UserRound,
  },
};

export function WorkspaceSoftShell({ area, title, groups = [], dockEnd = null, consoleAvailable = false, children }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { user, baseUser, request } = useAuth();
  const { unreadBySpace, refreshUnread } = useSpaces();
  const focus = useOptionalFocus();
  const isWorkspace = SPACE_IDS.includes(area);
  const skipId = useId();
  const can = useCallback((code) => canFor(user, code), [user]);

  const [query, setQuery] = useState("");
  const [pageAction, setPageAction] = useState(null);
  const [searchConsumers, setSearchConsumers] = useState(0);
  const registerSearch = useCallback(() => {
    setSearchConsumers((count) => count + 1);
    return () => setSearchConsumers((count) => Math.max(0, count - 1));
  }, []);
  const [zoomIndex, setZoomIndex] = useState(() => ZOOM_STEPS.indexOf(readZoom()));
  const [navOpen, setNavOpen] = useState(false);
  const [deskOpen, setDeskOpen] = useState(false);
  const [deskHidden, setDeskHidden] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [notchMeasure, setNotch] = useState(null);
  const [dockHidden, setDockHidden] = useState(false);
  const shellRef = useRef(null);
  const scrollRef = useRef(null);

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
    setDockHidden(false);
  }

  /* Raccourci clavier : ⌘K / Ctrl+K (palette). */
  useEffect(() => {
    function onKeyDown(event) {
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && key === "k") {
        event.preventDefault();
        setCmdkOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /* Dock : replié pendant que l'on descend, de retour dès que l'on remonte. */
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    let last = node.scrollTop;
    function onScroll() {
      const current = node.scrollTop;
      const nearBottom = node.scrollHeight - node.clientHeight - current < 24;
      if (current < 40 || nearBottom) setDockHidden(false);
      else if (current > last + 6) setDockHidden(true);
      else if (current < last - 6) setDockHidden(false);
      last = current;
    }
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  /* Languette : centre de l'onglet actif, converti dans le repère de la coque. */
  const onActiveTabMove = useCallback((measure) => {
    const shell = shellRef.current;
    if (!measure || !shell || measure.center === null) {
      setNotch(null);
      return;
    }
    const rect = shell.getBoundingClientRect();
    setNotch({ center: Math.round(measure.center - rect.left), pillWidth: measure.pillWidth });
  }, []);

  /* Données réelles du panneau de suivi et du compteur de la cloche (espace actif). */
  const canReadNotifications = can("notification:read:own");
  const unreadProbe = useListing(canReadNotifications ? "/notifications?read=false&page=1&perPage=1" : null);
  const recentNotifications = useListing(canReadNotifications ? "/notifications?page=1&perPage=6" : null);
  const canReadTasks = area !== "comexa" && area !== "client" && canReadOwnTasks(user);
  const myTasks = useAllListing(canReadTasks ? "/me/tasks" : null);

  const reloadTasks = myTasks.reload;
  const reloadUnread = unreadProbe.reload;
  const reloadNotifications = recentNotifications.reload;

  // La coque reste montée pendant les navigations : ses données doivent suivre
  // les écritures des pages (y compris la console), pas seulement son montage.
  useEffect(() => {
    let pending;
    const reload = () => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        reloadTasks();
        reloadUnread();
        reloadNotifications();
        if (isWorkspace) refreshUnread();
      }, 100);
    };
    reload();
    window.addEventListener(WORKSPACE_UPDATED, reload);
    window.addEventListener("focus", reload);
    return () => {
      clearTimeout(pending);
      window.removeEventListener(WORKSPACE_UPDATED, reload);
      window.removeEventListener("focus", reload);
    };
  }, [pathname, reloadTasks, reloadUnread, reloadNotifications, isWorkspace, refreshUnread]);

  const unreadCount = Number.isFinite(Number(unreadProbe.meta?.total)) ? Number(unreadProbe.meta.total) : 0;

  /* Une notification poussée en temps réel : le compteur de la cloche et la
     liste du panneau de suivi suivent SANS attendre un rechargement. C'est le
     seul endroit qui connaît les deux sondes. */
  const onLiveNotification = useCallback(() => {
    reloadUnread();
    reloadNotifications();
  }, [reloadUnread, reloadNotifications]);

  /* Compteurs par espace du sélecteur : relus après une navigation. */
  useEffect(() => {
    if (isWorkspace) refreshUnread();
  }, [isWorkspace, pathname, refreshUnread]);

  /* Rubriques autorisées, groupées comme dans le layout de l'espace. */
  const groupedLinks = useMemo(
    () =>
      groups.map((group, index) => ({
        group: group.label,
        tone: group.tone ?? GROUP_TONE_FALLBACK[index % GROUP_TONE_FALLBACK.length],
        items: group.items.map((item) => {
          const meta = sectionMeta(area, item.href);
          return {
            ...item,
            icon: meta.icon,
            shortLabel: meta.shortLabel ?? item.label,
            groupLabel: group.label,
            active: isActivePath(pathname, item.href),
            badge: item.href.endsWith("/notifications") && unreadCount > 0 ? unreadCount : null,
          };
        }),
      })),
    [area, groups, pathname, unreadCount],
  );

  const allowedLinks = useMemo(() => groupedLinks.flatMap((group) => group.items), [groupedLinks]);

  /* Rubrique courante (la plus précise d'abord). */
  const activeLink = useMemo(() => {
    const exact = allowedLinks.find((link) => link.href === pathname);
    if (exact) return exact;
    return [...allowedLinks].sort((a, b) => b.href.length - a.href.length).find((link) => isActivePath(pathname, link.href)) ?? null;
  }, [allowedLinks, pathname]);

  /* Onglets : rubriques prioritaires de l'espace, la rubrique courante toujours présente. */
  const navItems = useMemo(() => {
    const preferred = PREFERRED_TABS[area] ?? [];
    const bySection = new Map(allowedLinks.map((link) => [sectionOf(link.href), link]));
    const picked = preferred.filter((section) => bySection.has(section)).map((section) => bySection.get(section));
    const rest = allowedLinks.filter((link) => !preferred.includes(sectionOf(link.href)));
    let tabs = [...picked, ...rest].slice(0, 8);
    if (activeLink && !tabs.some((tab) => tab.href === activeLink.href)) {
      tabs = [...tabs.slice(0, 7), activeLink];
    }
    return tabs.map((link) => ({ href: link.href, label: link.shortLabel, longLabel: link.label, icon: link.icon }));
  }, [activeLink, allowedLinks, area]);

  const activeHref = activeLink?.href ?? null;

  const isDashboard = activeLink ? sectionOf(activeLink.href) === "tableau-de-bord" || activeLink.href === "/espace-client" : false;
  /* Pages hors navigation (Mon compte) : leur propre titre, pas celui de l'espace. */
  const offNavPage = !activeLink ? OFF_NAV_PAGES[sectionOf(pathname)] ?? null : null;
  const pageHeading = activeLink?.label ?? offNavPage?.label ?? title;
  const pageIcon = activeLink?.icon ?? offNavPage?.icon ?? sectionMeta(area, "/x/tableau-de-bord").icon;
  const activeGroup = groupedLinks.find((group) => group.items.some((item) => item.href === activeLink?.href));
  const pageBreadcrumb = activeGroup ? `${title} · ${activeGroup.group}` : title;
  const pageTone = activeGroup?.tone ?? SPACES[area]?.tone ?? "blue";
  const offNavDescription = offNavPage ? (isWorkspace ? offNavPage.description : (offNavPage.clientDescription ?? offNavPage.description)) : null;
  const pageSubtitle = activeLink?.description ?? offNavDescription ?? (isWorkspace ? SPACES[area].description : null);

  /* Recherche du bandeau : seulement si la page la consomme réellement. */
  const searchWired = !isDashboard && searchConsumers > 0;

  /* Action principale : celle que déclare la page, sinon une action par défaut rare. */
  const primaryAction = pageAction ?? defaultPrimaryAction(pathname, can);

  /* ---------------------------------------------------------------------- */
  /* Panneau de suivi : onglets et cartes teintées issus de l'API            */
  /* ---------------------------------------------------------------------- */

  const desk = useMemo(() => {
    const tabs = [];
    const items = [];
    const taskHref = area === "personal" ? "/espace-personnel/taches" : "/espace-equipe/taches";

    const openTasks = (myTasks.items ?? []).filter((task) => ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"].includes(task.status));

    if (canReadTasks) {
      tabs.push({ id: "taches", label: area === "personal" ? "Mes tâches" : "Mes tâches projet" });
      openTasks.slice(0, 6).forEach((task) => {
        items.push({
          id: `task-${task.id}`,
          tab: "taches",
          tone: task.status === "BLOCKED" ? "pink" : task.isPersonal ? "yellow" : "blue",
          icon: task.status === "BLOCKED" ? TriangleAlert : task.isPersonal ? CheckSquare : FolderKanban,
          type: TASK_STATUS[task.status] ?? "Tâche",
          date: task.dueDate ? formatDate(task.dueDate) : "Sans échéance",
          lines: [
            task.title,
            task.isPersonal ? "Tâche personnelle" : (task.project?.name ?? "Hors projet"),
            task.priority ? `Priorité ${PRIORITY_LABEL[task.priority] ?? String(task.priority).toLowerCase()}` : "À traiter",
          ],
          cta: {
            label: "Ouvrir",
            icon: CheckSquare,
            // La tâche elle-même (dépliée et mise en avant), pas seulement sa liste.
            href: `${taskHref}?tache=${encodeURIComponent(task.id)}`,
          },
        });
      });
    }

    if (canReadNotifications) {
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
          lines: [notification.title || "Notification", notification.body ?? "Aucun détail supplémentaire.", notification.readAt ? "Lue" : "Non lue"],
          cta: {
            label: notification.readAt ? "Voir" : "Traiter",
            icon: notification.readAt ? Search : Bell,
            href: resolveNotificationHref(notification.link, area),
          },
        });
      });
    }

    const subtitleParts = [];
    if (canReadTasks) subtitleParts.push(`${openTasks.length} tâche${openTasks.length > 1 ? "s" : ""} ouverte${openTasks.length > 1 ? "s" : ""}`);
    if (canReadNotifications) subtitleParts.push(`${unreadCount} notification${unreadCount > 1 ? "s" : ""} non lue${unreadCount > 1 ? "s" : ""}`);

    const error = myTasks.error || recentNotifications.error;
    /* Tant qu'une source charge et que rien n'est arrivé, « Chargement… » plutôt
       qu'un « Rien à traiter » mensonger. */
    const loading = items.length === 0 && (myTasks.loading || recentNotifications.loading);

    return { tabs, items, subtitle: subtitleParts.join(" · "), error: error ? messageOf(error) : null, loading };
  }, [area, canReadNotifications, canReadTasks, myTasks, recentNotifications, unreadCount]);

  const deskTitle = area === "personal" ? "Mon suivi" : area === "comexa" ? "Suivi de l’organisation" : area === "client" ? "Suivi" : "Suivi de l’équipe";

  /* Le compte : un accès direct, dans CHAQUE espace. C'est la rubrique la plus
     consultée de toutes (solde, mot de passe, sessions) ; elle ne doit donc
     jamais dépendre du menu « Rubriques », qui se referme au premier clic. */
  const accountHref = isWorkspace ? `${SPACES[area].prefix}/compte` : "/espace-client/compte";
  const notificationsHref = isWorkspace ? `${SPACES[area].prefix}/notifications` : "/espace-client/notifications";
  const homeHref = isWorkspace ? SPACES[area].home : "/espace-client";

  /* ---------------------------------------------------------------------- */
  /* Dock : « mon compte », actions de l'espace, toutes les rubriques         */
  /* ---------------------------------------------------------------------- */

  const dockItems = useMemo(() => {
    const items = dockActions(area, can, { openConsole: triggerAiConsole, consoleAvailable });
    return [
      // Sous 768 px, « Mon compte » vit déjà dans la barre du bas : le
      // dupliquer dans le dock ne ferait qu'encombrer une barre étroite.
      ...(!isMobile ? [{ label: "Mon compte", href: accountHref, icon: Wallet, tone: "green" }] : []),
      ...(isMobile && focus
        ? [
            {
              label: focus.session ? "Concentration en cours" : "Mode concentration",
              icon: Target,
              tone: "blue",
              onClick: focus.openFocus,
            },
          ]
        : []),
      ...items,
      { label: "Toutes les rubriques", icon: LayoutGrid, tone: "ink", onClick: () => setNavOpen(true) },
    ];
  }, [area, can, consoleAvailable, accountHref, isMobile, focus]);

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

  /* Le même bouton masque le panneau intégré sur grand écran et l'ouvre en
     tiroir sous 1024 px. */
  const toggleDesk = useCallback(() => {
    if (isCompact) setDeskOpen((open) => !open);
    else setDeskHidden((hidden) => !hidden);
  }, [isCompact]);

  const contextValue = useMemo(
    () => ({ query, setQuery, openCommandPalette: () => setCmdkOpen(true), openAiConsole: triggerAiConsole, setPageAction, registerSearch }),
    [query, registerSearch],
  );

  const deskElement = (
    <AdminDeskPanel
      key={`${area}-${desk.tabs.map((tab) => tab.id).join("-")}`}
      title={deskTitle}
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

  const showDesk = desk.tabs.length > 0;
  const unreadElsewhere = isWorkspace
    ? SPACE_IDS.filter((id) => id !== area).reduce((sum, id) => sum + Number(unreadBySpace?.[id] ?? 0), 0)
    : 0;

  return (
    <ShellQueryContext.Provider value={contextValue}>
      <SoftMotionProvider>
        <div className="sui-viewport" data-space={area}>
          <a className="sui-skip" href={`#${skipId}`}>
            Passer à la zone de travail
          </a>

          <div className="sui-shell" ref={shellRef}>
            <DocumentDeletionFeedback />
            <Navbar
              items={navItems}
              activeHref={activeHref}
              space={isWorkspace ? area : null}
              user={baseUser ?? user}
              badge={isWorkspace ? null : "espace client"}
              homeHref={homeHref}
              onOpenMenu={() => setNavOpen(true)}
              onActiveTabMove={isMobile ? undefined : onActiveTabMove}
            />

            <MobileAppBar
              homeHref={homeHref}
              spaceLabel={isWorkspace ? (SPACES[area]?.shortLabel ?? title) : "Client"}
              onOpenMenu={() => setNavOpen(true)}
              onSearch={() => setCmdkOpen(true)}
              notificationsHref={canReadNotifications ? notificationsHref : null}
              unreadCount={unreadCount}
              tools={dockEnd ? <DockEnd end={dockEnd} /> : null}
            />

            {/* Languette alignée sur l'onglet actif (masquée sans onglet actif). */}
            {!isMobile && notchMeasure ? (
              <Notch center={notchMeasure.center} pillWidth={notchMeasure.pillWidth} />
            ) : null}

            <div className="sui-shell__body">
              <SideRail
                onShare={shareScreen}
                onOpenNavigation={() => setNavOpen(true)}
                onToggleDesk={showDesk ? toggleDesk : undefined}
                deskOpen={isCompact ? deskOpen : !deskHidden}
                deskLabel={deskTitle}
                unreadCount={unreadCount}
                notificationsHref={isCompact || !canReadNotifications ? undefined : notificationsHref}
                onZoomIn={() => setZoom(zoomIndex + 1)}
                onZoomOut={() => setZoom(zoomIndex - 1)}
                canZoomIn={zoomIndex < ZOOM_STEPS.length - 1}
                canZoomOut={zoomIndex > 0}
                zoom={zoom}
                extra={
                  isCompact && showDesk ? (
                    <button
                      type="button"
                      className="sui-rail__btn"
                      data-coach-id="shell-notifications"
                      aria-label={unreadCount ? `Notifications, ${unreadCount} non lues` : "Notifications"}
                      onClick={() => setDeskOpen(true)}
                    >
                      <Bell size={18} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  ) : null
                }
              />

              <main className="sui-main" id={skipId} aria-label={pageHeading}>
                <div className="sui-main__scroll" ref={scrollRef} style={{ "--zoom": zoom }}>
                  <PageTransition key={pathname} className="sui-canvas-inner">
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
                      onGlobalSearch={() => setCmdkOpen(true)}
                      primaryAction={primaryAction}
                    />
                    {primaryAction ? (
                      <div className="sui-mobile-primary">
                        <PageHeaderAction action={primaryAction} />
                      </div>
                    ) : null}
                    {children}
                  </PageTransition>
                </div>
              </main>

              {!isCompact && !deskHidden && showDesk ? deskElement : null}
            </div>

            <Dock
              items={dockItems}
              end={dockEnd ? <DockEnd end={dockEnd} /> : null}
              hidden={dockHidden}
              onReveal={() => setDockHidden(false)}
              label={isWorkspace ? `Actions rapides — ${title}` : "Actions rapides de mon espace"}
            />

            {/* Onglets du téléphone : toujours dans le DOM, révélés par CSS
                (y compris en paysage). « Compte » a sa place dédiée. */}
            <nav className="sui-mobile-tabbar" aria-label="Navigation principale">
                {navItems.slice(0, 3).map((item) => {
                  const active = item.href === activeHref;
                  const short = mobileTabLabel(item.href, item.label);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`sui-mobile-tab${active ? " sui-mobile-tab--active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      aria-label={item.longLabel ?? item.label}
                      title={item.longLabel ?? item.label}
                    >
                      <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />
                      <span>{short}</span>
                    </Link>
                  );
                })}
                <Link
                  href={accountHref}
                  className={`sui-mobile-tab${isActivePath(pathname, accountHref) ? " sui-mobile-tab--active" : ""}`}
                  aria-current={isActivePath(pathname, accountHref) ? "page" : undefined}
                  aria-label="Mon compte"
                  title="Mon compte"
                >
                  <UserRound size={20} strokeWidth={1.75} aria-hidden="true" />
                  <span>Compte</span>
                </Link>
                <button
                  type="button"
                  className={`sui-mobile-tab${navOpen ? " sui-mobile-tab--active" : ""}`}
                  aria-expanded={navOpen}
                  aria-label={unreadElsewhere ? `Plus de rubriques, ${unreadElsewhere} non lues dans les autres espaces` : "Plus de rubriques"}
                  onClick={() => setNavOpen(true)}
                >
                  <LayoutGrid size={20} strokeWidth={1.75} aria-hidden="true" />
                  <span>Plus</span>
                  {unreadElsewhere ? <span className="sui-mobile-tab__dot" aria-hidden="true" /> : null}
                </button>
            </nav>

            {/* Tiroir du panneau de suivi (< 1024 px). */}
            {isCompact && deskOpen ? (
              <>
                <div className="sui-scrim" role="presentation" onClick={() => setDeskOpen(false)} />
                <div className="sui-drawer sui-drawer--right" role="dialog" aria-modal="true" aria-label={deskTitle}>
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
                  area={area}
                  groupedLinks={groupedLinks}
                  accountHref={accountHref}
                  quickActions={dockItems.filter((item) => item.label !== "Toutes les rubriques")}
                  onClose={() => setNavOpen(false)}
                  onOpenCommandPalette={() => {
                    setNavOpen(false);
                    setCmdkOpen(true);
                  }}
                />
              </>
            ) : null}

            {/* Palette de commandes de l'espace (⌘K / Ctrl+K). */}
            {cmdkOpen ? (
              <CommandPaletteModal
                area={area}
                title={title}
                groupedLinks={groupedLinks}
                request={request}
                can={can}
                consoleAvailable={consoleAvailable}
                accountHref={accountHref}
                onClose={() => setCmdkOpen(false)}
                onNavigate={(href) => {
                  setCmdkOpen(false);
                  router.push(href);
                }}
              />
            ) : null}

            {/* Alerte de notification arrivée en temps réel. */}
            <LiveNotification onNew={onLiveNotification} />
          </div>
        </div>
      </SoftMotionProvider>
    </ShellQueryContext.Provider>
  );
}

function PageHeaderAction({ action }) {
  const Icon = action.icon;
  const content = (
    <>
      {Icon ? <Icon size={17} strokeWidth={1.75} aria-hidden="true" /> : null}
      {action.label}
    </>
  );
  return action.href ? (
    <Link href={action.href} className="sui-btn sui-btn--dark">
      {content}
    </Link>
  ) : (
    <button type="button" className="sui-btn sui-btn--dark" onClick={action.onClick}>
      {content}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Tiroir de navigation (et sélecteur d'espace sur mobile)                     */
/* -------------------------------------------------------------------------- */

function MobileAppBar({ homeHref, spaceLabel, onOpenMenu, onSearch, notificationsHref, unreadCount, tools }) {
  const notifLabel = unreadCount ? `Notifications, ${unreadCount} non lue${unreadCount > 1 ? "s" : ""}` : "Notifications";
  return (
    <header className="sui-appbar">
      <Link href={homeHref} className="sui-appbar__logo" aria-label="Accueil de l’espace">
        <Image src={logoLight} alt="" width={96} height={22} priority />
      </Link>
      <button type="button" className="sui-appbar__space" onClick={onOpenMenu} aria-haspopup="dialog">
        <span>{spaceLabel}</span>
        <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      <div className="sui-appbar__tools">
        {tools}
        <button type="button" className="sui-appbar__icon" aria-label="Rechercher dans l’espace" onClick={onSearch}>
          <Search size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {notificationsHref ? (
          <Link href={notificationsHref} className="sui-appbar__icon" aria-label={notifLabel}>
            <Bell size={18} strokeWidth={1.75} aria-hidden="true" />
            {unreadCount ? <span className="sui-appbar__badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
          </Link>
        ) : null}
      </div>
    </header>
  );
}

function NavDrawer({ title, area, groupedLinks, accountHref, quickActions = [], onClose, onOpenCommandPalette }) {
  const titleId = useId();
  const closeBtnRef = useRef(null);

  useEffect(() => {
    closeBtnRef.current?.focus({ preventScroll: true });
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sui-drawer sui-drawer--nav" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="sui-drawer__head">
        <div>
          <h2 className="sui-drawer__title" id={titleId}>
            {title}
          </h2>
          <p className="sui-desk__sub">Toutes les rubriques autorisées de cet espace.</p>
        </div>
        <button ref={closeBtnRef} type="button" className="sui-iconbtn" aria-label="Fermer les rubriques" onClick={onClose}>
          <X size={19} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div className="sui-drawer__body">
        {SPACE_IDS.includes(area) ? (
          <div className="sui-drawer__group">
            <span className="sui-drawer__group-label">Espaces de travail</span>
            <SpaceSwitcherList active={area} onNavigate={onClose} />
          </div>
        ) : null}

        <div className="sui-drawer__group">
          <button type="button" className="sui-btn sui-btn--dark w-full justify-center" onClick={onOpenCommandPalette}>
            <Search size={17} strokeWidth={1.75} aria-hidden="true" />
            Rechercher dans {title.toLowerCase()}
          </button>
        </div>

        {quickActions.length ? (
          <div className="sui-drawer__group">
            <span className="sui-drawer__group-label">Actions rapides</span>
            <div className="sui-drawer__actions">
              {quickActions.map((item) => {
                const Icon = item.icon ?? LayoutGrid;
                const inner = (
                  <>
                    <span className="sui-drawer__action-icon" style={{ "--tone-bg": `var(--${item.tone ?? "blue"})` }} aria-hidden="true">
                      <Icon size={16} strokeWidth={1.75} />
                    </span>
                    <span>{item.label}</span>
                  </>
                );
                return item.href ? (
                  <Link key={item.label} href={item.href} className="sui-drawer__action" onClick={onClose}>
                    {inner}
                  </Link>
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    className="sui-drawer__action"
                    onClick={() => {
                      onClose();
                      item.onClick?.();
                    }}
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {groupedLinks.map(({ group, items }) => (
          <div className="sui-drawer__group" key={group}>
            <span className="sui-drawer__group-label">{group}</span>
            <div className="sui-drawer__grid">
              {items.map((item) => (
                <Link
                  key={item.href}
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
/* Palette de commandes (⌘K) — limitée à l'espace actif                        */
/* -------------------------------------------------------------------------- */

function CommandPaletteModal({ area, title, groupedLinks, request, can, consoleAvailable, accountHref, onClose, onNavigate }) {
  const inputRef = useRef(null);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const term = search.trim();
  /* Résultats directs : l'état porte le terme auquel il correspond, donc aucun
     `setState` n'est nécessaire pour les vider quand la saisie redevient courte. */
  const [live, setLive] = useState({ term: "", results: [], pending: false });
  const { spaces } = useSpaces();
  const router = useRouter();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sources = useMemo(
    () => (SEARCH_SOURCES[area] ?? []).filter((source) => source.any.some((code) => can(code))),
    [area, can],
  );

  useEffect(() => {
    if (term.length < 2 || sources.length === 0) return undefined;

    const controller = new AbortController();
    let disposed = false;
    const timer = setTimeout(() => {
      if (disposed || controller.signal.aborted) return;
      setLive((current) => (current.pending ? current : { ...current, pending: true }));

      Promise.all(
        sources.map((source) =>
          request(source.path(term), { signal: controller.signal })
            .then((res) => (res?.data ?? []).map((row) => ({ ...source.map(row), group: `Résultats · ${title}` })))
            .catch(() => []),
        ),
      )
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
  }, [request, sources, term, title]);

  const quickActions = useMemo(() => {
    const actions = paletteActions(area, can).map((action) => ({ ...action, group: "Actions rapides" }));
    /* « Mon compte » en tête : la rubrique la plus consultée, atteignable en
       tapant « compte » — elle vit hors navigation et serait sinon invisible
       dans la palette. */
    actions.unshift({
      id: "act-account",
      group: "Actions rapides",
      label: "Mon compte",
      sub: "Solde, profil, mot de passe et sessions",
      href: accountHref,
      icon: Wallet,
    });
    if (consoleAvailable) {
      actions.unshift({
        id: "act-ai-console",
        group: "Actions rapides",
        label: "Ouvrir la console IA Comexa",
        sub: "Pilotage en langage naturel",
        icon: Search,
        onSelect: () => {
          onClose();
          triggerAiConsole();
        },
      });
    }
    /* Changer d'espace depuis la palette. */
    for (const space of spaces) {
      if (space.id === area) continue;
      actions.push({
        id: `space-${space.id}`,
        group: "Espaces de travail",
        label: `Aller à ${SPACES[space.id].label}`,
        sub: SPACES[space.id].description,
        icon: LayoutGrid,
        onSelect: () => {
          onClose();
          router.push(SPACES[space.id].home);
        },
      });
    }
    return actions;
  }, [accountHref, area, can, consoleAvailable, onClose, router, spaces]);

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
            sub: link.description ?? link.href,
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
        aria-label={`Palette de commandes — ${title}`}
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
            placeholder={`Rechercher dans ${title.toLowerCase()} : rubrique, action, donnée…`}
            className="sui-cmdk__input"
            aria-label={`Rechercher dans ${title}`}
          />
          {live.pending ? <span className="sui-desk__sub">Recherche…</span> : null}
          <button type="button" onClick={onClose} className="sui-kbd">
            Échap
          </button>
        </div>

        <div className="sui-cmdk__body" role="listbox" aria-label="Résultats">
          {sections.length === 0 ? (
            <p className="sui-card__desc">Aucun résultat pour « {search} » dans {title.toLowerCase()}.</p>
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
          <span>{title} · Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceSoftShell;
