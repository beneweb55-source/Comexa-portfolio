"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { formatMoney } from "@/lib/api";
import { SITE_CONTACT } from "@/lib/site";
import { Checks, CtaBand, PageHero, SectionHead, ServiceIcon, pad } from "@/components/public/PublicBlocks";

/**
 * Page « Nos services ». Les services viennent de l'API (espace équipe > Contenu),
 * lus côté serveur dans `app/services/page.jsx`. Aucun service n'est écrit en dur ici.
 *
 * Un service peut être ouvert directement par son ancre : `/services#service-<slug>`
 * (liens des cartes de l'accueil). Le prix de départ n'est affiché que s'il a été
 * saisi, avec sa devise. Les blocs éditoriaux (bénéfices, accompagnement, appel à
 * l'action) restent des textes de page.
 */

const BENEFITS = [
  {
    title: "Un cap lisible",
    text: "Des objectifs cadrés, des choix expliqués et des validations partagées. Vous savez ce qui est construit et pourquoi.",
  },
  {
    title: "Des parcours qui fonctionnent",
    text: "Une navigation et des parcours pensés pour vos visiteurs, vos clients ou vos équipes — sans complexité superflue.",
  },
  {
    title: "Une autonomie réelle",
    text: "Une administration adaptée et une prise en main accompagnée pour faire vivre vos contenus et vos données.",
  },
  {
    title: "Une base qui évolue",
    text: "Une base technique robuste, prête à accueillir de nouveaux contenus, des connexions et des fonctionnalités utiles.",
  },
];

const FOLLOW_UP = [
  "Maintenance et mises à jour de sécurité",
  "Optimisation des performances",
  "Évolutions fonctionnelles selon vos besoins",
];

function subscribeToHash(onChange) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readHash() {
  return window.location.hash;
}

function readServerHash() {
  return "";
}

function anchorOf(service) {
  return service.slug ? `service-${service.slug}` : `service-${service.id}`;
}

