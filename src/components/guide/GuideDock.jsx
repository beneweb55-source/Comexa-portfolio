"use client";

/**
 * GUIDE DE DÉMARRAGE — la pastille discrète et la fiche d'UNE étape.
 *
 * Ce que ce composant N'EST PAS, volontairement : un cours, un niveau, une note,
 * un bilan, une session d'entraînement. C'est une aide de démarrage :
 *
 *   une étape à la fois → un geste à faire → une raison en une phrase.
 *
 * La progression ne s'invente pas : `complete()` demande au SERVEUR de
 * constater le geste dans les vraies données. Si le geste n'est pas encore
 * détecté, la réponse le dit et la fiche reste ouverte — aucun bouton ne coche
 * une étape par courtoisie.
 *
 * La pastille peut être mise de côté (« Plus tard ») : l'entrée « Guide de
 * démarrage » du menu reste là pour y revenir.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  CircleCheck,
  Compass,
  MousePointerClick,
  Sparkles,
  X,
} from "lucide-react";
import { useGuide } from "@/lib/guide/guide-context";
import { guideHrefFor, spaceOfPathname, spotlightSelector, stepPosition } from "@/lib/guide/guide-format.mjs";

const SPACE_LABEL = {
  personal: "Espace personnel",
  team: "Espace équipe",
  comexa: "Comexa Space",
  client: "Espace client",
};

const CARD_STYLE = {
  position: "fixed",
  right: 16,
  bottom: 92,
  zIndex: 80,
  width: "min(360px, calc(100vw - 32px))",
  background: "var(--card)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: 20,
  boxShadow: "0 18px 40px rgba(11, 10, 15, 0.18)",
  padding: "14px 16px",
};

/** Fait clignoter le contrôle visé, puis retire l'attribut (aucun état). */
function spot(target) {
  const selector = spotlightSelector(target);
  if (!selector) return false;
  const node = document.querySelector(selector);
  if (!node) return false;
  node.scrollIntoView({ behavior: "smooth", block: "center" });
  node.setAttribute("data-guide-spot", "on");
  window.setTimeout(() => node.removeAttribute("data-guide-spot"), 6000);
  return true;
}

function Dots({ total, done }) {
  if (!total) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} aria-hidden="true">
      {Array.from({ length: total }).map((_, index) => (
        <span
          key={index}
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: index < done ? "var(--ink)" : "var(--line)",
          }}
        />
      ))}
    </span>
  );
}

function GuideButton({ children, onClick, dark = false, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={dark ? "sui-btn sui-btn--dark" : "sui-btn"}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, opacity: disabled ? 0.6 : 1 }}
    >
      {children}
    </button>
  );
}

