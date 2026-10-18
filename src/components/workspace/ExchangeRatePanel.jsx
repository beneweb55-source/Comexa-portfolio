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
 * TAUX DE CHANGE — historique des cours et convertisseur.
 *
 * Ce panneau remplit un trou symétrique à celui des devises : le backend exposait
 * `/exchange-rates` (taux, conversion, historique) et personne ne l'appelait.
 * Un devis en EUR ne pouvait donc pas être comparé à une facture en DZD.
 *
 * LE CHOIX QUI COMPTE ICI EST LA DATE. Un taux de change SANS date n'est pas une
 * information, c'est une ambiance : le même couple de devises a cinquante valeurs
 * différentes dans l'année. L'écran affiche donc toujours la date d'effet à côté
 * du taux, et l'historique est la vue par défaut — pas une page séparée.
 *
 * Le convertisseur, lui, ne devine rien : il interroge le serveur
 * (`/exchange-rates/convert`) avec la date choisie, et affiche ce qui est
 * revenu. Recalculer côté navigateur avec un taux vieux de plusieurs mois
 * donnerait un montant faux, présenté avec l'autorité d'un calcul exact.
 */

/** Date du jour au format attendu par l'API (`YYYY-MM-DD`). */
const TODAY = () => new Date().toISOString().slice(0, 10);

