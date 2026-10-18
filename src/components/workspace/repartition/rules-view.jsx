"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  History,
  Layers,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { useAllListing } from "@/lib/use-all-listing";
import {
  Badge,
  Card,
  Empty,
  Field,
  Notice,
  SkeletonList,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/workspace/ui";
import {
  BASE_TYPES,
  BENEFICIARY_TYPES,
  DEFAULT_BASE,
  baseLabel,
  formatPercent,
  inDays,
  isBalanced,
  totalPercentage,
} from "./shared";

/**
 * LES RÈGLES DE RÉPARTITION — ce qui sera réparti, et selon quelles versions.
 *
 * LE POINT QUE L'ÉCRAN DOIT RENDRE VISIBLE, ET QUE LE CODE NE SAURAIT PAS
 * DIRE : une règle n'est pas un document, c'est une VERSION. Modifier une
 * règle ne la remplace pas — cela crée une version suivante, datée, qui ne
 * s'applique qu'à partir de sa date d'effet. Les répartitions déjà validées
 * gardent la version qui les a produites.
 *
 * C'est pourquoi cet écran montre :
 *
 *  - le PÉRIMÈTRE de chaque règle (par défaut, ou exception d'un projet) ;
 *  - son NUMÉRO DE VERSION et sa date d'effet ;
 *  - les POURCENTAGES de chaque bénéficiaire, avec le total — affiché en
 *    direct pendant la saisie, parce qu'une contrainte découverte après coup
 *    est une contrainte contournée ;
 *  - l'HISTORIQUE des versions, consultable à tout moment.
 *
 * Le calcul, lui, ne se fait pas ici : il se fait dans l'onglet « Calculs »,
 * où l'on voit la base, le montant réparti et la trace de l'arrondi.
 */

/** Une règle, regroupée par périmètre. */
function groupByScope(rules) {
  const groups = new Map();
  for (const rule of rules) {
    const key = rule.scopeKey ?? "global";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rule);
  }
  for (const list of groups.values()) {
    list.sort((left, right) => (right.version ?? 0) - (left.version ?? 0));
  }
  return groups;
}

/** La ligne « qui reçoit quoi » : un bénéficiaire, un pourcentage, une barre. */
function ShareRow({ row }) {
  const share = Number(String(row.percentage ?? 0).replace(",", "."));
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-[var(--ink)]">{row.name}</span>
        <span className="block text-[12px] text-[var(--muted)]">
          {row.beneficiaryType === "MEMBER" ? "Membre de l’équipe" : row.beneficiaryType === "COMPANY" ? "Comexa" : "Réserve"}
        </span>
      </span>
      <span className="sui-bars__track" style={{ flex: "0 0 120px" }} aria-hidden="true">
        <span className="sui-bars__fill" style={{ width: `${Math.max(0, Math.min(100, share))}%` }} />
      </span>
      <span className="sui-tabular w-[74px] text-right text-[13.5px] font-semibold text-[var(--ink)]">
        {formatPercent(row.percentage)}
      </span>
    </li>
  );
}

