"use client";

/*
 * WorkspaceShell — passerelle entre les layouts et la coque plein écran
 * (`src/components/softui/Shell.jsx`).
 *
 *  - espaces de travail : `space` vaut `personal`, `team` ou `comexa`, et
 *    `groups` contient les rubriques déjà filtrées par les droits de l'espace ;
 *  - espace client : `space="Espace client"` (libellé historique), inchangé.
 */

import Shell from "@/components/softui/Shell";
import { SPACES } from "@/lib/spaces";

export default function WorkspaceShell({ space, groups, children, dockEnd = null, consoleAvailable = false }) {
  const workspace = SPACES[space] ? space : null;
  const area = workspace ?? "client";
  const title = workspace ? SPACES[workspace].label : (space ?? "Espace client");
  return (
    <Shell area={area} title={title} groups={groups ?? []} dockEnd={dockEnd} consoleAvailable={consoleAvailable}>
      {children}
    </Shell>
  );
}
