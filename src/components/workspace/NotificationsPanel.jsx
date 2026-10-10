"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDate } from "@/lib/api";
import { useAction, useListing } from "@/lib/use-listing";
import { useAuth } from "@/lib/session";
import { hasTeamAccess } from "@/lib/access";
import { Badge, Card, Empty, Notice, secondaryButton } from "@/components/workspace/ui";

/*
 * Le backend produit des liens qui ne correspondent pas toujours aux routes du front
 * (ex. /espace/demandes/:id, /admin/projets/:id). On les ramène à la page de liste
 * correspondante de l'espace de l'utilisateur ; à défaut, à l'accueil de cet espace.
 */
const TEAM_TARGETS = {
  "espace/demandes": "modifications", "espace/messages": "messagerie", devis: "devis", factures: "factures",
  "admin/demandes": "demandes", projets: "projets", "admin/projets": "projets", taches: "projets", clients: "clients",
};
const CLIENT_TARGETS = {
  "espace/demandes": "modifications", "espace/messages": "messagerie", devis: "devis", projets: "projets",
};

export function resolveLink(link, team) {
  if (!link) return null;
  const segments = link.split("?")[0].split("/").filter(Boolean);
  const base = team ? "/espace-equipe" : "/espace-client";
  const targets = team ? TEAM_TARGETS : CLIENT_TARGETS;
  const two = segments.slice(0, 2).join("/");
  const one = segments[0] ?? "";
  const target = targets[two] ?? targets[one];
  return target ? `${base}/${target}` : base;
}

/**
 * Notifications de l'utilisateur connecté, partagées entre les deux espaces.
 * Lecture, marquage (un par un ou tout), suppression. Les liens internes sont suivis.
 */
export default function NotificationsPanel() {
  const { user } = useAuth();
  const team = hasTeamAccess(user);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const list = useListing("/notifications?perPage=100");
  const action = useAction(list.reload);
  const items = list.items ?? [];
  const visible = onlyUnread ? items.filter((n) => !n.readAt) : items;
  const unread = items.filter((n) => !n.readAt).length;

  async function markRead(item) {
    await action.run(`read:${item.id}`, `/notifications/${item.id}/read`, { method: "POST" }, "");
  }

  async function remove(item) {
    await action.run(`delete:${item.id}`, `/notifications/${item.id}`, { method: "DELETE" }, "Notification supprimée.");
  }

  async function readAll() {
    await action.run("all", "/notifications/read-all", { method: "POST" }, "Toutes les notifications sont lues.");
  }

  return (
    <Card
      title={`Notifications${unread ? ` (${unread} non lue${unread > 1 ? "s" : ""})` : ""}`}
      action={
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButton} aria-pressed={onlyUnread} onClick={() => setOnlyUnread((v) => !v)}>
            {onlyUnread ? "Toutes" : "Non lues"}
          </button>
          <button type="button" className={secondaryButton} onClick={readAll} disabled={unread === 0 || action.busy === "all"}>
            Tout marquer comme lu
          </button>
        </div>
      }
    >
      {list.error ? <Notice>{list.error}</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}
      {list.items === null && !list.error ? <p className="cx-small">Chargement…</p> : null}
      {list.items !== null && visible.length === 0 ? <Empty>{onlyUnread ? "Aucune notification non lue." : "Aucune notification."}</Empty> : null}

      <ul className="flex flex-col gap-3">
        {visible.map((item) => (
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
                <Link href={resolveLink(item.link, team)} className="mt-2 inline-block text-[14px] font-medium text-[var(--comexa-ink)] underline" onClick={() => !item.readAt && markRead(item)}>
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
    </Card>
  );
}
