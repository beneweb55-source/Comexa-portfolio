"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { CtaBand, PageHero, SectionHead, WorkCard, columnsFor, pad } from "@/components/public/PublicBlocks";

/**
 * Page « Réalisations ». Les études de cas et leurs catégories viennent de l'API
 * (espace équipe > Contenu), lues côté serveur dans `app/realisations/page.jsx`.
 *
 * Chaque projet apparaît deux fois, avec deux rôles distincts : une carte courte
 * (galerie filtrable) puis son étude de cas détaillée, ouverte par la carte.
 * Les visuels ne sont pas encore fournis : les cartes utilisent une couverture
 * typographique, comme sur l'accueil.
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
    <main id="contenu" tabIndex={-1}>
      <PageHero
        current="Réalisations"
        eyebrow="Réalisations"
        title="Des projets concrets. Un cap qui vous ressemble."
        lead="Sites vitrines, e-commerce et applications web : découvrez nos réalisations et les choix qui donnent forme à chaque besoin."
      />

      {/* GALERIE FILTRABLE */}
      <section id="projets" className="cx-pub-section cx-pub-section--alt" aria-labelledby="projets-title">
        <div className="cx-pub-container">
          <SectionHead eyebrow="Nos réalisations" titleId="projets-title" title="Des projets pour des besoins différents.">
            <p>
              Chaque projet associe exigence visuelle, solidité technique et autonomie pour les équipes qui le font
              vivre.
            </p>
          </SectionHead>

          {categories.length > 0 && studies.length > 0 ? (
            <div className="cx-pub-filters" role="group" aria-label="Filtrer par type de projet">
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
              <span className="cx-pub-filters__count" aria-live="polite">
                {visible.length} réalisation{visible.length > 1 ? "s" : ""}
              </span>
            </div>
          ) : null}

          {apiCaseStudies?.items === null ? (
            <p className="cx-pub-status" role="status">
              Nos réalisations ne peuvent pas être affichées pour le moment. Revenez dans quelques instants.
            </p>
          ) : null}
          {apiCaseStudies?.items !== null && studies.length === 0 ? (
            <p className="cx-pub-status" role="status">
              Les réalisations seront publiées prochainement.
            </p>
          ) : null}
          {studies.length > 0 && visible.length === 0 ? (
            <p className="cx-pub-status" role="status">
              Aucune réalisation dans cette catégorie pour le moment.
            </p>
          ) : null}

          {visible.length > 0 ? (
            <ul className="cx-pub-works" style={{ "--cx-cols": columnsFor(visible.length) }}>
              {visible.map((study) => {
                const position = studies.indexOf(study);
                return (
                  <li key={study.id}>
                    <WorkCard study={study} number={pad(position + 1)} tone={(position % 3) + 1} href={`#cas-${study.slug}`} />
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </section>

      {/* ÉTUDES DE CAS */}
      {visible.length > 0 ? (
        <section id="etudes-de-cas" className="cx-pub-section" aria-labelledby="cases-title">
          <div className="cx-pub-container">
            <SectionHead eyebrow="Études de cas" titleId="cases-title" title="Du besoin à l’expérience.">
              <p>Le contexte, les choix et le périmètre de chaque projet, en quelques minutes de lecture.</p>
            </SectionHead>

            <div className="cx-pub-cases">
              {visible.map((study) => {
                const tech = Array.isArray(study.techStack) ? study.techStack.filter((item) => typeof item === "string") : [];
                const subject = study.category?.name ?? "Nouveau projet";
                return (
                  <article key={study.id} id={`cas-${study.slug}`} className="cx-pub-case" aria-labelledby={`cas-${study.slug}-titre`}>
                    <div className="cx-pub-case__head">
                      <div className="cx-pub-case__meta">
                        <span className="cx-pub-case__num" aria-hidden="true">
                          {pad(studies.indexOf(study) + 1)}
                        </span>
                        <span className="cx-pub-tag">{study.category?.name ?? "Réalisation"}</span>
                      </div>
                      <h3 id={`cas-${study.slug}-titre`} className="cx-pub-case__name">
                        {study.title}
                      </h3>
                      {study.excerpt ? <p className="cx-pub-case__excerpt">{study.excerpt}</p> : null}
                      {study.clientName || tech.length ? (
                        <dl className="cx-pub-case__facts">
                          {study.clientName ? (
                            <div>
                              <dt>Client</dt>
                              <dd>{study.clientName}</dd>
                            </div>
                          ) : null}
                          {tech.length ? (
                            <div>
                              <dt>Technologies</dt>
                              <dd>
                                <ul className="cx-pub-chips">
                                  {tech.map((item) => (
                                    <li key={item}>{item}</li>
                                  ))}
                                </ul>
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                      ) : null}
                    </div>

                    <div className="cx-pub-case__text">
                      {study.content
                        ? study.content.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)
                        : null}
                      <div className="cx-pub-cta-row">
                        {study.projectUrl ? (
                          <a href={study.projectUrl} target="_blank" rel="noopener noreferrer" className="cx-pub-link">
                            Voir le site en ligne <ArrowUpRight size={16} aria-hidden="true" />
                          </a>
                        ) : null}
                        <Link href={`/contact?sujet=${encodeURIComponent(subject)}`} className="cx-pub-link">
                          Un projet similaire ? Parlons-en <ArrowRight size={16} aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      <CtaBand
        eyebrow="Un projet en tête ?"
        title="Donnons forme à votre prochain projet."
        text="Vous avez un besoin, une idée ou un site à faire évoluer ? Parlons de vos objectifs et construisons une expérience web claire, utile et durable."
        primary={{ href: "/contact", label: "Parlons de votre projet" }}
        secondary={{ href: "/services", label: "Découvrir nos services" }}
      />
    </main>
  );
}
