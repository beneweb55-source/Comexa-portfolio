"use client";

import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { useObject } from "@/lib/use-object";
import { Card, Notice } from "@/components/workspace/ui";
import { DataView } from "@/components/workspace/DataView";
import BentoDashboard from "@/components/dashboard/BentoDashboard";

/**
 * Tableau de bord de l'équipe : mise en page « bento » (démonstration visuelle),
 * suivie des données réelles de l'API en dessous pour ne rien masquer.
 */
export default function TableauDeBordPage() {
  const { user } = useAuth();
  const me = useObject("/dashboard/me");
  const agency = useObject("/dashboard", can(user, "dashboard:read:any"));

  return (
    <div className="flex flex-col gap-8">
      <BentoDashboard />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Ma journée (données réelles)" action={<button type="button" className="cx-btn cx-btn--outline cx-btn--sm" onClick={me.reload}>Actualiser</button>}>
          {me.error ? <Notice>{me.error}</Notice> : null}
          {me.loading && !me.data ? <p className="cx-small">Chargement…</p> : null}
          {me.data ? <DataView value={me.data} /> : null}
        </Card>
        {can(user, "dashboard:read:any") ? (
          <Card title="Vue de l’agence (données réelles)" action={<button type="button" className="cx-btn cx-btn--outline cx-btn--sm" onClick={agency.reload}>Actualiser</button>}>
            {agency.error ? <Notice>{agency.error}</Notice> : null}
            {agency.loading && !agency.data ? <p className="cx-small">Chargement…</p> : null}
            {agency.data ? <DataView value={agency.data} /> : null}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
