"use client";

/**
 * COACH INTERACTIF — machine à états d'une mission.
 *
 * ---------------------------------------------------------------------------
 * CE QUE LE COACH GARANTIT
 * ---------------------------------------------------------------------------
 *  - il montre OÙ cliquer (cibles `data-coach-id` posées sur les vrais
 *    composants, jamais une position calculée), POURQUOI l'action compte et
 *    quel résultat elle produit ;
 *  - il n'avance que si l'action a RÉELLEMENT eu lieu :
 *      `action`   → le clic sur la cible est observé (délégation d'événements),
 *      `navigate` → la route attendue est atteinte (changement de page réel),
 *      `verify`   → le critère serveur est satisfait sur les données
 *                   d'exercice (interrogation de `/training/missions/:id/check`),
 *      `manual`   → lecture guidée, l'utilisateur confirme ;
 *  - la mission n'est jamais réussie par un bouton « Terminer » : `validate`
 *    appelle le serveur, qui recalcule les critères sur l'état réel du bac à
 *    sable ;
 *  - l'évaluation finale (`assistance: "none"`) désactive le guidage : même
 *    scénario, aucune indication, validation serveur.
 *
 * L'état survit aux changements de page (contexte React) et à un rechargement
 * (sessionStorage) : une mission est reprenable exactement là où elle s'était
 * arrêtée.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTraining } from "./training-context";
import { isOnPage, stepPage, toStepIndex } from "./mission-steps.mjs";

const CoachContext = createContext(null);

const STORAGE_PREFIX = "comexa:coach:";

function persist(missionId, snapshot) {
  try {
    if (!missionId) return;
    sessionStorage.setItem(STORAGE_PREFIX + missionId, JSON.stringify(snapshot));
  } catch {
    // sessionStorage indisponible (navigation privée) : la mission reste
    // utilisable, elle démarre juste au premier écran après rechargement.
  }
}

function restore(missionId) {
  try {
    const raw = missionId ? sessionStorage.getItem(STORAGE_PREFIX + missionId) : null;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearPersisted(missionId) {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + missionId);
  } catch {
    /* rien */
  }
}

