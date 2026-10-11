"use client";

import { use } from "react";
import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { PAYMENT_METHOD } from "@/lib/commercial";
import { ORDER_STATUS, PAYMENT_STATUS, PROJECT_STATUS } from "@/lib/labels";
import { Badge, Card, Notice } from "@/components/workspace/ui";

export default function CommandeEquipeDetailPage({ params }) {
  const { id } = use(params);
  const { user } = useAuth();
  const order = useListing(`/orders/${encodeURIComponent(id)}`);

  if (order.items === null) {
    return (
      <div className="flex flex-col gap-5">
        <Link href="/espace-equipe/commandes" className="text-sm font-medium text-[var(--comexa-accent-strong)] hover:underline">← Retour aux commandes</Link>
        {order.error ? <Notice>{order.error}</Notice> : <p className="cx-small" role="status">Chargement de la commande…</p>}
      </div>
    );
  }

  const data = order.items;
  const canOpenClient = can(user, "client:read:any");
  const canOpenProject = can(user, "project:read:any") || can(user, "project:read:own") || can(user, "project:read:assigned");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/espace-equipe/commandes" className="text-sm font-medium text-[var(--comexa-accent-strong)] hover:underline">← Retour aux commandes</Link>
          <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--comexa-ink-muted)]">Commande {data.reference}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--comexa-ink)]">{data.packageName}</h2>
          <p className="mt-1 text-sm text-[var(--comexa-ink-soft)]">Reçue le {formatDate(data.orderedAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={data.status === "COMPLETED" ? "success" : data.status === "CANCELLED" ? "neutral" : "info"}>{ORDER_STATUS[data.status] ?? data.status}</Badge>
          <Badge tone={data.paymentStatus === "PAID" ? "success" : data.paymentStatus === "FAILED" ? "danger" : "warning"}>{PAYMENT_STATUS[data.paymentStatus] ?? data.paymentStatus}</Badge>
        </div>
      </div>

      {order.error ? <Notice>{order.error}</Notice> : null}

      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <Card title="Récapitulatif">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Detail label="Pack commandé" value={data.packageName} />
            <Detail label="Montant enregistré" value={formatMoney(data.amount, data.currency)} />
            <Detail label="Moyen de paiement" value={PAYMENT_METHOD[data.paymentMethod] ?? data.paymentMethod} />
            <Detail label="Date de commande" value={formatDate(data.orderedAt)} />
            {data.country ? <Detail label="Pays de facturation" value={data.country} /> : null}
          </dl>
        </Card>

        <Card title="Client">
          <p className="font-semibold text-[var(--comexa-ink)]">{data.customer.firstName} {data.customer.lastName}</p>
          <a href={`mailto:${data.customer.email}`} className="mt-1 inline-block text-sm text-[var(--comexa-accent-strong)] hover:underline">{data.customer.email}</a>
          {canOpenClient ? (
            <p className="mt-3 text-sm">
              <Link href={`/espace-equipe/clients/${data.clientId}`} className="font-medium text-[var(--comexa-accent-strong)] hover:underline">Ouvrir la fiche client →</Link>
            </p>
          ) : null}
        </Card>

        <Card title="Projet associé">
          {data.project ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-[var(--comexa-ink)]">Référence {data.project.reference}</p>
                <p className="mt-1 text-sm text-[var(--comexa-ink-soft)]">
                  {PROJECT_STATUS[data.project.status] ?? data.project.status} · {data.project.progressPercent ?? 0} %
                </p>
                <p className="mt-1 text-[13px] text-[var(--comexa-ink-muted)]">Échéance : {formatDate(data.project.dueDate)}</p>
              </div>
              {canOpenProject ? <Link href={`/espace-equipe/projets/${data.project.id}`} className="text-sm font-medium text-[var(--comexa-accent-strong)] hover:underline">Ouvrir le projet →</Link> : null}
            </div>
          ) : (
            <p className="cx-small">Aucun projet n’a encore été créé pour cette commande.</p>
          )}
        </Card>
      </div>
      <p className="cx-small">Les actions de validation, de démarrage et de paiement restent accessibles depuis la liste des commandes selon vos autorisations.</p>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--comexa-ink-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-sm text-[var(--comexa-ink)]">{value || "—"}</dd>
    </div>
  );
}
