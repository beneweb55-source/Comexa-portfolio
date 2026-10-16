"use client";

import { Suspense } from "react";
import PersonalWorkspace from "@/components/workspace/PersonalWorkspace";

/**
 * Mes tâches : une seule liste pour mes tâches personnelles (privées) et les
 * tâches de projet qui me sont assignées — chacune marquée comme telle — avec
 * cases à cocher, objectifs et minuteur. `Suspense` : la page lit `?tache=`
 * (lien profond des notifications) ; seul ce composant attend les paramètres.
 */
export default function MesTachesPage() {
  return (
    <Suspense fallback={<p className="sui-card__desc">Chargement de vos tâches…</p>}>
      <PersonalWorkspace />
    </Suspense>
  );
}
