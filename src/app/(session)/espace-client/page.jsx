"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  FileText,
  FolderKanban,
  Layers,
  MessageSquare,
  Plus,
  ShoppingCart,
  Wrench,
} from "lucide-react";
import { formatDate, formatMoney } from "@/lib/api";
import { QUOTE_OPEN_STATUSES, QUOTE_STATUS, QUOTE_STATUS_TONE } from "@/lib/commercial";
import { useListing } from "@/lib/use-listing";
import { ORDER_STATUS, PAYMENT_STATUS, PROJECT_REQUEST_STATUS, PROJECT_STATUS } from "@/lib/labels";
import {
  Badge,
  Empty,
  Notice,
  OrderSteps,
  Pagination,
  ProgressBar,
  SkeletonList,
  primaryButton,
  secondaryButton,
} from "@/components/workspace/ui";
import { KpiGrid } from "@/components/softui/KpiCard";
import { Panel } from "@/components/softui/panels";
import { Button } from "@/components/softui/primitives";
import { toneBackground } from "@/components/softui/primitives";

const REQUEST_REASON_HINT = {
  COUNTRY_UNKNOWN: "Tarif établi sur mesure par notre équipe",
  NO_CURRENT_RATE: "Tarif établi sur mesure par notre équipe",
  NO_COMPATIBLE_PAYMENT_METHOD: "Modalités de règlement préparées par notre équipe",
};

/**
 * Vue d'ensemble de l'espace client :
 *  1. Bandeau de 4 indicateurs (projets, devis à valider, commandes, demandes) ;
 *  2. Devis à examiner en priorité (quand un devis attend une réponse) ;
 *  3. Projets avec barre de progression, commandes avec étapes (`OrderSteps`) ;
 *  4. Demandes de projet et historique des devis.
 *
 * Habillage : design system « soft UI pastel dans une coque noire », le même
 * que le tableau de bord de Comexa Space.
 */
