"use client";

import { useState } from "react";
import { initialsOf } from "@/lib/public-api";
import { apiFetch, formatMoney, messageOf } from "@/lib/api";
import Image from "next/image";
import Link from "next/link";
import quisommesnous from "../../../public/image.png";
import quisommesnous1 from "../../../public/image-copy-2.png";

const services = [
  {
    number: "01",
    title: "Sites vitrines",
    description:
      "Une présence claire, distinctive et pensée pour convertir vos visiteurs en prises de contact qualifiées.",
    tags: ["Design sur mesure", "CMS simple"],
  },
  {
    number: "02",
    title: "E-commerce",
    description:
      "Des parcours d’achat fluides, une administration fiable et les intégrations utiles à votre activité.",
    tags: ["Catalogue", "Paiement sécurisé"],
  },
  {
    number: "03",
    title: "Applications web",
    description:
      "Des outils métiers et plateformes performants, développés autour de vos usages réels.",
    tags: ["Interfaces métier", "API & données"],
  },
  {
    number: "04",
    title: "Maintenance & optimisation",
    description:
      "Un suivi continu pour garder votre produit web rapide, sécurisé et agréable à faire évoluer.",
    tags: ["Support", "Performance"],
  },
];

const steps = [
  {
    number: "01",
    title: "Cadrer",
    description:
      "Objectifs, utilisateurs, contexte et contraintes : nous alignons le cap avant de produire.",
  },
  {
    number: "02",
    title: "Concevoir",
    description:
      "Nous donnons forme aux parcours et à l’interface, avec des validations simples et régulières.",
    active: true,
  },
  {
    number: "03",
    title: "Développer",
    description: "Le produit prend vie sur une base propre, testée et documentée.",
  },
  {
    number: "04",
    title: "Accompagner",
    description:
      "Mise en ligne, prise en main et évolutions : la relation continue après la livraison.",
  },
];

const testimonials = [
  {
    initials: "CR",
    name: "Claire Renaud",
    role: "Associée, Atelier Nord",
    text: "Comexa a su challenger nos idées sans jamais perdre de vue nos contraintes. Le nouveau site ressemble enfin à notre cabinet.",
  },
  {
    initials: "ML",
    name: "Mehdi Laurent",
    role: "Responsable opérations, Oryon",
    text: "Une équipe disponible, très claire sur les arbitrages techniques, et un outil adopté naturellement par nos collaborateurs.",
  },
  {
    initials: "LM",
    name: "Lucie Morel",
    role: "Fondatrice, Comptoir Local",
    text: "Nous avons gagné en autonomie sur le catalogue et le parcours d’achat est beaucoup plus cohérent avec notre façon de vendre.",
  },
];

const partners = ["Vercel", "Strapi", "Shopify", "PostgreSQL", "Scalango", "Figma"];

const projects = [
  {
    category: "Architecture",
    title: "Atelier Noroît — rendre l’architecture lisible et sensible.",
    description:
      "Refonte du site éditorial d’un studio d’architecture : projets mieux structurés, navigation sobre et publication facilitée pour l’équipe.",
    image: quisommesnous1,
    footer: "Direction UX · Développement front-end · CMS",
  },
  {
    category: "E-commerce",
    title: "Comptoir Local",
    description:
      "Une boutique en ligne chaleureuse, avec un catalogue clarifié et un parcours de commande sans friction.",
    image: quisommesnous,
    footer: "UX/UI · E-commerce · Connexions métier",
  },
  {
    category: "Application web",
    title: "Oryon Pilot",
    description:
      "Un outil métier qui rassemble le suivi des dossiers, les échanges et les échéances dans une seule interface.",
    image: quisommesnous1,
    footer: "Product design · Application web · API",
  },
];

const needs = ["Site vitrine", "E-commerce", "Application web", "Maintenance"];

