"use client";

import RequireSession from "@/components/workspace/RequireSession";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";

const NAV = [
  { href: "/espace-equipe/contacts", label: "Contacts" },
  { href: "/espace-equipe/prospects", label: "Prospects", nested: true },
  { href: "/espace-equipe/devis", label: "Devis", nested: true },
  { href: "/espace-equipe/factures", label: "Factures", nested: true },
  { href: "/espace-equipe/commandes", label: "Commandes" },
  { href: "/espace-equipe/demandes", label: "Demandes de projet" },
  { href: "/espace-equipe/projets", label: "Projets", nested: true },
  { href: "/espace-equipe/clients", label: "Clients" },
  { href: "/espace-equipe/membres", label: "Membres et droits" },
];

export default function EspaceEquipeLayout({ children }) {
  return (
    <RequireSession>
      <WorkspaceShell space="Espace équipe" title="Espace équipe" subtitle="Administration des commandes, clients et projets." items={NAV}>
        {children}
      </WorkspaceShell>
    </RequireSession>
  );
}
