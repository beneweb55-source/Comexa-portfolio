"use client";

import { useCallback, useEffect, useState } from "react";
import { messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
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

/**
 * RÉPARTITIONS — qui reçoit quelle part, et sur quelle base.
 *
 * Le backend calculait et appliquait des répartitions depuis le début
 * (`/distributions/configs`, `/distributions/projects/:id/calculate`,
 * `/distributions/:id/apply`) sans qu'aucun écran ne les appelle. Une
 * répartition ne pouvait donc être ni relue, ni corrigée : elle était calculable
 * par API et invisible pour les humains.
 *
 * LE POINT QUI SE VOIT À L'ÉCRAN, ET QUI NE SE DEVINAIT PAS DANS LE CODE :
 * les pourcentages doivent totaliser 100. Le serveur le refuse au moment de
 * l'application, ce qui est tard — l'utilisateur a déjà saisi cinq lignes. Le
 * total est donc affiché EN DIRECT pendant la saisie, et le bouton est désactivé
 * avant l'envoi. Une contrainte découverte après coup est une contrainte
 * contournée.
 */

/** Bases de calcul reconnues par le serveur (`DistributionBaseType`). */
const BASE_TYPES = [
  ["COLLECTED_AMOUNT", "Montant encaissé", "La part est calculée sur ce qui est réellement rentré."],
  ["INVOICED_AMOUNT", "Montant facturé", "La part suit la facturation, encaissée ou non."],
  ["PROFIT_AFTER_EXPENSES", "Bénéfice après charges", "La part suit ce qui reste une fois les charges retirées."],
];

/** Types de bénéficiaire reconnus (`BeneficiaryType`). */
const BENEFICIARY_TYPES = [
  ["MEMBER", "Membre de l'équipe"],
  ["COMPANY", "Comexa"],
  ["RESERVE", "Réserve"],
];

/** Somme des pourcentages, en nombre. Renvoie 0 si une ligne est illisible. */
function totalPercentage(beneficiaries) {
  return beneficiaries.reduce((sum, b) => {
    const value = Number(String(b.percentage).replace(",", "."));
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

export default function DistributionPanel() {
  const { request, user } = useAuth();
  const canManage = can(user, "distribution:manage:any");

  const [configs, setConfigs] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    name: "",
    description: "",
    baseType: "COLLECTED_AMOUNT",
    effectiveDate: "",
    beneficiaries: [{ beneficiaryType: "MEMBER", name: "", percentage: "", userId: "", order: 0 }],
  });
  const [formError, setFormError] = useState(null);

  // Même discipline que `CurrencyPanel` : aucun `setState` synchrone dans un
  // effet, tout passe par les retours d'appel de la requête.
  const load = useCallback(() => {
    request("/distributions/configs?perPage=50")
      .then(({ data }) => {
        setError(null);
        setConfigs(Array.isArray(data) ? data : []);
      })
      .catch((caught) => {
        setError(messageOf(caught));
        setConfigs([]);
      });
  }, [request]);

  useEffect(load, [load]);

  const total = totalPercentage(form.beneficiaries);
  const balanced = Math.abs(total - 100) < 0.001;

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
        {
          beneficiaryType: "MEMBER",
          name: "",
          percentage: "",
          userId: "",
          order: prev.beneficiaries.length,
        },
      ],
    }));
  }

  function removeBeneficiary(index) {
    setForm((prev) => ({
      ...prev,
      beneficiaries: prev.beneficiaries
        .filter((_, i) => i !== index)
        // L'ordre est réindexé : un trou dans la séquence ferait douter de
        // l'ordre d'affichage côté serveur.
        .map((row, i) => ({ ...row, order: i })),
    }));
  }

  async function create(event) {
    event.preventDefault();
    setFormError(null);

    if (!form.name.trim()) {
      setFormError("Donnez un nom à cette configuration.");
      return;
    }
    if (form.beneficiaries.length === 0) {
      setFormError("Ajoutez au moins un bénéficiaire.");
      return;
    }
    if (!balanced) {
      setFormError(
        `Les pourcentages totalisent ${total.toFixed(2).replace(".", ",")} %. Ils doivent faire exactement 100 %, sans quoi le serveur refuserait la répartition au moment de l'appliquer.`,
      );
      return;
    }
    if (form.beneficiaries.some((b) => !b.name.trim() || !String(b.percentage).trim())) {
      setFormError("Chaque bénéficiaire a besoin d'un nom et d'un pourcentage.");
      return;
    }

    setBusy(true);
    try {
      const result = await request("/distributions/configs", {
        method: "POST",
        body: {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          baseType: form.baseType,
          effectiveDate: form.effectiveDate || undefined,
          beneficiaries: form.beneficiaries.map((b, index) => ({
            beneficiaryType: b.beneficiaryType,
            name: b.name.trim(),
            percentage: String(b.percentage).replace(",", "."),
            userId: b.userId?.trim() || undefined,
            order: index,
          })),
        },
      });
      setNotice(result?.message ?? "Configuration de répartition enregistrée.");
      setForm({
        name: "",
        description: "",
        baseType: "COLLECTED_AMOUNT",
        effectiveDate: "",
        beneficiaries: [{ beneficiaryType: "MEMBER", name: "", percentage: "", userId: "", order: 0 }],
      });
      load();
    } catch (caught) {
      setFormError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  const rows = configs ?? [];

  return (
    <div className="flex flex-col gap-5">
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}

      <Card
        title="Configurations de répartition"
        subtitle="Le calcul d'une répartitions se fait depuis la page du projet ; on la prépare ici."
      >
        {configs === null ? (
          <SkeletonList rows={3} />
        ) : rows.length === 0 ? (
          <Empty>Aucune configuration. Créez-en une pour pouvoir répartir un projet.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--comexa-border-soft)]">
            {rows.map((config) => (
              <li key={config.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-[14.5px] font-medium text-[var(--comexa-ink)]">{config.name}</p>
                  <p className="cx-small">
                    {config.beneficiaries?.length ?? 0} bénéficiaire(s)
                    {config.isActive === false ? " · désactivée" : ""}
                    {config.effectiveDate ? ` · effet le ${String(config.effectiveDate).slice(0, 10)}` : ""}
                  </p>
                </div>
                <Badge tone={config.isActive === false ? "neutral" : "success"}>
                  {config.isActive === false ? "Inactive" : "Active"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canManage ? (
        <Card
          title="Nouvelle configuration"
          subtitle="Les pourcentages doivent totaliser 100 %, sinon le serveur refuse la répartition à l'application."
        >
          <form onSubmit={create} className="flex flex-col gap-5">
            {formError ? <Notice>{formError}</Notice> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="dist-name" label="Nom">
                <input
                  id="dist-name"
                  className={inputClass}
                  value={form.name}
                  maxLength={120}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Répartition 2026"
                />
              </Field>
              <Field id="dist-date" label="Date d'effet" hint="Facultative.">
                <input
                  id="dist-date"
                  type="date"
                  className={inputClass}
                  value={form.effectiveDate}
                  onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
                />
              </Field>
              <Field id="dist-description" label="Description" hint="Facultative.">
                <input
                  id="dist-description"
                  className={inputClass}
                  value={form.description}
                  maxLength={300}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>
              <Field id="dist-base" label="Base de calcul">
                <select
                  id="dist-base"
                  className="cx-select"
                  value={form.baseType}
                  onChange={(e) => setForm({ ...form, baseType: e.target.value })}
                >
                  {BASE_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <p className="cx-small">
              {BASE_TYPES.find(([value]) => value === form.baseType)?.[2] ?? ""}
            </p>

            <fieldset className="flex flex-col gap-3">
              <legend className="cx-label">Bénéficiaires</legend>

              {form.beneficiaries.map((row, index) => (
                <div key={index} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_120px_auto]">
                  <Field id={`dist-benef-type-${index}`} label="Type">
                    <select
                      id={`dist-benef-type-${index}`}
                      className="cx-select"
                      value={row.beneficiaryType}
                      onChange={(e) => setBeneficiary(index, { beneficiaryType: e.target.value })}
                    >
                      {BENEFICIARY_TYPES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id={`dist-benef-name-${index}`} label="Nom">
                    <input
                      id={`dist-benef-name-${index}`}
                      className={inputClass}
                      value={row.name}
                      maxLength={120}
                      onChange={(e) => setBeneficiary(index, { name: e.target.value })}
                      placeholder="Younes"
                    />
                  </Field>
                  <Field id={`dist-benef-pct-${index}`} label="%">
                    <input
                      id={`dist-benef-pct-${index}`}
                      className={inputClass}
                      inputMode="decimal"
                      value={row.percentage}
                      onChange={(e) => setBeneficiary(index, { percentage: e.target.value })}
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
                    Retirer
                  </button>
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" className={secondaryButton} onClick={addBeneficiary}>
                  Ajouter un bénéficiaire
                </button>
                {/* Le total est vivant : voir la note en tête de fichier. */}
                <p
                  className={`cx-tabular text-[14px] font-medium ${
                    balanced ? "text-[var(--comexa-success)]" : "text-[var(--comexa-error)]"
                  }`}
                >
                  Total : {total.toFixed(2).replace(".", ",")} %{" "}
                  {balanced ? "✓" : `(reste ${(100 - total).toFixed(2).replace(".", ",")} %)`}
                </p>
              </div>
            </fieldset>

            <div>
              <button type="submit" className={primaryButton} disabled={busy || !balanced}>
                {busy ? "Enregistrement…" : "Enregistrer la configuration"}
              </button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
