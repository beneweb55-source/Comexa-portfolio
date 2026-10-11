"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/api";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/lib/labels";
import { useAction, useListing } from "@/lib/use-listing";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { Badge, Card, ConfirmDialog, Empty, Notice, Pagination, inputClass, secondaryButton } from "@/components/workspace/ui";

const PAYMENT_OPTIONS = ["UNPAID", "PARTIALLY_PAID", "PAID", "FAILED", "REFUNDED"];
const VALIDATABLE = ["ORDERED", "IN_REVIEW"];

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
    <div className="flex flex-col gap-6">
      {orders.error ? <Notice>{orders.error}</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}

      <Card
        title="Commandes"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(1);
              }}
              className={`${inputClass} h-10 w-auto text-[13px]`}
              aria-label="Filtrer les commandes par statut"
            >
              <option value="">Tous les statuts</option>
              {Object.entries(ORDER_STATUS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
            </select>
            <button type="button" onClick={() => orders.reload()} className={secondaryButton} disabled={orders.loading}>
              {orders.loading ? "Actualisation…" : "Actualiser"}
            </button>
          </div>
        }
      >
        {orders.items === null && !orders.error ? <p className="text-[14px] text-[var(--comexa-ink-soft)]">Chargement…</p> : null}
        {orders.items !== null && items.length === 0 ? <Empty>Aucune commande.</Empty> : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[14px]">
            <thead className="border-b border-[var(--comexa-border-soft)] text-[12px] uppercase tracking-wide text-[var(--comexa-ink-muted)]">
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
                  <tr key={order.id} className="border-b border-[var(--comexa-border-soft)] align-top">
                    <td className="py-3 pr-3">
                      <Link href={`/espace-equipe/commandes/${order.id}`} className="font-medium text-[var(--comexa-accent-strong)] hover:underline">{order.reference}</Link>
                      <p className="text-[13px] text-[var(--comexa-ink-muted)]">{formatDate(order.orderedAt)}</p>
                    </td>
                    <td className="py-3 pr-3">
                      <p>{order.customer.firstName} {order.customer.lastName}</p>
                      <p className="text-[13px] text-[var(--comexa-ink-muted)]">{order.customer.email}</p>
                      {order.country ? <p className="text-[13px] text-[var(--comexa-ink-muted)]">Pays : {order.country}</p> : null}
                    </td>
                    <td className="py-3 pr-3">{order.packageName}</td>
                    <td className="py-3 pr-3 whitespace-nowrap">{formatMoney(order.amount, order.currency)}</td>
                    <td className="py-3 pr-3">
                      <Badge tone="info">{ORDER_STATUS[order.status] ?? order.status}</Badge>
                      {order.project && canReadProjects ? (
                        <p className="mt-1">
                          <Link href={`/espace-equipe/projets/${order.project.id}`} className="text-[13px] text-[var(--comexa-accent-strong)] hover:underline">
                            Projet {order.project.reference}
                          </Link>
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3">
                      <div className={canManageOrders ? "flex min-w-[200px] flex-col gap-2" : ""}>
                        <Badge tone={order.paymentStatus === "PAID" ? "success" : "warning"}>
                          {PAYMENT_STATUS[order.paymentStatus] ?? order.paymentStatus}
                        </Badge>
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
                            <button type="button" onClick={() => savePayment(order)} disabled={busy} className={secondaryButton}>
                              Enregistrer
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="flex flex-col items-start gap-2">
                        {canManageOrders && VALIDATABLE.includes(order.status) ? (
                          <button type="button" onClick={() => setPendingValidate(order)} disabled={busy} className={`${secondaryButton} `}>
                            Valider et créer le projet
                          </button>
                        ) : null}
                        {canManageOrders && order.status === "IN_PREPARATION" ? (
                          <button type="button" onClick={() => setPendingStart(order)} disabled={busy} className={secondaryButton}>
                            Démarrer le projet
                          </button>
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
      </Card>
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
        {action.error ? <Notice>{action.error}</Notice> : null}
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
        {action.error ? <Notice>{action.error}</Notice> : null}
        <p className="cx-small">
          {pendingStart ? `La commande ${pendingStart.reference} passera à l’état « Projet en cours ».` : ""}
        </p>
      </ConfirmDialog>
    </div>
  );
}
