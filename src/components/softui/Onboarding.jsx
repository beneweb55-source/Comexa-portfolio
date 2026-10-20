"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/session";
import { buildTrainingCourses, courseProgress, LEVEL_LABELS, shouldProposeTraining } from "@/lib/onboarding.mjs";
import { messageOf } from "@/lib/api";
import Dialog from "./Dialog";

export default function Onboarding({ area }) {
  const { user, baseUser, request, refreshProfile } = useAuth();
  const userId = (baseUser ?? user)?.id;
  const router = useRouter();
  const [data, setData] = useState({ owner: null, access: [], progress: [], loaded: false });
  const [view, setView] = useState(null);
  const [selectedArea, setSelectedArea] = useState(area);
  const [chapterId, setChapterId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [restart, setRestart] = useState(false);
  const activeRequest = useRef(null);
  const saving = useRef(false);
  const prompted = useRef(null);

  const load = useCallback(async () => {
    if (!userId) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const [accessResponse, progressResponse] = await Promise.all([
        request('/auth/onboarding/access', { signal: controller.signal, space: null }),
        request('/auth/onboarding', { signal: controller.signal, space: null }),
        refreshProfile(),
      ]);
      if (controller.signal.aborted) return;
      const access = Array.isArray(accessResponse.data) ? accessResponse.data : [];
      const progress = Array.isArray(progressResponse.data) ? progressResponse.data : [];
      setData({ owner: userId, access, progress, loaded: true });
      setError(null);
      if (prompted.current !== `${userId}:${area}`) {
        prompted.current = `${userId}:${area}`;
        const path = window.location.pathname;
        if ((path.endsWith('/tableau-de-bord') || path === '/espace-client')
          && buildTrainingCourses(access).some((course) => course.id === area && shouldProposeTraining(course, progress.find((row) => row.area === course.id)))) {
          setView('dashboard');
        }
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        // Échec fermé : ne pas enseigner des accès anciens ou supposés.
        setData({ owner: userId, access: [], progress: [], loaded: true });
        setError(messageOf(caught));
      }
    }
  }, [area, refreshProfile, request, userId]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { load(); }, 0);
    const refreshVisible = () => { if (document.visibilityState === 'visible' && !saving.current) load(); };
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    const interval = window.setInterval(refreshVisible, 60_000);
    return () => {
      activeRequest.current?.abort();
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [load]);

  const courses = useMemo(() => buildTrainingCourses(data.owner === userId ? data.access : []), [data.access, data.owner, userId]);
  const progressRows = data.owner === userId ? data.progress : [];
  const course = courses.find((entry) => entry.id === selectedArea) ?? courses.find((entry) => entry.id === area) ?? courses[0];
  const saved = progressRows.find((entry) => entry.area === course?.id);
  const stats = course ? courseProgress(course, saved) : null;
  const chapter = course?.chapters.find((entry) => entry.id === chapterId);
  const totals = courses.reduce((sum, entry) => {
    const p = courseProgress(entry, progressRows.find((row) => row.area === entry.id));
    return { done: sum.done + p.done, total: sum.total + p.total, added: sum.added + p.added.length };
  }, { done: 0, total: 0, added: 0 });

  async function save(operation, target = chapter?.id, onSaved) {
    if (!course || saving.current) return false;
    saving.current = true;
    activeRequest.current?.abort();
    setBusy(true);
    setError(null);
    try {
      const { data: updated } = await request('/auth/onboarding', {
        method: 'PATCH', space: null,
        body: { area: course.id, operation, ...(target ? { chapterId: target } : {}), chapterIds: course.chapters.map((entry) => entry.id), revision: saved?.revision ?? 0 },
      });
      setData((current) => current.owner !== userId ? current : { ...current, progress: [...current.progress.filter((row) => row.area !== course.id), updated] });
      onSaved?.(updated);
      return true;
    } catch (caught) {
      // Un conflit de révision ou un retrait de droit impose une relecture serveur.
      await load();
      setError(messageOf(caught));
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function openChapter(id) {
    setChapterId(id);
    setView('chapter');
    save('visit', id);
  }
  function resume() {
    const target = stats?.remaining.find((entry) => entry.id === saved?.currentChapterId) ?? stats?.remaining[0] ?? course?.chapters[0];
    if (target) openChapter(target.id);
  }
  function close() {
    if (busy) return;
    if (course && stats.remaining.length) save('pause', chapter?.id, () => setView(null));
    else setView(null);
  }
  const groups = course ? [...new Set(course.chapters.map((entry) => entry.module))] : [];

  return <>
    <button type="button" className="sui-btn" style={{ margin: '8px 0', flexShrink: 0 }} onClick={() => { setView('dashboard'); load(); }}>
      Aide · Formation COMEXA{totals.total ? ` · ${totals.done}/${totals.total}` : ''}
      {totals.added > 0 ? ' · Nouveaux chapitres' : ''}
    </button>
    {view ? <Dialog size="lg" title={view === 'chapter' && chapter ? chapter.title : 'Votre tableau de bord de formation'}
      eyebrow={course ? `${course.label} · ${stats.done}/${stats.total} chapitres acquis` : 'Formation COMEXA'}
      description="Des procédures vérifiées dans l’application, adaptées à vos permissions effectives. Aucun exercice ne crée de données automatiquement."
      onClose={close}
      footer={<div className="flex flex-wrap gap-2">
        {view === 'chapter' ? <button className="sui-btn" disabled={busy} onClick={() => setView('dashboard')}>Tous les chapitres</button> : null}
        <button className="sui-btn" disabled={busy} onClick={close}>{view === 'chapter' ? 'Reprendre plus tard' : 'Fermer'}</button>
        <button className="sui-btn" disabled={busy} onClick={load}>Actualiser mes accès</button>
      </div>}>
      <div className="sui-training">
        {error ? <p role="alert" className="sui-training__notice">{error} Votre progression n’est pas considérée comme enregistrée. Vous pouvez actualiser puis réessayer.</p> : null}
        {!data.loaded ? <p role="status">Chargement de vos parcours…</p> : null}
        {data.loaded && !courses.length && !error ? <p>Aucun espace de formation accessible pour ce compte.</p> : null}
        {view === 'chapter' && chapter ? <TrainingChapter key={chapter.id} chapter={chapter} completed={stats.completed.has(chapter.id)} busy={busy}
          onReopen={() => save('reopen')}
          onComplete={() => save('complete', chapter.id, (updated) => {
            const next = courseProgress(course, updated).remaining.find((entry) => entry.id !== chapter.id);
            if (next) setChapterId(next.id);
            else setView('dashboard');
          })}
          onSkip={() => {
            const index = course.chapters.findIndex((entry) => entry.id === chapter.id);
            const next = course.chapters.slice(index + 1).find((entry) => !stats.completed.has(entry.id));
            if (next) { setChapterId(next.id); save('visit', next.id); }
            else setView('dashboard');
          }}
          onExplore={() => save('pause', chapter.id, () => { setView(null); router.push(chapter.href); })} /> : <>
          <p>Choisissez un espace, puis un objectif. Les étapes terminées restent acquises si l’ordre ou vos accès changent. Les nouveaux outils ajoutent seulement leurs chapitres.</p>
          <p role="status">Total : {totals.done} chapitre(s) acquis sur {totals.total} actuellement accessibles.</p>
          <div className="sui-training__spaces" role="group" aria-label="Espaces de formation accessibles">
            {courses.map((entry) => {
              const p = courseProgress(entry, progressRows.find((row) => row.area === entry.id));
              return <button key={entry.id} type="button" className={`sui-training__space ${entry.id === course?.id ? 'is-active' : ''}`} aria-pressed={entry.id === course?.id} disabled={busy}
                onClick={() => { setSelectedArea(entry.id); setChapterId(null); setRestart(false); }}>
                <strong>{entry.label}</strong><span>{p.done}/{p.total} acquis · {p.remaining.length} restant(s)</span>
                <progress aria-label={`Progression ${entry.label}`} value={p.done} max={p.total} />
                {p.added.length ? <span>{p.added.length} nouveau(x) chapitre(s)</span> : null}
              </button>;
            })}
          </div>
          {course ? <>
            <h3>{course.label}</h3><p>{course.objective}</p>
            {saved?.curriculumVersion === 1 ? <p className="sui-training__notice">Votre ancien parcours {saved.status === 'completed' ? 'terminé' : 'en cours'} est conservé. Cette formation enrichie utilise des acquis par chapitre ; l’ancien numéro d’étape ne permet pas d’attester ces nouvelles procédures.</p> : null}
            <div className="flex flex-wrap gap-2">
              <button className="sui-btn sui-btn--dark" disabled={busy} onClick={resume}>{stats.remaining.length ? 'Reprendre le premier chapitre restant' : 'Consulter le parcours terminé'}</button>
              <button className="sui-btn" disabled={busy} onClick={() => setRestart(true)}>Recommencer cet espace</button>
            </div>
            {restart ? <div className="sui-training__notice" role="group" aria-label="Confirmer le recommencement">
              <p>Effacer les acquis actuellement accessibles de {course.label} ? Les autres espaces et les acquis temporairement masqués par vos permissions seront conservés.</p>
              <div className="flex flex-wrap gap-2"><button className="sui-btn" disabled={busy} onClick={() => setRestart(false)}>Annuler</button>
                <button className="sui-btn sui-btn--dark" disabled={busy} onClick={() => save('restart', course.chapters[0].id, () => { setRestart(false); setChapterId(course.chapters[0].id); setView('chapter'); })}>Confirmer le recommencement</button></div>
            </div> : null}
            {groups.map((module) => {
              const entries = course.chapters.filter((entry) => entry.module === module);
              const completedCount = entries.filter((entry) => stats.completed.has(entry.id)).length;
              return <details key={module} className="sui-training__module" open={module === 'introduction' || undefined}>
                <summary>{entries[0].moduleLabel} · {completedCount}/{entries.length} acquis</summary>
                <ul>{entries.map((entry) => <li key={entry.id}>
                  <button type="button" disabled={busy} onClick={() => openChapter(entry.id)} className="sui-training__chapter-link">
                    <span>{stats.completed.has(entry.id) ? '✓ Acquis' : 'À faire'} · {LEVEL_LABELS[entry.level]}</span>
                    <strong>{entry.title}</strong>
                  </button>
                </li>)}</ul>
              </details>;
            })}
          </> : null}
        </>}
      </div>
    </Dialog> : null}
  </>;
}

function TrainingChapter({ chapter, completed, busy, onComplete, onReopen, onSkip, onExplore }) {
  const articleRef = useRef(null);
  useEffect(() => { articleRef.current?.focus(); }, [chapter.id]);
  const [choice, setChoice] = useState(null);
  const [checked, setChecked] = useState(false);
  const correct = choice === chapter.quiz.answer;
  return <article className="sui-training__lesson" ref={articleRef} tabIndex={-1} aria-label={chapter.title}>
    <p className="sui-training__badge">{LEVEL_LABELS[chapter.level]} · {completed ? 'Chapitre acquis' : 'Chapitre à effectuer'}</p>
    {chapter.objective ? <section><h3>Objectif de l’espace</h3><p>{chapter.objective}</p></section> : null}
    <section><h3>Procédure et ordre de travail</h3><ol>{chapter.steps.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol></section>
    <section><h3>Mise en situation</h3><p>{chapter.example}</p></section>
    <section className="sui-training__notice"><h3>Erreurs à éviter et points de contrôle</h3><p>{chapter.pitfalls}</p></section>
    <section><h3>Résultat attendu et responsabilité</h3><p>{chapter.result}</p></section>
    {chapter.href ? <button className="sui-btn" disabled={busy} onClick={onExplore}>Ouvrir la rubrique concernée</button> : null}
    <p className="sui-card__desc">Pour les actions sensibles, étudiez le scénario sans exécuter d’opération réelle pour vous entraîner. La formation enregistre votre compréhension déclarée, pas une certification automatique d’action métier.</p>
    <fieldset className="sui-training__quiz"><legend>Vérification des acquis : {chapter.quiz.question}</legend>
      {chapter.quiz.options.map((option, index) => <label key={option}>
        <input type="radio" name={`quiz-${chapter.id}`} checked={choice === index} onChange={() => { setChoice(index); setChecked(false); }} disabled={busy} />
        <span>{option}</span>
      </label>)}
      <button className="sui-btn" disabled={choice === null || busy} onClick={() => setChecked(true)}>Vérifier ma réponse</button>
      {checked ? <p role="status">{correct ? 'Réponse correcte. ' : 'Réponse à revoir. '}{chapter.quiz.explanation}</p> : null}
    </fieldset>
    <div className="flex flex-wrap gap-2">
      {completed ? <button className="sui-btn" disabled={busy} onClick={onReopen}>Remettre ce chapitre à faire</button> : <button className="sui-btn sui-btn--dark" disabled={busy || !checked || !correct} onClick={onComplete}>Valider ce chapitre</button>}
      <button className="sui-btn" disabled={busy} onClick={onSkip}>Passer sans valider</button>
    </div>
  </article>;
}
