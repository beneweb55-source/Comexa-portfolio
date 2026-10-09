"use client";

import RequireSession from "@/components/workspace/RequireSession";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";

const NAV = [
  { href: "/espace-client", label: "Mon espace" },
  { href: "/espace-client/commander", label: "Commander un pack", nested: true },
];

export default function EspaceClientLayout({ children }) {
  return (
    <RequireSession>
      <WorkspaceShell title="Mon espace client" subtitle="Commandes, paiements et suivi de vos projets." items={NAV}>
        {children}
      </WorkspaceShell>
    </RequireSession>
  );
}
