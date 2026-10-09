"use client";


import Link from "next/link";
import { useListing } from "@/lib/use-listing";
import { formatDate, formatMoney } from "@/lib/api";
import { ORDER_STATUS, PAYMENT_STATUS, PROJECT_REQUEST_STATUS, PROJECT_STATUS, nextStepFor } from "@/lib/labels";
import { Badge, Card, Empty, Notice, ProgressBar, secondaryButton } from "@/components/workspace/ui";

const PAYMENT_TONE = { UNPAID: "warning", PARTIALLY_PAID: "info", PAID: "success", FAILED: "danger", REFUNDED: "neutral" };

/**
 * Tableau de bord client. Chaque section charge ses donnees separement : une
 * erreur sur un bloc n'efface pas les autres, et ne vide jamais un bloc deja affiche.
 */
export default function EspaceClientPage() {
  const orders = useListing("/orders");
  const projects = useListing("/projects");
  const requests = useListing("/project-requests/mine");

  const noOrders = orders.items !== null && orders.items.length === 0;
  const noProjects = projects.items !== null && projects.items.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {noOrders && noProjects ? (
        <Notice tone="info">
          Bienvenue. Votre espace se remplit dès votre première commande. Choisissez un pack pour démarrer.{" "}
          <Link href="/espace-client/commander" className="font-medium underline">
            Voir les packs
          </Link>
        </Notice>
      ) : null}

      <Card
        id="commandes"
        title="Mes commandes"
        action={
          <Link href="/espace-client/commander" className={secondaryButton}>
            Commander un pack
          </Link>
        }
      >
        {orders.error ? <Notice>{orders.error}</Notice> : null}
        {orders.items === null && !orders.error ? <p className="text-[14px] text-[#4B5563]">Chargement…</p> : null}
        {orders.items?.length === 0 ? <Empty>Aucune commande pour le moment.</Empty> : null}
        <ul className="flex flex-col gap-4">
          {(orders.items ?? []).map((order) => (
            <li key={order.id} className="rounded-lg border border-[#E5ECF5] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] uppercase tracking-wide text-[#6B7280]">{order.reference}</p>
                  <h3 className="text-[17px] font-semibold text-[#0B2545]">{order.packageName}</h3>
                  <p className="text-[14px] text-[#4B5563]">
                    {formatMoney(order.amount, order.currency)} · commandé le {formatDate(order.orderedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="info">{ORDER_STATUS[order.status] ?? order.status}</Badge>
                  <Badge tone={PAYMENT_TONE[order.paymentStatus] ?? "neutral"}>
                    {PAYMENT_STATUS[order.paymentStatus] ?? order.paymentStatus}
                  </Badge>
                </div>
              </div>
              <p className="mt-3 rounded-md bg-[#F8F9FC] px-3 py-2 text-[14px] text-[#111827]">
                <span className="font-medium">Prochaine étape : </span>
                {nextStepFor(order)}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Card id="projets" title="Mes projets">
        {projects.error ? <Notice>{projects.error}</Notice> : null}
        {projects.items === null && !projects.error ? <p className="text-[14px] text-[#4B5563]">Chargement…</p> : null}
        {noProjects ? (
          <Empty>Votre projet apparaîtra ici dès qu’il sera validé par notre équipe.</Empty>
        ) : null}
        <ul className="flex flex-col gap-4">
          {(projects.items ?? []).map((project) => (
            <li key={project.id} className="rounded-lg border border-[#E5ECF5] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[12px] uppercase tracking-wide text-[#6B7280]">{project.reference}</p>
                  <h3 className="text-[17px] font-semibold text-[#0B2545]">{project.name}</h3>
                  <p className="text-[14px] text-[#4B5563]">
                    {PROJECT_STATUS[project.status] ?? project.status} · échéance {formatDate(project.dueDate)}
                  </p>
                </div>
                <Link href={`/espace-client/projets/${project.id}`} className={secondaryButton}>
                  Suivre le projet
                </Link>
              </div>
              <div className="mt-4">
                <ProgressBar value={project.progressPercent} />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card id="demandes" title="Mes demandes de projet">
        {requests.error ? <Notice>{requests.error}</Notice> : null}
        {requests.items?.length === 0 ? <Empty>Aucune demande en cours.</Empty> : null}
        <ul className="flex flex-col gap-3">
          {(requests.items ?? []).map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E5ECF5] p-4">
              <div>
                <p className="text-[12px] uppercase tracking-wide text-[#6B7280]">{item.reference}</p>
                <p className="text-[15px] text-[#111827]">{item.packageName ?? "Projet sur mesure"}</p>
                <p className="text-[13px] text-[#4B5563]">déposée le {formatDate(item.createdAt)}</p>
              </div>
              <Badge tone="neutral">{PROJECT_REQUEST_STATUS[item.status] ?? item.status}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
