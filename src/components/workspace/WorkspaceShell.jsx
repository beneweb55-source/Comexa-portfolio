"use client";

/*
 * WorkspaceShell — passerelle entre les layouts d'espace et la nouvelle coque.
 *
 * L'API publique n'a pas changé : les layouts appellent toujours
 * `<WorkspaceShell space="…" groups={…}>{children}</WorkspaceShell>`. Seule
 * l'implémentation change : l'ancienne barre latérale claire est remplacée par la
 * coque noire « soft UI pastel » (`src/components/softui/Shell.jsx`), avec navbar
 * à pilule glissante, rail, panneau Admin Desk et dock flottant.
 */

import Shell from "@/components/softui/Shell";
import { hasTeamAccess } from "@/lib/access";
import { useAuth } from "@/lib/session";

export default function WorkspaceShell({ space, groups, children }) {
  const { user } = useAuth();
  const label = space ?? (hasTeamAccess(user) ? "Espace équipe" : "Espace client");
  return (
    <Shell space={label} groups={groups ?? []}>
      {children}
    </Shell>
  );
}
