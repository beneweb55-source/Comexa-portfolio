"use client";

/*
 * Alerte de notification EN TEMPS RÉEL.
 *
 * Le serveur pousse chaque notification dans la room personnelle de son
 * destinataire ; ce composant l'écoute et l'affiche là où l'on se trouve, sans
 * avoir à recharger ni à ouvrir la page des notifications.
 *
 * POURQUOI ELLE SE TAIT SUR LA PAGE DES NOTIFICATIONS : afficher une alerte
 * pour une ligne qu'on est justement en train de lire est un bruit inutile.
 *
 * POURQUOI ELLE SE TAIT EN MODE CONCENTRATION : « ne pas déranger » n'a de
 * valeur que si on le respecte. Le drapeau est posé sur `<html>` par le
 * fournisseur du mode concentration, et le CSS s'en sert
 * (`html[data-focus-dnd="on"]`).
 *
 * LE MASQUAGE EST SUIVI PAR IDENTIFIANT, PAS PAR UN DRAPEAU. Une notification
 * suivie d'une autre doit réafficher l'alerte : avec un booléen, la seconde
 * arriverait sur un composant déjà masqué et resterait invisible. En comparant
 * les identifiants, chaque notification a droit à ses sept secondes.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, X } from "lucide-react";
import { useAuth } from "@/lib/session";
import { hasTeamAccess } from "@/lib/access";
import { resolveNotificationHref } from "@/lib/notification-links";
import { spaceForPath } from "@/lib/spaces";
import { formatRelativeTime } from "@/components/softui/time";
import { notificationMeta } from "@/components/softui/notification-map";
import { useLatestNotification } from "@/lib/use-realtime-notifications";

/** Durée d'affichage : assez pour lire, assez court pour ne pas gêner. */
const VISIBLE_MS = 7000;

export default function LiveNotification({ onNew = null }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const area = hasTeamAccess(user) ? (spaceForPath(pathname) ?? "team") : "client";
  const onNotificationsPage = Boolean(pathname?.endsWith("/notifications"));

  const { latest } = useLatestNotification(onNew);
  const [dismissedId, setDismissedId] = useState(null);

  // Le décompte se relance à chaque notification : il est différé dans un
  // timeout, donc il ne rend pas en cascade au montage.
  useEffect(() => {
    if (!latest) return undefined;
    const id = window.setTimeout(() => setDismissedId(latest.id), VISIBLE_MS);
    return () => window.clearTimeout(id);
  }, [latest]);

  const visible = latest && latest.id !== dismissedId && !onNotificationsPage ? latest : null;
  if (!visible) return null;

  const meta = notificationMeta(visible.type);
  const Icon = meta.icon ?? Bell;
  const href = visible.link ? resolveNotificationHref(visible.link, area) : null;

  return (
    <aside className="sui-notif-live" role="status" aria-live="polite">
      <div className="sui-notif-live__head">
        <span className="sui-notif-live__icon" data-tone={meta.tone} aria-hidden="true">
          <Icon size={16} strokeWidth={1.9} />
        </span>
        <span className="sui-notif-live__label">{meta.label}</span>
        <button
          type="button"
          className="sui-notif-live__close"
          onClick={() => setDismissedId(visible.id)}
          aria-label="Masquer cette notification"
        >
          <X size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <p className="sui-notif-live__title">{href ? <Link href={href}>{visible.title}</Link> : visible.title}</p>
      {visible.body ? <p className="sui-notif-live__text">{visible.body}</p> : null}
      <p className="sui-notif-live__time">{formatRelativeTime(visible.createdAt)}</p>
    </aside>
  );
}
