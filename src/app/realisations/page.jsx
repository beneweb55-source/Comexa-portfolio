"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

/*
 * Les visuels de projets ne sont pas encore fournis dans le dépôt : les cartes
 * utilisent donc une couverture typographique, sans image de substitution.
 * Ajouter ici un visuel réel (`image`) dès qu'il est validé par COMEXA.
 */
const projects = [
  {
    id: "atelier-noroit",
    category: "Sites vitrines",
    name: "Atelier Noroît",
    description:
      "Refonte du site éditorial d’un studio d’architecture : projets mieux structurés, navigation sobre et publication facilitée pour l’équipe.",
    expertise: "Direction UX · Développement front-end · CMS",
    intro:
      "Refonte du site éditorial d’un studio d’architecture : une expérience plus claire pour présenter les projets et faciliter la publication.",
    need:
      "Le studio avait besoin d’une présentation plus structurée de ses réalisations, tout en conservant une identité sobre et éditoriale.",
    solution:
      "Une interface pensée autour des projets, avec une navigation simplifiée, une hiérarchie claire et un système de publication adapté à l’équipe.",
  },
  {
    id: "comptoir-local",
    category: "E-commerce",
    name: "Comptoir Local",
    description:
      "Une boutique en ligne chaleureuse, avec un catalogue clarifié et un parcours de commande sans friction.",
    expertise: "UX/UI · E-commerce · Connexions métier",
    intro:
      "Une boutique en ligne chaleureuse, pensée pour rendre le catalogue plus lisible et simplifier le parcours de commande.",
    need:
      "Le catalogue devait être mieux organisé afin de permettre aux visiteurs de trouver rapidement les produits et de passer commande.",
    solution:
      "Une expérience e-commerce plus claire, avec une organisation du catalogue et un parcours d’achat pensé pour limiter les frictions.",
  },
  {
    id: "oryon-pilot",
    category: "Applications web",
    name: "Oryon Pilot",
    description:
      "Un outil métier qui rassemble le suivi des dossiers, les échanges et les échéances dans une seule interface.",
    expertise: "Product design · Application web · API",
    intro: "Un outil métier pour centraliser les dossiers, les échanges et les échéances dans une seule interface.",
    need:
      "L’équipe avait besoin de rassembler plusieurs informations et actions métier dans un même espace de travail.",
    solution:
      "Une application web structurée autour du suivi des dossiers, des échanges et des échéances, avec une interface adaptée aux usages quotidiens.",
  },
];

const filters = ["Tous", "Sites vitrines", "E-commerce", "Applications web"];

export default function Realisations() {
  const [filter, setFilter] = useState("Tous");

  const visible = useMemo(
    () => (filter === "Tous" ? projects : projects.filter((project) => project.category === filter)),
    [filter],
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
        <ol className="cx-pub-index" aria-label="Réalisations">
          {projects.map((project, index) => (
            <li key={project.id}>
              <a href={`#cas-${project.id}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <span>{project.name}</span>
                <span aria-hidden="true">→</span>
              </a>
            </li>
          ))}
        </ol>
      </section>

      {/* GALERIE */}
      <section id="projets" className="cx-pub-section" aria-labelledby="projets-title">
        <div className="cx-pub-split" style={{ alignItems: "end" }}>
          <div>
            <p className="cx-pub-eyebrow">Nos réalisations</p>
            <h2 id="projets-title" className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-5)" }}>
              Trois besoins différents. La même exigence web.
            </h2>
          </div>
          <p className="cx-pub-body">
            Chaque projet associe exigence visuelle, solidité technique et autonomie pour les équipes qui le font vivre.
          </p>
        </div>

        <div className="cx-pub-filters" role="group" aria-label="Filtrer par type de projet" style={{ marginTop: "var(--comexa-space-8)" }}>
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              className="cx-pub-filter"
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
          <span className="cx-pub-small" aria-live="polite" style={{ marginInlineStart: "auto" }}>
            {visible.length} réalisation{visible.length > 1 ? "s" : ""}
          </span>
        </div>

        <div className="cx-pub-showcase">
          {visible.map((project, index) => (
            <Link
              key={project.id}
              href={`#cas-${project.id}`}
              className={`cx-pub-project cx-pub-project--tint-${(index % 3) + 1} cx-pub-project--${index === 0 ? "featured" : "standard"}`}
            >
              <div className="cx-pub-project__cover">
                <span className="cx-pub-project__index">{String(projects.indexOf(project) + 1).padStart(2, "0")}</span>
                <span className="cx-pub-project__cover-name">{project.name}</span>
              </div>
              <div className="cx-pub-project__body">
                <span className="cx-pub-project__cat">{project.category}</span>
                <h3 className="cx-pub-project__title">{project.name}</h3>
                <p className="cx-pub-body" style={{ fontSize: 15 }}>{project.description}</p>
                <div className="cx-pub-project__meta">
                  <span>{project.expertise}</span>
                  <span aria-hidden="true">Lire le cas →</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
        <p className="cx-pub-small" style={{ marginTop: "var(--comexa-space-8)" }}>
          Les études de cas et les détails de chaque projet sont présentés ci-dessous.
        </p>
      </section>

      {/* ÉTUDES DE CAS */}
      <section id="etudes-de-cas" className="cx-pub-section cx-pub-section--line" aria-labelledby="cases-title">
        <p className="cx-pub-eyebrow">Études de cas</p>
        <h2 id="cases-title" className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-5)", marginBottom: "var(--comexa-space-6)" }}>
          Du besoin à l’expérience.
        </h2>
        <div className="cx-pub-cases">
          {projects.map((project, index) => (
            <article key={project.id} id={`cas-${project.id}`} className="cx-pub-case">
              <span className="cx-pub-case__num" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="cx-pub-case__head">
                <span className="cx-pub-project__cat">{project.category}</span>
                <h3 className="cx-pub-case__name">{project.name}</h3>
                <p className="cx-pub-body">{project.intro}</p>
              </div>
              <div className="cx-pub-case__text">
                <div>
                  <h4 style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--comexa-accent-text)", marginBottom: "var(--comexa-space-2)" }}>
                    Le besoin
                  </h4>
                  <p>{project.need}</p>
                </div>
                <div>
                  <h4 style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--comexa-accent-text)", marginBottom: "var(--comexa-space-2)" }}>
                    La solution
                  </h4>
                  <p>{project.solution}</p>
                </div>
                <p className="cx-pub-case__scope">Périmètre : UX/UI · Développement · Mise en ligne · {project.expertise}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

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
