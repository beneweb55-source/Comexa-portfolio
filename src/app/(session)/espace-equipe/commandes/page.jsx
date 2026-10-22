"use client";

import { useState } from "react";
import { ArrowUpRight, CalendarDays, CircleAlert, Package, Users } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/api";
import { ORDER_STATUS } from "@/lib/labels";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { orderStatusActions } from "@/lib/entity-actions";
import { Empty, Pagination, SkeletonList } from "@/components/workspace/ui";
import { Alert, FilterPills, ItemCard, ItemGrid, RecordActions } from "@/components/softui";
import { useShellQuery } from "@/components/softui/Shell";

/* Une tonalité par état réel de l'API (`OrderStatus`). Les anciennes clés
   (DRAFT, SUBMITTED, CONFIRMED, REFUNDED) n'existent pas dans l'enum : elles
   faisaient retomber toutes les cartes sur la même couleur. */
const STATUS_TONE = {
  ORDERED: "yellow",
  IN_REVIEW: "lilac",
  IN_PREPARATION: "blue",
  IN_PROGRESS: "blue",
  COMPLETED: "green",
  CANCELLED: "pink",
};

export default function CommandesEquipePage() {
  const { user } = useAuth();
  const { query } = useShellQuery();
  const canManageOrders = can(user, "order:validate:any");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), perPage: "50" });
  if (filter) params.set("status", filter);
  if (query.trim()) params.set("search", query.trim());

  const orders = useListing(`/orders?${params.toString()}`);
  const items = orders.items ?? [];

  // Les options de la commande sont partagées avec sa fiche (voir lib/entity-actions).
  const orderActions = (order) => orderStatusActions(order, canManageOrders);

  return (
    <div className="flex flex-col gap-5">
      {orders.error ? <Alert icon={CircleAlert}>{orders.error}</Alert> : null}

      <FilterPills
        label="Filtrer les commandes par statut"
        value={filter}
        onChange={(value) => {
          setFilter(value);
          setPage(1);
        }}
        items={[{ id: "", label: "Toutes" }, ...Object.entries(ORDER_STATUS).map(([id, label]) => ({ id, label }))]}
      />

      <section className="sui-section" aria-label="Liste des commandes">
        {orders.items === null && !orders.error ? <SkeletonList rows={4} /> : null}
        {orders.items !== null && items.length === 0 ? (
          <Empty icon={Package}>Aucune commande pour ces critères.</Empty>
        ) : null}

        {items.length > 0 ? (
          <ItemGrid label="Commandes">
            {items.map((order) => (
              <ItemCard
                key={order.id}
                  cornerIcon={Package}
                  cornerTone={STATUS_TONE[order.status] ?? "blue"}
                  title={order.packName || order.reference}
                  description={order.client?.companyName ?? "Client non renseigné"}
                  meta={[
                    { icon: Users, label: order.reference },
                    { icon: CalendarDays, label: formatDate(order.createdAt) },
                  ]}
                  info={formatMoney(order.total, order.currency)}
                  status={ORDER_STATUS[order.status] ?? order.status}
                  statusTone={STATUS_TONE[order.status] ?? "plain"}
                  actions={[
                    <RecordActions
                      key={`actions-${order.id}`}
                      resource="/orders"
                      id={order.id}
                      record={order}
                      entityLabel="commande"
                      displayName={order.reference}
                      label={`Actions pour la commande ${order.reference}`}
                      canDelete={false}
                      extraActions={orderActions(order)}
                      href={`/espace-equipe/commandes/${order.id}`}
                      onChanged={orders.reload}
                    />,
                    {
                      icon: ArrowUpRight,
                      label: `Voir la commande ${order.reference}`,
                      href: `/espace-equipe/commandes/${order.id}`,
                      variant: "dark",
                    },
                  ]}
                />
            ))}
          </ItemGrid>
        ) : null}

        <Pagination meta={orders.meta} onPageChange={setPage} loading={orders.loading} />
      </section>
    </div>
  );
}
