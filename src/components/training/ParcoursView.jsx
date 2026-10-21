"use client";

/**
 * « MON PARCOURS » — l’espace de formation d’un espace de travail.
 *
 * Trois blocs :
 *  1. les missions ouvertes AVEC les permissions réelles du membre, par niveau
 *     (découverte → opérations courantes → scénario complet → erreurs) ;
 *  2. le déroulé de chaque mission : objectif, situation, actions, méthode
 *     (vérifications avant d’agir), erreurs fréquentes, critères de réussite,
 *     escalade — et les points métier À CONFIRMER, jamais inventés ;
 *  3. le bilan : acquis démontrés, reste à maîtriser, checklist opérationnelle
 *     et raccourcis vers les modules RÉELS (passage explicite à la production).
 *
 * Lancement : « Commencer » entre en mode formation (si besoin), démarre la
 * mission côté serveur et ouvre le coach sur la première étape. « Évaluation
 * finale » rejoue le scénario SANS assistance.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  ExternalLink,
  GraduationCap,
  ListChecks,
  Loader2,
  Play,
  RotateCcw,
  ShieldAlert,
  Target,
  TriangleAlert,
} from "lucide-react";
import { useTraining } from "@/lib/training/training-context";
import { useCoach } from "@/lib/training/coach-context";

const LEVEL_LABEL = {
  1: "Découvrir l’espace",
  2: "Opérations courantes",
  3: "Scénario complet",
  4: "Détecter et corriger les erreurs",
};

const STATUS_LABEL = {
  NOT_STARTED: "À commencer",
  IN_PROGRESS: "En cours",
  COMPLETED: "Réussie",
  FAILED: "À reprendre",
};

function LevelBadge({ level }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11.5,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        background: "var(--blue, #D7E8F9)",
        borderRadius: 999,
        padding: "3px 10px",
      }}
    >
      Niveau {level} · {LEVEL_LABEL[level] ?? ""}
    </span>
  );
}

function StatusChip({ progress }) {
  const status = progress?.status ?? "NOT_STARTED";
  const tone = status === "COMPLETED" ? "var(--green, #D8EFBE)" : status === "IN_PROGRESS" ? "var(--yellow, #F9E6B9)" : "var(--surface, #F6F4F5)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, background: tone, borderRadius: 999, padding: "3px 10px" }}>
      {status === "COMPLETED" ? <CheckCircle2 size={13} strokeWidth={2} aria-hidden="true" /> : null}
      {STATUS_LABEL[status] ?? status}
      {progress?.attempts > 0 ? ` · ${progress.attempts} tentative${progress.attempts > 1 ? "s" : ""}` : ""}
    </span>
  );
}

function MissionDetails({ mission }) {
  return (
    <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
      <section>
        <h4 style={{ margin: "0 0 4px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.04em" }}>Situation de départ</h4>
        <p style={{ margin: 0, fontSize: 13.5 }}>{mission.situation}</p>
      </section>
      <section>
        <h4 style={{ margin: "0 0 4px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.04em" }}>Actions à effectuer</h4>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
          {mission.actions.map((action) => (
            <li key={action} style={{ marginBottom: 3 }}>{action}</li>
          ))}
        </ol>
      </section>
      <section>
        <h4 style={{ margin: "0 0 4px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 6 }}>
          <ClipboardCheck size={14} strokeWidth={2} aria-hidden="true" /> Méthode : vérifier AVANT d’agir
        </h4>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
          {mission.checksBefore.map((check) => (
            <li key={check} style={{ marginBottom: 3 }}>{check}</li>
          ))}
        </ul>
      </section>
      <section>
        <h4 style={{ margin: "0 0 4px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 6 }}>
          <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" /> Erreurs fréquentes
        </h4>
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 6 }}>
          {mission.pitfalls.map((pitfall) => (
            <li key={pitfall.mistake} style={{ fontSize: 13, background: "var(--pink, #F9D5DD)", borderRadius: 12, padding: "8px 10px" }}>
              <strong>{pitfall.mistake}</strong>
              <br />
              <span style={{ color: "#6b2233" }}>{pitfall.consequence}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4 style={{ margin: "0 0 4px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 6 }}>
          <Target size={14} strokeWidth={2} aria-hidden="true" /> Considérée comme réussie quand…
        </h4>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
          {mission.doneWhen.map((item) => (
            <li key={item} style={{ marginBottom: 3 }}>{item}</li>
          ))}
        </ul>
        <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-muted, #666)" }}>
          La réussite est vérifiée par le serveur sur les données d’exercice : cliquer sur « Terminer » ne réussit jamais une mission.
        </p>
      </section>
      <section>
        <h4 style={{ margin: "0 0 4px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 6 }}>
          <ShieldAlert size={14} strokeWidth={2} aria-hidden="true" /> Quand demander de l’aide
        </h4>
        <p style={{ margin: 0, fontSize: 13.5 }}>{mission.escalation}</p>
      </section>
      {mission.toConfirm?.length ? (
        <section>
          <h4 style={{ margin: "0 0 4px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.04em" }}>Points à faire confirmer</h4>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#8a4b00" }}>
            {mission.toConfirm.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export default function ParcoursView({ space }) {
  const training = useTraining();
  const coach = useCoach();
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [report, setReport] = useState(null);
  // Requêtes en vol : les boutons se désactivent pendant l'entrée en formation
  // ou le démarrage d'une mission — chaque clic supplémentaire lançait un
  // second POST parallèle au premier.
  const [entering, setEntering] = useState(false);
  const [starting, setStarting] = useState(null);
  const loading = !loadedOnce && training.catalog == null;

  // Rechargement explicite (boutons) : utilisé hors rendu, setState autorisé.
  const load = useCallback(async () => {
    try {
      await training.refreshCatalog();
      setError(null);
    } catch (err) {
      setError(err?.message ?? "Le catalogue de formation n’a pas pu être chargé.");
    } finally {
      setLoadedOnce(true);
    }
  }, [training]);

  useEffect(() => {
    if (training.catalog != null) return undefined;
    let cancelled = false;
    // Chargement initial : les setState vivent dans les callbacks asynchrones.
    training
      .refreshCatalog()
      .then(() => {
        if (!cancelled) setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "Le catalogue de formation n’a pas pu être chargé.");
      })
      .finally(() => {
        if (!cancelled) setLoadedOnce(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!report) return;
    training.loadReport().then(setReport).catch(() => setReport(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [training.active]);

  const missions = useMemo(() => {
    const all = training.catalog ?? [];
    return all
      .filter((mission) => mission.space === space)
      .sort((a, b) => a.level - b.level || a.title.localeCompare(b.title));
  }, [training.catalog, space]);

  const completed = missions.filter((m) => m.progress?.status === "COMPLETED").length;

  const start = useCallback(
    async (mission, assistance) => {
      if (starting) return;
      setStarting(mission.id);
      try {
        setError(null);
        await coach.startMission(mission, { assistance });
      } catch (err) {
        setError(err?.message ?? "La mission n’a pas pu démarrer.");
      } finally {
        setStarting(null);
      }
    },
    [coach, starting],
  );

  return (
    <div className="sui-parcours" style={{ display: "grid", gap: 18 }}>
      {/* En-tête de parcours */}
      <section
        className="sui-card"
        data-coach-id="parcours-header"
        style={{ borderRadius: 24, padding: "18px 20px", background: "var(--surface, #F6F4F5)", display: "grid", gap: 10 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ width: 40, height: 40, borderRadius: 14, background: "var(--lilac, #EDD5F8)", display: "grid", placeItems: "center" }}>
            <GraduationCap size={22} strokeWidth={1.9} aria-hidden="true" />
          </span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Mon parcours de formation</h2>
            <p style={{ margin: "2px 0 0", color: "var(--ink-muted, #666)", fontSize: 13.5 }}>
              Des missions réelles, dans un environnement d’entraînement isolé : vous pratiquez sur des données
              fictives, avec les formulaires et les règles de l’outil de production.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!training.active ? (
              <button
                type="button"
                className="sui-btn sui-btn--dark"
                data-coach-id="parcours-enter-button"
                disabled={entering}
                aria-busy={entering}
                onClick={async () => {
                  if (entering) return;
                  setEntering(true);
                  try {
                    setError(null);
                    await training.enter();
                    await load();
                  } catch (err) {
                    setError(err?.message ?? "Impossible d’ouvrir l’environnement de formation.");
                  } finally {
                    setEntering(false);
                  }
                }}
              >
                {entering ? (
                  <Loader2 size={15} strokeWidth={2} className="sui-spin" aria-hidden="true" />
                ) : (
                  <Play size={15} strokeWidth={2} aria-hidden="true" />
                )}
                {entering ? "Ouverture de l’environnement…" : "Entrer en mode formation"}
              </button>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 12.5, background: "var(--yellow, #F9E6B9)", borderRadius: 999, padding: "6px 12px" }}>
                <ShieldAlert size={14} strokeWidth={2} aria-hidden="true" /> MODE FORMATION actif
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
          <strong>{completed}</strong> mission{completed > 1 ? "s" : ""} réussie{completed > 1 ? "s" : ""} sur <strong>{missions.length}</strong>
          <div style={{ flex: 1, height: 8, background: "#E7E3E4", borderRadius: 999, overflow: "hidden" }}>
            <div
              style={{
                width: missions.length > 0 ? `${Math.round((completed / missions.length) * 100)}%` : "0%",
                height: "100%",
                background: "var(--green, #D8EFBE)",
                borderRadius: 999,
                transition: "width 300ms cubic-bezier(0.16,1,0.3,1)",
              }}
            />
          </div>
        </div>
      </section>

      {error ? (
        <p role="alert" style={{ margin: 0, padding: "10px 14px", borderRadius: 12, background: "var(--pink, #F9D5DD)", fontSize: 13.5 }}>
          {error}
        </p>
      ) : null}

      {loading ? (
        <p style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink-muted, #666)", fontSize: 13.5 }}>
          <Loader2 size={16} className="sui-spin" aria-hidden="true" /> Chargement de votre parcours…
        </p>
      ) : missions.length === 0 ? (
        <section className="sui-card" style={{ borderRadius: 24, padding: 20, background: "var(--surface, #F6F4F5)" }}>
          <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>Aucune mission ouverte ici pour l’instant</h3>
          <p style={{ margin: 0, color: "var(--ink-muted, #666)", fontSize: 13.5 }}>
            Les missions sont calquées sur vos permissions actuelles. Ce parcours s’enrichira avec les
            rubriques ouvertes à votre rôle.
          </p>
        </section>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {missions.map((mission) => {
            const open = expanded === mission.id;
            return (
              <article
                key={mission.id}
                className="sui-card"
                data-coach-id={`mission-card-${mission.id}`}
                style={{ borderRadius: 24, padding: "16px 20px", background: "var(--card, #FDFDFD)", border: "1px solid rgba(17,17,17,0.08)" }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                      <LevelBadge level={mission.level} />
                      <StatusChip progress={mission.progress} />
                      <span style={{ fontSize: 12, color: "var(--ink-muted, #666)", fontWeight: 600 }}>{mission.roles.join(" · ")}</span>
                    </div>
                    <h3 style={{ margin: "0 0 4px", fontSize: 17 }}>{mission.title}</h3>
                    <p style={{ margin: 0, color: "var(--ink-muted, #666)", fontSize: 13.5 }}>{mission.goal}</p>
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <button
                      type="button"
                      className="sui-btn sui-btn--dark"
                      data-coach-id={`mission-start-${mission.id}`}
                      disabled={starting !== null}
                      aria-busy={starting === mission.id}
                      onClick={() => start(mission, "full")}
                    >
                      <Play size={15} strokeWidth={2} aria-hidden="true" />
                      {mission.progress?.status === "IN_PROGRESS" ? "Reprendre avec le coach" : "Commencer avec le coach"}
                    </button>
                    <button
                      type="button"
                      className="sui-btn sui-btn--ghost"
                      data-coach-id={`mission-eval-${mission.id}`}
                      disabled={starting !== null}
                      aria-busy={starting === mission.id}
                      onClick={() => start(mission, "none")}
                    >
                      <Target size={15} strokeWidth={2} aria-hidden="true" /> Évaluation finale (sans assistance)
                    </button>
                    <button
                      type="button"
                      className="sui-btn sui-btn--ghost"
                      onClick={() => setExpanded(open ? null : mission.id)}
                      aria-expanded={open}
                    >
                      {open ? <ChevronUp size={15} strokeWidth={2} aria-hidden="true" /> : <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />}
                      {open ? "Replier le déroulé" : "Voir le déroulé"}
                    </button>
                  </div>
                </div>
                {open ? <MissionDetails mission={mission} /> : null}
              </article>
            );
          })}
        </div>
      )}

      {/* Bilan */}
      <section
        className="sui-card"
        data-coach-id="parcours-report"
        style={{ borderRadius: 24, padding: "18px 20px", background: "var(--green, #D8EFBE)" }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: 18, display: "flex", alignItems: "center", gap: 8 }}>
          <ListChecks size={19} strokeWidth={1.9} aria-hidden="true" /> Passer au travail réel
        </h2>
        <p style={{ margin: "0 0 12px", fontSize: 13.5 }}>
          Une fois une mission réussie, elle rejoint votre bilan : opérations démontrées, checklist de votre
          poste et raccourcis vers les modules réels. Le passage en production est toujours explicite — aucune
          donnée de formation n’y est transférée.
        </p>
        <button
          type="button"
          className="sui-btn sui-btn--dark"
          data-coach-id="parcours-report-button"
          onClick={async () => {
            try {
              const data = await training.loadReport();
              setReport(data);
            } catch (err) {
              setError(err?.message ?? "Le bilan n’a pas pu être chargé.");
            }
          }}
        >
          <BookOpen size={15} strokeWidth={2} aria-hidden="true" /> Afficher mon bilan
        </button>

        {report ? (
          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            <div>
              <h3 style={{ margin: "0 0 6px", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Ce que vous avez démontré savoir faire
              </h3>
              {report.mastered.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: "var(--ink-muted, #666)" }}>Aucune mission validée pour l’instant.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
                  {report.mastered.map((item) => (
                    <li key={item.missionId}>
                      {item.title}
                      {item.evaluationPassed === false ? " (évaluation finale à repasser)" : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 style={{ margin: "0 0 6px", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                À maîtriser désormais
              </h3>
              {report.remaining.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: "var(--ink-muted, #666)" }}>Toutes les missions ouvertes sont validées. Beau travail.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
                  {report.remaining.map((item) => (
                    <li key={item.missionId}>{item.title}</li>
                  ))}
                </ul>
              )}
            </div>
            {report.checklist.length > 0 ? (
              <div>
                <h3 style={{ margin: "0 0 6px", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Checklist de votre poste
                </h3>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
                  {[...new Set(report.checklist.flatMap((entry) => entry.items))].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {report.toConfirm.length > 0 ? (
              <div>
                <h3 style={{ margin: "0 0 6px", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Points à faire confirmer par votre hiérarchie
                </h3>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#5a3b00" }}>
                  {[...new Set(report.toConfirm)].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <h3 style={{ margin: "0 0 6px", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Accéder aux modules réels
              </h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[...new Map(report.realLinks.map((link) => [link.href, link])).values()].map((link) => (
                  <Link key={link.href} href={link.href} className="sui-btn sui-btn--ghost">
                    <ExternalLink size={14} strokeWidth={2} aria-hidden="true" /> {link.label}
                  </Link>
                ))}
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--ink-muted, #666)" }}>
                Ces liens ouvrent vos modules de production avec vos permissions habituelles. Quittez le mode
                formation pour y travailler sur des données réelles.
              </p>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
