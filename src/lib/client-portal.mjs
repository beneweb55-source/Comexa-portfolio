/**
 * Espace client — projection d'affichage, sans application ni donnees internes.
 *
 * Ce module ne decide d'aucun droit et ne remplace aucune regle backend. Il
 * prend des donnees DEJA filtrees par l'API pour le dossier client connecte et
 * en tire :
 *   - les actions reellement possibles depuis les routes client existantes ;
 *   - un recit de projet base sur les jalons visibles par le client ;
 *   - des conseils de lecture pour les demandes de modification.
 *
 * Deux regles absolues :
 *   - une information absente n'est jamais transformee en zero ;
 *   - aucune note interne, tache, temps saisi, budget ou marge n'est lue ici.
 */

import { quoteFollowup } from "./quote-attention.mjs";

export const CLIENT_DECIDABLE_QUOTE_STATUSES = Object.freeze(["SENT", "VIEWED"]);
export const CLIENT_CLOSED_INVOICE_STATUSES = Object.freeze(["PAID", "CANCELLED", "REFUNDED", "DRAFT"]);
export const CLIENT_CLOSED_PROJECT_STATUSES = Object.freeze(["COMPLETED", "CANCELLED", "ARCHIVED"]);
export const CLIENT_FINISHED_MILESTONE_STATUSES = Object.freeze(["REACHED", "CANCELLED"]);

/** Meme arithmetique que `remainingDue` : total - deja regle, jamais negatif. */
export function invoiceRemaining(invoice) {
  const total = Number(invoice?.total ?? 0);
  const paid = Number(invoice?.amountPaid ?? 0);
  if (!Number.isFinite(total) || !Number.isFinite(paid)) return 0;
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

export function isClientQuoteDecisionable(quote) {
  return Boolean(quote?.id && CLIENT_DECIDABLE_QUOTE_STATUSES.includes(quote.status));
}

export function isClientInvoicePayable(invoice) {
  return Boolean(
    invoice?.id &&
      !CLIENT_CLOSED_INVOICE_STATUSES.includes(invoice.status) &&
      invoiceRemaining(invoice) > 0,
  );
}

const PROJECT_EXPLANATIONS = Object.freeze({
  DRAFT: "Le projet est en préparation. Les étapes publiées apparaîtront ici.",
  PLANNED: "Le projet est planifié. L’équipe prépare les premières étapes.",
  IN_PROGRESS: "L’équipe travaille sur votre projet. La barre montre l’avancement déclaré.",
  ON_HOLD: "Le projet est en pause. Aucune date de reprise n’est indiquée ici.",
  IN_REVIEW: "Le travail réalisé est en cours de vérification.",
  COMPLETED: "Le projet est terminé. Vous pouvez consulter les étapes réalisées et les documents partagés.",
  CANCELLED: "Le projet a été annulé. Les documents déjà partagés restent disponibles.",
  ARCHIVED: "Le projet est archivé. Les documents déjà partagés restent disponibles.",
});

const MILESTONE_LABELS = Object.freeze({
  PENDING: "À venir",
  IN_PROGRESS: "En cours",
  REACHED: "Terminée",
  MISSED: "Échéance dépassée",
  CANCELLED: "Annulée",
});

const PROJECT_LABELS = Object.freeze({
  DRAFT: "Brouillon",
  PLANNED: "Planifié",
  IN_PROGRESS: "En cours",
  ON_HOLD: "En pause",
  IN_REVIEW: "En revue",
  COMPLETED: "Terminé",
  CANCELLED: "Annulé",
  ARCHIVED: "Archivé",
});

export function projectStatusLabel(status) {
  return PROJECT_LABELS[status] ?? status ?? "Statut inconnu";
}

export function milestoneStatusLabel(status) {
  return MILESTONE_LABELS[status] ?? status ?? "Statut inconnu";
}

function milestoneDate(milestone) {
  return milestone?.dueDate ?? null;
}

function byMilestoneDate(left, right) {
  const leftDate = milestoneDate(left) ? Date.parse(milestoneDate(left)) : Number.MAX_SAFE_INTEGER;
  const rightDate = milestoneDate(right) ? Date.parse(milestoneDate(right)) : Number.MAX_SAFE_INTEGER;
  return leftDate - rightDate || Number(left?.order ?? 0) - Number(right?.order ?? 0);
}

/**
 * Recit client d'un projet, uniquement a partir de la fiche projet et de ses
 * jalons. Aucune activite interne, aucune tache, aucun temps, aucun budget.
 */
export function buildProjectStory(project, milestones, now = Date.now()) {
  const list = Array.isArray(milestones) ? milestones : [];
  const finished = list.filter((milestone) => milestone?.status === "REACHED");
  const current = list.find((milestone) => milestone?.status === "IN_PROGRESS") ?? null;
  const open = list
    .filter((milestone) => milestone && !CLIENT_FINISHED_MILESTONE_STATUSES.includes(milestone.status) && milestone.id !== current?.id)
    .sort(byMilestoneDate);
  const upcoming = open[0] ?? null;
  const next = current ?? upcoming;
  const status = project?.status ?? null;

  return {
    status,
    statusLabel: projectStatusLabel(status),
    statusExplanation: PROJECT_EXPLANATIONS[status] ?? "Le statut de ce projet n’est pas détaillé pour le moment.",
    progressPercent: Math.max(0, Math.min(100, Number(project?.progressPercent) || 0)),
    dueDate: project?.dueDate ?? null,
    completedCount: finished.length,
    totalCount: list.length,
    currentMilestone: current,
    nextMilestone: next,
    nextStep: next
      ? {
          id: next.id,
          title: next.title,
          dueDate: milestoneDate(next),
          status: next.status,
          label: milestoneStatusLabel(next.status),
          isCurrent: Boolean(current && next.id === current.id),
        }
      : null,
    timeline: list.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      description: milestone.description ?? null,
      dueDate: milestoneDate(milestone),
      reachedAt: milestone.reachedAt ?? null,
      status: milestone.status,
      statusLabel: milestoneStatusLabel(milestone.status),
      done: milestone.status === "REACHED",
      cancelled: milestone.status === "CANCELLED",
      late: milestone.status === "MISSED",
    })),
  };
}

