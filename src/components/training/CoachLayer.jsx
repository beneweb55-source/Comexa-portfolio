"use client";

/**
 * COACH — surbrillance des vrais composants et indications contextuelles.
 *
 * La cible d'une étape est un `data-coach-id` posé sur le composant réel (un
 * bouton, un champ, une liste) : la surbrillance suit le DOM, jamais une
 * position figée. Si la cible n'est pas sur la page, le coach le DIT et propose
 * d'aller à la page de l'étape — il ne devine pas.
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
    if (element && typeof element.scrollIntoView === "function") {
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
    };
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
    <div ref={cardRef} className="sui-coach-tooltip" style={style} role="dialog" aria-label={`Étape : ${step.title}`}>
      {children}
    </div>
  );
}

function CoachControls({ session, step, stepIndex, stepCount, onNext, onPrev, onPause, onResume, onQuit }) {
  const isLast = stepIndex >= stepCount - 1;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="sui-btn sui-btn--ghost" onClick={onPrev} disabled={stepIndex === 0} aria-label="Étape précédente">
        <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" /> Précédent
      </button>
      <button type="button" className="sui-btn sui-btn--dark" onClick={onNext} data-coach-id="coach-next-button">
        {step?.advanceOn === "verify" ? (
          <>
            <Loader2 size={15} strokeWidth={2} className="sui-spin" aria-hidden="true" /> Vérification…
          </>
        ) : isLast ? (
          <>
            <Check size={15} strokeWidth={2} aria-hidden="true" /> Valider la mission
          </>
        ) : (
          <>
            {step?.advanceOn === "action" ? "J’ai fait l’action" : "Étape suivante"} <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
          </>
        )}
      </button>
      {session.phase === "paused" ? (
        <button type="button" className="sui-btn sui-btn--ghost" onClick={onResume}>
          <Play size={15} strokeWidth={2} aria-hidden="true" /> Reprendre
        </button>
      ) : (
        <button type="button" className="sui-btn sui-btn--ghost" onClick={onPause}>
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
  const missing = (report?.results ?? []).filter((r) => !r.met);
  const ok = session.phase === "completed";
  return (
    <div
      className="sui-coach-tooltip"
      style={{ position: "fixed", zIndex: 220, bottom: 24, left: "50%", transform: "translateX(-50%)", width: "min(520px, calc(100vw - 32px))" }}
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
      {!ok && missing.length > 0 ? (
        <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 13 }}>
          {missing.map((r) => (
            <li key={r.id} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 4 }}>
              <CircleAlert size={14} strokeWidth={2} style={{ marginTop: 2, flex: "0 0 auto" }} aria-hidden="true" />
              <span>{r.description}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {ok ? (
          <button type="button" className="sui-btn sui-btn--dark" onClick={onCloseReport}>
            <Check size={15} strokeWidth={2} aria-hidden="true" /> Continuer
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

export default function CoachLayer() {
  const { session, step, stepIndex, stepCount, next, prev, pause, resume, quit, restart, validate, verifyNow, setNote } = useCoach();
  const router = useRouter();
  // L'indice déplié est rattaché à l'étape : il se referme naturellement au
  // changement d'étape (valeur dérivée, aucun reset dans un effet).
  const [hintStepId, setHintStepId] = useState(null);
  const hintOpen = hintStepId !== null && hintStepId === step?.id;
  const setHintOpen = (open) => setHintStepId(open ? step?.id ?? null : null);

  const guided = Boolean(session) && session.assistance !== "none";
  const evaluation = Boolean(session) && session.assistance === "none";
  const { rect, found } = useTargetRect(guided ? step?.target : null, guided && session.phase === "running");

  if (!session) return null;

  // Évaluation finale : pas de guidage, seulement les instructions et la validation.
  if (evaluation) {
    return (
      <div
        className="sui-coach-tooltip"
        style={{ position: "fixed", zIndex: 210, bottom: 24, right: 24, width: "min(380px, calc(100vw - 32px))" }}
        role="dialog"
        aria-label="Évaluation finale"
      >
        <div className="sui-coach-kicker">Évaluation finale — sans assistance</div>
        <h3 style={{ margin: "2px 0 6px", fontSize: 16 }}>{session.mission.title}</h3>
        <p style={{ margin: "0 0 10px", fontSize: 13.5 }}>{session.mission.evaluation.instructions}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="sui-btn sui-btn--dark"
            onClick={async () => {
              await validate();
            }}
            data-coach-id="coach-validate-button"
          >
            <Check size={15} strokeWidth={2} aria-hidden="true" /> Valider mon évaluation
          </button>
          <button type="button" className="sui-btn sui-btn--ghost" onClick={() => quit({ remember: false })}>
            Abandonner
          </button>
        </div>
        {session.phase === "completed" || session.phase === "failed" ? (
          <p style={{ margin: "10px 0 0", fontSize: 13, fontWeight: 600, color: session.phase === "completed" ? "#2f6b2f" : "#8a4b00" }}>
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

  return (
    <>
      <Spotlight rect={found ? rect : EMPTY_RECT} />
      <Tooltip rect={rect} found={found} step={step}>
        <div className="sui-coach-kicker">
          <Target size={13} strokeWidth={2} aria-hidden="true" /> Étape {stepIndex + 1} sur {stepCount}
        </div>
        <div className="sui-coach-progress" aria-hidden="true">
          <div style={{ width: `${progress}%` }} />
        </div>
        <h3 style={{ margin: "8px 0 6px", fontSize: 16 }}>{step.title}</h3>
        {!found ? (
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#8a4b00", fontWeight: 600 }}>
            Cet élément n’est pas visible sur cette page. L’étape se passe sur « {step.page} ».
          </p>
        ) : null}
        {session.note ? (
          <p style={{ margin: "0 0 8px", fontSize: 12.5, fontWeight: 600, color: "#8a4b00", background: "var(--yellow, #F9E6B9)", borderRadius: 10, padding: "8px 10px" }} role="alert">
            {session.note}
          </p>
        ) : null}
        <p style={{ margin: "0 0 8px", fontSize: 13.5 }}>{step.body}</p>
        <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--ink-muted, #666)" }}>
          <strong>Pourquoi&nbsp;:</strong> {step.why}
          <br />
          <strong>Résultat attendu&nbsp;:</strong> {step.expect}
        </p>
        {step.hint ? (
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
                {step.hint}
              </p>
            ) : null}
          </div>
        ) : null}
        <CoachControls
          session={session}
          step={step}
          stepIndex={stepIndex}
          stepCount={stepCount}
          onNext={async () => {
            setNote(null);
            if (stepIndex >= stepCount - 1) {
              await validate();
              return;
            }
            if (step?.advanceOn === "verify") {
              // Une étape vérifiée ne se survole pas : le clic demande une
              // re-vérification serveur, et l'avancement n'a lieu que si le
              // critère est réellement satisfait.
              const report = await verifyNow(false);
              const result = (report?.results ?? []).find((r) => r.id === step.criterionId);
              if (result?.met) {
                next();
              } else {
                setNote("L’action attendue n’est pas encore détectée sur les données d’exercice. Terminez l’étape : le coach vérifie automatiquement.");
              }
              return;
            }
            next();
          }}
          onPrev={prev}
          onPause={pause}
          onResume={resume}
          onQuit={() => quit()}
        />
        {!found ? (
          <button
            type="button"
            className="sui-btn sui-btn--dark"
            style={{ marginTop: 8 }}
            onClick={() => router.push(step.page)}
          >
            Aller à l’étape
          </button>
        ) : null}
      </Tooltip>
    </>
  );
}
