"use client";

import { useEffect, useState } from "react";
import { KeyRound, Phone, Plus, Shield, UserCheck, UserX, Users } from "lucide-react";
import { formatDate, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useAction, useListing } from "@/lib/use-listing";
import {
  Badge,
  Card,
  ConfirmDialog,
  Empty,
  Field,
  Notice,
  Pagination,
  SideSheet,
  SkeletonList,
  inputClass,
  primaryButton,
  secondaryButton,
  selectClass,
} from "@/components/workspace/ui";
import { UserAvatar } from "@/components/workspace/UserAvatar";
import { useShellQuery } from "@/components/softui/Shell";

const USER_STATUS = { INVITED: "Invité", ACTIVE: "Actif", SUSPENDED: "Suspendu", ARCHIVED: "Archivé" };
const USER_STATUS_TONE = { INVITED: "info", ACTIVE: "success", SUSPENDED: "warning", ARCHIVED: "neutral" };
/**
 * Tri de l'annuaire : les comptes ACTIFS en haut de la liste, les SUSPENDUS
 * tout en bas. Même règle que le backend (`backend/src/modules/users/
 * member-order.ts`) : reprise ici pour que l'ordre affiché reste correct même
 * face a une version anterieure de l'API, et a statut egal on retrouve
 * l'ordre alphabetique nom puis prenom.
 */
const USER_STATUS_ORDER = { ACTIVE: 0, INVITED: 1, ARCHIVED: 2, SUSPENDED: 3 };

function byStatusThenName(a, b) {
  const byStatus = (USER_STATUS_ORDER[a.status] ?? 4) - (USER_STATUS_ORDER[b.status] ?? 4);
  if (byStatus !== 0) return byStatus;
  const byLast = String(a.lastName ?? "").localeCompare(String(b.lastName ?? ""), "fr", { sensitivity: "base" });
  if (byLast !== 0) return byLast;
  return String(a.firstName ?? "").localeCompare(String(b.firstName ?? ""), "fr", { sensitivity: "base" });
}
const ROLE_LABEL = {
  ADMIN: "Administrateur",
  COMMUNICATION_MANAGER: "Gérant communication",
  PROJECT_MANAGER: "Chef de projet",
  DEVELOPER: "Développeur",
  SOCIAL_MEDIA_MANAGER: "Gestion réseaux sociaux",
  SALES: "Commercial",
  CLIENT: "Client",
};

function roleCode(role) {
  return typeof role === "string" ? role : role?.code;
}

