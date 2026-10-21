"use client";

/*
 * Mon parcours — espace équipe.
 *
 * Missions fondées sur les permissions réelles du membre (clients, devis,
 * projets, tâches…), exécutées dans l'environnement d'entraînement isolé.
 */
import ParcoursView from "@/components/training/ParcoursView";

export default function FormationEspaceEquipePage() {
  return <ParcoursView space="team" />;
}
