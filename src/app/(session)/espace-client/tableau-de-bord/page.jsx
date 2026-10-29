"use client";

import Link from "next/link";
import { ArrowUpRight, FileText, FolderKanban, MessageSquare, ReceiptText, ShoppingCart, Wrench } from "lucide-react";
import { Panel } from "@/components/softui/panels";
import CurrencyScopeToggle from "@/components/softui/CurrencyScopeToggle";
import ClientFocusBoard from "@/components/client/ClientFocusBoard";
import { useClientPortalData } from "@/components/client/useClientPortalData";

/**
 * Tableau de bord client : la synthèse en langage métier remplace l'ancien
 * `DataView` générique. `DataView` reste disponible pour les rapports internes ;
 * il n'est plus utilise ici, car un client n'a pas à lire des clés JSON.
 */
export default function TableauDeBordClientPage() {
  const focus = useClientPortalData();

  return (
    <div className="flex flex-col gap-6">
      <ClientFocusBoard model={focus.model} loading={focus.loading} errors={focus.errors} compact />

      <CurrencyScopeToggle label="Devise de mes montants" />

      <Panel
        title="Accéder à toutes vos informations"
        subtitle="Chaque lien ouvre la rubrique où l'action peut réellement être effectuée."
      >
        <div className="client-dashboard-links">
          <Link href="/espace-client#mes-projets" className="client-focus__link"><FolderKanban size={16} aria-hidden="true" /> Mes projets</Link>
          <Link href="/espace-client/factures" className="client-focus__link"><ReceiptText size={16} aria-hidden="true" /> Mes factures</Link>
          <Link href="/espace-client/modifications" className="client-focus__link"><Wrench size={16} aria-hidden="true" /> Mes demandes</Link>
          <Link href="/espace-client/messagerie" className="client-focus__link"><MessageSquare size={16} aria-hidden="true" /> Messagerie</Link>
          <Link href="/espace-client/commander" className="client-focus__link"><ShoppingCart size={16} aria-hidden="true" /> Commander</Link>
          <Link href="/espace-client#mes-devis" className="client-focus__link"><FileText size={16} aria-hidden="true" /> Mes devis</Link>
        </div>
        <Link href="/espace-client" className="client-focus__link client-dashboard-links__all">
          Ouvrir la vue d’ensemble complète <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </Panel>
    </div>
  );
}
