"use client";

import Link from "next/link";
import { ArrowUpRight, CircleAlert, Flag, MessageSquare } from "lucide-react";
import { formatDateOnly } from "@/lib/api";
import { buildProjectStory } from "@/lib/client-portal.mjs";
import { Empty, Notice, ProgressBar } from "@/components/workspace/ui";
import { StatusPill } from "@/components/softui";

function stepTone(step) {
  if (step.done) return "green";
  if (step.cancelled) return "plain";
  if (step.late) return "pink";
  if (step.status === "IN_PROGRESS") return "blue";
  return "yellow";
}

/**
 * Recit de projet cote client. Les seules donnees affichees sont la fiche
 * projet et les jalons deja filtres par le backend. Aucun fil d'activite
 * interne, aucune tache, aucun temps, aucun budget.
 */
export default function ClientProjectStory({ project, milestones, loading = false, error = null }) {
  const story = buildProjectStory(project, milestones);

  return (
    <section className="client-story" data-testid="client-project-story" aria-labelledby="client-story-title">
      <header className="client-story__head">
        <div>
          <p className="client-focus__eyebrow">Où en est votre projet</p>
          <h2 id="client-story-title">{project.name || project.reference}</h2>
        </div>
        <StatusPill label={story.statusLabel} tone="blue" />
      </header>

      <div className="client-story__summary">
        <div>
          <p className="client-story__explanation">{story.statusExplanation}</p>
          <p className="client-story__dates">
            {project.reference ? `Référence ${project.reference}` : "Projet"}
            {project.dueDate ? ` · échéance prévue ${formatDateOnly(project.dueDate)}` : " · aucune échéance publiée"}
          </p>
        </div>
        <div className="client-story__progress">
          <span className="sui-tabular">{story.progressPercent} %</span>
          <ProgressBar value={story.progressPercent} />
          <p>{story.completedCount} étape{story.completedCount > 1 ? "s" : ""} terminée{story.completedCount > 1 ? "s" : ""}{story.totalCount ? ` sur ${story.totalCount}` : ""}</p>
        </div>
      </div>

      {story.nextStep ? (
        <div className="client-story__next" data-testid="client-project-next-step">
          <span className="client-story__next-icon" aria-hidden="true"><Flag size={18} strokeWidth={1.9} /></span>
          <div>
            <p className="client-focus__eyebrow">{story.nextStep.isCurrent ? "Étape en cours" : "Prochaine étape connue"}</p>
            <h3>{story.nextStep.title}</h3>
            <p>
              {story.nextStep.label}
              {story.nextStep.dueDate ? ` · échéance ${formatDateOnly(story.nextStep.dueDate)}` : " · aucune date communiquée"}
            </p>
          </div>
        </div>
      ) : (
        <div className="client-story__next client-story__next--empty">
          <p>Aucune étape à venir n’a encore été publiée. Nous n’inventons ni date ni responsable : l’équipe mettra cette section à jour dès qu’une prochaine étape sera connue.</p>
        </div>
      )}

      <div className="client-story__timeline-head">
        <h3>Les étapes de votre projet</h3>
        <p>Chaque étape visible ici a été partagée par l’équipe.</p>
      </div>
      {error ? <Notice>{error}</Notice> : null}
      {loading ? <p className="client-focus__muted" role="status">Chargement des étapes…</p> : null}
      {!loading && !error && story.timeline.length === 0 ? (
        <Empty icon={Flag}>Les étapes du projet seront publiées ici.</Empty>
      ) : null}
      {!loading && !error && story.timeline.length > 0 ? (
        <ol className="client-story__timeline" data-testid="client-project-timeline">
          {story.timeline.map((step) => (
            <li key={step.id} className={`client-story__step${step.done ? " is-done" : ""}${step.cancelled ? " is-cancelled" : ""}`} data-status={step.status}>
              <span className="client-story__dot" aria-hidden="true" />
              <div className="client-story__step-copy">
                <div className="client-story__step-head">
                  <h4>{step.title}</h4>
                  <StatusPill label={step.statusLabel} tone={stepTone(step)} />
                </div>
                {step.description ? <p>{step.description}</p> : null}
                <p className="client-story__step-date">
                  {step.dueDate ? `Échéance ${formatDateOnly(step.dueDate)}` : "Sans date communiquée"}
                  {step.reachedAt ? ` · terminée le ${formatDateOnly(step.reachedAt)}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="client-story__actions">
        <Link className="client-focus__link" href="/espace-client/messagerie">
          <MessageSquare size={16} aria-hidden="true" /> Poser une question sur ce projet
        </Link>
        <Link className="client-focus__link" href="/espace-client">
          <ArrowUpRight size={16} aria-hidden="true" /> Retour à mon espace
        </Link>
      </div>
      {error ? <p className="client-focus__muted"><CircleAlert size={14} aria-hidden="true" /> Les étapes non disponibles n’ont pas été remplacées par des données internes.</p> : null}
    </section>
  );
}
