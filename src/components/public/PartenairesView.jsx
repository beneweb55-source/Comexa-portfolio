"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Handshake, Layers, ShieldCheck, Sparkles } from "lucide-react";
import { initialsOf } from "@/lib/public-api";
import {
  Checks,
  CtaBand,
  Faq,
  PageHero,
  QuoteCard,
  SectionHead,
  testimonialFromApi,
} from "@/components/public/PublicBlocks";

/**
 * Page « Partenaires ». Les partenaires et les témoignages viennent de l'API
 * (espace équipe > Contenu), lus côté serveur dans `app/partenaires/page.jsx`.
 * Les engagements, formats d'alliance et questions fréquentes sont des textes
 * propres à cette page (les questions de l'API concernent les projets clients et
 * sont affichées sur la page Contact).
 */

const PARTNER_PILLARS = [
  {
    title: "Complémentarité métier",
    text: "Design, développement, cloud, paiement ou conseil : chaque partenaire renforce une brique précise des projets que nous livrons.",
    icon: Layers,
  },
  {
    title: "Exigence de qualité",
    text: "Méthodes documentées, délais tenus, sécurité des données et interlocuteur identifié tout au long de la mission.",
    icon: ShieldCheck,
  },
  {
    title: "Engagement dans la durée",
    text: "Nous privilégions des alliances durables plutôt que de la sous-traitance ponctuelle, pour assurer un suivi stable.",
    icon: Handshake,
  },
];

const COLLABORATION_MODELS = [
  {
    step: "01",
    title: "Partenaire technologique",
    description:
      "Intégration de solutions d’hébergement, de paiement, de CRM ou d’outils métiers au cœur des plateformes que nous concevons.",
    points: ["Intégrations API testées et documentées", "Support technique conjoint", "Architecture évolutive et sécurisée"],
  },
  {
    step: "02",
    title: "Partenaire d’expertise",
    description:
      "Intervention coordonnée sur des volets spécialisés : production audiovisuelle, juridique, cybersécurité ou stratégie média.",
    points: ["Un seul chef de projet côté Comexa", "Livrables harmonisés à votre charte", "Planning et jalons partagés"],
  },
  {
    step: "03",
    title: "Apporteur & réseau",
    description:
      "Accompagnement croisé des entreprises qui cherchent un partenaire digital fiable en Algérie et à l’international.",
    points: ["Qualification rapide des besoins", "Proposition claire sous 48 h", "Suivi transparent dans l’espace dédié"],
  },
];

const PARTNER_FAQS = [
  {
    id: "faq-1",
    question: "Comment devenir partenaire de l’agence Comexa ?",
    answer:
      "Présentez-nous votre structure et vos domaines d’intervention via le formulaire de contact (objet « Partenariat »). Nous organisons un premier échange pour identifier les synergies concrètes.",
  },
  {
    id: "faq-2",
    question: "Qui reste l’interlocuteur du client lors d’un projet commun ?",
    answer:
      "Comexa assure la direction de projet, le contrôle qualité et le suivi dans l’espace client afin de garantir un interlocuteur unique et une livraison fluide.",
  },
  {
    id: "faq-3",
    question: "Intervenez-vous en marque blanche pour d’autres agences ?",
    answer:
      "Oui, notre pôle design et développement accompagne régulièrement des agences et cabinets de conseil sur des projets web, applicatifs ou d’identité visuelle.",
  },
];

