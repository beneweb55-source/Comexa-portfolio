"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Copy, Eye, Filter, Search, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { formatDate, formatTime, messageOf } from "@/lib/api";
import {
  auditDateBoundary,
  auditEntityHref,
  diffAuditPayload,
  MASK_LABEL,
  safeAuditText,
} from "@/lib/admin-diagnostics.mjs";
import {
  Empty,
  Notice,
  SideSheet,
  SkeletonList,
  inputClass,
  primaryButton,
} from "@/components/workspace/ui";

const fieldLabelClass = "cx-audit-field";

const EMPTY_FILTERS = {
  action: "",
  entityType: "",
  entityId: "",
  actorId: "",
  from: "",
  to: "",
};

const STATE_LABEL = {
  added: "Ajouté",
  removed: "Retiré",
  changed: "Modifié",
  unchanged: "Inchangé",
};

function shortId(value) {
  const text = safeAuditText(value);
  if (!text) return "—";
  return text.length > 18 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text;
}

function filterQuery(filters) {
  const params = new URLSearchParams({ perPage: "100" });
  if (filters.action.trim()) params.set("action", filters.action.trim());
  if (filters.entityType.trim()) params.set("entityType", filters.entityType.trim());
  if (filters.entityId.trim()) params.set("entityId", filters.entityId.trim());
  if (filters.actorId.trim()) params.set("actorId", filters.actorId.trim());
  const from = auditDateBoundary(filters.from);
  const to = auditDateBoundary(filters.to, true);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return params.toString();
}

function AuditRow({ log, onOpen }) {
  return (
    <li className="cx-audit-row" data-testid="audit-row">
      <div className="cx-audit-row__when">
        <span className="cx-audit-row__date">{formatDate(log.createdAt)}</span>
        <span className="cx-audit-row__time">{formatTime(log.createdAt)}</span>
      </div>
      <div className="cx-audit-row__actor">
        <strong>{log.actorEmail ?? "Compte supprimé"}</strong>
        <span>{shortId(log.actorId)}</span>
      </div>
      <div className="cx-audit-row__action">
        <span className="cx-audit-code">{log.action}</span>
        <span>{log.entityType}</span>
      </div>
      <div className="cx-audit-row__entity">
        <span>{shortId(log.entityId)}</span>
        <span>{log.ipAddress ?? "IP inconnue"}</span>
      </div>
      <button
        type="button"
        className="cx-audit-row__open"
        data-testid="audit-open"
        aria-label={`Voir le détail de ${log.action}`}
        onClick={() => onOpen(log)}
      >
        <Eye size={17} aria-hidden="true" />
        <span>Détail</span>
      </button>
    </li>
  );
}

function DiffRow({ row }) {
  return (
    <li className={`cx-audit-diff__row cx-audit-diff__row--${row.state}`} data-testid="audit-diff-row">
      <div className="cx-audit-diff__path">{row.label}</div>
      <span className={`cx-audit-tag cx-audit-tag--${row.state}`}>
        {STATE_LABEL[row.state]}
      </span>
      <div className="cx-audit-diff__values">
        <div>
          <span>Avant</span>
          <strong className={row.masked ? "cx-audit-masked" : undefined}>
            {row.before ?? "—"}
          </strong>
        </div>
        <div>
          <span>Après</span>
          <strong className={row.masked ? "cx-audit-masked" : undefined}>
            {row.after ?? "—"}
          </strong>
        </div>
      </div>
    </li>
  );
}

