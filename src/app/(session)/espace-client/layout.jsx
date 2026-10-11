"use client";

import RequireSession from "@/components/workspace/RequireSession";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";
import { useAuth } from "@/lib/session";
import { canAny } from "@/lib/access";

const NAV_GROUPS = [
  {
    label: "Vue générale",
    description: "Retrouvez les informations importantes de votre compte.",
    items: [
      { href: "/espace-client", label: "Mon espace", icon: "home" },
      { href: "/espace-client/tableau-de-bord", label: "Tableau de bord", icon: "chart", any: ["dashboard:read:own"] },
    ],
  },
  {
    label: "Mes échanges",
    description: "Commandes, demandes et échanges avec l’équipe Comexa.",
    items: [
      { href: "/espace-client/commander", label: "Commander un pack", icon: "cart", nested: true },
      { href: "/espace-client/modifications", label: "Demandes de modification", icon: "edit", any: ["modificationrequest:write:own", "modificationrequest:read:own"] },
      { href: "/espace-client/messagerie", label: "Messagerie", icon: "message", any: ["conversation:read:own"] },
      { href: "/espace-client/notifications", label: "Notifications", icon: "bell", any: ["notification:read:own"] },
    ],
  },
];

function visibleGroups(user) {
  return NAV_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.any || canAny(user, item.any)) }))
    .filter((group) => group.items.length > 0);
}

export default function EspaceClientLayout({ children }) {
  const { user } = useAuth();
  return (
    <RequireSession>
      <WorkspaceShell space="Espace client" groups={visibleGroups(user)}>
        {children}
      </WorkspaceShell>
    </RequireSession>
  );
}
