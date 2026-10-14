"use client";

import { useEffect, useMemo, useState } from "react";
import { messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useAction, useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Notice, primaryButton, secondaryButton } from "@/components/workspace/ui";

const RESOURCE_LABEL = {
  user: "Comptes", role: "Rôles", permission: "Permissions", audit: "Journal", client: "Clients", contact: "Contacts",
  prospect: "Prospects", project: "Projets", milestone: "Jalons", task: "Tâches", time: "Temps", activity: "Activité",
  quote: "Devis", order: "Commandes", invoice: "Factures", payment: "Paiements", project_request: "Demandes de projet",
  conversation: "Conversations", message: "Messages", notification: "Notifications", document: "Documents", report: "Rapports",
  dashboard: "Tableau de bord", service: "Services", package: "Packs", casestudy: "Études de cas", testimonial: "Témoignages",
  partner: "Partenaires", faq: "FAQ", contactrequest: "Demandes de contact", modificationrequest: "Demandes de modification",
  setting: "Paramètres", integration: "API & Intégrations",
};

/**
 * Rôles et permissions. La liste des rôles vient de l'API ; le détail (permissions cochées)
 * se charge à la sélection. Le rôle ADMIN n'est pas modifiable : l'API le refuse aussi.
 */
export default function RolesPage() {
  const { user } = useAuth();
  const canManageRoles = can(user, "role:manage:any");
  const canReadPermissions = can(user, "permission:read:any");
  const roles = useListing("/roles");
  const catalogue = useListing(canReadPermissions ? "/permissions" : null);
  const [selectedCode, setSelectedCode] = useState(null);
  const forbidden = roles.errorStatus === 403;

  if (forbidden) {
    return (
      <Card title="Rôles et permissions">
        <Notice tone="info">Cette rubrique est réservée aux administrateurs.</Notice>
      </Card>
    );
  }

  const items = roles.items ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
      <Card title="Rôles">
        {roles.error ? <Notice>{roles.error}</Notice> : null}
        {roles.items === null && !roles.error ? <p className="cx-small">Chargement…</p> : null}
        {roles.items !== null && items.length === 0 ? <Empty>Aucun rôle.</Empty> : null}
        <ul className="flex flex-col gap-2">
          {items.map((role) => (
            <li key={role.code}>
              <button
                type="button"
                onClick={() => setSelectedCode(role.code)}
                aria-current={selectedCode === role.code ? "true" : undefined}
                className={`w-full rounded-lg border p-3 text-left ${
                  selectedCode === role.code ? "border-[var(--comexa-ink)] bg-[var(--comexa-neutral-100)]" : "border-[var(--comexa-border-soft)] hover:bg-[var(--comexa-neutral-100)]"
                }`}
              >
                <span className="block text-[14.5px] font-semibold text-[var(--comexa-ink)]">{role.name}</span>
                <span className="mt-1 block text-[12.5px] text-[var(--comexa-ink-muted)]">
                  {role.permissionCount} permission(s){role.isSystem ? " · système" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {selectedCode ? (
        <RoleEditor key={selectedCode} code={selectedCode} catalogue={catalogue} canManageRoles={canManageRoles} canReadPermissions={canReadPermissions} onSaved={roles.reload} />
      ) : (
        <Card title="Permissions">
          <Empty>Sélectionnez un rôle pour voir et modifier ses permissions.</Empty>
        </Card>
      )}
    </div>
  );
}

function RoleEditor({ code, catalogue, canManageRoles, canReadPermissions, onSaved }) {
  const { request } = useAuth();
  const [role, setRole] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null);
  const action = useAction(onSaved);
  const locked = code === "ADMIN";
  const canEdit = canManageRoles && canReadPermissions && !locked;

  useEffect(() => {
    let cancelled = false;
    request(`/roles/${code}`)
      .then(({ data }) => {
        if (cancelled) return;
        setRole(data);
        setSelected((data.permissions ?? []).map((p) => p.code));
      })
      .catch((caught) => {
        if (!cancelled) setLoadError(messageOf(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [code, request]);

  // Le catalogue regroupe les permissions par ressource pour la lecture.
  const groups = useMemo(() => {
    const map = new Map();
    for (const permission of catalogue.items ?? []) {
      const key = permission.resource;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(permission);
    }
    return [...map.entries()].sort(([a], [b]) => (RESOURCE_LABEL[a] ?? a).localeCompare(RESOURCE_LABEL[b] ?? b));
  }, [catalogue.items]);

  function toggle(permissionCode) {
    setSelected((current) => (current.includes(permissionCode) ? current.filter((c) => c !== permissionCode) : [...current, permissionCode]));
  }

  async function save() {
    await action.run(
      "save",
      `/roles/${code}/permissions`,
      { method: "PATCH", body: { permissionCodes: selected } },
      "Permissions enregistrées. Elles s'appliquent aux prochaines connexions.",
    );
  }

  if (loadError) return <Card title="Rôle"><Notice>{loadError}</Notice></Card>;
  if (!role || selected === null) return <Card title="Permissions"><p className="cx-small">Chargement…</p></Card>;

  return (
    <Card
      title={`Permissions : ${role.name}`}
      action={!canEdit ? <Badge tone="neutral">Lecture seule</Badge> : null}
    >
      {locked ? <Notice tone="info">Le rôle Administrateur garde toutes les permissions. Il ne peut pas être modifié.</Notice> : null}
      {!canManageRoles ? <Notice tone="info">Votre rôle peut consulter les permissions, mais ne peut pas les modifier.</Notice> : null}
      {canManageRoles && !canReadPermissions ? <Notice>Votre rôle ne permet pas de consulter le catalogue des permissions nécessaire à la modification.</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}
      {catalogue.error ? <Notice>{catalogue.error}</Notice> : null}

      <div className="flex flex-col gap-6">
        {groups.map(([resource, permissions]) => (
          <fieldset key={resource} className="flex flex-col gap-2">
            <legend className="mb-2 text-[14px] font-semibold text-[var(--comexa-ink)]">{RESOURCE_LABEL[resource] ?? resource}</legend>
            <div className="grid gap-2 md:grid-cols-2">
              {permissions.map((permission) => (
                <label key={permission.code} className="flex items-start gap-2 text-[13.5px]">
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={!canEdit}
                    checked={selected.includes(permission.code)}
                    onChange={() => toggle(permission.code)}
                  />
                  <span>
                    <code className="text-[12.5px]">{permission.code}</code>
                    <span className="block text-[var(--comexa-ink-soft)]">{permission.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      {canEdit ? (
        <div className="mt-6 flex gap-3">
          <button type="button" className={primaryButton} onClick={save} disabled={Boolean(action.busy)}>
            {action.busy === "save" ? "Enregistrement…" : "Enregistrer les permissions"}
          </button>
          <button type="button" className={secondaryButton} onClick={() => setSelected((role.permissions ?? []).map((p) => p.code))}>
            Annuler les modifications
          </button>
        </div>
      ) : null}
    </Card>
  );
}
