"use client";

import SpaceLayout from "@/components/workspace/SpaceLayout";

/**
 * Espace personnel : ce qui n'appartient qu'au membre connecté (tâches privées
 * et assignées, agenda, temps, rapports du jour). Le serveur y restreint toutes
 * les requêtes à la portée « à moi », y compris pour un administrateur.
 */
export default function EspacePersonnelLayout({ children }) {
  return <SpaceLayout space="personal">{children}</SpaceLayout>;
}
