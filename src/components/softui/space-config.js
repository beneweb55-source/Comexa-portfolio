/*
 * Configuration de la coque par espace : icônes des rubriques, onglets
 * prioritaires, actions du dock, action principale par défaut, actions rapides
 * et sources de recherche de la palette ⌘K.
 *
 * Tout est déclaratif et filtré par les droits EFFECTIFS de l'espace : aucune
 * action ne pointe vers une rubrique d'un autre espace, aucune recherche ne
 * mélange les données de deux espaces.
 */

import {
  BarChart3,
  Bell,
  Briefcase,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Clock3,
  CreditCard,
  FilePlus,
  FileText,
  FolderKanban,
  Globe,
  History,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  Mail,
  MessagesSquare,
  NotebookPen,
  PenSquare,
  Settings2,
  Scale,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Sun,
  UserPlus,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";

/** Icône et libellé court de chaque rubrique, par espace (repli : `*`). */
const SECTION_META = {
  "*": {
    "tableau-de-bord": { icon: LayoutDashboard, shortLabel: "Tableau de bord" },
    notifications: { icon: Bell, shortLabel: "Notifications" },
    compte: { icon: UserRound, shortLabel: "Mon compte" },
    calendrier: { icon: CalendarDays, shortLabel: "Calendrier" },
    temps: { icon: Clock3, shortLabel: "Temps" },
    "rapports-journaliers": { icon: NotebookPen, shortLabel: "Rapports du jour" },
    taches: { icon: CheckSquare, shortLabel: "Tâches" },
  },
  personal: {
    "tableau-de-bord": { icon: Sun, shortLabel: "Ma journée" },
    taches: { icon: ListTodo, shortLabel: "Mes tâches" },
    calendrier: { icon: CalendarDays, shortLabel: "Mon agenda" },
    temps: { icon: Clock3, shortLabel: "Mon temps" },
    "rapports-journaliers": { icon: NotebookPen, shortLabel: "Mes rapports" },
  },
  team: {
    contacts: { icon: Mail, shortLabel: "Contacts" },
    prospects: { icon: Users, shortLabel: "Prospects" },
    devis: { icon: FileText, shortLabel: "Devis" },
    factures: { icon: CreditCard, shortLabel: "Factures" },
    commandes: { icon: ShoppingCart, shortLabel: "Commandes" },
    demandes: { icon: Briefcase, shortLabel: "Demandes" },
    clients: { icon: Users, shortLabel: "Clients" },
    projets: { icon: FolderKanban, shortLabel: "Projets" },
    taches: { icon: CheckSquare, shortLabel: "Tâches" },
    temps: { icon: Clock3, shortLabel: "Suivi du temps" },
    "rapports-journaliers": { icon: NotebookPen, shortLabel: "Rapports journaliers" },
    messagerie: { icon: MessagesSquare, shortLabel: "Messagerie" },
    modifications: { icon: Wrench, shortLabel: "Modifications" },
    analytique: { icon: BarChart3, shortLabel: "Analytique" },
    repartition: { icon: Scale, shortLabel: "Répartition" },
    rapports: { icon: ClipboardList, shortLabel: "Rapports" },
  },
  comexa: {
    "tableau-de-bord": { icon: LayoutDashboard, shortLabel: "Vue d’ensemble" },
    contenu: { icon: Globe, shortLabel: "Contenu du site" },
    membres: { icon: UserPlus, shortLabel: "Membres" },
    roles: { icon: ShieldCheck, shortLabel: "Rôles" },
    integrations: { icon: KeyRound, shortLabel: "Intégrations" },
    journal: { icon: History, shortLabel: "Journal d’audit" },
    parametres: { icon: Settings2, shortLabel: "Paramètres" },
  },
  client: {
    "": { icon: LayoutDashboard, shortLabel: "Vue d’ensemble" },
    "tableau-de-bord": { icon: BarChart3, shortLabel: "Tableau de bord" },
    commander: { icon: ShoppingCart, shortLabel: "Commander" },
    modifications: { icon: Wrench, shortLabel: "Modifications" },
    messagerie: { icon: Mail, shortLabel: "Messagerie" },
  },
};

/** Segment de rubrique d'un chemin d'espace (`/espace-equipe/projets/12` -> `projets`). */
export function sectionOf(href) {
  return String(href ?? "").split("/").filter(Boolean)[1] ?? "";
}

export function sectionMeta(area, href) {
  const section = sectionOf(href);
  return SECTION_META[area]?.[section] ?? SECTION_META["*"][section] ?? { icon: Briefcase, shortLabel: null };
}

/** Onglets de la navbar, par ordre de priorité, parmi les rubriques autorisées. */
export const PREFERRED_TABS = {
  personal: ["tableau-de-bord", "taches", "calendrier", "temps", "rapports-journaliers", "notifications"],
  team: ["tableau-de-bord", "projets", "taches", "calendrier", "clients", "devis", "factures", "commandes"],
  comexa: ["tableau-de-bord", "contenu", "membres", "roles", "integrations", "journal", "parametres"],
  client: ["", "tableau-de-bord", "commander", "modifications", "messagerie", "notifications"],
};

/**
 * Action principale par défaut de l'en-tête quand la page n'en déclare pas.
 * Volontairement rare : un bouton « Nouveau devis » n'a rien à faire sur la
 * page des projets ou des factures.
 */
export function defaultPrimaryAction(pathname, can) {
  if (pathname === "/espace-equipe/devis" && can("quote:write:any")) {
    return { label: "Nouveau devis", href: "/espace-equipe/devis/nouveau", icon: FilePlus };
  }
  if (pathname === "/espace-client") {
    return { label: "Commander un pack", href: "/espace-client/commander", icon: ShoppingCart };
  }
  return null;
}

/**
 * Actions rapides du dock (cinq au plus), propres à l'espace. Le minuteur et la
 * console Comexa s'ajoutent à droite du dock, dans un segment séparé.
 */
export function dockActions(area, can, { openConsole, consoleAvailable }) {
  const items = [];
  if (area === "personal") {
    if (can("task:write:personal")) items.push({ label: "Nouvelle tâche personnelle", href: "/espace-personnel/taches#nouvelle-tache", icon: ListTodo, tone: "yellow" });
    if (can("calendar:write:own")) items.push({ label: "Ajouter à mon agenda", href: "/espace-personnel/calendrier?nouveau=1", icon: CalendarDays, tone: "pink" });
    if (can("time:write:own")) items.push({ label: "Saisir du temps", href: "/espace-personnel/temps", icon: Clock3, tone: "green" });
    if (can("time:write:own")) items.push({ label: "Rédiger mon rapport du jour", href: "/espace-personnel/rapports-journaliers", icon: NotebookPen, tone: "lilac" });
  } else if (area === "team") {
    if (can("quote:write:any")) items.push({ label: "Créer un devis", href: "/espace-equipe/devis/nouveau", icon: FilePlus, tone: "lilac" });
    if (can("calendar:write:own") && can("calendar:read:team")) items.push({ label: "Planifier un événement d’équipe", href: "/espace-equipe/calendrier?nouveau=1", icon: CalendarDays, tone: "pink" });
    if (can("conversation:read:own")) items.push({ label: "Ouvrir la messagerie", href: "/espace-equipe/messagerie", icon: MessagesSquare, tone: "yellow" });
    if (can("report:read:any")) items.push({ label: "Consulter les rapports", href: "/espace-equipe/rapports", icon: ClipboardList, tone: "green" });
  } else if (area === "comexa") {
    if (can("user:manage:any")) items.push({ label: "Inviter un membre", href: "/espace-comexa/membres", icon: UserPlus, tone: "blue" });
    if (["service:write:any", "faq:write:any", "partner:write:any", "testimonial:write:any", "package:write:any"].some(can)) {
      items.push({ label: "Modifier le contenu du site", href: "/espace-comexa/contenu", icon: PenSquare, tone: "pink" });
    }
    if (can("integration:manage:any")) items.push({ label: "Gérer les jetons d’intégration", href: "/espace-comexa/integrations", icon: KeyRound, tone: "green" });
    if (can("audit:read:any")) items.push({ label: "Ouvrir le journal d’audit", href: "/espace-comexa/journal", icon: History, tone: "yellow" });
  } else {
    items.push({ label: "Commander un pack", href: "/espace-client/commander", icon: ShoppingCart, tone: "blue" });
    if (can("modificationrequest:write:own") || can("modificationrequest:read:own")) {
      items.push({ label: "Demander une modification", href: "/espace-client/modifications", icon: Wrench, tone: "lilac" });
    }
    if (can("conversation:read:own")) items.push({ label: "Écrire à l’équipe", href: "/espace-client/messagerie", icon: Mail, tone: "pink" });
    items.push({ label: "Voir mes notifications", href: "/espace-client/notifications", icon: Bell, tone: "yellow" });
  }
  if (consoleAvailable && openConsole) {
    items.push({ label: "Console Comexa (Alt+C)", icon: Sparkles, tone: "blue", onClick: openConsole });
  }
  return items.slice(0, 5);
}

/** Actions rapides de la palette ⌘K, propres à l'espace. */
export function paletteActions(area, can) {
  const actions = [];
  if (area === "personal") {
    if (can("task:write:personal")) actions.push({ id: "act-personal-task", label: "Créer une tâche personnelle", sub: "Mes tâches", href: "/espace-personnel/taches#nouvelle-tache", icon: ListTodo });
    if (can("calendar:write:own")) actions.push({ id: "act-personal-event", label: "Ajouter un rendez-vous à mon agenda", sub: "Mon agenda", href: "/espace-personnel/calendrier?nouveau=1", icon: CalendarDays });
    if (can("time:write:own")) actions.push({ id: "act-log-time", label: "Saisir du temps", sub: "Mon temps", href: "/espace-personnel/temps", icon: Clock3 });
  } else if (area === "team") {
    if (can("quote:write:any")) actions.push({ id: "act-new-quote", label: "Créer un nouveau devis", sub: "Facturation", href: "/espace-equipe/devis/nouveau", icon: FilePlus });
    if (can("calendar:write:own") && can("calendar:read:team")) actions.push({ id: "act-team-event", label: "Planifier un événement d’équipe", sub: "Calendrier", href: "/espace-equipe/calendrier?nouveau=1", icon: CalendarDays });
  } else if (area === "comexa") {
    if (can("user:manage:any")) actions.push({ id: "act-invite", label: "Inviter un membre", sub: "Membres et droits", href: "/espace-comexa/membres", icon: UserPlus });
    if (can("integration:manage:any")) actions.push({ id: "act-token", label: "Créer un jeton d’intégration", sub: "API & Intégrations", href: "/espace-comexa/integrations", icon: KeyRound });
  } else {
    actions.push({ id: "act-order-pack", label: "Commander un pack Comexa", sub: "Nouveau projet", href: "/espace-client/commander", icon: ShoppingCart });
    actions.push({ id: "act-mod-req", label: "Déposer une demande de modification", sub: "Suivi projet", href: "/espace-client/modifications", icon: Wrench });
  }
  actions.push({ id: "act-public-site", label: "Aller sur le site public Comexa", sub: "Vitrine publique", href: "/", icon: Globe });
  return actions;
}

/**
 * Recherche directe de la palette : uniquement les ressources de l'espace actif.
 * Chaque source déclare la permission (effective) qui l'ouvre.
 */
export const SEARCH_SOURCES = {
  personal: [
    {
      id: "my-tasks",
      any: ["task:read:personal", "task:read:assigned", "task:read:own"],
      path: (term) => `/me/tasks?search=${encodeURIComponent(term)}&perPage=5`,
      map: (task) => ({
        id: `task-${task.id}`,
        label: task.title,
        sub: task.isPersonal ? "Tâche personnelle" : `Tâche · ${task.project?.name ?? ""}`,
        href: "/espace-personnel/taches",
        icon: ListTodo,
      }),
    },
  ],
  team: [
    {
      id: "clients",
      any: ["client:read:any"],
      path: (term) => `/clients?search=${encodeURIComponent(term)}&perPage=3`,
      map: (client) => ({ id: `client-${client.id}`, label: client.companyName, sub: `Client · ${client.reference ?? ""}`, href: `/espace-equipe/clients/${client.id}`, icon: Users }),
    },
    {
      id: "projects",
      any: ["project:read:any", "project:read:assigned", "project:read:own"],
      path: (term) => `/projects?search=${encodeURIComponent(term)}&perPage=3`,
      map: (project) => ({ id: `project-${project.id}`, label: project.name, sub: `Projet · ${project.reference ?? ""}`, href: `/espace-equipe/projets/${project.id}`, icon: FolderKanban }),
    },
    {
      id: "quotes",
      any: ["quote:read:any"],
      path: (term) => `/quotes?search=${encodeURIComponent(term)}&perPage=3`,
      map: (quote) => ({ id: `quote-${quote.id}`, label: quote.subject || quote.reference, sub: `Devis · ${quote.reference ?? ""}`, href: `/espace-equipe/devis/${quote.id}`, icon: FileText }),
    },
    {
      id: "invoices",
      any: ["invoice:read:any"],
      path: (term) => `/invoices?search=${encodeURIComponent(term)}&perPage=3`,
      map: (invoice) => ({ id: `invoice-${invoice.id}`, label: invoice.subject || invoice.reference, sub: `Facture · ${invoice.reference ?? ""}`, href: `/espace-equipe/factures/${invoice.id}`, icon: CreditCard }),
    },
  ],
  comexa: [
    {
      id: "members",
      any: ["user:read:any"],
      path: (term) => `/users?search=${encodeURIComponent(term)}&perPage=5`,
      map: (member) => ({
        id: `user-${member.id}`,
        label: [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email,
        sub: `Membre · ${member.email ?? ""}`,
        href: "/espace-comexa/membres",
        icon: UserRound,
      }),
    },
  ],
  client: [],
};
