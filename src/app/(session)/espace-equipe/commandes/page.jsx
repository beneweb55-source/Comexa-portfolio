"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/api";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/lib/labels";
import { useAction, useListing } from "@/lib/use-listing";
import { Badge, Card, ConfirmDialog, Empty, Notice, inputClass, secondaryButton } from "@/components/workspace/ui";

const PAYMENT_OPTIONS = ["UNPAID", "PARTIALLY_PAID", "PAID", "FAILED", "REFUNDED"];
const VALIDATABLE = ["ORDERED", "IN_REVIEW"];

export default function CommandesEquipePage() {
  const orders = useListing("/orders?perPage=50");
  const action = useAction(orders.reload);
  const [drafts, setDrafts] = useState({});
  const [pendingValidate, setPendingValidate] = useState(null);

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
          <button type="button" onClick={() => orders.reload()} className={secondaryButton} disabled={orders.loading}>
            {orders.loading ? "Actualisation…" : "Actualiser"}
          </button>
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
                      <p className="font-medium text-[var(--comexa-ink)]">{order.reference}</p>
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
                      {order.project ? (
                        <p className="mt-1">
                          <Link href={`/espace-equipe/projets/${order.project.id}`} className="text-[13px] text-[var(--comexa-accent-strong)] hover:underline">
                            Projet {order.project.reference}
                          </Link>
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex min-w-[200px] flex-col gap-2">
                        <Badge tone={order.paymentStatus === "PAID" ? "success" : "warning"}>
                          {PAYMENT_STATUS[order.paymentStatus] ?? order.paymentStatus}
                        </Badge>
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
                          <button type="button" onClick={() => savePayment(order)} disabled={busy} className={`${secondaryButton} `}>
                            Enregistrer
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="flex flex-col items-start gap-2">
                        {VALIDATABLE.includes(order.status) ? (
                          <button type="button" onClick={() => setPendingValidate(order)} disabled={busy} className={`${secondaryButton} `}>
                            Valider et créer le projet
                          </button>
                        ) : null}
                        {order.status === "IN_PREPARATION" ? (
                          <button type="button" onClick={() => start(order)} disabled={busy} className={`${secondaryButton} `}>
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
      </Card>
      <ConfirmDialog
        open={pendingValidate !== null}
        title="Valider la commande et créer le projet ?"
        confirmLabel="Valider"
        busy={pendingValidate !== null && action.busy === `validate:${pendingValidate.id}`}
        onCancel={() => setPendingValidate(null)}
        onConfirm={async () => {
          const target = pendingValidate;
          await validate(target);
          setPendingValidate(null);
        }}
      >
        <p className="cx-small">
          {pendingValidate ? `Commande ${pendingValidate.reference} : la validation crée le projet et donne accès au client. Action à faire une seule fois.` : ""}
        </p>
      </ConfirmDialog>
    </div>
  );
}
