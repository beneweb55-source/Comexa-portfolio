"use client";

/*
 * WorkspaceShell — passerelle entre les layouts d'espace et la nouvelle coque.
 *
 * L'API publique n'a pas changé : les layouts appellent toujours
 * `<WorkspaceShell space="…" groups={…}>{children}</WorkspaceShell>`. Seule
 * l'implémentation convertit les groupes autorisés en liens pour la coque
 * plein écran (`src/components/softui/Shell.jsx`). Le thème clair Liquid Glass
 * est partagé, sans confondre les actions des espaces équipe et client.
 */

import Shell from "@/components/softui/Shell";
import { hasTeamAccess } from "@/lib/access";
import { useAuth } from "@/lib/session";

export default function WorkspaceShell({ space, groups, children }) {
  const { user } = useAuth();
  const label = space ?? (hasTeamAccess(user) ? "Espace équipe" : "Espace client");
  const area = label === "Espace équipe" ? "equipe" : "client";
  const links = (groups ?? []).flatMap((group) => group.items);
  return (
    <Shell area={area} title={label} links={links}>
      {children}
    </Shell>
  );
}
