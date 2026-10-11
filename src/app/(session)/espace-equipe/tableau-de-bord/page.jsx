"use client";

import { useState } from "react";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { useObject } from "@/lib/use-object";
import { Card, Notice } from "@/components/workspace/ui";
import BentoDashboard from "@/components/dashboard/BentoDashboard";
import { AgencyView, MyDayView } from "@/components/dashboard/TeamViews";

/**
 * Tableau de bord de l'équipe. Deux appels seulement, et seulement si le porteur y a droit :
 *  - `/dashboard/me` : sa vue personnelle (`dashboard:read:own` ou `:any`) ;
 *  - `/dashboard` : la vue agence (`dashboard:read:any`).
 * Les données sont partagées avec le bento ; les tableaux détaillés restent accessibles, repliés.
 */
export default function TableauDeBordPage() {
  const { user } = useAuth();
  const canSeeAgency = can(user, "dashboard:read:any");
  const canSeeMe = canSeeAgency || can(user, "dashboard:read:own");
  const [agencyPeriod, setAgencyPeriod] = useState("THIS_MONTH");
  const me = useObject("/dashboard/me", canSeeMe);
  const agency = useObject(`/dashboard?preset=${agencyPeriod}`, canSeeAgency);

  if (!canSeeMe) {
    return <Notice tone="warning">Votre compte n’a pas accès au tableau de bord de l’équipe.</Notice>;
  }

  return (
    <div className="flex flex-col gap-8">
      <BentoDashboard me={me} agency={agency} canSeeAgency={canSeeAgency} agencyPeriod={agencyPeriod} onAgencyPeriodChange={setAgencyPeriod} />

      <details className="cx-dashboard__details group">
        <summary className="cx-dashboard__details-summary">
          <span className="cx-dashboard__details-copy">
            <span>Explorer les données détaillées</span>
            <span className="cx-dashboard__details-description">Ouvrir les tableaux personnels et les indicateurs de l’agence disponibles pour votre rôle.</span>
          </span>
          <span className="cx-dashboard__details-toggle">
            <span className="cx-dashboard__details-hint group-open:hidden">Afficher</span>
            <span className="cx-dashboard__details-hint hidden group-open:inline">Replier</span>
            <span className="cx-dashboard__details-chevron" aria-hidden="true">⌄</span>
          </span>
        </summary>

        <div className="mt-6 flex flex-col gap-8">
          <Card title="Ma journée" action={<button type="button" className="cx-btn cx-btn--outline cx-btn--sm" onClick={me.reload} disabled={me.loading}>{me.loading ? "Actualisation…" : "Actualiser"}</button>}>
            {me.error ? <Notice>{me.error}</Notice> : null}
            {me.loading && !me.data ? <p className="cx-small">Chargement…</p> : null}
            {me.data ? <MyDayView data={me.data} /> : null}
          </Card>

          {canSeeAgency ? (
            <div className="flex flex-col gap-3">
              <div className="flex justify-end">
                <button type="button" className="cx-btn cx-btn--outline cx-btn--sm" onClick={agency.reload} disabled={agency.loading}>{agency.loading ? "Actualisation…" : "Actualiser l’agence"}</button>
              </div>
              {agency.error ? <Notice>{agency.error}</Notice> : null}
              {agency.loading && !agency.data ? <p className="cx-small">Chargement…</p> : null}
              {agency.data ? <AgencyView data={agency.data} /> : null}
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}