/**
 * Conseils de lecture pour une demande de modification.
 *
 * Le modele actuel ne porte PAS de decision formelle du client sur un
 * `extraCost` propose par l'agence : on ne doit donc jamais afficher un bouton
 * « Accepter le supplement » qui n'aurait aucun endpoint derriere. On explique
 * la reponse et on renvoie vers la messagerie pour la suite.
 */
export function clientModificationAdvice(request, now = Date.now()) {
  const status = request?.status ?? null;
  const extraCost = Number(request?.extraCost ?? 0);
  const hasExtraCost = Number.isFinite(extraCost) && extraCost > 0;
  const base = {
    status,
    decidedAt: request?.decidedAt ?? null,
    decisionNote: request?.decisionNote ?? null,
    extraCost: hasExtraCost ? extraCost : 0,
    extraCostCurrency: request?.extraCostCurrency ?? "DZD",
    needsContact: false,
    tone: "neutral",
  };
  if (status === "SUBMITTED") {
    return { ...base, title: "Demande reçue", body: "Votre demande est enregistrée. L’équipe va l’étudier.", tone: "info" };
  }
  if (status === "IN_PROGRESS") {
    return { ...base, title: "En cours d’étude", body: "L’équipe étudie votre demande. Vous pouvez préciser votre besoin par message.", tone: "warning", needsContact: true };
  }
  if (status === "APPROVED") {
    return {
      ...base,
      title: hasExtraCost ? "Réponse avec supplément proposé" : "Demande acceptée",
      body: hasExtraCost
        ? "L’équipe a accepté la demande et propose un supplément. La validation en ligne de ce supplément n’est pas encore disponible : écrivez à l’équipe pour donner votre accord ou demander une précision."
        : "L’équipe a accepté votre demande. Vous pouvez suivre sa réalisation ici.",
      tone: hasExtraCost ? "warning" : "success",
      needsContact: hasExtraCost,
    };
  }
  if (status === "REJECTED") {
    return { ...base, title: "Demande refusée", body: "L’équipe a refusé cette demande. Le motif est affiché ci-dessous lorsqu’il a été renseigné.", tone: "danger" };
  }
  if (status === "DONE") {
    return { ...base, title: "Modification réalisée", body: "La modification demandée a été réalisée.", tone: "success" };
  }
  return { ...base, title: "Statut à confirmer", body: "Le statut de cette demande n’est pas encore détaillé. Contactez l’équipe si vous avez une question.", tone: "neutral", needsContact: true };
}

