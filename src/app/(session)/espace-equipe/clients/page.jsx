"use client";

import { useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Notice } from "@/components/workspace/ui";

const CLIENT_STATUS = { ACTIVE: "Actif", INACTIVE: "Inactif", ARCHIVED: "Archivé" };

export default function ClientsEquipePage() {
  const clients = useListing("/clients?perPage=50");
  const items = clients.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      {clients.error ? <Notice>{clients.error}</Notice> : null}
      <Card title="Clients">
        {clients.items === null && !clients.error ? <p className="text-[14px] text-[#4B5563]">Chargement…</p> : null}
        {clients.items !== null && items.length === 0 ? <Empty>Aucun client enregistré.</Empty> : null}
        <ul className="flex flex-col gap-3">
          {items.map((client) => (
            <li key={client.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E5ECF5] p-4">
              <div>
                <p className="text-[12px] uppercase tracking-wide text-[#6B7280]">{client.reference}</p>
                <h3 className="text-[16px] font-semibold text-[#0B2545]">{client.companyName}</h3>
                <p className="text-[13.5px] text-[#4B5563]">
                  {[client.sector, client.city, client.country].filter(Boolean).join(" · ") || "Coordonnées à compléter"}
                </p>
              </div>
              <Badge tone={client.status === "ACTIVE" ? "success" : "neutral"}>{CLIENT_STATUS[client.status] ?? client.status}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