export default function EspaceClientPage() {
  const [quotePage, setQuotePage] = useState(1);
  const [orderPage, setOrderPage] = useState(1);
  const [projectPage, setProjectPage] = useState(1);

  const quotes = useListing(`/quotes?page=${quotePage}&perPage=50`);
  const orders = useListing(`/orders?page=${orderPage}&perPage=50`);
  /* Les demandes DU client : `GET /project-requests` est la file de l'équipe
     (`project_request:read:any`) et répondait 403 ici — le compteur restait
     bloqué sur « … » et la carte affichait « Droit insuffisant ». */
  const requests = useListing("/project-requests/mine");
  const projects = useListing(`/projects?page=${projectPage}&perPage=50`);

  const quotesVisible = quotes.errorStatus !== 403;
  const quoteList = quotes.items ?? [];
  const openQuotes = quoteList.filter((quote) => QUOTE_OPEN_STATUSES.includes(quote.status));
  const projectList = projects.items ?? [];
  const orderList = orders.items ?? [];
  const requestList = requests.items ?? [];

  const avgProgress = projectList.length
    ? Math.round(
        projectList.reduce((acc, p) => acc + (Number(p.progressPercent) || 0), 0) / projectList.length,
      )
    : 0;

  const kpis = [
    {
      id: "projects",
      tone: "blue",
      badge: projects.items === null ? "…" : `Avancement ${avgProgress} %`,
      value: projects.items === null ? "…" : projectList.length,
      label: "Projets actifs",
      deco: true,
      decoIcon: FolderKanban,
    },
    {
      id: "quotes",
      tone: "yellow",
      badge: openQuotes.length > 0 ? `${openQuotes.length} à valider` : "À jour",
      value: quotes.items === null ? "…" : quoteList.length,
      label: "Mes devis",
    },
    {
      id: "orders",
      tone: "green",
      badge: orderList.length > 0 ? "Suivi en cours" : "Aucune commande",
      value: orders.items === null ? "…" : orderList.length,
      label: "Commandes de packs",
    },
    {
      id: "requests",
      tone: "lilac",
      badge: requestList.length > 0 ? "Étude par l’équipe" : "Aucune demande",
      value: requests.error ? "—" : requests.items === null ? "…" : requestList.length,
      label: "Demandes sur mesure",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* ====================================================================
          1. INDICATEURS DE L'ESPACE CLIENT
         ==================================================================== */}
      <KpiGrid label="Synthèse de votre espace client" items={kpis} />

      {/* ====================================================================
          2. DEVIS EN ATTENTE DE RÉPONSE
         ==================================================================== */}
      {quotesVisible && openQuotes.length > 0 ? (
        <Panel
          title="Devis en attente de votre décision"
          subtitle="Consultez le détail des prestations pour accepter ou refuser la proposition."
          className="sui-panel--tint"
          style={{ "--tone-bg": "var(--yellow)" }}
        >
          <ul className="sui-lines sui-lines--rows">
            {openQuotes.map((quote) => (
              <li key={quote.id}>
                <span className="sui-lines__icon" style={{ "--tone-bg": toneBackground("blue") }} aria-hidden="true">
                  <FileText size={16} strokeWidth={1.75} />
                </span>
                <span className="sui-lines__copy">
                  <strong>{quote.subject}</strong>
                  <span>
                    {quote.reference} · valable jusqu’au {formatDate(quote.validUntil)} ·{" "}
                    <span className="sui-tabular">{formatMoney(quote.total, quote.currency)} TTC</span>
                  </span>
                </span>
                <span className="sui-lines__end">
                  <Button variant="dark" href={`/espace-client/devis/${quote.id}`} icon={ArrowUpRight}>
                    Répondre
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* ====================================================================
          3. MES PROJETS & MES COMMANDES
         ==================================================================== */}
      <div className="sui-split">
        <Panel
          title="Mes projets"
          subtitle="Projets actifs, jalons et livrables partagés par l’équipe."
          action={
            <Link href="/espace-client/modifications" className={`${secondaryButton} sui-btn--sm`}>
              <Wrench size={15} strokeWidth={1.9} aria-hidden="true" /> Demander une modification
            </Link>
          }
        >
          {projects.error ? <Notice>{projects.error}</Notice> : null}
          {projects.items === null && !projects.error ? <SkeletonList rows={2} /> : null}
          {projects.items !== null && projectList.length === 0 ? (
            <Empty
              icon={FolderKanban}
              action={
                <Link href="/espace-client/commander" className={primaryButton}>
                  <Plus size={15} strokeWidth={1.9} aria-hidden="true" /> Commander un pack
                </Link>
              }
            >
              Vous n’avez pas encore de projet actif. Votre projet apparaîtra ici dès validation de votre commande ou de votre devis.
            </Empty>
          ) : null}

          {projectList.length ? (
            <ul className="flex flex-col gap-3">
              {projectList.map((project) => (
                <li key={project.id} className="sui-row">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="sui-field__label">{project.reference}</p>
                      <Link href={`/espace-client/projets/${project.id}`} className="sui-row__title">
                        {project.name}
                      </Link>
                    </div>
                    <Badge tone="info">{PROJECT_STATUS[project.status] ?? project.status}</Badge>
                  </div>
                  <ProgressBar value={project.progressPercent} ratio={`${project.progressPercent ?? 0} %`} />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="sui-chat__preview">Échéance prévue : {formatDate(project.dueDate)}</span>
                    <Link href={`/espace-client/projets/${project.id}`} className="sui-link">
                      Ouvrir le suivi <ArrowUpRight size={14} strokeWidth={1.9} aria-hidden="true" />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <Pagination meta={projects.meta} onPageChange={setProjectPage} loading={projects.loading} />
        </Panel>

        <Panel
          title="Mes commandes"
          subtitle="État d’avancement et validation de vos packs."
          action={
            <Link href="/espace-client/commander" className={`${primaryButton} sui-btn--sm`}>
              <ShoppingCart size={15} strokeWidth={1.9} aria-hidden="true" /> Commander un pack
            </Link>
          }
        >
          {orders.error ? <Notice>{orders.error}</Notice> : null}
          {orders.items === null && !orders.error ? <SkeletonList rows={2} /> : null}
          {orders.items !== null && orderList.length === 0 ? (
            <Empty icon={ShoppingCart}>Aucune commande enregistrée pour le moment.</Empty>
          ) : null}

          {orderList.length ? (
            <ul className="flex flex-col gap-4">
              {orderList.map((order) => (
                <li key={order.id} className="sui-row">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="sui-field__label">
                        {order.reference} · {formatDate(order.orderedAt)}
                      </p>
                      <h4 className="sui-row__title">{order.packageName}</h4>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone="info">{ORDER_STATUS[order.status] ?? order.status}</Badge>
                      <Badge tone={order.paymentStatus === "PAID" ? "success" : "neutral"}>
                        {PAYMENT_STATUS[order.paymentStatus] ?? order.paymentStatus}
                      </Badge>
                    </div>
                  </div>
                  <p className="sui-body">
                    Montant : <strong>{formatMoney(order.amount, order.currency)}</strong>
                  </p>
                  <OrderSteps status={order.status} />
                  {order.project ? (
                    <p className="sui-body">
                      Projet associé :{" "}
                      <Link href={`/espace-client/projets/${order.project.id}`} className="sui-link">
                        {order.project.reference} ({PROJECT_STATUS[order.project.status] ?? order.project.status})
                      </Link>
                    </p>
                  ) : (
                    <p className="sui-card__desc">
                      Votre projet sera ouvert dès validation de la commande par notre équipe.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <Pagination meta={orders.meta} onPageChange={setOrderPage} loading={orders.loading} />
        </Panel>
      </div>

      {/* ====================================================================
          4. DEMANDES SUR MESURE & HISTORIQUE DES DEVIS
         ==================================================================== */}
      <div className="sui-split">
        <Panel title="Mes demandes de projet" subtitle="Demandes personnalisées étudiées par notre équipe.">
          {requests.error ? <Notice>{requests.error}</Notice> : null}
          {requests.items === null && !requests.error ? <SkeletonList rows={2} /> : null}
          {requests.items !== null && requestList.length === 0 ? (
            <Empty icon={Layers}>Aucune demande de projet en cours.</Empty>
          ) : null}

          {requestList.length ? (
            <ul className="sui-lines sui-lines--rows">
              {requestList.map((item) => (
                <li key={item.id}>
                  <span className="sui-lines__icon" style={{ "--tone-bg": toneBackground("lilac") }} aria-hidden="true">
                    <Layers size={16} strokeWidth={1.75} />
                  </span>
                  <span className="sui-lines__copy">
                    <strong>{item.packageName ?? "Projet sur mesure"}</strong>
                    <span>
                      {item.reference} · {formatDate(item.createdAt)}
                      {item.reason && REQUEST_REASON_HINT[item.reason] ? ` · ${REQUEST_REASON_HINT[item.reason]}` : ""}
                    </span>
                  </span>
                  <span className="sui-lines__end">
                    <Badge>{PROJECT_REQUEST_STATUS[item.status] ?? item.status}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        {quotesVisible ? (
          <Panel title="Tous mes devis" subtitle="Historique complet de vos propositions commerciales.">
            {quotes.error ? <Notice>{quotes.error}</Notice> : null}
            {quotes.items === null && !quotes.error ? <SkeletonList rows={2} /> : null}
            {quotes.items !== null && quoteList.length === 0 ? (
              <Empty icon={FileText}>Aucun devis pour le moment.</Empty>
            ) : null}

            {quoteList.length ? (
              <ul className="sui-lines sui-lines--rows">
                {quoteList.map((quote) => (
                  <li key={quote.id}>
                    <span className="sui-lines__icon" style={{ "--tone-bg": toneBackground("blue") }} aria-hidden="true">
                      <FileText size={16} strokeWidth={1.75} />
                    </span>
                    <span className="sui-lines__copy">
                      <strong>
                        <Link href={`/espace-client/devis/${quote.id}`} className="sui-link">
                          {quote.subject}
                        </Link>
                      </strong>
                      <span>
                        {quote.reference} · émis le {formatDate(quote.issueDate)} ·{" "}
                        <span className="sui-tabular">{formatMoney(quote.total, quote.currency)}</span>
                      </span>
                    </span>
                    <span className="sui-lines__end">
                      <Badge tone={QUOTE_STATUS_TONE[quote.status] ?? "neutral"}>
                        {QUOTE_STATUS[quote.status] ?? quote.status}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <Pagination meta={quotes.meta} onPageChange={setQuotePage} loading={quotes.loading} />
          </Panel>
        ) : null}
      </div>

      {/* Rappel du canal le plus direct pour un client. */}
      <Panel className="sui-panel--toolbar">
        <p className="sui-body">Une question sur un devis, une commande ou un projet en cours ?</p>
        <Link href="/espace-client/messagerie" className="sui-btn sui-btn--dark">
          <MessageSquare size={16} strokeWidth={1.9} aria-hidden="true" /> Écrire à l’équipe
        </Link>
      </Panel>
    </div>
  );
}
