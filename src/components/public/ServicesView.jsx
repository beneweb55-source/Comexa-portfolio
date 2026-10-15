"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/api";

/**
 * Page « Nos services ». Les services viennent de l'API (espace équipe > Contenu),
 * lus côté serveur dans `app/services/page.jsx`. Aucun service n'est écrit en dur ici.
 *
 * Le prix de départ n'est affiché que s'il a été saisi, avec sa devise.
 * Les blocs éditoriaux (bénéfices, maintenance, appel à l'action) restent des textes
 * de page, non gérés par le contenu.
 */
export default function ServicesView({ apiServices }) {
  const services = apiServices?.items ?? [];
  const [activeId, setActiveId] = useState(null);
  const tabRefs = useRef({});
  const active = services.find((service) => service.id === activeId) ?? services[0] ?? null;

  function onTabKeyDown(event, index) {
    let next = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % services.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + services.length) % services.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = services.length - 1;
    if (next === null) return;
    event.preventDefault();
    setActiveId(services[next].id);
    tabRefs.current[services[next].id]?.focus();
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
            Votre besoin web. Le bon service pour avancer.
          </h1>
          <p className="cx-pub-lead" style={{ marginTop: "var(--comexa-space-6)" }}>
            Sites vitrines, boutiques en ligne ou applications sur mesure : un cadre clair pour concevoir, développer
            et faire vivre votre projet web.
          </p>
          <div className="cx-pub-cta-row" style={{ marginTop: "var(--comexa-space-8)" }}>
            <a href="#services" className="cx-btn cx-btn--accent cx-btn--lg">
              Découvrir nos services
            </a>
            <Link href="/realisations" className="cx-pub-link">
              Voir les réalisations <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
        {services.length > 0 ? (
          <ol className="cx-pub-index" aria-label="Nos services">
            {services.map((service, index) => (
              <li key={service.id}>
                <a href="#services" onClick={() => setActiveId(service.id)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span>{service.title}</span>
                  <span aria-hidden="true">→</span>
                </a>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      {/* SERVICES : ONGLETS + PANNEAU */}
      <section id="services" className="cx-pub-section" aria-labelledby="services-title">
        <p className="cx-pub-eyebrow">Nos services</p>
        <h2 id="services-title" className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-5)", marginBottom: "var(--comexa-space-10)", maxWidth: "24ch" }}>
          Un service adapté à chaque besoin.
        </h2>

        {apiServices?.items === null ? (
          <p className="cx-pub-body" role="status">
            Nos services ne peuvent pas être affichés pour le moment. Revenez dans quelques instants.
          </p>
        ) : null}
        {apiServices?.items !== null && services.length === 0 ? (
          <p className="cx-pub-body" role="status">
            Les services seront publiés prochainement.
          </p>
        ) : null}

        {active ? (
          <div className="cx-pub-packs">
            <div role="tablist" aria-label="Choisir un service" aria-orientation="vertical" className="cx-pub-tablist">
              {services.map((service, index) => {
                const selected = service.id === active.id;
                const price = formatStartingPrice(service);
                return (
                  <button
                    key={service.id}
                    ref={(node) => {
                      tabRefs.current[service.id] = node;
                    }}
                    type="button"
                    role="tab"
                    id={`tab-${service.id}`}
                    aria-selected={selected}
                    aria-controls="service-panel"
                    tabIndex={selected ? 0 : -1}
                    className="cx-pub-pack-tab"
                    onClick={() => setActiveId(service.id)}
                    onKeyDown={(event) => onTabKeyDown(event, index)}
                  >
                    <span className="cx-pub-pack-tab__top">
                      <span className="cx-pub-pack-tab__name">{service.title}</span>
                      <span className="cx-pub-pack-tab__num">{String(index + 1).padStart(2, "0")}</span>
                    </span>
                    {price ? <span className="cx-pub-pack-tab__tag">{price}</span> : null}
                  </button>
                );
              })}
            </div>

            <article key={active.id} id="service-panel" role="tabpanel" aria-labelledby={`tab-${active.id}`} className="cx-pub-pack-panel">
              <div className="cx-pub-pack-panel__head">
                <h3 className="cx-pub-pack-panel__title">{active.title}</h3>
                <p className="cx-pub-body">{active.shortDescription}</p>
              </div>

              {active.description ? (
                <div className="cx-pub-body">
                  {active.description.split(/\n{2,}/).map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
              ) : null}

              {formatStartingPrice(active) ? (
                <p className="cx-pub-pack-panel__benefit">
                  <strong style={{ fontWeight: 500 }}>À partir de : </strong>
                  {formatStartingPrice(active)}
                </p>
              ) : null}

              {Array.isArray(active.features) && active.features.length ? (
                <div>
                  <p className="cx-small" style={{ fontWeight: 500, color: "var(--comexa-ink)", marginBottom: "var(--comexa-space-3)" }}>
                    Ce qui est inclus
                  </p>
                  <ul className="cx-pub-features">
                    {active.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="cx-pub-pack-panel__foot">
                <Link href="/realisations" className="cx-pub-link">
                  Voir nos réalisations <span aria-hidden="true">→</span>
                </Link>
                <a
                  href={`mailto:bonjour@comexa.fr?subject=${encodeURIComponent(`Demande de devis - ${active.title}`)}`}
                  className="cx-btn cx-btn--primary"
                >
                  Demander un devis
                </a>
              </div>
            </article>
          </div>
        ) : null}
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

/** « À partir de 45 000,00 DZD » si le prix est saisi avec sa devise, sinon rien. */
function formatStartingPrice(service) {
  if (service.startingPrice == null || !service.startingPriceCurrency) return null;
  return `À partir de ${formatMoney(service.startingPrice, service.startingPriceCurrency)}`;
}
