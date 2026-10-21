"use client";

/**
 * COACH — surbrillance des vrais composants et indications contextuelles.
 *
 * La cible d'une étape est un `data-coach-id` posé sur le composant réel (un
 * bouton, un champ, une liste) : la surbrillance suit le DOM, jamais une
 * position figée. Si la cible n'est pas sur la page, le coach le DIT et propose
 * d'aller à la page de l'étape — il ne devine pas.
 *
 * LECTURE DU CATALOGUE : une étape porte `navigateTo` (ou sa forme normalisée
 * `page`) et un indice structuré `hint: { text, docPath }`. Tout passe par
 * `lib/training/mission-steps.mjs` : plus de `router.push(undefined)`
 * (« Cannot read properties of undefined (reading 'startsWith') ») et plus
 * d'objet rendu comme enfant React.
 *
 * Chaque indication dit trois choses : quoi faire, POURQUOI, et quel résultat
 * produire — puis l'étape suivante. L'avancement est contrôlé par
 * `coach-context.jsx` (vraies actions, vraies pages, vrais critères serveur).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Loader2,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  Target,
} from "lucide-react";
import { useCoach } from "@/lib/training/coach-context";
import { pageLabel, stepHintText, stepPage } from "@/lib/training/mission-steps.mjs";

const EMPTY_RECT = { top: 0, left: 0, width: 0, height: 0 };

function findTarget(target) {
  if (!target || typeof document === "undefined") return null;
  return document.querySelector(`[data-coach-id="${target}"]`);
}

function useTargetRect(target, active) {
  const [rect, setRect] = useState(EMPTY_RECT);
  const [found, setFound] = useState(false);

  const measure = useCallback(() => {
    const element = findTarget(target);
    if (!element) {
      setFound(false);
      setRect(EMPTY_RECT);
      return;
    }
    const box = element.getBoundingClientRect();
    setFound(true);
    setRect({ top: box.top, left: box.left, width: box.width, height: box.height });
  }, [target]);

  useLayoutEffect(() => {
    if (!active) return undefined;
    // Mesure planifiée (rAF) : évite tout setState synchrone dans l'effet.
    const raf = requestAnimationFrame(measure);
    const element = findTarget(target);
    // Cible absente : le rAF déjà planifié (`measure`) constatera l'absence.
    if (!element) return () => cancelAnimationFrame(raf);
    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      // Le défilement animé déplace la cible : remesure pendant l'animation.
      const ticks = [120, 320, 600];
      const timers = ticks.map((delay) => setTimeout(measure, delay));
      return () => {
        cancelAnimationFrame(raf);
        timers.forEach(clearTimeout);
      };
    }
    return () => cancelAnimationFrame(raf);
  }, [target, active, measure]);

  useEffect(() => {
    if (!active) return undefined;
    const onChange = () => measure();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(onChange) : null;
    if (observer) observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
      observer?.disconnect();
    };
  }, [active, measure]);

  return { rect, found };
}

function Spotlight({ rect }) {
  if (rect.width <= 0) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: rect.top - 4,
        left: rect.left - 4,
        width: rect.width + 8,
        height: rect.height + 8,
        borderRadius: 12,
        boxShadow: "0 0 0 9999px rgba(11, 10, 15, 0.55)",
        border: "2px solid #111",
        zIndex: 200,
        pointerEvents: "none",
        transition: "top 150ms ease, left 150ms ease, width 150ms ease, height 150ms ease",
      }}
    />
  );
}

function Tooltip({ rect, found, step, children }) {
  const [placement, setPlacement] = useState("bottom");
  const cardRef = useRef(null);

  useLayoutEffect(() => {
    if (!found) return;
    const card = cardRef.current;
    if (!card) return;
    const box = card.getBoundingClientRect();
    const belowSpace = window.innerHeight - (rect.top + rect.height);
    setPlacement(belowSpace > box.height + 24 ? "bottom" : rect.top > box.height + 24 ? "top" : "right");
  }, [found, rect, step?.id]);

  const style = useMemo(() => {
    const base = {
      position: "fixed",
      zIndex: 210,
      width: "min(420px, calc(100vw - 32px))",
      maxHeight: "calc(100vh - 32px)",
      overflowY: "auto",
    };
    if (typeof window === "undefined") return base;
    if (!found || rect.width <= 0) {
      return { ...base, top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }
    if (placement === "top") {
      return { ...base, left: Math.min(Math.max(rect.left - 8, 16), window.innerWidth - 440), bottom: window.innerHeight - rect.top + 12 };
    }
    if (placement === "right") {
      return { ...base, top: Math.max(rect.top - 8, 16), left: Math.min(rect.left + rect.width + 12, window.innerWidth - 440) };
    }
    return { ...base, left: Math.min(Math.max(rect.left - 8, 16), window.innerWidth - 440), top: rect.top + rect.height + 12 };
  }, [found, rect, placement]);

  return (
    <div ref={cardRef} className="sui-coach-tooltip" style={style} role="dialog" aria-label={`Étape : ${step?.title ?? ""}`}>
      {children}
    </div>
  );
}

/** Frise muette : où l’on en est dans la mission, sans recompter les étapes. */
function StepTrail({ stepIndex, stepCount }) {
  const dots = Array.from({ length: stepCount }, (_, index) => index);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }} aria-hidden="true">
      {dots.map((index) => (
        <span
          key={index}
          style={{
            width: index === stepIndex ? 18 : 6,
            height: 6,
            borderRadius: 999,
            background: index < stepIndex ? "#111" : index === stepIndex ? "#111" : "rgba(17,17,17,0.18)",
            transition: "width 200ms cubic-bezier(0.16,1,0.3,1), background 200ms ease",
          }}
        />
      ))}
    </div>
  );
}

