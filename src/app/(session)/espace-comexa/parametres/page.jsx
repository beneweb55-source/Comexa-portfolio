"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Clock3,
  SlidersHorizontal,
  ShieldCheck,
  ArrowUpRight,
  Save,
  Coins,
  PieChart,
  ArrowLeftRight,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { settingsImpactForTab } from "@/lib/admin-diagnostics.mjs";
import { useAuth } from "@/lib/session";
import { useTimePreferences } from "@/lib/use-time-preferences";
import {
  Card,
  Field,
  Notice,
  inputClass,
  primaryButton,
  selectClass,
  textareaClass,
} from "@/components/workspace/ui";
import CurrencyPanel from "@/components/workspace/CurrencyPanel";
import ExchangeRatePanel from "@/components/workspace/ExchangeRatePanel";
import DistributionPanel from "@/components/workspace/DistributionPanel";

const FIELDS = [
  {
    key: "company.name",
    label: "Nom de l’organisation",
    placeholder: "Comexa",
    required: true,
  },
  {
    key: "company.email",
    label: "E-mail de contact",
    type: "email",
    placeholder: "contact@exemple.dz",
  },
  {
    key: "company.phone",
    label: "Téléphone",
    type: "tel",
    placeholder: "+213…",
  },
  {
    key: "company.website",
    label: "Site internet",
    type: "url",
    placeholder: "https://…",
  },
  {
    key: "company.legal.address",
    label: "Adresse de l’organisation",
    area: true,
  },
];
const KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/** Dit ouvertement ce que le reglage fait reellement dans le code courant. */
function SettingsImpactNotice({ tab }) {
  const impact = settingsImpactForTab(tab);
  if (!impact) return null;
  return (
    <div
      className={`cx-settings-impact cx-settings-impact--${impact.tone}`}
      role="status"
      data-testid="settings-impact"
    >
      <strong>{impact.title}</strong>
      <p>{impact.body}</p>
    </div>
  );
}