const PARTNERSHIP_HREF = "/contact?sujet=Partenariat";

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function PartnerCard({ partner }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const hasLogo = Boolean(partner.logoUrl) && !logoFailed;
  const domain = partner.websiteUrl ? domainOf(partner.websiteUrl) : null;

  return (
    <article className="cx-pub-card cx-pub-card--partner">
      <span className="cx-pub-partner__logo">
        {hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={partner.logoUrl}
            alt={`Logo ${partner.name}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <span aria-hidden="true">{initialsOf(partner.name)}</span>
        )}
      </span>
      <h3>{partner.name}</h3>
      {partner.websiteUrl && domain ? (
        <a href={partner.websiteUrl} target="_blank" rel="noopener noreferrer" className="cx-pub-partner__link">
          {domain}
          <ArrowUpRight size={15} aria-hidden="true" />
          <span className="sr-only"> (nouvel onglet)</span>
        </a>
      ) : (
        <p>Partenaire référencé Comexa</p>
      )}
    </article>
  );
}

export default function PartenairesView({ apiPartners, apiTestimonials }) {
  const partners = apiPartners?.items ?? [];
  const testimonials = (apiTestimonials?.items ?? []).map(testimonialFromApi).filter((item) => item.name && item.text);

  return (
    <main id="contenu" tabIndex={-1}>
      <PageHero
        current="Partenaires"
        eyebrow="Écosystème & alliances"
        title="Des partenaires choisis pour la qualité de leurs livrables."
        lead="Pour garantir des projets fiables de bout en bout, Comexa s’entoure d’acteurs technologiques et métiers partageant la même rigueur d’exécution."
        actions={
          <>
            <Link href={PARTNERSHIP_HREF} className="cx-btn cx-btn--accent cx-btn--lg">
              Proposer un partenariat
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link href="/realisations" className="cx-pub-link">
              Voir nos réalisations <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </>
        }
        aside={
          <div className="cx-pub-panel cx-pub-hero-panel">
            <p className="cx-pub-panel__kicker">Réseau Comexa</p>
            <h2 className="cx-pub-hero-panel__title">Une direction de projet unique, des compétences démultipliées.</h2>
            <p>
              Vous conservez un interlocuteur unique chez Comexa, tout en bénéficiant d’intégrations certifiées et
              d’expertises pointues lorsque votre projet l’exige.
            </p>
            <Checks
              items={[
                "Sélection sur critères techniques et méthodologiques",
                "Suivi centralisé dans votre espace client Comexa",
                "Confidentialité et respect des engagements contractuels",
              ]}
            />
          </div>
        }
      />

      {/* PARTENAIRES + TÉMOIGNAGES */}
      <section className="cx-pub-section cx-pub-section--alt" aria-labelledby="partners-title">
        <div className="cx-pub-container">
          {partners.length > 0 ? (
            <>
              <SectionHead eyebrow="Ils collaborent avec nous" titleId="partners-title" title="Nos partenaires référencés">
                <p>Chaque structure référencée intervient en synergie avec nos équipes, sous une direction de projet unique.</p>
              </SectionHead>
              <ul className="cx-pub-grid" style={{ "--cx-cols": Math.min(partners.length, 4) }}>
                {partners.map((partner) => (
                  <li key={partner.id ?? partner.name}>
                    <PartnerCard partner={partner} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <SectionHead eyebrow="Réseau de partenaires" titleId="partners-title" title="Un réseau en développement">
                <p>Nous développons activement notre réseau d’experts techniques, d’éditeurs et d’agences partenaires.</p>
              </SectionHead>
              <div className="cx-pub-card cx-pub-join">
                <span className="cx-pub-icon" aria-hidden="true">
                  <Sparkles size={22} strokeWidth={1.75} />
                </span>
                <div>
                  <h3>Vous souhaitez rejoindre notre réseau de partenaires ?</h3>
                  <p>Présentez-nous votre structure : nous revenons vers vous pour un premier échange.</p>
                </div>
                <Link href={PARTNERSHIP_HREF} className="cx-btn cx-btn--primary">
                  Prendre contact
                </Link>
              </div>
            </>
          )}

          {testimonials.length > 0 ? (
            <>
              <h3 className="cx-pub-subhead">Ce qu’en disent nos clients</h3>
              <ul className="cx-pub-quotes" style={{ "--cx-cols": Math.min(testimonials.length, 3) }}>
                {testimonials.map((testimonial) => (
                  <li key={`${testimonial.name}-${testimonial.text.slice(0, 16)}`}>
                    <QuoteCard {...testimonial} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </section>

      {/* ENGAGEMENTS */}
      <section className="cx-pub-section" aria-labelledby="pillars-title">
        <div className="cx-pub-container">
          <SectionHead eyebrow="Nos engagements" titleId="pillars-title" title="Sur quelles bases travaillons-nous ensemble ?">
            <p>Un partenariat utile repose sur des processus clairs et une responsabilité partagée.</p>
          </SectionHead>
          <ul className="cx-pub-grid">
            {PARTNER_PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <li key={pillar.title}>
                  <article className="cx-pub-card">
                    <div className="cx-pub-card__top">
                      <span className="cx-pub-icon" aria-hidden="true">
                        <Icon size={22} strokeWidth={1.75} />
                      </span>
                    </div>
                    <h3>{pillar.title}</h3>
                    <p>{pillar.text}</p>
                  </article>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* FORMATS D'ALLIANCE */}
      <section className="cx-pub-section cx-pub-section--alt" aria-labelledby="models-title">
        <div className="cx-pub-container">
          <SectionHead eyebrow="Formats d’alliance" titleId="models-title" title="Trois façons de collaborer avec Comexa">
            <p>Choisissez le format qui correspond à votre activité : nous l’ajustons ensemble lors du premier échange.</p>
          </SectionHead>
          <ul className="cx-pub-grid">
            {COLLABORATION_MODELS.map((model) => (
              <li key={model.step}>
                <article className="cx-pub-card">
                  <div className="cx-pub-card__top">
                    <span className="cx-pub-badge-num" aria-hidden="true">
                      {model.step}
                    </span>
                  </div>
                  <h3>{model.title}</h3>
                  <p>{model.description}</p>
                  <div className="cx-pub-card__foot">
                    <Checks items={model.points} />
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section className="cx-pub-section" aria-labelledby="faq-title">
        <div className="cx-pub-container cx-pub-split">
          <div className="cx-pub-split__intro">
            <SectionHead eyebrow="Questions fréquentes" titleId="faq-title" title="Tout savoir sur nos partenariats" />
            <p>Une question spécifique sur un appel d’offres conjoint ou une intervention en sous-traitance ? Écrivez-nous directement.</p>
            <Link href={PARTNERSHIP_HREF} className="cx-pub-link">
              Poser une question à l’équipe <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <Faq items={PARTNER_FAQS} name="faq-partenaires" />
        </div>
      </section>

      <CtaBand
        eyebrow="Travaillons ensemble"
        title="Construisons votre prochain projet ensemble."
        text="Que vous soyez une entreprise porteuse d’un projet ou un partenaire potentiel, notre équipe vous répond rapidement avec des prochaines étapes claires."
        primary={{ href: PARTNERSHIP_HREF, label: "Proposer un partenariat" }}
        secondary={{ href: "/contact", label: "Vous avez un projet ? Parlons-en" }}
      />
    </main>
  );
}