export default function RulesView() {
  const { request, user } = useAuth();
  const canRead = can(user, "distribution:read:any");
  const canManage = can(user, "distribution:manage:any");
  const canReadProjects = can(user, "project:read:any");

  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  // L'editeur : `null` = fermé, sinon { mode: "create" | "revise", rule }.
  const [editor, setEditor] = useState(null);
  const [history, setHistory] = useState(null);
  const [formError, setFormError] = useState(null);

  const [form, setForm] = useState(() => emptyForm());

  function emptyForm() {
    return {
      name: "",
      description: "",
      baseType: DEFAULT_BASE,
      scope: "global",
      projectId: "",
      effectiveDate: inDays(0),
      beneficiaries: [{ beneficiaryType: "MEMBER", name: "", percentage: "", userId: "", order: 0 }],
    };
  }

  const rules = useListing(canRead ? "/distributions/configs" : null);

  // L'annuaire des membres ELIGIBLES : c'est le serveur qui dit qui peut
  // figurer dans une regle (membre actif de l'equipe, pas un client, pas un
  // compte technique). La liste proposee et la regle appliquee viennent donc
  // de la meme source.
  const directory = useListing(canManage ? "/balances/eligible-members" : null);

  // Les projets, pour les exceptions de projet.
  const projectList = useAllListing(canManage && canReadProjects ? "/projects?perPage=100" : null);

  const members = directory.items ?? [];
  const projects = projectList.items ?? [];

  const load = rules.reload;

  const groups = useMemo(() => groupByScope(rules.items ?? []), [rules.items]);
  const globalRules = groups.get("global") ?? [];
  const projectRules = [...groups.entries()].filter(([key]) => key !== "global");

  const total = totalPercentage(form.beneficiaries);
  const balanced = isBalanced(form.beneficiaries);

  function setBeneficiary(index, patch) {
    setForm((prev) => ({
      ...prev,
      beneficiaries: prev.beneficiaries.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }

  function addBeneficiary() {
    setForm((prev) => ({
      ...prev,
      beneficiaries: [
        ...prev.beneficiaries,
        { beneficiaryType: "MEMBER", name: "", percentage: "", userId: "", order: prev.beneficiaries.length },
      ],
    }));
  }

  function removeBeneficiary(index) {
    setForm((prev) => ({
      ...prev,
      beneficiaries: prev.beneficiaries
        .filter((_, i) => i !== index)
        .map((row, i) => ({ ...row, order: i })),
    }));
  }

  function startCreate() {
    setForm(emptyForm());
    setFormError(null);
    setEditor({ mode: "create" });
  }

  function startRevise(rule) {
    setForm({
      name: rule.name ?? "",
      description: rule.description ?? "",
      baseType: rule.baseType ?? DEFAULT_BASE,
      scope: rule.scopeKey === "global" ? "global" : "project",
      projectId: rule.projectId ?? "",
      effectiveDate: inDays(1),
      beneficiaries: (rule.beneficiaries ?? []).map((row, index) => ({
        beneficiaryType: row.beneficiaryType,
        name: row.name ?? "",
        percentage: String(row.percentage ?? ""),
        userId: row.userId ?? "",
        order: index,
      })),
    });
    setFormError(null);
    setEditor({ mode: "revise", rule });
  }

  function closeEditor() {
    setEditor(null);
    setFormError(null);
  }

  async function submit(event) {
    event.preventDefault();
    setFormError(null);

    if (!form.name.trim()) {
      setFormError("Donnez un nom à cette règle.");
      return;
    }
    if (form.scope === "project" && !form.projectId) {
      setFormError("Choisissez le projet concerné par cette exception.");
      return;
    }
    if (!balanced) {
      setFormError(
        `Les pourcentages totalisent ${total.toFixed(2).replace(".", ",")} %. Ils doivent faire exactement 100 %, sinon le serveur refuse la répartition.`,
      );
      return;
    }
    if (form.beneficiaries.some((row) => !String(row.name).trim() || !String(row.percentage).trim())) {
      setFormError("Chaque bénéficiaire a besoin d’un nom et d’un pourcentage.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      baseType: form.baseType,
      effectiveDate: form.effectiveDate ? new Date(form.effectiveDate).toISOString() : undefined,
      beneficiaries: form.beneficiaries.map((row, index) => ({
        beneficiaryType: row.beneficiaryType,
        name: row.name.trim(),
        percentage: String(row.percentage).replace(",", "."),
        userId: row.userId?.trim() || undefined,
        order: index,
      })),
    };

    setBusy(true);
    try {
      if (editor?.mode === "revise") {
        // Une revision exige une CONFIRMATION EXPLICITE : sans elle, le
        // serveur refuse. C'est la garantie qu'un changement de regle n'est
        // jamais un effet de bord.
        const { data } = await request(`/distributions/configs/${editor.rule.id}/revise`, {
          method: "POST",
          body: {
            ...payload,
            projectId: undefined,
            confirm: true,
            reason: `Nouvelle version depuis l’espace équipe (${new Date().toLocaleDateString("fr-FR")})`,
          },
        });
        setNotice(
          data?.message ??
            `Version ${data?.version ?? ""} créée. Les répartitions déjà validées ne changent pas.`,
        );
      } else {
        const { data } = await request("/distributions/configs", {
          method: "POST",
          body: {
            ...payload,
            projectId: form.scope === "project" ? form.projectId : undefined,
          },
        });
        setNotice(data?.message ?? "Règle enregistrée.");
      }
      closeEditor();
      load();
    } catch (caught) {
      setFormError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(rule) {
    setBusy(true);
    try {
      const { data } = await request(`/distributions/configs/${rule.id}/deactivate`, { method: "POST" });
      setNotice(data?.message ?? "Règle désactivée.");
      load();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(rule) {
    try {
      const { data } = await request(`/distributions/configs/${rule.id}/history`);
      setHistory({ rule, versions: Array.isArray(data) ? data : [] });
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  if (!canRead) {
    return (
      <Notice tone="info">
        La lecture des règles de répartition est réservée à l’encadrement. Votre solde personnel reste visible
        dans l’onglet « Soldes ».
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
      {rules.error ? <Notice>{rules.error}</Notice> : null}

      <Card
        title="Règle par défaut"
        subtitle="Elle s’applique à tous les projets, sauf exception. Chaque changement crée une nouvelle version, datée : les répartitions déjà validées ne bougent pas."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={secondaryButton} onClick={load} disabled={rules.loading}>
              <RefreshCw size={15} strokeWidth={1.9} className={rules.loading ? "sui-spin" : ""} aria-hidden="true" />
              Actualiser
            </button>
            {canManage ? (
              <button type="button" className={primaryButton} onClick={startCreate}>
                <Plus size={15} strokeWidth={2} aria-hidden="true" /> Nouvelle règle
              </button>
            ) : null}
          </div>
        }
      >
        {rules.loading && rules.items === null ? (
          <SkeletonList rows={3} />
        ) : globalRules.length === 0 ? (
          <Empty icon={Layers}>
            Aucune règle par défaut. Créez-en une pour que les projets puissent être répartis.
          </Empty>
        ) : (
          <ul className="flex flex-col gap-4">
            {globalRules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                canManage={canManage}
                busy={busy}
                onRevise={() => startRevise(rule)}
                onHistory={() => openHistory(rule)}
                onDeactivate={() => deactivate(rule)}
              />
            ))}
          </ul>
        )}
      </Card>

      {projectRules.length > 0 ? (
        <Card
          title="Exceptions de projet"
          subtitle="Une règle propre à un projet prime sur la règle par défaut, pour ce projet seulement."
        >
          <ul className="flex flex-col gap-4">
            {projectRules.map(([scopeKey, list]) => (
              <RuleCard
                key={scopeKey}
                rule={list[0]}
                versions={list}
                scopeLabel={projects.find((project) => `project:${project.id}` === scopeKey)?.name ?? scopeKey}
                canManage={canManage}
                busy={busy}
                onRevise={() => startRevise(list[0])}
                onHistory={() => openHistory(list[0])}
                onDeactivate={() => deactivate(list[0])}
              />
            ))}
          </ul>
        </Card>
      ) : null}

      {editor ? (
        <Card
          title={editor.mode === "revise" ? `Nouvelle version de « ${editor.rule.name} »` : "Nouvelle règle de répartition"}
          subtitle={
            editor.mode === "revise"
              ? "La version précédente reste en vigueur jusqu’à la date d’effet. Les répartitions déjà validées ne sont pas recalculées."
              : "Une règle vaut pour toute l’agence, ou pour un seul projet si vous le choisissez."
          }
          action={
            <button type="button" className={secondaryButton} onClick={closeEditor}>
              Annuler
            </button>
          }
        >
          <form onSubmit={submit} className="flex flex-col gap-5">
            {formError ? <Notice>{formError}</Notice> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="rule-name" label="Nom de la règle">
                <input
                  id="rule-name"
                  className={inputClass}
                  value={form.name}
                  maxLength={120}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Répartition 2026"
                />
              </Field>

              <Field id="rule-scope" label="Portée">
                <select
                  id="rule-scope"
                  className={inputClass}
                  value={form.scope}
                  onChange={(event) => setForm({ ...form, scope: event.target.value })}
                  disabled={editor.mode === "revise"}
                >
                  <option value="global">Toute l’agence (règle par défaut)</option>
                  <option value="project">Un projet précis (exception)</option>
                </select>
              </Field>

              {form.scope === "project" ? (
                <Field id="rule-project" label="Projet concerné">
                  <select
                    id="rule-project"
                    className={inputClass}
                    value={form.projectId}
                    onChange={(event) => setForm({ ...form, projectId: event.target.value })}
                    disabled={editor.mode === "revise"}
                  >
                    <option value="">Choisir un projet…</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}

              <Field id="rule-base" label="Base de calcul" hint={BASE_TYPES.find((entry) => entry.value === form.baseType)?.hint}>
                <select
                  id="rule-base"
                  className={inputClass}
                  value={form.baseType}
                  onChange={(event) => setForm({ ...form, baseType: event.target.value })}
                >
                  {BASE_TYPES.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                id="rule-date"
                label="Date d’effet"
                hint="La version s’applique à partir de cette date. Les répartitions déjà validées gardent la règle qui les a produites."
              >
                <input
                  id="rule-date"
                  type="date"
                  className={inputClass}
                  value={form.effectiveDate}
                  onChange={(event) => setForm({ ...form, effectiveDate: event.target.value })}
                />
              </Field>

              <Field id="rule-description" label="Description" hint="Facultative.">
                <input
                  id="rule-description"
                  className={inputClass}
                  value={form.description}
                  maxLength={300}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </Field>
            </div>

            <fieldset className="sui-fieldset flex flex-col gap-3">
              <legend className="sui-field__label">Bénéficiaires</legend>

              {form.beneficiaries.map((row, index) => (
                <div key={index} className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_110px_auto]">
                  <Field id={`rule-type-${index}`} label="Type">
                    <select
                      id={`rule-type-${index}`}
                      className={inputClass}
                      value={row.beneficiaryType}
                      onChange={(event) => setBeneficiary(index, { beneficiaryType: event.target.value })}
                    >
                      {BENEFICIARY_TYPES.map((entry) => (
                        <option key={entry.value} value={entry.value}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field id={`rule-member-${index}`} label="Membre" hint={row.beneficiaryType === "MEMBER" ? undefined : "Sans compte pour ce type."}>
                    {row.beneficiaryType === "MEMBER" ? (
                      <select
                        id={`rule-member-${index}`}
                        className={inputClass}
                        value={row.userId}
                        onChange={(event) => {
                          const member = members.find((entry) => entry.id === event.target.value);
                          setBeneficiary(index, {
                            userId: event.target.value,
                            name: member ? `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() : row.name,
                          });
                        }}
                      >
                        <option value="">Choisir un membre…</option>
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {`${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() || member.email}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`rule-member-${index}`}
                        className={inputClass}
                        value={row.name}
                        maxLength={120}
                        onChange={(event) => setBeneficiary(index, { name: event.target.value })}
                        placeholder="Réserve Comexa"
                      />
                    )}
                  </Field>

                  <Field id={`rule-pct-${index}`} label="%">
                    <input
                      id={`rule-pct-${index}`}
                      className={inputClass}
                      inputMode="decimal"
                      value={row.percentage}
                      onChange={(event) => setBeneficiary(index, { percentage: event.target.value })}
                      placeholder="20"
                    />
                  </Field>

                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() => removeBeneficiary(index)}
                    disabled={form.beneficiaries.length === 1}
                    aria-label={`Retirer le bénéficiaire ${index + 1}`}
                  >
                    <Trash2 size={15} strokeWidth={1.9} aria-hidden="true" />
                  </button>
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" className={secondaryButton} onClick={addBeneficiary}>
                  <Plus size={15} strokeWidth={2} aria-hidden="true" /> Ajouter un bénéficiaire
                </button>
                <p
                  className={`sui-tabular text-[14px] font-semibold ${
                    balanced ? "text-[var(--fill-green)]" : "text-[var(--fill-pink)]"
                  }`}
                >
                  Total : {total.toFixed(2).replace(".", ",")} %{" "}
                  {balanced ? (
                    <span className="inline-flex items-center gap-1">
                      <Check size={14} strokeWidth={2.4} aria-hidden="true" /> correct
                    </span>
                  ) : (
                    `(reste ${(100 - total).toFixed(2).replace(".", ",")} %)`
                  )}
                </p>
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={primaryButton} disabled={busy || !balanced}>
                {busy
                  ? "Enregistrement…"
                  : editor.mode === "revise"
                    ? "Créer la nouvelle version"
                    : "Enregistrer la règle"}
              </button>
              <p className="text-[12px] text-[var(--muted)]">
                {editor.mode === "revise"
                  ? "La version précédente reste valable jusqu’à la date d’effet choisie."
                  : "Elle s’appliquera aux prochains calculs."}
              </p>
            </div>
          </form>
        </Card>
      ) : null}

      {history ? (
        <Card
          title="Historique des versions"
          subtitle={`« ${history.rule.name} » — ${history.versions.length} version(s).`}
          action={
            <button type="button" className={secondaryButton} onClick={() => setHistory(null)}>
              Fermer
            </button>
          }
        >
          <ul className="flex flex-col divide-y divide-[var(--line-soft)]">
            {history.versions.map((version) => (
              <li key={version.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[var(--ink)]">
                    Version {version.version}
                    {version.isActive ? "" : " · close"}
                  </p>
                  <p className="text-[12px] text-[var(--muted)]">
                    {baseLabel(version.baseType)} · effet le {String(version.effectiveDate ?? "").slice(0, 10)}
                    {version.endDate ? ` · close le ${String(version.endDate).slice(0, 10)}` : ""}
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[var(--muted)]">
                    {(version.beneficiaries ?? []).map((row) => (
                      <li key={`${version.id}-${row.name}`}>
                        {row.name} · {formatPercent(row.percentage)}
                      </li>
                    ))}
                  </ul>
                </div>
                {version.confirmedAt ? (
                  <Badge tone="info">Confirmée</Badge>
                ) : (
                  <Badge tone="neutral">Sans confirmation</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/** La carte d'une règle : périmètre, version, parts, actions. */
function RuleCard({ rule, versions, scopeLabel, canManage, busy, onRevise, onHistory, onDeactivate }) {
  const rows = rule.beneficiaries ?? [];
  const total = totalPercentage(rows);
  const balanced = Math.abs(total - 100) < 0.0001;

  return (
    <li className="rounded-[18px] border border-[var(--line-soft)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-tight text-[var(--ink)]">{rule.name}</p>
          <p className="text-[12.5px] text-[var(--muted)]">
            {scopeLabel ? `Exception · ${scopeLabel}` : "Règle par défaut"} · {baseLabel(rule.baseType)} · version{" "}
            {rule.version ?? 1}
            {rule.effectiveDate ? ` · effet le ${String(rule.effectiveDate).slice(0, 10)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {versions?.length > 1 ? <Badge tone="info">{versions.length} versions</Badge> : null}
          {balanced ? <Badge tone="success">100 %</Badge> : <Badge tone="danger">{total.toFixed(2)} %</Badge>}
        </div>
      </div>

      <ul className="mt-3 flex flex-col divide-y divide-[var(--line-soft)]">
        {rows.map((row) => (
          <ShareRow key={row.id} row={row} />
        ))}
      </ul>

      {canManage ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={secondaryButton} onClick={onRevise} disabled={busy}>
            <SlidersHorizontal size={15} strokeWidth={1.9} aria-hidden="true" /> Nouvelle version
          </button>
          <button type="button" className={secondaryButton} onClick={onHistory} disabled={busy}>
            <History size={15} strokeWidth={1.9} aria-hidden="true" /> Versions
          </button>
          {rule.isActive ? (
            <button type="button" className={secondaryButton} onClick={onDeactivate} disabled={busy}>
              <AlertTriangle size={15} strokeWidth={1.9} aria-hidden="true" /> Désactiver
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
