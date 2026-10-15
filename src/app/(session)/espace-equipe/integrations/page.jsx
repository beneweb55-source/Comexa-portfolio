"use client";

import { useMemo, useState } from "react";
import { messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import {
  Badge,
  Card,
  ConfirmDialog,
  Empty,
  Field,
  Notice,
  Pagination,
  inputClass,
  primaryButton,
  secondaryButton,
  selectClass,
} from "@/components/workspace/ui";

const INTEGRATION_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
/**
 * Les deux seuls droits qu'un jeton ne peut JAMAIS porter (côté backend :
 * `INTEGRATION_MANAGED_CODES`). Une machine ne consulte pas la liste des
 * intégrations — ce serait le plan de vol d'un attaquant — et ne distribue pas
 * d'accès : un jeton volé ne doit pas pouvoir s'en créer d'autres.
 *
 * Ils sont donc retirés du catalogue proposé, et non seulement de l'accès
 * complet : les cocher ferait échouer la création côté serveur.
 */
const RESERVED_SCOPES = ["integration:read:any", "integration:manage:any"];
const MACHINE_API_BASE = "/api/v1";
const BEARER_EXAMPLE = "Authorization: Bearer cxi_...";

const N8N_PILOT_PRESET = [
  "project:read:any",
  "task:read:any",
  "task:write:any",
  "task:assign:any",
  "calendar:read:own",
  "calendar:write:own",
  "calendar:read:team",
  "calendar:manage:any",
];

const RESOURCE_LABEL = {
  user: "Comptes",
  role: "Rôles",
  permission: "Permissions",
  audit: "Journal d’audit",
  integration: "API & Intégrations",
  telegram: "Telegram",
  prospect: "Prospects",
  client: "Clients",
  contact: "Contacts",
  project: "Projets",
  milestone: "Jalons",
  task: "Tâches",
  time: "Temps",
  activity: "Activité",
  calendar: "Calendrier",
  quote: "Devis",
  order: "Commandes",
  project_request: "Demandes de projet",
  invoice: "Factures",
  payment: "Paiements",
  conversation: "Conversations",
  message: "Messages",
  notification: "Notifications",
  document: "Documents",
  report: "Rapports",
  dashboard: "Tableau de bord",
  service: "Services",
  package: "Packs",
  casestudy: "Études de cas",
  testimonial: "Témoignages",
  partner: "Partenaires",
  faq: "FAQ",
  contactrequest: "Demandes de contact",
  modificationrequest: "Demandes de modification",
  setting: "Paramètres",
};

/**
 * Accès complet agence : TOUTES les permissions attribuables du catalogue.
 *
 * Il n'y a plus de plafond côté interface parce qu'il n'y en a plus de utile
 * côté serveur : le catalogue compte un peu plus de cent droits, et une
 * intégration d'agence qui pilote projets, tâches, agenda, CRM et facturation
 * en une seule connexion doit pouvoir tous les porter. Seuls les deux droits
 * réservés aux humains sont écartés.
 */
function fullAgencyPreset(allowedPermissions) {
  const codes = allowedPermissions
    .filter((permission) => !RESERVED_SCOPES.includes(permission.code))
    .map((permission) => permission.code);
  return [...new Set(codes)].sort();
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return DATE_TIME_FORMATTER.format(date);
}

function statusOf(token) {
  if (token.revokedAt) return { label: "Révoqué", tone: "danger" };
  if (!token.active) return { label: "Expiré", tone: "warning" };
  return { label: "Actif", tone: "success" };
}

function expirationPayload(choice, customDays) {
  if (choice === "never") return { value: {}, label: "sans expiration" };
  const days = Number(choice === "custom" ? customDays : choice);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    return { error: "Saisissez une durée entière comprise entre 1 et 3 650 jours." };
  }
  return { value: { expiresInDays: days }, label: `${days} jour${days > 1 ? "s" : ""}` };
}

/**
 * Tous les droits attribuables du catalogue, triés.
 *
 * C'est la matière de l'« accès complet agence » : le catalogue renvoyé par
 * `GET /permissions`, moins les deux droits réservés. Rien n'est tronqué — la
 * sélection est le catalogue, pas un extrait.
 */