function sumByCurrency(invoices) {
  const totals = new Map();
  for (const invoice of invoices) {
    const currency = invoice?.currency ?? "DZD";
    totals.set(currency, (totals.get(currency) ?? 0) + invoiceRemaining(invoice));
  }
  return [...totals.entries()]
    .map(([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 }))
    .sort((left, right) => left.currency.localeCompare(right.currency, "fr"));
}

function quoteAction(quote, now) {
  const followup = quoteFollowup(quote, now);
  return {
    id: `quote-${quote.id}`,
    category: "quote",
    priority: followup ? 0 : 1,
    kind: followup ? "Devis à décider rapidement" : "Devis à valider",
    title: quote.subject || `Devis ${quote.reference}`,
    detail: `${quote.reference}${followup ? ` · ${followup.label}` : ""}`.trim(),
    amount: quote.total ?? null,
    currency: quote.currency ?? "DZD",
    href: `/espace-client/devis/${quote.id}`,
    actionLabel: "Répondre au devis",
    tone: followup ? "pink" : "yellow",
  };
}

function invoiceAction(invoice, now) {
  const remaining = invoiceRemaining(invoice);
  const due = invoice?.dueDate ? Date.parse(invoice.dueDate) : null;
  const overdue = Number.isFinite(due) && due < now;
  return {
    id: `invoice-${invoice.id}`,
    category: "invoice",
    priority: overdue ? 2 : 3,
    kind: overdue ? "Facture en retard" : "Facture à régler",
    title: invoice.subject || `Facture ${invoice.reference}`,
    detail: invoice.reference,
    amount: remaining,
    currency: invoice.currency ?? "DZD",
    href: "/espace-client/factures",
    actionLabel: "Voir le solde",
    tone: overdue ? "pink" : "yellow",
  };
}

/**
 * Construit le modele de l'accueil client. Les entrees `null` signalent une
 * donnee NON CHARGEE : elles alimentent `unknown`, jamais un compteur a zero.
 */
