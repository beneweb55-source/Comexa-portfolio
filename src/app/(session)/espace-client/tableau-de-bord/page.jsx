"use client";

import { useAuth } from "@/lib/session";
import { useObject } from "@/lib/use-object";
import { Card, Notice } from "@/components/workspace/ui";
import { DataView } from "@/components/workspace/DataView";

/** Synthèse du client : devis en cours, factures à régler, avancement de ses projets. */
export default function TableauDeBordClientPage() {
  const { user } = useAuth();
  const summary = useObject("/dashboard/client");

  return (
    <Card title={`Bonjour${user?.firstName ? ` ${user.firstName}` : ""}`} action={<button type="button" className="cx-btn cx-btn--outline cx-btn--sm" onClick={summary.reload}>Actualiser</button>}>
      {summary.error ? <Notice>{summary.error}</Notice> : null}
      {summary.loading && !summary.data ? <p className="cx-small">Chargement…</p> : null}
      {summary.data ? <DataView value={summary.data} /> : null}
    </Card>
  );
}
