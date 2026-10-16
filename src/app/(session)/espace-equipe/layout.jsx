"use client";

import SpaceLayout from "@/components/workspace/SpaceLayout";

/**
 * Espace équipe : le travail partagé de l'agence (commercial, facturation,
 * production, pilotage). Les rubriques et les droits viennent de
 * `lib/space-navigation.js` et de la politique d'espaces du serveur.
 */
export default function EspaceEquipeLayout({ children }) {
  return <SpaceLayout space="team">{children}</SpaceLayout>;
}