export default function ParametresPage() {
  const { request, user } = useAuth();
  const writable = can(user, "setting:write:any");
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  // L'onglet peut venir de l'URL (`?onglet=devises`) : c'est la forme que prend
  // une redirection post-action vers les réglages (voir `settingsCurrencies()`
  // dans `url-builder.service.ts`). Sans cette lecture, enregistrer un taux
  // renvoyait bien sur la page des réglages… mais sur l'onglet Organisation,
  // c'est-à-dire ailleurs que là où l'utilisateur vient de travailler.
  const searchParams = useSearchParams();
  const router = useRouter();
  const askedTab = searchParams?.get("onglet");
  const SETTINGS_TABS = ["agency", "devises", "taux", "repartitions", "time", "advanced"];
  const [tab, setTab] = useState(() =>
    SETTINGS_TABS.includes(askedTab) ? askedTab : "agency",
  );

  // L'onglet est reflété dans l'URL, dans les deux sens.
  //
  // URL → onglet (état initial ci-dessus) : une redirection post-action ou un
  // lien reçu ouvre le bon onglet.
  // Onglet → URL (effet ci-dessous) : l'utilisateur peut mettre la page en
  // favori, ou la transmettre, sans retomber sur l'onglet Organisation.
  //
  // `replace` et non `push` : changer d'onglet n'est pas une navigation, et un
  // `push` par clic remplirait l'historique de six entrées identiques — le
  // bouton « retour » ne ramènerait alors plus à la page précédente mais à
  // l'onglet d'avant, indéfiniment.
  useEffect(() => {
    const current = searchParams?.get("onglet");
    if (current === tab) return;
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (tab === "agency") params.delete("onglet");
    else params.set("onglet", tab);
    const query = params.toString();
    router.replace(query ? `/espace-comexa/parametres?${query}` : "/espace-comexa/parametres", {
      scroll: false,
    });
  }, [tab, searchParams, router]);
  const [advanced, setAdvanced] = useState({
    key: "",
    value: "",
    description: "",
  });
  const load = useCallback(
    (signal) =>
      request("/settings", { signal })
        .then(({ data }) => {
          if (signal?.aborted) return;
          setError(null);
          const rows = data?.settings ?? [];
          setSettings(rows);
          setDraft(
            Object.fromEntries(
              FIELDS.map(({ key }) => [
                key,
                rows.find((row) => row.key === key)?.value ?? "",
              ]),
            ),
          );
        })
        .catch((caught) => {
          if (!signal?.aborted) setError(messageOf(caught));
        }),
    [request],
  );
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const changed =
    settings === null
      ? []
      : FIELDS.filter(
          ({ key }) =>
            draft[key] !==
            (settings?.find((row) => row.key === key)?.value ?? ""),
        );
  useEffect(() => {
    if (!changed.length) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed.length]);

  async function save(rows) {
    if (!writable || busy) return false;
    setBusy(true);
    setNotice(null);
    try {
      const { data } = await request("/settings", {
        method: "PATCH",
        body: { settings: rows },
      });
      const updates = data?.settings ?? rows;
      setSettings((current) => [
        ...(current ?? []).filter(
          (row) => !updates.some((u) => u.key === row.key),
        ),
        ...updates,
      ]);
      setNotice({
        tone: "success",
        text: "Modifications enregistrées pour l’organisation.",
      });
      return true;
    } catch (caught) {
      setNotice({ tone: "error", text: messageOf(caught) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cx-settings cx-redesign">
      <section className="cx-redesign__hero">
        <span className="cx-redesign__eyebrow">COMEXA / CONFIGURATION</span>
        <h2>Un espace à votre mesure.</h2>
        <p>
          Les informations de votre organisation et vos préférences de travail,
          au même endroit.
        </p>
        <span className="cx-redesign__chip">
          <ShieldCheck size={14} />{" "}
          {writable
            ? "Administration de l’organisation"
            : "Consultation des paramètres"}
        </span>
      </section>
      <div className="cx-settings__layout">
        <nav className="cx-settings__nav" aria-label="Catégories de paramètres">
          {[
            ["agency", Building2, "Organisation", "Identité et coordonnées"],
            ["devises", Coins, "Devises", "Marchés internationaux"],
            ["taux", ArrowLeftRight, "Taux de change", "Conversion et historique"],
            ["repartitions", PieChart, "Répartitions", "Parts des bénéficiaires"],
            ["time", Clock3, "Mes préférences", "Saisie du temps"],
            [
              "advanced",
              SlidersHorizontal,
              "Avancé",
              "Configuration technique",
            ],
          ].map(([id, Icon, title, sub]) => (
            <button
              type="button"
              key={id}
              onClick={() => {
                setTab(id);
                setNotice(null);
              }}
              aria-current={tab === id ? "page" : undefined}
            >
              <Icon size={19} />
              <span>
                <strong>{title}</strong>
                <small>{sub}</small>
              </span>
            </button>
          ))}
          <p>
            Les informations de l’agence sont partagées. Vos préférences restent
            propres à ce compte, dans ce navigateur.
          </p>
        </nav>
        <div className="cx-settings__content">
          {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
          <SettingsImpactNotice tab={tab} />
          {tab === "devises" ? <CurrencyPanel /> : null}
          {tab === "taux" ? <ExchangeRatePanel /> : null}
          {tab === "repartitions" ? <DistributionPanel /> : null}
          {tab === "time" ? (
            <TimePreferences />
          ) : (
            <>
              {error ? (
                <Notice>
                  {error}{" "}
                  <button type="button" onClick={() => load()}>
                    Réessayer
                  </button>
                </Notice>
              ) : null}
              {settings === null && ["devises", "taux", "repartitions"].includes(tab) ? null : settings === null ? (
                <Card title="Configuration">
                  <p>
                    {error
                      ? "Les réglages ne sont pas disponibles."
                      : "Chargement des paramètres…"}
                  </p>
                </Card>
              ) : ["devises", "taux", "repartitions"].includes(tab) ? null : tab === "agency" ? (
                <>
                  <Card
                    title="Identité de l’organisation"
                    subtitle="Un référentiel interne pour les administrateurs de Comexa."
                  >
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        save(
                          changed.map(({ key, label }) => ({
                            key,
                            value: draft[key],
                            description: label,
                          })),
                        );
                      }}
                    >
                      <fieldset
                        disabled={!writable || busy}
                        className="cx-settings__fields"
                      >
                        {FIELDS.map((field) => (
                          <div
                            key={field.key}
                            className={field.area ? "cx-settings__wide" : ""}
                          >
                            <Field id={field.key} label={field.label}>
                              {field.area ? (
                                <textarea
                                  id={field.key}
                                  rows={3}
                                  maxLength={1000}
                                  className={textareaClass}
                                  value={draft[field.key]}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      [field.key]: e.target.value,
                                    })
                                  }
                                />
                              ) : (
                                <input
                                  id={field.key}
                                  required={field.required}
                                  type={field.type ?? "text"}
                                  maxLength={300}
                                  className={inputClass}
                                  placeholder={field.placeholder}
                                  value={draft[field.key]}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      [field.key]: e.target.value,
                                    })
                                  }
                                />
                              )}
                            </Field>
                          </div>
                        ))}
                      </fieldset>
                      <p className="cx-redesign__note">
                        Ces coordonnées sont enregistrées dans les paramètres
                        internes. Elles ne remplacent pas automatiquement les
                        coordonnées du site public ou des factures.
                      </p>
                      <div className="cx-settings__save">
                        <span>
                          {changed.length
                            ? `${changed.length} modification(s) non enregistrée(s)`
                            : "Aucune modification en attente"}
                        </span>
                        <button
                          type="submit"
                          className={primaryButton}
                          disabled={!writable || busy || !changed.length}
                        >
                          <Save size={15} />
                          {busy ? "Enregistrement…" : "Enregistrer"}
                        </button>
                      </div>
                    </form>
                  </Card>
                  <div className="cx-settings__links">
                    {[
                      [
                        "/espace-comexa/membres",
                        "Membres",
                        "Gérer les accès à l’organisation",
                        "user:read:any",
                      ],
                      [
                        "/espace-comexa/roles",
                        "Rôles et permissions",
                        "Définir les responsabilités",
                        "role:read:any",
                      ],
                      [
                        "/espace-comexa/integrations",
                        "Intégrations",
                        "Configurer les services connectés",
                        "integration:read:any",
                      ],
                    ]
                      .filter(([, , , permission]) => can(user, permission))
                      .map(([href, title, text]) => (
                        <Link href={href} key={href}>
                          <strong>
                            {title}
                            <ArrowUpRight size={16} />
                          </strong>
                          <small>{text}</small>
                        </Link>
                      ))}
                  </div>
                </>
              ) : (
                <Card
                  title="Configuration avancée"
                  subtitle="Les clés techniques ne produisent un effet que si un module de l’application les utilise."
                >
                  <p className="cx-redesign__note">
                    Ne stockez pas de mots de passe ou de clés d’API ici. Les
                    paramètres internes sensibles sont masqués.
                  </p>
                  <label className="cx-settings__picker">
                    Paramètre existant
                    <select
                      className={selectClass}
                      value={advanced.key}
                      onChange={(e) => {
                        const row = settings.find(
                          (s) => s.key === e.target.value,
                        );
                        setAdvanced(
                          row
                            ? {
                                key: row.key,
                                value: JSON.stringify(row.value, null, 2),
                                description: row.description ?? "",
                              }
                            : { key: "", value: "", description: "" },
                        );
                      }}
                    >
                      <option value="">Nouveau paramètre</option>
                      {settings.map((row) => (
                        <option key={row.key} value={row.key}>
                          {row.key}
                        </option>
                      ))}
                    </select>
                  </label>
                  <form
                    className="cx-settings__advanced"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      try {
                        if (!KEY_PATTERN.test(advanced.key))
                          throw new Error(
                            "Utilisez des segments minuscules séparés par un point, tiret ou tiret bas.",
                          );
                        const value = JSON.parse(advanced.value);
                        if (value === null)
                          throw new Error(
                            "Une valeur nulle n’est pas autorisée.",
                          );
                        if (
                          FIELDS.some((f) => f.key === advanced.key) &&
                          typeof value !== "string"
                        )
                          throw new Error(
                            "Les coordonnées de l’organisation doivent être du texte.",
                          );
                        if (
                          await save([
                            {
                              key: advanced.key,
                              value,
                              description: advanced.description,
                            },
                          ])
                        ) {
                          if (FIELDS.some((f) => f.key === advanced.key))
                            setDraft((old) => ({
                              ...old,
                              [advanced.key]: value,
                            }));
                        }
                      } catch (caught) {
                        setNotice({ tone: "error", text: messageOf(caught) });
                      }
                    }}
                  >
                    <fieldset
                      disabled={!writable || busy}
                      className="cx-settings__fields"
                    >
                      <Field id="advanced-key" label="Clé">
                        <input
                          id="advanced-key"
                          className={inputClass}
                          required
                          maxLength={80}
                          value={advanced.key}
                          onChange={(e) =>
                            setAdvanced({ ...advanced, key: e.target.value })
                          }
                        />
                      </Field>
                      <Field id="advanced-description" label="Description">
                        <input
                          id="advanced-description"
                          className={inputClass}
                          maxLength={300}
                          value={advanced.description}
                          onChange={(e) =>
                            setAdvanced({
                              ...advanced,
                              description: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <div className="cx-settings__wide">
                        <Field
                          id="advanced-value"
                          label="Valeur JSON"
                          hint={'Exemples : "texte", 60, true, ["a", "b"]'}
                        >
                          <textarea
                            id="advanced-value"
                            className={textareaClass}
                            required
                            rows={5}
                            value={advanced.value}
                            onChange={(e) =>
                              setAdvanced({
                                ...advanced,
                                value: e.target.value,
                              })
                            }
                          />
                        </Field>
                      </div>
                    </fieldset>
                    <button
                      type="submit"
                      className={primaryButton}
                      disabled={!writable || busy}
                    >
                      {busy ? "Enregistrement…" : "Enregistrer le paramètre"}
                    </button>
                  </form>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TimePreferences() {
  const { preferences, save } = useTimePreferences();
  const [draft, setDraft] = useState(null);
  const [notice, setNotice] = useState(null);
  const values = draft ?? preferences;
  return (
    <Card
      title="Mes habitudes de saisie"
      subtitle="Appliquées aux prochaines saisies manuelles et à l’ouverture de « Mon temps »."
    >
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            save(values);
            setDraft(null);
            setNotice({
              tone: "success",
              text: "Préférences enregistrées dans ce navigateur pour votre compte.",
            });
          } catch {
            setNotice({
              tone: "error",
              text: "Le stockage du navigateur est indisponible. Vos préférences n’ont pas été enregistrées.",
            });
          }
        }}
      >
        <div className="cx-settings__fields">
          <Field
            id="pref-minutes"
            label="Durée proposée (minutes)"
            hint="Modifiable à chaque saisie."
          >
            <input
              id="pref-minutes"
              type="number"
              min={1}
              max={1440}
              required
              className={inputClass}
              value={values.minutes}
              onChange={(e) =>
                setDraft({
                  ...values,
                  minutes: e.target.value === "" ? "" : Number(e.target.value),
                })
              }
            />
          </Field>
          <Field id="pref-period" label="Période à l’ouverture">
            <select
              id="pref-period"
              className={selectClass}
              value={values.period}
              onChange={(e) => setDraft({ ...values, period: e.target.value })}
            >
              <option value="today">Aujourd’hui</option>
              <option value="week">Cette semaine (depuis lundi)</option>
              <option value="month">Ce mois-ci</option>
              <option value="all">Tout l’historique</option>
            </select>
          </Field>
        </div>
        <label className="cx-settings__toggle">
          <span>
            <strong>Temps facturable par défaut</strong>
            <small>
              Préremplit la case des saisies manuelles. Ne modifie pas les
              saisies existantes.
            </small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={values.billable}
            onChange={(e) =>
              setDraft({ ...values, billable: e.target.checked })
            }
          />
        </label>
        <div className="cx-settings__save">
          <span>Personnel · Ce navigateur uniquement</span>
          <button className={primaryButton} type="submit">
            Enregistrer mes préférences
          </button>
        </div>
      </form>
      <Link className="cx-redesign__text-link" href="/espace-personnel/temps">
        Ouvrir Mon temps <ArrowUpRight size={15} />
      </Link>
    </Card>
  );
}
