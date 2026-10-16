"use client";

import SpaceLayout from "@/components/workspace/SpaceLayout";

/**
 * Comexa Space : l'organisation elle-même — site public, membres et rôles,
 * intégrations, journal d'audit et paramètres. Aucun minuteur ni console de
 * production ici : ce sont des outils de l'espace équipe et personnel.
 */
export default function EspaceComexaLayout({ children }) {
  return (
    <SpaceLayout space="comexa" withTimer={false} withConsole={false}>
      {children}
    </SpaceLayout>
  );
}
