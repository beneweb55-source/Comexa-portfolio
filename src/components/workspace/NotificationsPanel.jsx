"use client";

/*
 * Notifications — la liste complète, habillée dans la charte du tableau de bord.
 *
 * CE QUI CHANGE PAR RAPPORT À L'ANCIENNE LISTE, et pourquoi :
 *
 *  1. UNE ICÔNE ET UNE COULEUR PAR TYPE. Le serveur envoie un `type`
 *     (`TASK_ASSIGNED`, `INVOICE_OVERDUE`…) que l'ancien écran jetait. Il est
 *     maintenant traduit par `notificationMeta` : on reconnaît une échéance
 *     d'une facture impayée sans lire le titre.
 *  2. LE TEMPS EST RELATIF. « il y a 12 min » se lit plus vite qu'une date,
 *     et c'est la seule information qu'on cherche dans cette liste.
 *  3. LES NOTIFICATIONS SONT GROUPÉES PAR JOURNÉE. Une liste plate de 30 lignes
 *     ne dit pas où commence « aujourd'hui ».
 *  4. ON PEUT FILTRER PAR CATÉGORIE. « Montre-moi seulement l'échéance de mes
 *     tâches » était impossible : il fallait toutes les parcourir.
 *  5. LES GESTES SONT DES ICÔNES, PAS DES PHRASES. « Marquer comme lue » en
 *     bout de ligne prenait plus de place que la notification elle-même.
 *
 * CE QUI NE CHANGE PAS : les appels (`/notifications`, `/read`, `/read-all`,
 * `DELETE`), la traduction des liens courts du serveur, et la pagination.
 */

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { BellOff, Check, CheckCheck, Inbox, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/api";
import { useAction, useListing } from "@/lib/use-listing";
import { useAuth } from "@/lib/session";
import { hasTeamAccess } from "@/lib/access";
import { resolveNotificationHref } from "@/lib/notification-links";
import { spaceForPath } from "@/lib/spaces";
import { formatRelativeTime } from "@/components/softui/time";
import { notificationMeta } from "@/components/softui/notification-map";
import { Alert, Button, FilterPills, Panel } from "@/components/softui";
import { Pagination } from "@/components/workspace/ui";

/** Filtres proposés, dans l'ordre où on les cherche. */
const FILTERS = [
  { id: "all", label: "Toutes" },
  { id: "unread", label: "Non lues" },
  { id: "tasks", label: "Tâches" },
  { id: "commercial", label: "Commercial" },
  { id: "exchanges", label: "Échanges" },
  { id: "projects", label: "Projets" },
  { id: "system", label: "Système" },
];

/** Clé de journée locale : « aujourd'hui », « hier », puis la date. */
function dayBucket(value, now = Date.now()) {
  const at = new Date(value).getTime();
  if (!Number.isFinite(at)) return "—";
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfValue = new Date(at);
  startOfValue.setHours(0, 0, 0, 0);
  const days = Math.round((startOfToday.getTime() - startOfValue.getTime()) / 86_400_000);
  if (days === 0) return "Aujourd’hui";
  if (days === 1) return "Hier";
  if (days < 7) return `Il y a ${days} jours`;
  return formatDate(value);
}

export default function NotificationsPanel() {
  const { user } = useAuth();
  const pathname = usePathname();
  const area = hasTeamAccess(user) ? (spaceForPath(pathname) ?? "team") : "client";

  // Un SEUL filtre. « toutes », « non lues », ou l'identifiant d'une catégorie :
  // deux cases à cocher indépendantes donneraient un état « non lues + tâches »
  // qu'aucune pilule ne sait représenter.
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);

  const onlyUnread = filter === "unread";
  const path = `/notifications?page=${page}&perPage=30${onlyUnread ? "&read=false" : ""}`;
  const list = useListing(path);
  const unreadList = useListing("/notifications?read=false&page=1&perPage=1");

  const reloadNotifications = list.reload;
  const reloadUnreadCount = unreadList.reload;
  const refreshLists = useCallback(async () => {
    await Promise.all([reloadNotifications(), reloadUnreadCount()]);
  }, [reloadNotifications, reloadUnreadCount]);
  const action = useAction(refreshLists);

  // `list.items` vaut `null` pendant le chargement puis `[]` : c'est une
  // nouvelle référence à chaque rendu, donc on la stabilise avant de la passer
  // à un `useMemo` — sans quoi le filtre serait recalculé en permanence.
  const items = useMemo(() => list.items ?? [], [list.items]);
  const unread = Number.isFinite(Number(unreadList.meta?.total)) ? Number(unreadList.meta.total) : null;

  /* Filtre par catégorie : côté client, sur les 30 lignes déjà chargées. Le
     serveur ne connaît pas les catégories (elles sont une affaire
     d'affichage), et recharger à chaque clic ferait clignoter la liste. */
  const filtered = useMemo(
    () => (filter === "all" || filter === "unread"
      ? items
      : items.filter((item) => (notificationMeta(item.type).group ?? "system") === filter)),
    [items, filter],
  );

  /* Regroupement par journée, en conservant l'ordre du serveur. */
  const sections = useMemo(() => {
    const map = new Map();
    for (const item of filtered) {
      const key = dayBucket(item.createdAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()];
  }, [filtered]);

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

  const busy = Boolean(action.busy);

  return (
    <Panel
      title={`Notifications${unread ? ` · ${unread} non lue${unread > 1 ? "s" : ""}` : ""}`}
      action={
        <div className="sui-card__actions">
          <Button icon={CheckCheck} onClick={readAll} disabled={unread === null || unread === 0 || busy}>
            Tout marquer comme lu
          </Button>
        </div>
      }
    >
      {list.error ? <Alert tone="error">{list.error}</Alert> : null}
      {unreadList.error ? <Alert tone="error">{unreadList.error}</Alert> : null}
      {action.error ? <Alert tone="error">{action.error}</Alert> : null}
      {action.success ? <Alert tone="success">{action.success}</Alert> : null}

      <FilterPills
        items={FILTERS}
        value={filter}
        onChange={(next) => {
          setFilter(next);
          setPage(1);
        }}
        label="Filtrer les notifications"
      />

      {list.items === null && !list.error ? <p className="sui-card__desc">Chargement…</p> : null}

      {list.items !== null && filtered.length === 0 ? (
        <div className="sui-empty">
          <span className="sui-empty__icon" aria-hidden="true">
            {onlyUnread ? <Check size={22} strokeWidth={1.8} /> : <Inbox size={22} strokeWidth={1.8} />}
          </span>
          <p>{onlyUnread ? "Aucune notification non lue. Tout est à jour." : "Aucune notification pour l’instant."}</p>
        </div>
      ) : null}

      {sections.map(([bucket, rows]) => (
        <section key={bucket} className="sui-notif__day">
          <h3 className="sui-notif__day-title">{bucket}</h3>
          <ul className="sui-notif__list">
            {rows.map((item) => {
              const meta = notificationMeta(item.type);
              const Icon = meta.icon ?? BellOff;
              const href = item.link ? resolveNotificationHref(item.link, area) : null;
              return (
                <li key={item.id} className={`sui-notif${item.readAt ? "" : " is-unread"}`}>
                  <span className="sui-notif__icon" data-tone={meta.tone} aria-hidden="true">
                    <Icon size={17} strokeWidth={1.9} />
                  </span>

                  <div className="sui-notif__body">
                    <p className="sui-notif__title">
                      {href ? (
                        <Link href={href} onClick={() => !item.readAt && markRead(item)}>
                          {item.title}
                        </Link>
                      ) : (
                        item.title
                      )}
                      {!item.readAt ? <span className="sui-notif__dot" aria-label="Non lue" /> : null}
                    </p>
                    {item.body ? <p className="sui-notif__text">{item.body}</p> : null}
                    <p className="sui-notif__meta">
                      <span className="sui-notif__tag">{meta.label}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={item.createdAt} title={formatDate(item.createdAt)}>
                        {formatRelativeTime(item.createdAt)}
                      </time>
                    </p>
                  </div>

                  <div className="sui-notif__actions">
                    {!item.readAt ? (
                      <button
                        type="button"
                        className="sui-iconbtn"
                        onClick={() => markRead(item)}
                        disabled={busy}
                        aria-label={`Marquer « ${item.title} » comme lue`}
                        title="Marquer comme lue"
                      >
                        <Check size={16} strokeWidth={2} aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="sui-iconbtn sui-iconbtn--ghost"
                      onClick={() => remove(item)}
                      disabled={busy}
                      aria-label={`Supprimer « ${item.title} »`}
                      title="Supprimer"
                    >
                      <Trash2 size={16} strokeWidth={1.9} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <Pagination meta={list.meta} onPageChange={setPage} loading={list.loading} label="Pagination des notifications" />
    </Panel>
  );
}
