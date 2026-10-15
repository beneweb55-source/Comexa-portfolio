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
  Card,
  Empty,
  Notice,
  OrderSteps,
  Pagination,
  ProgressBar,
  SkeletonList,
  primaryButton,
  secondaryButton,
} from "@/components/workspace/ui";

const REQUEST_REASON_HINT = {
  COUNTRY_UNKNOWN: "Tarif établi sur mesure par notre équipe",
  NO_CURRENT_RATE: "Tarif établi sur mesure par notre équipe",
  NO_COMPATIBLE_PAYMENT_METHOD: "Modalités de règlement préparées par notre équipe",
};

/**
 * Vue d'ensemble de l'espace client :
 *  1. Bandeau Bento de 4 KPIs synthétiques (Projets, Devis en attente, Commandes, Demandes).
 *  2. Devis à examiner en priorité (quand un devis attend une réponse).
 *  3. Grille structurée : Projets avec barre de progression, Commandes avec étapes (`OrderSteps`),
 *     Demandes de projet et historique des devis.
 */
export default function EspaceClientPage() {
  const [quotePage, setQuotePage] = useState(1);
  const [orderPage, setOrderPage] = useState(1);
  const [requestPage, setRequestPage] = useState(1);
  const [projectPage, setProjectPage] = useState(1);

  const quotes = useListing(`/quotes?page=${quotePage}&perPage=50`);
  const orders = useListing(`/orders?page=${orderPage}&perPage=50`);
  const requests = useListing(`/project-requests?page=${requestPage}&perPage=50`);
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

  return (
    <div className="flex flex-col gap-6">
      {/* ====================================================================
          1. BANDEAU KPI CLIENT (Bento 4 colonnes)
         ==================================================================== */}
      <section
        aria-label="Synthèse de votre espace client"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <div className="cx-card flex flex-col justify-between gap-3 !p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e8f3fe] text-[#1568b4]">
              <FolderKanban size={20} strokeWidth={1.85} aria-hidden="true" />
            </span>
            <Badge tone="info">
              {projects.items === null ? "…" : `Avancement ${avgProgress} %`}
            </Badge>
          </div>
          <div>
            <p className="text-[12.5px] font-semibold text-[#4a607a]">Projets actifs</p>
            <p className="cx-tabular mt-0.5 text-[26px] font-bold tracking-tight text-[#0b2545]">
              {projects.items === null ? "…" : projectList.length}
            </p>
          </div>
          <ProgressBar value={avgProgress} />
        </div>

        <div className="cx-card flex flex-col justify-between gap-3 !p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fef4e2] text-[#9a5406]">
              <FileText size={20} strokeWidth={1.85} aria-hidden="true" />
            </span>
            <Badge tone={openQuotes.length > 0 ? "warning" : "neutral"}>
              {openQuotes.length > 0 ? `${openQuotes.length} à valider` : "À jour"}
            </Badge>
          </div>
          <div>
            <p className="text-[12.5px] font-semibold text-[#4a607a]">Mes devis</p>
            <p className="cx-tabular mt-0.5 text-[26px] font-bold tracking-tight text-[#0b2545]">
              {quotes.items === null ? "…" : quoteList.length}
            </p>
          </div>
          <p className="text-[12px] text-[#4a607a]">
            {openQuotes.length > 0
              ? "Un devis attend votre décision ci-dessous."
              : "Consultez vos propositions commerciales."}
          </p>
        </div>

        <div className="cx-card flex flex-col justify-between gap-3 !p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e6f7ef] text-[#0d7a52]">
              <ShoppingCart size={20} strokeWidth={1.85} aria-hidden="true" />
            </span>
            <Link
              href="/espace-client/commander"
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#1568b4] hover:underline"
            >
              Commander <ArrowUpRight size={13} />
            </Link>
          </div>
          <div>
            <p className="text-[12.5px] font-semibold text-[#4a607a]">Commandes de packs</p>
            <p className="cx-tabular mt-0.5 text-[26px] font-bold tracking-tight text-[#0b2545]">
              {orders.items === null ? "…" : orderList.length}
            </p>
          </div>
          <p className="text-[12px] text-[#4a607a]">
            Suivez la validation et l’ouverture de vos projets.
          </p>
        </div>

        <div className="cx-card flex flex-col justify-between gap-3 !p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f0edfe] text-[#5b3cc4]">
              <Layers size={20} strokeWidth={1.85} aria-hidden="true" />
            </span>
            <Link
              href="/espace-client/modifications"
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#1568b4] hover:underline"
            >
              Modifications <ArrowUpRight size={13} />
            </Link>
          </div>
          <div>
            <p className="text-[12.5px] font-semibold text-[#4a607a]">Demandes sur mesure</p>
            <p className="cx-tabular mt-0.5 text-[26px] font-bold tracking-tight text-[#0b2545]">
              {requests.items === null ? "…" : requestList.length}
            </p>
          </div>
          <div className="flex items-center gap-2 text-[12px]">
            <Link
              href="/espace-client/messagerie"
              className="inline-flex items-center gap-1 font-semibold text-[#1568b4] hover:underline"
            >
              <MessageSquare size={13} /> Écrire à l’équipe
            </Link>
          </div>
        </div>
      </section>

      {/* ====================================================================
          2. DEVIS EN ATTENTE DE RÉPONSE (Priorité haute)
         ==================================================================== */}
      {quotesVisible && openQuotes.length > 0 ? (
        <Card
          title="Devis en attente de votre décision"
          subtitle="Consultez le détail des prestations pour accepter ou refuser la proposition."
          className="border-[#1e86e0]/30 bg-gradient-to-br from-white via-white to-[#e8f3fe]/60"
        >
          <ul className="flex flex-col gap-3">
            {openQuotes.map((quote) => (
              <li
                key={quote.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--comexa-border-soft)] bg-white/95 p-4 shadow-xs"
              >
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--comexa-ink-muted)]">
                    {quote.reference} · valable jusqu’au {formatDate(quote.validUntil)}
                  </p>
                  <h4 className="mt-0.5 text-[16px] font-bold text-[var(--comexa-ink)]">
                    {quote.subject}
                  </h4>
                  <p className="cx-tabular mt-1 text-[15px] font-semibold text-[#1568b4]">
                    {formatMoney(quote.total, quote.currency)} TTC
                  </p>
                </div>
                <Link href={`/espace-client/devis/${quote.id}`} className={primaryButton}>
                  Consulter et répondre
                  <ArrowUpRight size={15} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ====================================================================
          3. MES PROJETS & MES COMMANDES
         ==================================================================== */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card
          title="Mes projets"
          subtitle="Projets actifs, jalons et livrables partagés par l’équipe."
          action={
            <Link href="/espace-client/modifications" className={`${secondaryButton} cx-btn--sm`}>
              <Wrench size={14} /> Demander une modification
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
                  <Plus size={15} /> Commander un pack
                </Link>
              }
            >
              Vous n’avez pas encore de projet actif. Votre projet apparaîtra ici dès validation de votre commande ou de votre devis.
            </Empty>
          ) : null}
          <ul className="flex flex-col gap-3">
            {projectList.map((project) => (
              <li
                key={project.id}
                className="flex flex-col gap-3 rounded-2xl border border-[var(--comexa-border-soft)] bg-white/85 p-4 transition hover:border-[var(--comexa-accent)]/35 hover:shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--comexa-ink-muted)]">
                      {project.reference}
                    </p>
                    <Link
                      href={`/espace-client/projets/${project.id}`}
                      className="text-[16px] font-bold text-[var(--comexa-ink)] hover:text-[var(--comexa-accent-strong)] hover:underline"
                    >
                      {project.name}
                    </Link>
                  </div>
                  <Badge tone="info">{PROJECT_STATUS[project.status] ?? project.status}</Badge>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[12px] font-semibold text-[var(--comexa-ink-muted)]">
                    <span>Progression</span>
                    <span className="cx-tabular text-[var(--comexa-ink)]">
                      {project.progressPercent ?? 0} %
                    </span>
                  </div>
                  <ProgressBar value={project.progressPercent} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[var(--comexa-ink-soft)]">
                  <span>Échéance prévue : {formatDate(project.dueDate)}</span>
                  <Link
                    href={`/espace-client/projets/${project.id}`}
                    className="inline-flex items-center gap-1 font-semibold text-[#1568b4] hover:underline"
                  >
                    Ouvrir le suivi <ArrowUpRight size={14} />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <Pagination meta={projects.meta} onPageChange={setProjectPage} loading={projects.loading} />
        </Card>

        <Card
          title="Mes commandes"
          subtitle="État d’avancement et validation de vos packs."
          action={
            <Link href="/espace-client/commander" className={`${primaryButton} cx-btn--sm`}>
              <ShoppingCart size={14} /> Commander un pack
            </Link>
          }
        >
          {orders.error ? <Notice>{orders.error}</Notice> : null}
          {orders.items === null && !orders.error ? <SkeletonList rows={2} /> : null}
          {orders.items !== null && orderList.length === 0 ? (
            <Empty icon={ShoppingCart}>Aucune commande enregistrée pour le moment.</Empty>
          ) : null}
          <ul className="flex flex-col gap-4">
            {orderList.map((order) => (
              <li
                key={order.id}
                className="flex flex-col gap-3 rounded-2xl border border-[var(--comexa-border-soft)] bg-white/85 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--comexa-ink-muted)]">
                      {order.reference} · {formatDate(order.orderedAt)}
                    </p>
                    <h4 className="mt-0.5 text-[16px] font-bold text-[var(--comexa-ink)]">
                      {order.packageName}
                    </h4>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="info">{ORDER_STATUS[order.status] ?? order.status}</Badge>
                    <Badge tone={order.paymentStatus === "PAID" ? "success" : "neutral"}>
                      {PAYMENT_STATUS[order.paymentStatus] ?? order.paymentStatus}
                    </Badge>
                  </div>
                </div>
                <p className="cx-tabular text-[14px] font-semibold text-[var(--comexa-ink-soft)]">
                  Montant : <strong className="text-[var(--comexa-ink)]">{formatMoney(order.amount, order.currency)}</strong>
                </p>
                <OrderSteps status={order.status} />
                {order.project ? (
                  <p className="text-[13.5px]">
                    Projet associé :{" "}
                    <Link
                      href={`/espace-client/projets/${order.project.id}`}
                      className="font-semibold text-[var(--comexa-accent-strong)] underline"
                    >
                      {order.project.reference} ({PROJECT_STATUS[order.project.status] ?? order.project.status})
                    </Link>
                  </p>
                ) : (
                  <p className="cx-small">
                    Votre projet sera ouvert dès validation de la commande par notre équipe.
                  </p>
                )}
              </li>
            ))}
          </ul>
          <Pagination meta={orders.meta} onPageChange={setOrderPage} loading={orders.loading} />
        </Card>
      </div>

      {/* ====================================================================
          4. DEMANDES SUR MESURE & HISTORIQUE DES DEVIS
         ==================================================================== */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Mes demandes de projet" subtitle="Demandes personnalisées étudiées par notre équipe.">
          {requests.error ? <Notice>{requests.error}</Notice> : null}
          {requests.items === null && !requests.error ? <SkeletonList rows={2} /> : null}
          {requests.items !== null && requestList.length === 0 ? (
            <Empty icon={Layers}>Aucune demande de projet en cours.</Empty>
          ) : null}
          <ul className="flex flex-col gap-3">
            {requestList.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[var(--comexa-border-soft)] bg-white/85 p-4"
              >
                <div>
                  <p className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--comexa-ink-muted)]">
                    {item.reference} · {formatDate(item.createdAt)}
                  </p>
                  <h4 className="mt-0.5 text-[15.5px] font-bold text-[var(--comexa-ink)]">
                    {item.packageName ?? "Projet sur mesure"}
                  </h4>
                  {item.reason && REQUEST_REASON_HINT[item.reason] ? (
                    <p className="cx-small mt-1">{REQUEST_REASON_HINT[item.reason]}</p>
                  ) : null}
                </div>
                <Badge>{PROJECT_REQUEST_STATUS[item.status] ?? item.status}</Badge>
              </li>
            ))}
          </ul>
          <Pagination meta={requests.meta} onPageChange={setRequestPage} loading={requests.loading} />
        </Card>

        {quotesVisible ? (
          <Card title="Tous mes devis" subtitle="Historique complet de vos propositions commerciales.">
            {quotes.error ? <Notice>{quotes.error}</Notice> : null}
            {quotes.items === null && !quotes.error ? <SkeletonList rows={2} /> : null}
            {quotes.items !== null && quoteList.length === 0 ? (
              <Empty icon={FileText}>Aucun devis pour le moment.</Empty>
            ) : null}
            <ul className="flex flex-col gap-3">
              {quoteList.map((quote) => (
                <li
                  key={quote.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--comexa-border-soft)] bg-white/85 p-4"
                >
                  <div>
                    <p className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--comexa-ink-muted)]">
                      {quote.reference} · émis le {formatDate(quote.issueDate)}
                    </p>
                    <Link
                      href={`/espace-client/devis/${quote.id}`}
                      className="text-[15.5px] font-bold text-[var(--comexa-ink)] hover:text-[#1568b4] hover:underline"
                    >
                      {quote.subject}
                    </Link>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="cx-tabular text-[14.5px] font-bold text-[var(--comexa-ink)]">
                      {formatMoney(quote.total, quote.currency)}
                    </span>
                    <Badge tone={QUOTE_STATUS_TONE[quote.status] ?? "neutral"}>
                      {QUOTE_STATUS[quote.status] ?? quote.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination meta={quotes.meta} onPageChange={setQuotePage} loading={quotes.loading} />
          </Card>
        ) : null}
      </div>
    </div>
  );
}
