"use client";

import { useState } from "react";
import { ArrowUpRight, CalendarDays, Check, CircleAlert, Package, Users, X } from "lucide-react";
import { apiFetch, formatDate, formatMoney, messageOf } from "@/lib/api";
import { ORDER_STATUS } from "@/lib/labels";
import { useListing } from "@/lib/use-listing";
import { Empty, Pagination, SkeletonList } from "@/components/workspace/ui";
import { Alert, FilterPills, ItemCard, ItemGrid } from "@/components/softui";
import { useShellQuery } from "@/components/softui/Shell";

const STATUS_TONE = {
  DRAFT: "plain",
  SUBMITTED: "yellow",
  CONFIRMED: "green",
  IN_PROGRESS: "blue",
  COMPLETED: "green",
  CANCELLED: "pink",
  REFUNDED: "lilac",
};

export default function CommandesEquipePage() {
  const { query } = useShellQuery();
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), perPage: "50" });
  if (filter) params.set("status", filter);
  if (query.trim()) params.set("search", query.trim());

  const orders = useListing(`/orders?${params.toString()}`);
  const [busyId, setBusyId] = useState(null);
  const [feedback, setFeedback] = useState(null);

  async function updateStatus(id, status) {
    setBusyId(id);
    setFeedback(null);
    try {
      await apiFetch(`/orders/${id}/status`, { method: "PATCH", body: { status } });
      await orders.reload();
    } catch (caught) {
      setFeedback(messageOf(caught));
    } finally {
      setBusyId(null);
    }
  }

  const items = orders.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      {orders.error ? <Alert icon={CircleAlert}>{orders.error}</Alert> : null}
      {feedback ? <Alert icon={CircleAlert}>{feedback}</Alert> : null}

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
            {items.map((order) => {
              const actions = [
                {
                  icon: ArrowUpRight,
                  label: `Voir la commande ${order.reference}`,
                  href: `/espace-equipe/commandes/${order.id}`,
                  variant: "dark",
                },
              ];
              if (order.status === "SUBMITTED") {
                actions.unshift(
                  {
                    icon: Check,
                    label: "Confirmer et créer le projet",
                    onClick: () => updateStatus(order.id, "CONFIRMED"),
                    disabled: busyId === order.id,
                  },
                  {
                    icon: X,
                    label: "Refuser la commande",
                    onClick: () => updateStatus(order.id, "CANCELLED"),
                    disabled: busyId === order.id,
                  },
                );
              }
              return (
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
                  actions={actions}
                />
              );
            })}
          </ItemGrid>
        ) : null}

        <Pagination meta={orders.meta} onPageChange={setPage} loading={orders.loading} />
      </section>
    </div>
  );
}
