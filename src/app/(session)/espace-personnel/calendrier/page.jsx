"use client";

import { Suspense } from "react";
import CalendarWorkspace from "@/components/calendar/CalendarWorkspace";

/** Mon agenda : mes rendez-vous, rappels et les échéances de mes tâches. */
export default function MonAgendaPage() {
  return (
    <Suspense fallback={<p className="sui-card__desc">Chargement de votre agenda…</p>}>
      <CalendarWorkspace space="personal" />
    </Suspense>
  );
}