function StepCard({ step, position, total, onClose, onLater }) {
  const router = useRouter();
  const pathname = usePathname();
  const { complete, busyStepId, notice } = useGuide();
  // La réponse est locale à l'étape : `StepCard` est remonté (`key`) quand on
  // passe à la suivante, donc rien à réinitialiser dans un effet.
  const [answer, setAnswer] = useState(null);
  const busy = busyStepId === step.id;
  const here = pathname === step.href;
  const feedback = notice && notice.stepId === step.id ? notice : null;

  const go = useCallback(() => {
    if (here) {
      // Déjà sur l'écran : on montre le contrôle visé plutôt que de recharger
      // la page et perdre un formulaire en cours de saisie.
      if (step.target) spot(step.target);
      return;
    }
    router.push(step.target ? `${step.href}?guide=${encodeURIComponent(step.id)}` : step.href);
    onClose?.();
  }, [here, onClose, router, step.href, step.id, step.target]);

  return (
    <div role="region" aria-label={`Guide de démarrage — ${step.title}`} style={CARD_STYLE}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Compass size={16} strokeWidth={1.9} aria-hidden="true" />
        <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Premier pas {position} sur {total}
        </span>
        <Dots total={total} done={position - 1} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer le guide"
          style={{ marginLeft: "auto", background: "transparent", border: 0, padding: 4, cursor: "pointer", color: "var(--muted)" }}
        >
          <X size={16} strokeWidth={1.9} />
        </button>
      </div>

      <p style={{ margin: "10px 0 2px", fontSize: 10.5, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {SPACE_LABEL[step.space] ?? "Guide"}
      </p>
      <h2 style={{ margin: 0, fontSize: 17, lineHeight: 1.25 }}>{step.title}</h2>
      <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.45 }}>{step.prompt}</p>
      <p style={{ margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.4, color: "var(--muted)" }}>{step.why}</p>

      {step.kind === "visit" && step.recall ? (
        <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}>
          <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, padding: 0 }}>{step.recall.question}</legend>
          <div style={{ display: "grid", gap: 6 }}>
            {step.recall.options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setAnswer(option.id)}
                aria-pressed={answer === option.id}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  fontSize: 13,
                  borderRadius: 12,
                  border: answer === option.id ? "1px solid var(--ink)" : "1px solid var(--line)",
                  background: answer === option.id ? "var(--yellow)" : "var(--surface)",
                  cursor: "pointer",
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {feedback ? (
        <p
          role={feedback.tone === "success" ? "status" : "alert"}
          style={{
            margin: "10px 0 0",
            padding: "8px 10px",
            borderRadius: 10,
            fontSize: 12.5,
            lineHeight: 1.4,
            background:
              feedback.tone === "success" ? "var(--green)" : feedback.tone === "warning" ? "var(--yellow)" : "var(--pink)",
          }}
        >
          {feedback.text}
        </p>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <GuideButton onClick={go}>
          {here ? <MousePointerClick size={15} strokeWidth={1.9} /> : <ArrowRight size={15} strokeWidth={1.9} />}
          {here ? "Montrer où" : "Aller à l’écran"}
        </GuideButton>
        <GuideButton dark onClick={() => complete(step.id, answer ?? undefined)} disabled={busy || (Boolean(step.recall) && !answer)}>
          <Check size={15} strokeWidth={2.2} />
          {busy ? "Vérification…" : step.kind === "action" ? "C’est fait" : "Valider ma réponse"}
        </GuideButton>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
        {guideHrefFor(pathname) ? (
          <Link
            href={guideHrefFor(pathname)}
            onClick={onClose}
            style={{ fontSize: 12, color: "var(--muted)", textDecoration: "underline" }}
          >
            Voir les {total} étapes
          </Link>
        ) : null}
        <button
          type="button"
          onClick={onLater}
          style={{ marginLeft: "auto", background: "transparent", border: 0, padding: 0, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}
        >
          Plus tard
        </button>
      </div>
    </div>
  );
}

/**
 * Lecture de `?guide=` sans `useSearchParams` : la coque est montée sur TOUTES
 * les pages (y compris celles qui sont prérendues), et `useSearchParams`
 * imposerait une frontière Suspense à chacune. Ici le serveur rend `null`, puis
 * le navigateur relit l'URL — et se met à jour sur `popstate`.
 */
function subscribeLocation(listener) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}

function readGuideParam() {
  return new URLSearchParams(window.location.search).get("guide");
}

export default function GuideDock() {
  const target = useSyncExternalStore(subscribeLocation, readGuideParam, () => null);
  const pathname = usePathname();
  const { status, steps, overview, open, openGuide, closeGuide, hide, dismissed } = useGuide();
  const guideStep = steps.find((entry) => entry.id === target) ?? null;

  // La pastille ne parle QUE de l'espace où l'on se trouve : quatre étapes de
  // « Mes tâches » ne doivent pas se mêler à celles des devis.
  const space = spaceOfPathname(pathname);
  const spaceSteps = space ? steps.filter((step) => step.space === space) : steps;
  const current = spaceSteps.find((step) => step.id === overview?.nextStepId) ?? spaceSteps.find((step) => !step.done) ?? null;

  // Mise en évidence demandée par `?guide=<étape>` (bouton « Aller à l'écran »).
  useEffect(() => {
    if (!guideStep?.target) return undefined;
    const timer = window.setTimeout(() => spot(guideStep.target), 450);
    return () => window.clearTimeout(timer);
  }, [guideStep]);

  // Le paramètre ne sert qu'à montrer un contrôle : on le retire de l'URL pour
  // qu'il ne colle ni au rechargement ni à un lien partagé.
  useEffect(() => {
    if (!target) return undefined;
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("guide")) return;
      url.searchParams.delete("guide");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }, 6500);
    return () => window.clearTimeout(timer);
  }, [target]);

  if (status === "idle" || status === "error" || !overview) return null;
  const total = spaceSteps.length;
  const done = spaceSteps.filter((step) => step.done).length;
  if (total === 0) return null;

  const allDone = !current;
  const position = current ? stepPosition(spaceSteps, current.id) || total : total;
  const guideHref = guideHrefFor(pathname);

  if (!open) {
    if (dismissed && !allDone) {
      return (
        <button
          type="button"
          onClick={openGuide}
          aria-label={`Ouvrir le guide de démarrage (${done} sur ${total})`}
          style={{
            position: "fixed",
            right: 16,
            bottom: 92,
            zIndex: 79,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "var(--card)",
            color: "var(--muted)",
            fontSize: 12,
            cursor: "pointer",
            boxShadow: "0 10px 24px rgba(11, 10, 15, 0.12)",
          }}
        >
          <Compass size={14} strokeWidth={1.9} aria-hidden="true" />
          Guide · {done}/{total}
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={openGuide}
        data-coach-id="guide-launcher"
        aria-label={allDone ? "Guide terminé — revoir les étapes" : `Ouvrir le guide de démarrage (${done} sur ${total})`}
        style={{
          position: "fixed",
          right: 16,
          bottom: 92,
          zIndex: 79,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 14px",
          borderRadius: 999,
          border: "1px solid var(--line)",
          background: allDone ? "var(--green)" : "var(--yellow)",
          color: "var(--ink)",
          fontSize: 12.5,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 10px 24px rgba(11, 10, 15, 0.16)",
        }}
      >
        {allDone ? (
          <CircleCheck size={15} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Sparkles size={15} strokeWidth={1.9} aria-hidden="true" />
        )}
        {allDone ? "Guide terminé" : `Premiers pas · ${done}/${total}`}
      </button>
    );
  }

  if (allDone) {
    return (
      <div role="region" aria-label="Guide de démarrage terminé" style={CARD_STYLE}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <CircleCheck size={18} strokeWidth={2} aria-hidden="true" />
          <strong style={{ fontSize: 15 }}>Les {total} premiers pas sont faits</strong>
          <button
            type="button"
            onClick={closeGuide}
            aria-label="Fermer"
            style={{ marginLeft: "auto", background: "transparent", border: 0, padding: 4, cursor: "pointer", color: "var(--muted)" }}
          >
            <X size={16} strokeWidth={1.9} />
          </button>
        </div>
        <p style={{ margin: "8px 0 12px", fontSize: 13, color: "var(--muted)", lineHeight: 1.45 }}>
          Rien à retenir par cœur : la liste reste dans le menu, et chaque étape se revérifie toute seule.
        </p>
        {guideHref ? (
          <Link href={guideHref} onClick={closeGuide} className="sui-btn" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            Revoir la liste
            <ArrowRight size={15} strokeWidth={1.9} />
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <StepCard
      key={current.id}
      step={current}
      position={position}
      total={total}
      onClose={closeGuide}
      onLater={hide}
    />
  );
}
