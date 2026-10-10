"use client";

import RequireSession from "@/components/workspace/RequireSession";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { TimerProvider } from "@/lib/timer";
import TimerPill from "@/components/workspace/TimerPill";

// `any` : au moins une de ces permissions suffit à afficher l'entrée. Sans `any`, l'entrée est toujours visible.
const NAV = [
  { href: "/espace-equipe/tableau-de-bord", label: "Tableau de bord", any: ["dashboard:read:any", "dashboard:read:own"] },
  { href: "/espace-equipe/notifications", label: "Notifications", any: ["notification:read:own"] },
  { href: "/espace-equipe/contacts", label: "Contacts" },
  { href: "/espace-equipe/prospects", label: "Prospects", nested: true },
  { href: "/espace-equipe/devis", label: "Devis", nested: true },
  { href: "/espace-equipe/factures", label: "Factures", nested: true },
  { href: "/espace-equipe/commandes", label: "Commandes" },
  { href: "/espace-equipe/demandes", label: "Demandes de projet" },
  { href: "/espace-equipe/projets", label: "Projets", nested: true },
  { href: "/espace-equipe/clients", label: "Clients" },
  { href: "/espace-equipe/taches", label: "Tâches", any: ["task:read:any", "task:write:any", "task:write:own"] },
  { href: "/espace-equipe/calendrier", label: "Calendrier", any: ["task:read:any"] },
  { href: "/espace-equipe/rapports-journaliers", label: "Rapports journaliers", any: ["time:write:own", "time:read:any"] },
  { href: "/espace-equipe/analytique", label: "Analytique", any: ["report:read:any"] },
  { href: "/espace-equipe/temps", label: "Temps", any: ["time:write:own", "time:read:own", "time:read:any"] },
  { href: "/espace-equipe/modifications", label: "Demandes de modification", any: ["modificationrequest:decide:any"] },
  { href: "/espace-equipe/rapports", label: "Rapports", any: ["report:read:any", "report:read:own"] },
  { href: "/espace-equipe/messagerie", label: "Messagerie", any: ["conversation:read:own"] },
  { href: "/espace-equipe/contenu", label: "Contenu du site", any: ["service:read:any", "package:read:any", "testimonial:read:any", "partner:read:any", "faq:read:any"] },
  { href: "/espace-equipe/membres", label: "Membres et droits", any: ["user:read:any"] },
  { href: "/espace-equipe/roles", label: "Rôles et permissions", any: ["role:read:any"] },
  { href: "/espace-equipe/journal", label: "Journal", any: ["audit:read:any"] },
  { href: "/espace-equipe/parametres", label: "Paramètres", any: ["setting:read:any"] },
  { href: "/espace-equipe/compte", label: "Mon compte" },
];

function visibleItems(user) {
  return NAV.filter((item) => !item.any || item.any.some((permission) => can(user, permission)));
}

export default function EspaceEquipeLayout({ children }) {
  const { user } = useAuth();
  return (
    <RequireSession>
      <TimerProvider>
        <WorkspaceShell space="Espace équipe" title="Espace équipe" subtitle="Administration des commandes, clients et projets." items={visibleItems(user)}>
          {children}
        </WorkspaceShell>
        <TimerPill />
      </TimerProvider>
    </RequireSession>
  );
}