function CoachControls({ session, step, stepIndex, stepCount, checking, onNext, onPrev, onPause, onResume, onQuit }) {
  const isLast = stepIndex >= stepCount - 1;
  const busy = session.phase === "validating";
  const verifyStep = step?.advanceOn === "verify";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        className="sui-btn sui-btn--ghost"
        onClick={onPrev}
        disabled={stepIndex === 0 || busy}
        aria-label="Étape précédente"
      >
        <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" /> Précédent
      </button>
      <button
        type="button"
        className="sui-btn sui-btn--dark"
        onClick={onNext}
        data-coach-id="coach-next-button"
        disabled={busy}
        aria-busy={busy}
      >
        {busy || checking ? (
          <>
            <Loader2 size={15} strokeWidth={2} className="sui-spin" aria-hidden="true" /> Vérification…
          </>
        ) : isLast ? (
          <>
            <Check size={15} strokeWidth={2} aria-hidden="true" /> Valider la mission
          </>
        ) : verifyStep ? (
          <>
            <Check size={15} strokeWidth={2} aria-hidden="true" /> J’ai terminé — vérifier
          </>
        ) : (
          <>
            {step?.advanceOn === "action" ? "J’ai fait l’action" : "Étape suivante"}{" "}
            <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
          </>
        )}
      </button>
      {session.phase === "paused" ? (
        <button type="button" className="sui-btn sui-btn--ghost" onClick={onResume}>
          <Play size={15} strokeWidth={2} aria-hidden="true" /> Reprendre
        </button>
      ) : (
        <button type="button" className="sui-btn sui-btn--ghost" onClick={onPause} disabled={busy}>
          <Pause size={15} strokeWidth={2} aria-hidden="true" /> Pause
        </button>
      )}
      <button type="button" className="sui-btn sui-btn--ghost" onClick={onQuit} aria-label="Quitter le parcours">
        <LogOut size={15} strokeWidth={2} aria-hidden="true" /> Quitter
      </button>
    </div>
  );
}

