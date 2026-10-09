"use client";

import { useRef, useState } from "react";
import Link from "next/link";

const packs = [
  {
    id: "site-vitrine",
    name: "Site vitrine",
    tagline: "Présenter & convaincre",
    description:
      "Une présence claire, distinctive et pensée pour convertir vos visiteurs en prises de contact qualifiées.",
    features: [
      "Cadrage des objectifs et arborescence",
      "Conception UX/UI et interface responsive",
      "Développement front-end et CMS",
      "Pages de présentation et formulaire de contact",
      "Bases SEO techniques et performance",
      "Tests, mise en ligne et prise en main",
    ],
    benefit: "Votre activité devient lisible. Votre équipe garde la main sur les contenus.",
    project: "Atelier Noroît",
    projectId: "atelier-noroit",
  },
  {
    id: "e-commerce",
    name: "E-commerce",
    tagline: "Vendre & gérer",
    description:
      "Des parcours d’achat fluides, une administration fiable et les intégrations utiles à votre activité.",
    features: [
      "Cadrage du catalogue et parcours d’achat",
      "Conception UX/UI et boutique responsive",
      "Catalogue, fiches produits et panier",
      "Paiement et modes de livraison configurés",
      "Gestion des commandes et connexions métier",
      "Tests, mise en ligne et prise en main",
    ],
    benefit: "Une boutique cohérente avec votre façon de vendre, plus simple à administrer.",
    project: "Comptoir Local",
    projectId: "comptoir-local",
  },
  {
    id: "application-web",
    name: "Application web",
    tagline: "Outiller & connecter",
    description:
      "Des outils métiers et plateformes performants, développés autour de vos usages réels.",
    features: [
      "Ateliers métier et périmètre fonctionnel",
      "Product design et parcours utilisateurs",
      "Développement front-end et back-end",
      "Comptes, rôles et fonctionnalités métier",
      "API et connexions aux outils existants",
      "Tests, déploiement et documentation",
    ],
    benefit: "Vos informations et vos actions réunies dans un outil adapté à votre équipe.",
    project: "Oryon Pilot",
    projectId: "oryon-pilot",
  },
];

const matrix = {
  columns: ["Site vitrine", "E-commerce", "Application web"],
  rows: [
    { label: "Votre priorité", cells: ["Présenter votre activité", "Vendre vos produits", "Outiller vos équipes"] },
    { label: "Fonctionnalité centrale", cells: ["Prise de contact", "Parcours de commande", "Workflows sur mesure"] },
    { label: "Socle commun", cells: ["UX/UI · responsive · tests", "UX/UI · responsive · tests", "UX/UI · responsive · tests"] },
    { label: "Contenus & administration", cells: ["Pages, projets et CMS", "Catalogue et commandes", "Données et interface métier"] },
    { label: "Connexions", cells: ["Selon votre besoin", "Paiement, livraison, outils métier", "API et systèmes existants"] },
    { label: "Après la mise en ligne", cells: ["Maintenance en option", "Maintenance en option", "Maintenance en option"] },
  ],
};

