"use client";

import { useCallback, useEffect, useState } from "react";
import { messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { Card, Empty, Field, Notice, inputClass, primaryButton, secondaryButton, textareaClass } from "@/components/workspace/ui";

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Paramètres de l'agence. Valeurs JSON (chaîne, nombre, booléen, tableau ou objet simple).
 * L'API accepte un lot : on enregistre une ligne à la fois, avec son erreur sous les yeux.
 */
export default function ParametresPage() {
  const { request } = useAuth();
  const [settings, setSettings] = useState({ items: null, error: null });
  const [drafts, setDrafts] = useState({});
  const [newKey, setNewKey] = useState({ key: "", value: "", description: "" });
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await request("/settings");
      const items = data?.settings ?? [];
      setSettings({ items, error: null });
      setDrafts(Object.fromEntries(items.map((s) => [s.key, JSON.stringify(s.value, null, 2)])));
    } catch (caught) {
      setSettings((current) => ({ ...current, error: messageOf(caught), forbidden: caught?.status === 403 }));
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(key, rawValue, description) {
    let value;
    try {
      value = JSON.parse(rawValue);
    } catch {
      setNotice({ tone: "error", text: `« ${key} » : la valeur doit être du JSON valide (ex. "EUR", 20, true, ["a"]).` });
      return false;
    }
    setBusy(key);
    setNotice(null);
    try {
      await request("/settings", { method: "PATCH", body: { settings: [{ key, value, description: description || undefined }] } });
      setNotice({ tone: "success", text: `« ${key} » enregistré.` });
      await load();
      return true;
    } catch (caught) {
      setNotice({ tone: "error", text: messageOf(caught) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (settings.forbidden) {
    return (
      <Card title="Paramètres">
        <Notice tone="info">Cette rubrique est réservée aux administrateurs.</Notice>
      </Card>
    );
  }

  const items = settings.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      {settings.error ? <Notice>{settings.error}</Notice> : null}
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

      <Card title="Paramètres de l'agence">
        {settings.items === null && !settings.error ? <p className="cx-small">Chargement…</p> : null}
        {settings.items !== null && items.length === 0 ? <Empty>Aucun paramètre enregistré.</Empty> : null}
        <ul className="flex flex-col gap-5">
          {items.map((setting) => (
            <li key={setting.key} className="rounded-lg border border-[var(--comexa-border-soft)] p-4">
              <div className="mb-3">
                <code className="text-[14px] font-semibold text-[var(--comexa-ink)]">{setting.key}</code>
                {setting.description ? <p className="text-[13.5px] text-[var(--comexa-ink-soft)]">{setting.description}</p> : null}
              </div>
              <label htmlFor={`value-${setting.key}`} className="sr-only">Valeur de {setting.key}</label>
              <textarea
                id={`value-${setting.key}`}
                rows={Math.min(8, Math.max(2, (drafts[setting.key] ?? "").split("\n").length))}
                className={`${textareaClass} font-mono text-[13px]`}
                value={drafts[setting.key] ?? ""}
                onChange={(e) => setDrafts({ ...drafts, [setting.key]: e.target.value })}
              />
              <div className="mt-3 flex gap-3">
                <button type="button" className={primaryButton} disabled={busy === setting.key} onClick={() => save(setting.key, drafts[setting.key] ?? "", setting.description)}>
                  {busy === setting.key ? "Enregistrement…" : "Enregistrer"}
                </button>
                <button type="button" className={secondaryButton} onClick={() => setDrafts({ ...drafts, [setting.key]: JSON.stringify(setting.value, null, 2) })}>
                  Annuler
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Ajouter un paramètre">
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const key = newKey.key.trim();
            if (!KEY_PATTERN.test(key)) {
              setNotice({ tone: "error", text: "La clé ne contient que des minuscules, chiffres, points, tirets et tirets bas." });
              return;
            }
            const ok = await save(key, newKey.value.trim() || "null", newKey.description.trim());
            if (ok) setNewKey({ key: "", value: "", description: "" });
          }}
        >
          <Field id="setting-key" label="Clé" hint="ex. invoice.numbering.prefix">
            <input id="setting-key" className={inputClass} value={newKey.key} onChange={(e) => setNewKey({ ...newKey, key: e.target.value })} />
          </Field>
          <Field id="setting-description" label="Description">
            <input id="setting-description" className={inputClass} value={newKey.description} onChange={(e) => setNewKey({ ...newKey, description: e.target.value })} />
          </Field>
          <div className="md:col-span-2">
            <Field id="setting-value" label="Valeur (JSON)">
              <textarea id="setting-value" rows={2} className={`${textareaClass} font-mono text-[13px]`} value={newKey.value} onChange={(e) => setNewKey({ ...newKey, value: e.target.value })} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <button type="submit" className={primaryButton} disabled={busy === "new"}>Ajouter</button>
          </div>
        </form>
      </Card>
    </div>
  );
}
