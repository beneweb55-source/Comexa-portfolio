"use client";

import { useState } from "react";
import { formatDate, formatMoney, messageOf } from "@/lib/api";
import { useAction, useListing } from "@/lib/use-listing";
import { useAuth } from "@/lib/session";
import { Badge, Card, ConfirmDialog, Empty, Field, Notice, inputClass, primaryButton, secondaryButton, textareaClass } from "@/components/workspace/ui";

/*
 * Contenu du site public, géré depuis l'espace équipe. Une seule mécanique pour
 * les cinq ressources : chaque onglet décrit ses champs. Les listes passent par
 * `useListing` (erreur affichée, liste conservée) et les écritures par `useAction`.
 *
 * Règles reprises de l'API : un champ optionnel vidé est envoyé à `null` (effacement) ;
 * les listes (points forts, exclusions) sont saisies une par ligne.
 */

const TABS = [
  { key: "services", label: "Services", path: "/content/services", toggle: "isActive", toggleLabel: "Visible sur le site" },
  { key: "packages", label: "Packs et tarifs", path: "/content/packages", toggle: "isActive", toggleLabel: "Visible sur le site" },
  { key: "testimonials", label: "Témoignages", path: "/content/testimonials", toggle: "isPublished", toggleLabel: "Publié" },
  { key: "partners", label: "Partenaires", path: "/content/partners", toggle: "isActive", toggleLabel: "Visible sur le site" },
  { key: "faqs", label: "Questions fréquentes", path: "/content/faqs", toggle: "isPublished", toggleLabel: "Publiée" },
];

const FIELDS = {
  services: [
    { name: "title", label: "Titre", required: true },
    { name: "shortDescription", label: "Description courte", required: true, area: true },
    { name: "description", label: "Description détaillée", area: true },
    { name: "features", label: "Points forts (un par ligne)", list: true, area: true },
    { name: "icon", label: "Icône" },
    { name: "startingPrice", label: "Prix de départ (facultatif, laisser vide si non communiqué)", number: true },
    { name: "startingPriceCurrency", label: "Devise du prix de départ (DZD, EUR ou USD)" },
    { name: "order", label: "Ordre", number: true },
    { name: "isFeatured", label: "Mis en avant", bool: true },
    { name: "isActive", label: "Visible sur le site", bool: true },
  ],
  packages: [
    { name: "name", label: "Nom", required: true },
    { name: "tagline", label: "Accroche" },
    { name: "description", label: "Description", area: true },
    { name: "features", label: "Inclus (un par ligne)", list: true, area: true },
    { name: "excludes", label: "Non inclus (un par ligne)", list: true, area: true },
    { name: "badge", label: "Badge" },
    { name: "order", label: "Ordre", number: true },
    { name: "isFeatured", label: "Mis en avant", bool: true },
    { name: "isActive", label: "Visible sur le site", bool: true },
  ],
  testimonials: [
    { name: "authorName", label: "Auteur", required: true },
    { name: "authorRole", label: "Fonction" },
    { name: "authorCompany", label: "Entreprise" },
    { name: "quote", label: "Témoignage", required: true, area: true },
    { name: "rating", label: "Note (1 à 5)", number: true },
    { name: "order", label: "Ordre", number: true },
  ],
  partners: [
    { name: "name", label: "Nom", required: true },
    { name: "websiteUrl", label: "Site web (https://…)" },
    { name: "order", label: "Ordre", number: true },
    { name: "isActive", label: "Visible sur le site", bool: true },
  ],
  faqs: [
    { name: "question", label: "Question", required: true },
    { name: "answer", label: "Réponse", required: true, area: true },
    { name: "category", label: "Catégorie" },
    { name: "order", label: "Ordre", number: true },
    { name: "isPublished", label: "Publiée", bool: true },
  ],
};

const TITLE_KEY = { services: "title", packages: "name", testimonials: "authorName", partners: "name", faqs: "question" };
const SUBTITLE_KEY = { services: "shortDescription", packages: "tagline", testimonials: "quote", partners: "websiteUrl", faqs: "answer" };

function toForm(tab, item) {
  const form = {};
  for (const field of FIELDS[tab]) {
    const value = item?.[field.name];
    if (field.list) form[field.name] = Array.isArray(value) ? value.join("\n") : "";
    else if (field.bool) form[field.name] = Boolean(value);
    else form[field.name] = value ?? "";
  }
  return form;
}

