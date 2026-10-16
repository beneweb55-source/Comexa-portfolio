"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { formatDate } from "@/lib/api";
import { useAction, useListing } from "@/lib/use-listing";
import { useAuth } from "@/lib/session";
import { hasTeamAccess } from "@/lib/access";
import { resolveNotificationHref } from "@/lib/notification-links";
import { spaceForPath } from "@/lib/spaces";
import { Badge, Card, Empty, Notice, Pagination, secondaryButton } from "@/components/workspace/ui";

/*
 * Le serveur produit des liens courts (`/factures/:id`, `/taches/:id`…) qui ne
 * sont pas des routes du frontend : `resolveNotificationHref` les traduit vers
 * la fiche ou la liste correspondante de l'espace COURANT (personnel, équipe,
 * Comexa Space ou espace client).
 */
export function resolveLink(link, area) {
  return link ? resolveNotificationHref(link, area) : null;
}

/**
 * Notifications de l'utilisateur connecté, partagées entre les deux espaces.
 * Lecture, marquage (un par un ou tout), suppression. Les liens internes sont suivis.
 */
export default function NotificationsPanel() {
  const { user } = useAuth();
  const pathname = usePathname();
  const area = hasTeamAccess(user) ? (spaceForPath(pathname) ?? "team") : "client";
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [page, setPage] = useState(1);
  const path = `/notifications?page=${page}&perPage=30${onlyUnread ? "&read=false" : ""}`;
  const list = useListing(path);
  const unreadList = useListing("/notifications?read=false&page=1&perPage=1");
  const reloadNotifications = list.reload;
  const reloadUnreadCount = unreadList.reload;
  const refreshLists = useCallback(async () => {
    await Promise.all([reloadNotifications(), reloadUnreadCount()]);
  }, [reloadNotifications, reloadUnreadCount]);
  const action = useAction(refreshLists);
  const items = list.items ?? [];
  const unread = Number.isFinite(Number(unreadList.meta?.total)) ? Number(unreadList.meta.total) : null;

  async function markRead(item) {
    const result = await action.run(`read:${item.id}`, `/notifications/${item.id}/read`, { method: "POST" }, "");
    if (result !== null && onlyUnread && items.length === 1 && page > 1) setPage(page - 1);
  }

  async function remove(item) {
    const result = await action.run(`delete:${item.id}`, `/notifications/${item.id}`, { method: "DELETE" }, "Notification supprimée.");
    if (result !== null && items.length === 1 && page > 1) setPage(page - 1);
  }

  async function readAll() {
    const result = await action.run("all", "/notifications/read-all", { method: "POST" }, "Toutes les notifications sont lues.");
    if (result !== null && onlyUnread) setPage(1);
  }

  return (
    <Card
      title={`Notifications${unread ? ` (${unread} non lue${unread > 1 ? "s" : ""})` : ""}`}
      action={
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButton} aria-pressed={onlyUnread} onClick={() => { setOnlyUnread((value) => !value); setPage(1); }}>
            {onlyUnread ? "Toutes" : "Non lues"}
          </button>
          <button type="button" className={secondaryButton} onClick={readAll} disabled={unread === null || unread === 0 || action.busy === "all"}>
            Tout marquer comme lu
          </button>
        </div>
      }
    >
      {list.error ? <Notice>{list.error}</Notice> : null}
      {unreadList.error ? <Notice>{unreadList.error}</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}
      {list.items === null && !list.error ? <p className="cx-small">Chargement…</p> : null}
      {list.items !== null && items.length === 0 ? <Empty>{onlyUnread ? "Aucune notification non lue." : "Aucune notification."}</Empty> : null}

      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={item.id}
            className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4 ${
              item.readAt ? "border-[var(--comexa-border-soft)]" : "border-[var(--comexa-ink)] bg-[var(--comexa-neutral-100)]"
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[var(--comexa-ink)]">
                {item.title}
                {!item.readAt ? <Badge tone="info">Nouveau</Badge> : null}
              </p>
              {item.body ? <p className="mt-1 text-[14px] text-[var(--comexa-ink-soft)]">{item.body}</p> : null}
              <p className="mt-1 text-[12.5px] text-[var(--comexa-ink-muted)]">{formatDate(item.createdAt)}</p>
              {item.link ? (
                <Link href={resolveLink(item.link, area)} className="mt-2 inline-block text-[14px] font-medium text-[var(--comexa-ink)] underline" onClick={() => !item.readAt && markRead(item)}>
                  Voir
                </Link>
              ) : null}
            </div>
            <div className="flex gap-2">
              {!item.readAt ? (
                <button type="button" className={secondaryButton} onClick={() => markRead(item)} disabled={action.busy === `read:${item.id}`}>
                  Marquer comme lue
                </button>
              ) : null}
              <button type="button" className={secondaryButton} onClick={() => remove(item)} disabled={action.busy === `delete:${item.id}`}>
                Supprimer
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Pagination meta={list.meta} onPageChange={setPage} loading={list.loading} label="Pagination des notifications" />
    </Card>
  );
}
