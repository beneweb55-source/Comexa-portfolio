"use client";

import { formatDate } from "@/lib/api";
import { useAction, useListing } from "@/lib/use-listing";
import { useState } from "react";
import { Badge, Card, ConfirmDialog, Empty, Notice, secondaryButton } from "@/components/workspace/ui";

const USER_STATUS = { INVITED: "Invité", ACTIVE: "Actif", SUSPENDED: "Suspendu", ARCHIVED: "Archivé" };

/** Libelle d'un role, quelle que soit la forme renvoyee (code ou objet). */
function roleLabel(role) {
  if (typeof role === "string") return role;
  return role?.name ?? role?.code ?? "Rôle";
}

/**
 * Membres de l'equipe et de leurs droits. Reserve aux comptes qui ont
 * `user:read:any` : sinon l'API refuse et la page l'indique simplement.
 */
export default function MembresPage() {
  const users = useListing("/users?perPage=100");
  const action = useAction(users.reload);
  const forbidden = users.errorStatus === 403;
  const [pendingSuspend, setPendingSuspend] = useState(null);

  function suspend(user) {
    return action.run(`suspend:${user.id}`, `/users/${user.id}/suspend`, { method: "POST" }, `${user.firstName} ${user.lastName} est suspendu.`);
  }

  function reactivate(user) {
    return action.run(`reactivate:${user.id}`, `/users/${user.id}/reactivate`, { method: "POST" }, `${user.firstName} ${user.lastName} est réactivé.`);
  }

  if (forbidden) {
    return (
      <Card title="Membres et droits">
        <Notice tone="info">Cette rubrique est réservée aux administrateurs. Votre rôle ne permet pas d’administrer les comptes.</Notice>
      </Card>
    );
  }

  const items = users.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      {users.error ? <Notice>{users.error}</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}
      <Card title="Membres et droits">
        {users.items === null && !users.error ? <p className="text-[14px] text-[var(--comexa-ink-soft)]">Chargement…</p> : null}
        {users.items !== null && items.length === 0 ? <Empty>Aucun membre.</Empty> : null}
        <ul className="flex flex-col gap-3">
          {items.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] p-4">
              <div>
                <h3 className="text-[16px] font-semibold text-[var(--comexa-ink)]">
                  {user.firstName} {user.lastName}
                </h3>
                <p className="text-[13.5px] text-[var(--comexa-ink-soft)]">{user.email}</p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {(user.roles ?? []).map((role) => (
                    <Badge key={roleLabel(role)} tone="info">{roleLabel(role)}</Badge>
                  ))}
                </p>
                {user.lastLoginAt ? <p className="text-[13px] text-[var(--comexa-ink-muted)]">Dernière connexion : {formatDate(user.lastLoginAt)}</p> : null}
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={user.status === "ACTIVE" ? "success" : "warning"}>{USER_STATUS[user.status] ?? user.status}</Badge>
                {user.status === "ACTIVE" ? (
                  <button type="button" onClick={() => setPendingSuspend(user)} disabled={action.busy === `suspend:${user.id}`} className={`${secondaryButton} `}>
                    Suspendre
                  </button>
                ) : null}
                {user.status === "SUSPENDED" ? (
                  <button type="button" onClick={() => reactivate(user)} disabled={action.busy === `reactivate:${user.id}`} className={`${secondaryButton} `}>
                    Réactiver
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <ConfirmDialog
        open={pendingSuspend !== null}
        title="Suspendre ce membre ?"
        confirmLabel="Suspendre"
        tone="danger"
        busy={pendingSuspend !== null && action.busy === `suspend:${pendingSuspend.id}`}
        onCancel={() => setPendingSuspend(null)}
        onConfirm={async () => {
          const target = pendingSuspend;
          await suspend(target);
          setPendingSuspend(null);
        }}
      >
        <p className="cx-small">
          {pendingSuspend ? `${pendingSuspend.firstName} ${pendingSuspend.lastName} ne pourra plus se connecter tant que son compte est suspendu.` : ""}
        </p>
      </ConfirmDialog>
    </div>
  );
}
