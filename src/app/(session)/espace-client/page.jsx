"use client";

import Link from "next/link";
import { useListing } from "@/lib/use-listing";
import { formatDate, formatMoney } from "@/lib/api";
import { ORDER_STATUS, PAYMENT_STATUS, PROJECT_REQUEST_STATUS, PROJECT_STATUS, nextStepFor, orderFlowStates } from "@/lib/labels";
import { INVOICE_STATUS, INVOICE_STATUS_TONE, QUOTE_OPEN_STATUSES, QUOTE_STATUS, QUOTE_STATUS_TONE, remainingDue } from "@/lib/commercial";
import { Badge, Card, Empty, Notice, OrderSteps, ProgressBar, secondaryButton, primaryButton } from "@/components/workspace/ui";

const PAYMENT_TONE = { UNPAID: "warning", PARTIALLY_PAID: "info", PAID: "success", FAILED: "danger", REFUNDED: "neutral" };

/**
 * Tableau de bord client. Chaque section charge ses données séparément : une
 * erreur sur un bloc n'efface pas les autres et ne vide jamais un bloc déjà affiché.
 */
export default function EspaceClientPage() {
  const orders = useListing("/orders");
  const projects = useListing("/projects");
  const requests = useListing("/project-requests/mine");
  const quotes = useListing("/quotes?perPage=20");
  const invoices = useListing("/invoices?perPage=20");

  const noOrders = orders.items !== null && orders.items.length === 0;
  const noProjects = projects.items !== null && projects.items.length === 0;

  return (
    <div className="flex flex-col gap-8">
      {noOrders && noProjects ? (
        <Card>
          <p className="cx-eyebrow !text-[#0f65a2]">Bienvenue</p>
          <h4 className="mt-2 !text-[#152f4d]">Votre espace se remplit dès votre première commande.</h4>
          <p className="cx-lead mt-3 !text-[#526980]">Choisissez un pack : son tarif s’affiche avant toute validation.</p>
          <div className="mt-6">
            <Link href="/espace-client/commander" className="cx-btn cx-btn--accent">
              Voir les packs
            </Link>
          </div>
        </Card>
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
        {orders.items === null && !orders.error ? <p className="cx-small">Chargement…</p> : null}
        {orders.items?.length === 0 ? (
          <Empty title="Aucune commande pour le moment.">
            Un pack commandé apparaîtra ici, avec ses étapes, son paiement et la prochaine action attendue.
          </Empty>
        ) : null}
        <ul className="flex flex-col gap-5">
          {(orders.items ?? []).map((order) => (
            <li key={order.id} className="cx-item !flex-col !items-stretch">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="cx-item__ref">{order.reference}</p>
                  <h4 className="mt-1">{order.packageName}</h4>
                  <p className="cx-small mt-1">
                    {formatMoney(order.amount, order.currency)} · commandé le {formatDate(order.orderedAt)}
                  </p>
                </div>
                <div className="cx-cluster">
                  <Badge tone="info">{ORDER_STATUS[order.status] ?? order.status}</Badge>
                  <Badge tone={PAYMENT_TONE[order.paymentStatus] ?? "neutral"}>
                    {PAYMENT_STATUS[order.paymentStatus] ?? order.paymentStatus}
                  </Badge>
                </div>
              </div>
              <div className="mt-5">
                <OrderSteps steps={orderFlowStates(order.status)} />
              </div>
              <p className="cx-small mt-5 rounded-[var(--comexa-radius-sm)] bg-[var(--comexa-neutral-100)] px-4 py-3 text-[var(--comexa-ink)]">
                <span className="font-medium">Prochaine étape : </span>
                {nextStepFor(order)}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Card id="projets" title="Mes projets">
        {projects.error ? <Notice>{projects.error}</Notice> : null}
        {projects.items === null && !projects.error ? <p className="cx-small">Chargement…</p> : null}
        {noProjects ? (
          <Empty title="Aucun projet démarré.">
            Votre projet apparaîtra ici après validation de votre commande par notre équipe. Son avancement n’est affiché qu’une fois le projet démarré.
          </Empty>
        ) : null}
        <ul className="flex flex-col gap-4">
          {(projects.items ?? []).map((project) => (
            <li key={project.id} className="cx-item">
              <div className="min-w-[220px] flex-1">
                <p className="cx-item__ref">{project.reference}</p>
                <h4 className="mt-1">{project.name}</h4>
                <p className="cx-small mt-1">
                  {PROJECT_STATUS[project.status] ?? project.status} · échéance {formatDate(project.dueDate)}
                </p>
                <div className="mt-4 max-w-[420px]">
                  <ProgressBar value={project.progressPercent} />
                </div>
              </div>
              <Link href={`/espace-client/projets/${project.id}`} className={primaryButton}>
                Suivre le projet
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card id="demandes" title="Mes demandes de projet">
        {requests.error ? <Notice>{requests.error}</Notice> : null}
        {requests.items?.length === 0 ? <Empty>Aucune demande en cours.</Empty> : null}
        <ul className="flex flex-col gap-3">
          {(requests.items ?? []).map((item) => (
            <li key={item.id} className="cx-item">
              <div>
                <p className="cx-item__ref">{item.reference}</p>
                <p className="mt-1 text-[15px] text-[var(--comexa-ink)]">{item.packageName ?? "Projet sur mesure"}</p>
                <p className="cx-caption">déposée le {formatDate(item.createdAt)}</p>
              </div>
              <Badge tone="neutral">{PROJECT_REQUEST_STATUS[item.status] ?? item.status}</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card id="devis" title="Mes devis">
        {quotes.error ? <Notice>{quotes.error}</Notice> : null}
        {quotes.items?.length === 0 ? <Empty>Aucun devis pour le moment. Un devis vous sera proposé après échange avec notre équipe.</Empty> : null}
        <ul className="flex flex-col gap-3">
          {(quotes.items ?? []).map((quote) => (
            <li key={quote.id} className="cx-item">
              <div className="min-w-[220px] flex-1">
                <p className="cx-item__ref">{quote.reference}</p>
                <h4 className="mt-1">{quote.subject}</h4>
                <p className="cx-small mt-1">
                  {formatMoney(quote.total, quote.currency)} · valable jusqu’au {formatDate(quote.validUntil)}
                </p>
              </div>
              <div className="cx-cluster">
                <Badge tone={QUOTE_STATUS_TONE[quote.status] ?? "neutral"}>{QUOTE_STATUS[quote.status] ?? quote.status}</Badge>
                <Link href={`/espace-client/devis/${quote.id}`} className={QUOTE_OPEN_STATUSES.includes(quote.status) ? primaryButton : secondaryButton}>
                  {QUOTE_OPEN_STATUSES.includes(quote.status) ? "Examiner et décider" : "Voir"}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card id="factures" title="Mes factures">
        {invoices.error ? <Notice>{invoices.error}</Notice> : null}
        {invoices.items?.length === 0 ? <Empty>Aucune facture pour le moment.</Empty> : null}
        <ul className="flex flex-col gap-3">
          {(invoices.items ?? []).map((invoice) => (
            <li key={invoice.id} className="cx-item">
              <div className="min-w-[220px] flex-1">
                <p className="cx-item__ref">{invoice.reference}</p>
                <h4 className="mt-1">{invoice.subject || "Facture"}</h4>
                <p className="cx-small mt-1">
                  {formatMoney(invoice.total, invoice.currency)} · échéance {formatDate(invoice.dueDate)} · reste à payer {formatMoney(remainingDue(invoice), invoice.currency)}
                </p>
              </div>
              <Badge tone={INVOICE_STATUS_TONE[invoice.status] ?? "neutral"}>{INVOICE_STATUS[invoice.status] ?? invoice.status}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
