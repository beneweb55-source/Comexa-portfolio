"use client";

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
  const me = useObject("/dashboard/me", canSeeMe);
  const agency = useObject("/dashboard", canSeeAgency);

  if (!canSeeMe) {
    return <Notice tone="warning">Votre compte n’a pas accès au tableau de bord de l’équipe.</Notice>;
  }

  return (
    <div className="flex flex-col gap-8">
      <BentoDashboard me={me} agency={agency} canSeeAgency={canSeeAgency} />

      <details className="group rounded-3xl border border-white/10 bg-white/[0.04] p-5 text-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.25)] backdrop-blur-xl">
        <summary className="cursor-pointer list-none text-[15px] font-semibold text-white marker:content-none">
          <span className="flex items-center justify-between gap-3">
            Tableaux détaillés
            <span className="text-[12.5px] font-normal text-white/55 group-open:hidden">Afficher</span>
            <span className="hidden text-[12.5px] font-normal text-white/55 group-open:inline">Replier</span>
          </span>
        </summary>

        <div className="mt-6 flex flex-col gap-8">
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
      </details>
    </div>
  );
}