function assignableScopesOf(permissions) {
  return [
    ...new Set((permissions ?? []).filter((permission) => !RESERVED_SCOPES.includes(permission.code)).map((permission) => permission.code)),
  ].sort();
}

/**
 * Expiration restante d'un jeton, exprimée en jours à partir de maintenant.
 *
 * L'accorder en un clic ne doit pas transformer un jeton sans expiration en
 * jeton périmé, ni raccourcir une échéance déjà fixée : on reconduit ce qui
 * restait, et on garde l'absence d'échéance telle quelle.
 */
function remainingExpiration(token) {
  const expiresAt = token?.expiresAt ? new Date(token.expiresAt).getTime() : null;
  if (!expiresAt || !Number.isFinite(expiresAt)) return { value: {}, label: "sans expiration" };

  const days = Math.max(1, Math.min(3650, Math.ceil((expiresAt - Date.now()) / 86_400_000)));
  return { value: { expiresInDays: days }, label: `échéance reconduite de ${days} jour${days > 1 ? "s" : ""}` };
}

function initialRenewalExpiration(token) {
  if (!token.expiresAt) return { choice: "never", customDays: "90" };

  const createdAt = new Date(token.createdAt).getTime();
  const expiresAt = new Date(token.expiresAt).getTime();
  const originalDays = Math.round((expiresAt - createdAt) / 86_400_000);
  const preset = [30, 90, 180, 365].includes(originalDays) ? String(originalDays) : "custom";
  return {
    choice: preset,
    customDays: Number.isInteger(originalDays) && originalDays >= 1 && originalDays <= 3650 ? String(originalDays) : "90",
  };
}

/** Copie avec un repli pour les navigateurs où l'API Clipboard n'est pas disponible. */
async function copyToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy-failed");
}

function CopyButton({ value, label = "Copier", copiedLabel = "Copié" }) {
  const [state, setState] = useState("idle");

  async function copy() {
    try {
      await copyToClipboard(value);
      setState("copied");
    } catch {
      setState("error");
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" className={secondaryButton} onClick={copy}>
        {state === "copied" ? copiedLabel : label}
      </button>
      {state === "error" ? <span className="text-[12px] text-[var(--comexa-error)]">Copie impossible.</span> : null}
    </span>
  );
}

function ApiInformationBanner() {
  return (
    <Notice tone="info">
      <div className="flex w-full flex-col gap-4">
        <div>
          <strong className="text-[var(--comexa-ink)]">Connexion des applications et agents</strong>
          <p className="mt-1 text-[14px]">
            Utilisez le préfixe versionné pour les appels machine et transmettez toujours le jeton dans l’en-tête HTTP.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)] p-3">
            <span>
              <span className="block text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--comexa-ink-muted)]">URL de base machine</span>
              <code className="break-all text-[14px] font-semibold text-[var(--comexa-ink)]">{MACHINE_API_BASE}</code>
            </span>
            <CopyButton value={MACHINE_API_BASE} label="Copier l’URL" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)] p-3">
            <span>
              <span className="block text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--comexa-ink-muted)]">En-tête d’authentification</span>
              <code className="break-all text-[14px] font-semibold text-[var(--comexa-ink)]">{BEARER_EXAMPLE}</code>
            </span>
            <CopyButton value={BEARER_EXAMPLE} />
          </div>
        </div>
      </div>
    </Notice>
  );
}

function SecretReveal({ revealed, onClose }) {
  const bearer = `Authorization: Bearer ${revealed.secret}`;

  return (
    <Card
      title={revealed.kind === "created" ? `Secret créé : ${revealed.name}` : `Nouveau secret : ${revealed.name}`}
      action={
        <button type="button" className={secondaryButton} onClick={onClose}>
          Fermer et effacer
        </button>
      }
    >
      <div aria-live="assertive" className="flex flex-col gap-4">
        <Notice tone="warning">
          <strong>Copiez ce secret maintenant.</strong> Il ne sera plus jamais réaffiché après la fermeture de cet encart. Comexa n’en conserve que l’empreinte.
        </Notice>
        <div className="rounded-lg border-2 border-[var(--comexa-accent-strong)] bg-[var(--comexa-accent-soft)] p-4">
          <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--comexa-ink-muted)]">Secret complet</span>
          <code className="block break-all text-[15px] font-semibold text-[var(--comexa-ink)]">{revealed.secret}</code>
        </div>
        <div className="flex flex-wrap gap-3">
          <CopyButton value={revealed.secret} label="Copier le jeton cxi_…" copiedLabel="Jeton copié" />
          <CopyButton value={bearer} label="Copier `Bearer cxi_…`" copiedLabel="En-tête copié" />
        </div>
      </div>
    </Card>
  );
}

