/*
 * Correspondances notification → présentation (libellé, icône lucide, pastel).
 *
 * Les types sont ceux de l'API (`NotificationType`) : aucune invention côté front.
 * Une seule table, utilisée par le panneau « Admin Desk » et la cloche du rail,
 * pour que le même événement n'ait jamais deux habillages différents.
 */

import {
  BadgeCheck,
  Banknote,
  Bell,
  CalendarClock,
  FilePen,
  FileText,
  LifeBuoy,
  Mail,
  MessageSquare,
  ReceiptText,
  ShieldCheck,
  SquareKanban,
  TriangleAlert,
} from "lucide-react";

export const NOTIFICATION_META = {
  TASK_ASSIGNED: { label: "Tâche", icon: SquareKanban, tone: "blue", group: "tasks" },
  TASK_DUE_SOON: { label: "Échéance", icon: CalendarClock, tone: "yellow", group: "tasks" },
  TASK_COMPLETED: { label: "Tâche terminée", icon: BadgeCheck, tone: "green", group: "tasks" },
  MILESTONE_REACHED: { label: "Jalon", icon: BadgeCheck, tone: "green", group: "projects" },
  PROJECT_STATUS_CHANGED: { label: "Projet", icon: FilePen, tone: "lilac", group: "projects" },
  QUOTE_SENT: { label: "Devis", icon: FileText, tone: "blue", group: "commercial" },
  QUOTE_ACCEPTED: { label: "Devis accepté", icon: BadgeCheck, tone: "green", group: "commercial" },
  QUOTE_REJECTED: { label: "Devis refusé", icon: TriangleAlert, tone: "pink", group: "commercial" },
  INVOICE_ISSUED: { label: "Facture", icon: ReceiptText, tone: "lilac", group: "commercial" },
  INVOICE_OVERDUE: { label: "Impayé", icon: TriangleAlert, tone: "pink", group: "commercial" },
  PAYMENT_RECEIVED: { label: "Paiement", icon: Banknote, tone: "green", group: "commercial" },
  MESSAGE_RECEIVED: { label: "Message", icon: MessageSquare, tone: "blue", group: "exchanges" },
  DOCUMENT_SHARED: { label: "Document", icon: Mail, tone: "lilac", group: "exchanges" },
  MODIFICATION_REQUESTED: { label: "Modification", icon: LifeBuoy, tone: "yellow", group: "exchanges" },
  CONTACT_REQUEST_RECEIVED: { label: "Demande", icon: LifeBuoy, tone: "yellow", group: "commercial" },
  SYSTEM: { label: "Système", icon: ShieldCheck, tone: "plain", group: "system" },
};

export function notificationMeta(type) {
  return NOTIFICATION_META[type] ?? { label: "Notification", icon: Bell, tone: "plain", group: "system" };
}
