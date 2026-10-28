"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Bell,
  CheckCircle2,
  CircleAlert,
  FileText,
  FolderKanban,
  Mail,
  ReceiptText,
} from "lucide-react";
import { formatDateOnly, formatMoney } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { Empty, Notice, ProgressBar, SkeletonList } from "@/components/workspace/ui";
import { StatusPill } from "@/components/softui";

const CATEGORY_ICON = {
  quote: FileText,
  invoice: ReceiptText,
  message: Mail,
  notification: Bell,
};

function ActionCard({ action }) {
  const Icon = CATEGORY_ICON[action.category] ?? CircleAlert;
  return (
    <article className="client-action" data-testid="client-action" data-category={action.category}>
      <span className="client-action__icon" aria-hidden="true"><Icon size={18} strokeWidth={1.9} /></span>
      <div className="client-action__copy">
        <p className="client-action__kind">{action.kind}</p>
        <h3>{action.title}</h3>
        <p className="client-action__detail">
          {action.detail}
          {action.amount !== null && action.amount !== undefined ? ` · ${formatMoney(action.amount, action.currency)}` : ""}
        </p>
      </div>
      <Link className="client-action__button" href={action.href} data-testid={`client-action-${action.category}`}>
        {action.actionLabel} <ArrowUpRight size={15} aria-hidden="true" />
      </Link>
    </article>
  );
}

function ProjectCard({ project }) {
  return (
    <article className="client-project" data-testid="client-focus-project">
      <div className="client-project__head">
        <div className="min-w-0">
          <h3>
            <Link href={project.href} className="sui-link">{project.name}</Link>
          </h3>
          <p>{project.statusLabel}{project.reference ? ` · ${project.reference}` : ""}</p>
        </div>
        <StatusPill label={`${project.progressPercent} %`} tone="blue" />
      </div>
      <ProgressBar value={project.progressPercent} />
      <p className="client-project__explanation">{project.statusExplanation}</p>
      {project.nextStep ? (
        <p className="client-project__next">
          <strong>{project.nextStep.isCurrent ? "Étape en cours" : "Prochaine étape connue"} :</strong>{" "}
          {project.nextStep.title}
          {project.nextStep.dueDate ? ` · échéance ${formatDateOnly(project.nextStep.dueDate)}` : " · sans date communiquée"}
        </p>
      ) : (
        <p className="client-project__next">Aucune étape datée n’a encore été publiée. L’équipe mettra cette section à jour.</p>
      )}
      <Link className="client-focus__link" href={project.href}>Suivre ce projet <ArrowUpRight size={15} aria-hidden="true" /></Link>
    </article>
  );
}

function InvoiceSummary({ invoices, unknown }) {
  if (unknown) {
    return <p className="client-focus__muted">Le solde de vos factures n’est pas disponible pour le moment.</p>;
  }
  if (!invoices.payable.length) {
    return (
      <p className="client-focus__ok" data-testid="client-no-invoice-balance">
        <CheckCircle2 size={17} aria-hidden="true" /> Aucune facture en attente de règlement.
      </p>
    );
  }
  return (
    <div className="client-invoice-summary">
      <p className="client-focus__muted">Solde restant sur {invoices.payable.length} facture{invoices.payable.length > 1 ? "s" : ""} :</p>
      <ul className="client-money-list">
        {invoices.totalsByCurrency.map((amount) => (
          <li key={amount.currency} className="sui-tabular">{formatMoney(amount.total, amount.currency)}</li>
        ))}
      </ul>
      <p className="client-focus__muted">Les consignes de règlement sont à demander à l’équipe si elles ne figurent pas sur la facture.</p>
      <Link className="client-focus__link" href={invoices.href}>Voir mes factures <ArrowUpRight size={15} aria-hidden="true" /></Link>
    </div>
  );
}