function ExpirationFields({ idPrefix, choice, customDays, onChoiceChange, onCustomDaysChange, error }) {
  return (
    <div className={choice === "custom" ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
      <Field id={`${idPrefix}-expiration`} label="Durée de validité" hint="Une expiration limite l’impact d’un jeton oublié.">
        <select
          id={`${idPrefix}-expiration`}
          className={selectClass}
          value={choice}
          onChange={(event) => onChoiceChange(event.target.value)}
        >
          <option value="30">30 jours</option>
          <option value="90">90 jours</option>
          <option value="180">180 jours</option>
          <option value="365">365 jours</option>
          <option value="custom">Durée personnalisée</option>
          <option value="never">Sans expiration</option>
        </select>
      </Field>
      {choice === "custom" ? (
        <Field id={`${idPrefix}-custom-days`} label="Nombre de jours" error={error} hint="Entre 1 et 3 650 jours.">
          <input
            id={`${idPrefix}-custom-days`}
            type="number"
            min="1"
            max="3650"
            step="1"
            inputMode="numeric"
            className={inputClass}
            value={customDays}
            aria-invalid={Boolean(error)}
            onChange={(event) => onCustomDaysChange(event.target.value)}
          />
        </Field>
      ) : null}
    </div>
  );
}

function readOnlyPreset(permissions) {
  const readable = permissions.filter(
    (permission) => permission.action === "read" && !RESERVED_SCOPES.includes(permission.code),
  );
  const resourcesWithAny = new Set(readable.filter((permission) => permission.scope === "any").map((permission) => permission.resource));
  return readable
    .filter((permission) => permission.scope === "any" || !resourcesWithAny.has(permission.resource))
    .map((permission) => permission.code);
}

function PermissionPicker({ idPrefix, permissions, selected, onChange }) {
  const allowedPermissions = useMemo(
    () => permissions.filter((permission) => !RESERVED_SCOPES.includes(permission.code)),
    [permissions],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const availableCodes = useMemo(() => new Set(allowedPermissions.map((permission) => permission.code)), [allowedPermissions]);
  const unavailableSelected = selected.filter((code) => !availableCodes.has(code));

  const groups = useMemo(() => {
    const map = new Map();
    for (const permission of allowedPermissions) {
      const resource = permission.resource || permission.code.split(":")[0];
      if (!map.has(resource)) map.set(resource, []);
      map.get(resource).push(permission);
    }
    return [...map.entries()].sort(([left], [right]) =>
      (RESOURCE_LABEL[left] ?? left).localeCompare(RESOURCE_LABEL[right] ?? right, "fr"),
    );
  }, [allowedPermissions]);

  function applyPreset(codes) {
    const next = codes.filter((code) => availableCodes.has(code));
    onChange([...new Set(next)].sort());
  }

  function toggle(code) {
    if (selectedSet.has(code)) {
      onChange(selected.filter((selectedCode) => selectedCode !== code));
      return;
    }
    onChange([...selected, code].sort());
  }

  /** Tout cocher / tout décocher, groupe de ressources par groupe. */
  function toggleGroup(codes, checked) {
    const next = new Set(selected);
    for (const code of codes) {
      if (checked) next.add(code);
      else next.delete(code);
    }
    onChange([...next].sort());
  }

  const fullAccess = useMemo(() => fullAgencyPreset(allowedPermissions), [allowedPermissions]);
  const isFullAccess = selected.length === fullAccess.length && fullAccess.every((code) => selectedSet.has(code));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="cx-label">Profils de permissions</span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={primaryButton}
            onClick={() => applyPreset(fullAccess)}
            aria-pressed={isFullAccess}
          >
            Accès complet agence (toutes les permissions)
          </button>
          <button type="button" className={secondaryButton} onClick={() => applyPreset(N8N_PILOT_PRESET)}>
            Pilotage projets, tâches et calendrier
          </button>
          <button type="button" className={secondaryButton} onClick={() => applyPreset(readOnlyPreset(allowedPermissions))}>
            Lecture seule
          </button>
          <button type="button" className={secondaryButton} onClick={() => onChange([])} disabled={selected.length === 0}>
            Aucun droit
          </button>
        </div>
        <p className="cx-hint">
          {selected.length} permission{selected.length > 1 ? "s" : ""} sélectionnée{selected.length > 1 ? "s" : ""} sur{" "}
          {allowedPermissions.length} attribuables{isFullAccess ? " · accès complet agence actif" : ""}.
        </p>
      </div>

      {unavailableSelected.length > 0 ? (
        <Notice tone="warning">
          Certaines permissions actuelles ne sont plus proposées par le catalogue : {unavailableSelected.join(", ")}.
        </Notice>
      ) : null}

      <div>
        <span className="cx-label">Sélection fine par ressource</span>
        {groups.length === 0 ? <Empty>Le catalogue ne contient aucune permission attribuable.</Empty> : null}
        <div className="grid gap-3 lg:grid-cols-2">
          {groups.map(([resource, resourcePermissions]) => {
            const groupCodes = resourcePermissions.map((permission) => permission.code);
            const selectedInGroup = groupCodes.filter((code) => selectedSet.has(code)).length;
            const allSelected = selectedInGroup === groupCodes.length;
            const groupLabel = RESOURCE_LABEL[resource] ?? resource;
            return (
              <details key={resource} className="rounded-lg border border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)] p-4" open={selectedInGroup > 0}>
                <summary className="flex cursor-pointer items-center justify-between gap-3 font-semibold text-[var(--comexa-ink)]">
                  <span>
                    {groupLabel}
                    <span className="ml-2 text-[12px] font-normal text-[var(--comexa-ink-muted)]">{selectedInGroup}/{groupCodes.length}</span>
                  </span>
                </summary>
                <fieldset className="mt-3 flex flex-col gap-3">
                  <legend className="sr-only">Permissions pour {groupLabel}</legend>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--comexa-border-soft)] pb-3">
                    <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--comexa-ink-muted)]">
                      {groupCodes.length} droit{groupCodes.length > 1 ? "s" : ""}
                    </span>
                    <button
                      type="button"
                      className={secondaryButton}
                      onClick={() => toggleGroup(groupCodes, !allSelected)}
                      aria-pressed={allSelected}
                      title={`${allSelected ? "Décocher" : "Cocher"} les ${groupCodes.length} droits ${groupLabel}`}
                    >
                      {allSelected ? "Tout décocher" : "Tout cocher"}
                    </button>
                  </div>
                  {resourcePermissions.map((permission) => {
                    const checked = selectedSet.has(permission.code);
                    const id = `${idPrefix}-${permission.code.replaceAll(":", "-")}`;
                    return (
                      <label key={permission.code} htmlFor={id} className="flex cursor-pointer items-start gap-3 text-[13.5px]">
                        <input
                          id={id}
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-[var(--comexa-accent-strong)]"
                          checked={checked}
                          onChange={() => toggle(permission.code)}
                        />
                        <span className="min-w-0">
                          <code className="break-all text-[12.5px] font-semibold text-[var(--comexa-ink)]">{permission.code}</code>
                          {permission.description ? <span className="block text-[var(--comexa-ink-soft)]">{permission.description}</span> : null}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              </details>
            );
          })}
        </div>
        <p className="cx-hint">
          Les droits <code>{RESERVED_SCOPES[0]}</code> et <code>{RESERVED_SCOPES[1]}</code> sont volontairement exclus du
          catalogue : un jeton machine ne peut ni consulter la liste des intégrations ni distribuer d’autres accès.
        </p>
      </div>
    </div>
  );
}

function CreateTokenForm({ permissions, busy, onCreate }) {
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [scopes, setScopes] = useState([]);
  const [expirationChoice, setExpirationChoice] = useState("90");
  const [customDays, setCustomDays] = useState("90");
  const [expirationError, setExpirationError] = useState(null);
  const normalizedName = name.trim();
  const nameError = nameTouched && !INTEGRATION_NAME_PATTERN.test(normalizedName)
    ? "Utilisez 3 à 40 caractères : minuscules, chiffres et tirets, sans tiret au début ni à la fin."
    : null;

  async function submit(event) {
    event.preventDefault();
    setNameTouched(true);
    const expiration = expirationPayload(expirationChoice, customDays);
    setExpirationError(expiration.error ?? null);
    if (!INTEGRATION_NAME_PATTERN.test(normalizedName) || expiration.error) return;

    const created = await onCreate({ name: normalizedName, scopes, ...expiration.value });
    if (!created) return;
    setName("");
    setNameTouched(false);
    setScopes([]);
    setExpirationChoice("90");
    setCustomDays("90");
    setExpirationError(null);
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
      <div className="grid gap-4 lg:grid-cols-2">
        <Field
          id="integration-name"
          label="Nom technique"
          error={nameError}
          hint="3 à 40 caractères, par exemple n8n-agent-pilote."
        >
          <input
            id="integration-name"
            name="name"
            className={inputClass}
            value={name}
            minLength={3}
            maxLength={40}
            pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]"
            placeholder="n8n-agent-pilote"
            autoComplete="off"
            spellCheck="false"
            aria-invalid={Boolean(nameError)}
            onBlur={() => setNameTouched(true)}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <ExpirationFields
          idPrefix="create-token"
          choice={expirationChoice}
          customDays={customDays}
          onChoiceChange={(value) => {
            setExpirationChoice(value);
            setExpirationError(null);
          }}
          onCustomDaysChange={(value) => {
            setCustomDays(value);
            setExpirationError(null);
          }}
          error={expirationError}
        />
      </div>

      <PermissionPicker idPrefix="create-scope" permissions={permissions} selected={scopes} onChange={setScopes} />

      <div>
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy ? "Création…" : "Créer le jeton"}
        </button>
      </div>
    </form>
  );
}

