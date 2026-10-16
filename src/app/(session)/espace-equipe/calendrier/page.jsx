"use client";

import { Suspense } from "react";
import CalendarWorkspace from "@/components/calendar/CalendarWorkspace";

/** Calendrier d'équipe : événements partagés et échéances des projets et tâches. */
export default function CalendrierEquipePage() {
  return (
    <Suspense fallback={<p className="sui-card__desc">Chargement du calendrier…</p>}>
      <CalendarWorkspace space="team" />
    </Suspense>
  );
}