function ExchangesSummary({ exchanges, unknown }) {
  if (unknown) {
    return <p className="client-focus__muted">Vos échanges ne sont pas disponibles pour le moment.</p>;
  }
  return (
    <div className="client-exchanges">
      <p>
        {exchanges.unreadMessages > 0
          ? `${exchanges.unreadMessages} message${exchanges.unreadMessages > 1 ? "s" : ""} non lu${exchanges.unreadMessages > 1 ? "s" : ""}`
          : "Aucun message non lu"}
        {exchanges.unreadNotifications > 0
          ? ` · ${exchanges.unreadNotifications} notification${exchanges.unreadNotifications > 1 ? "s" : ""} non lue${exchanges.unreadNotifications > 1 ? "s" : ""}`
          : ""}
      </p>
      {exchanges.decidedModificationCount > 0 ? (
        <p className="client-focus__muted">
          {exchanges.decidedModificationCount} réponse{exchanges.decidedModificationCount > 1 ? "s" : ""} à vos demandes de modification.
        </p>
      ) : null}
      <div className="client-exchanges__links">
        <Link className="client-focus__link" href={exchanges.messagingHref}>Messagerie</Link>
        <Link className="client-focus__link" href={exchanges.modificationsHref}>Mes demandes</Link>
        {exchanges.unreadNotifications > 0 ? (
          <Link className="client-focus__link" href={exchanges.notificationsHref}>Notifications</Link>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Accueil client : les actions d'abord, puis le contexte. Aucune categorie vide
 * n'est transformee en grosse carte : on garde une page calme quand tout est a
 * jour.
 */
export default function ClientFocusBoard({ model, loading = false, errors = [], compact = false }) {
  const { user } = useAuth();
  const firstName = user?.firstName?.trim() || "";
  const actions = compact ? model.actions.slice(0, 4) : model.actions;
  const projects = compact ? model.projects.slice(0, 2) : model.projects.slice(0, 3);

  return (
    <section className="client-focus" data-testid="client-focus-board" aria-label="Synthèse de votre espace client">
      <header className="client-focus__head">
        <div>
          <p className="client-focus__eyebrow">Votre espace</p>
          <h1>{firstName ? `Bonjour ${firstName}` : "Bienvenue dans votre espace"}</h1>
          <p className="client-focus__intro">
            {loading
              ? "Nous rassemblons les informations de votre dossier…"
              : actions.length > 0
                ? `${actions.length} point${actions.length > 1 ? "s" : ""} à regarder de votre côté. Vos projets et documents restent accessibles ci-dessous.`
                : "Aucune action urgente de votre côté. Vos projets, devis et factures restent accessibles ci-dessous."}
          </p>
        </div>
        {!compact ? (
          <Link className="client-focus__link client-focus__overview" href="/espace-client/tableau-de-bord">
            Tableau de bord <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        ) : (
          <Link className="client-focus__link client-focus__overview" href="/espace-client">
            Vue d’ensemble complète <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        )}
      </header>

      {errors.length > 0 ? (
        <Notice>
          Certaines informations ne sont pas disponibles pour le moment ({errors.join(", ")}). Les autres sections restent affichées.
        </Notice>
      ) : null}
      {model.unknown.length > 0 && !loading ? (
        <p className="client-focus__muted" data-testid="client-focus-unknown">
          Des données sont encore en cours de chargement : {model.unknown.join(", ")}.
        </p>
      ) : null}

      {loading ? <SkeletonList rows={3} /> : null}

      {!loading ? (
        <>
          <section aria-labelledby="client-focus-actions-title" className="client-focus__section">
            <div className="client-focus__section-head">
              <h2 id="client-focus-actions-title">À faire de votre côté</h2>
              {actions.length > 0 ? <StatusPill label={`${actions.length} action${actions.length > 1 ? "s" : ""}`} tone="yellow" /> : null}
            </div>
            {actions.length > 0 ? (
              <div className="client-action-list" data-testid="client-focus-actions">
                {actions.map((action) => <ActionCard key={action.id} action={action} />)}
              </div>
            ) : (
              <Empty icon={CheckCircle2}>Rien ne demande votre intervention pour le moment.</Empty>
            )}
          </section>

          <div className="client-focus__grid">
            <section aria-labelledby="client-focus-projects-title" className="client-focus__section">
              <div className="client-focus__section-head">
                <h2 id="client-focus-projects-title"><FolderKanban size={18} aria-hidden="true" /> Vos projets</h2>
              </div>
              {projects.length > 0 ? (
                <div className="client-project-list" data-testid="client-focus-projects">
                  {projects.map((project) => <ProjectCard key={project.id} project={project} />)}
                </div>
              ) : (
                <Empty icon={FolderKanban}>Aucun projet actif pour le moment.</Empty>
              )}
            </section>

            <div className="client-focus__aside">
              <section aria-labelledby="client-focus-invoices-title" className="client-focus__section">
                <div className="client-focus__section-head">
                  <h2 id="client-focus-invoices-title"><ReceiptText size={18} aria-hidden="true" /> Vos factures</h2>
                </div>
                <InvoiceSummary invoices={model.invoices} unknown={model.unknown.includes("invoices")} />
              </section>
              <section aria-labelledby="client-focus-exchanges-title" className="client-focus__section">
                <div className="client-focus__section-head">
                  <h2 id="client-focus-exchanges-title"><Mail size={18} aria-hidden="true" /> Vos échanges</h2>
                </div>
                <ExchangesSummary exchanges={model.exchanges} unknown={model.unknown.includes("conversations")} />
              </section>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