export function buildClientFocus({
  quotes = null,
  invoices = null,
  modifications = null,
  conversations = null,
  projects = null,
  milestonesByProject = {},
  unreadNotifications = 0,
  now = Date.now(),
} = {}) {
  const quoteItems = Array.isArray(quotes) ? quotes : [];
  const invoiceItems = Array.isArray(invoices) ? invoices : [];
  const modificationItems = Array.isArray(modifications) ? modifications : [];
  const conversationItems = Array.isArray(conversations) ? conversations : [];
  const projectItems = Array.isArray(projects) ? projects : [];

  const unknown = [];
  if (!Array.isArray(quotes)) unknown.push("quotes");
  if (!Array.isArray(invoices)) unknown.push("invoices");
  if (!Array.isArray(modifications)) unknown.push("modifications");
  if (!Array.isArray(conversations)) unknown.push("conversations");
  if (!Array.isArray(projects)) unknown.push("projects");

  const openQuotes = quoteItems.filter(isClientQuoteDecisionable);
  const payableInvoices = invoiceItems.filter(isClientInvoicePayable);
  const decidedModifications = modificationItems.filter(
    (request) => ["APPROVED", "REJECTED", "DONE"].includes(request?.status),
  );
  const unreadMessages = conversationItems.reduce((sum, conversation) => sum + (Number(conversation?.unreadCount) || 0), 0);

  const actions = [
    ...openQuotes.map((quote) => quoteAction(quote, now)),
    ...payableInvoices.map((invoice) => invoiceAction(invoice, now)),
  ];

  if (unreadMessages > 0) {
    actions.push({
      id: "messages-unread",
      category: "message",
      priority: 4,
      kind: "Réponse à lire",
      title: unreadMessages > 1 ? `${unreadMessages} messages non lus` : "1 message non lu",
      detail: "L’équipe vous a écrit dans une conversation de votre dossier.",
      href: "/espace-client/messagerie",
      actionLabel: "Ouvrir la messagerie",
      tone: "blue",
    });
  }

  if (Number(unreadNotifications) > 0) {
    actions.push({
      id: "notifications-unread",
      category: "notification",
      priority: 5,
      kind: "Notification à consulter",
      title: unreadNotifications > 1 ? `${unreadNotifications} notifications non lues` : "1 notification non lue",
      detail: "Une information concernant votre dossier est disponible.",
      href: "/espace-client/notifications",
      actionLabel: "Voir les notifications",
      tone: "blue",
    });
  }

  actions.sort((left, right) => left.priority - right.priority);

  const activeProjects = projectItems
    .filter((project) => project?.id && !CLIENT_CLOSED_PROJECT_STATUSES.includes(project.status))
    .map((project) => {
      const story = buildProjectStory(project, milestonesByProject?.[project.id] ?? null, now);
      return {
        id: project.id,
        name: project.name || project.reference || "Projet",
        reference: project.reference ?? null,
        status: project.status,
        statusLabel: story.statusLabel,
        statusExplanation: story.statusExplanation,
        progressPercent: story.progressPercent,
        dueDate: story.dueDate,
        nextStep: story.nextStep,
        completedSteps: story.completedCount,
        totalSteps: story.totalCount,
        href: `/espace-client/projets/${project.id}`,
      };
    });

  return {
    actions,
    openQuotes: openQuotes.map((quote) => ({
      id: quote.id,
      reference: quote.reference,
      subject: quote.subject,
      total: quote.total,
      currency: quote.currency,
      validUntil: quote.validUntil ?? null,
      followup: quoteFollowup(quote, now),
      href: `/espace-client/devis/${quote.id}`,
    })),
    invoices: {
      payable: payableInvoices.map((invoice) => ({
        id: invoice.id,
        reference: invoice.reference,
        subject: invoice.subject,
        remaining: invoiceRemaining(invoice),
        currency: invoice.currency,
        dueDate: invoice.dueDate ?? null,
      })),
      totalsByCurrency: sumByCurrency(payableInvoices),
      paidCount: invoiceItems.length - payableInvoices.length,
      href: "/espace-client/factures",
    },
    exchanges: {
      unreadMessages,
      unreadNotifications: Number(unreadNotifications) || 0,
      decidedModificationCount: decidedModifications.length,
      modificationResponses: decidedModifications.map((request) => ({
        id: request.id,
        title: request.title,
        reference: request.reference,
        advice: clientModificationAdvice(request, now),
      })),
      messagingHref: "/espace-client/messagerie",
      notificationsHref: "/espace-client/notifications",
      modificationsHref: "/espace-client/modifications",
    },
    projects: activeProjects,
    unknown,
    hasAnyData: unknown.length < 5 || quoteItems.length > 0 || invoiceItems.length > 0 || projectItems.length > 0,
  };
}
