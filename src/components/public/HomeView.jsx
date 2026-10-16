"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Mail, MapPin, ShieldCheck, Zap } from "lucide-react";
import { apiFetch, formatMoney, messageOf } from "@/lib/api";
import { SITE_CONTACT } from "@/lib/site";
import {
  QuoteCard,
  SectionHead,
  ServiceIcon,
  Steps,
  WorkCard,
  columnsFor,
  pad,
  testimonialFromApi,
} from "@/components/public/PublicBlocks";
import heroVisual from "../../../public/image.png";

/*
 * Page d'accueil — six blocs, chacun avec un rôle unique :
 *   1. Hero (promesse, appels à l'action, compétences)
 *   2. Services (contenu de l'espace équipe)
 *   3. Réalisations (études de cas publiées — masqué s'il n'y en a aucune)
 *   4. Agence + méthode (une seule présentation des étapes)
 *   5. Témoignages + technologies
 *   6. Contact (formulaire réel, seule carte « ink » de la page)
 */

// Repli tant que l'API ne renvoie aucun service : la page reste remplie.
const FALLBACK_SERVICES = [
  {
    title: "Sites vitrines",
    description: "Une présence claire, distinctive et pensée pour convertir vos visiteurs en prises de contact qualifiées.",
    tags: ["Design sur mesure", "CMS simple"],
    icon: "layout",
  },
  {
    title: "E-commerce",
    description: "Des parcours d’achat fluides, une administration fiable et les intégrations utiles à votre activité.",
    tags: ["Catalogue", "Paiement sécurisé"],
    icon: "shopping-cart",
  },
  {
    title: "Applications web",
    description: "Des outils métiers et plateformes performants, développés autour de vos usages réels.",
    tags: ["Interfaces métier", "API & données"],
    icon: "layers",
  },
  {
    title: "Maintenance & optimisation",
    description: "Un suivi continu pour garder votre produit web rapide, sécurisé et agréable à faire évoluer.",
    tags: ["Support", "Performance"],
    icon: "wrench",
  },
];

const SKILLS = ["Stratégie", "UX / UI", "Front-end", "Back-end", "Optimisation"];

const VALUES = ["Écoute active", "Choix transparents", "Code maintenable"];

const STEPS = [
  { title: "Cadrer", description: "Objectifs, utilisateurs, contexte et contraintes : nous alignons le cap avant de produire." },
  { title: "Concevoir", description: "Nous donnons forme aux parcours et à l’interface, avec des validations simples et régulières." },
  { title: "Développer", description: "Le produit prend vie sur une base propre, testée et documentée." },
  { title: "Accompagner", description: "Mise en ligne, prise en main et évolutions : la relation continue après la livraison." },
];

// Repli tant que l'API ne renvoie aucun témoignage.
const FALLBACK_TESTIMONIALS = [
  {
    name: "Claire Renaud",
    role: "Associée, Atelier Nord",
    text: "Comexa a su challenger nos idées sans jamais perdre de vue nos contraintes. Le nouveau site ressemble enfin à notre cabinet.",
  },
  {
    name: "Mehdi Laurent",
    role: "Responsable opérations, Oryon",
    text: "Une équipe disponible, très claire sur les arbitrages techniques, et un outil adopté naturellement par nos collaborateurs.",
  },
  {
    name: "Lucie Morel",
    role: "Fondatrice, Comptoir Local",
    text: "Nous avons gagné en autonomie sur le catalogue et le parcours d’achat est beaucoup plus cohérent avec notre façon de vendre.",
  },
];

const PARTNERS = ["Vercel", "Strapi", "Shopify", "PostgreSQL", "Scalango", "Figma"];

const NEEDS = ["Site vitrine", "E-commerce", "Application web", "Maintenance"];

const EMPTY_CONTACT = { firstName: "", lastName: "", companyName: "", email: "", phone: "", message: "" };

