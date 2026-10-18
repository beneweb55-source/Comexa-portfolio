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
 * DEVISES — référentiel des monnaies de l'agence.
 *
 * Pourquoi cet écran existe : le backend expose `/currencies` depuis le début,
 * mais RIEN ne l'appelait. Une devise ne pouvait donc être ni consultée, ni
 * créée, ni désactivée sans passer par un client d'API — alors que c'est la
 * pièce d'entrée de tout le système international : un devis en EUR, une
 * facture en USD, un solde en DZD partent tous de cette liste.
 *
 * Deux règles métier sont rappelées à l'écran parce qu'elles ne se devinent
 * pas : le code ISO fait trois lettres, et la devise par défaut ne peut pas
 * être désactivée (le serveur refuse, autant le dire avant).
 */

/** Un code ISO 4217 valide : trois lettres majuscules, sans accents ni chiffres. */
const CODE_PATTERN = /^[A-Z]{3}$/;

export default function CurrencyPanel() {
  const { request, user } = useAuth();
  const canManage = can(user, "currency:manage:any");

  const [currencies, setCurrencies] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", symbol: "", isDefault: false });
  const [formError, setFormError] = useState(null);
  const [editing, setEditing] = useState(null);

  // Tout `setState` vit DANS les retours d'appel : un effet ne doit pas poser
  // d'état de façon synchrone (règle `react-hooks/set-state-in-effect`, que le
  // reste du dépôt respecte). Le fonctionnement est identique — l'erreur est
  // effacée au moment où la réponse arrive, pas avant.
  const load = useCallback(() => {
    request("/currencies?perPage=100")
      .then(({ data }) => {
        setError(null);
        setCurrencies(Array.isArray(data) ? data : []);
      })
      .catch((caught) => {
        setError(messageOf(caught));
        setCurrencies([]);
      });
  }, [request]);

  useEffect(load, [load]);

  async function create(event) {
    event.preventDefault();
    setFormError(null);

    const code = form.code.trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      setFormError("Le code doit faire exactement trois lettres (ISO 4217), par exemple EUR.");
      return;
    }
    if (!form.name.trim() || !form.symbol.trim()) {
      setFormError("Le nom et le symbole sont obligatoires.");
      return;
    }

    setBusy(true);
    try {
      const result = await request("/currencies", {
        method: "POST",
        body: {
          code,
          name: form.name.trim(),
          symbol: form.symbol.trim(),
          isDefault: form.isDefault,
        },
      });
      setNotice(result?.message ?? "Devise créée avec succès.");
      setForm({ code: "", name: "", symbol: "", isDefault: false });
      load();
    } catch (caught) {
      setFormError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function update(id, payload, successMessage) {
    setBusy(true);
    setError(null);
    try {
      const result = await request(`/currencies/${id}`, { method: "PATCH", body: payload });
      setNotice(result?.message ?? successMessage);
      setEditing(null);
      load();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(currency) {
    setBusy(true);
    setError(null);
    try {
      await update(currency.id, { isActive: false }, `Devise ${currency.code} désactivée.`);
    } finally {
      setBusy(false);
    }
  }

  const rows = currencies ?? [];

  return (
    <div className="flex flex-col gap-5">
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}

      <Card
        title="Devises"
        subtitle="Les monnaies acceptées sur les devis, les factures et les soldes."
      >
        {currencies === null ? (
          <SkeletonList rows={4} />
        ) : rows.length === 0 ? (
          <Empty>Aucune devise enregistrée.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--comexa-border-soft)]">
            {rows.map((currency) => (
              <li key={currency.id ?? currency.code} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-[14.5px] font-medium text-[var(--comexa-ink)]">
                    {currency.name}{" "}
                    <span className="cx-small">({currency.symbol})</span>
                  </p>
                  <p className="cx-small">
                    {currency.code}
                    {currency.isDefault ? " · devise par défaut" : ""}
                    {currency.isActive === false ? " · désactivée" : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {currency.isDefault ? <Badge tone="info">Par défaut</Badge> : null}
                  <Badge tone={currency.isActive === false ? "neutral" : "success"}>
                    {currency.isActive === false ? "Inactive" : "Active"}
                  </Badge>

                  {canManage && currency.isActive !== false && !currency.isDefault ? (
                    <>
                      <button
                        type="button"
                        className={secondaryButton}
                        onClick={() =>
                          setEditing({
                            id: currency.id,
                            name: currency.name,
                            symbol: currency.symbol,
                          })
                        }
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        className={secondaryButton}
                        disabled={busy}
                        onClick={() => deactivate(currency)}
                        title="Une devise déjà utilisée reste lisible : elle cesse d'être proposée."
                      >
                        Désactiver
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canManage ? (
        <Card
          title="Ajouter une devise"
          subtitle="Trois lettres, code ISO 4217. Le serveur refuse un code déjà pris."
        >
          <form onSubmit={create} className="flex flex-col gap-4">
            {formError ? <Notice>{formError}</Notice> : null}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="currency-code" label="Code" hint="Ex. EUR, USD, DZD">
                <input
                  id="currency-code"
                  className={inputClass}
                  value={form.code}
                  maxLength={3}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="EUR"
                />
              </Field>
              <Field id="currency-name" label="Nom">
                <input
                  id="currency-name"
                  className={inputClass}
                  value={form.name}
                  maxLength={100}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Euro"
                />
              </Field>
              <Field id="currency-symbol" label="Symbole">
                <input
                  id="currency-symbol"
                  className={inputClass}
                  value={form.symbol}
                  maxLength={5}
                  onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                  placeholder="€"
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-[13.5px] text-[var(--comexa-ink)]">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              />
              Définir comme devise par défaut
            </label>

            <div>
              <button type="submit" className={primaryButton} disabled={busy}>
                {busy ? "Enregistrement…" : "Créer la devise"}
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {editing ? (
        <Card title={`Modifier ${editing.name}`} subtitle="Le code ne change pas : il identifie la devise.">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              update(editing.id, { name: editing.name, symbol: editing.symbol }, "Devise mise à jour.");
            }}
            className="flex flex-col gap-4"
          >
            <Field id="edit-currency-name" label="Nom">
              <input
                id="edit-currency-name"
                className={inputClass}
                value={editing.name}
                maxLength={100}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <Field id="edit-currency-symbol" label="Symbole">
              <input
                id="edit-currency-symbol"
                className={inputClass}
                value={editing.symbol}
                maxLength={5}
                onChange={(e) => setEditing({ ...editing, symbol: e.target.value })}
              />
            </Field>
            <div className="flex items-center gap-2">
              <button type="submit" className={primaryButton} disabled={busy}>
                Enregistrer
              </button>
              <button type="button" className={secondaryButton} onClick={() => setEditing(null)}>
                Annuler
              </button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