export default function Services() {
  const [activeId, setActiveId] = useState(packs[0].id);
  const tabRefs = useRef({});
  const active = packs.find((pack) => pack.id === activeId) ?? packs[0];

  function onTabKeyDown(event, index) {
    let next = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % packs.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + packs.length) % packs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = packs.length - 1;
    if (next === null) return;
    event.preventDefault();
    setActiveId(packs[next].id);
    tabRefs.current[packs[next].id]?.focus();
  }

  return (
    <main className="cx-pub-container">
      {/* EN-TÊTE DE PAGE */}
      <section className="cx-pub-page-hero">
        <div>
          <nav aria-label="Fil d’Ariane" className="cx-pub-crumbs">
            <Link href="/">Accueil</Link>
            <span aria-hidden="true">›</span>
            <span aria-current="page">Nos services</span>
          </nav>
          <p className="cx-pub-eyebrow">Naviguer le digital ensemble</p>
          <h1 className="cx-pub-display" style={{ marginTop: "var(--comexa-space-5)" }}>
            Votre besoin web. Le bon pack pour avancer.
          </h1>
          <p className="cx-pub-lead" style={{ marginTop: "var(--comexa-space-6)" }}>
            Site vitrine, boutique e-commerce ou application sur mesure : un cadre clair pour concevoir, développer
            et faire vivre votre projet web.
          </p>
          <div className="cx-pub-cta-row" style={{ marginTop: "var(--comexa-space-8)" }}>
            <a href="#packs" className="cx-btn cx-btn--accent cx-btn--lg">
              Découvrir les packs
            </a>
            <Link href="/realisations" className="cx-pub-link">
              Voir les réalisations <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
        <ol className="cx-pub-index" aria-label="Les trois packs">
          {packs.map((pack, index) => (
            <li key={pack.id}>
              <a href={`#packs`} onClick={() => setActiveId(pack.id)}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <span>{pack.name}</span>
                <span aria-hidden="true">→</span>
              </a>
            </li>
          ))}
        </ol>
      </section>

      {/* PACKS : ONGLETS + PANNEAU */}
      <section id="packs" className="cx-pub-section" aria-labelledby="packs-title">
        <p className="cx-pub-eyebrow">Nos packs web</p>
        <h2 id="packs-title" className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-5)", marginBottom: "var(--comexa-space-10)", maxWidth: "24ch" }}>
          Trois besoins différents. La même exigence web.
        </h2>
        <div className="cx-pub-packs">
          <div role="tablist" aria-label="Choisir un pack" aria-orientation="vertical" className="cx-pub-tablist">
            {packs.map((pack, index) => {
              const selected = pack.id === active.id;
              return (
                <button
                  key={pack.id}
                  ref={(node) => {
                    tabRefs.current[pack.id] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${pack.id}`}
                  aria-selected={selected}
                  aria-controls="pack-panel"
                  tabIndex={selected ? 0 : -1}
                  className="cx-pub-pack-tab"
                  onClick={() => setActiveId(pack.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                >
                  <span className="cx-pub-pack-tab__top">
                    <span className="cx-pub-pack-tab__name">{pack.name}</span>
                    <span className="cx-pub-pack-tab__num">{String(index + 1).padStart(2, "0")}</span>
                  </span>
                  <span className="cx-pub-pack-tab__tag">{pack.tagline}</span>
                </button>
              );
            })}
          </div>

          <article
            key={active.id}
            id="pack-panel"
            role="tabpanel"
            aria-labelledby={`tab-${active.id}`}
            className="cx-pub-pack-panel"
          >
            <div className="cx-pub-pack-panel__head">
              <span className="cx-pub-eyebrow">{active.tagline}</span>
              <h3 className="cx-pub-pack-panel__title">{active.name}</h3>
              <p className="cx-pub-body">{active.description}</p>
            </div>

            <p className="cx-pub-pack-panel__benefit">
              <strong style={{ fontWeight: 500 }}>Ce que vous y gagnez : </strong>
              {active.benefit}
            </p>

            <div>
              <p className="cx-small" style={{ fontWeight: 500, color: "var(--comexa-ink)", marginBottom: "var(--comexa-space-3)" }}>
                Le socle du pack · sur devis
              </p>
              <ul className="cx-pub-features">
                {active.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </div>

            <div className="cx-pub-pack-panel__foot">
              <Link href={`/realisations#${active.projectId}`} className="cx-pub-link">
                Voir un projet : {active.project} <span aria-hidden="true">→</span>
              </Link>
              <a
                href={`mailto:bonjour@comexa.fr?subject=${encodeURIComponent(`Demande de devis - ${active.name}`)}`}
                className="cx-btn cx-btn--primary"
              >
                Demander un devis
              </a>
            </div>
          </article>
        </div>
        <p className="cx-pub-small" style={{ marginTop: "var(--comexa-space-8)", maxWidth: "70ch" }}>
          Structure des packs et inclusions proposées à titre illustratif, à valider par Comexa. Le devis précise les
          pages, fonctionnalités, intégrations et responsabilités de chacun.
        </p>
      </section>

      {/* BÉNÉFICES */}
      <section className="cx-pub-section cx-pub-section--line">
        <div className="cx-pub-benefits">
          <div>
            <p className="cx-pub-eyebrow">Les bénéfices</p>
            <h2 className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-5)" }}>
              Une base solide pour la suite.
            </h2>
            <p className="cx-pub-body" style={{ marginTop: "var(--comexa-space-5)" }}>
              Exigence visuelle, solidité technique et autonomie : les mêmes principes guident chaque pack, du premier
              atelier à la mise en ligne.
            </p>
          </div>
          <ul className="cx-pub-benefit-list">
            <li>
              <span>01</span>
              <div>
                <strong>Un cap lisible</strong>
                Des objectifs cadrés, des choix expliqués et des validations partagées. Vous savez ce qui est construit
                et pourquoi.
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Des parcours qui fonctionnent</strong>
                Une navigation et des parcours pensés pour vos visiteurs, vos clients ou vos équipes — sans complexité
                superflue.
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Une autonomie réelle</strong>
                Une administration adaptée et une prise en main accompagnée pour faire vivre vos contenus et vos données.
              </div>
            </li>
            <li>
              <span>04</span>
              <div>
                <strong>Une base qui évolue</strong>
                Une base technique robuste, prête à accueillir de nouveaux contenus, des connexions et des fonctionnalités
                utiles.
              </div>
            </li>
          </ul>
        </div>
      </section>

      {/* COMPARAISON */}
      <section className="cx-pub-section cx-pub-section--line" aria-labelledby="compare-title">
        <p className="cx-pub-eyebrow">Choisir votre cap</p>
        <div className="cx-pub-split" style={{ alignItems: "end", marginTop: "var(--comexa-space-5)", marginBottom: "var(--comexa-space-10)" }}>
          <h2 id="compare-title" className="cx-pub-h2">Quel pack pour votre usage ?</h2>
          <p className="cx-pub-body">
            Le bon point de départ dépend de ce que votre site doit permettre de faire. Les connexions et options sont
            précisées dans le devis.
          </p>
        </div>
        <div className="cx-pub-matrix-wrap">
          <table className="cx-pub-matrix">
            <caption className="cx-pub-small" style={{ textAlign: "left", padding: "var(--comexa-space-4) var(--comexa-space-5)" }}>
              Comparaison des trois packs
            </caption>
            <thead>
              <tr>
                <th scope="col">Votre besoin</th>
                {matrix.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((cell, index) => (
                    <td key={matrix.columns[index]}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "var(--comexa-space-4)", marginTop: "var(--comexa-space-6)" }}>
          <p className="cx-pub-small">
            Une refonte ou plusieurs besoins à réunir ? Nous construisons le périmètre avec vous.
          </p>
          <Link href="/contact" className="cx-pub-link">
            Être guidé dans mon choix <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      {/* MAINTENANCE */}
      <section className="cx-pub-section" style={{ paddingTop: 0 }}>
        <div className="cx-pub-option">
          <div>
            <p className="cx-pub-eyebrow">En complément de chaque pack</p>
            <h2 className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-5)", fontSize: "clamp(1.75rem, 3.4vw, 2.5rem)" }}>
              Un suivi continu pour garder votre produit web rapide, évolutif et agréable à faire utiliser.
            </h2>
            <p className="cx-pub-small" style={{ marginTop: "var(--comexa-space-5)" }}>
              Accompagnement optionnel · modalités définies au devis
            </p>
          </div>
          <ul>
            <li>Maintenance et mises à jour de sécurité</li>
            <li>Optimisation des performances</li>
            <li>Évolutions fonctionnelles selon vos besoins</li>
          </ul>
        </div>
      </section>

      {/* CTA — seule carte Ink */}
      <section className="cx-pub-section" style={{ paddingTop: 0 }}>
        <div className="cx-pub-cta">
          <div>
            <p className="cx-pub-eyebrow">Pour commencer, simplement</p>
            <h2 className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-4)", fontSize: "clamp(1.75rem, 3.4vw, 2.5rem)" }}>
              Vous souhaitez associer votre expertise à notre savoir-faire web ?
            </h2>
            <p style={{ marginTop: "var(--comexa-space-4)" }}>
              Présentez-nous votre activité et ce que nous pourrions construire ensemble : votre activité et votre
              expertise, votre idée de collaboration, vos attentes et vos disponibilités.
            </p>
          </div>
          <div style={{ display: "grid", gap: "var(--comexa-space-3)", justifyItems: "start" }}>
            <Link href="/contact" className="cx-btn cx-btn--accent cx-btn--lg">
              Proposer une collaboration
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
