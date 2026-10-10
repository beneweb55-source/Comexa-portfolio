"use client";

import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { useObject } from "@/lib/use-object";
import { Card, Notice } from "@/components/workspace/ui";
import BentoDashboard from "@/components/dashboard/BentoDashboard";
import { AgencyView, MyDayView } from "@/components/dashboard/TeamViews";

/**
 * Tableau de bord de l'équipe : mise en page « bento » (démonstration visuelle), suivie des
 * données réelles mises en forme (dates, montants, statuts) et réparties par onglets.
 */
export default function TableauDeBordPage() {
  const { user } = useAuth();
  const canSeeAgency = can(user, "dashboard:read:any");
  const me = useObject("/dashboard/me");
  const agency = useObject("/dashboard", canSeeAgency);

  return (
    <div className="flex flex-col gap-8">
      <BentoDashboard />

      <Card title="Ma journée" action={<button type="button" className="cx-btn cx-btn--outline cx-btn--sm" onClick={me.reload}>Actualiser</button>}>
        {me.error ? <Notice>{me.error}</Notice> : null}
        {me.loading && !me.data ? <p className="cx-small">Chargement…</p> : null}
        {me.data ? <MyDayView data={me.data} /> : null}
      </Card>

      {canSeeAgency ? (
        <div className="flex flex-col gap-3">
          <div className="flex justify-end">
            <button type="button" className="cx-btn cx-btn--outline cx-btn--sm" onClick={agency.reload}>Actualiser l’agence</button>
          </div>
          {agency.error ? <Notice>{agency.error}</Notice> : null}
          {agency.loading && !agency.data ? <p className="cx-small">Chargement…</p> : null}
          {agency.data ? <AgencyView data={agency.data} /> : null}
        </div>
      ) : null}
    </div>
  );
}
