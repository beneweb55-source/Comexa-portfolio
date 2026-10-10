"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

/**
 * Page « Réalisations ». Les études de cas et leurs catégories viennent de l'API
 * (espace équipe > Contenu), lues côté serveur dans `app/realisations/page.jsx`.
 * Les visuels ne sont pas encore fournis : les cartes utilisent une couverture
 * typographique. Le bloc d'appel à l'action reste un texte de page.
 */
export default function RealisationsView({ apiCaseStudies, apiCategories }) {
  const studies = useMemo(() => apiCaseStudies?.items ?? [], [apiCaseStudies]);
  const categories = apiCategories?.items ?? [];
  const [filter, setFilter] = useState("");

  const visible = useMemo(
    () => (filter ? studies.filter((study) => study.category?.slug === filter) : studies),
    [filter, studies],
  );

  return (
    <main className="cx-pub-container">
      {/* EN-TÊTE */}
      <section className="cx-pub-page-hero">
        <div>
          <nav aria-label="Fil d’Ariane" className="cx-pub-crumbs">
            <Link href="/">Accueil</Link>
            <span aria-hidden="true">›</span>
            <span aria-current="page">Réalisations</span>
          </nav>
          <p className="cx-pub-eyebrow">Naviguer le digital ensemble</p>
          <h1 className="cx-pub-display" style={{ marginTop: "var(--comexa-space-5)" }}>
            Des projets concrets. Un cap qui vous ressemble.
          </h1>
          <p className="cx-pub-lead" style={{ marginTop: "var(--comexa-space-6)" }}>
            Sites vitrines, e-commerce et applications web : découvrez nos réalisations et les choix qui donnent forme
            à chaque besoin.
          </p>
          <div className="cx-pub-cta-row" style={{ marginTop: "var(--comexa-space-8)" }}>
            <a href="#projets" className="cx-btn cx-btn--accent cx-btn--lg">
              Explorer nos réalisations
            </a>
            <a href="#etudes-de-cas" className="cx-pub-link">
              Lire les études de cas <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
        {studies.length > 0 ? (
          <ol className="cx-pub-index" aria-label="Réalisations">
            {studies.map((study, index) => (
              <li key={study.id}>
                <a href={`#cas-${study.slug}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span>{study.title}</span>
                  <span aria-hidden="true">→</span>
                </a>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      {/* GALERIE */}
      <section id="projets" className="cx-pub-section" aria-labelledby="projets-title">
        <div className="cx-pub-split" style={{ alignItems: "end" }}>
          <div>
            <p className="cx-pub-eyebrow">Nos réalisations</p>
            <h2 id="projets-title" className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-5)" }}>
              Des projets pour des besoins différents.
            </h2>
          </div>
          <p className="cx-pub-body">
            Chaque projet associe exigence visuelle, solidité technique et autonomie pour les équipes qui le font vivre.
          </p>
        </div>

        {categories.length > 0 ? (
          <div className="cx-pub-filters" role="group" aria-label="Filtrer par type de projet" style={{ marginTop: "var(--comexa-space-8)" }}>
            {[{ slug: "", name: "Tous" }, ...categories].map((category) => (
              <button
                key={category.slug || "all"}
                type="button"
                className="cx-pub-filter"
                aria-pressed={filter === category.slug}
                onClick={() => setFilter(category.slug)}
              >
                {category.name}
              </button>
            ))}
            <span className="cx-pub-small" aria-live="polite" style={{ marginInlineStart: "auto" }}>
              {visible.length} réalisation{visible.length > 1 ? "s" : ""}
            </span>
          </div>
        ) : null}

        {apiCaseStudies?.items === null ? (
          <p className="cx-pub-body" role="status" style={{ marginTop: "var(--comexa-space-8)" }}>
            Nos réalisations ne peuvent pas être affichées pour le moment. Revenez dans quelques instants.
          </p>
        ) : null}
        {apiCaseStudies?.items !== null && studies.length === 0 ? (
          <p className="cx-pub-body" role="status" style={{ marginTop: "var(--comexa-space-8)" }}>
            Les réalisations seront publiées prochainement.
          </p>
        ) : null}
        {apiCaseStudies?.items !== null && studies.length > 0 && visible.length === 0 ? (
          <p className="cx-pub-body" role="status" style={{ marginTop: "var(--comexa-space-8)" }}>
            Aucune réalisation dans cette catégorie pour le moment.
          </p>
        ) : null}

        <div className="cx-pub-showcase">
          {visible.map((study, index) => (
            <Link
              key={study.id}
              href={`#cas-${study.slug}`}
              className={`cx-pub-project cx-pub-project--tint-${(index % 3) + 1} cx-pub-project--${index === 0 ? "featured" : "standard"}`}
            >
              <div className="cx-pub-project__cover">
                <span className="cx-pub-project__index">{String(studies.indexOf(study) + 1).padStart(2, "0")}</span>
                <span className="cx-pub-project__cover-name">{study.title}</span>
              </div>
              <div className="cx-pub-project__body">
                <span className="cx-pub-project__cat">{study.category?.name ?? "Réalisation"}</span>
                <h3 className="cx-pub-project__title">{study.title}</h3>
                <p className="cx-pub-body" style={{ fontSize: 15 }}>{study.excerpt}</p>
                <div className="cx-pub-project__meta">
                  <span>{study.clientName ?? ""}</span>
                  <span aria-hidden="true">Lire le cas →</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ÉTUDES DE CAS */}
      {visible.length > 0 ? (
        <section id="etudes-de-cas" className="cx-pub-section cx-pub-section--line" aria-labelledby="cases-title">
          <p className="cx-pub-eyebrow">Études de cas</p>
          <h2 id="cases-title" className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-5)", marginBottom: "var(--comexa-space-6)" }}>
            Du besoin à l’expérience.
          </h2>
          <div className="cx-pub-cases">
            {visible.map((study) => (
              <article key={study.id} id={`cas-${study.slug}`} className="cx-pub-case">
                <span className="cx-pub-case__num" aria-hidden="true">
                  {String(studies.indexOf(study) + 1).padStart(2, "0")}
                </span>
                <div className="cx-pub-case__head">
                  <span className="cx-pub-project__cat">{study.category?.name ?? "Réalisation"}</span>
                  <h3 className="cx-pub-case__name">{study.title}</h3>
                  <p className="cx-pub-body">{study.excerpt}</p>
                </div>
                <div className="cx-pub-case__text">
                  {study.content
                    ? study.content.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)
                    : null}
                  {study.clientName ? <p className="cx-pub-case__scope">Client : {study.clientName}</p> : null}
                  {Array.isArray(study.techStack) && study.techStack.length ? (
                    <p className="cx-pub-case__scope">Technologies : {study.techStack.filter((item) => typeof item === "string").join(" · ")}</p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* CTA — seule carte Ink */}
      <section className="cx-pub-section" style={{ paddingTop: 0 }}>
        <div className="cx-pub-cta">
          <div>
            <p className="cx-pub-eyebrow">Un projet en tête ?</p>
            <h2 className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-4)", fontSize: "clamp(1.75rem, 3.4vw, 2.5rem)" }}>
              Donnons forme à votre prochain projet.
            </h2>
            <p style={{ marginTop: "var(--comexa-space-4)" }}>
              Vous avez un besoin, une idée ou un site à faire évoluer ? Parlons de vos objectifs et construisons une
              expérience web claire, utile et durable.
            </p>
          </div>
          <div style={{ display: "grid", gap: "var(--comexa-space-3)", justifyItems: "start" }}>
            <Link href="/contact" className="cx-btn cx-btn--accent cx-btn--lg">
              Parlons de votre projet
            </Link>
            <a href="mailto:bonjour@comexa.dz" className="cx-pub-link" style={{ color: "var(--comexa-ink-inverse)" }}>
              bonjour@comexa.dz
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
