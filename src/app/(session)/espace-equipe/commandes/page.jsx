"use client";

/*
 * Commandes (espace équipe).
 *
 * Refonte visuelle uniquement : la liste reste un TABLEAU plutôt qu'une grille de
 * cartes — c'est une file d'actions avec changement de statut de paiement, et un
 * tableau se lit mieux (et se compare mieux) qu'une carte pour ce cas. Les
 * filtres passent en pilules, les messages en alertes pastel, et le bouton
 * « Actualiser » devient le bouton secondaire à côté de l'action principale.
 *
 * Toute la logique d'origine est conservée : validation (création du projet),
 * démarrage, mise à jour du paiement et boîtes de confirmation.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CircleAlert, RefreshCw, ShoppingCart } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/api";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/lib/labels";
import { useAction, useListing } from "@/lib/use-listing";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { ConfirmDialog, Pagination, inputClass } from "@/components/workspace/ui";
import { Alert, Button, FilterPills, Panel, StatusPill } from "@/components/softui";

const PAYMENT_OPTIONS = ["UNPAID", "PARTIALLY_PAID", "PAID", "FAILED", "REFUNDED"];
const VALIDATABLE = ["ORDERED", "IN_REVIEW"];

const ORDER_TONE = {
  ORDERED: "yellow",
  IN_REVIEW: "lilac",
  IN_PREPARATION: "blue",
  IN_PROGRESS: "blue",
  COMPLETED: "green",
  CANCELLED: "pink",
};

const PAYMENT_TONE = {
  UNPAID: "pink",
  PARTIALLY_PAID: "yellow",
  PAID: "green",
  FAILED: "pink",
  REFUNDED: "plain",
};

export default function CommandesEquipePage() {
  const { user } = useAuth();
  const canManageOrders = can(user, "order:validate:any");
  const canReadProjects = can(user, "project:read:any") || can(user, "project:read:own") || can(user, "project:read:assigned");
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const query = new URLSearchParams({ page: String(page), perPage: "50" });
  if (filter) query.set("status", filter);
  const orders = useListing(`/orders?${query.toString()}`);
  const action = useAction(orders.reload);
  const [drafts, setDrafts] = useState({});
  const [pendingValidate, setPendingValidate] = useState(null);
  const [pendingStart, setPendingStart] = useState(null);

  function validate(order) {
    return action.run(`validate:${order.id}`, `/orders/${order.id}/validate`, { method: "POST" }, `Commande ${order.reference} validée : projet créé.`);
  }

  function start(order) {
    return action.run(`start:${order.id}`, `/orders/${order.id}/start`, { method: "POST" }, `Projet de la commande ${order.reference} démarré.`);
  }

  function savePayment(order) {
    const paymentStatus = drafts[order.id] ?? order.paymentStatus;
    return action.run(
      `payment:${order.id}`,
      `/orders/${order.id}/payment`,
      { method: "PATCH", body: { paymentStatus } },
      `Paiement de ${order.reference} enregistré.`,
    );
  }

  const items = orders.items ?? [];

  return (
    <div className="flex flex-col">
      {orders.error ? <Alert icon={CircleAlert}>{orders.error}</Alert> : null}
      {action.error ? <Alert icon={CircleAlert}>{action.error}</Alert> : null}
      {action.success ? <Alert tone="success">{action.success}</Alert> : null}

      <FilterPills
        label="Filtrer les commandes par statut"
        value={filter}
        onChange={(value) => {
          setFilter(value);
          setPage(1);
        }}
        items={[{ id: "", label: "Tous les statuts" }, ...Object.entries(ORDER_STATUS).map(([id, label]) => ({ id, label }))]}
        actions={
          <Button variant="ghost" icon={RefreshCw} onClick={() => orders.reload()} disabled={orders.loading}>
            {orders.loading ? "Actualisation…" : "Actualiser"}
          </Button>
        }
      />

      <section className="sui-section" aria-label="Liste des commandes">
        <Panel
          title={
            <>
              <ShoppingCart size={18} strokeWidth={1.75} aria-hidden="true" />
              Commandes
            </>
          }
        >
          {orders.items === null && !orders.error ? <p className="sui-card__desc" role="status">Chargement des commandes…</p> : null}
          {orders.items !== null && items.length === 0 ? <p className="sui-card__desc">Aucune commande pour ces critères.</p> : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-[13.5px]">
              <thead className="text-[12px] uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="py-2 pr-3">Référence</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Pack</th>
                  <th className="py-2 pr-3">Montant</th>
                  <th className="py-2 pr-3">Statut</th>
                  <th className="py-2 pr-3">Paiement</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((order) => {
                  const busy = action.busy?.endsWith(`:${order.id}`);
                  return (
                    <tr key={order.id} className="border-t border-[rgba(17,17,17,0.07)] align-top">
                      <td className="py-3 pr-3">
                        <Link href={`/espace-equipe/commandes/${order.id}`} className="font-semibold underline-offset-2 hover:underline">
                          {order.reference}
                        </Link>
                        <p className="text-[12.5px] text-[var(--muted)]">{formatDate(order.orderedAt)}</p>
                      </td>
                      <td className="py-3 pr-3">
                        <p>{order.customer.firstName} {order.customer.lastName}</p>
                        <p className="text-[12.5px] text-[var(--muted)]">{order.customer.email}</p>
                        {order.country ? <p className="text-[12.5px] text-[var(--muted)]">Pays : {order.country}</p> : null}
                      </td>
                      <td className="py-3 pr-3">{order.packageName}</td>
                      <td className="py-3 pr-3 whitespace-nowrap">{formatMoney(order.amount, order.currency)}</td>
                      <td className="py-3 pr-3">
                        <StatusPill tone={ORDER_TONE[order.status] ?? "plain"} label={ORDER_STATUS[order.status] ?? order.status} />
                        {order.project && canReadProjects ? (
                          <p className="mt-1">
                            <Link href={`/espace-equipe/projets/${order.project.id}`} className="text-[12.5px] underline-offset-2 hover:underline">
                              Projet {order.project.reference}
                            </Link>
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3">
                        <div className={canManageOrders ? "flex min-w-[210px] flex-col gap-2" : ""}>
                          <StatusPill tone={PAYMENT_TONE[order.paymentStatus] ?? "plain"} label={PAYMENT_STATUS[order.paymentStatus] ?? order.paymentStatus} />
                          {canManageOrders ? (
                            <div className="flex gap-2">
                              <select
                                aria-label={`Paiement de ${order.reference}`}
                                value={drafts[order.id] ?? order.paymentStatus}
                                onChange={(event) => setDrafts((current) => ({ ...current, [order.id]: event.target.value }))}
                                className={`${inputClass} h-9 text-[13px]`}
                              >
                                {PAYMENT_OPTIONS.map((option) => (
                                  <option key={option} value={option}>
                                    {PAYMENT_STATUS[option]}
                                  </option>
                                ))}
                              </select>
                              <Button onClick={() => savePayment(order)} disabled={busy}>
                                Enregistrer
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-col items-start gap-2">
                          {canManageOrders && VALIDATABLE.includes(order.status) ? (
                            <Button icon={ArrowUpRight} onClick={() => setPendingValidate(order)} disabled={busy}>
                              Valider et créer le projet
                            </Button>
                          ) : null}
                          {canManageOrders && order.status === "IN_PREPARATION" ? (
                            <Button onClick={() => setPendingStart(order)} disabled={busy}>
                              Démarrer le projet
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination meta={orders.meta} onPageChange={setPage} loading={orders.loading} />
        </Panel>
      </section>

      <ConfirmDialog
        open={pendingValidate !== null}
        title="Valider la commande et créer le projet ?"
        confirmLabel="Valider"
        busy={pendingValidate !== null && action.busy === `validate:${pendingValidate.id}`}
        onCancel={() => setPendingValidate(null)}
        onConfirm={async () => {
          if (!pendingValidate) return;
          const saved = await validate(pendingValidate);
          if (saved) setPendingValidate(null);
        }}
      >
        {action.error ? <Alert icon={CircleAlert}>{action.error}</Alert> : null}
        <p className="cx-small">
          {pendingValidate ? `Commande ${pendingValidate.reference} : la validation crée le projet et donne accès au client. Action à faire une seule fois.` : ""}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingStart !== null}
        title="Démarrer le projet issu de cette commande ?"
        confirmLabel="Démarrer le projet"
        busy={pendingStart !== null && action.busy === `start:${pendingStart.id}`}
        onCancel={() => setPendingStart(null)}
        onConfirm={async () => {
          if (!pendingStart) return;
          const saved = await start(pendingStart);
          if (saved) setPendingStart(null);
        }}
      >
        {action.error ? <Alert icon={CircleAlert}>{action.error}</Alert> : null}
        <p className="cx-small">
          {pendingStart ? `La commande ${pendingStart.reference} passera à l’état « Projet en cours ».` : ""}
        </p>
      </ConfirmDialog>
    </div>
  );
}
