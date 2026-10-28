"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ArrowUpRight, RefreshCw, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/session";
import { can, canAny } from "@/lib/access";
import { formatTime } from "@/lib/api";
import { REQUIRED_FEATURES } from "@/lib/contract.js";
import {
  AGENT_SESSION_JWT_FORWARDING,
  buildAdminHealth,
  HEALTH_STATE,
} from "@/lib/admin-diagnostics.mjs";
import { Notice, SkeletonList } from "@/components/workspace/ui";

const STATE_TONE = {
  operational: "operational",
  degraded: "degraded",
  unavailable: "unavailable",
  unknown: "unknown",
  notConfigured: "notConfigured",
};

function HealthCheck({ check }) {
  return (
    <li
      className={`cx-health-check cx-health-check--${STATE_TONE[check.state]}`}
      data-testid={`health-${check.key}`}
    >
      <div className="cx-health-check__head">
        <strong>{check.label}</strong>
        <span className="cx-health-badge">{HEALTH_STATE[check.state]}</span>
      </div>
      <p>{check.detail}</p>
    </li>
  );
}

/**
 * Diagnostic Comexa Space base sur `/api/health` (public, deja existant) et sur
 * la liste des jetons deja autorisee. Aucun nouvel endpoint, aucun secret.
 *
 * Mail, stockage et cron n'ont pas de sonde reelle : ils restent volontairement
 * « inconnu » ou « verification non configuree ». L'objectif n'est pas de
 * rassurer avec du vert, mais de dire exactement ce qui est verifie.
 */
export default function AdminHealthPanel() {
  const { user, request } = useAuth();
  const visible = canAny(user, [
    "audit:read:any",
    "integration:read:any",
    "setting:read:any",
  ]);
  const canTokens = canAny(user, ["integration:read:any", "integration:manage:any"]);
  const canAudit = can(user, "audit:read:any");
  const [health, setHealth] = useState(null);
  const [tokens, setTokens] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!visible) return undefined;
    let active = true;

    async function load() {
      // Meme raison que le journal : demarrer la verification apres l'effet,
      // pas dans un rendu synchrone en cascade.
      await Promise.resolve();
      if (!active) return;
      setLoading(true);
      setError("");
      let payload = null;
      let healthError = "";
      try {
        const response = await fetch("/api/health", {
          headers: { Accept: "application/json" },
          credentials: "same-origin",
          cache: "no-store",
        });
        payload = await response.json();
        if (!response.ok || !payload?.success) {
          healthError = `La sonde /api/health a répondu ${response.status}.`;
        }
      } catch (caught) {
        healthError = caught?.message || "Sonde API injoignable.";
      }

      let tokenItems = null;
      if (canTokens) {
        try {
          const result = await request("/integrations/tokens?perPage=100");
          tokenItems = Array.isArray(result?.data) ? result.data : [];
        } catch {
          tokenItems = null;
        }
      }

      if (active) {
        setHealth(payload);
        setTokens(tokenItems);
        setError(healthError);
        setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [visible, canTokens, request, refreshKey]);

  const model = useMemo(
    () =>
      buildAdminHealth({
        responseOk: health?.success === true,
        payload: health,
        error: error || null,
        requiredFeatures: REQUIRED_FEATURES,
        tokens,
        agentSessionJwtForwarding: AGENT_SESSION_JWT_FORWARDING,
      }),
    [health, error, tokens],
  );

  if (!visible) return null;

  return (
    <section
      className="cx-health-panel"
      data-testid="admin-health-panel"
      aria-labelledby="admin-health-title"
    >
      <div className="cx-health-panel__head">
        <div>
          <span className="cx-health-panel__eyebrow">
            <Activity size={14} aria-hidden="true" /> ÉTAT DE LA PLATEFORME
          </span>
          <h3 id="admin-health-title">Ce qui est réellement vérifié</h3>
          <p>
            {model.summary.label}. {model.summary.verified} contrôle(s) confirmé(s), {" "}
            {model.summary.unverified} sans sonde exploitable.
          </p>
        </div>
        <button
          type="button"
          className="cx-health-refresh"
          onClick={() => setRefreshKey((value) => value + 1)}
          disabled={loading}
          data-testid="health-refresh"
        >
          <RefreshCw size={15} aria-hidden="true" className={loading ? "cx-health-spin" : ""} />
          Actualiser
        </button>
      </div>

      {error ? (
        <Notice tone="error">
          {error} Les contrôles non vérifiés restent affichés comme tels.
        </Notice>
      ) : null}

      {loading ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          <div className="cx-health-summary" aria-live="polite">
            <span className="cx-health-summary__state">
              {HEALTH_STATE[model.summary.state]}
            </span>
            <span>
              Dernière vérification : {formatTime(model.checkedAt)}
              {model.contractVersion ? ` · contrat ${model.contractVersion}` : ""}
            </span>
          </div>
          <ul className="cx-health-list">
            {model.checks.map((check) => (
              <HealthCheck key={check.key} check={check} />
            ))}
          </ul>
          {model.risks.length ? (
            <ul className="cx-health-risks" aria-label="Risques confirmés">
              {model.risks.map((risk) => (
                <li key={risk.key} data-testid={`health-risk-${risk.key}`}>
                  <ShieldAlert size={16} aria-hidden="true" />
                  <div>
                    <strong>
                      {risk.label} · {HEALTH_STATE[risk.state]}
                    </strong>
                    <p>{risk.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="cx-health-actions">
            {canTokens ? (
              <Link href="/espace-comexa/integrations">
                Revoir les jetons <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            ) : null}
            {canAudit ? (
              <Link href="/espace-comexa/journal">
                Ouvrir le journal <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
