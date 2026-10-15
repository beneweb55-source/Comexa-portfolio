"use client";

import { useEffect, useState } from "react";
import { formatDate, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useAction, useListing } from "@/lib/use-listing";
import { Badge, Card, ConfirmDialog, Empty, Field, Notice, Pagination, inputClass, primaryButton, secondaryButton, selectClass } from "@/components/workspace/ui";

const USER_STATUS = { INVITED: "Invité", ACTIVE: "Actif", SUSPENDED: "Suspendu", ARCHIVED: "Archivé" };
const USER_STATUS_TONE = { INVITED: "info", ACTIVE: "success", SUSPENDED: "warning", ARCHIVED: "neutral" };
const ROLE_LABEL = {
  ADMIN: "Administrateur",
  COMMUNICATION_MANAGER: "Gérant communication",
  PROJECT_MANAGER: "Chef de projet",
  DEVELOPER: "Développeur",
  DESIGNER: "Designer",
  SALES: "Commercial",
  CLIENT: "Client",
};

/** Un rôle peut arriver sous forme de code (liste des comptes) ou d'objet. */
function roleCode(role) {
  return typeof role === "string" ? role : role?.code;
}

/**
 * Membres de l'équipe : création, rôles, réinitialisation du mot de passe, suspension.
 * Les mots de passe générés ne sont affichés qu'une fois, à la création ou à la réinitialisation.
 * Réservé aux comptes avec `user:manage:any` : sinon l'API refuse et la page l'indique.
 */