export default function AuditJournalPage() {
  const { user, request } = useAuth();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [copied, setCopied] = useState(false);

  const canRead = can(user, "audit:read:any");
  const hasPermission = useCallback((permission) => can(user, permission), [user]);

  useEffect(() => {
    if (!canRead) return undefined;
    let active = true;
    async function load() {
      // Microtask : l'effet lance une souscription, il ne declenche pas un
      // rendu synchrone en chaine (regle react-hooks/set-state-in-effect).
      await Promise.resolve();
      if (!active) return;
      setError("");
      setLogs(null);
      try {
        const result = await request(`/audit-logs?${filterQuery(applied)}`);
        if (active) setLogs(Array.isArray(result?.data) ? result.data : []);
      } catch (caught) {
        if (active) {
          setError(messageOf(caught));
          setLogs([]);
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [applied, canRead, request]);

  const knownActions = useMemo(
    () => [...new Set((logs ?? []).map((log) => log.action).filter(Boolean))].sort(),
    [logs],
  );
  const knownEntityTypes = useMemo(
    () => [...new Set((logs ?? []).map((log) => log.entityType).filter(Boolean))].sort(),
    [logs],
  );
  const diff = useMemo(
    () => diffAuditPayload(selected?.before, selected?.after),
    [selected],
  );
  const entityHref = selected ? auditEntityHref(selected, hasPermission) : null;
  const activeFilterCount = Object.values(applied).filter(Boolean).length;

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function copyEntityId() {
    if (!selected?.entityId) return;
    try {
      await navigator.clipboard.writeText(selected.entityId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  function closeDetail() {
    setSelected(null);
    setCopied(false);
  }

  return (
    <div className="cx-audit" data-testid="audit-page">
      <section className="cx-redesign__hero">
        <span className="cx-redesign__eyebrow">COMEXA / TRAÇABILITÉ</span>
        <h2>Le journal d’audit, sans angles morts.</h2>
        <p>
          Filtrez par auteur, action, objet ou période, puis lisez l’avant / après
          de chaque événement. Les secrets restent masqués, même dans le détail.
        </p>
        <span className="cx-redesign__chip">
          <ShieldCheck size={14} /> Contrôle backend : audit:read:any
        </span>
      </section>

      {!canRead ? (
        <Notice tone="error">
          Votre rôle ne permet pas de consulter le journal d’audit. Le backend
          reste la seule autorité pour cette permission.
        </Notice>
      ) : (
        <>
          <form
            className="cx-audit-filters"
            data-testid="audit-filters"
            onSubmit={(event) => {
              event.preventDefault();
              setApplied({ ...filters });
            }}
          >
            <div className="cx-audit-filters__head">
              <div>
                <h3>
                  <Filter size={16} aria-hidden="true" /> Filtres
                </h3>
                <p>Les mêmes critères que ceux vérifiés côté backend.</p>
              </div>
              {activeFilterCount ? (
                <button
                  type="button"
                  className="cx-audit-reset"
                  onClick={() => {
                    setFilters(EMPTY_FILTERS);
                    setApplied(EMPTY_FILTERS);
                  }}
                >
                  <X size={14} /> Effacer ({activeFilterCount})
                </button>
              ) : null}
            </div>
            <div className="cx-audit-filters__grid">
              <label className={fieldLabelClass}>
                Action
                <input
                  className={inputClass}
                  list="audit-action-options"
                  maxLength={64}
                  value={filters.action}
                  onChange={(event) => updateFilter("action", event.target.value)}
                  placeholder="USER_SUSPENDED"
                />
              </label>
              <label className={fieldLabelClass}>
                Type d’objet
                <input
                  className={inputClass}
                  list="audit-entity-options"
                  maxLength={64}
                  value={filters.entityType}
                  onChange={(event) => updateFilter("entityType", event.target.value)}
                  placeholder="User, Quote…"
                />
              </label>
              <label className={fieldLabelClass}>
                ID de l’objet
                <input
                  className={inputClass}
                  maxLength={64}
                  value={filters.entityId}
                  onChange={(event) => updateFilter("entityId", event.target.value)}
                  placeholder="Identifiant technique"
                />
              </label>
              <label className={fieldLabelClass}>
                ID de l’auteur
                <input
                  className={inputClass}
                  maxLength={64}
                  value={filters.actorId}
                  onChange={(event) => updateFilter("actorId", event.target.value)}
                  placeholder="Identifiant du compte"
                />
              </label>
              <label className={fieldLabelClass}>
                Du
                <input
                  type="date"
                  className={inputClass}
                  value={filters.from}
                  onChange={(event) => updateFilter("from", event.target.value)}
                />
              </label>
              <label className={fieldLabelClass}>
                Au
                <input
                  type="date"
                  className={inputClass}
                  value={filters.to}
                  onChange={(event) => updateFilter("to", event.target.value)}
                />
              </label>
            </div>
            <datalist id="audit-action-options">
              {knownActions.map((action) => (
                <option key={action} value={action} />
              ))}
            </datalist>
            <datalist id="audit-entity-options">
              {knownEntityTypes.map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
            <button type="submit" className={primaryButton} data-testid="audit-apply">
              <Search size={15} aria-hidden="true" /> Appliquer les filtres
            </button>
          </form>

          {error ? (
            <Notice tone="error">
              {error}{" "}
              <button type="button" onClick={() => setApplied({ ...applied })}>
                Réessayer
              </button>
            </Notice>
          ) : null}

          {logs === null ? (
            <div className="sui-card" aria-label="Chargement du journal">
              <SkeletonList rows={5} />
            </div>
          ) : (
            <section className="cx-audit-results" aria-labelledby="audit-results-title">
              <div className="cx-audit-results__head">
                <div>
                  <h3 id="audit-results-title">Événements</h3>
                  <p>
                    {logs.length} événement{logs.length > 1 ? "s" : ""} sur cette page
                    {activeFilterCount ? " avec filtres actifs" : ""}.
                  </p>
                </div>
                <span className="cx-audit-results__hint">
                  Un objet supprimé peut mener à une fiche introuvable : l’ID reste la preuve.
                </span>
              </div>
              {logs.length === 0 ? (
                <Empty>Aucun événement ne correspond à ces filtres.</Empty>
              ) : (
                <ol className="cx-audit-list">
                  {logs.map((log) => (
                    <AuditRow key={log.id} log={log} onOpen={setSelected} />
                  ))}
                </ol>
              )}
            </section>
          )}

          <SideSheet
            open={Boolean(selected)}
            onClose={closeDetail}
            widthClass="cx-audit-drawer"
            title={selected?.action ?? "Événement"}
            subtitle={selected ? `${selected.entityType} · ${formatDate(selected.createdAt)} à ${formatTime(selected.createdAt)}` : ""}
            footer={
              selected ? (
                <>
                  {entityHref ? (
                    <Link
                      href={entityHref.href}
                      className={primaryButton}
                      data-testid="audit-detail-link"
                    >
                      <ArrowUpRight size={15} aria-hidden="true" />
                      {entityHref.label}
                    </Link>
                  ) : (
                    <span className="cx-audit-no-link">
                      Objet supprimé, rubrique absente ou droit insuffisant.
                    </span>
                  )}
                  <button
                    type="button"
                    className="cx-audit-copy"
                    onClick={copyEntityId}
                    disabled={!selected.entityId}
                    data-testid="audit-copy-id"
                  >
                    <Copy size={15} aria-hidden="true" />
                    {copied ? "ID copié" : "Copier l’ID"}
                  </button>
                  <button type="button" className="cx-audit-copy" onClick={closeDetail}>
                    Fermer
                  </button>
                </>
              ) : null
            }
          >
            {selected ? (
              <div className="cx-audit-detail" data-testid="audit-detail">
                <dl className="cx-audit-meta">
                  <div>
                    <dt>Auteur</dt>
                    <dd>{selected.actorEmail ?? "Compte supprimé"}</dd>
                  </div>
                  <div>
                    <dt>ID auteur</dt>
                    <dd className="cx-audit-break">{safeAuditText(selected.actorId) || "—"}</dd>
                  </div>
                  <div>
                    <dt>Objet</dt>
                    <dd>{selected.entityType}</dd>
                  </div>
                  <div>
                    <dt>ID objet</dt>
                    <dd className="cx-audit-break">{safeAuditText(selected.entityId) || "—"}</dd>
                  </div>
                  <div>
                    <dt>Adresse IP</dt>
                    <dd className="cx-audit-break">{safeAuditText(selected.ipAddress) || "Inconnue"}</dd>
                  </div>
                  <div>
                    <dt>Navigateur / agent</dt>
                    <dd className="cx-audit-break">{safeAuditText(selected.userAgent) || "Inconnu"}</dd>
                  </div>
                </dl>

                <div className="cx-audit-detail__diff">
                  <h4>Avant / après</h4>
                  {!diff.hasPayload ? (
                    <p className="cx-audit-muted">
                      Cet événement n’a pas d’état avant / après enregistré.
                    </p>
                  ) : (
                    <>
                      <p className="cx-audit-muted">
                        {diff.changed.length} valeur{diff.changed.length > 1 ? "s" : ""} modifiée
                        {diff.changed.length > 1 ? "s" : ""} ; les données sensibles sont remplacées
                        par « {MASK_LABEL} ».
                      </p>
                      <ul className="cx-audit-diff">
                        {diff.rows.slice(0, 50).map((row) => (
                          <DiffRow key={row.path} row={row} />
                        ))}
                      </ul>
                      {diff.rows.length > 50 ? (
                        <p className="cx-audit-muted">
                          {diff.rows.length - 50} valeur(s) supplémentaire(s) non affichée(s).
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </SideSheet>
        </>
      )}
    </div>
  );
}
