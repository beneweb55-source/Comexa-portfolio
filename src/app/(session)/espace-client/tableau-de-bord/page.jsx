"use client";

import Link from "next/link";
import { ArrowUpRight, BarChart3, FileText, FolderKanban, MessageSquare, ShoppingCart, Wrench } from "lucide-react";
import { useObject } from "@/lib/use-object";
import { DataView } from "@/components/workspace/DataView";
import { Button } from "@/components/softui/primitives";
import { Panel } from "@/components/softui/panels";
import { Empty, Notice, SkeletonList } from "@/components/workspace/ui";

/**
 * Tableau de bord de l'espace client.
 *
 * Habillage : design system « soft UI pastel dans une coque noire », le même
 * que le tableau de bord de Comexa Space — raccourcis en pilules, panneaux
 * blancs très arrondis, un seul bouton noir par action principale.
 */
export default function TableauDeBordClientPage() {
  const dashboard = useObject("/dashboard/client");
  const counters = dashboard.data?.counters ?? dashboard.data ?? {};

  return (
    <div className="flex flex-col gap-6">
      {dashboard.error ? <Notice>{dashboard.error}</Notice> : null}

      {/* Raccourcis : les trois choses qu'un client vient faire ici. */}
      <Panel className="sui-panel--toolbar">
        <div className="sui-chat__filters">
          <Link href="/espace-client/commander" className="sui-btn sui-btn--dark">
            <ShoppingCart size={16} strokeWidth={1.9} aria-hidden="true" /> Commander un pack
          </Link>
          <Link href="/espace-client/modifications" className="sui-btn">
            <Wrench size={16} strokeWidth={1.9} aria-hidden="true" /> Demander une modification
          </Link>
          <Link href="/espace-client/messagerie" className="sui-btn">
            <MessageSquare size={16} strokeWidth={1.9} aria-hidden="true" /> Contacter l’équipe
          </Link>
        </div>
        <Link href="/espace-client" className="sui-btn sui-btn--ghost">
          Vue d’ensemble complète <ArrowUpRight size={16} strokeWidth={1.9} aria-hidden="true" />
        </Link>
      </Panel>

      <Panel title="Indicateurs de votre compte" subtitle="Synthèse en temps réel des données de votre espace client.">
        {dashboard.loading && !dashboard.data ? <SkeletonList rows={3} /> : null}
        {!dashboard.loading && !dashboard.error && !dashboard.data ? (
          <Empty icon={BarChart3}>Aucune donnée disponible pour le moment.</Empty>
        ) : null}
        {dashboard.data ? <DataView value={counters} /> : null}
      </Panel>
    </div>
  );
}
