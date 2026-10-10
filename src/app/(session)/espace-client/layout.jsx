"use client";

import RequireSession from "@/components/workspace/RequireSession";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";

// `any` : au moins une permission suffit à afficher l'entrée (les permissions sont celles du rôle CLIENT).
const NAV = [
  { href: "/espace-client", label: "Mon espace" },
  { href: "/espace-client/tableau-de-bord", label: "Tableau de bord", any: ["dashboard:read:own"] },
  { href: "/espace-client/commander", label: "Commander un pack", nested: true },
  { href: "/espace-client/modifications", label: "Demandes de modification", any: ["modificationrequest:write:own", "modificationrequest:read:own"] },
  { href: "/espace-client/notifications", label: "Notifications", any: ["notification:read:own"] },
  { href: "/espace-client/compte", label: "Mon compte" },
];

function visibleItems(user) {
  return NAV.filter((item) => !item.any || item.any.some((permission) => can(user, permission)));
}

export default function EspaceClientLayout({ children }) {
  const { user } = useAuth();
  return (
    <RequireSession>
      <WorkspaceShell space="Espace client" title="Mon espace client" subtitle="Commandes, paiements et suivi de vos projets." items={visibleItems(user)}>
        {children}
      </WorkspaceShell>
    </RequireSession>
  );
}