export default function MembresPage() {
  const { user, request } = useAuth();
  const canManageMembers = can(user, "user:manage:any");
  const canReadRoles = can(user, "role:read:any");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(1);
  const path = `/users?page=${page}&perPage=100${query ? `&search=${encodeURIComponent(query)}` : ""}${status ? `&status=${status}` : ""}${roleFilter ? `&roleCode=${roleFilter}` : ""}`;
  const users = useListing(path);
  const action = useAction(users.reload);
  const [roles, setRoles] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editingRoles, setEditingRoles] = useState(null);
  const [pendingSuspend, setPendingSuspend] = useState(null);
  const [pendingReset, setPendingReset] = useState(null);
  const [revealed, setRevealed] = useState(null); // { title, email, password }
  const forbidden = users.errorStatus === 403;

  useEffect(() => {
    if (!canReadRoles) return undefined;
    request("/roles")
      .then(({ data }) => setRoles(data ?? []))
      .catch(() => setRoles([]));
    return undefined;
  }, [canReadRoles, request]);

  if (forbidden) {
    return (
      <Card title="Membres et droits">
        <Notice tone="info">Cette rubrique est réservée aux administrateurs. Votre rôle ne permet pas d’administrer les comptes.</Notice>
      </Card>
    );
  }

  const items = users.items ?? [];
  const name = (user) => `${user.firstName} ${user.lastName}`;

  async function suspend(user) {
    const result = await action.run(`suspend:${user.id}`, `/users/${user.id}/suspend`, { method: "POST" }, `${name(user)} est suspendu.`);
    if (result !== null) setPendingSuspend(null);
  }

  async function reset(user) {
    const result = await action.run(`reset:${user.id}`, `/users/${user.id}/reset-password`, { method: "POST" }, null);
    if (result !== null) {
      setPendingReset(null);
      setRevealed({ title: "Mot de passe réinitialisé", email: user.email, password: result?.data?.temporaryPassword ?? result?.temporaryPassword ?? "" });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {users.error ? <Notice>{users.error}</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}
      {revealed ? (
        <Notice tone="warning">
          <strong>{revealed.title} pour {revealed.email}.</strong> Mot de passe provisoire, affiché une seule fois : {revealed.password || "(non renvoyé)"}.
          <span className="mt-2 block">
            <button type="button" className={secondaryButton} onClick={() => setRevealed(null)}>Fermer</button>
          </span>
        </Notice>
      ) : null}

      <Card
        title="Membres et droits"
        action={
          canManageMembers ? (
            <button type="button" className={primaryButton} onClick={() => setCreating((value) => !value)}>
              {creating ? "Fermer" : "Ajouter un membre"}
            </button>
          ) : null
        }
      >
        {creating && canManageMembers ? (
          canReadRoles ? (
            <CreateMember
              roles={roles}
              onCreated={(password, email) => {
                setCreating(false);
                setPage(1);
                setRevealed({ title: "Compte créé", email, password });
                users.reload();
              }}
            />
          ) : <Notice>Votre rôle ne permet pas de consulter les rôles nécessaires pour créer un compte.</Notice>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(search.trim());
            setPage(1);
          }}
          className="mb-5 flex flex-wrap items-end gap-3"
        >
          <Field id="members-search" label="Recherche">
            <input id="members-search" className={`${inputClass} !w-[220px]`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom ou e-mail" />
          </Field>
          <Field id="members-status" label="Statut">
            <select id="members-status" className={`${selectClass} !w-[160px]`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Tous</option>
              {Object.entries(USER_STATUS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          <Field id="members-role" label="Rôle">
            <select id="members-role" className={`${selectClass} !w-[200px]`} value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}>
              <option value="">Tous</option>
              {roles.map((role) => (
                <option key={role.code} value={role.code}>{role.name ?? ROLE_LABEL[role.code] ?? role.code}</option>
              ))}
            </select>
          </Field>
          <button type="submit" className={secondaryButton}>Filtrer</button>
        </form>

        {users.items === null && !users.error ? <p className="cx-small">Chargement…</p> : null}
        {users.items !== null && items.length === 0 ? <Empty>Aucun membre pour ces critères.</Empty> : null}

        <ul className="flex flex-col gap-3">
          {items.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] p-4">
              <div className="min-w-0">
                <h3 className="text-[16px] font-semibold text-[var(--comexa-ink)]">{name(user)}</h3>
                <p className="text-[13.5px] text-[var(--comexa-ink-soft)]">{user.email}</p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {(user.roles ?? []).map((role) => (
                    <Badge key={roleCode(role)} tone="info">{ROLE_LABEL[roleCode(role)] ?? roleCode(role)}</Badge>
                  ))}
                  {user.mustChangePassword ? <Badge tone="warning">Mot de passe à changer</Badge> : null}
                </p>
                {user.lastLoginAt ? <p className="text-[13px] text-[var(--comexa-ink-muted)]">Dernière connexion : {formatDate(user.lastLoginAt)}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={USER_STATUS_TONE[user.status] ?? "neutral"}>{USER_STATUS[user.status] ?? user.status}</Badge>
                {canManageMembers ? (
                  <>
                    {canReadRoles ? <button type="button" className={secondaryButton} onClick={() => setEditingRoles(user)}>Rôles</button> : null}
                    <button type="button" className={secondaryButton} onClick={() => setPendingReset(user)} disabled={Boolean(action.busy)}>
                      Réinitialiser le mot de passe
                    </button>
                    {user.status === "ACTIVE" ? (
                      <button type="button" className={secondaryButton} onClick={() => setPendingSuspend(user)} disabled={Boolean(action.busy)}>
                        Suspendre
                      </button>
                    ) : null}
                    {user.status === "SUSPENDED" ? (
                      <button
                        type="button"
                        className={secondaryButton}
                        onClick={() => action.run(`reactivate:${user.id}`, `/users/${user.id}/reactivate`, { method: "POST" }, `${name(user)} est réactivé.`)}
                        disabled={Boolean(action.busy)}
                      >
                        Réactiver
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <Pagination meta={users.meta} onPageChange={setPage} loading={users.loading} />
      </Card>

      {editingRoles && canManageMembers && canReadRoles ? (
        <EditRoles
          key={editingRoles.id}
          user={editingRoles}
          roles={roles}
          onClose={() => setEditingRoles(null)}
          onSaved={async () => {
            setEditingRoles(null);
            await users.reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingSuspend !== null}
        title="Suspendre ce membre ?"
        confirmLabel="Suspendre"
        tone="danger"
        busy={pendingSuspend !== null && action.busy === `suspend:${pendingSuspend.id}`}
        onCancel={() => setPendingSuspend(null)}
        onConfirm={() => suspend(pendingSuspend)}
      >
        <p className="cx-small">{pendingSuspend ? `${name(pendingSuspend)} ne pourra plus se connecter tant que son compte est suspendu. Ses sessions sont fermées.` : ""}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={pendingReset !== null}
        title="Réinitialiser le mot de passe ?"
        confirmLabel="Réinitialiser"
        tone="danger"
        busy={pendingReset !== null && action.busy === `reset:${pendingReset.id}`}
        onCancel={() => setPendingReset(null)}
        onConfirm={() => reset(pendingReset)}
      >
        <p className="cx-small">{pendingReset ? `Un nouveau mot de passe provisoire sera généré pour ${name(pendingReset)}. L'ancien ne fonctionnera plus.` : ""}</p>
      </ConfirmDialog>
    </div>
  );
}

function CreateMember({ roles, onCreated }) {
  const { request } = useAuth();
  const [form, setForm] = useState({ email: "", firstName: "", lastName: "", phone: "" });
  const [roleCodes, setRoleCodes] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function toggleRole(code) {
    setRoleCodes((current) => (current.includes(code) ? current.filter((c) => c !== code) : [...current, code]));
  }

  async function submit(event) {
    event.preventDefault();
    if (roleCodes.length === 0) {
      setError("Choisissez au moins un rôle.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await request("/users", {
        method: "POST",
        body: { email: form.email.trim(), firstName: form.firstName.trim(), lastName: form.lastName.trim(), phone: form.phone.trim() || undefined, roleCodes },
      });
      onCreated(data?.temporaryPassword ?? "", form.email.trim());
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-6 grid gap-4 rounded-lg border border-[var(--comexa-border-soft)] p-5 md:grid-cols-2">
      {error ? <div className="md:col-span-2"><Notice>{error}</Notice></div> : null}
      <Field id="new-email" label="E-mail *">
        <input id="new-email" type="email" required className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      <Field id="new-phone" label="Téléphone">
        <input id="new-phone" className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </Field>
      <Field id="new-first" label="Prénom *">
        <input id="new-first" required className={inputClass} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
      </Field>
      <Field id="new-last" label="Nom *">
        <input id="new-last" required className={inputClass} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
      </Field>
      <fieldset className="flex flex-col gap-2 md:col-span-2">
        <legend className="cx-label">Rôles *</legend>
        <div className="flex flex-wrap gap-4">
          {roles.map((role) => (
            <label key={role.code} className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={roleCodes.includes(role.code)} onChange={() => toggleRole(role.code)} />
              {ROLE_LABEL[role.code] ?? role.name ?? role.code}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="md:col-span-2">
        <button type="submit" disabled={busy} className={primaryButton}>{busy ? "Création…" : "Créer le compte"}</button>
      </div>
    </form>
  );
}

function EditRoles({ user, roles, onClose, onSaved }) {
  const { request } = useAuth();
  const [selected, setSelected] = useState(() => (user.roles ?? []).map(roleCode));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function toggle(code) {
    setSelected((current) => (current.includes(code) ? current.filter((c) => c !== code) : [...current, code]));
  }

  async function save() {
    if (selected.length === 0) {
      setError("Un compte doit garder au moins un rôle.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request(`/users/${user.id}/roles`, { method: "POST", body: { roleCodes: selected } });
      await onSaved();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`Rôles de ${user.firstName} ${user.lastName}`}>
      {error ? <Notice>{error}</Notice> : null}
      <div className="mb-5 flex flex-wrap gap-4">
        {roles.map((role) => (
          <label key={role.code} className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={selected.includes(role.code)} onChange={() => toggle(role.code)} />
            {ROLE_LABEL[role.code] ?? role.name ?? role.code}
          </label>
        ))}
      </div>
      <div className="flex gap-3">
        <button type="button" className={primaryButton} onClick={save} disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer les rôles"}</button>
        <button type="button" className={secondaryButton} onClick={onClose}>Annuler</button>
      </div>
    </Card>
  );
}