function RenewTokenEditor({ token, permissions, catalogueAvailable, onCancel, onPrepare }) {
  const initialExpiration = initialRenewalExpiration(token);
  const [scopes, setScopes] = useState(() => [...(token.scopes ?? [])]);
  const [expirationChoice, setExpirationChoice] = useState(initialExpiration.choice);
  const [customDays, setCustomDays] = useState(initialExpiration.customDays);
  const [expirationError, setExpirationError] = useState(null);

  function prepare(event) {
    event.preventDefault();
    const expiration = expirationPayload(expirationChoice, customDays);
    setExpirationError(expiration.error ?? null);
    if (expiration.error) return;
    onPrepare({ scopes, ...expiration.value }, expiration.label);
  }

  return (
    <Card
      title={`Modifier et renouveler : ${token.name}`}
      action={
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Fermer
        </button>
      }
    >
      <form className="flex flex-col gap-6" onSubmit={prepare}>
        <Notice tone="warning">
          Le renouvellement génère un nouveau secret et invalide immédiatement l’ancien. Le nouveau secret ne sera affiché qu’une fois.
        </Notice>
        <ExpirationFields
          idPrefix={`renew-${token.id}`}
          choice={expirationChoice}
          customDays={customDays}
          onChoiceChange={(value) => {
            setExpirationChoice(value);
            setExpirationError(null);
          }}
          onCustomDaysChange={(value) => {
            setCustomDays(value);
            setExpirationError(null);
          }}
          error={expirationError}
        />
        {catalogueAvailable ? (
          <PermissionPicker idPrefix={`renew-scope-${token.id}`} permissions={permissions} selected={scopes} onChange={setScopes} />
        ) : (
          <Notice tone="info">Le catalogue des permissions n’est pas accessible. Le renouvellement conservera les droits actuels.</Notice>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={primaryButton}>
            Vérifier et renouveler le secret
          </button>
          <button type="button" className={secondaryButton} onClick={onCancel}>
            Annuler
          </button>
        </div>
      </form>
    </Card>
  );
}

function TokenItem({ token, descriptions, canManage, canGrantAll, busy, editing, onEdit, onGrantAll, onRevoke, onDelete }) {
  const status = statusOf(token);

  return (
    <li className="rounded-lg border border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] font-semibold text-[var(--comexa-ink)]">{token.name}</h3>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <code className="mt-1 block break-all text-[13px] text-[var(--comexa-ink-muted)]">{token.prefix}…</code>
        </div>
        {canManage ? (
          <div className="flex max-w-full flex-wrap gap-2">
            <button
              type="button"
              className={primaryButton}
              onClick={onGrantAll}
              disabled={busy || !canGrantAll}
              title={
                canGrantAll
                  ? "Attribuer toutes les permissions attribuables du catalogue et renouveler le secret"
                  : "Le catalogue des permissions doit être chargé pour accorder tous les droits"
              }
            >
              Accorder toutes les permissions &amp; renouveler
            </button>
            <button type="button" className={secondaryButton} onClick={onEdit} disabled={busy} aria-pressed={editing}>
              Modifier les droits / Renouveler le secret
            </button>
            <button type="button" className={secondaryButton} onClick={onRevoke} disabled={busy || Boolean(token.revokedAt)}>
              Révoquer
            </button>
            <button type="button" className={secondaryButton} onClick={onDelete} disabled={busy}>
              Supprimer
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-4">
        <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--comexa-ink-muted)]">Permissions accordées</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {(token.scopes ?? []).length === 0 ? <Badge tone="neutral">Aucun droit</Badge> : null}
          {(token.scopes ?? []).map((scope) => (
            <span key={scope} title={descriptions[scope] ?? scope}>
              <Badge tone="info">{scope}</Badge>
            </span>
          ))}
        </div>
      </div>

      <dl className="mt-5 grid gap-3 border-t border-[var(--comexa-border-soft)] pt-4 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="text-[var(--comexa-ink-muted)]">Création</dt>
          <dd className="font-medium text-[var(--comexa-ink)]">{formatDateTime(token.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-[var(--comexa-ink-muted)]">Expiration</dt>
          <dd className="font-medium text-[var(--comexa-ink)]">{token.expiresAt ? formatDateTime(token.expiresAt) : "Sans expiration"}</dd>
        </div>
        <div>
          <dt className="text-[var(--comexa-ink-muted)]">Dernière utilisation</dt>
          <dd className="font-medium text-[var(--comexa-ink)]">{token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "Jamais utilisé"}</dd>
        </div>
        <div>
          <dt className="text-[var(--comexa-ink-muted)]">Révocation</dt>
          <dd className="font-medium text-[var(--comexa-ink)]">{token.revokedAt ? formatDateTime(token.revokedAt) : "—"}</dd>
        </div>
      </dl>
    </li>
  );
}

export default function IntegrationsPage() {
  const { user, request } = useAuth();
  const canReadTokens = can(user, "integration:read:any");
  const canManageTokens = can(user, "integration:manage:any");
  const canReadPermissions = can(user, "permission:read:any");
  const [page, setPage] = useState(1);
  const tokens = useListing(canReadTokens ? `/integrations/tokens?page=${page}&perPage=20` : null);
  const catalogue = useListing(canManageTokens && canReadPermissions ? "/permissions" : null);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [revealedSecret, setRevealedSecret] = useState(null);
  const [editingToken, setEditingToken] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);

  const permissionDescriptions = useMemo(
    () => Object.fromEntries((catalogue.items ?? []).map((permission) => [permission.code, permission.description])),
    [catalogue.items],
  );

  /** Accès complet agence, calculé une fois sur le catalogue réel. */
  const assignableScopes = useMemo(() => assignableScopesOf(catalogue.items), [catalogue.items]);

  async function reloadFirstPage() {
    if (!canReadTokens) return;
    if (page === 1) await tokens.reload();
    else setPage(1);
  }

  async function createToken(payload) {
    setBusy("create");
    setActionError(null);
    setActionSuccess(null);
    setRevealedSecret(null);
    try {
      const { data } = await request("/integrations/tokens", { method: "POST", body: payload });
      if (typeof data?.secret !== "string" || !data.secret.startsWith("cxi_")) {
        setActionError("Le serveur n’a pas renvoyé le secret attendu. Ne relancez pas la création avant d’avoir vérifié la liste des jetons.");
        return false;
      }
      setRevealedSecret({
        kind: "created",
        tokenId: data.token?.id ?? null,
        name: data.token?.name ?? payload.name,
        secret: data.secret,
      });
      setActionSuccess(`Le jeton « ${data.token?.name ?? payload.name} » a été créé.`);
      await reloadFirstPage();
      return true;
    } catch (caught) {
      setActionError(messageOf(caught));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function openConfirmation(action) {
    setActionError(null);
    setActionSuccess(null);
    setPendingAction(action);
  }

  /**
   * Un clic : toutes les permissions attribuables, puis renouvellement.
   *
   * L'échéance est reconduite telle quelle (ou absente si le jeton n'en a pas)
   * pour que l'opération n'ajoute pas une contrainte que personne n'a décidée.
   */
  function grantEverythingAndRenew(token) {
    if (!canGrantAll) return;
    const expiration = remainingExpiration(token);
    openConfirmation({
      type: "renew",
      token,
      payload: { scopes: assignableScopes, ...expiration.value },
      expirationLabel: expiration.label,
    });
  }

  async function confirmPendingAction() {
    if (!pendingAction) return;
    const current = pendingAction;
    const key = `${current.type}:${current.token.id}`;
    setBusy(key);
    setActionError(null);
    if (current.type === "renew") setRevealedSecret(null);

    try {
      const id = encodeURIComponent(current.token.id);
      if (current.type === "renew") {
        const { data } = await request(`/integrations/tokens/${id}/renew`, {
          method: "POST",
          body: current.payload,
        });
        if (typeof data?.secret !== "string" || !data.secret.startsWith("cxi_")) {
          setActionError("Le serveur n’a pas renvoyé le nouveau secret. L’ancien peut déjà être invalidé : vérifiez le jeton avant toute nouvelle action.");
          return;
        }
        setRevealedSecret({
          kind: "renewed",
          tokenId: data.token?.id ?? current.token.id,
          name: data.token?.name ?? current.token.name,
          secret: data.secret,
        });
        setEditingToken(null);
        setActionSuccess(`Le secret de « ${current.token.name} » a été renouvelé et l’ancien est invalidé.`);
      } else if (current.type === "revoke") {
        await request(`/integrations/tokens/${id}/revoke`, { method: "POST" });
        if (revealedSecret?.tokenId === current.token.id) setRevealedSecret(null);
        if (editingToken?.id === current.token.id) setEditingToken(null);
        setActionSuccess(`Le jeton « ${current.token.name} » est révoqué.`);
      } else {
        await request(`/integrations/tokens/${id}`, { method: "DELETE" });
        if (revealedSecret?.tokenId === current.token.id) setRevealedSecret(null);
        if (editingToken?.id === current.token.id) setEditingToken(null);
        setActionSuccess(`Le jeton « ${current.token.name} » et son compte technique ont été supprimés.`);
      }

      setPendingAction(null);
      if (current.type === "delete" && (tokens.items ?? []).length === 1 && page > 1) setPage((currentPage) => currentPage - 1);
      else await tokens.reload();
    } catch (caught) {
      setActionError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  }

  const items = tokens.items ?? [];
  const catalogueAvailable = canReadPermissions && catalogue.items !== null && !catalogue.error;
  /** Sans catalogue chargé, « accorder toutes les permissions » n'a pas de sens. */
  const canGrantAll = catalogueAvailable && assignableScopes.length > 0;
  const pendingBusy = pendingAction ? busy === `${pendingAction.type}:${pendingAction.token.id}` : false;

  return (
    <div className="flex flex-col gap-6">
      <ApiInformationBanner />

      {actionError && !pendingAction ? <Notice>{actionError}</Notice> : null}
      {actionSuccess ? <Notice tone="success">{actionSuccess}</Notice> : null}
      {revealedSecret ? <SecretReveal revealed={revealedSecret} onClose={() => setRevealedSecret(null)} /> : null}

      {canManageTokens ? (
        <Card title="Créer un jeton d’intégration">
          {!canReadPermissions ? (
            <Notice tone="warning">La création nécessite aussi <code>permission:read:any</code> afin de charger et contrôler le catalogue des droits.</Notice>
          ) : null}
          {canReadPermissions && catalogue.items === null && !catalogue.error ? <p className="cx-small">Chargement du catalogue des permissions…</p> : null}
          {catalogue.error ? (
            <div className="flex flex-col gap-3">
              <Notice>{catalogue.error}</Notice>
              <div><button type="button" className={secondaryButton} onClick={catalogue.reload}>Réessayer</button></div>
            </div>
          ) : null}
          {catalogueAvailable ? (
            <CreateTokenForm permissions={catalogue.items} busy={busy === "create"} onCreate={createToken} />
          ) : null}
        </Card>
      ) : (
        <Notice tone="info">Vous pouvez consulter les jetons, mais seul un administrateur disposant de <code>integration:manage:any</code> peut en créer ou les modifier.</Notice>
      )}

      {editingToken && canManageTokens ? (
        <RenewTokenEditor
          key={editingToken.id}
          token={editingToken}
          permissions={catalogue.items ?? []}
          catalogueAvailable={catalogueAvailable}
          onCancel={() => setEditingToken(null)}
          onPrepare={(payload, expirationLabel) => openConfirmation({
            type: "renew",
            token: editingToken,
            payload,
            expirationLabel,
          })}
        />
      ) : null}

      <Card
        title="Jetons existants"
        action={tokens.meta ? <Badge tone="neutral">{tokens.meta.total} jeton{tokens.meta.total > 1 ? "s" : ""}</Badge> : null}
      >
        {!canReadTokens ? (
          <Notice tone="info">Votre rôle permet de gérer les intégrations, mais pas d’en consulter la liste. Ajoutez <code>integration:read:any</code> pour afficher les jetons existants.</Notice>
        ) : null}
        {tokens.error ? <Notice>{tokens.error}</Notice> : null}
        {canReadTokens && tokens.items === null && !tokens.error ? <p className="cx-small">Chargement des jetons…</p> : null}
        {canReadTokens && tokens.items !== null && items.length === 0 ? <Empty>Aucun jeton d’intégration n’a encore été créé.</Empty> : null}
        <ul className="flex flex-col gap-4">
          {items.map((token) => (
            <TokenItem
              key={token.id}
              token={token}
              descriptions={permissionDescriptions}
              canManage={canManageTokens}
              canGrantAll={canGrantAll}
              busy={Boolean(busy)}
              editing={editingToken?.id === token.id}
              onEdit={() => {
                setActionError(null);
                setEditingToken(token);
              }}
              onGrantAll={() => grantEverythingAndRenew(token)}
              onRevoke={() => openConfirmation({ type: "revoke", token })}
              onDelete={() => openConfirmation({ type: "delete", token })}
            />
          ))}
        </ul>
        <Pagination
          meta={tokens.meta}
          loading={tokens.loading}
          label="Pagination des jetons d’intégration"
          onPageChange={(nextPage) => {
            setPage(nextPage);
            setEditingToken(null);
          }}
        />
      </Card>

      <ConfirmDialog
        open={pendingAction !== null}
        title={
          pendingAction?.type === "renew"
            ? "Renouveler ce jeton et invalider son secret ?"
            : pendingAction?.type === "revoke"
              ? "Révoquer ce jeton immédiatement ?"
              : "Supprimer définitivement ce jeton ?"
        }
        confirmLabel={pendingAction?.type === "renew" ? "Renouveler le secret" : pendingAction?.type === "revoke" ? "Révoquer" : "Supprimer"}
        tone={pendingAction?.type === "renew" ? "accent" : "danger"}
        busy={pendingBusy}
        onCancel={() => {
          if (pendingBusy) return;
          setPendingAction(null);
          setActionError(null);
        }}
        onConfirm={confirmPendingAction}
      >
        {actionError ? <Notice>{actionError}</Notice> : null}
        {pendingAction?.type === "renew" ? (
          <div className="flex flex-col gap-3">
            <p>
              Le secret actuel de <strong>{pendingAction.token.name}</strong> cessera de fonctionner dès la réponse du serveur. Le nouveau secret ne sera affiché qu’une fois.
            </p>
            <p className="cx-small">
              {pendingAction.payload.scopes.length} permission{pendingAction.payload.scopes.length > 1 ? "s" : ""} · {pendingAction.expirationLabel}.
            </p>
          </div>
        ) : null}
        {pendingAction?.type === "revoke" ? (
          <p>Le jeton <strong>{pendingAction.token.name}</strong> ne pourra plus authentifier aucune requête. Vous pourrez le remettre en service uniquement en renouvelant son secret.</p>
        ) : null}
        {pendingAction?.type === "delete" ? (
          <p>Le jeton <strong>{pendingAction.token.name}</strong> et son compte technique seront supprimés. Cette action est irréversible.</p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