export default function ExchangeRatePanel() {
  const { request, user } = useAuth();
  const canManage = can(user, "exchangerate:manage:any");

  const [currencies, setCurrencies] = useState([]);
  const [pair, setPair] = useState({ from: "DZD", to: "EUR" });
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  // Convertisseur
  const [convert, setConvert] = useState({ amount: "10000", date: TODAY() });
  const [converted, setConverted] = useState(null);
  const [convertError, setConvertError] = useState(null);

  // Nouveau taux
  const [form, setForm] = useState({
    rate: "",
    effectiveDate: TODAY(),
    source: "",
    reference: "",
  });
  const [formError, setFormError] = useState(null);

  const loadCurrencies = useCallback(() => {
    request("/currencies?perPage=100")
      .then(({ data }) => {
        const rows = (Array.isArray(data) ? data : []).filter((c) => c.isActive !== false);
        setCurrencies(rows);
        if (rows.length >= 2) {
          setPair((prev) => ({
            from: rows.some((c) => c.code === prev.from) ? prev.from : rows[0].code,
            to: rows.some((c) => c.code === prev.to) ? prev.to : rows[1].code,
          }));
        }
      })
      .catch(() => setCurrencies([]));
  }, [request]);

  // Même discipline que les autres panneaux : aucun `setState` dans le corps
  // synchrone d'un effet, tout passe par les retours d'appel.
  const loadHistory = useCallback(() => {
    request(`/exchange-rates/history?from=${pair.from}&to=${pair.to}&perPage=20`)
      .then(({ data }) => {
        setHistoryError(null);
        setHistory(Array.isArray(data) ? data : []);
      })
      .catch((caught) => {
        setHistoryError(messageOf(caught));
        setHistory([]);
      });
  }, [request, pair.from, pair.to]);

  useEffect(loadCurrencies, [loadCurrencies]);
  useEffect(loadHistory, [loadHistory]);

  const codeOptions = currencies.map((c) => c.code);

  async function runConvert(event) {
    event.preventDefault();
    setConvertError(null);
    setConverted(null);

    const amount = Number(convert.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setConvertError("Saisissez un montant positif.");
      return;
    }

    setBusy(true);
    try {
      const { data } = await request(
        `/exchange-rates/convert?amount=${encodeURIComponent(convert.amount)}&from=${pair.from}&to=${pair.to}&date=${convert.date}`,
      );
      setConverted(data);
    } catch (caught) {
      setConvertError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveRate(event) {
    event.preventDefault();
    setFormError(null);

    if (!form.rate.trim() || !form.source.trim()) {
      setFormError("Le taux et sa source sont obligatoires : un taux sans origine ne peut pas être vérifié.");
      return;
    }

    setBusy(true);
    try {
      const result = await request("/exchange-rates", {
        method: "POST",
        body: {
          fromCurrency: pair.from,
          toCurrency: pair.to,
          rate: form.rate.trim(),
          effectiveDate: form.effectiveDate,
          source: form.source.trim(),
          reference: form.reference.trim() || undefined,
        },
      });
      setNotice(result?.message ?? "Taux de change enregistré avec succès.");
      setForm({ rate: "", effectiveDate: TODAY(), source: "", reference: "" });
      loadHistory();
    } catch (caught) {
      setFormError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function removeRate(rate) {
    setBusy(true);
    setHistoryError(null);
    try {
      const result = await request(
        `/exchange-rates?fromCurrency=${rate.fromCurrency}&toCurrency=${rate.toCurrency}&effectiveDate=${String(rate.effectiveDate).slice(0, 10)}`,
        { method: "DELETE" },
      );
      setNotice(result?.message ?? "Taux de change supprimé avec succès.");
      loadHistory();
    } catch (caught) {
      setHistoryError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <Card
        title="Couple de devises"
        subtitle="Le taux s'affiche toujours avec sa date d'effet : sans date, il ne veut rien dire."
        action={
          <button type="button" className={secondaryButton} onClick={loadHistory}>
            Actualiser
          </button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="rate-from" label="Depuis">
            <select
              id="rate-from"
              className="cx-select"
              value={pair.from}
              onChange={(e) => setPair({ ...pair, from: e.target.value })}
            >
              {codeOptions.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </Field>
          <Field id="rate-to" label="Vers">
            <select
              id="rate-to"
              className="cx-select"
              value={pair.to}
              onChange={(e) => setPair({ ...pair, to: e.target.value })}
            >
              {codeOptions.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card title={`Historique ${pair.from} → ${pair.to}`} subtitle="Du taux le plus récent au plus ancien.">
        {historyError ? <Notice>{historyError}</Notice> : null}
        {history === null ? (
          <SkeletonList rows={3} />
        ) : history.length === 0 ? (
          <Empty>
            Aucun taux enregistré pour {pair.from} → {pair.to}. Ajoutez-le ci-dessous pour pouvoir convertir.
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--comexa-border-soft)]">
            {history.map((rate) => (
              <li key={rate.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="cx-tabular text-[14.5px] font-medium text-[var(--comexa-ink)]">
                    1 {rate.fromCurrency} = {rate.rate} {rate.toCurrency}
                  </p>
                  <p className="cx-small">
                    Effet le {String(rate.effectiveDate).slice(0, 10)}
                    {rate.source ? ` · source : ${rate.source}` : ""}
                  </p>
                </div>
                {canManage ? (
                  <button
                    type="button"
                    className={secondaryButton}
                    disabled={busy}
                    onClick={() => removeRate(rate)}
                    title="Supprime ce cours daté. Les conversions déjà faites gardent leur valeur."
                  >
                    Supprimer
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Convertir un montant" subtitle="Le calcul est fait par le serveur, avec le taux de la date choisie.">
        <form onSubmit={runConvert} className="flex flex-col gap-4">
          {convertError ? <Notice>{convertError}</Notice> : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="convert-amount" label={`Montant en ${pair.from}`}>
              <input
                id="convert-amount"
                className={inputClass}
                inputMode="decimal"
                value={convert.amount}
                onChange={(e) => setConvert({ ...convert, amount: e.target.value })}
              />
            </Field>
            <Field id="convert-date" label="Date du taux">
              <input
                id="convert-date"
                type="date"
                className={inputClass}
                value={convert.date}
                onChange={(e) => setConvert({ ...convert, date: e.target.value })}
              />
            </Field>
            <div className="flex items-end">
              <button type="submit" className={primaryButton} disabled={busy}>
                {busy ? "Calcul…" : "Convertir"}
              </button>
            </div>
          </div>

          {converted !== null && converted !== undefined ? (
            <p className="cx-tabular text-[15px] font-medium text-[var(--comexa-ink)]">
              {convert.amount} {pair.from} = {converted} {pair.to}
            </p>
          ) : null}
        </form>
      </Card>

      {canManage ? (
        <Card title="Enregistrer un taux" subtitle="La source est obligatoire : c'est elle qui rend le cours opposable.">
          <form onSubmit={saveRate} className="flex flex-col gap-4">
            {formError ? <Notice>{formError}</Notice> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="rate-value" label={`Taux (1 ${pair.from} = X ${pair.to})`} hint="Jusqu'à 6 décimales.">
                <input
                  id="rate-value"
                  className={inputClass}
                  inputMode="decimal"
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })}
                  placeholder="0.0065"
                />
              </Field>
              <Field id="rate-date" label="Date d'effet">
                <input
                  id="rate-date"
                  type="date"
                  className={inputClass}
                  value={form.effectiveDate}
                  onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
                />
              </Field>
              <Field id="rate-source" label="Source">
                <input
                  id="rate-source"
                  className={inputClass}
                  value={form.source}
                  maxLength={120}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  placeholder="Banque d'Algérie"
                />
              </Field>
              <Field id="rate-reference" label="Référence" hint="Lien ou document, facultatif.">
                <input
                  id="rate-reference"
                  className={inputClass}
                  value={form.reference}
                  maxLength={300}
                  onChange={(e) => setForm({ ...form, reference: e.target.value })}
                />
              </Field>
            </div>
            <div>
              <button type="submit" className={primaryButton} disabled={busy}>
                {busy ? "Enregistrement…" : "Enregistrer le taux"}
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title="Comment ce tableau est lu" subtitle="Trois règles, pour éviter les comparaisons impossibles.">
        <ul className="flex flex-col gap-2 text-[13.5px] text-[var(--comexa-ink-soft)]">
          <li>
            <Badge tone="info">1</Badge> Un taux vaut pour UNE date. Comparer un devis de mars à une facture
            de septembre avec le cours du jour donne un écart qui n&rsquo;existe pas.
          </li>
          <li>
            <Badge tone="info">2</Badge> La source est obligatoire. Un taux sans origine ne peut être ni
            vérifié ni contesté, donc ne devrait jamais servir à facturer.
          </li>
          <li>
            <Badge tone="info">3</Badge> Les montants ne sont JAMAIS convertis en silence : un solde reste
            dans sa devise, et la conversion est toujours un geste explicite.
          </li>
        </ul>
      </Card>
    </div>
  );
}
