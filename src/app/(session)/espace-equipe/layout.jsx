"use client";

import RequireSession from "@/components/workspace/RequireSession";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";
import { useAuth } from "@/lib/session";
import { canAny } from "@/lib/access";
import { TimerProvider } from "@/lib/timer";
import TimerPill from "@/components/workspace/TimerPill";
import ApiContractBanner from "@/components/ApiContractBanner";
import AiAgentDrawer from "@/components/workspace/AiAgentDrawer";

const NAV_GROUPS = [
  {
    label: "Vue générale",
    description: "Les priorités et repères utiles à votre activité.",
    items: [
      { href: "/espace-equipe/tableau-de-bord", label: "Tableau de bord", icon: "home", any: ["dashboard:read:any", "dashboard:read:own"] },
      { href: "/espace-equipe/notifications", label: "Notifications", icon: "bell", any: ["notification:read:own"] },
    ],
  },
  {
    label: "Développement commercial",
    description: "Qualification des demandes et suivi des opportunités.",
    items: [
      { href: "/espace-equipe/contacts", label: "Contacts", icon: "contact", any: ["contactrequest:read:any"] },
      { href: "/espace-equipe/prospects", label: "Prospects", icon: "target", nested: true, any: ["prospect:read:any", "prospect:read:own"] },
      { href: "/espace-equipe/devis", label: "Devis", icon: "quote", nested: true, any: ["quote:read:any"] },
    ],
  },
  {
    label: "Gestion commerciale",
    description: "Commandes, projets reçus et facturation.",
    items: [
      { href: "/espace-equipe/factures", label: "Factures", icon: "invoice", nested: true, any: ["invoice:read:any"] },
      { href: "/espace-equipe/commandes", label: "Commandes", icon: "cart", nested: true, any: ["order:read:any"] },
      { href: "/espace-equipe/demandes", label: "Demandes de projet", icon: "inbox", any: ["project_request:read:any"] },
      { href: "/espace-equipe/clients", label: "Clients", icon: "users", nested: true, any: ["client:read:any"] },
    ],
  },
  {
    label: "Production",
    description: "Projets, tâches, calendrier et temps passé.",
    items: [
      { href: "/espace-equipe/projets", label: "Projets", icon: "folder", nested: true, any: ["project:read:any", "project:read:own", "project:read:assigned"] },
      { href: "/espace-equipe/taches", label: "Tâches", icon: "kanban", any: ["task:read:any", "task:read:assigned", "task:read:own", "task:write:any", "task:write:own"] },
      { href: "/espace-equipe/calendrier", label: "Calendrier", icon: "calendar", any: ["task:read:any", "task:read:assigned", "task:read:own", "project:read:any", "project:read:assigned", "project:read:own"] },
      { href: "/espace-equipe/temps", label: "Suivi du temps", icon: "clock", any: ["time:write:own", "time:read:own", "time:read:any"] },
      { href: "/espace-equipe/rapports-journaliers", label: "Rapports journaliers", icon: "doc", any: ["time:write:own", "time:read:any"] },
      { href: "/espace-equipe/messagerie", label: "Messagerie", icon: "message", any: ["conversation:read:own"] },
    ],
  },
  {
    label: "Pilotage et administration",
    description: "Analyse, contenus et administration selon vos autorisations.",
    items: [
      { href: "/espace-equipe/analytique", label: "Analytique", icon: "chart", any: ["report:read:any"] },
      { href: "/espace-equipe/rapports", label: "Rapports", icon: "doc", any: ["report:read:any", "report:read:own"] },
      { href: "/espace-equipe/modifications", label: "Demandes de modification", icon: "edit", any: ["modificationrequest:decide:any"] },
      { href: "/espace-equipe/contenu", label: "Contenu du site", icon: "layout", any: ["service:read:any", "package:read:any", "testimonial:read:any", "partner:read:any", "faq:read:any", "casestudy:read:any"] },
      { href: "/espace-equipe/membres", label: "Membres et droits", icon: "users", any: ["user:read:any"] },
      { href: "/espace-equipe/roles", label: "Rôles et permissions", icon: "shield", any: ["role:read:any"] },
      { href: "/espace-equipe/integrations", label: "API & Intégrations", icon: "shield", any: ["integration:read:any", "integration:manage:any"] },
      { href: "/espace-equipe/journal", label: "Journal d’audit", icon: "history", any: ["audit:read:any"] },
      { href: "/espace-equipe/parametres", label: "Paramètres", icon: "settings", any: ["setting:read:any"] },
    ],
  },
];

function visibleGroups(user) {
  return NAV_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => canAny(user, item.any)) }))
    .filter((group) => group.items.length > 0);
}

export default function EspaceEquipeLayout({ children }) {
  const { user } = useAuth();
  return (
    <RequireSession>
      <TimerProvider>
        <WorkspaceShell space="Espace équipe" groups={visibleGroups(user)}>
          <ApiContractBanner />
          {children}
        </WorkspaceShell>
        <TimerPill />
        <AiAgentDrawer />
      </TimerProvider>
    </RequireSession>
  );
}