export default function MembresPage() {
  const { user, request } = useAuth();
  const { query: shellQuery } = useShellQuery();
  const canManageMembers = can(user, "user:manage:any");
  const canReadRoles = can(user, "role:read:any");

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(1);

  const effectiveQuery = (shellQuery || query).trim();
  const path = `/users?page=${page}&perPage=100${effectiveQuery ? `&search=${encodeURIComponent(effectiveQuery)}` : ""}${status ? `&status=${status}` : ""}${roleFilter ? `&roleCode=${roleFilter}` : ""}`;
  const users = useListing(path);
  const action = useAction(users.reload);
  const [roles, setRoles] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editingRoles, setEditingRoles] = useState(null);
  const [pendingSuspend, setPendingSuspend] = useState(null);
  const [pendingReset, setPendingReset] = useState(null);
  const [revealed, setRevealed] = useState(null);
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

  const items = [...(users.items ?? [])].sort(byStatusThenName);
  const name = (member) => `${member.firstName} ${member.lastName}`;

  async function suspend(member) {
    const result = await action.run(`suspend:${member.id}`, `/users/${member.id}/suspend`, { method: "POST" }, `${name(member)} est suspendu.`);
    if (result !== null) setPendingSuspend(null);
  }

  async function reset(member) {
    const result = await action.run(`reset:${member.id}`, `/users/${member.id}/reset-password`, { method: "POST" }, null);
    if (result !== null) {
      setPendingReset(null);
      setRevealed({ title: "Mot de passe réinitialisé", email: member.email, password: result?.data?.temporaryPassword ?? result?.temporaryPassword ?? "" });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {users.error ? <Notice>{users.error}</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}
      {revealed ? (
        <Notice tone="warning">
          <strong>{revealed.title} pour {revealed.email}.</strong> Mot de passe provisoire, affiché une seule fois :{" "}
          <code className="rounded bg-white px-2 py-0.5 font-mono text-sm font-bold">{revealed.password || "(non renvoyé)"}</code>
          <span className="mt-2 block">
            <button type="button" className={secondaryButton} onClick={() => setRevealed(null)}>Fermer</button>
          </span>
        </Notice>
      ) : null}

      <Card
        title="Membres et droits"
        subtitle="Gérez les comptes de l’équipe, leurs rôles RBAC et leurs accès."
        action={
          canManageMembers ? (
            <button type="button" className={primaryButton} onClick={() => setCreating(true)} data-coach-id="membre-invite-button">
              <Plus size={15} /> Ajouter un membre
            </button>
          ) : null
        }
      >
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

        {users.items === null && !users.error ? <SkeletonList rows={4} /> : null}
        {users.items !== null && items.length === 0 ? <Empty icon={Users}>Aucun membre pour ces critères.</Empty> : null}

        <ul className="flex flex-col gap-3">
          {items.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--comexa-border-soft)] bg-white p-4 transition hover:border-[rgba(30,134,224,0.25)]">
              <div className="flex min-w-0 items-start gap-3">
                <UserAvatar profile={member} initialsOnly size={40} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[15.5px] font-bold text-[var(--comexa-ink)]">{name(member)}</h3>
                    <Badge tone={USER_STATUS_TONE[member.status] ?? "neutral"}>{USER_STATUS[member.status] ?? member.status}</Badge>
                  </div>
                  <p className="text-[13px] text-[var(--comexa-ink-soft)]">{member.email}</p>
                  {member.phone ? (
                    <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-[var(--comexa-ink-soft)]">
                      <Phone size={13} className="text-[var(--comexa-ink-muted)]" aria-hidden="true" />
                      <a href={`tel:${member.phone}`} className="cx-tabular hover:text-[var(--comexa-accent-strong)] hover:underline">
                        {member.phone}
                      </a>
                    </p>
                  ) : null}
                  <p className="mt-1.5 flex flex-wrap gap-1.5">
                    {(member.roles ?? []).map((role) => (
                      <Badge key={roleCode(role)} tone="info">{ROLE_LABEL[roleCode(role)] ?? roleCode(role)}</Badge>
                    ))}
                    {member.mustChangePassword ? <Badge tone="warning">Mot de passe à changer</Badge> : null}
                  </p>
                  {member.lastLoginAt ? <p className="mt-1 text-[12px] text-[var(--comexa-ink-muted)]">Dernière connexion : {formatDate(member.lastLoginAt)}</p> : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canManageMembers ? (
                  <>
                    {canReadRoles ? (
                      <button type="button" className={secondaryButton} onClick={() => setEditingRoles(member)}>
                        <Shield size={14} /> Rôles
                      </button>
                    ) : null}
                    <button type="button" className={secondaryButton} onClick={() => setPendingReset(member)} disabled={Boolean(action.busy)}>
                      <KeyRound size={14} /> Réinitialiser MDP
                    </button>
                    {member.status === "ACTIVE" ? (
                      <button type="button" className={secondaryButton} onClick={() => setPendingSuspend(member)} disabled={Boolean(action.busy)}>
                        <UserX size={14} /> Suspendre
                      </button>
                    ) : null}
                    {member.status === "SUSPENDED" ? (
                      <button
                        type="button"
                        className={secondaryButton}
                        onClick={() => action.run(`reactivate:${member.id}`, `/users/${member.id}/reactivate`, { method: "POST" }, `${name(member)} est réactivé.`)}
                        disabled={Boolean(action.busy)}
                      >
                        <UserCheck size={14} /> Réactiver
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

      <SideSheet
        open={creating && canManageMembers}
        onClose={() => setCreating(false)}
        title="Nouveau membre de l’équipe"
        subtitle="Un mot de passe provisoire sera généré automatiquement."
      >
        {canReadRoles ? (
          <CreateMember
            roles={roles}
            onCancel={() => setCreating(false)}
            onCreated={(password, email) => {
              setCreating(false);
              setPage(1);
              setRevealed({ title: "Compte créé", email, password });
              users.reload();
            }}
          />
        ) : (
          <Notice>Votre rôle ne permet pas de consulter les rôles nécessaires pour créer un compte.</Notice>
        )}
      </SideSheet>

      <SideSheet
        open={Boolean(editingRoles && canManageMembers && canReadRoles)}
        onClose={() => setEditingRoles(null)}
        title={editingRoles ? `Rôles de ${editingRoles.firstName} ${editingRoles.lastName}` : "Rôles"}
        subtitle="Sélectionnez les rôles accordés à ce collaborateur."
      >
        {editingRoles ? (
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
      </SideSheet>

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

function CreateMember({ roles, onCancel, onCreated }) {
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
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {error ? <div className="sm:col-span-2"><Notice>{error}</Notice></div> : null}
      <Field id="new-first" label="Prénom *">
        <input id="new-first" required className={inputClass} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
      </Field>
      <Field id="new-last" label="Nom *">
        <input id="new-last" required className={inputClass} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
      </Field>
      <div className="sm:col-span-2">
        <Field id="new-email" label="E-mail professionnel *">
          <input id="new-email" type="email" required className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field id="new-phone" label="Téléphone">
          <input id="new-phone" className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2 sm:col-span-2" data-coach-id="membre-form-role">
        <legend className="cx-label">Rôles attribués *</legend>
        <div className="flex flex-wrap gap-2">
          {roles.map((role) => (
            <label key={role.code} className="flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--comexa-border)] bg-white px-3 py-2 text-[13.5px] font-medium">
              <input type="checkbox" checked={roleCodes.includes(role.code)} onChange={() => toggleRole(role.code)} />
              {ROLE_LABEL[role.code] ?? role.name ?? role.code}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
        <button type="button" onClick={onCancel} className={secondaryButton}>Annuler</button>
        <button type="submit" disabled={busy} className={primaryButton} data-coach-id="membre-form-submit">{busy ? "Création…" : "Créer le compte"}</button>
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
    <div className="flex flex-col gap-4">
      {error ? <Notice>{error}</Notice> : null}
      <div className="flex flex-col gap-2">
        {roles.map((role) => (
          <label key={role.code} className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--comexa-border)] bg-white p-3 text-[14px] font-medium">
            <input type="checkbox" checked={selected.includes(role.code)} onChange={() => toggle(role.code)} />
            <span>{ROLE_LABEL[role.code] ?? role.name ?? role.code}</span>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className={secondaryButton} onClick={onClose}>Annuler</button>
        <button type="button" className={primaryButton} onClick={save} disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer les rôles"}</button>
      </div>
    </div>
  );
}
