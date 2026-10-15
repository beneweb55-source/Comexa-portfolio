"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  BarChart3,
  FileText,
  FolderKanban,
  MessageSquare,
  ShoppingCart,
  Wrench,
} from "lucide-react";
import { useObject } from "@/lib/use-object";
import { DataView } from "@/components/workspace/DataView";
import { Card, Empty, Notice, SkeletonList, primaryButton, secondaryButton } from "@/components/workspace/ui";

export default function TableauDeBordClientPage() {
  const dashboard = useObject("/dashboard/client");
  const counters = dashboard.data?.counters ?? dashboard.data ?? {};

  return (
    <div className="flex flex-col gap-6">
      {dashboard.error ? <Notice>{dashboard.error}</Notice> : null}

      {/* Actions rapides client */}
      <section
        aria-label="Actions rapides"
        className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-white/85 bg-white/85 px-5 py-3.5 shadow-xs backdrop-blur-xl"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/espace-client/commander" className={`${primaryButton} cx-btn--sm`}>
            <ShoppingCart size={14} /> Commander un pack
          </Link>
          <Link href="/espace-client/modifications" className={`${secondaryButton} cx-btn--sm`}>
            <Wrench size={14} /> Demander une modification
          </Link>
          <Link href="/espace-client/messagerie" className={`${secondaryButton} cx-btn--sm`}>
            <MessageSquare size={14} /> Contacter l’équipe
          </Link>
        </div>
        <Link
          href="/espace-client"
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#1568b4] hover:underline"
        >
          Vue d’ensemble complète <ArrowUpRight size={14} />
        </Link>
      </section>

      <Card
        title="Indicateurs de votre compte"
        subtitle="Synthèse en temps réel des données de votre espace client."
      >
        {dashboard.loading && !dashboard.data ? <SkeletonList rows={3} /> : null}
        {!dashboard.loading && !dashboard.error && !dashboard.data ? (
          <Empty icon={BarChart3}>Aucune donnée disponible pour le moment.</Empty>
        ) : null}
        {dashboard.data ? <DataView value={counters} /> : null}
      </Card>
    </div>
  );
}