export function CoachProvider({ children }) {
  const training = useTraining();
  const router = useRouter();
  const pathname = usePathname();

  const [session, setSession] = useState(null);
  // session = { mission, assistance, stepIndex, paused, phase, report, note }
  // phase : running | paused | validating | completed | failed
  const sessionRef = useRef(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const setSessionSafe = useCallback((updater) => {
    setSession((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      sessionRef.current = next;
      if (next && (next.phase === "running" || next.phase === "paused")) {
        persist(next.mission.id, {
          missionId: next.mission.id,
          assistance: next.assistance,
          stepIndex: next.stepIndex,
          paused: next.phase === "paused",
        });
      }
      return next;
    });
  }, []);

  /**
   * SORTIE DU MODE FORMATION : le coach ne survit pas au retour en production.
   *
   * « Quitter le mode formation » depuis la bannière retire le jeton de
   * formation. Laisser la session de coach ouverte faisait alors continuer un
   * scénario qui surlignait des composants RÉELS et interrogeait des critères
   * d'exercice avec les droits de production : deux mondes mélangés. On ferme.
   */
  useEffect(() => {
    if (training.active || !sessionRef.current) return;
    setSession(null);
    sessionRef.current = null;
  }, [training.active]);

  /**
   * Démarre (ou reprend) une mission. Entre en mode formation si besoin.
   *
   * `resume` : une mission déjà commencée reprend à l'étape mémorisée dans
   * `sessionStorage` (pause, changement d'onglet, rechargement). Sans reprise,
   * on repart de la première étape — et le serveur, lui, conserve la tentative
   * en cours : les critères déjà satisfaits restent satisfaits.
   */
  const startMission = useCallback(
    async (mission, { assistance = "full", resume = true } = {}) => {
      const steps = Array.isArray(mission?.steps) ? mission.steps : [];
      if (steps.length === 0) {
        throw new Error("Cette mission n’a aucune étape : le catalogue de formation est incomplet.");
      }

      // Reprise AVANT l'appel serveur : si l'instantané correspond, on ouvre
      // directement le bon écran, sans faire clignoter la première étape.
      let stepIndex = 0;
      if (resume) {
        const saved = restore(mission.id);
        if (saved && saved.missionId === mission.id && saved.assistance === assistance) {
          stepIndex = toStepIndex(saved.stepIndex, steps.length);
        }
      }

      if (!training.active) {
        await training.enter(mission.id);
      }
      await training.startMission(mission.id, assistance);

      setSessionSafe({
        mission,
        assistance,
        stepIndex,
        paused: false,
        phase: "running",
        report: null,
        note: null,
      });
      // Aller au bon écran tout de suite : le coach ne se promène pas seul,
      // il propose — mais une mission commence où elle se passe. `stepPage`
      // retombe sur le module réel de la mission quand l'étape ne nomme aucune
      // page : on ne pousse JAMAIS `undefined` dans le routeur.
      const page = stepPage(steps[stepIndex], mission);
      if (page && !isOnPage(pathname, page)) router.push(page);
    },
    [training, setSessionSafe, router, pathname],
  );

  const goto = useCallback(
    (stepIndex) => {
      setSessionSafe((prev) => {
        if (!prev) return prev;
        return { ...prev, stepIndex: toStepIndex(stepIndex, prev.mission.steps.length), note: null };
      });
    },
    [setSessionSafe],
  );

  const next = useCallback(() => {
    setSessionSafe((prev) => {
      if (!prev) return prev;
      const last = prev.mission.steps.length - 1;
      // Jamais d'avancement au-delà de la dernière étape : la fin de mission se
      // joue sur « Valider la mission », qui est une VÉRIFICATION serveur.
      if (prev.stepIndex >= last) return prev;
      return { ...prev, stepIndex: prev.stepIndex + 1, note: null };
    });
  }, [setSessionSafe]);

  const prev = useCallback(() => {
    setSessionSafe((prev) => {
      if (!prev) return prev;
      return { ...prev, stepIndex: Math.max(0, prev.stepIndex - 1), note: null };
    });
  }, [setSessionSafe]);

  const pause = useCallback(() => {
    setSessionSafe((prev) => (prev ? { ...prev, phase: "paused" } : prev));
  }, [setSessionSafe]);

  const resume = useCallback(() => {
    setSessionSafe((prev) => (prev ? { ...prev, phase: "running" } : prev));
  }, [setSessionSafe]);

  const quit = useCallback(
    (options = {}) => {
      if (sessionRef.current && options.remember !== false) {
        persist(sessionRef.current.mission.id, {
          missionId: sessionRef.current.mission.id,
          assistance: sessionRef.current.assistance,
          stepIndex: sessionRef.current.stepIndex,
          paused: true,
        });
      } else if (sessionRef.current) {
        clearPersisted(sessionRef.current.mission.id);
      }
      setSession(null);
      sessionRef.current = null;
      // Le parcours affiché doit refléter l'état serveur (mission réussie,
      // tentative en cours) : sans ce rechargement, la carte restait
      // « À commencer » après une mission pourtant validée.
      Promise.resolve(training.refreshCatalog?.()).catch(() => undefined);
    },
    [training],
  );

  /** Vérifie maintenant les critères (toute la mission) et rend le rapport. */
  const verifyNow = useCallback(
    async (evaluation = false) => {
      const current = sessionRef.current;
      if (!current) return null;
      const report = await training.checkMission(current.mission.id, { evaluation });
      return report;
    },
    [training],
  );

  /**
   * VALIDATION FINALE — le serveur décide. `onDone` reçoit `{ ok, report }`.
   * En évaluation (`assistance: "none"`), ce sont les critères d'évaluation.
   */
  const validate = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return null;
    // Une validation est déjà en cours : un second clic ne doit pas envoyer un
    // deuxième POST /complete (deux tentatives tracées pour un seul geste).
    if (current.phase === "validating") return null;
    setSessionSafe((prev) => (prev ? { ...prev, phase: "validating" } : prev));
    const result = await training.completeMission(current.mission.id, current.assistance);
    setSessionSafe((prev) =>
      prev
        ? {
            ...prev,
            phase: result.ok ? "completed" : "failed",
            report: result.report,
            note: result.ok
              ? "Mission validée : les critères sont satisfaits sur les données d'exercice."
              : "Des critères ne sont pas encore satisfaits. Reprenez les étapes concernées.",
          }
        : prev,
    );
    // Le parcours (onglet « Mon parcours ») se met à jour immédiatement :
    // statut, nombre de tentatives et bilan sont relus côté serveur.
    Promise.resolve(training.refreshCatalog?.()).catch(() => undefined);
    return result;
  }, [training, setSessionSafe]);

  const setNote = useCallback(
    (note) => {
      setSessionSafe((prev) => (prev ? { ...prev, note } : prev));
    },
    [setSessionSafe],
  );

  const restart = useCallback(() => {
    setSessionSafe((prev) =>
      prev ? { ...prev, stepIndex: 0, phase: "running", report: null, note: null } : prev,
    );
  }, [setSessionSafe]);

  // ---------------------------------------------------------------------------
  // Avancement automatique
  // ---------------------------------------------------------------------------

  // `navigate` : la page attendue est atteinte.
  useEffect(() => {
    const current = sessionRef.current;
    if (!current || current.phase !== "running" || current.assistance === "none") return;
    const step = current.mission.steps[current.stepIndex];
    if (step?.advanceOn !== "navigate") return;
    // `stepPage` : le catalogue sert `page` (forme normalisée) ou
    // `navigateTo` (forme historique) — jamais `undefined`.
    if (isOnPage(pathname, stepPage(step, current.mission))) {
      next();
    }
  }, [pathname, next]);

  // `action` : un clic sur la cible de l'étape est observé.
  useEffect(() => {
    const current = sessionRef.current;
    if (!current || current.phase !== "running" || current.assistance === "none") return;
    const step = current.mission.steps[current.stepIndex];
    if (step?.advanceOn !== "action") return;

    const onClick = (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-coach-id]") : null;
      if (target && target.getAttribute("data-coach-id") === step.target) {
        // Laisser l'application traiter l'événement, avancer juste après.
        setTimeout(() => next(), 150);
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [session?.stepIndex, session?.mission?.id, session?.phase, next]);

  // `verify` : sondage du critère serveur de l'étape (toutes les 3 s).
  useEffect(() => {
    const current = sessionRef.current;
    if (!current || current.phase !== "running" || current.assistance === "none") return;
    const step = current.mission.steps[current.stepIndex];
    if (step?.advanceOn !== "verify") return;

    let cancelled = false;
    let validating = false;
    const lastStep = current.stepIndex >= current.mission.steps.length - 1;
    const tick = async () => {
      if (validating) return;
      try {
        const report = await training.checkMission(current.mission.id, { evaluation: false });
        if (cancelled || !report) return;
        const result = (report.results ?? []).find((r) => r.id === step.criterionId);
        if (!result?.met) return;
        if (!lastStep) {
          next();
          return;
        }
        // DERNIÈRE ÉTAPE VÉRIFIÉE : le critère est prouvé, la mission peut
        // être validée sans clic supplémentaire. Sans cela, le coach restait
        // bloqué sur l'étape finale alors que le serveur voyait déjà la
        // preuve (« Valider la mission » restait à cliquer).
        validating = true;
        await validate();
      } catch {
        /* le sondage reprendra au prochain tic */
      }
    };
    tick();
    const interval = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [session?.stepIndex, session?.mission?.id, session?.phase, session?.assistance, training, next, validate, setSessionSafe]);

  const value = useMemo(
    () => ({
      session,
      step: session ? session.mission.steps[session.stepIndex] ?? null : null,
      stepCount: session ? session.mission.steps.length : 0,
      startMission,
      goto,
      next,
      prev,
      pause,
      resume,
      quit,
      verifyNow,
      validate,
      restart,
      setNote,
    }),
    [session, startMission, goto, next, prev, pause, resume, quit, verifyNow, validate, restart, setNote],
  );

  return <CoachContext.Provider value={value}>{children}</CoachContext.Provider>;
}

export function useCoach() {
  const context = useContext(CoachContext);
  if (!context) throw new Error("useCoach doit être utilisé dans <CoachProvider>.");
  return context;
}