export default function HomeView({ apiServices, apiTestimonials, apiCaseStudies }) {
  // Contenu issu de l'espace équipe (Contenu du site), avec repli tant que l'API ne renvoie rien.
  const serviceCards = apiServices?.items?.length
    ? apiServices.items.map((service) => ({
        key: service.id ?? service.slug ?? service.title,
        slug: service.slug ?? null,
        title: service.title,
        description: service.shortDescription,
        tags: (service.features ?? []).slice(0, 2),
        icon: service.icon,
        // Prix de départ : uniquement s'il a été saisi par l'équipe (jamais de valeur inventée).
        startingPrice:
          service.startingPrice != null && service.startingPriceCurrency
            ? formatMoney(service.startingPrice, service.startingPriceCurrency)
            : null,
      }))
    : FALLBACK_SERVICES.map((service) => ({ ...service, key: service.title, startingPrice: null }));

  const testimonialCards = apiTestimonials?.items?.length
    ? apiTestimonials.items.map(testimonialFromApi)
    : FALLBACK_TESTIMONIALS;

  // Réalisations : uniquement les études de cas publiées (mises en avant d'abord).
  // Aucune réalisation fictive : sans étude publiée, le bloc n'est pas affiché.
  const works = [...(apiCaseStudies?.items ?? [])]
    .sort((a, b) => Number(Boolean(b.isFeatured)) - Number(Boolean(a.isFeatured)))
    .slice(0, 3);

  const [selectedNeed, setSelectedNeed] = useState(NEEDS[0]);

  // Formulaire : même API que /contact (POST /api/public/contact-requests). La demande part
  // réellement vers l'espace équipe et le visiteur reçoit un état explicite.
  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const updateContact = (field) => (event) => setContact((current) => ({ ...current, [field]: event.target.value }));

  async function handleContactSubmit(event) {
    event.preventDefault();
    if (sending) return;

    const firstName = contact.firstName.trim();
    const lastName = contact.lastName.trim();
    const email = contact.email.trim();
    const message = contact.message.trim();

    if (firstName.length < 2 || lastName.length < 2) {
      setFeedback({ tone: "error", text: "Indiquez votre prénom et votre nom (2 caractères minimum)." });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFeedback({ tone: "error", text: "Indiquez une adresse e-mail valide." });
      return;
    }
    if (message.length < 10) {
      setFeedback({ tone: "error", text: "Décrivez votre projet en quelques phrases (10 caractères minimum)." });
      return;
    }
    if (!consent) {
      setFeedback({ tone: "error", text: "Merci d'accepter que Comexa utilise vos informations pour répondre à votre demande." });
      return;
    }

    const params = new URLSearchParams(window.location.search);
    setSending(true);
    setFeedback(null);
    try {
      await apiFetch("/public/contact-requests", {
        method: "POST",
        body: {
          firstName,
          lastName,
          email,
          companyName: contact.companyName.trim() || undefined,
          phone: contact.phone.trim() || undefined,
          subject: selectedNeed,
          message,
          source: window.location.pathname,
          utmSource: params.get("utm_source") || undefined,
          utmMedium: params.get("utm_medium") || undefined,
          utmCampaign: params.get("utm_campaign") || undefined,
        },
      });
      setContact(EMPTY_CONTACT);
      setConsent(false);
      setFeedback({ tone: "success", text: "Merci ! Votre demande est bien enregistrée. Nous revenons vers vous rapidement." });
    } catch (error) {
      setFeedback({ tone: "error", text: messageOf(error) });
    } finally {
      setSending(false);
    }
  }

  return (
    <main id="contenu" tabIndex={-1} className="cx-home">
      {/* 1. HERO */}
      <section className="cx-home-hero">
        <div className="cx-pub-container">
          <div className="cx-home-hero__grid">
            <div className="cx-home-hero__copy cx-pub-enter">
              <p className="cx-pub-eyebrow">Naviguer le digital ensemble</p>
              <h1 className="cx-home-hero__title">
                Le web qui avance <em>avec votre entreprise.</em>
              </h1>
              <p className="cx-pub-lead">
                Comexa conçoit et développe des sites et applications web clairs, performants et faciles à faire
                évoluer. De l’idée à la mise en ligne, vous gardez le cap.
              </p>
              <div className="cx-pub-cta-row">
                <a href="#contact" className="cx-btn cx-btn--accent cx-btn--lg">
                  Demander un devis
                </a>
                <Link href={works.length ? "#realisations" : "/realisations"} className="cx-pub-link">
                  Voir nos réalisations <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
              <ul className="cx-pub-facts">
                <li>
                  <Check aria-hidden="true" />
                  Un interlocuteur dédié
                </li>
                <li>
                  <Check aria-hidden="true" />
                  Conception · Développement · Suivi
                </li>
              </ul>
            </div>

            <div className="cx-home-hero__visual cx-pub-enter">
              <Image
                src={heroVisual}
                alt="Aperçu d’une interface web conçue par Comexa"
                loading="eager"
                sizes="(min-width: 900px) 44vw, 100vw"
                className="cx-home-hero__image"
              />
              <span className="cx-home-chip cx-home-chip--top" aria-hidden="true">
                <Zap />
                Rapide et sécurisé
              </span>
              <span className="cx-home-chip cx-home-chip--bottom" aria-hidden="true">
                <ShieldCheck />
                Code testé et documenté
              </span>
            </div>
          </div>

          <div className="cx-home-skills">
            <p>Une expertise 100 % développement web</p>
            <ul aria-label="Compétences">
              {SKILLS.map((skill) => (
                <li key={skill}>{skill}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 2. SERVICES */}
      <section id="services" className="cx-pub-section cx-pub-section--alt" aria-labelledby="home-services-title">
        <div className="cx-pub-container">
          <SectionHead
            eyebrow="Nos services"
            titleId="home-services-title"
            title="Tout ce qu’il faut pour construire et faire vivre votre projet web."
          >
            <p>Un périmètre volontairement clair : nous concevons, développons et améliorons des produits web.</p>
            <Link href="/services" className="cx-pub-link">
              Tous nos services <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </SectionHead>

          <ul className="cx-home-services" style={{ "--cx-cols": columnsFor(serviceCards.length) }}>
            {serviceCards.map((service, index) => (
              <li key={service.key}>
                <article className="cx-home-service">
                  <div className="cx-home-service__top">
                    <span className="cx-pub-icon">
                      <ServiceIcon name={service.icon} fallback={pad(index + 1)} />
                    </span>
                    <ArrowUpRight className="cx-home-service__arrow" size={20} aria-hidden="true" />
                  </div>
                  <h3>
                    <Link href={service.slug ? `/services#service-${service.slug}` : "/services"} className="cx-home-service__link">
                      {service.title}
                    </Link>
                  </h3>
                  {service.description ? <p className="cx-home-service__desc">{service.description}</p> : null}
                  {service.startingPrice ? (
                    <p className="cx-home-service__price">À partir de {service.startingPrice}</p>
                  ) : null}
                  {service.tags.length ? (
                    <ul className="cx-home-service__tags" aria-label="Points clés">
                      {service.tags.map((tag) => (
                        <li key={tag}>{tag}</li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 3. RÉALISATIONS — études de cas publiées uniquement */}
      {works.length ? (
        <section id="realisations" className="cx-pub-section" aria-labelledby="home-works-title">
          <div className="cx-pub-container">
            <SectionHead
              eyebrow="Projets récents"
              titleId="home-works-title"
              title="Des réalisations pensées pour les usages, pas pour la galerie."
            >
              <p>
                Chaque projet associe exigence visuelle, solidité technique et autonomie pour les équipes qui le font
                vivre.
              </p>
              <Link href="/realisations" className="cx-pub-link">
                Toutes nos réalisations <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </SectionHead>

            <ul className="cx-pub-works" style={{ "--cx-cols": columnsFor(works.length) }}>
              {works.map((study, index) => (
                <li key={study.id}>
                  <WorkCard
                    study={study}
                    number={pad(index + 1)}
                    tone={(index % 3) + 1}
                    href={`/realisations#cas-${study.slug}`}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* 4. AGENCE + MÉTHODE */}
      <section
        id="agence"
        className={`cx-pub-section${works.length ? " cx-pub-section--alt" : ""}`}
        aria-labelledby="home-agency-title"
      >
        <div className="cx-pub-container cx-home-agency">
          <div className="cx-home-agency__intro">
            <p className="cx-pub-eyebrow">Qui sommes-nous ?</p>
            <h2 id="home-agency-title" className="cx-pub-h2">
              Un partenaire technique qui parle votre langage.
            </h2>
            <p className="cx-home-agency__text">
              Comexa est une agence entièrement dédiée au développement web. Nous transformons un besoin métier en une
              expérience numérique utile, compréhensible et robuste — sans jargon inutile, ni solution
              surdimensionnée.
            </p>
            <ul className="cx-home-values">
              {VALUES.map((value) => (
                <li key={value}>
                  <Check aria-hidden="true" />
                  {value}
                </li>
              ))}
            </ul>
          </div>

          <div className="cx-pub-panel">
            <p className="cx-pub-panel__kicker">Notre méthode</p>
            <h3 className="cx-pub-panel__title">Un projet lisible, du premier atelier à la mise en ligne.</h3>
            <p className="cx-pub-panel__lead">
              Des étapes courtes, des décisions partagées et un suivi régulier : vous savez toujours où en est le
              projet.
            </p>
            <Steps items={STEPS} level="h4" />
          </div>
        </div>
      </section>

      {/* 5. TÉMOIGNAGES + TECHNOLOGIES */}
      <section
        className={`cx-pub-section${works.length ? "" : " cx-pub-section--alt"}`}
        aria-labelledby="home-quotes-title"
      >
        <div className="cx-pub-container">
          <SectionHead
            eyebrow="Ils en parlent"
            titleId="home-quotes-title"
            title="Des collaborations qui restent simples et humaines."
          />

          <ul className="cx-pub-quotes" style={{ "--cx-cols": Math.min(testimonialCards.length, 3) || 1 }}>
            {testimonialCards.map((testimonial) => (
              <li key={`${testimonial.name}-${testimonial.text.slice(0, 16)}`}>
                <QuoteCard {...testimonial} />
              </li>
            ))}
          </ul>

          <div className="cx-home-tech">
            <p>Partenaires et technologies de confiance</p>
            <ul>
              {PARTNERS.map((partner) => (
                <li key={partner}>{partner}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 6. CONTACT — seule carte « ink » de la page */}
      <section id="contact" className="cx-pub-section cx-pub-section--cta" aria-labelledby="home-contact-title">
        <div className="cx-pub-container">
          <div className="cx-home-contact">
            <div className="cx-home-contact__intro">
              <p className="cx-pub-eyebrow">Un premier échange</p>
              <h2 id="home-contact-title" className="cx-pub-h2">
                Un projet web à lancer ou à faire évoluer ?
              </h2>
              <p className="cx-home-contact__lead">
                Parlez-nous de votre contexte, de vos priorités et de votre calendrier. Nous vous répondons avec une
                première lecture claire de votre besoin.
              </p>
              <ul className="cx-home-contact__points">
                <li>
                  <Mail aria-hidden="true" />
                  <a href={`mailto:${SITE_CONTACT.email}`}>{SITE_CONTACT.email}</a>
                </li>
                <li>
                  <MapPin aria-hidden="true" />
                  <span>{SITE_CONTACT.location}</span>
                </li>
              </ul>
            </div>

            <form className="cx-home-form" onSubmit={handleContactSubmit} aria-describedby="contact-status">
              <h3 className="cx-home-form__title">Parlons de votre projet</h3>
              {feedback ? (
                <p
                  id="contact-status"
                  className={`cx-alert cx-alert--${feedback.tone === "success" ? "success" : "error"}`}
                  role="status"
                  style={{ margin: 0 }}
                >
                  {feedback.text}
                </p>
              ) : (
                <p id="contact-status" className="cx-home-form__hint">
                  Votre demande arrive directement dans l’espace équipe.
                </p>
              )}

              <div className="cx-home-form__row">
                <div>
                  <label htmlFor="contact-firstname" className="cx-label">Prénom</label>
                  <input
                    id="contact-firstname"
                    name="firstName"
                    type="text"
                    autoComplete="given-name"
                    placeholder="Votre prénom"
                    className="cx-input"
                    value={contact.firstName}
                    onChange={updateContact("firstName")}
                  />
                </div>
                <div>
                  <label htmlFor="contact-lastname" className="cx-label">Nom</label>
                  <input
                    id="contact-lastname"
                    name="lastName"
                    type="text"
                    autoComplete="family-name"
                    placeholder="Votre nom"
                    className="cx-input"
                    value={contact.lastName}
                    onChange={updateContact("lastName")}
                  />
                </div>
              </div>

              <div className="cx-home-form__row">
                <div>
                  <label htmlFor="contact-email" className="cx-label">E-mail professionnel</label>
                  <input
                    id="contact-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="vous@entreprise.com"
                    className="cx-input"
                    value={contact.email}
                    onChange={updateContact("email")}
                  />
                </div>
                <div>
                  <label htmlFor="contact-phone" className="cx-label">
                    Téléphone <span className="cx-home-form__optional">(facultatif)</span>
                  </label>
                  <input
                    id="contact-phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="0555 55 55 55"
                    className="cx-input"
                    value={contact.phone}
                    onChange={updateContact("phone")}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="contact-company" className="cx-label">
                  Entreprise <span className="cx-home-form__optional">(facultatif)</span>
                </label>
                <input
                  id="contact-company"
                  name="company"
                  type="text"
                  autoComplete="organization"
                  placeholder="Votre organisation"
                  className="cx-input"
                  value={contact.companyName}
                  onChange={updateContact("companyName")}
                />
              </div>

              <fieldset className="cx-home-form__needs">
                <legend className="cx-label">Votre besoin</legend>
                <div className="cx-home-needs">
                  {NEEDS.map((item) => (
                    <button
                      type="button"
                      key={item}
                      aria-pressed={selectedNeed === item}
                      onClick={() => setSelectedNeed(item)}
                      className="cx-home-need"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor="contact-message" className="cx-label">Votre projet</label>
                <textarea
                  id="contact-message"
                  name="message"
                  rows={4}
                  placeholder="Contexte, objectifs, calendrier…"
                  className="cx-textarea"
                  value={contact.message}
                  onChange={updateContact("message")}
                />
              </div>

              <label htmlFor="contact-consent" className="cx-home-consent">
                <input
                  id="contact-consent"
                  name="consent"
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>J’accepte que Comexa utilise mes informations pour répondre à ma demande.</span>
              </label>

              <div className="cx-home-form__foot">
                <p>Vos informations restent confidentielles et servent uniquement à vous répondre.</p>
                <button type="submit" className="cx-btn cx-btn--accent cx-btn--lg" disabled={sending} aria-disabled={sending}>
                  {sending ? "Envoi en cours…" : "Envoyer ma demande"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