function ValidationCard({ session, onRestart, onQuit, onCloseReport }) {
  const report = session.report;
  const results = report?.results ?? [];
  const missing = results.filter((result) => !result.met);
  const ok = session.phase === "completed";
  return (
    <div
      className="sui-coach-tooltip"
      style={{ position: "fixed", zIndex: 220, bottom: 24, left: "50%", transform: "translateX(-50%)", width: "min(520px, calc(100vw - 32px))", maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}
      role="dialog"
      aria-label={ok ? "Mission réussie" : "Mission non validée"}
    >
      <div className="sui-coach-kicker" style={{ color: ok ? "#2f6b2f" : "#8a4b00" }}>
        {ok ? "Mission réussie" : "Validation"}
      </div>
      <h3 style={{ margin: "2px 0 6px", fontSize: 17 }}>
        {ok ? "Les critères sont satisfaits." : "Ce n’est pas encore validé."}
      </h3>
      <p style={{ margin: "0 0 10px", color: "var(--ink-muted, #666)", fontSize: 13.5 }}>
        {ok
          ? "Le serveur a vérifié l’état des données d’exercice : votre travail est réellement accompli."
          : "Le serveur a vérifié les données d’exercice : certains résultats attendus ne sont pas encore au rendez-vous."}
      </p>

      {/* Le verdict est détaillé : ce qui est prouvé, ce qui manque. */}
      {results.length > 0 ? (
        <ul style={{ margin: "0 0 12px", paddingLeft: 0, listStyle: "none", display: "grid", gap: 6 }}>
          {results.map((result) => (
            <li key={result.id} style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13 }}>
              {result.met ? (
                <CheckCircle2 size={15} strokeWidth={2} style={{ marginTop: 1, flex: "0 0 auto", color: "#2f6b2f" }} aria-hidden="true" />
              ) : (
                <CircleAlert size={15} strokeWidth={2} style={{ marginTop: 1, flex: "0 0 auto", color: "#8a4b00" }} aria-hidden="true" />
              )}
              <span style={{ color: result.met ? "inherit" : "#8a4b00" }}>{result.description}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {!ok && missing.length === 0 ? (
        <p style={{ margin: "0 0 10px", fontSize: 13 }}>Aucun critère détaillé n’a été renvoyé par le serveur.</p>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {ok ? (
          <button type="button" className="sui-btn sui-btn--dark" onClick={onCloseReport}>
            <Check size={15} strokeWidth={2} aria-hidden="true" /> Voir mon bilan
          </button>
        ) : (
          <>
            <button type="button" className="sui-btn sui-btn--dark" onClick={onRestart}>
              <RotateCcw size={15} strokeWidth={2} aria-hidden="true" /> Reprendre les étapes
            </button>
            <button type="button" className="sui-btn sui-btn--ghost" onClick={onQuit}>
              Quitter
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Corbeille des critères de l’évaluation : ce qui sera vérifié, sans les étapes. */
function EvaluationChecklist({ mission }) {
  const criteria = mission?.evaluation?.criteria ?? [];
  if (criteria.length === 0) return null;
  return (
    <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 12.5, color: "var(--ink-muted, #666)" }}>
      {criteria.map((criterion) => (
        <li key={criterion.id}>{criterion.label}</li>
      ))}
    </ul>
  );
}

export default function CoachLayer() {
  const { session, step, stepIndex, stepCount, next, prev, pause, resume, quit, restart, validate, verifyNow, setNote } = useCoach();
  const router = useRouter();
  // Les panneaux dépliés sont rattachés à l'étape : ils se referment
  // naturellement au changement d'étape (valeur dérivée, aucun reset en effet).
  const [hintStepId, setHintStepId] = useState(null);
  const [whyStepId, setWhyStepId] = useState(null);
  // Vérification demandée à la main : l'état est LOCAL, pour que le bouton
  // affiche « Vérification… » pendant l'appel puis retrouve son libellé.
  const [checking, setChecking] = useState(false);
  const hintOpen = hintStepId !== null && hintStepId === step?.id;
  const whyOpen = whyStepId !== null && whyStepId === step?.id;
  const setHintOpen = (open) => setHintStepId(open ? step?.id ?? null : null);
  const setWhyOpen = (open) => setWhyStepId(open ? step?.id ?? null : null);

  const guided = Boolean(session) && session.assistance !== "none";
  const evaluation = Boolean(session) && session.assistance === "none";
  const { rect, found } = useTargetRect(guided ? step?.target : null, guided && session?.phase === "running");

  const page = session ? stepPage(step, session.mission) : null;
  const hint = stepHintText(step);

  const goToStepPage = useCallback(() => {
    if (page) router.push(page);
  }, [page, router]);

  const onNext = useCallback(async () => {
    setNote(null);
    if (checking) return;
    if (stepIndex >= stepCount - 1) {
      await validate();
      return;
    }
    if (step?.advanceOn === "verify") {
      // Une étape vérifiée ne se survole pas : le clic demande une
      // re-vérification serveur, et l'avancement n'a lieu que si le critère
      // est réellement satisfait.
      setChecking(true);
      try {
        const report = await verifyNow(false);
        const result = (report?.results ?? []).find((entry) => entry.id === step.criterionId);
        if (result?.met) {
          next();
        } else {
          setNote(
            "L’action attendue n’est pas encore détectée sur les données d’exercice. Terminez l’étape : le coach vérifie automatiquement toutes les 3 secondes.",
          );
        }
      } catch (error) {
        setNote(error?.message ?? "La vérification a échoué. Réessayez dans un instant.");
      } finally {
        setChecking(false);
      }
      return;
    }
    next();
  }, [checking, next, setNote, step, stepCount, stepIndex, validate, verifyNow]);

  // Clavier : ← / → pour circuler, Échap pour mettre en pause.
  useEffect(() => {
    if (!session || session.phase !== "running") return undefined;
    const onKey = (event) => {
      const tag = event.target instanceof Element ? event.target.tagName : "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target?.isContentEditable) return;
      if (event.key === "Escape") {
        pause();
        return;
      }
      if (event.key === "ArrowRight" && !event.shiftKey) {
        // On ne force jamais le passage d'une étape non prouvée.
        if (step?.advanceOn === "action" || step?.advanceOn === "verify") return;
        if (stepIndex < stepCount - 1) next();
      }
      if (event.key === "ArrowLeft" && stepIndex > 0) prev();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [session, next, prev, pause, step, stepCount, stepIndex]);

  if (!session) return null;

  // Mission sans étape (catalogue incomplet ou serveur plus ancien) : mieux
  // vaut le dire et laisser sortir que d’afficher « Étape 1 sur 0 ».
  if (stepCount === 0) {
    return (
      <div
        className="sui-coach-tooltip"
        style={{ position: "fixed", zIndex: 210, bottom: 24, right: 24, width: "min(380px, calc(100vw - 32px))" }}
        role="alert"
      >
        <div className="sui-coach-kicker">Mission indisponible</div>
        <p style={{ margin: "4px 0 10px", fontSize: 13.5 }}>
          Cette mission n’a aucune étape dans le catalogue servi par le serveur. Rien ne peut être guidé pour
          l’instant : quittez, puis réessayez après le prochain déploiement de l’API.
        </p>
        <button type="button" className="sui-btn sui-btn--ghost" onClick={() => quit({ remember: false })}>
          <LogOut size={15} strokeWidth={2} aria-hidden="true" /> Quitter
        </button>
      </div>
    );
  }

  // Évaluation finale : pas de guidage, seulement les instructions et la validation.
  if (evaluation) {
    const done = session.phase === "completed" || session.phase === "failed";
    const busy = session.phase === "validating";
    return (
      <div
        className="sui-coach-tooltip"
        style={{ position: "fixed", zIndex: 210, bottom: 24, right: 24, width: "min(380px, calc(100vw - 32px))", maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}
        role="dialog"
        aria-label="Évaluation finale"
      >
        <div className="sui-coach-kicker">Évaluation finale — sans assistance</div>
        <h3 style={{ margin: "2px 0 6px", fontSize: 16 }}>{session.mission.title}</h3>
        <p style={{ margin: "0 0 10px", fontSize: 13.5 }}>{session.mission.evaluation.instructions}</p>
        <EvaluationChecklist mission={session.mission} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="sui-btn sui-btn--dark"
            onClick={async () => {
              await validate();
            }}
            disabled={busy || done}
            aria-busy={busy}
            data-coach-id="coach-validate-button"
          >
            {busy ? (
              <Loader2 size={15} strokeWidth={2} className="sui-spin" aria-hidden="true" />
            ) : (
              <Check size={15} strokeWidth={2} aria-hidden="true" />
            )}
            {busy ? "Vérification…" : "Valider mon évaluation"}
          </button>
          <button type="button" className="sui-btn sui-btn--ghost" onClick={() => quit({ remember: false })}>
            Abandonner
          </button>
        </div>
        {done ? (
          <p
            role="status"
            style={{ margin: "10px 0 0", fontSize: 13, fontWeight: 600, color: session.phase === "completed" ? "#2f6b2f" : "#8a4b00" }}
          >
            {session.phase === "completed"
              ? "Évaluation réussie : votre maîtrise est enregistrée."
              : "Évaluation non validée : reprenez les opérations non démontrées, puis réévaluez-vous."}
          </p>
        ) : null}
      </div>
    );
  }

  if (session.phase === "completed" || session.phase === "failed") {
    return (
      <ValidationCard
        session={session}
        onRestart={() => {
          restart();
        }}
        onQuit={() => quit({ remember: false })}
        onCloseReport={() => {
          const spaceHref = {
            personal: "/espace-personnel/formation",
            team: "/espace-equipe/formation",
            comexa: "/espace-comexa/formation",
            client: "/espace-client/formation",
          }[session.mission.space] ?? "/espace-equipe/formation";
          quit({ remember: false });
          router.push(`${spaceHref}?bilan=1`);
        }}
      />
    );
  }

  const progress = stepCount > 0 ? ((stepIndex + 1) / stepCount) * 100 : 0;
  const paused = session.phase === "paused";

  return (
    <>
      <Spotlight rect={found ? rect : EMPTY_RECT} />
      <Tooltip rect={rect} found={found} step={step}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div className="sui-coach-kicker">
            <Target size={13} strokeWidth={2} aria-hidden="true" /> Étape {stepIndex + 1} sur {stepCount}
          </div>
          <StepTrail stepIndex={stepIndex} stepCount={stepCount} />
        </div>
        <div className="sui-coach-progress" aria-hidden="true">
          <div style={{ width: `${progress}%` }} />
        </div>

        {paused ? (
          <p
            style={{ margin: "8px 0 0", fontSize: 12.5, fontWeight: 600, color: "#8a4b00", background: "var(--yellow, #F9E6B9)", borderRadius: 10, padding: "8px 10px" }}
            role="status"
          >
            Mission en pause. La page reste utilisable ; « Reprendre » relance le guidage et la vérification.
          </p>
        ) : null}

        <h3 style={{ margin: "8px 0 6px", fontSize: 16 }} aria-live="polite">
          {step?.title}
        </h3>

        {!found && !paused && step?.target ? (
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#8a4b00", fontWeight: 600 }}>
            Cet élément n’est pas visible sur cette page. L’étape se passe sur «&nbsp;{pageLabel(page)}&nbsp;».
          </p>
        ) : null}

        {session.note ? (
          <p
            style={{ margin: "0 0 8px", fontSize: 12.5, fontWeight: 600, color: "#8a4b00", background: "var(--yellow, #F9E6B9)", borderRadius: 10, padding: "8px 10px" }}
            role="alert"
          >
            {session.note}
          </p>
        ) : null}

        <p style={{ margin: "0 0 8px", fontSize: 13.5 }}>{step?.body}</p>

        <button
          type="button"
          onClick={() => setWhyOpen((open) => !open)}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: 0 }}
          aria-expanded={whyOpen}
        >
          {whyOpen ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          {whyOpen ? "Masquer le pourquoi" : "Pourquoi cette étape ?"}
        </button>
        {whyOpen ? (
          <p style={{ margin: "6px 0 8px", fontSize: 12.5, color: "var(--ink-muted, #666)" }}>
            <strong>Pourquoi&nbsp;:</strong> {step?.why}
            <br />
            <strong>Résultat attendu&nbsp;:</strong> {step?.expect}
          </p>
        ) : null}

        {hint ? (
          <div style={{ marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => setHintOpen((open) => !open)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: 0 }}
              aria-expanded={hintOpen}
            >
              {hintOpen ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              {hintOpen ? "Masquer l’aide" : "Un doute ? L’aide"}
            </button>
            {hintOpen ? (
              <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#8a4b00", background: "var(--yellow, #F9E6B9)", borderRadius: 10, padding: "8px 10px" }}>
                {hint}
              </p>
            ) : null}
          </div>
        ) : null}

        <CoachControls
          session={session}
          step={step}
          stepIndex={stepIndex}
          stepCount={stepCount}
          checking={checking}
          onNext={onNext}
          onPrev={prev}
          onPause={pause}
          onResume={resume}
          onQuit={() => quit()}
        />

        {!found && page ? (
          <button type="button" className="sui-btn sui-btn--dark" style={{ marginTop: 8 }} onClick={goToStepPage}>
            <ArrowRight size={15} strokeWidth={2} aria-hidden="true" /> Aller à «&nbsp;{pageLabel(page)}&nbsp;»
          </button>
        ) : null}
      </Tooltip>
    </>
  );
}
