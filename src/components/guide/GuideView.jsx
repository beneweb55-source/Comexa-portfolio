"use client";

/**
 * « GUIDE DE DÉMARRAGE » — la page courte.
 *
 * Une liste de gestes, pas un programme : chaque ligne dit quoi faire, pourquoi,
 * et où. La coche est constatée par le serveur (ou, pour une simple visite, par
 * une micro-question dans la pastille) — jamais par un clic « terminé ».
 *
 * Page volontairement sans hiérarchie pédagogique : ni niveau, ni module, ni
 * bilan, ni note. On peut la rouvrir à tout moment ; les étapes déjà faites
 * restent visibles, décochées puis recochées si les données disparaissent.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Circle, Compass, RefreshCw } from "lucide-react";
import PageHeader from "@/components/softui/PageHeader";
import { Alert, ProgressBar } from "@/components/softui";
import { useGuide } from "@/lib/guide/guide-context";

const SPACE_TITLE = {
  personal: "Votre espace personnel",
  team: "L’espace équipe",
  comexa: "Comexa Space",
  client: "Votre espace client",
};

const SPACE_WHY = {
  personal: "Trois gestes suffisent pour que votre journée tienne toute seule.",
  team: "Deux réflexes qui évitent les allers-retours par e-mail.",
  comexa: "Ce que vous modifiez ici est publié : mieux vaut le savoir avant de cliquer.",
  client: "Suivre vos devis et vos demandes depuis l’outil, sans passer par le téléphone.",
};

function StepRow({ step }) {
  const { complete, busyStepId } = useGuide();
  const [feedback, setFeedback] = useState(null);
  const busy = busyStepId === step.id;

  const check = async () => {
    setFeedback(null);
    const result = await complete(step.id);
    if (result?.ok === false && result.correction) {
      setFeedback({ tone: "warning", text: result.correction.explanation });
    } else if (!result) {
      setFeedback({ tone: "warning", text: "Pas encore détecté : faites le geste, puis réessayez." });
    } else {
      setFeedback(null);
    }
  };

  return (
    <li
      style={{
        display: "grid",
        gap: 6,
        padding: "12px 14px",
        borderRadius: 16,
        background: step.done ? "var(--green)" : "var(--surface)",
        border: "1px solid var(--line-soft)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span aria-hidden="true" style={{ marginTop: 2, color: step.done ? "var(--ink)" : "var(--muted)" }}>
          {step.done ? <Check size={17} strokeWidth={2.4} /> : <Circle size={15} strokeWidth={1.9} />}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            {step.title}
            <span className="sui-visually-hidden">{step.done ? " — fait" : " — à faire"}</span>
          </p>
          <p style={{ margin: "3px 0 0", fontSize: 13, lineHeight: 1.45 }}>{step.prompt}</p>
          <p style={{ margin: "3px 0 0", fontSize: 12.5, lineHeight: 1.4, color: "var(--muted)" }}>{step.why}</p>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <Link
            href={step.target ? `${step.href}?guide=${encodeURIComponent(step.id)}` : step.href}
            className="sui-btn"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5 }}
          >
            {step.kind === "visit" ? "Ouvrir" : "Faire"}
            <ArrowRight size={14} strokeWidth={1.9} />
          </Link>
          {step.kind === "action" ? (
            <button
              type="button"
              onClick={check}
              disabled={busy}
              className="sui-btn"
              style={{ fontSize: 12.5, opacity: busy ? 0.6 : 1 }}
            >
              {busy ? "…" : "Vérifier"}
            </button>
          ) : null}
        </div>
      </div>
      {feedback ? <Alert tone={feedback.tone}>{feedback.text}</Alert> : null}
    </li>
  );
}

export default function GuideView({ space }) {
  const { overview, status, refresh, openGuide } = useGuide();
  const [refreshing, setRefreshing] = useState(false);

  // La page d'un espace ne montre QUE ses étapes : le guide est une aide de
  // démarrage, pas un sommaire de toute la plateforme.
  const groups = useMemo(() => {
    if (!overview) return [];
    return space ? overview.spaces.filter((group) => group.id === space) : overview.spaces;
  }, [overview, space]);

  // Sur la page d'un espace, l'avancement affiché est celui de CET espace.
  const shownSteps = groups.flatMap((group) => group.steps);
  const done = space ? shownSteps.filter((step) => step.done).length : (overview?.done ?? 0);
  const total = space ? shownSteps.length : (overview?.total ?? 0);
  const percent = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Compass}
        iconTone="yellow"
        breadcrumb="Guide de démarrage"
        title="Premiers pas"
        subtitle="Quelques gestes utiles, dans l’outil réel. Rien à apprendre par cœur : on fait, on vérifie, on passe au suivant."
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="sui-btn"
              onClick={() => {
                setRefreshing(true);
                void refresh().finally(() => setRefreshing(false));
              }}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}
            >
              <RefreshCw size={15} strokeWidth={1.9} className={refreshing ? "animate-spin" : undefined} />
              Actualiser
            </button>
            <button
              type="button"
              className="sui-btn sui-btn--dark"
              onClick={openGuide}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}
            >
              <Compass size={15} strokeWidth={1.9} />
              Ouvrir la pastille
            </button>
          </div>
        }
      />

      {status === "loading" && !overview ? (
        <p style={{ fontSize: 13.5, color: "var(--muted)" }}>Chargement du guide…</p>
      ) : null}

      {status === "error" && !overview ? (
        <Alert tone="warning">
          Le guide n’a pas pu être chargé. Les écrans de travail restent disponibles ; réessayez avec « Actualiser ».
        </Alert>
      ) : null}

      {overview ? (
        <section
          style={{
            background: "var(--card)",
            border: "1px solid var(--line)",
            borderRadius: 20,
            padding: "16px 18px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <strong style={{ fontSize: 15 }}>
              {done} sur {total} {total > 1 ? "étapes faites" : "étape faite"}
            </strong>
            {done === total && total > 0 ? (
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Tout est en place. Le guide reste accessible.</span>
            ) : null}
          </div>
          <ProgressBar value={percent} ratio={`${done}/${total}`} tone="green" label="Étapes faites" />
        </section>
      ) : null}

      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`guide-${group.id}`}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
            <h2 id={`guide-${group.id}`} style={{ margin: 0, fontSize: 15.5, fontWeight: 700 }}>
              {SPACE_TITLE[group.id] ?? group.label}
            </h2>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {group.done}/{group.total}
            </span>
            {group.id === space && SPACE_WHY[group.id] ? (
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{SPACE_WHY[group.id]}</span>
            ) : null}
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {group.steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </ul>
        </section>
      ))}

      {overview && (space ? shownSteps.length === 0 : overview.total === 0) ? (
        <Alert tone="warning">Aucune étape ne correspond à vos droits dans cet espace pour l’instant.</Alert>
      ) : null}
    </div>
  );
}
