"use client";

import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { useObject } from "@/lib/use-object";
import { Card, Notice } from "@/components/workspace/ui";
import { DataView } from "@/components/workspace/DataView";

/**
 * Tableau de bord de l'équipe : vue d'agence (si la permission `dashboard:read:any` est accordée)
 * et vue personnelle (tâches, échéances, temps, notifications).
 */
export default function TableauDeBordPage() {
  const { user } = useAuth();
  const agency = useObject("/dashboard", can(user, "dashboard:read:any"));
  const me = useObject("/dashboard/me");

  return (
    <div className="flex flex-col gap-8">
      {can(user, "dashboard:read:any") ? (
        <Card title="Vue de l’agence" action={<button type="button" className="cx-btn cx-btn--outline cx-btn--sm" onClick={agency.reload}>Actualiser</button>}>
          {agency.error ? <Notice>{agency.error}</Notice> : null}
          {agency.loading && !agency.data ? <p className="cx-small">Chargement…</p> : null}
          {agency.data ? <DataView value={agency.data} /> : null}
        </Card>
      ) : null}

      <Card title="Ma journée" action={<button type="button" className="cx-btn cx-btn--outline cx-btn--sm" onClick={me.reload}>Actualiser</button>}>
        {me.error ? <Notice>{me.error}</Notice> : null}
        {me.loading && !me.data ? <p className="cx-small">Chargement…</p> : null}
        {me.data ? <DataView value={me.data} /> : null}
      </Card>
    </div>
  );
}