function toPayload(tab, form) {
  const payload = {};
  for (const field of FIELDS[tab]) {
    const raw = form[field.name];
    if (field.bool) payload[field.name] = Boolean(raw);
    else if (field.number) payload[field.name] = raw === "" || raw === null ? null : Number(raw);
    else if (field.list) payload[field.name] = String(raw ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    else payload[field.name] = String(raw ?? "").trim() === "" ? null : String(raw).trim();
  }
  // Un champ obligatoire ne peut pas être effacé : il reste une chaîne (la validation le dira).
  for (const field of FIELDS[tab]) if (field.required && payload[field.name] === null) payload[field.name] = "";
  return payload;
}

export default function ContenuPage() {
  const [tab, setTab] = useState("services");
  const config = TABS.find((item) => item.key === tab);

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="Contenus du site" className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className={tab === item.key ? primaryButton : secondaryButton}
          >
            {item.label}
          </button>
        ))}
      </div>
      <ContentList key={tab} config={config} />
    </div>
  );
}

function ContentList({ config }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null); // null = fermé, {} = création, item = édition
  const [pendingDelete, setPendingDelete] = useState(null);
  const [openRates, setOpenRates] = useState(null);
  const listing = useListing(`${config.path}?perPage=100${query ? `&search=${encodeURIComponent(query)}` : ""}`);
  const action = useAction(listing.reload);
  const items = listing.items ?? [];
  const title = (item) => item[TITLE_KEY[config.key]] ?? "Sans titre";
  const subtitle = (item) => item[SUBTITLE_KEY[config.key]];

  async function toggle(item) {
    await action.run(
      `toggle:${item.id}`,
      `${config.path}/${item.id}${config.key === "testimonials" ? "/publication" : ""}`,
      { method: "PATCH", body: { [config.toggle]: !item[config.toggle] } },
      "Modification enregistrée.",
    );
  }

  async function remove() {
    const target = pendingDelete;
    const result = await action.run(`delete:${target.id}`, `${config.path}/${target.id}`, { method: "DELETE" }, "Élément retiré.");
    if (result !== null) setPendingDelete(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {listing.error ? <Notice>{listing.error}</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}

      <Card
        title={config.label}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setQuery(search.trim());
              }}
              className="flex gap-2"
            >
              <input aria-label="Rechercher" className={`${inputClass} !w-[200px]`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher" />
              <button type="submit" className={secondaryButton}>Chercher</button>
            </form>
            <button type="button" className={primaryButton} onClick={() => setEditing({})}>Ajouter</button>
          </div>
        }
      >
        {listing.items === null && !listing.error ? <p className="cx-small">Chargement…</p> : null}
        {listing.items !== null && items.length === 0 ? <Empty>Aucun élément pour le moment.</Empty> : null}

        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] p-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-[16px] font-semibold text-[var(--comexa-ink)]">{title(item)}</h3>
                {subtitle(item) ? <p className="line-clamp-2 text-[13.5px] text-[var(--comexa-ink-soft)]">{subtitle(item)}</p> : null}
                <p className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone={item[config.toggle] ? "success" : "neutral"}>{item[config.toggle] ? config.toggleLabel : "Masqué"}</Badge>
                  {item.isFeatured ? <Badge tone="info">Mis en avant</Badge> : null}
                  {item.order !== undefined ? <Badge>Ordre {item.order}</Badge> : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={secondaryButton} onClick={() => toggle(item)} disabled={action.busy === `toggle:${item.id}`}>
                  {item[config.toggle] ? "Masquer" : "Afficher"}
                </button>
                <button type="button" className={secondaryButton} onClick={() => setEditing(item)}>Modifier</button>
                {config.key === "packages" ? (
                  <button type="button" className={secondaryButton} onClick={() => setOpenRates(openRates === item.id ? null : item.id)}>
                    Tarifs
                  </button>
                ) : null}
                <button type="button" className={secondaryButton} onClick={() => setPendingDelete(item)}>Retirer</button>
              </div>
              {config.key === "packages" && openRates === item.id ? <RatesPanel pack={item} /> : null}
            </li>
          ))}
        </ul>
      </Card>

      {editing !== null ? (
        <ContentForm
          key={editing.id ?? "new"}
          config={config}
          item={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await listing.reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Retirer cet élément ?"
        confirmLabel="Retirer"
        tone="danger"
        busy={pendingDelete !== null && action.busy === `delete:${pendingDelete.id}`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={remove}
      >
        <p className="cx-small">{pendingDelete ? `« ${title(pendingDelete)} » ne sera plus affiché sur le site.` : ""}</p>
      </ConfirmDialog>
    </div>
  );
}

function ContentForm({ config, item, onClose, onSaved }) {
  const { request } = useAuth();
  const [form, setForm] = useState(() => toForm(config.key, item));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  function set(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    const missing = {};
    for (const field of FIELDS[config.key]) {
      if (field.required && !String(form[field.name] ?? "").trim()) missing[field.name] = "Ce champ est obligatoire.";
    }
    setFieldErrors(missing);
    if (Object.keys(missing).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      const payload = toPayload(config.key, form);
      if (item) {
        await request(`${config.path}/${item.id}`, { method: "PATCH", body: payload });
      } else {
        await request(config.path, { method: "POST", body: payload });
      }
      await onSaved();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={item ? "Modifier" : "Nouvel élément"}>
      <form onSubmit={submit} className="grid gap-5 md:grid-cols-2">
        {error ? <div className="md:col-span-2"><Notice>{error}</Notice></div> : null}
        {FIELDS[config.key].map((field) => {
          const id = `${config.key}-${field.name}`;
          const errorText = fieldErrors[field.name];
          if (field.bool) {
            return (
              <label key={field.name} className="flex items-center gap-2 text-[14px] md:col-span-2">
                <input type="checkbox" checked={Boolean(form[field.name])} onChange={(e) => set(field.name, e.target.checked)} />
                {field.label}
              </label>
            );
          }
          const common = { id, value: form[field.name], onChange: (e) => set(field.name, e.target.value), "aria-invalid": errorText ? true : undefined };
          return (
            <div key={field.name} className={field.area ? "md:col-span-2" : ""}>
              <Field id={id} label={field.label + (field.required ? " *" : "")} error={errorText}>
                {field.area ? (
                  <textarea rows={field.list ? 4 : 3} className={textareaClass} {...common} />
                ) : (
                  <input className={inputClass} type={field.number ? "number" : "text"} {...common} />
                )}
              </Field>
            </div>
          );
        })}
        <div className="flex gap-3 md:col-span-2">
          <button type="submit" disabled={busy} className={primaryButton}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
          <button type="button" onClick={onClose} className={secondaryButton}>Annuler</button>
        </div>
      </form>
    </Card>
  );
}

/** Tarifs d'un pack : une ligne par tarif, jamais de modification (la ligne reste pour l'historique). */
function RatesPanel({ pack }) {
  const rates = useListing(`/content/packages/${pack.id}/rates`);
  const action = useAction(rates.reload);
  const [form, setForm] = useState({ amount: "", currency: "DZD", effectiveFrom: new Date().toISOString().slice(0, 10) });

  async function add(event) {
    event.preventDefault();
    await action.run(
      "add",
      `/content/packages/${pack.id}/rates`,
      { method: "POST", body: { amount: Number(form.amount), currency: form.currency, effectiveFrom: new Date(form.effectiveFrom).toISOString() } },
      "Tarif ajouté.",
    );
    setForm((current) => ({ ...current, amount: "" }));
  }

  const items = rates.items ?? [];

  return (
    <div className="w-full rounded-lg bg-[var(--comexa-neutral-100)] p-4">
      <h4 className="mb-3 text-[15px] font-semibold text-[var(--comexa-ink)]">Tarifs de « {pack.name} »</h4>
      {rates.error ? <Notice>{rates.error}</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">{action.success}</Notice> : null}
      {rates.items !== null && items.length === 0 ? <p className="cx-small">Aucun tarif.</p> : null}
      <ul className="mb-4 flex flex-col gap-2">
        {items.map((rate) => (
          <li key={rate.id} className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
            <span>
              {formatMoney(rate.amount, rate.currency)} · à partir du {formatDate(rate.effectiveFrom)}
            </span>
            <span className="flex items-center gap-2">
              <Badge tone={rate.isActive ? "success" : "neutral"}>{rate.isActive ? "Actif" : "Retiré"}</Badge>
              {rate.isActive ? (
                <button type="button" className={secondaryButton} onClick={() => action.run(`deactivate:${rate.id}`, `/content/packages/${pack.id}/rates/${rate.id}/deactivate`, { method: "PATCH" }, "Tarif retiré de la vente.")}>
                  Retirer
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <Field id="rate-amount" label="Montant">
          <input id="rate-amount" type="number" min="0.01" step="0.01" required className={`${inputClass} !w-[150px]`} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field id="rate-currency" label="Devise">
          <select id="rate-currency" className={`${inputClass} !w-[110px]`} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            <option value="DZD">DZD</option>
            <option value="EUR">EUR</option>
          </select>
        </Field>
        <Field id="rate-date" label="En vigueur le">
          <input id="rate-date" type="date" required className={`${inputClass} !w-[170px]`} value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
        </Field>
        <button type="submit" disabled={action.busy === "add"} className={primaryButton}>Ajouter le tarif</button>
      </form>
    </div>
  );
}