export default function ServicesView({ apiServices }) {
  const services = apiServices?.items ?? [];
  const tabRefs = useRef({});
  // Sélection : un clic l'emporte tant que l'ancre de l'adresse ne change pas ;
  // un lien `#service-…` (accueil, pied de page) reprend la main.
  const hash = useSyncExternalStore(subscribeToHash, readHash, readServerHash);
  const [picked, setPicked] = useState({ id: null, hash: null });
  const fromHash = services.find((service) => `#${anchorOf(service)}` === hash);
  const fromClick = picked.hash === hash ? services.find((service) => service.id === picked.id) : null;
  const active = fromClick ?? fromHash ?? services[0] ?? null;

  function select(service) {
    setPicked({ id: service.id, hash });
  }

  function onTabKeyDown(event, index) {
    let next = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % services.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + services.length) % services.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = services.length - 1;
    if (next === null) return;
    event.preventDefault();
    select(services[next]);
    tabRefs.current[services[next].id]?.focus();
  }

  return (
    <main id="contenu" tabIndex={-1}>
      <PageHero
        current="Nos services"
        eyebrow="Nos services"
        title="Votre besoin web. Le bon service pour avancer."
        lead="Sites vitrines, boutiques en ligne ou applications sur mesure : un cadre clair pour concevoir, développer et faire vivre votre projet web."
        actions={
          <>
            <Link href="/contact" className="cx-btn cx-btn--accent cx-btn--lg">
              Demander un devis
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link href="/realisations" className="cx-pub-link">
              Voir les réalisations <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </>
        }
        facts={["Un interlocuteur dédié", SITE_CONTACT.responseTime, "Conception · Développement · Suivi"]}
      />

      {/* SERVICES : ONGLETS + PANNEAU */}
      <section id="services" className="cx-pub-section cx-pub-section--alt" aria-labelledby="services-title">
        <div className="cx-pub-container">
          <SectionHead eyebrow="En détail" titleId="services-title" title="Un service adapté à chaque besoin.">
            <p>Choisissez un service pour découvrir son périmètre, ce qui est inclus et demander un devis ciblé.</p>
          </SectionHead>

          {apiServices?.items === null ? (
            <p className="cx-pub-status" role="status">
              Nos services ne peuvent pas être affichés pour le moment. Revenez dans quelques instants.
            </p>
          ) : null}
          {apiServices?.items !== null && services.length === 0 ? (
            <p className="cx-pub-status" role="status">
              Les services seront publiés prochainement.
            </p>
          ) : null}

          {active ? (
            <div className="cx-pub-packs">
              <div role="tablist" aria-label="Choisir un service" className="cx-pub-tablist">
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
                      id={anchorOf(service)}
                      aria-selected={selected}
                      aria-controls="service-panel"
                      tabIndex={selected ? 0 : -1}
                      className="cx-pub-pack-tab"
                      onClick={() => select(service)}
                      onKeyDown={(event) => onTabKeyDown(event, index)}
                    >
                      <span className="cx-pub-icon" aria-hidden="true">
                        <ServiceIcon name={service.icon} fallback={pad(index + 1)} />
                      </span>
                      <span>
                        <span className="cx-pub-pack-tab__name">{service.title}</span>
                        {price ? <span className="cx-pub-pack-tab__tag">{price}</span> : null}
                      </span>
                      <ChevronRight className="cx-pub-pack-tab__chev" size={18} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>

              <article
                key={active.id}
                id="service-panel"
                role="tabpanel"
                aria-labelledby={anchorOf(active)}
                className="cx-pub-pack-panel"
              >
                <div>
                  <div className="cx-pub-pack-panel__head">
                    <span className="cx-pub-icon" aria-hidden="true">
                      <ServiceIcon name={active.icon} fallback={pad(services.indexOf(active) + 1)} />
                    </span>
                    <h3 className="cx-pub-pack-panel__title">{active.title}</h3>
                  </div>
                  {active.shortDescription ? (
                    <p className="cx-pub-pack-panel__lead">{active.shortDescription}</p>
                  ) : null}
                </div>

                {active.description ? (
                  <div className="cx-pub-pack-panel__text">
                    {active.description.split(/\n{2,}/).map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                  </div>
                ) : null}

                {formatStartingPrice(active) ? (
                  <p className="cx-pub-pack-panel__price">{formatStartingPrice(active)}</p>
                ) : null}

                {Array.isArray(active.features) && active.features.length ? (
                  <div>
                    <p className="cx-pub-label">Ce qui est inclus</p>
                    <Checks items={active.features} className="cx-pub-checks--2col" />
                  </div>
                ) : null}

                <div className="cx-pub-pack-panel__foot">
                  <Link
                    href={`/contact?sujet=${encodeURIComponent(active.title)}`}
                    className="cx-btn cx-btn--accent cx-btn--lg"
                  >
                    Demander un devis pour ce service
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                  <Link href="/realisations" className="cx-pub-link">
                    Voir des projets réalisés <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </div>
              </article>
            </div>
          ) : null}
        </div>
      </section>

      {/* BÉNÉFICES + ACCOMPAGNEMENT */}
      <section className="cx-pub-section" aria-labelledby="benefits-title">
        <div className="cx-pub-container">
          <div className="cx-pub-benefits">
            <div className="cx-pub-benefits__intro">
              <SectionHead eyebrow="Les bénéfices" titleId="benefits-title" title="Une base solide pour la suite." />
              <p>
                Exigence visuelle, solidité technique et autonomie : les mêmes principes guident chaque projet, du
                premier atelier à la mise en ligne.
              </p>
            </div>
            <ul className="cx-pub-benefit-list">
              {BENEFITS.map((benefit, index) => (
                <li key={benefit.title}>
                  <span>{pad(index + 1)}</span>
                  <div>
                    <strong>{benefit.title}</strong>
                    {benefit.text}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="cx-pub-option">
            <div>
              <p className="cx-pub-eyebrow">Après la mise en ligne</p>
              <h2 className="cx-pub-option__title">
                Un suivi continu pour garder votre produit web rapide, sûr et évolutif.
              </h2>
              <p className="cx-pub-option__note">Accompagnement optionnel · modalités définies au devis</p>
            </div>
            <div>
              <Checks items={FOLLOW_UP} />
              <Link href={`/contact?sujet=${encodeURIComponent("Maintenance et évolution")}`} className="cx-pub-link">
                Parler de votre suivi <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <CtaBand
        eyebrow="Pour commencer, simplement"
        title="Un projet en tête ? Obtenez un devis clair."
        text="Décrivez votre besoin en quelques lignes : nous revenons vers vous avec une première lecture de votre projet, un périmètre et les prochaines étapes."
        primary={{ href: "/contact", label: "Demander un devis" }}
        secondary={{ href: "/realisations", label: "Voir nos réalisations" }}
      />
    </main>
  );
}

/** « À partir de 45 000,00 DZD » si le prix est saisi avec sa devise, sinon rien. */
function formatStartingPrice(service) {
  if (service.startingPrice == null || !service.startingPriceCurrency) return null;
  return `À partir de ${formatMoney(service.startingPrice, service.startingPriceCurrency)}`;
}