export default function HomeView({ apiServices, apiTestimonials }) {
  // Contenu issu de l'espace équipe (Contenu du site). Repli sur les listes
  // ci-dessus tant que l'API ne renvoie rien : la page reste toujours remplie.
  const serviceCards = apiServices.items?.length
    ? apiServices.items.map((service, index) => ({
        number: String(index + 1).padStart(2, "0"),
        title: service.title,
        description: service.shortDescription,
        tags: (service.features ?? []).slice(0, 2),
        // Prix de départ : uniquement s'il a été saisi par l'équipe (jamais de valeur inventée).
        startingPrice: service.startingPrice != null && service.startingPriceCurrency ? formatMoney(service.startingPrice, service.startingPriceCurrency) : null,
      }))
    : services;
  const testimonialCards = apiTestimonials.items?.length
    ? apiTestimonials.items.map((item) => ({
        initials: initialsOf(item.authorName),
        name: item.authorName,
        role: [item.authorRole, item.authorCompany].filter(Boolean).join(", "),
        text: item.quote,
      }))
    : testimonials;
  const [selectedNeed, setSelectedNeed] = useState("Site vitrine");
  const [featured, ...smallProjects] = projects;

  // Formulaire de contact de l'accueil : raccordé à la même API que /contact
  // (POST /api/public/contact-requests). Une seule vérité : la demande part
  // réellement vers l'espace équipe, et le visiteur reçoit un état explicite.
  const EMPTY_CONTACT = { firstName: "", lastName: "", companyName: "", email: "", phone: "", message: "" };
  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const updateContact = (field) => (event) =>
    setContact((current) => ({ ...current, [field]: event.target.value }));

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
    <main>
      {/* HERO */}
      <section className="cx-pub-container">
        <div className="cx-pub-hero">
          <div className="cx-pub-hero__copy cx-pub-enter">
            <p className="cx-pub-eyebrow">Naviguer le digital ensemble</p>
            <h1 className="cx-pub-display">Le web qui avance avec votre entreprise.</h1>
            <p className="cx-pub-lead">
              Comexa conçoit et développe des sites et applications web clairs, performants et faciles à
              faire évoluer. De l’idée à la mise en ligne, vous gardez le cap.
            </p>
            <div className="cx-pub-cta-row">
              <a href="#contact" className="cx-btn cx-btn--accent cx-btn--lg">
                Demander un devis
              </a>
              <a href="#realisations" className="cx-pub-link">
                Voir nos réalisations <span aria-hidden="true">→</span>
              </a>
            </div>
            <div className="cx-pub-hero__facts">
              <span>Un interlocuteur dédié</span>
              <span>Conception · Développement · Suivi</span>
            </div>
          </div>
          <div className="cx-pub-hero__visual cx-pub-enter">
            <Image
              src={quisommesnous}
              alt="Aperçu d’une interface web conçue par Comexa"
              width={1014}
              height={754}
              priority
              sizes="(min-width: 900px) 45vw, 100vw"
            />
          </div>
        </div>
      </section>

      {/* BANDEAU DE COMPÉTENCES */}
      <section className="cx-pub-strip" aria-label="Compétences">
        <div className="cx-pub-container cx-pub-strip__inner">
          <p className="cx-small" style={{ color: "rgb(255 255 255 / 0.78)" }}>
            Une expertise 100 % développement web
          </p>
          <ul className="cx-pub-strip__list">
            {["Stratégie", "UX / UI", "Front-end", "Back-end", "Optimisation"].map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* AGENCE */}
      <section id="agence" className="cx-pub-section">
        <div className="cx-pub-container cx-pub-split">
          <div>
            <p className="cx-pub-eyebrow">Qui sommes-nous ?</p>
            <h2 className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-5)" }}>
              Un partenaire technique qui parle votre langage.
            </h2>
            <p className="cx-pub-body" style={{ marginTop: "var(--comexa-space-5)" }}>
              Comexa est une agence entièrement dédiée au développement web. Nous transformons un besoin
              métier en une expérience numérique utile, compréhensible et robuste — sans jargon inutile, ni
              solution surdimensionnée.
            </p>
            <ul className="cx-pub-checks">
              <li>Écoute active</li>
              <li>Choix transparents</li>
              <li>Code maintenable</li>
            </ul>
            <div style={{ marginTop: "var(--comexa-space-8)" }}>
              <a href="#contact" className="cx-pub-link">
                Découvrir notre approche <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
          <div className="cx-pub-hero__visual" style={{ boxShadow: "none" }}>
            <Image
              src={quisommesnous1}
              alt="Les quatre étapes de la méthode Comexa : comprendre, concevoir, développer, faire vivre"
              width={1000}
              height={800}
              sizes="(min-width: 900px) 45vw, 100vw"
              style={{ height: "auto", objectFit: "contain" }}
            />
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section id="services" className="cx-pub-section cx-pub-section--tint cx-pub-section--line">
        <div className="cx-pub-container">
          <div className="cx-pub-split" style={{ alignItems: "end", marginBottom: "var(--comexa-space-10)" }}>
            <div>
              <p className="cx-pub-eyebrow">Nos services</p>
              <h2 className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-5)" }}>
                Tout ce qu’il faut pour construire et faire vivre votre projet web.
              </h2>
            </div>
            <p className="cx-pub-body">
              Un périmètre volontairement clair : nous concevons, développons et améliorons des produits web.
            </p>
          </div>
          <div className="cx-pub-services">
            {serviceCards.map((service) => (
              <article key={service.number} className="cx-pub-service">
                <span className="cx-pub-service__num">{service.number}</span>
                <div>
                  <h3 className="cx-pub-service__title">{service.title}</h3>
                  {service.startingPrice ? <p className="cx-pub-service__price">À partir de {service.startingPrice}</p> : null}
                  <div className="cx-pub-service__tags">
                    {service.tags.map((tag) => (
                      <span key={tag} className="cx-pub-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="cx-pub-service__desc">{service.description}</p>
                <span className="cx-pub-service__arrow" aria-hidden="true">
                  →
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* RÉALISATIONS */}
      <section id="realisations" className="cx-pub-section">
        <div className="cx-pub-container">
          <div className="cx-pub-split" style={{ alignItems: "end", marginBottom: "var(--comexa-space-10)" }}>
            <div>
              <p className="cx-pub-eyebrow">Projets récents</p>
              <h2 className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-5)" }}>
                Des réalisations pensées pour les usages, pas pour la galerie.
              </h2>
            </div>
            <p className="cx-pub-body">
              Chaque projet associe exigence visuelle, solidité technique et autonomie pour les équipes qui le
              font vivre.
            </p>
          </div>
          <div className="cx-pub-works">
            <article className="cx-pub-work cx-pub-work--large">
              <div className="cx-pub-work__media">
                <Image
                  src={featured.image}
                  alt={featured.title}
                  width={1000}
                  height={700}
                  sizes="(min-width: 900px) 66vw, 100vw"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>
              <div className="cx-pub-work__body">
                <span className="cx-pub-work__cat">{featured.category}</span>
                <h3 className="cx-pub-work__title">{featured.title}</h3>
                <p className="cx-pub-body">{featured.description}</p>
                <p className="cx-pub-work__meta">{featured.footer}</p>
              </div>
            </article>
            {smallProjects.map((project) => (
              <article key={project.title} className="cx-pub-work cx-pub-work--small">
                <div className="cx-pub-work__media">
                  <Image
                    src={project.image}
                    alt={project.title}
                    width={600}
                    height={380}
                    sizes="(min-width: 900px) 33vw, 100vw"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>
                <div className="cx-pub-work__body">
                  <span className="cx-pub-work__cat">{project.category}</span>
                  <h3 className="cx-pub-work__title">{project.title}</h3>
                  <p className="cx-pub-work__meta">{project.footer}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* MÉTHODE */}
      <section className="cx-pub-section cx-pub-section--tint cx-pub-section--line">
        <div className="cx-pub-container">
          <p className="cx-pub-eyebrow">Notre méthode</p>
          <h2 className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-5)", maxWidth: "20ch" }}>
            Un projet lisible, du premier atelier à la mise en ligne.
          </h2>
          <p className="cx-pub-body" style={{ marginTop: "var(--comexa-space-5)", marginBottom: "var(--comexa-space-10)" }}>
            Des étapes courtes, des décisions partagées et un suivi régulier : vous savez toujours où en est le
            projet.
          </p>
          <ol className="cx-pub-method">
            {steps.map((step) => (
              <li
                key={step.number}
                className="cx-pub-method__step"
                data-active={step.active ? "true" : "false"}
                aria-current={step.active ? "step" : undefined}
              >
                <span className="cx-pub-method__num">ÉTAPE {step.number}</span>
                <h3 style={{ fontSize: "24px", lineHeight: 1.2 }}>
                  {step.title}
                </h3>
                <p className="cx-pub-body" style={{ fontSize: "15px" }}>
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* TÉMOIGNAGES */}
      <section className="cx-pub-section">
        <div className="cx-pub-container">
          <p className="cx-pub-eyebrow">Ils en parlent</p>
          <h2 className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-5)", marginBottom: "var(--comexa-space-10)", maxWidth: "22ch" }}>
            Des collaborations qui restent simples et humaines.
          </h2>
          <ul className="cx-pub-quotes">
            {testimonialCards.map((testimonial) => (
              <li key={testimonial.name} className="cx-pub-quote">
                <p>“{testimonial.text}”</p>
                <footer>
                  <span className="cx-pub-avatar" aria-hidden="true">
                    {testimonial.initials}
                  </span>
                  <span>
                    <strong style={{ color: "var(--comexa-ink)", fontWeight: 500 }}>{testimonial.name}</strong>
                    <br />
                    {testimonial.role}
                  </span>
                </footer>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: "var(--comexa-space-12)" }}>
            <p className="cx-pub-eyebrow" style={{ color: "var(--comexa-ink-muted)" }}>
              Partenaires et technologies de confiance
            </p>
            <ul className="cx-pub-strip__list" style={{ marginTop: "var(--comexa-space-4)", color: "var(--comexa-ink)" }}>
              {partners.map((partner) => (
                <li key={partner} style={{ color: "var(--comexa-ink-soft)" }}>
                  {partner}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <section id="contact" className="cx-pub-section cx-pub-section--tint cx-pub-section--line">
        <div className="cx-pub-container cx-pub-split">
          <div>
            <p className="cx-pub-eyebrow">Échanges sur votre projet</p>
            <h2 className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-5)" }}>
              Prêt à prendre le bon cap ?
            </h2>
            <p className="cx-pub-body" style={{ marginTop: "var(--comexa-space-5)" }}>
              Parlez-nous de votre contexte, de vos priorités et de votre calendrier. Nous vous répondons avec une
              première lecture claire de votre besoin.
            </p>
            <ul className="cx-pub-checks">
              <li>bonjour@comexa.dz</li>
              <li>Algérie · Projets partout en Algérie et à l’international</li>
            </ul>
          </div>
          <form
            className="cx-card cx-card--raised"
            style={{ display: "grid", gap: "var(--comexa-space-4)", padding: "var(--comexa-space-6)" }}
            onSubmit={handleContactSubmit}
            aria-describedby="contact-status"
          >
            <h3 style={{ fontSize: "24px", lineHeight: 1.2 }}>
              Parlons de votre projet
            </h3>
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
              <p id="contact-status" className="cx-caption" style={{ margin: 0 }}>
                Votre demande arrive directement dans l’espace équipe. Nous revenons vers vous avec une première lecture claire.
              </p>
            )}
            <div style={{ display: "grid", gap: "var(--comexa-space-4)", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
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
            <div style={{ display: "grid", gap: "var(--comexa-space-4)", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <div>
                <label htmlFor="contact-company" className="cx-label">Entreprise</label>
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
              <div>
                <label htmlFor="contact-phone" className="cx-label">Téléphone</label>
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
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="cx-label">Votre besoin</legend>
              <div className="cx-cluster" style={{ marginTop: "var(--comexa-space-2)" }}>
                {needs.map((item) => (
                  <button
                    type="button"
                    key={item}
                    aria-pressed={selectedNeed === item}
                    onClick={() => setSelectedNeed(item)}
                    className="cx-pub-tag"
                    style={{
                      minHeight: "44px",
                      cursor: "pointer",
                      borderColor: selectedNeed === item ? "var(--comexa-ink)" : undefined,
                      boxShadow: selectedNeed === item ? "var(--comexa-shadow-hard-sm)" : undefined,
                      color: "var(--comexa-ink)",
                      fontWeight: selectedNeed === item ? 600 : 400,
                    }}
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
            <label
              htmlFor="contact-consent"
              style={{ display: "flex", gap: "var(--comexa-space-2)", alignItems: "flex-start", cursor: "pointer" }}
              className="cx-caption"
            >
              <input
                id="contact-consent"
                name="consent"
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                style={{ marginTop: "2px", width: "16px", height: "16px", accentColor: "var(--comexa-accent)" }}
              />
              <span>J’accepte que Comexa utilise mes informations pour répondre à ma demande.</span>
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "var(--comexa-space-4)" }}>
              <p className="cx-caption" style={{ maxWidth: "34ch", margin: 0 }}>
                Vos informations restent confidentielles et servent uniquement à vous répondre.
              </p>
              <button type="submit" className="cx-btn cx-btn--primary" disabled={sending} aria-disabled={sending}>
                {sending ? "Envoi en cours…" : "Envoyer ma demande"}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* CTA FINAL — seule carte Ink de la page */}
      <section className="cx-pub-section" style={{ paddingTop: 0 }}>
        <div className="cx-pub-container">
          <div className="cx-pub-cta">
            <div>
              <p className="cx-pub-eyebrow">Un premier échange</p>
              <h2 className="cx-pub-h2" style={{ marginTop: "var(--comexa-space-4)" }}>
                Un projet web à lancer ou à faire évoluer ?
              </h2>
              <p style={{ marginTop: "var(--comexa-space-4)" }}>
                Décrivez-nous votre besoin : nous revenons vers vous avec une première lecture claire.
              </p>
            </div>
            <Link href="/contact" className="cx-btn cx-btn--accent cx-btn--lg">
              Parlons de votre projet
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
