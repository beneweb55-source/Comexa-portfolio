"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Banknote,
  Building2,
  FileText,
  FolderKanban,
  ListChecks,
  ReceiptText,
  ShieldAlert,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/workspace/ui";
import {
  resourceStatusLabel,
  resourceStatusTone,
  resourceTypeLabel,
} from "@/lib/chat-resources";
import { resolveNotificationHref } from "@/lib/notification-links";

/**
 * CARTE DE RESSOURCE PARTAGEE — ce que le chat sait montrer d'un projet, d'une
 * facture, d'un client… sans en devenir une copie.
 *
 * TROIS ETATS, un seul principe : la carte est une VITRE sur le dashboard, pas
 * un recu du message.
 *
 *  - `view` absent : la relecture est en vol — squelette calme, jamais un
 *    texte fantome invente depuis l'aperçu du payload (le message, lui, ne
 *    transporte QUE (type, id) : le titre d'autrui ne traverse pas l'API).
 *  - `available: true` : titre VIVANT, statut VIVANT, lien vers la vraie page.
 *    Renommer la ressource, changer son statut : la carte suit, car elle est
 *    relue a chaque ouverture du fil.
 *  - `available: false` : « supprimee ou hors de votre perimetre » — un seul
 *    mot pour les deux, parce que la distinction serait une oracle
 *    d'enumeration. Si l'echec etait reseau (`transient`), un bouton relance.
 *
 * LA COULEUR DU CONTENU est portee par le type (pastel de la charte), pas par
 * une fantaisie : un devis jaune, une facture rose, comme dans leurs rubriques.
 * Sur une bulle noire (mes messages), la carte reste claire : c'est un objet
 * qu'on ouvre, pas un fragment du message.
 */

const TYPE_ICONS = {
  PROJECT: FolderKanban,
  TASK: ListChecks,
  CLIENT: Building2,
  QUOTE: FileText,
  INVOICE: ReceiptText,
  PAYMENT: Banknote,
  DOCUMENT: FileText,
};

const TYPE_TONES = {
  PROJECT: "blue",
  TASK: "green",
  CLIENT: "lilac",
  QUOTE: "yellow",
  INVOICE: "pink",
  PAYMENT: "plain",
  DOCUMENT: "plain",
};

/** Tonalite des pilules `Badge` (info/success/…) → pas de conversion : le libelle vient du type lui-meme. */
const TYPE_BADGE_TONES = TYPE_TONES;

export function SharedResourceCard({ resource, view, area = "team", onRetry, onOpen }) {
  const type = resource.resourceType;
  const Icon = TYPE_ICONS[type] ?? FileText;
  const typeLabel = resourceTypeLabel(type);

  /* --- Ressource hors d'atteinte ou disparue ------------------------------ */
  if (view && !view.available) {
    return (
      <div className="sui-chat__ref-card sui-chat__ref-card--off" role="group" aria-label={`${typeLabel} non disponible`}>
        <span className="sui-chat__ref-icon" data-tone="plain" aria-hidden="true">
          <ShieldAlert size={16} strokeWidth={1.9} />
        </span>
        <span className="sui-chat__ref-body">
          <strong>{typeLabel}</strong>
          <span>
            {view.transient
              ? "Relecture impossible pour l'instant."
              : "Supprimée ou hors de votre périmètre d'accès."}
          </span>
        </span>
        {view.transient && onRetry ? (
          <button type="button" className="sui-chat__ref-retry" onClick={onRetry}>
            <RefreshCw size={13} strokeWidth={2} aria-hidden="true" />
            Réessayer
          </button>
        ) : null}
      </div>
    );
  }

  /* --- Relecture en vol : squelette, pas de mensonge ---------------------- */
  if (!view) {
    return (
      <div className="sui-chat__ref-card is-loading" aria-hidden="true">
        <span className="sui-chat__ref-icon" data-tone={TYPE_BADGE_TONES[type] ?? "plain"}>
          <Icon size={16} strokeWidth={1.9} />
        </span>
        <span className="sui-chat__ref-body">
          <strong className="sui-chat__ref-skeleton" style={{ width: "58%" }} />
          <span className="sui-chat__ref-skeleton" style={{ width: "34%" }} />
        </span>
      </div>
    );
  }

  /* --- Carte vivante ------------------------------------------------------- */
  const href = view.link ? resolveNotificationHref(view.link, area) : null;
  const statusLabel = resourceStatusLabel(type, view.statusKey);
  const statusTone = resourceStatusTone(type, view.statusKey);
  const amount = typeof view.amount === "string" && view.amount.length > 0 ? view.amount : null;

  const inner = (
    <>
      <span className="sui-chat__ref-icon" data-tone={TYPE_BADGE_TONES[type] ?? "plain"} aria-hidden="true">
        <Icon size={16} strokeWidth={1.9} />
      </span>
      <span className="sui-chat__ref-body">
        <span className="sui-chat__ref-line">
          <em>{typeLabel}</em>
          {statusLabel ? <Badge tone={statusTone}>{statusLabel}</Badge> : null}
        </span>
        <strong>{view.title ?? "Ressource"}</strong>
        {view.subtitle || amount ? (
          <span className="sui-chat__ref-sub">
            {[view.subtitle, amount].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </span>
      {href ? (
        <span className="sui-chat__ref-open" aria-hidden="true">
          <ArrowUpRight size={16} strokeWidth={2} />
        </span>
      ) : null}
    </>
  );

  const className = `sui-chat__ref-card sui-chat__ref-card--${TYPE_TONES[type] ?? "plain"}`;

  if (href) {
    return (
      <Link
        href={href}
        className={`${className} sui-chat__ref-card--link`}
        onClick={onOpen}
        aria-label={`Ouvrir ${typeLabel.toLowerCase()} : ${view.title ?? ""}`}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className={className} role="group" aria-label={`${typeLabel} — ${view.title ?? ""}`}>
      {inner}
    </div>
  );
}

export default SharedResourceCard;
